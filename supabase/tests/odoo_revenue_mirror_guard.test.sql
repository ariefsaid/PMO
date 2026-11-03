-- #1506 O3 C3 (migration 0511): the Odoo facts on sales_invoices are written only by the service-role mirror writer.
-- AC-OCI-070 (partial; C6 extends): a user JWT cannot write odoo_state / odoo_attention / odoo_sent_total / odoo_read_at, the service role
-- can, and the org scope holds. Two layers are proved apart so neither hides behind the other: the column grants (no client UPDATE/INSERT
-- on the new columns) and the trigger pin (the table OWNER, which grants do not stop, still cannot write them under a user's JWT claims).
begin;
select plan(16);

insert into organizations (id, name) values
 ('a5110000-0000-0000-0000-000000000001', 'Mirror guard A'),
 ('a5110000-0000-0000-0000-000000000002', 'Mirror guard B');
insert into auth.users (id, email) values
 ('a5110000-0000-0000-0000-0000000000a1', 'a511-fin-a@example.com'),
 ('a5110000-0000-0000-0000-0000000000b1', 'a511-fin-b@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
 ('a5110000-0000-0000-0000-0000000000a1', 'a5110000-0000-0000-0000-000000000001', 'Fin A', 'a511-fin-a@example.com', 'Finance', 'active'),
 ('a5110000-0000-0000-0000-0000000000b1', 'a5110000-0000-0000-0000-000000000002', 'Fin B', 'a511-fin-b@example.com', 'Finance', 'active');
insert into companies (id, org_id, name, type) values
 ('a5110000-0000-0000-0000-0000000000c1', 'a5110000-0000-0000-0000-000000000001', 'Client A', 'Client');
insert into external_domain_ownership (org_id, external_tier, domain) values ('a5110000-0000-0000-0000-000000000001', 'odoo', 'revenue');
insert into sales_invoices (id, org_id, customer_id, si_number, invoice_date, amount, tax_amount, tax_treatment, status, erp_docstatus) values
 ('a5110000-0000-0000-0000-0000000000e1', 'a5110000-0000-0000-0000-000000000001', 'a5110000-0000-0000-0000-0000000000c1', 'INV/2026/00001', '2026-11-03', 1110.00, 110.00, 'inclusive', 'Unpaid', 1);

-- the columns exist with Odoo's vocabulary and start empty
select is((select odoo_state is null and odoo_attention is null and odoo_sent_total is null and odoo_read_at is null from sales_invoices where id = 'a5110000-0000-0000-0000-0000000000e1'), true, 'AC-OCI-070 the four Odoo facts start empty');

-- layer 1: grants. No client role can write the new columns (UPDATE is revoked on the table since 0176; INSERT is a column list)
select is((select count(*)::int from unnest(array['odoo_state','odoo_attention','odoo_sent_total','odoo_read_at']) c
            where has_column_privilege('authenticated', 'public.sales_invoices', c, 'update') or has_column_privilege('authenticated', 'public.sales_invoices', c, 'insert')
               or has_column_privilege('anon', 'public.sales_invoices', c, 'update') or has_column_privilege('anon', 'public.sales_invoices', c, 'insert')), 0,
          'AC-OCI-070 neither authenticated nor anon holds a UPDATE or INSERT privilege on any Odoo fact');

-- layer 2: the trigger pin. The table owner (postgres) is not stopped by grants, so this is the guard itself, under a user's claims.
set local request.jwt.claims = '{"sub":"a5110000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$update sales_invoices set odoo_state = 'posted' where id = 'a5110000-0000-0000-0000-0000000000e1'$$, '42501', 'the Odoo facts of an invoice are written only by the mirror', 'AC-OCI-070 a user JWT cannot write odoo_state');
select throws_ok($$update sales_invoices set odoo_attention = 'total-mismatch' where id = 'a5110000-0000-0000-0000-0000000000e1'$$, '42501', 'the Odoo facts of an invoice are written only by the mirror', 'AC-OCI-070 a user JWT cannot write odoo_attention (it could hide a mismatch, or invent one)');
select throws_ok($$update sales_invoices set odoo_sent_total = 1.00 where id = 'a5110000-0000-0000-0000-0000000000e1'$$, '42501', 'the Odoo facts of an invoice are written only by the mirror', 'AC-OCI-070 a user JWT cannot write odoo_sent_total');
select throws_ok($$update sales_invoices set odoo_read_at = now() where id = 'a5110000-0000-0000-0000-0000000000e1'$$, '42501', 'the Odoo facts of an invoice are written only by the mirror', 'AC-OCI-070 a user JWT cannot write odoo_read_at (it would make a stale read look fresh)');
select throws_ok($$update sales_invoices set odoo_state = 'posted', odoo_attention = null where id = 'a5110000-0000-0000-0000-0000000000e1'$$, '42501', 'the Odoo facts of an invoice are written only by the mirror', 'AC-OCI-070 several columns at once are refused too');

-- the pin holds whoever owns revenue (a native org's users must not write them either)
delete from external_domain_ownership where org_id = 'a5110000-0000-0000-0000-000000000001';
select throws_ok($$update sales_invoices set odoo_attention = 'money-unreadable' where id = 'a5110000-0000-0000-0000-0000000000e1'$$, '42501', 'the Odoo facts of an invoice are written only by the mirror', 'AC-OCI-070 the pin does not depend on revenue being externally owned');
insert into external_domain_ownership (org_id, external_tier, domain) values ('a5110000-0000-0000-0000-000000000001', 'odoo', 'revenue');

select is((select odoo_state is null and odoo_attention is null and odoo_sent_total is null and odoo_read_at is null from sales_invoices where id = 'a5110000-0000-0000-0000-0000000000e1'), true, 'AC-OCI-070 every refused write left the row untouched');

-- the service role (the mirror writer) can
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok($$update sales_invoices set odoo_state = 'posted', odoo_attention = 'total-mismatch', odoo_sent_total = 1000.00, odoo_read_at = '2026-11-03T10:00:00Z' where org_id = 'a5110000-0000-0000-0000-000000000001' and id = 'a5110000-0000-0000-0000-0000000000e1'$$, 'AC-OCI-070 the service role writes the Odoo facts');
select is((select odoo_state || '/' || odoo_attention || '/' || odoo_sent_total::text from sales_invoices where id = 'a5110000-0000-0000-0000-0000000000e1'), 'posted/total-mismatch/1000.00', 'AC-OCI-013 the figure PMO sent stays beside Odoo''s amount (amount is not replaced)');
select is((select amount from sales_invoices where id = 'a5110000-0000-0000-0000-0000000000e1'), 1110.00::numeric, 'AC-OCI-013 amount is Odoo''s total, untouched by the flag');
select lives_ok($$update sales_invoices set odoo_attention = null where org_id = 'a5110000-0000-0000-0000-000000000001' and id = 'a5110000-0000-0000-0000-0000000000e1'$$, 'AC-OCI-070 the service role clears a flag (a later read that agrees)');

-- vocabulary: a value outside the set is refused by the table, even for the service role
select throws_ok($$update sales_invoices set odoo_attention = 'whatever' where id = 'a5110000-0000-0000-0000-0000000000e1'$$, '23514', null, 'AC-OCI-070 the attention vocabulary is closed');
select throws_ok($$update sales_invoices set odoo_state = 'paid' where id = 'a5110000-0000-0000-0000-0000000000e1'$$, '23514', null, 'AC-OCI-070 the state vocabulary is closed (paid is derived from the residual, not stored)');

-- org scope: another tenant's finance user sees nothing of this invoice, Odoo facts included
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a5110000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::int from sales_invoices where id = 'a5110000-0000-0000-0000-0000000000e1'), 0, 'AC-OCI-070 org scope: another tenant cannot read the invoice or its Odoo facts');

reset role;
select * from finish();
rollback;
