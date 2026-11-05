-- AC-NS-004/005: dormant native statement nightly obligations (organization-local 02:00 materialization
-- with a durable cursor) and the service-only internal manual intent quota. Both write paths run on the
-- reviewed 0643 lease/binding/context prefix and recheck the live lease immediately before returning.
-- Nothing here schedules, admits, publishes, enables or exposes a user endpoint.
begin;
select no_plan();

insert into public.organizations(id,name,default_currency,default_timezone) values
 ('06440000-0000-0000-0000-000000000001','Nightly fixture A','IDR','UTC'),
 ('06440000-0000-0000-0000-000000000002','Nightly fixture B','IDR','UTC');
-- One captured calendar reference so every expected date is relative to the database clock, never a
-- fixture clock injected into the functions.
create temporary table fixture_clock as
select d as today,
       d + case when t>=time '02:00' then 1 else 0 end as first_future
  from (select (clock_timestamp() at time zone 'UTC')::date as d,
               (clock_timestamp() at time zone 'UTC')::time as t) captured;
create temporary table payload(result jsonb);
set local role service_role;
insert into public.external_org_bindings(id,org_id,external_tier,site_url,secret_ref,version_major,config,activated_at) values
 ('06440000-0000-0000-0000-000000000011','06440000-0000-0000-0000-000000000001','erpnext','https://example.invalid','fixture',16,'{"company":"Nightly A","project_map":{}}','2026-10-18T09:00:00Z'),
 ('06440000-0000-0000-0000-000000000012','06440000-0000-0000-0000-000000000002','erpnext','https://example.invalid','fixture',16,'{"company":"Nightly B","project_map":{}}','2026-10-18T09:00:00Z');
insert into public.erp_sweep_lock(org_id,holder,locked_until) values
 ('06440000-0000-0000-0000-000000000001','06440000-0000-0000-0000-000000000101',clock_timestamp()+interval '60 minutes'),
 ('06440000-0000-0000-0000-000000000002','06440000-0000-0000-0000-000000000102',clock_timestamp()+interval '60 minutes');
select is(public.sync_erp_statement_change_scope('06440000-0000-0000-0000-000000000001','06440000-0000-0000-0000-000000000101','06440000-0000-0000-0000-000000000011','2026-10-18T09:00:00Z')->>'status','initialized','AC-NS-004 nightly fixture A initializes a dormant state row');
select is(public.sync_erp_statement_change_scope('06440000-0000-0000-0000-000000000002','06440000-0000-0000-0000-000000000102','06440000-0000-0000-0000-000000000012','2026-10-18T09:00:00Z')->>'status','initialized','AC-NS-004 nightly fixture B initializes an independently dormant state row');
reset role;
grant select on fixture_clock to service_role;
grant insert,select,delete on payload to service_role;
update public.erp_statement_change_state set enabled=true where org_id='06440000-0000-0000-0000-000000000001';

-- ── Scheduling oracle: contemporary IANA minute-aligned transitions only ──────────────────────────
select is(public._erp_statement_nightly_due_at('2026-01-15','UTC'),'2026-01-15 02:00:00+00'::timestamptz,
 'AC-NS-004 resolver schedules a UTC organization at local 02:00');
select is(public._erp_statement_nightly_due_at('2026-01-15','Asia/Jakarta'),'2026-01-14 19:00:00+00'::timestamptz,
 'AC-NS-004 resolver converts a Jakarta local 02:00 to 19:00Z the previous day');
select is(public._erp_statement_nightly_due_at('2026-03-29','Europe/Paris'),'2026-03-29 01:00:00+00'::timestamptz,
 'AC-NS-004 resolver takes the first valid instant after a spring-forward gap');
select ok(public._erp_statement_nightly_due_at('2026-10-25','Europe/Paris')='2026-10-25 00:00:00+00'::timestamptz
  and public._erp_statement_nightly_due_at('2026-10-25','Europe/Paris')<'2026-10-25 01:00:00+00'::timestamptz,
 'AC-NS-004 resolver takes the first of two repeated overlap instants');
select is(public._erp_statement_nightly_due_at('2011-12-30','Pacific/Apia'),'2011-12-30 10:00:00+00'::timestamptz,
 'AC-NS-004 resolver keeps a skipped local date as its own obligation key');
select ok(to_char(public._erp_statement_nightly_due_at('2011-12-30','Pacific/Apia') at time zone 'Pacific/Apia','YYYY-MM-DD HH24:MI')='2011-12-31 00:00'
  and to_char(public._erp_statement_nightly_due_at('2026-03-29','Europe/Paris') at time zone 'Europe/Paris','YYYY-MM-DD HH24:MI')='2026-03-29 03:00',
 'AC-NS-004 resolver returns the first available local instant, not merely a matching date');
select is(public._erp_statement_nightly_due_at('2026-01-15','UTC'),('2026-01-15'::date::timestamp+interval '2 hours') at time zone 'UTC',
 'AC-NS-004 the 02:00 boundary is inclusive and derived from the local date');
set local timezone='Asia/Tokyo';
select is(public._erp_statement_nightly_due_at('2026-01-15','UTC'),'2026-01-15 02:00:00+00'::timestamptz,
 'AC-NS-004 resolver is independent of the session timezone');
set local timezone='Pacific/Kiritimati';
select is(public._erp_statement_nightly_due_at('2026-01-15','Asia/Jakarta'),'2026-01-14 19:00:00+00'::timestamptz,
 'AC-NS-004 resolver conversion is independent of a second session timezone');
set local timezone='UTC';
select throws_ok($q$select public._erp_statement_nightly_due_at('2026-01-15','Not/AZone')$q$,'22023',null,
 'AC-NS-004 resolver rejects an unknown timezone name');
select throws_ok($q$select public._erp_statement_nightly_due_at(null,'UTC')$q$,'22023',null,
 'AC-NS-004 resolver rejects a null local date');
