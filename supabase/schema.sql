-- =====================================================================
-- SHU SOC Log: database schema
-- Run this once in Supabase: Dashboard > SQL Editor > New query > paste > Run.
-- Then run seed_practices.sql the same way.
--
-- Who can do what (enforced by the database, not just the website):
--   * Anyone with an allowed email can sign up. New accounts start as "pending"
--     and can't log anything until a supervisor approves them.
--   * The very first account created becomes the supervisor automatically.
--   * Analysts (students) can add check logs for themselves and read only
--     their own logs. Nobody can edit or delete a log once it's saved.
--   * Supervisors can read everything, approve/remove people, change roles,
--     review logs and edit the checklist. Every access change is audited.
-- =====================================================================



-- ---------- settings -------------------------------------------------
create table if not exists public.app_settings (
  id boolean primary key default true check (id),           -- single row
  org_name text not null default 'Seton Hall University SOC',
  allowed_email_domain text default 'shu.edu',              -- null = any domain
  updated_at timestamptz not null default now()
);
insert into public.app_settings (id) values (true) on conflict do nothing;

-- ---------- people ----------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text not null,
  role text not null default 'analyst' check (role in ('analyst', 'supervisor')),
  status text not null default 'pending' check (status in ('pending', 'active', 'removed')),
  created_at timestamptz not null default now(),
  status_changed_at timestamptz,
  status_changed_by uuid references public.profiles (id),
  last_seen_at timestamptz
);

-- ---------- checklist -------------------------------------------------
create table if not exists public.practices (
  id text primary key,
  tool text not null,
  category text not null,
  name text not null,
  details text,
  frequency text not null check (frequency in ('Continuous','Daily','Weekly','Monthly','Quarterly','Annually','As Needed')),
  priority text not null check (priority in ('Critical','High','Medium','Low')),
  how_to text,
  active boolean not null default true,
  sort_order int not null default 0
);

-- ---------- check logs (the evidence) ---------------------------------
create table if not exists public.check_logs (
  id bigint generated always as identity primary key,
  ref text not null unique default ('CHK-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
  user_id uuid not null default auth.uid() references public.profiles (id),
  practice_id text not null references public.practices (id),
  result text not null check (result in ('clear', 'handled', 'escalated', 'incomplete')),
  performed_at timestamptz not null,
  duration_min int check (duration_min between 1 and 1440),
  items_reviewed int check (items_reviewed between 0 and 100000),
  details text not null check (char_length(btrim(details)) between 25 and 4000),
  affected text check (char_length(affected) <= 1000),
  action_taken text check (char_length(action_taken) <= 2000),
  ticket text check (char_length(ticket) <= 60),
  blocker text check (char_length(blocker) <= 1000),
  user_agent text,
  created_at timestamptz not null default now(),       -- server time, can't be faked
  constraint ticket_when_needed check (result not in ('handled', 'escalated') or nullif(btrim(ticket), '') is not null),
  constraint blocker_when_incomplete check (result <> 'incomplete' or nullif(btrim(blocker), '') is not null),
  constraint performed_window check (performed_at <= created_at + interval '5 minutes'
                                     and performed_at >= created_at - interval '7 days')
);
create index if not exists check_logs_user_idx on public.check_logs (user_id, performed_at desc);
create index if not exists check_logs_practice_idx on public.check_logs (practice_id, performed_at desc);
create index if not exists check_logs_performed_idx on public.check_logs (performed_at desc);

-- ---------- supervisor reviews ----------------------------------------
create table if not exists public.log_reviews (
  log_id bigint primary key references public.check_logs (id),
  reviewer_id uuid not null default auth.uid() references public.profiles (id),
  outcome text not null check (outcome in ('acknowledged', 'follow_up', 'closed')),
  note text check (char_length(note) <= 2000),
  reviewed_at timestamptz not null default now()
);

-- ---------- audit trail ------------------------------------------------
create table if not exists public.audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid,
  action text not null,
  target_id uuid,
  detail jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);
create index if not exists audit_events_at_idx on public.audit_events (at desc);

-- =====================================================================
-- helper functions (security definer so RLS policies can call them)
-- =====================================================================
create or replace function public.is_supervisor() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'supervisor' and status = 'active');
$$;

create or replace function public.is_active_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and status = 'active');
$$;

-- New sign-up -> profile row. First account ever becomes the active supervisor.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  domain text;
  first_user boolean;
begin
  select allowed_email_domain into domain from app_settings where id;
  if domain is not null and lower(split_part(new.email, '@', 2)) <> lower(domain) then
    raise exception 'Only @% email addresses can sign up.', domain using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(4242);
  select not exists (select 1 from profiles) into first_user;
  insert into profiles (id, email, full_name, role, status, status_changed_at)
  values (new.id, lower(new.email),
          coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1)),
          case when first_user then 'supervisor' else 'analyst' end,
          case when first_user then 'active' else 'pending' end,
          now());
  insert into audit_events (actor_id, action, target_id, detail)
  values (new.id, case when first_user then 'bootstrap_supervisor' else 'signed_up' end, new.id,
          jsonb_build_object('email', lower(new.email)));
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Guard profile changes: people can only rename themselves; only supervisors
-- change role/status; never leave the team without an active supervisor.
create or replace function public.guard_profile_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.id <> old.id or new.email <> old.email or new.created_at <> old.created_at then
    raise exception 'Those fields cannot be changed.';
  end if;
  if (new.role, new.status) is distinct from (old.role, old.status) then
    if not is_supervisor() then
      raise exception 'Only a supervisor can change access.';
    end if;
    if new.id = auth.uid() then
      raise exception 'You cannot change your own access. Ask another supervisor.';
    end if;
    new.status_changed_at := now();
    new.status_changed_by := auth.uid();
    insert into audit_events (actor_id, action, target_id, detail)
    values (auth.uid(),
            case when new.status <> old.status then
                   case new.status when 'active' then case old.status when 'removed' then 'restored' else 'approved' end
                                   when 'removed' then case old.status when 'pending' then 'declined' else 'removed' end
                                   else 'set_pending' end
                 else 'role_changed' end,
            new.id,
            jsonb_build_object('from_role', old.role, 'to_role', new.role,
                               'from_status', old.status, 'to_status', new.status, 'email', new.email));
  else
    new.status_changed_at := old.status_changed_at;
    new.status_changed_by := old.status_changed_by;
  end if;
  return new;
