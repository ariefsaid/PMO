-- 0919_pack_on_hand_after_billed_totals.test.sql. Migration under test: 0919_pack_on_hand_after_billed_totals.sql.
-- The management pack marks the projects it returns with on_hand (on-hand status, not archived): an archived
-- or closed project returned only because it was billed in the window carries false, so Left to bill (which
-- counts only on_hand rows) does not include it; the flag does not depend on the selected period.
-- Cast: FIN a1 Finance (reads the pack).
begin;
create extension if not exists pgtap;
select plan(8);

insert into organizations (id, name, default_currency, default_timezone) values
  ('09190000-0000-0000-0000-000000000001', 'On Hand Flag Org', 'IDR', 'UTC');
insert into auth.users (id, email) values ('09190000-0000-0000-0000-0000000000a1', 'ohf-fin@example.invalid');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('09190000-0000-0000-0000-0000000000a1', '09190000-0000-0000-0000-000000000001', 'OHF Fin', 'ohf-fin@example.invalid', 'Finance', 'active');
insert into projects (id, org_id, name, status, contract_value, tax_treatment, tax_amount, currency, archived_at) values
  ('09190000-0000-0000-0000-0000000000c1', '09190000-0000-0000-0000-000000000001', 'OHF Held',     'Ongoing Project', 1000, 'exclusive', 0, 'IDR', null),
  ('09190000-0000-0000-0000-0000000000c2', '09190000-0000-0000-0000-000000000001', 'OHF Archived', 'Ongoing Project', 3000, 'exclusive', 0, 'IDR', now()),
  ('09190000-0000-0000-0000-0000000000c3', '09190000-0000-0000-0000-000000000001', 'OHF Lost',     'Loss Tender',     2000, 'exclusive', 0, 'IDR', null);
-- Every project billed in January 2026.
insert into sales_invoices (id, org_id, project_id, invoice_date, amount, tax_treatment, tax_amount, currency, status) values
  ('09190000-0000-0000-0000-00000000e001', '09190000-0000-0000-0000-000000000001', '09190000-0000-0000-0000-0000000000c1', '2026-01-15', 200, 'exclusive', 0, 'IDR', 'Paid'),
  ('09190000-0000-0000-0000-00000000e002', '09190000-0000-0000-0000-000000000001', '09190000-0000-0000-0000-0000000000c2', '2026-01-15', 500, 'exclusive', 0, 'IDR', 'Paid'),
  ('09190000-0000-0000-0000-00000000e003', '09190000-0000-0000-0000-000000000001', '09190000-0000-0000-0000-0000000000c3', '2026-01-15', 100, 'exclusive', 0, 'IDR', 'Paid');

set local role authenticated;
set local request.jwt.claims = '{"sub":"09190000-0000-0000-0000-0000000000a1","role":"authenticated"}';
-- Window that contains the January invoices, and one that starts after them.
do $$ begin
  perform set_config('ohf.jan', public.get_management_pack('2026-01-01', '2026-04-01')::text, true);
  perform set_config('ohf.mar', public.get_management_pack('2026-03-01', '2026-04-01')::text, true);
end $$;

create temporary table ohf_projects on commit drop as
  select w.win, p ->> 'id' as id, (p ->> 'on_hand')::boolean as on_hand, (p ? 'on_hand') as has_flag
    from (values ('jan', current_setting('ohf.jan')::jsonb), ('mar', current_setting('ohf.mar')::jsonb)) w(win, pack)
   cross join jsonb_array_elements(w.pack -> 'projects') p;

select is((select on_hand from ohf_projects where win = 'jan' and id = '09190000-0000-0000-0000-0000000000c1'), true,
  'AC-LTB-004 a held contract (on-hand status, not archived) is on_hand');
select is((select on_hand from ohf_projects where win = 'jan' and id = '09190000-0000-0000-0000-0000000000c2'), false,
  'AC-LTB-004 an archived project billed in the window is returned but not on_hand');
select is((select on_hand from ohf_projects where win = 'jan' and id = '09190000-0000-0000-0000-0000000000c3'), false,
  'AC-LTB-004 a lost project billed in the window is returned but not on_hand');
select is((select bool_and(has_flag) from ohf_projects), true,
  'AC-LTB-004 every returned project carries the flag');
select is((select count(*)::int from ohf_projects where win = 'jan' and on_hand), 1,
  'AC-LTB-004 only the held contract counts toward Left to bill in the January window');
select is((select array_agg(id order by id) from ohf_projects where win = 'mar' and on_hand),
          (select array_agg(id order by id) from ohf_projects where win = 'jan' and on_hand),
  'AC-LTB-004 switching the period does not change the held set');
select is((select count(*)::int from ohf_projects where win = 'mar'), 1,
  'AC-LTB-004 the project set returned is unchanged by the flag: unheld projects appear only when billed in the window');
select is((select (b ->> 'net')::numeric from jsonb_array_elements(current_setting('ohf.mar')::jsonb -> 'invoiced_before') b
            where b ->> 'project_id' = '09190000-0000-0000-0000-0000000000c1'), 200::numeric,
  'AC-LTB-004 the held contract''s earlier invoice moves to invoiced_before, so its invoiced to date is the same');

select * from finish();
rollback;