select throws_ok($q$select public._erp_statement_nightly_due_at('2026-01-15',null)$q$,'22023',null,
 'AC-NS-004 resolver rejects a null timezone');
select ok((select provolatile='s' from pg_proc where oid='public._erp_statement_nightly_due_at(date,text)'::regprocedure),
 'AC-NS-004 resolver is stable');

-- ── Catalog and privilege contract ───────────────────────────────────────────────────────────────
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='public.erp_statement_nightly_obligation'::regclass),
 'AC-NS-004 nightly obligations are forced-RLS');
select ok(not exists(select 1 from pg_policy where polrelid='public.erp_statement_nightly_obligation'::regclass),
 'AC-NS-004 nightly obligations add no ordinary policy');
select is((select string_agg(a.attname,',' order by a.attnum)
  from pg_constraint c cross join lateral unnest(c.conkey) k(attnum)
  join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum
  where c.conrelid='public.erp_statement_nightly_obligation'::regclass and c.contype='p'),
 'org_id,local_date','AC-NS-004 the primary key is the organization and the organization-local date');
select throws_ok($q$insert into public.erp_statement_nightly_obligation(org_id,local_date,timezone,due_at,published_generation,completed_at)
  values ('06440000-0000-0000-0000-000000000001','2099-01-01','UTC','2099-01-01 02:00:00+00'::timestamptz,'06440000-0000-0000-0000-0000000000aa',null)$q$,'23514',null,
 'AC-NS-004 a published generation without a completion instant is rejected');
select throws_ok($q$insert into public.erp_statement_nightly_obligation(org_id,local_date,timezone,due_at,published_generation,completed_at)
  values ('06440000-0000-0000-0000-000000000001','2099-01-01','UTC','2099-01-01 02:00:00+00'::timestamptz,null,clock_timestamp())$q$,'23514',null,
 'AC-NS-004 a completion instant without a published generation is rejected');
select throws_ok($q$insert into public.erp_statement_nightly_obligation(org_id,local_date,timezone,due_at)
  values ('06440000-0000-0000-0000-000000000001','2099-01-01','  ','2099-01-01 02:00:00+00'::timestamptz)$q$,'23514',null,
 'AC-NS-004 a blank scheduling timezone is rejected');
insert into public.erp_statement_nightly_obligation(org_id,local_date,timezone,due_at) values
 ('06440000-0000-0000-0000-000000000001','1900-01-01','UTC','1900-01-01 02:00:00+00'::timestamptz);
select throws_ok($q$insert into public.erp_statement_nightly_obligation(org_id,local_date,timezone,due_at)
  values ('06440000-0000-0000-0000-000000000001','1900-01-01','UTC','1900-01-01 02:00:00+00'::timestamptz)$q$,'23505',null,
 'AC-NS-004 an organization-local date can exist only once');
delete from public.erp_statement_nightly_obligation where local_date='1900-01-01';
select ok(has_table_privilege('service_role','public.erp_statement_nightly_obligation','SELECT')
  and not has_table_privilege('service_role','public.erp_statement_nightly_obligation','INSERT')
  and not has_table_privilege('service_role','public.erp_statement_nightly_obligation','UPDATE')
  and not has_table_privilege('service_role','public.erp_statement_nightly_obligation','DELETE')
  and not has_table_privilege('service_role','public.erp_statement_nightly_obligation','TRUNCATE'),
 'AC-NS-004 service reads obligations and every write goes through the fenced RPCs');
select ok(not exists(
  select 1 from unnest(array['anon','authenticated']) r(role_name)
  cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) p(privilege_name)
  where has_table_privilege(r.role_name,'public.erp_statement_nightly_obligation',p.privilege_name)),
 'AC-NS-004 ordinary roles hold no obligation privilege');
select ok(not exists(
  select 1 from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
  where c.oid='public.erp_statement_nightly_obligation'::regclass and a.grantee=0),
 'AC-NS-004 PUBLIC holds no direct obligation privilege');
select ok((select bool_and(prosecdef and proowner='postgres'::regrole and proconfig @> array['search_path=public, pg_temp'])
  from pg_proc where oid in ('public.record_erp_statement_nightly_due(uuid,uuid,uuid,timestamptz)'::regprocedure,
    'public.request_erp_statement_manual_intent(uuid,uuid,uuid,timestamptz)'::regprocedure,
    'public._erp_statement_nightly_due_at(date,text)'::regprocedure)),
 'AC-NS-004 nightly writers are postgres-owned fixed-path definers');
select ok(has_function_privilege('service_role','public.record_erp_statement_nightly_due(uuid,uuid,uuid,timestamptz)','execute')
  and has_function_privilege('service_role','public.request_erp_statement_manual_intent(uuid,uuid,uuid,timestamptz)','execute')
  and not has_function_privilege('service_role','public._erp_statement_nightly_due_at(date,text)','execute'),
 'AC-NS-005 only the two nightly entry points are service-executable');
select ok(not exists(
  select 1 from unnest(array['anon','authenticated']) r(role_name)
  cross join unnest(array['public.record_erp_statement_nightly_due(uuid,uuid,uuid,timestamptz)',
                         'public.request_erp_statement_manual_intent(uuid,uuid,uuid,timestamptz)',
                         'public._erp_statement_nightly_due_at(date,text)']) f(signature)
  where has_function_privilege(r.role_name,f.signature,'execute')),
 'AC-NS-004 no user role can execute any nightly surface');
select ok(not exists(
  select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
  where p.oid in ('public.record_erp_statement_nightly_due(uuid,uuid,uuid,timestamptz)'::regprocedure,
    'public.request_erp_statement_manual_intent(uuid,uuid,uuid,timestamptz)'::regprocedure,
    'public._erp_statement_nightly_due_at(date,text)'::regprocedure)
   and a.grantee=0 and a.privilege_type='EXECUTE'),
 'AC-NS-004 PUBLIC holds no execute on any nightly surface');

