-- 0683 — agent_automation_fires lease: an unsettled claim older than the lease is re-claimable by exactly
-- one conditional UPDATE; a fresh or settled claim never is.
begin;
select plan(6);

insert into organizations (id, name) values ('06830000-0000-0000-0000-000000000001','Fire Lease Org');
insert into auth.users (id, email) values ('06830000-0000-0000-0000-0000000000a1','fl-user@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('06830000-0000-0000-0000-0000000000a1','06830000-0000-0000-0000-000000000001','FL User','fl-user@example.com','Admin');
insert into agent_automations (id, owner_id, org_id, kind, prompt, enabled, trigger_on) values
  ('06830000-0000-0000-0000-0000000000a2','06830000-0000-0000-0000-0000000000a1','06830000-0000-0000-0000-000000000001','trigger','t',true,
   '{"source":"procurement_status_events","event":"Ordered"}'::jsonb);

select has_column('public','agent_automation_fires','settled_at','0683-001: settled_at exists');

-- e1 stale+unsettled, e2 fresh+unsettled, e3 stale+settled
insert into agent_automation_fires (automation_id, event_id, fired_at, settled_at) values
  ('06830000-0000-0000-0000-0000000000a2','06830000-0000-0000-0000-0000000000e1', now() - interval '10 minutes', null),
  ('06830000-0000-0000-0000-0000000000a2','06830000-0000-0000-0000-0000000000e2', now(), null),
  ('06830000-0000-0000-0000-0000000000a2','06830000-0000-0000-0000-0000000000e3', now() - interval '10 minutes', now() - interval '9 minutes');

create temp table w1 as
  with u as (
    update agent_automation_fires set fired_at = now()
     where automation_id = '06830000-0000-0000-0000-0000000000a2' and event_id = '06830000-0000-0000-0000-0000000000e1'
       and settled_at is null and fired_at < now() - interval '5 minutes'
     returning 1)
  select count(*)::int as n from u;
select is((select n from w1),1,'0683-002: stale unsettled claim is re-claimed');
create temp table w4 as
  with u as (
    update agent_automation_fires set fired_at = now()
     where automation_id = '06830000-0000-0000-0000-0000000000a2' and event_id = '06830000-0000-0000-0000-0000000000e1'
       and settled_at is null and fired_at < now() - interval '5 minutes'
     returning 1)
  select count(*)::int as n from u;
select is((select n from w4),0,'0683-003: a second re-claim of the same claim loses (lease renewed)');
create temp table w2 as
  with u as (
    update agent_automation_fires set fired_at = now()
     where automation_id = '06830000-0000-0000-0000-0000000000a2' and event_id = '06830000-0000-0000-0000-0000000000e2'
       and settled_at is null and fired_at < now() - interval '5 minutes'
     returning 1)
  select count(*)::int as n from u;
select is((select n from w2),0,'0683-004: fresh unsettled claim is not re-claimable');
create temp table w3 as
  with u as (
    update agent_automation_fires set fired_at = now()
     where automation_id = '06830000-0000-0000-0000-0000000000a2' and event_id = '06830000-0000-0000-0000-0000000000e3'
       and settled_at is null and fired_at < now() - interval '5 minutes'
     returning 1)
  select count(*)::int as n from u;
select is((select n from w3),0,'0683-005: settled claim is never re-claimable');
select is((select count(*)::int from agent_automation_fires where settled_at is null), 2,
  '0683-006: only e1 (renewed) and e2 remain unsettled');

select * from finish();
rollback;
