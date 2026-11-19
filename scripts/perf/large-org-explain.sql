-- LOCAL ONLY (#2480). Times the two whole-set project reads on the large-org seed (scripts/perf/large-org-seed.sql).
-- psql "$LOCAL_DB_URL" -f scripts/perf/large-org-explain.sql   (record Execution Time in docs/perf-baseline.md)
\timing on
-- listProjectPickerOptions page 1 (PostgREST shape: active statuses, live, ordered by id, 1000 rows)
explain (analyze, buffers) select id,name,short_name,code,status,project_manager_id from public.projects
 where status in ('Ongoing Project','Close Out','Internal Project') and archived_at is null order by id limit 1000;
-- name search the pickers would use if they paged server-side
explain (analyze, buffers) select id,name from public.projects
 where archived_at is null and name ilike '%project 42%' order by id limit 50;
-- purchases for one project
explain (analyze, buffers) select id from public.procurements
 where project_id = (select id from public.projects where code = 'LG-0042');