-- ── Nightly materialization: bounded catch-up, durable cursor, frozen provenance ─────────────────
-- Every date is anchored to the first organization-local date that is still in the future, so the
-- expectations below hold on both sides of the 02:00 boundary rather than only before it.
update public.erp_statement_change_state set next_nightly_date=(select first_future-40 from fixture_clock)
 where org_id='06440000-0000-0000-0000-000000000001';
create temporary table nightly_state_before as select * from public.erp_statement_change_state
 where org_id='06440000-0000-0000-0000-000000000001';
set local role service_role;
delete from payload;
insert into payload select public.record_erp_statement_nightly_due('06440000-0000-0000-0000-000000000001','06440000-0000-0000-0000-000000000101','06440000-0000-0000-0000-000000000011','2026-10-18T09:00:00Z');
select is((select result->>'status' from payload),'recorded','AC-NS-004 an enabled organization records due dates');
select is((select result->>'inserted' from payload),'31','AC-NS-004 a single call materializes at most 31 dates');
select is((select result->>'next_nightly_date' from payload),(select (first_future-9)::text from fixture_clock),
 'AC-NS-004 the durable cursor advances only across verified dates');
select is((select result->>'more_due' from payload),'true','AC-NS-004 a bound-limited catch-up reports more due');
select ok((select count(*)=31 from public.erp_statement_nightly_obligation where org_id='06440000-0000-0000-0000-000000000001'),
 'AC-NS-004 exactly the bounded number of obligations exists');
select ok((select bool_and(timezone='UTC' and due_at=(local_date::timestamp+interval '2 hours') at time zone 'UTC')
  from public.erp_statement_nightly_obligation where org_id='06440000-0000-0000-0000-000000000001'),
 'AC-NS-004 each materialized date freezes its own scheduling instant and timezone');
reset role;
select ok((select (to_jsonb(s)-'next_nightly_date') is not distinct from (to_jsonb(b)-'next_nightly_date')
  from public.erp_statement_change_state s cross join nightly_state_before b where s.org_id=b.org_id),
 'AC-NS-004 nightly recording changes nothing but the nightly cursor');
set local role service_role;
delete from payload;
insert into payload select public.record_erp_statement_nightly_due('06440000-0000-0000-0000-000000000001','06440000-0000-0000-0000-000000000101','06440000-0000-0000-0000-000000000011','2026-10-18T09:00:00Z');
select is((select result->>'inserted' from payload),'9','AC-NS-004 a later tick finishes the remaining catch-up dates');
select is((select result->>'next_nightly_date' from payload),(select first_future::text from fixture_clock),
 'AC-NS-004 the cursor reaches the first not-yet-due organization-local date');
select ok((select count(*)=40 and count(distinct local_date)=40
  and min(local_date)=(select first_future-40 from fixture_clock) and max(local_date)=(select first_future-1 from fixture_clock)
  from public.erp_statement_nightly_obligation where org_id='06440000-0000-0000-0000-000000000001'),
 'AC-NS-004 the 40 missed dates materialize contiguously without gaps or duplicates');
select ok((select count(published_generation)=0 and count(completed_at)=0
  from public.erp_statement_nightly_obligation where org_id='06440000-0000-0000-0000-000000000001'),
 'AC-NS-004 no completion receipt is claimed by the recording path');
reset role;
update public.erp_statement_change_state set next_nightly_date=(select first_future-40 from fixture_clock)
 where org_id='06440000-0000-0000-0000-000000000001';
set local role service_role;
delete from payload;
insert into payload select public.record_erp_statement_nightly_due('06440000-0000-0000-0000-000000000001','06440000-0000-0000-0000-000000000101','06440000-0000-0000-0000-000000000011','2026-10-18T09:00:00Z');
select ok((select (result->>'inserted')='0' and (result->>'next_nightly_date')=(select (first_future-9)::text from fixture_clock) from payload),
 'AC-NS-004 a restart over already-materialized dates inserts nothing and keeps the cursor durable');
reset role;
select ok((select count(*)=40 from public.erp_statement_nightly_obligation where org_id='06440000-0000-0000-0000-000000000001'),
 'AC-NS-004 replaying the same range does not duplicate obligations');
update public.erp_statement_change_state set next_nightly_date=(select first_future from fixture_clock)
 where org_id='06440000-0000-0000-0000-000000000001';
set local role service_role;
delete from payload;
insert into payload select public.record_erp_statement_nightly_due('06440000-0000-0000-0000-000000000001','06440000-0000-0000-0000-000000000101','06440000-0000-0000-0000-000000000011','2026-10-18T09:00:00Z');
select ok((select (result->>'status')='recorded' and (result->>'inserted')='0'
  and (result->>'next_nightly_date')=(select first_future::text from fixture_clock)
  and (result->>'more_due')='false' from payload),
 'AC-NS-004 a not-yet-due cursor records nothing and does not advance');

-- A timezone change freezes materialized provenance and only affects newly materialized dates.
reset role;
update public.organizations set default_timezone='Asia/Jakarta' where id='06440000-0000-0000-0000-000000000001';
set local role service_role;
select is(public.sync_erp_statement_change_scope('06440000-0000-0000-0000-000000000001','06440000-0000-0000-0000-000000000101','06440000-0000-0000-0000-000000000011','2026-10-18T09:00:00Z')->>'status','scope_changed',
 'AC-NS-004 a scheduling timezone change rotates the local scope');
reset role;
select ok((select bool_and(timezone='UTC' and due_at=(local_date::timestamp+interval '2 hours') at time zone 'UTC')
  from public.erp_statement_nightly_obligation where org_id='06440000-0000-0000-0000-000000000001'),
 'AC-NS-004 a timezone change never rewrites existing frozen obligations');
-- An independently owned FUTURE stop row on the frontier keeps both replays bounded to the materialized
-- range at every hour of the day: without it, between 19:00Z and 02:00Z the frontier's own Jakarta
-- instant is already due and a correct RPC would materialize it (inserted = 1), which is not what these
-- two assertions are about.
insert into public.erp_statement_nightly_obligation(org_id,local_date,timezone,due_at)
 values ('06440000-0000-0000-0000-000000000001',(select first_future from fixture_clock),'Asia/Jakarta',
  clock_timestamp()+interval '3 days');
