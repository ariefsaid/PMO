-- 0011_timesheet_entry_with_check.sql — timesheet entry-write hardening + idempotent-upsert key.
-- (FR-TSE-018, NFR-TSE-SEC-001/002, NFR-TSE-TENANCY-001; ADR-0015)
-- Reversibility (ADR-0006, pre-production): `supabase db reset`. Manual rollback:
--   alter table timesheet_entries drop constraint timesheet_entries_cell_uq;
--   drop policy timesheet_entries_write on timesheet_entries;
--   create policy timesheet_entries_write on timesheet_entries for all
--     using (org_id = auth_org_id() and exists (select 1 from timesheets t
--       where t.id = timesheet_entries.timesheet_id and t.user_id = auth.uid() and t.status = 'Draft'))
--     with check (org_id = auth_org_id());   -- (the OLD, leaky clause: no own/Draft post-image
--                                            --  guard AND no parent-project org guard)

-- (1) Collapse any pre-existing duplicate (timesheet_id, project_id, entry_date) rows so the new
-- unique constraint applies cleanly. Sum hours; keep the min(id); merge distinct notes. Defensive:
-- current seed (supabase/seed.sql) has no duplicate triple, so this is a no-op there.
-- (uuid has no native min() aggregate/window — compare on id::text to pick the deterministic
-- lexicographically-min id, then cast back to uuid for the keep_id join.)
with d as (
  select timesheet_id, project_id, entry_date,
         min(id::text)::uuid as keep_id,
         sum(hours) as total_hours,
         string_agg(distinct nullif(notes,''), '; ' order by nullif(notes,'')) as merged_notes,
         count(*) as n
  from timesheet_entries
  group by timesheet_id, project_id, entry_date
  having count(*) > 1
)
update timesheet_entries e
   set hours = least(d.total_hours, 24), notes = d.merged_notes
  from d
 where e.id = d.keep_id;
delete from timesheet_entries e
 using (
   select id, timesheet_id, project_id, entry_date,
          min(id::text) over (partition by timesheet_id, project_id, entry_date)::uuid as keep_id
     from timesheet_entries
 ) r
 where e.id = r.id and r.id <> r.keep_id;

-- (2) Idempotent-upsert key (OQ-2): one entry per cell.
alter table timesheet_entries
  add constraint timesheet_entries_cell_uq unique (timesheet_id, project_id, entry_date);

-- (3) Close the WITH CHECK hole (§1.2): the POST-image entry's parent timesheet must be the
-- caller's OWN and Draft — mirror the USING clause. Without this a same-org user could insert/
-- update an entry onto another user's (or a non-Draft) sheet. security-invoker posture: no RPC.
-- (3b) Parent-PROJECT org guard (NFR-TSE-TENANCY-001, audit HIGH-2): the entry's parent project
-- must also be in the caller's org — mirroring every sibling child-table policy in 0002_rls.sql
-- (tasks/budget_versions/project_documents/procurement_items/…). Without it an org-A user could
-- persist an org-B project_id onto their OWN org-A Draft entry (reproduced via INSERT, UPDATE, and
-- the upsert path). The guard is in BOTH USING and WITH CHECK (pre- and post-image project must be
-- in-org). This MUST stay: it is the only thing pinning the foreign-key target to the tenant.
drop policy timesheet_entries_write on timesheet_entries;
create policy timesheet_entries_write on timesheet_entries for all
  using (org_id = auth_org_id() and exists (
    select 1 from timesheets t where t.id = timesheet_entries.timesheet_id
      and t.user_id = auth.uid() and t.status = 'Draft')
    and exists (select 1 from public.projects p
      where p.id = timesheet_entries.project_id and p.org_id = auth_org_id()))
  with check (org_id = auth_org_id() and exists (
    select 1 from timesheets t where t.id = timesheet_entries.timesheet_id
      and t.user_id = auth.uid() and t.status = 'Draft')
    and exists (select 1 from public.projects p
      where p.id = timesheet_entries.project_id and p.org_id = auth_org_id()));
