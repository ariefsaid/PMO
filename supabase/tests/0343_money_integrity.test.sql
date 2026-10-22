begin;
create extension if not exists pgtap;
select plan(10);

insert into organizations(id,name,default_currency,default_timezone) values
  ('03430000-0000-0000-0000-000000000001','Money integrity test org','USD','UTC');
insert into auth.users(id,email) values
  ('03430000-0000-0000-0000-000000000011','money-integrity@example.invalid');
insert into profiles(id,org_id,full_name,email,role,status) values
  ('03430000-0000-0000-0000-000000000011','03430000-0000-0000-0000-000000000001','Money integrity test','money-integrity@example.invalid','Finance','active');
insert into projects(id,org_id,name,status,contract_value,tax_treatment,tax_amount,currency) values
  ('03430000-0000-0000-0000-000000000021','03430000-0000-0000-0000-000000000001','Money integrity project','Ongoing Project',100000,'exclusive',0,'USD');
insert into boq_items(id,org_id,project_id,item_code,description,unit,quantity,rate) values
  ('03430000-0000-0000-0000-000000000041','03430000-0000-0000-0000-000000000001','03430000-0000-0000-0000-000000000021','LINE-1','Line one','unit',10,100);

set local role authenticated;
set local request.jwt.claims='{"sub":"03430000-0000-0000-0000-000000000011","role":"authenticated"}';
select lives_ok($$select set_config('test.claim_id',public.create_progress_claim('03430000-0000-0000-0000-000000000021','progress',p_lines=>'[{"boq_item_id":"03430000-0000-0000-0000-000000000041","quantity":1}]'::jsonb)::text,true)$$,
  'AC-MONEY-001 progress claim is created from its priced lines');
reset role;
select is((select gross_amount from public.progress_claims where id=current_setting('test.claim_id')::uuid),
          (select sum(amount) from public.progress_claim_lines where claim_id=current_setting('test.claim_id')::uuid),
  'AC-MONEY-001 claim header equals the persisted priced lines');
create function public.test_0343_shift_rate_before_claim_lines() returns trigger
  language plpgsql set search_path=public as $$
begin
  update public.boq_items set rate=1000 where id='03430000-0000-0000-0000-000000000041';
  return new;
end $$;
create trigger test_0343_shift_rate_before_claim_lines before insert on public.progress_claims
  for each row when (new.project_id='03430000-0000-0000-0000-000000000021' and new.kind='progress')
  execute function public.test_0343_shift_rate_before_claim_lines();
set local role authenticated;
set local request.jwt.claims='{"sub":"03430000-0000-0000-0000-000000000011","role":"authenticated"}';
select throws_ok($$select public.create_progress_claim('03430000-0000-0000-0000-000000000021','progress',p_lines=>'[{"boq_item_id":"03430000-0000-0000-0000-000000000041","quantity":1}]'::jsonb)$$,
  '23514', 'the progress claim header must equal the sum of its priced lines',
  'AC-MONEY-001 changed rates cannot persist a mismatched claim snapshot');
reset role;
drop trigger test_0343_shift_rate_before_claim_lines on public.progress_claims;
drop function public.test_0343_shift_rate_before_claim_lines();
select is((select count(*)::int from public.progress_claims where project_id='03430000-0000-0000-0000-000000000021'),1,
  'AC-MONEY-001 failed price snapshots leave no claim rows');

insert into expense_claims(id,org_id,kind,claimant_id,title,amount,status) values
 ('03430000-0000-0000-0000-000000000051','03430000-0000-0000-0000-000000000001','claim','03430000-0000-0000-0000-000000000011','Submitted claim',0,'Draft');
insert into expense_claim_lines(id,claim_id,expense_date,expense_type,description,amount) values
 ('03430000-0000-0000-0000-000000000061','03430000-0000-0000-0000-000000000051','2026-10-01','Travel','Train',50);
update expense_claims set status='Submitted' where id='03430000-0000-0000-0000-000000000051';
select throws_ok($$update public.expense_claim_lines set amount=75 where id='03430000-0000-0000-0000-000000000061'$$,
  '42501', null, 'AC-MONEY-002 submitted expense line content remains frozen under elevated execution');
select is((select c.amount from public.expense_claims c where c.id='03430000-0000-0000-0000-000000000051'),
          (select coalesce(sum(l.amount),0) from public.expense_claim_lines l where l.claim_id='03430000-0000-0000-0000-000000000051'),
  'AC-MONEY-002 expense total equals the sum of its lines');

select lives_ok($$delete from public.progress_claims where id=current_setting('test.claim_id')::uuid$$,
  'AC-MONEY-003 deleting a progress claim cascades its lines');
select is((select count(*)::int from public.progress_claim_lines where claim_id=current_setting('test.claim_id')::uuid),0,
  'AC-MONEY-003 progress claim lines are removed with their parent');
select lives_ok($$delete from public.expense_claims where id='03430000-0000-0000-0000-000000000051'$$,
  'AC-MONEY-003 deleting an expense claim cascades its lines');
select is((select count(*)::int from public.expense_claim_lines where claim_id='03430000-0000-0000-0000-000000000051'),0,
  'AC-MONEY-003 expense claim lines are removed with their parent');

select * from finish();
rollback;