update public.erp_statement_change_state set next_nightly_date=(select first_future-40 from fixture_clock)
 where org_id='06440000-0000-0000-0000-000000000001';
set local role service_role;
delete from payload;
insert into payload select public.record_erp_statement_nightly_due('06440000-0000-0000-0000-000000000001','06440000-0000-0000-0000-000000000101','06440000-0000-0000-0000-000000000011','2026-10-18T09:00:00Z');
select ok((select (result->>'inserted')='0' and (result->>'next_nightly_date')=(select (first_future-9)::text from fixture_clock) from payload),
 'AC-NS-004 an existing date is reused by its own frozen instant, never recalculated');
delete from payload;
insert into payload select public.record_erp_statement_nightly_due('06440000-0000-0000-0000-000000000001','06440000-0000-0000-0000-000000000101','06440000-0000-0000-0000-000000000011','2026-10-18T09:00:00Z');
select ok((select (result->>'inserted')='0' and (result->>'next_nightly_date')=(select first_future::text from fixture_clock) from payload),
 'AC-NS-004 every already-materialized date is still reused under the new timezone');
reset role;
select ok((select bool_and(timezone='UTC' and due_at=(local_date::timestamp+interval '2 hours') at time zone 'UTC')
  from public.erp_statement_nightly_obligation where org_id='06440000-0000-0000-0000-000000000001'
   and local_date<=(select first_future-1 from fixture_clock)),
 'AC-NS-004 replaying existing dates never rewrites their frozen provenance');
-- The stop row exists only for the two replays above; remove it before the next independent oracle.
delete from public.erp_statement_nightly_obligation
 where org_id='06440000-0000-0000-0000-000000000001' and local_date>=(select first_future from fixture_clock);

-- An existing date whose FROZEN instant is still in the future must be evaluated on that instant.
-- The current timezone would call the same date due, so recalculating instead of reusing the frozen
-- row advances the cursor; this oracle is independent of the wall clock.
reset role;
update public.erp_statement_nightly_obligation
   set due_at=clock_timestamp()+interval '3 days'
 where org_id='06440000-0000-0000-0000-000000000001' and local_date=(select first_future-1 from fixture_clock);
update public.erp_statement_change_state set next_nightly_date=(select first_future-1 from fixture_clock)
 where org_id='06440000-0000-0000-0000-000000000001';
set local role service_role;
delete from payload;
insert into payload select public.record_erp_statement_nightly_due('06440000-0000-0000-0000-000000000001','06440000-0000-0000-0000-000000000101','06440000-0000-0000-0000-000000000011','2026-10-18T09:00:00Z');
select ok((select (result->>'inserted')='0'
  and (result->>'next_nightly_date')=(select (first_future-1)::text from fixture_clock)
  and (result->>'more_due')='false' from payload),
 'AC-NS-004 an existing date whose frozen instant is still in the future is evaluated on that instant, not recalculated');
-- Independent oracles: whatever that call did beyond the probe date is discarded and the cursor pinned,
-- so the next case cannot inherit its side effects (a mutant that advances the cursor must not cascade).
reset role;
delete from public.erp_statement_nightly_obligation
 where org_id='06440000-0000-0000-0000-000000000001' and local_date>(select first_future-1 from fixture_clock);
update public.erp_statement_change_state set next_nightly_date=(select first_future-1 from fixture_clock)
 where org_id='06440000-0000-0000-0000-000000000001';

-- Exactly one newly materialized date: the target date is due and unmaterialized, and the FOLLOWING
-- date is pinned to a future instant, so the bounded loop stops after the target at every hour of the
-- day (a following date that happens to be due too could otherwise be materialized in the same call).
reset role;
delete from public.erp_statement_nightly_obligation
 where org_id='06440000-0000-0000-0000-000000000001' and local_date>=(select first_future-1 from fixture_clock);
insert into public.erp_statement_nightly_obligation(org_id,local_date,timezone,due_at)
 values ('06440000-0000-0000-0000-000000000001',(select first_future from fixture_clock),'Asia/Jakarta',
  clock_timestamp()+interval '3 days');
update public.erp_statement_change_state set next_nightly_date=(select first_future-1 from fixture_clock)
 where org_id='06440000-0000-0000-0000-000000000001';
set local role service_role;
delete from payload;
insert into payload select public.record_erp_statement_nightly_due('06440000-0000-0000-0000-000000000001','06440000-0000-0000-0000-000000000101','06440000-0000-0000-0000-000000000011','2026-10-18T09:00:00Z');
select ok((select result->>'inserted'='1' from payload),
 'AC-NS-004 a newly materialized date uses the current organization timezone');
reset role;
select ok((select timezone='Asia/Jakarta' and due_at=(local_date::timestamp+interval '2 hours') at time zone 'Asia/Jakarta'
  from public.erp_statement_nightly_obligation where org_id='06440000-0000-0000-0000-000000000001'
   and local_date=(select first_future-1 from fixture_clock)),
 'AC-NS-004 the new date freezes the Jakarta 02:00 instant');
-- Remove the stop row and any further date, then pin the cursor, so later assertions stay independent.
delete from public.erp_statement_nightly_obligation
 where org_id='06440000-0000-0000-0000-000000000001' and local_date>=(select first_future from fixture_clock);
update public.erp_statement_change_state set next_nightly_date=(select first_future from fixture_clock)
 where org_id='06440000-0000-0000-0000-000000000001';
