-- 0212_meetings_org_stamp.sql — #616: a second-org user could not create a meeting.
--
-- `meetings.org_id` carries the seed-org column default (0205 §1) and the DAL never sends org_id,
-- exactly like every business table 0074 fixed — but 0074 enumerated the tables that existed THEN, and
-- meetings shipped in August without the stamp. For any org other than the seed org the row landed
-- stamped with the seed org and `meetings_insert` WITH CHECK refused it (42501). Every test runs inside
-- the seed org, where the wrong default is the right value, so nothing went red until the first real
-- second tenant (2026-09-09).
--
-- Fix: attach the 0074 trigger. meeting_attendees / meeting_access_grants inherit org from the parent
-- meeting (0205's own stamps) and are fixed transitively. §2 asserts the CLASS on the migrated
-- database from the catalog, not a list — the pgTAP twin (0212 test) is the standing guard.
--
-- Reversibility: drop trigger meetings_stamp_org_id on public.meetings;

create trigger meetings_stamp_org_id
  before insert on public.meetings
  for each row execute function public.stamp_org_id();

-- §2 — every seed-default table that `authenticated` can INSERT into through a policy carries an
-- org-stamping BEFORE INSERT trigger. `credits` stays excluded (0074 header: the operator RPC inserts
-- cross-org on purpose).
do $$
declare v_missing text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into v_missing
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attname = 'org_id'
  join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
  where n.nspname = 'public' and c.relkind = 'r'
    and pg_get_expr(d.adbin, d.adrelid) like '%00000000-0000-0000-0000-000000000001%'
    and c.relname <> 'credits'
    and has_table_privilege('authenticated', c.oid, 'INSERT')
    and exists (select 1 from pg_policy p where p.polrelid = c.oid and p.polcmd = 'a')
    and not exists (
      select 1 from pg_trigger t join pg_proc f on f.oid = t.tgfoid
      where t.tgrelid = c.oid and not t.tgisinternal
        and t.tgtype::int & 2 = 2 and t.tgtype::int & 4 = 4   -- BEFORE ... INSERT
        and f.proname in ('stamp_org_id','stamp_meeting_attendee_org','stamp_meeting_grant','stamp_agent_attachment_thread_scope'));
  if v_missing is not null then
    raise exception '0212: seed-default tables reachable by authenticated INSERT lack an org stamp: %', v_missing;
  end if;
end $$;
