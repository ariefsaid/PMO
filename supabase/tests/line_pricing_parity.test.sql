-- Shared vectors consumed by the SQL, Vitest and Deno parity tests.
begin;
select plan(7);
create temporary table line_pricing_vectors (data jsonb);
insert into line_pricing_vectors values ($vectors$[
 {"name":"decimal tie","items":[{"qty":0.29,"rate":0.5}],"total":0.15,"procurement":true,"native":true},
 {"name":"negative tie","items":[{"qty":-0.29,"rate":0.5}],"total":-0.15,"procurement":false,"native":false},
 {"name":"two ties","items":[{"qty":0.01,"rate":0.5},{"qty":0.01,"rate":0.5}],"total":0.02,"procurement":true,"native":true},
 {"name":"native thousandths","items":[{"qty":0.001,"rate":5}],"total":0.01,"procurement":false,"native":true},
 {"name":"upper amount","items":[{"qty":1,"rate":999999999999.99}],"total":999999999999.99,"procurement":true,"native":true},
 {"name":"small exponent","items":[{"qty":1e-7,"rate":100000}],"total":0.01,"procurement":false,"native":false},
 {"name":"mixed signs","items":[{"qty":-1,"rate":1.25},{"qty":2,"rate":0.5}],"total":-0.25,"procurement":false,"native":false}
]$vectors$::jsonb);
select is((select count(*)::integer from line_pricing_vectors v, jsonb_array_elements(v.data) x
  where public.invoice_command_line_total(jsonb_build_object('items',x->'items')) is distinct from (x->>'total')::numeric),0,'command totals match shared decimal vectors');
select is(public.invoice_command_line_total('{"items":[]}'::jsonb),null::numeric,'empty command lines are unknown');
select is(public.invoice_command_line_total('{"items":[{"qty":1,"rate":null}]}'::jsonb),null::numeric,'unpriced command lines are unknown');
insert into organizations (id,name) values ('fa030000-0000-0000-0000-000000000001','Pricing test');
insert into auth.users (id,email) values ('fa030000-0000-0000-0000-000000000002','pricing-test@example.test');
insert into profiles (id,org_id,full_name,email,role) values ('fa030000-0000-0000-0000-000000000002','fa030000-0000-0000-0000-000000000001','Pricing test','pricing-test@example.test','Finance');
insert into procurements (org_id,title,status,requested_by_id,total_value,currency)
select 'fa030000-0000-0000-0000-000000000001',x->>'name','Draft','fa030000-0000-0000-0000-000000000002',0,'USD' from line_pricing_vectors v, jsonb_array_elements(v.data) x where (x->>'procurement')::boolean;
insert into procurement_items (org_id,procurement_id,name,quantity,rate)
select 'fa030000-0000-0000-0000-000000000001',p.id, x->>'name', (i->>'qty')::numeric,(i->>'rate')::numeric
from line_pricing_vectors v, jsonb_array_elements(v.data) x, jsonb_array_elements(x->'items') i, procurements p
where p.org_id='fa030000-0000-0000-0000-000000000001' and p.title=x->>'name' and (x->>'procurement')::boolean;
select is((select count(*)::integer from line_pricing_vectors v, jsonb_array_elements(v.data) x
  where (x->>'procurement')::boolean and
    (select sum(amount) from procurement_items where name=x->>'name' and org_id='fa030000-0000-0000-0000-000000000001') is distinct from (x->>'total')::numeric),0,'stored generated amounts match shared decimal vectors');
insert into companies (id,org_id,name,type) values ('fa030000-0000-0000-0000-000000000004','fa030000-0000-0000-0000-000000000001','Pricing client','Client');
insert into projects (id,org_id,name,status,currency,contract_value,tax_treatment,tax_amount,tax_rate,tax_base_numerator,tax_base_denominator,subject_to_vat,client_id)
values ('fa030000-0000-0000-0000-000000000005','fa030000-0000-0000-0000-000000000001','Pricing project','Ongoing Project','USD',100,'exclusive',0,null,1,1,false,'fa030000-0000-0000-0000-000000000004');
set local request.jwt.claims = '{"sub":"fa030000-0000-0000-0000-000000000002","role":"authenticated"}';
create temporary table native_pricing_results (expected numeric, actual numeric);
do $$
declare v jsonb; invoice_id uuid; lines jsonb;
begin
  for v in select x from line_pricing_vectors, jsonb_array_elements(data) x where (x->>'native')::boolean loop
    select jsonb_agg(i || jsonb_build_object('item_code','TEST')) into lines from jsonb_array_elements(v->'items') i;
    invoice_id := public.create_native_sales_invoice('fa030000-0000-0000-0000-000000000005','fa030000-0000-0000-0000-000000000004',lines);
    insert into native_pricing_results select (v->>'total')::numeric, amount from sales_invoices where id=invoice_id;
  end loop;
end $$;
select is((select count(*)::integer from native_pricing_results),(select count(*)::integer from line_pricing_vectors v, jsonb_array_elements(v.data) x where (x->>'native')::boolean),'native invoice writer consumes every eligible vector');
select is((select count(*)::integer from native_pricing_results where actual is distinct from expected),0,'native invoice writer matches shared decimal vectors');
select throws_ok($$select public.create_native_sales_invoice('fa030000-0000-0000-0000-000000000005','fa030000-0000-0000-0000-000000000004','[{"item_code":"TEST","qty":1,"rate":1000000000000}]'::jsonb)$$,'23514','the invoice total must be above zero','native writer rejects the upper total bound');
select * from finish();
rollback;
