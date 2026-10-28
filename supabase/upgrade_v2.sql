-- =====================================================================
-- SHU SOC Log: v2 upgrade. Run once AFTER schema.sql and auth_upgrade.sql.
-- Safe to re-run.
--
-- Adds:
--   * Shifts, shift members and check ownership (who is responsible for what)
--   * Shift handoff notes (permanent, like log entries)
--   * Evidence attachments (private Storage bucket "evidence")
--   * Tool snapshots: numbers pulled straight from CrowdStrike / Defender /
--     Duo / Abnormal by a server function and pinned to a log entry
--   * Alert bookkeeping for Teams alerts and Splunk forwarding
--   * Data retention setting
-- =====================================================================

-- ---------- settings ----------------------------------------------------
alter table public.app_settings add column if not exists retention_days int not null default 1095 check (retention_days between 365 and 3650);
alter table public.app_settings add column if not exists notes_guidance text not null
  default 'Don''t paste passwords, MFA codes, student records (FERPA), HR or medical details. Name the account or host instead.';

-- ---------- shifts --------------------------------------------------------
create table if not exists public.shifts (
  id bigint generated always as identity primary key,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  days smallint[] not null default '{1,2,3,4,5}',          -- 0 = Sunday … 6 = Saturday
  starts time not null default '09:00',
  ends time not null default '17:00',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint days_valid check (days <@ array[0,1,2,3,4,5,6]::smallint[] and cardinality(days) between 1 and 7)
);
create table if not exists public.shift_members (
  shift_id bigint not null references public.shifts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  primary key (shift_id, user_id)
);

-- Who owns each check: one person, or everyone on one shift (or nobody).
alter table public.practices add column if not exists owner_id uuid references public.profiles (id) on delete set null;
alter table public.practices add column if not exists owner_shift_id bigint references public.shifts (id) on delete set null;
alter table public.practices drop constraint if exists one_owner;
alter table public.practices add constraint one_owner check (owner_id is null or owner_shift_id is null);
-- Which tool connector can take a snapshot for this check (null = none).
alter table public.practices add column if not exists snapshot_source text
  check (snapshot_source in ('crowdstrike_alerts', 'defender_incidents', 'duo_auth_denied', 'abnormal_threats'));
update public.practices set snapshot_source = 'crowdstrike_alerts' where id = 'cs1' and snapshot_source is null;
update public.practices set snapshot_source = 'defender_incidents' where id = 'md1' and snapshot_source is null;
update public.practices set snapshot_source = 'duo_auth_denied'    where id = 'duo2' and snapshot_source is null;
update public.practices set snapshot_source = 'abnormal_threats'   where id = 'ab1' and snapshot_source is null;

-- ---------- handoffs --------------------------------------------------------
create table if not exists public.handoffs (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references public.profiles (id),
  shift_id bigint references public.shifts (id) on delete set null,
  summary text not null check (char_length(btrim(summary)) between 10 and 4000),
  open_items text check (char_length(open_items) <= 4000),
  watch_for text check (char_length(watch_for) <= 2000),
  created_at timestamptz not null default now()
);
create index if not exists handoffs_created_idx on public.handoffs (created_at desc);

-- ---------- tool snapshots ---------------------------------------------------
-- Written ONLY by the snapshot server function (service role). Analysts can
-- read their own; a log entry can point at one taken by the same person in
-- the last 2 hours.
create table if not exists public.tool_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id),
  source text not null,
  metrics jsonb not null,
  taken_at timestamptz not null default now()
);
create index if not exists tool_snapshots_user_idx on public.tool_snapshots (user_id, taken_at desc);

-- ---------- log entries: evidence + snapshot + alert bookkeeping ------------
alter table public.check_logs add column if not exists attachments text[] not null default '{}';
alter table public.check_logs add column if not exists snapshot_id uuid references public.tool_snapshots (id);
alter table public.check_logs add column if not exists notified_at timestamptz;   -- set by the alert function
alter table public.check_logs drop constraint if exists attachments_max;
alter table public.check_logs add constraint attachments_max check (cardinality(attachments) <= 5);