end $$;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.guard_profile_update();

-- Logs: stamp owner + server time no matter what the browser sends.
create or replace function public.stamp_check_log() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.user_id := auth.uid();
  new.created_at := now();
  if not exists (select 1 from practices where id = new.practice_id and active) then
    raise exception 'That check is not on the active checklist.';
  end if;
  return new;
end $$;

drop trigger if exists check_logs_stamp on public.check_logs;
create trigger check_logs_stamp before insert on public.check_logs
  for each row execute function public.stamp_check_log();

create or replace function public.stamp_review() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.reviewer_id := auth.uid();
  new.reviewed_at := now();
  insert into audit_events (actor_id, action, detail)
  values (auth.uid(), case tg_op when 'INSERT' then 'log_reviewed' else 'review_updated' end,
          jsonb_build_object('log_id', new.log_id, 'outcome', new.outcome));
  return new;
end $$;

drop trigger if exists log_reviews_stamp on public.log_reviews;
create trigger log_reviews_stamp before insert or update on public.log_reviews
  for each row execute function public.stamp_review();

create or replace function public.audit_practice_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into audit_events (actor_id, action, detail)
  values (auth.uid(), 'checklist_' || lower(tg_op),
          jsonb_build_object('practice', coalesce(new.id, old.id), 'name', coalesce(new.name, old.name)));
  return coalesce(new, old);
end $$;

drop trigger if exists practices_audit on public.practices;
create trigger practices_audit after insert or update on public.practices
  for each row when (auth.uid() is not null) execute function public.audit_practice_change();

-- Small RPC so the app can record "last seen" without broader update rights.
create or replace function public.touch_last_seen() returns void
language sql security definer set search_path = public as $$
  update profiles set last_seen_at = now() where id = auth.uid();
$$;

-- =====================================================================
-- row level security
-- =====================================================================
alter table public.app_settings enable row level security;
alter table public.profiles     enable row level security;
alter table public.practices    enable row level security;
alter table public.check_logs   enable row level security;
alter table public.log_reviews  enable row level security;
alter table public.audit_events enable row level security;

drop policy if exists settings_read on public.app_settings;
create policy settings_read on public.app_settings for select to anon, authenticated using (true);
drop policy if exists settings_write on public.app_settings;
create policy settings_write on public.app_settings for update to authenticated using (is_supervisor()) with check (is_supervisor());

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or is_supervisor());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or is_supervisor()) with check (id = auth.uid() or is_supervisor());

drop policy if exists practices_read on public.practices;
create policy practices_read on public.practices for select to authenticated using (true);
drop policy if exists practices_insert on public.practices;
create policy practices_insert on public.practices for insert to authenticated with check (is_supervisor());
drop policy if exists practices_update on public.practices;
create policy practices_update on public.practices for update to authenticated using (is_supervisor()) with check (is_supervisor());

drop policy if exists logs_read on public.check_logs;
create policy logs_read on public.check_logs for select to authenticated
  using (user_id = auth.uid() or is_supervisor());
drop policy if exists logs_insert on public.check_logs;
create policy logs_insert on public.check_logs for insert to authenticated
  with check (user_id = auth.uid() and is_active_member());
-- no update / delete policies: saved logs are permanent

drop policy if exists reviews_read on public.log_reviews;
create policy reviews_read on public.log_reviews for select to authenticated
  using (is_supervisor() or exists (select 1 from check_logs l where l.id = log_id and l.user_id = auth.uid()));
drop policy if exists reviews_insert on public.log_reviews;
create policy reviews_insert on public.log_reviews for insert to authenticated with check (is_supervisor());
drop policy if exists reviews_update on public.log_reviews;
create policy reviews_update on public.log_reviews for update to authenticated using (is_supervisor()) with check (is_supervisor());

drop policy if exists audit_read on public.audit_events;
create policy audit_read on public.audit_events for select to authenticated using (is_supervisor());

-- table privileges (RLS still applies on top)
revoke all on public.check_logs, public.log_reviews, public.audit_events, public.profiles, public.practices, public.app_settings from anon, authenticated;
grant select on public.app_settings to anon;
grant select, update on public.app_settings to authenticated;
grant select, update (full_name) on public.profiles to authenticated;
grant update (role, status) on public.profiles to authenticated;
grant select, insert, update on public.practices to authenticated;
grant select on public.check_logs to authenticated;
grant insert (practice_id, result, performed_at, duration_min, items_reviewed, details, affected, action_taken, ticket, blocker, user_agent)
  on public.check_logs to authenticated;
grant select, insert, update (outcome, note) on public.log_reviews to authenticated;
grant select on public.audit_events to authenticated;
grant execute on function public.is_supervisor(), public.is_active_member(), public.touch_last_seen() to authenticated;
