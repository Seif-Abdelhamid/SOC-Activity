-- =====================================================================
-- SHU SOC Log: sign-in upgrade (Duo Mobile 2-step, Microsoft, Google,
-- magic link, passkeys). Run once AFTER schema.sql. Safe to re-run.
--
-- What it changes:
-- * 2-step verification is enforced by the DATABASE, not just the page:
--   a session only counts as a team member / supervisor once it has passed
--   the Duo Mobile code check (Supabase "aal2"). A stolen password alone
--   can't read or write anything.
-- * Supervisors can reset someone's 2-step setup (lost phone). Audited.
-- * Accounts created through Microsoft/Google pick up the person's name.
-- =====================================================================

-- True only when this session has passed 2-step verification.
create or replace function public.mfa_ok() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2';
$$;

create or replace function public.is_supervisor() returns boolean
language sql stable security definer set search_path = public as $$
  select mfa_ok() and exists (select 1 from profiles where id = auth.uid() and role = 'supervisor' and status = 'active');
$$;

create or replace function public.is_active_member() returns boolean
language sql stable security definer set search_path = public as $$
  select mfa_ok() and exists (select 1 from profiles where id = auth.uid() and status = 'active');
$$;

-- Own rows also need a verified session now.
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using ((id = auth.uid() and mfa_ok()) or is_supervisor()) with check ((id = auth.uid() and mfa_ok()) or is_supervisor());

drop policy if exists practices_read on public.practices;
create policy practices_read on public.practices for select to authenticated using (mfa_ok());

drop policy if exists logs_read on public.check_logs;
create policy logs_read on public.check_logs for select to authenticated
  using ((user_id = auth.uid() and mfa_ok()) or is_supervisor());

drop policy if exists reviews_read on public.log_reviews;
create policy reviews_read on public.log_reviews for select to authenticated
  using (is_supervisor() or (mfa_ok() and exists (select 1 from check_logs l where l.id = log_id and l.user_id = auth.uid())));

-- Name for Microsoft / Google sign-ups ("name" instead of "full_name").
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
          coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
                   nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
                   split_part(new.email, '@', 1)),
          case when first_user then 'supervisor' else 'analyst' end,
          case when first_user then 'active' else 'pending' end,
          now());
  insert into audit_events (actor_id, action, target_id, detail)
  values (new.id, case when first_user then 'bootstrap_supervisor' else 'signed_up' end, new.id,
          jsonb_build_object('email', lower(new.email)));
  return new;
end $$;

-- Supervisor: wipe someone's 2-step setup so they can enroll a new phone.
create or replace function public.reset_member_mfa(target uuid) returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if not is_supervisor() then raise exception 'Only a supervisor can reset 2-step verification.'; end if;
  if target = auth.uid() then raise exception 'You cannot reset your own 2-step verification. Ask another supervisor.'; end if;
  delete from auth.mfa_factors where user_id = target;
  insert into audit_events (actor_id, action, target_id, detail)
  values (auth.uid(), 'mfa_reset', target,
          jsonb_build_object('email', (select email from profiles where id = target)));
end $$;

revoke all on function public.reset_member_mfa(uuid) from public, anon;
grant execute on function public.mfa_ok(), public.reset_member_mfa(uuid) to authenticated;
