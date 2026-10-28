-- Access-rule tests. Every check raises an exception on failure, so
-- `psql -v ON_ERROR_STOP=1 -f tests/rls_tests.sql` exits non-zero if any rule breaks.
\set QUIET on
\o /dev/null
create or replace function pg_temp.act(uid text, aal text default 'aal2') returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', uid, false); perform set_config('request.jwt.claim.aal', aal, false); execute 'set role authenticated'; end $$;
create or replace function pg_temp.ok(cond boolean, what text) returns void language plpgsql as $$
begin if not coalesce(cond, false) then raise exception 'FAILED: %', what; end if; raise notice 'ok  %', what; end $$;
create or replace function pg_temp.fails(sql text, what text) returns void language plpgsql as $$
begin begin execute sql; exception when others then raise notice 'ok  % (%)', what, sqlerrm; return; end; raise exception 'FAILED (statement was allowed): %', what; end $$;

insert into auth.users (id, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-00000000000a', 'boss@shu.edu', '{"full_name":"Sam Supervisor"}'),
 ('00000000-0000-0000-0000-00000000000b', 'maya@shu.edu', '{"full_name":"Maya Patel"}'),
 ('00000000-0000-0000-0000-00000000000c', 'omar@shu.edu', '{"full_name":"Omar Haddad"}');
select pg_temp.fails($$insert into auth.users (email) values ('x@gmail.com')$$, 'non-university email cannot sign up');
select pg_temp.ok((select role = 'supervisor' and status = 'active' from profiles where email = 'boss@shu.edu'), 'first account becomes supervisor');
select pg_temp.ok((select status = 'pending' from profiles where email = 'maya@shu.edu'), 'later accounts start pending');

-- pending cannot log
select pg_temp.act('00000000-0000-0000-0000-00000000000b');
select pg_temp.fails($$insert into check_logs (practice_id,result,performed_at,details) values ('cs1','clear',now(),'Reviewed the full queue, nothing new.')$$, 'pending analyst cannot log');
reset role;

-- supervisor approves; password-only session (aal1) cannot
select pg_temp.act('00000000-0000-0000-0000-00000000000a', 'aal1');
update profiles set status = 'active' where email = 'maya@shu.edu';
reset role;
select pg_temp.ok((select status = 'pending' from profiles where email = 'maya@shu.edu'), 'supervisor without 2-step cannot approve');
select pg_temp.act('00000000-0000-0000-0000-00000000000a');
update profiles set status = 'active' where email in ('maya@shu.edu', 'omar@shu.edu');
select pg_temp.fails($$update profiles set status = 'removed' where email = 'boss@shu.edu'$$, 'supervisor cannot remove themself');
insert into shifts (name, days, starts, ends) values ('Weekday morning', '{1,2,3,4,5}', '08:00', '12:00');
insert into shift_members (shift_id, user_id) select id, '00000000-0000-0000-0000-00000000000b' from shifts where name = 'Weekday morning';
update practices set owner_shift_id = (select id from shifts where name = 'Weekday morning') where id = 'cs1';
update practices set owner_id = '00000000-0000-0000-0000-00000000000c' where id = 'md1';
reset role;
select pg_temp.ok((select status = 'active' from profiles where email = 'maya@shu.edu'), 'supervisor with 2-step can approve');

-- analyst rules
select pg_temp.act('00000000-0000-0000-0000-00000000000b');
select pg_temp.fails($$update profiles set role = 'supervisor' where id = auth.uid()$$, 'analyst cannot promote themself');
select pg_temp.fails($$insert into shifts (name) values ('sneaky')$$, 'analyst cannot create shifts');
with u as (update practices set owner_id = auth.uid() where id = 'cs1' returning 1) select pg_temp.ok((select count(*) = 0 from u), 'analyst cannot change check owners');
select pg_temp.ok((select count(*) = 1 from profiles), 'analyst sees only their own profile');
select pg_temp.ok((select count(*) >= 3 from directory()), 'analyst can see team names through the directory');
select pg_temp.fails($$insert into check_logs (practice_id,result,performed_at,details,user_id) values ('cs1','clear',now(),'Reviewed the full queue, nothing new.','00000000-0000-0000-0000-00000000000c')$$, 'analyst cannot log as someone else');
insert into check_logs (practice_id,result,performed_at,details) values ('cs1','clear',now(),'Reviewed the full queue, nothing new.');
insert into check_logs (practice_id,result,performed_at,details,ticket,attachments) values ('cs1','escalated',now(),'Encoded PowerShell on FIN-LT022 from Outlook.','INC1', array['00000000-0000-0000-0000-00000000000b/shot1.png']);
select pg_temp.fails($$insert into check_logs (practice_id,result,performed_at,details,attachments) values ('cs1','clear',now(),'Reviewed the full queue, nothing new.', array['00000000-0000-0000-0000-00000000000c/theirs.png'])$$, 'cannot attach someone else''s file');
select pg_temp.fails($$insert into check_logs (practice_id,result,performed_at,details,snapshot_id) values ('cs1','clear',now(),'Reviewed the full queue, nothing new.', gen_random_uuid())$$, 'cannot cite a made-up tool snapshot');
select pg_temp.fails($$insert into tool_snapshots (user_id, source, metrics) values (auth.uid(), 'crowdstrike_alerts', '{"new":0}')$$, 'analyst cannot write tool snapshots');
select pg_temp.fails($$insert into check_logs (practice_id,result,performed_at,details) values ('cs1','escalated',now(),'Escalated without a ticket number here.')$$, 'escalation needs a ticket');
select pg_temp.fails($$insert into check_logs (practice_id,result,performed_at,details) values ('cs1','clear',now() - interval '10 days','Reviewed the full queue, nothing new.')$$, 'cannot backdate more than 7 days');
select pg_temp.fails($$update check_logs set details = 'changed changed changed changed'$$, 'logs cannot be edited');
select pg_temp.fails($$delete from check_logs$$, 'logs cannot be deleted');
insert into handoffs (summary, open_items) values ('Queue clean at 12:00. One escalation open on FIN-LT022.', 'FIN-LT022 waiting on re-image');
select pg_temp.fails($$update handoffs set summary = 'rewritten history here'$$, 'handoffs cannot be edited');
select pg_temp.ok((select count(*) = 0 from audit_events), 'analyst cannot read the audit trail');
reset role;

-- the other analyst
select pg_temp.act('00000000-0000-0000-0000-00000000000c');
select pg_temp.ok((select count(*) = 0 from check_logs), 'analysts cannot see each other''s logs');
select pg_temp.ok((select count(*) = 1 from handoffs), 'analysts can read shift handoffs');
reset role;
select pg_temp.act('00000000-0000-0000-0000-00000000000c', 'aal1');
select pg_temp.ok((select count(*) = 0 from handoffs), 'password-only session reads nothing');
reset role;

-- supervisor sees everything, removal blocks logging
select pg_temp.act('00000000-0000-0000-0000-00000000000a');
select pg_temp.ok((select count(*) = 2 from check_logs), 'supervisor sees all logs');
select pg_temp.ok((select count(*) = 1 from escalation_response(now() - interval '1 day', now() + interval '1 day')), 'escalation report works');
select pg_temp.ok((select count(*) > 0 from audit_events where action like 'shift_%'), 'shift changes are audited');
update profiles set status = 'removed' where email = 'omar@shu.edu';
reset role;
select pg_temp.act('00000000-0000-0000-0000-00000000000c');
select pg_temp.fails($$insert into check_logs (practice_id,result,performed_at,details) values ('cs1','clear',now(),'Reviewed the full queue, nothing new.')$$, 'removed member cannot log');
select pg_temp.fails($$insert into handoffs (summary) values ('I was removed but trying anyway.')$$, 'removed member cannot write handoffs');
reset role;

-- anonymous visitors
set role anon;
select pg_temp.fails($$select count(*) from check_logs$$, 'anonymous visitors cannot read logs');
select pg_temp.fails($$select count(*) from handoffs$$, 'anonymous visitors cannot read handoffs');
reset role;

-- service role (server functions) can stamp snapshots and run retention
-- (Supabase grants service_role everything by default; mirror that here)
grant all on all tables in schema public to service_role;
set role service_role;
insert into tool_snapshots (user_id, source, metrics) values ('00000000-0000-0000-0000-00000000000b', 'crowdstrike_alerts', '{"new": 3}');
reset role;
select pg_temp.act('00000000-0000-0000-0000-00000000000b');
insert into check_logs (practice_id,result,performed_at,details,snapshot_id) select 'cs1','clear',now(),'Reviewed the full queue, 3 new, all FP.', id from tool_snapshots limit 1;
select pg_temp.ok((select count(*) = 1 from check_logs where snapshot_id is not null), 'analyst can cite their own fresh snapshot');
reset role;
select pg_temp.ok(apply_retention() = 0, 'retention keeps recent entries');
\o
\echo ALL ACCESS-RULE TESTS PASSED
