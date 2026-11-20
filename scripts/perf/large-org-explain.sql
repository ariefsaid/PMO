-- LOCAL ONLY (#2480). Times the whole-set project reads on the large-org seed (scripts/perf/large-org-seed.sql).
-- psql "$LOCAL_DB_URL" -f scripts/perf/large-org-explain.sql   (record Execution Time in docs/perf-baseline.md)
-- Runs as postgres with the exec member's JWT claims, so the batch RPCs pass their active-member gate.
\set ON_ERROR_STOP on
\timing on
begin;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true) as claims_set;

\echo '## 1. Projects list: full row + client/end_client/pm joins, active partition, page 1 (PostgREST shape)'
explain (analyze, buffers)
select p.*,
       c.name as client_name, c.short_name as client_short_name,
       ec.name as end_client_name, ec.short_name as end_client_short_name,
       pm.full_name as pm_full_name
  from public.projects p
  left join public.companies c  on c.id  = p.client_id
  left join public.companies ec on ec.id = p.end_client_id
  left join public.profiles pm  on pm.id = p.project_manager_id
 where p.status in ('Won, Pending KoM','Ongoing Project','On Hold','Close Out','Internal Project')
   and p.archived_at is null
 order by p.id
 limit 1000;

\echo '## 2. Picker page 1 (PostgREST shape: active statuses, live, ordered by id, 1000 rows)'
explain (analyze, buffers) select id,name,short_name,code,status,project_manager_id from public.projects
 where status in ('Won, Pending KoM','Ongoing Project','On Hold','Close Out','Internal Project') and archived_at is null order by id limit 1000;

\echo '## 3. Name search the pickers would use if they paged server-side'
explain (analyze, buffers) select id,name from public.projects
 where archived_at is null and name ilike '%project 42%' order by id limit 50;

\echo '## 4. Project identity map (id,name for EVERY stage — record search / pipeline labels)'
explain (analyze, buffers) select id,name from public.projects order by id limit 1000;

\echo '## 5. get_projects_money_collection for the 500 visible projects (page-load batch)'
explain (analyze, buffers)
select * from public.get_projects_money_collection(
  array(select id from public.projects where code like 'LG-%' order by id limit 500));

\echo '## 6. project_budget_positions for the same 500 (page-load batch)'
explain (analyze, buffers)
select * from public.project_budget_positions(
  array(select id from public.projects where code like 'LG-%' order by id limit 500));

\echo '## 7. get_projects_delivery for the same 500 (page-load batch)'
explain (analyze, buffers)
select * from public.get_projects_delivery(
  array(select id from public.projects where code like 'LG-%' order by id limit 500));

\echo '## 8. Purchases for one project'
explain (analyze, buffers) select id from public.procurements
 where project_id = (select id from public.projects where code = 'LG-0042');

rollback;