-- A disabled organization records nothing.
reset role;
update public.erp_statement_change_state set enabled=false where org_id='06440000-0000-0000-0000-000000000002';
set local role service_role;
delete from payload;
insert into payload select public.record_erp_statement_nightly_due('06440000-0000-0000-0000-000000000002','06440000-0000-0000-0000-000000000102','06440000-0000-0000-0000-000000000012','2026-10-18T09:00:00Z');
select is((select result from payload),'{"status": "disabled"}'::jsonb,'AC-NS-004 an explicitly disabled organization records nothing');
reset role;
select ok(not exists(select 1 from public.erp_statement_nightly_obligation where org_id='06440000-0000-0000-0000-000000000002'),
 'AC-NS-004 a disabled organization gains no obligation');
-- The session timezone cannot influence the recorded schedule.
update public.erp_statement_change_state set next_nightly_date=(select first_future+3 from fixture_clock)
 where org_id='06440000-0000-0000-0000-000000000001';
set local timezone='Asia/Tokyo';
set local role service_role;
delete from payload;
insert into payload select public.record_erp_statement_nightly_due('06440000-0000-0000-0000-000000000001','06440000-0000-0000-0000-000000000101','06440000-0000-0000-0000-000000000011','2026-10-18T09:00:00Z');
select ok((select (result->>'inserted')='0' and (result->>'next_nightly_date')=(select (first_future+3)::text from fixture_clock) from payload),
 'AC-NS-004 the nightly result is independent of the session timezone');
set local timezone='UTC';

-- ── Internal manual intent: one accepted request per rolling five minutes ────────────────────────
reset role;
update public.erp_statement_change_state
 set intent_revision=0,intent_acked=0,intent_scope_floor=0,last_manual_at=null
 where org_id='06440000-0000-0000-0000-000000000001';
create temporary table manual_state_before as select * from public.erp_statement_change_state
 where org_id='06440000-0000-0000-0000-000000000001';
