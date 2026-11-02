-- 0492_expense_advance_aging_totals.test.sql — T-12: bucket totals cover every visible outstanding advance (not the
-- 500-row list page) and see exactly the rows get_expense_advance_aging() shows each role. AC-EXP-062.
begin;
select plan(12);

insert into organizations (id, name, default_currency, default_timezone) values
  ('04920000-0000-0000-0000-00000000000a','EXP Tot Org','IDR','Asia/Jakarta'),
  ('04920000-0000-0000-0000-00000000000b','EXP Tot Org B','IDR','Asia/Jakarta');
insert into auth.users (id, email) values
  ('04920000-0000-0000-0000-0000000000a1','tot-e1@example.com'),
  ('04920000-0000-0000-0000-0000000000a2','tot-e2@example.com'),
  ('04920000-0000-0000-0000-0000000000a3','tot-pm@example.com'),
  ('04920000-0000-0000-0000-0000000000a4','tot-fin@example.com'),
  ('04920000-0000-0000-0000-0000000000a6','tot-adm@example.com'),
  ('04920000-0000-0000-0000-0000000000b2','tot-finb@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('04920000-0000-0000-0000-0000000000a1','04920000-0000-0000-0000-00000000000a','T Eng One','tot-e1@example.com','Engineer','active'),
  ('04920000-0000-0000-0000-0000000000a2','04920000-0000-0000-0000-00000000000a','T Eng Two','tot-e2@example.com','Engineer','active'),
  ('04920000-0000-0000-0000-0000000000a3','04920000-0000-0000-0000-00000000000a','T PM','tot-pm@example.com','Project Manager','active'),
  ('04920000-0000-0000-0000-0000000000a4','04920000-0000-0000-0000-00000000000a','T Fin','tot-fin@example.com','Finance','active'),
  ('04920000-0000-0000-0000-0000000000a6','04920000-0000-0000-0000-00000000000a','T Admin','tot-adm@example.com','Admin','active'),
  ('04920000-0000-0000-0000-0000000000b2','04920000-0000-0000-0000-00000000000b','T Fin B','tot-finb@example.com','Finance','active');

-- 520 outstanding advances for Eng Two (10 each, all 90+ via a paid date 200 days back), then ONE for Eng One: past the
-- 500-row list page, which is the case the old client-side sum got wrong.
insert into expense_claims (org_id, kind, claimant_id, title, amount, status, claim_number, approved_by_id, paid_on)
select '04920000-0000-0000-0000-00000000000a','advance','04920000-0000-0000-0000-0000000000a2','Bulk '||g,10,'Paid','ADV-4920'||g,
       '04920000-0000-0000-0000-0000000000a3',(now() at time zone 'Asia/Jakarta')::date - 200
  from generate_series(1,520) g;
insert into expense_claims (org_id, kind, claimant_id, title, amount, status, claim_number, approved_by_id, paid_on) values
  ('04920000-0000-0000-0000-00000000000a','advance','04920000-0000-0000-0000-0000000000a1','Fresh',1000,'Paid','ADV-4920901','04920000-0000-0000-0000-0000000000a3',(now() at time zone 'Asia/Jakarta')::date - 5),
  ('04920000-0000-0000-0000-00000000000a','advance','04920000-0000-0000-0000-0000000000a1','Mid, part returned',500,'Paid','ADV-4920902','04920000-0000-0000-0000-0000000000a3',(now() at time zone 'Asia/Jakarta')::date - 45),
  ('04920000-0000-0000-0000-00000000000a','advance','04920000-0000-0000-0000-0000000000a1','Fully returned',70,'Paid','ADV-4920903','04920000-0000-0000-0000-0000000000a3',(now() at time zone 'Asia/Jakarta')::date - 45),
  ('04920000-0000-0000-0000-00000000000a','advance','04920000-0000-0000-0000-0000000000a1','Not paid yet',90,'Approved','ADV-4920904','04920000-0000-0000-0000-0000000000a3',null),
  ('04920000-0000-0000-0000-00000000000b','advance','04920000-0000-0000-0000-0000000000b2','Other org',77,'Paid','ADV-4920905','04920000-0000-0000-0000-0000000000b2',(now() at time zone 'Asia/Jakarta')::date - 5);
update expense_claims set returned_amount = 100 where claim_number = 'ADV-4920902';
update expense_claims set returned_amount = 70 where claim_number = 'ADV-4920903';

set local role authenticated;

-- Finance (org-wide): all 523 outstanding advances, summed in the database.
set local request.jwt.claims = '{"sub":"04920000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select is((select count(*)::int from get_expense_advance_aging()), 522,
  'AC-EXP-062: Finance sees 522 outstanding advances (520 bulk + 2 with money left)');
select is((select string_agg(bucket||'='||outstanding||'/'||advance_count, ',' order by bucket) from get_expense_advance_aging_totals()),
  '0-30=1000.00/1,31-60=400.00/1,90+=5200.00/520',
  'AC-EXP-062: Finance totals include all 520 advances past the 500-row page, not a capped sum');
select is((select sum(advance_count)::int from get_expense_advance_aging_totals()), 522,
  'AC-EXP-062: the bucket counts add up to every visible outstanding advance');

-- Mirror the list per role: totals == aggregate of what get_expense_advance_aging() returns to the same caller.
create or replace function pg_temp.mirror_ok() returns boolean language sql as $$
  select not exists (
    (select currency, bucket, sum(outstanding), count(*) from get_expense_advance_aging() group by 1,2
     except select currency, bucket, outstanding, advance_count from get_expense_advance_aging_totals())
    union all
    (select currency, bucket, outstanding, advance_count from get_expense_advance_aging_totals()
     except select currency, bucket, sum(outstanding), count(*) from get_expense_advance_aging() group by 1,2))
$$;
select is(pg_temp.mirror_ok(), true, 'AC-EXP-062: Finance totals equal the aggregate of the Finance list');

set local request.jwt.claims = '{"sub":"04920000-0000-0000-0000-0000000000a6","role":"authenticated"}';
select is((select sum(advance_count)::int from get_expense_advance_aging_totals()), 522,
  'AC-EXP-062: Admin sees the same 522 advances in the totals');

set local request.jwt.claims = '{"sub":"04920000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select string_agg(bucket||'='||outstanding||'/'||advance_count, ',' order by bucket) from get_expense_advance_aging_totals()),
  '0-30=1000.00/1,31-60=400.00/1',
  'AC-EXP-062: an Engineer''s totals cover only their own advances (fully returned and unpaid ones excluded)');
select is(pg_temp.mirror_ok(), true, 'AC-EXP-062: Engineer totals equal the aggregate of the Engineer list');

set local request.jwt.claims = '{"sub":"04920000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is((select sum(advance_count)::int from get_expense_advance_aging_totals()), 520,
  'AC-EXP-062: the other Engineer sees only their 520');

set local request.jwt.claims = '{"sub":"04920000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select is((select string_agg(bucket||'='||outstanding||'/'||advance_count, ',') from get_expense_advance_aging_totals()),
  '0-30=77.00/1', 'AC-EXP-062: another org''s Finance sees only that org''s advances');
select is(pg_temp.mirror_ok(), true, 'AC-EXP-062: other-org totals equal the aggregate of that org''s list');
reset role;

select is(has_function_privilege('anon','public.get_expense_advance_aging_totals()','EXECUTE'), false,
  'AC-EXP-062: anon cannot execute the totals read');
select is(has_function_privilege('authenticated','public.get_expense_advance_aging_totals()','EXECUTE'), true,
  'AC-EXP-062: members can execute the totals read');

select * from finish();
rollback;
