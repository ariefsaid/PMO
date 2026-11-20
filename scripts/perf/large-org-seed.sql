-- LOCAL ONLY (#2480). Never run by seed.sql, CI or any script; never against a cloud database.
-- Adds 500 projects (default org, mixed stages, ~10% archived) and 5,000 purchases to the seeded local stack,
-- so list/picker reads can be timed at the size of a large organisation. Invented names only.
-- Run inside scripts/with-db-lock.sh after `supabase db reset`:
--   psql "$LOCAL_DB_URL" -f scripts/perf/large-org-seed.sql
-- Re-runnable: it removes this script's own rows first (code/title prefix 'LG-'), then re-inserts them.
-- UNDO: `supabase db reset` (the deletes above also clear this script's rows before a re-run).
-- NOT generated yet: 5,000 invoices and 20,000 timesheet lines (tracked in docs/plans/2026-11-20-large-org-lists.md).
\set ON_ERROR_STOP on
begin;

-- Idempotence: purchases first (projects are the FK target).
delete from public.procurements where title like 'Large Org Purchase %';
delete from public.projects     where code  like 'LG-%';

insert into public.projects (code, name, status, project_manager_id, contract_value, currency, tax_treatment, tax_amount,
                            budget, start_date, end_date, archived_at)
select 'LG-' || lpad(n::text, 4, '0'),
       'Large Org Project ' || n,
       (array['Ongoing Project','Ongoing Project','Close Out','Internal Project','Leads','Negotiation'])[1 + n % 6]::project_status,
       '00000000-0000-0000-0000-0000000000a2',
       1000000 + n * 1000, 'IDR', 'exclusive', 0,
       800000 + n * 800,
       date '2025-01-01' + (n % 300), date '2026-01-01' + (n % 300),
       case when n % 10 = 0 then now() else null end
  from generate_series(1, 500) n;

insert into public.procurements (title, project_id, requested_by_id, status, total_value, currency)
select 'Large Org Purchase ' || n,
       (select id from public.projects where code = 'LG-' || lpad((1 + n % 500)::text, 4, '0')),
       '00000000-0000-0000-0000-0000000000a2', 'Draft', n, 'IDR'
  from generate_series(1, 5000) n;

analyze public.projects; analyze public.procurements;
commit;