set local role service_role;
delete from payload;
insert into payload select public.request_erp_statement_manual_intent('06440000-0000-0000-0000-000000000001','06440000-0000-0000-0000-000000000101','06440000-0000-0000-0000-000000000011','2026-10-18T09:00:00Z');
select is((select result->>'status' from payload),'accepted','AC-NS-005 the first manual intent is accepted');
select is((select result->>'intent_revision' from payload),'1','AC-NS-005 an accepted intent increments the revision by exactly one');
select ok((select (result->>'manual_available_at') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$' from payload),
 'AC-NS-005 the availability instant is a UTC microsecond string');
select ok((select ((result->>'manual_available_at')::timestamptz) > clock_timestamp()+interval '4 minutes 59 seconds'
  and ((result->>'manual_available_at')::timestamptz) <= clock_timestamp()+interval '5 minutes' from payload),
 'AC-NS-005 the accepted availability instant is the accepted instant plus five minutes');
reset role;
select ok((select (to_jsonb(s)-array['intent_revision','last_manual_at']) is not distinct from
                           (to_jsonb(b)-array['intent_revision','last_manual_at'])
  from public.erp_statement_change_state s cross join manual_state_before b where s.org_id=b.org_id),
 'AC-NS-005 an accepted intent touches only the revision and the quota instant');
reset role;
create temporary table coalesced_quota_before as select last_manual_at from public.erp_statement_change_state
 where org_id='06440000-0000-0000-0000-000000000001';
set local role service_role;
delete from payload;
insert into payload select public.request_erp_statement_manual_intent('06440000-0000-0000-0000-000000000001','06440000-0000-0000-0000-000000000101','06440000-0000-0000-0000-000000000011','2026-10-18T09:00:00Z');
select is((select result->>'status' from payload),'coalesced','AC-NS-005 a repeat request inside the quota coalesces');
select ok((select (result->>'intent_revision')='1' from payload),
 'AC-NS-005 a coalesced request does not increment the revision');
reset role;
select ok((select s.last_manual_at is not distinct from c.last_manual_at
  from public.erp_statement_change_state s cross join coalesced_quota_before c
  where s.org_id='06440000-0000-0000-0000-000000000001'),
 'AC-NS-005 the coalesced branch leaves the quota instant untouched');
update public.erp_statement_change_state set last_manual_at=clock_timestamp()-interval '4 minutes 59 seconds'
 where org_id='06440000-0000-0000-0000-000000000001';
create temporary table manual_quota_from as select last_manual_at from public.erp_statement_change_state
 where org_id='06440000-0000-0000-0000-000000000001';
set local role service_role;
delete from payload;
insert into payload select public.request_erp_statement_manual_intent('06440000-0000-0000-0000-000000000001','06440000-0000-0000-0000-000000000101','06440000-0000-0000-0000-000000000011','2026-10-18T09:00:00Z');
select is((select result->>'status' from payload),'coalesced','AC-NS-005 a request 4m59s after acceptance still coalesces');
reset role;
select ok((select ((result->>'manual_available_at')::timestamptz)
   = (select last_manual_at from manual_quota_from)+interval '5 minutes' from payload),
 'AC-NS-005 the coalesced availability instant is the stored quota instant plus five minutes');
reset role;
update public.erp_statement_change_state set last_manual_at=clock_timestamp()-interval '5 minutes 1 second'
 where org_id='06440000-0000-0000-0000-000000000001';
set local role service_role;
delete from payload;
insert into payload select public.request_erp_statement_manual_intent('06440000-0000-0000-0000-000000000001','06440000-0000-0000-0000-000000000101','06440000-0000-0000-0000-000000000011','2026-10-18T09:00:00Z');
select ok((select (result->>'status')='accepted' and (result->>'intent_revision')='2' from payload),
 'AC-NS-005 a request 5m01s after acceptance is accepted and increments again');
reset role;
update public.erp_statement_change_state set last_manual_at=clock_timestamp()-interval '5 minutes'
 where org_id='06440000-0000-0000-0000-000000000001';
set local role service_role;
delete from payload;
insert into payload select public.request_erp_statement_manual_intent('06440000-0000-0000-0000-000000000001','06440000-0000-0000-0000-000000000101','06440000-0000-0000-0000-000000000011','2026-10-18T09:00:00Z');
select ok((select (result->>'status')='accepted' and (result->>'intent_revision')='3' from payload),
 'AC-NS-005 the inclusive five-minute boundary accepts');
-- A revision beyond the JavaScript safe integer range is carried as a decimal string.
reset role;
update public.erp_statement_change_state set intent_revision=9007199254740991,last_manual_at=null
 where org_id='06440000-0000-0000-0000-000000000001';
set local role service_role;
delete from payload;
insert into payload select public.request_erp_statement_manual_intent('06440000-0000-0000-0000-000000000001','06440000-0000-0000-0000-000000000101','06440000-0000-0000-0000-000000000011','2026-10-18T09:00:00Z');
select ok((select jsonb_typeof(result->'intent_revision')='string' and (result->>'intent_revision')::bigint=9007199254740992 from payload),
 'AC-NS-005 a revision beyond the JavaScript safe integer stays an exact decimal string');
-- Scope rotation retains both the quota and the revision.
reset role;
update public.external_org_bindings set config='{"company":"Nightly A rotated","project_map":{}}'
 where id='06440000-0000-0000-0000-000000000011';
create temporary table quota_across_sync as select intent_revision,last_manual_at from public.erp_statement_change_state
 where org_id='06440000-0000-0000-0000-000000000001';
set local role service_role;
select is(public.sync_erp_statement_change_scope('06440000-0000-0000-0000-000000000001','06440000-0000-0000-0000-000000000101','06440000-0000-0000-0000-000000000011','2026-10-18T09:00:00Z')->>'status','scope_changed',
 'AC-NS-005 a local context change rotates the scope');
reset role;
select ok((select s.intent_revision=q.intent_revision and s.last_manual_at=q.last_manual_at
  from public.erp_statement_change_state s cross join quota_across_sync q
  where s.org_id='06440000-0000-0000-0000-000000000001'),
 'AC-NS-005 a scope rotation cannot erase the manual quota or the revision');
set local role service_role;
delete from payload;
insert into payload select public.request_erp_statement_manual_intent('06440000-0000-0000-0000-000000000001','06440000-0000-0000-0000-000000000101','06440000-0000-0000-0000-000000000011','2026-10-18T09:00:00Z');
select is((select result->>'status' from payload),'coalesced','AC-NS-005 the retained quota still coalesces after a scope rotation');
-- Disabled organization refuses without mutating.
reset role;
update public.erp_statement_change_state set enabled=false where org_id='06440000-0000-0000-0000-000000000002';
create temporary table disabled_state_before as select * from public.erp_statement_change_state
 where org_id='06440000-0000-0000-0000-000000000002';
set local role service_role;
delete from payload;
insert into payload select public.request_erp_statement_manual_intent('06440000-0000-0000-0000-000000000002','06440000-0000-0000-0000-000000000102','06440000-0000-0000-0000-000000000012','2026-10-18T09:00:00Z');
select is((select result from payload),'{"status": "disabled"}'::jsonb,'AC-NS-005 a disabled organization accepts no manual intent');
reset role;
select ok((select to_jsonb(s) is not distinct from to_jsonb(b) from public.erp_statement_change_state s
  cross join disabled_state_before b where s.org_id=b.org_id),
 'AC-NS-005 a disabled manual request changes no state');

-- ── Late expiry: the final lease check rolls the whole mutation back, with a witness ─────────────
-- The witness sleeps only on its FIRST firing, so a bounded catch-up over an old cursor cannot
-- multiply the delay; the mutation under test is still reached and still rolls back.
create temporary table delay_seen(done boolean not null default true);
create temporary sequence delay_0644_nightly;
grant usage,select on sequence delay_0644_nightly to service_role;
grant select,insert on delay_seen to service_role;
create function pg_temp.delay_0644_nightly() returns trigger language plpgsql as
$$ begin
  if not exists(select 1 from delay_seen) then
    insert into delay_seen default values;
    perform nextval('pg_temp.delay_0644_nightly');
    perform pg_sleep(0.4);
  end if;
  return new;
 end $$;
create trigger delay_0644_nightly before insert on public.erp_statement_nightly_obligation
 for each row execute function pg_temp.delay_0644_nightly();
-- A genuinely due date that is currently NOT materialized: the fixture deletes an existing row, so the
-- pending insert is real and the late-expiry guard is actually exercised.
delete from public.erp_statement_nightly_obligation
 where org_id='06440000-0000-0000-0000-000000000001' and local_date=(select first_future-20 from fixture_clock);
update public.erp_statement_change_state set next_nightly_date=(select first_future-20 from fixture_clock)
 where org_id='06440000-0000-0000-0000-000000000001';
create temporary table pre_nightly_expiry as select * from public.erp_statement_change_state
 where org_id='06440000-0000-0000-0000-000000000001';
update public.erp_sweep_lock set locked_until=clock_timestamp()+interval '0.2 seconds'
 where org_id='06440000-0000-0000-0000-000000000001';
set local role service_role;
select throws_ok($q$do $probe$ begin perform public.record_erp_statement_nightly_due('06440000-0000-0000-0000-000000000001','06440000-0000-0000-0000-000000000101','06440000-0000-0000-0000-000000000011','2026-10-18T09:00:00Z'); raise exception 'unexpected success' using errcode='P0001'; end; $probe$$q$,'55000',null,
 'AC-NS-004 a lease that expires after the nightly mutation rolls the transaction back');
select ok((select is_called from delay_0644_nightly),
 'AC-NS-004 the late-expiry witness proves the nightly mutation was reached');
select ok(not exists(select 1 from public.erp_statement_nightly_obligation
  where org_id='06440000-0000-0000-0000-000000000001' and local_date=(select first_future-20 from fixture_clock)),
 'AC-NS-004 the rolled-back nightly obligation is absent');
reset role;
select ok((select to_jsonb(s) is not distinct from to_jsonb(b) from public.erp_statement_change_state s
  cross join pre_nightly_expiry b where s.org_id=b.org_id),
 'AC-NS-004 late expiry leaves the nightly cursor and every other field unchanged');
drop trigger delay_0644_nightly on public.erp_statement_nightly_obligation;
update public.erp_sweep_lock set locked_until=clock_timestamp()+interval '60 minutes'
 where org_id='06440000-0000-0000-0000-000000000001';

-- The quota instant is cleared BEFORE the witness trigger exists, so the witness can only be
-- advanced by the mutation under test.
update public.erp_statement_change_state set last_manual_at=null
 where org_id='06440000-0000-0000-0000-000000000001';
create temporary sequence delay_0644_manual;
grant usage,select on sequence delay_0644_manual to service_role;
create function pg_temp.delay_0644_manual() returns trigger language plpgsql as
$$ begin perform nextval('pg_temp.delay_0644_manual'); perform pg_sleep(0.4); return new; end $$;
create trigger delay_0644_manual before update on public.erp_statement_change_state
 for each row execute function pg_temp.delay_0644_manual();
create temporary table pre_manual_expiry as select * from public.erp_statement_change_state
 where org_id='06440000-0000-0000-0000-000000000001';
update public.erp_sweep_lock set locked_until=clock_timestamp()+interval '0.2 seconds'
 where org_id='06440000-0000-0000-0000-000000000001';
set local role service_role;
select throws_ok($q$do $probe$ begin perform public.request_erp_statement_manual_intent('06440000-0000-0000-0000-000000000001','06440000-0000-0000-0000-000000000101','06440000-0000-0000-0000-000000000011','2026-10-18T09:00:00Z'); raise exception 'unexpected success' using errcode='P0001'; end; $probe$$q$,'55000',null,
 'AC-NS-005 a lease that expires after the manual mutation rolls the transaction back');
select ok((select is_called from delay_0644_manual),
 'AC-NS-005 the late-expiry witness proves the manual mutation was reached');
reset role;
select ok((select to_jsonb(s) is not distinct from to_jsonb(b) from public.erp_statement_change_state s
  cross join pre_manual_expiry b where s.org_id=b.org_id),
 'AC-NS-005 late expiry leaves the intent revision and the quota instant unchanged');
drop trigger delay_0644_manual on public.erp_statement_change_state;
update public.erp_sweep_lock set locked_until=clock_timestamp()+interval '60 minutes'
 where org_id='06440000-0000-0000-0000-000000000001';

-- ── Scope, lease and identity fences: every rejection must be side-effect free ──────────────────
create temporary table rejection_rows_before as select count(*) as n from public.erp_statement_nightly_obligation
 where org_id='06440000-0000-0000-0000-000000000001';
set local role service_role;
select throws_ok($q$do $probe$ begin perform public.record_erp_statement_nightly_due('06440000-0000-0000-0000-000000000002','06440000-0000-0000-0000-000000000101','06440000-0000-0000-0000-000000000011','2026-10-18T09:00:00Z'); raise exception 'unexpected success' using errcode='P0001'; end; $probe$$q$,'55000',null,
 'AC-NS-004 a foreign organization id is rejected before any write');
select throws_ok($q$do $probe$ begin perform public.record_erp_statement_nightly_due('06440000-0000-0000-0000-000000000001','06440000-0000-0000-0000-000000000102','06440000-0000-0000-0000-000000000011','2026-10-18T09:00:00Z'); raise exception 'unexpected success' using errcode='P0001'; end; $probe$$q$,'55000',null,
 'AC-NS-004 a stale lease holder is rejected');
select throws_ok($q$do $probe$ begin perform public.record_erp_statement_nightly_due('06440000-0000-0000-0000-000000000001','06440000-0000-0000-0000-000000000101','06440000-0000-0000-0000-000000000012','2026-10-18T09:00:00Z'); raise exception 'unexpected success' using errcode='P0001'; end; $probe$$q$,'55000',null,
 'AC-NS-004 a cross-organization binding is rejected');
select throws_ok($q$do $probe$ begin perform public.record_erp_statement_nightly_due('06440000-0000-0000-0000-000000000001','06440000-0000-0000-0000-000000000101','06440000-0000-0000-0000-000000000011','2026-10-19T09:00:00Z'); raise exception 'unexpected success' using errcode='P0001'; end; $probe$$q$,'55000',null,
 'AC-NS-004 a stale activation instant is rejected');
select throws_ok($q$do $probe$ begin perform public.record_erp_statement_nightly_due(null,null,null,null); raise exception 'unexpected success' using errcode='P0001'; end; $probe$$q$,'22023',null,
 'AC-NS-004 null scope inputs are rejected by the shared prefix');
select throws_ok($q$do $probe$ begin perform public.request_erp_statement_manual_intent('06440000-0000-0000-0000-000000000001','06440000-0000-0000-0000-000000000102','06440000-0000-0000-0000-000000000011','2026-10-18T09:00:00Z'); raise exception 'unexpected success' using errcode='P0001'; end; $probe$$q$,'55000',null,
 'AC-NS-005 a stale lease holder cannot record a manual intent');
select throws_ok($q$do $probe$ begin perform public.request_erp_statement_manual_intent(null,null,null,null); raise exception 'unexpected success' using errcode='P0001'; end; $probe$$q$,'22023',null,
 'AC-NS-005 null manual scope inputs are rejected');
reset role;

-- A local context change that has not been synced is a stale scope.
update public.external_org_bindings set config='{"company":"Nightly A renamed","project_map":{}}'
 where id='06440000-0000-0000-0000-000000000011';
set local role service_role;
select throws_ok($q$do $probe$ begin perform public.record_erp_statement_nightly_due('06440000-0000-0000-0000-000000000001','06440000-0000-0000-0000-000000000101','06440000-0000-0000-0000-000000000011','2026-10-18T09:00:00Z'); raise exception 'unexpected success' using errcode='P0001'; end; $probe$$q$,'55000',null,
 'AC-NS-004 an unsynced local context change requires a scope sync first');
select throws_ok($q$do $probe$ begin perform public.request_erp_statement_manual_intent('06440000-0000-0000-0000-000000000001','06440000-0000-0000-0000-000000000101','06440000-0000-0000-0000-000000000011','2026-10-18T09:00:00Z'); raise exception 'unexpected success' using errcode='P0001'; end; $probe$$q$,'55000',null,
 'AC-NS-005 an unsynced local context change requires a scope sync first');
select is(public.sync_erp_statement_change_scope('06440000-0000-0000-0000-000000000001','06440000-0000-0000-0000-000000000101','06440000-0000-0000-0000-000000000011','2026-10-18T09:00:00Z')->>'status','scope_changed',
 'AC-NS-004 a renamed company rotates the scope');
reset role;
select ok((select count(*)=(select n from rejection_rows_before) from public.erp_statement_nightly_obligation
  where org_id='06440000-0000-0000-0000-000000000001'),
 'AC-NS-004 every rejected nightly call left the obligation set unchanged');

-- A disconnected binding stays readable but may not collect.
update public.external_org_bindings set status='disconnected' where id='06440000-0000-0000-0000-000000000011';
set local role service_role;
select throws_ok($q$do $probe$ begin perform public.record_erp_statement_nightly_due('06440000-0000-0000-0000-000000000001','06440000-0000-0000-0000-000000000101','06440000-0000-0000-0000-000000000011','2026-10-18T09:00:00Z'); raise exception 'unexpected success' using errcode='P0001'; end; $probe$$q$,'55000',null,
 'AC-NS-004 a disconnected binding cannot record nightly work');
reset role;
update public.external_org_bindings set status='active' where id='06440000-0000-0000-0000-000000000011';

-- Binding rotation: the old activation is refused, the new one records, obligations survive.
update public.external_org_bindings set activated_at='2026-10-19T09:00:00Z'
 where id='06440000-0000-0000-0000-000000000011';
set local role service_role;
select throws_ok($q$do $probe$ begin perform public.sync_erp_statement_change_scope('06440000-0000-0000-0000-000000000001','06440000-0000-0000-0000-000000000101','06440000-0000-0000-0000-000000000011','2026-10-18T09:00:00Z'); raise exception 'unexpected success' using errcode='P0001'; end; $probe$$q$,'55000',null,
 'AC-NS-004 the superseded activation cannot synchronize');
select is(public.sync_erp_statement_change_scope('06440000-0000-0000-0000-000000000001','06440000-0000-0000-0000-000000000101','06440000-0000-0000-0000-000000000011','2026-10-19T09:00:00Z')->>'status','scope_changed',
 'AC-NS-004 a genuine activation replacement rotates the scope');
select throws_ok($q$do $probe$ begin perform public.record_erp_statement_nightly_due('06440000-0000-0000-0000-000000000001','06440000-0000-0000-0000-000000000101','06440000-0000-0000-0000-000000000011','2026-10-18T09:00:00Z'); raise exception 'unexpected success' using errcode='P0001'; end; $probe$$q$,'55000',null,
 'AC-NS-004 the superseded activation cannot record nightly work');
select throws_ok($q$do $probe$ begin perform public.request_erp_statement_manual_intent('06440000-0000-0000-0000-000000000001','06440000-0000-0000-0000-000000000101','06440000-0000-0000-0000-000000000011','2026-10-18T09:00:00Z'); raise exception 'unexpected success' using errcode='P0001'; end; $probe$$q$,'55000',null,
 'AC-NS-005 the superseded activation cannot record a manual intent');
reset role;
update public.erp_statement_change_state set next_nightly_date=(select first_future from fixture_clock)+6
 where org_id='06440000-0000-0000-0000-000000000001';
set local role service_role;
delete from payload;
insert into payload select public.record_erp_statement_nightly_due('06440000-0000-0000-0000-000000000001','06440000-0000-0000-0000-000000000101','06440000-0000-0000-0000-000000000011','2026-10-19T09:00:00Z');
select ok((select (result->>'status')='recorded' and (result->>'inserted')='0' from payload),
 'AC-NS-004 the current activation records against the preserved cursor');
reset role;
select ok((select count(*)=(select n from rejection_rows_before) from public.erp_statement_nightly_obligation
  where org_id='06440000-0000-0000-0000-000000000001'),
 'AC-NS-004 a scope rotation preserves every existing obligation');

-- An expired lease is refused on both entry points, with no mutation.
update public.erp_sweep_lock set locked_until=clock_timestamp()-interval '1 second'
 where org_id='06440000-0000-0000-0000-000000000001';
create temporary table expired_state_before as select * from public.erp_statement_change_state
 where org_id='06440000-0000-0000-0000-000000000001';
set local role service_role;
select throws_ok($q$do $probe$ begin perform public.record_erp_statement_nightly_due('06440000-0000-0000-0000-000000000001','06440000-0000-0000-0000-000000000101','06440000-0000-0000-0000-000000000011','2026-10-19T09:00:00Z'); raise exception 'unexpected success' using errcode='P0001'; end; $probe$$q$,'55000',null,
 'AC-NS-004 an expired lease cannot record nightly work');
select throws_ok($q$do $probe$ begin perform public.request_erp_statement_manual_intent('06440000-0000-0000-0000-000000000001','06440000-0000-0000-0000-000000000101','06440000-0000-0000-0000-000000000011','2026-10-19T09:00:00Z'); raise exception 'unexpected success' using errcode='P0001'; end; $probe$$q$,'55000',null,
 'AC-NS-005 an expired lease cannot record a manual intent');
reset role;
select ok((select to_jsonb(s) is not distinct from to_jsonb(b) from public.erp_statement_change_state s
  cross join expired_state_before b where s.org_id=b.org_id),
 'AC-NS-004 an expired lease leaves every state field unchanged');
select ok((select count(*)=(select n from rejection_rows_before) from public.erp_statement_nightly_obligation
  where org_id='06440000-0000-0000-0000-000000000001'),
 'AC-NS-004 the rejected calls never materialized a date');

select * from finish();
rollback;
