begin;
create extension if not exists pgtap;
select plan(6);
insert into organizations (id,name,default_currency,default_timezone,stock_handover_scope,po_needed_by_required_from) values
 ('27600000-0000-0000-0000-000000000001','Scope A','IDR','Asia/Jakarta','transfers_and_issues','2026-01-01'),
 ('27600000-0000-0000-0000-000000000002','Scope B','IDR','Asia/Jakarta','transfers_and_issues','2026-02-01');
insert into auth.users (id,email) values ('27600000-0000-0000-0000-000000000011','scope-a@example.com'),('27600000-0000-0000-0000-000000000012','scope-b@example.com');
insert into profiles (id,org_id,full_name,email,role,status) values
 ('27600000-0000-0000-0000-000000000011','27600000-0000-0000-0000-000000000001','Scope A','scope-a@example.com','Admin','active'),
 ('27600000-0000-0000-0000-000000000012','27600000-0000-0000-0000-000000000002','Scope B','scope-b@example.com','Admin','active');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"27600000-0000-0000-0000-000000000011","role":"authenticated"}',true);
select is(public.stock_handover_scope_of('27600000-0000-0000-0000-000000000001'),'transfers_and_issues','own handover setting');
select is(public.stock_handover_scope_of('27600000-0000-0000-0000-000000000002'),'transfers','other handover setting is scoped');
select is(public.po_needed_by_required_from_of('27600000-0000-0000-0000-000000000001'),'2026-01-01'::timestamptz,'own order setting');
select is(public.po_needed_by_required_from_of('27600000-0000-0000-0000-000000000002'),null::timestamptz,'other order setting is scoped');
select set_config('request.jwt.claims','{"sub":"27600000-0000-0000-0000-000000000012","role":"authenticated"}',true);
select is(public.stock_handover_scope_of('27600000-0000-0000-0000-000000000002'),'transfers_and_issues','other organisation retains its handover setting');
select is(public.po_needed_by_required_from_of('27600000-0000-0000-0000-000000000002'),'2026-02-01'::timestamptz,'other organisation retains its order setting');
select * from finish();
rollback;