create or replace function public.stamp_check_log() returns trigger
language plpgsql security definer set search_path = public as $$
declare a text;
begin
  new.user_id := auth.uid();
  new.created_at := now();
  new.notified_at := null;
  if not exists (select 1 from practices where id = new.practice_id and active) then
    raise exception 'That check is not on the active checklist.';
  end if;
  foreach a in array coalesce(new.attachments, '{}') loop
    if split_part(a, '/', 1) <> auth.uid()::text or a !~ '^[0-9a-f-]{36}/[0-9a-zA-Z._-]{1,120}$' then
      raise exception 'Attachments must be files you uploaded.';
    end if;
  end loop;
  if new.snapshot_id is not null and not exists (
       select 1 from tool_snapshots s where s.id = new.snapshot_id and s.user_id = auth.uid() and s.taken_at > now() - interval '2 hours') then
    raise exception 'That tool snapshot is missing, not yours, or older than 2 hours. Take a new one.';
  end if;
  return new;
end $$;

-- ---------- alert / forwarding state (server functions only) ----------------
create table if not exists public.integration_state (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ---------- RLS ----------------------------------------------------------------
alter table public.shifts enable row level security;
alter table public.shift_members enable row level security;
alter table public.handoffs enable row level security;
alter table public.tool_snapshots enable row level security;
alter table public.integration_state enable row level security;   -- no policies: service role only

drop policy if exists shifts_read on public.shifts;
create policy shifts_read on public.shifts for select to authenticated using (is_active_member());
drop policy if exists shifts_write on public.shifts;
create policy shifts_write on public.shifts for all to authenticated using (is_supervisor()) with check (is_supervisor());

drop policy if exists shift_members_read on public.shift_members;
create policy shift_members_read on public.shift_members for select to authenticated using (is_active_member());
drop policy if exists shift_members_write on public.shift_members;
create policy shift_members_write on public.shift_members for all to authenticated using (is_supervisor()) with check (is_supervisor());

-- Handoffs are shared with the whole active team (that's the point of them),
-- written only by active members for themselves, never edited or deleted.
drop policy if exists handoffs_read on public.handoffs;
create policy handoffs_read on public.handoffs for select to authenticated using (is_active_member());
drop policy if exists handoffs_insert on public.handoffs;
create policy handoffs_insert on public.handoffs for insert to authenticated with check (user_id = auth.uid() and is_active_member());

drop policy if exists snapshots_read on public.tool_snapshots;
create policy snapshots_read on public.tool_snapshots for select to authenticated
  using ((user_id = auth.uid() and mfa_ok()) or is_supervisor());

-- Analysts need names for handoffs and owners; expose a narrow directory.
create or replace view public.team_directory with (security_invoker = false) as
  select id, full_name, role from public.profiles where status = 'active';
revoke all on public.team_directory from anon, authenticated;
create or replace function public.directory() returns setof public.team_directory
language sql stable security definer set search_path = public as $$
  select * from team_directory where is_active_member();
$$;

create or replace function public.stamp_handoff() returns trigger
language plpgsql security definer set search_path = public as $$
begin new.user_id := auth.uid(); new.created_at := now(); return new; end $$;
drop trigger if exists handoffs_stamp on public.handoffs;
create trigger handoffs_stamp before insert on public.handoffs for each row execute function public.stamp_handoff();

-- Audit shift and ownership changes.
create or replace function public.audit_shift_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into audit_events (actor_id, action, target_id, detail)
  values (auth.uid(), 'shift_' || lower(tg_op),
          case when tg_table_name = 'shift_members' then (coalesce(to_jsonb(new), to_jsonb(old)) ->> 'user_id')::uuid end,
          jsonb_build_object('table', tg_table_name, 'row', coalesce(to_jsonb(new), to_jsonb(old))));
  return coalesce(new, old);
end $$;
drop trigger if exists shifts_audit on public.shifts;
create trigger shifts_audit after insert or update or delete on public.shifts for each row when (auth.uid() is not null) execute function public.audit_shift_change();
drop trigger if exists shift_members_audit on public.shift_members;
create trigger shift_members_audit after insert or delete on public.shift_members for each row when (auth.uid() is not null) execute function public.audit_shift_change();

-- ---------- grants -----------------------------------------------------------
grant select, insert, update, delete on public.shifts, public.shift_members to authenticated;
grant select on public.handoffs to authenticated;
grant insert (shift_id, summary, open_items, watch_for) on public.handoffs to authenticated;
grant select on public.tool_snapshots to authenticated;
grant insert (attachments, snapshot_id) on public.check_logs to authenticated;
grant update (owner_id, owner_shift_id, snapshot_source) on public.practices to authenticated;
grant update (retention_days, notes_guidance) on public.app_settings to authenticated;
grant execute on function public.directory() to authenticated;

-- ---------- evidence storage --------------------------------------------------
-- Private bucket. Files live at <user id>/<random name>. Owners upload into
-- their own folder; supervisors and the owner can read; nobody edits/deletes.
do $$ begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('evidence', 'evidence', false, 10485760, array['image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'text/csv', 'text/plain'])
    on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

    drop policy if exists evidence_insert on storage.objects;
    create policy evidence_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'evidence' and (storage.foldername(name))[1] = auth.uid()::text and public.is_active_member());
    drop policy if exists evidence_read on storage.objects;
    create policy evidence_read on storage.objects for select to authenticated
      using (bucket_id = 'evidence' and (((storage.foldername(name))[1] = auth.uid()::text and public.mfa_ok()) or public.is_supervisor()));
  end if;
end $$;

-- ---------- retention -----------------------------------------------------------
-- Deletes log entries (and their reviews) older than the retention setting.
-- Runs from the scheduled server function with the service role only.
create or replace function public.apply_retention() returns integer
language plpgsql security definer set search_path = public as $$
declare cutoff timestamptz; n integer;
begin
  select now() - make_interval(days => retention_days) into cutoff from app_settings where id;
  delete from log_reviews where log_id in (select id from check_logs where created_at < cutoff);
  update check_logs set snapshot_id = null where created_at < cutoff;
  delete from check_logs where created_at < cutoff;
  get diagnostics n = row_count;
  delete from handoffs where created_at < cutoff;
  delete from tool_snapshots s where taken_at < cutoff and not exists (select 1 from check_logs l where l.snapshot_id = s.id);
  if n > 0 then insert into audit_events (actor_id, action, detail) values (null, 'retention_purge', jsonb_build_object('deleted_logs', n, 'cutoff', cutoff)); end if;
  return n;
end $$;
revoke all on function public.apply_retention() from public, anon, authenticated;

-- ---------- monthly report (supervisor) ----------------------------------------
create or replace function public.escalation_response(since timestamptz, until timestamptz)
returns table (log_id bigint, logged_at timestamptz, reviewed_at timestamptz, minutes numeric)
language sql stable security definer set search_path = public as $$
  select l.id, l.created_at, r.reviewed_at, round(extract(epoch from (r.reviewed_at - l.created_at)) / 60.0, 1)
  from check_logs l left join log_reviews r on r.log_id = l.id
  where is_supervisor() and l.result = 'escalated' and l.created_at >= since and l.created_at < until;
$$;
grant execute on function public.escalation_response(timestamptz, timestamptz) to authenticated;

-- ---------- last-done per check (used by the scheduled alert function) ------------
create or replace function public.coverage_snapshot()
returns table (id text, name text, tool text, priority text, frequency text, last_done timestamptz, last_by text, owner text)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.tool, p.priority, p.frequency,
         l.performed_at, lp.full_name,
         coalesce(op.full_name, s.name)
  from practices p
  left join lateral (select performed_at, user_id from check_logs where practice_id = p.id order by performed_at desc limit 1) l on true
  left join profiles lp on lp.id = l.user_id
  left join profiles op on op.id = p.owner_id
  left join shifts s on s.id = p.owner_shift_id
  where p.active;
$$;
revoke all on function public.coverage_snapshot() from public, anon, authenticated;
