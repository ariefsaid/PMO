-- #1354 — create_payment's billed-amount ceiling is per currency: a bill in another currency never raises the
-- cap for a payment in the purchase's currency, and the single-currency case is unchanged.
begin;
select plan(6);

insert into organizations(id,name,default_currency) values ('13542000-0000-0000-0000-000000000001','Currency Ceiling Org','IDR');
insert into auth.users(id,email) values ('13542000-0000-0000-0000-000000000011','cc-finance@example.com');
insert into profiles(id,org_id,full_name,email,role,status) values
 ('13542000-0000-0000-0000-000000000011','13542000-0000-0000-0000-000000000001','Finance','cc-finance@example.com','Finance','active');
insert into procurements(id,org_id,title,requested_by_id,status,total_value,currency) values
 ('13542000-0000-0000-0000-000000000101','13542000-0000-0000-0000-000000000001','Single currency','13542000-0000-0000-0000-000000000011','Vendor Invoiced',1000,'IDR'),
 ('13542000-0000-0000-0000-000000000102','13542000-0000-0000-0000-000000000001','Mixed currency','13542000-0000-0000-0000-000000000011','Vendor Invoiced',1000,'IDR'),
 ('13542000-0000-0000-0000-000000000103','13542000-0000-0000-0000-000000000001','Foreign bills only','13542000-0000-0000-0000-000000000011','Vendor Invoiced',1000,'IDR');
insert into procurement_invoices(id,org_id,procurement_id,status,amount,tax_treatment,tax_amount,currency) values
 ('13542000-0000-0000-0000-000000001101','13542000-0000-0000-0000-000000000001','13542000-0000-0000-0000-000000000101','Received',1000,'exclusive',0,'IDR'),
 ('13542000-0000-0000-0000-000000001201','13542000-0000-0000-0000-000000000001','13542000-0000-0000-0000-000000000102','Received',500,'exclusive',0,'IDR'),
 ('13542000-0000-0000-0000-000000001202','13542000-0000-0000-0000-000000000001','13542000-0000-0000-0000-000000000102','Received',1000,'exclusive',0,'USD'),
 ('13542000-0000-0000-0000-000000001301','13542000-0000-0000-0000-000000000001','13542000-0000-0000-0000-000000000103','Received',5000,'exclusive',0,'USD');

set local role authenticated;
set local request.jwt.claims='{"sub":"13542000-0000-0000-0000-000000000011","role":"authenticated"}';
select lives_ok($$select create_payment('13542000-0000-0000-0000-000000000101',null,'P-1','Scheduled','2026-10-02',1000)$$,
  '#1354: single currency — a payment up to the billed amount is recorded');
select throws_ok($$select create_payment('13542000-0000-0000-0000-000000000101',null,'P-2','Scheduled','2026-10-02',1)$$,
  '23514','scheduled payments cannot exceed the billed gross amount','#1354: single currency — one more unit is refused');
select throws_ok($$select create_payment('13542000-0000-0000-0000-000000000102',null,'P-3','Scheduled','2026-10-02',1000)$$,
  '23514','scheduled payments cannot exceed the billed gross amount','#1354: a bill in another currency does not lift the cap (500 IDR billed, 1500 summed)');
select lives_ok($$select create_payment('13542000-0000-0000-0000-000000000102',null,'P-4','Scheduled','2026-10-02',500)$$,
  '#1354: mixed bills — a payment up to the bills in its own currency is recorded');
select throws_ok($$select create_payment('13542000-0000-0000-0000-000000000102',null,'P-5','Scheduled','2026-10-02',1)$$,
  '23514','scheduled payments cannot exceed the billed gross amount','#1354: mixed bills — own-currency cap is exhausted');
select throws_ok($$select create_payment('13542000-0000-0000-0000-000000000103',null,'P-6','Scheduled','2026-10-02',1)$$,
  '23514','scheduled payments cannot exceed the billed gross amount','#1354: bills only in another currency leave nothing to pay in this one');
reset role;

select * from finish();
rollback;
