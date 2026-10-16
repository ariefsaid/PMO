begin;
create extension if not exists pgtap;
select plan(2);
select has_column('public', 'incoming_payments', 'allocation_checked_at', 'S-06 check timestamp exists');

insert into organizations (id, name) values ('03090000-0000-0000-0000-000000000001', '0309 Test Org');
insert into auth.users (id, email) values ('03090000-0000-0000-0000-000000000001', '0309@example.com');
insert into profiles (id, org_id, full_name, email, role, status)
values ('03090000-0000-0000-0000-000000000001', '03090000-0000-0000-0000-000000000001', '0309 User', '0309@example.com', 'Admin', 'active');
insert into companies (id, org_id, name, type)
values ('03090000-0000-0000-0000-000000000001', '03090000-0000-0000-0000-000000000001', '0309 Client', 'Client');
insert into incoming_payments (id, org_id, customer_id, date, amount)
values ('03090000-0000-0000-0000-000000000001', '03090000-0000-0000-0000-000000000001', '03090000-0000-0000-0000-000000000001', current_date, 1);
set local role authenticated;
set local request.jwt.claims = '{"sub":"03090000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$ update public.incoming_payments set allocation_checked_at = now() where id = '03090000-0000-0000-0000-000000000001' $$,
  '42501', null, 'authenticated users cannot write the S-06 check timestamp');
reset role;
select * from finish();
rollback;
