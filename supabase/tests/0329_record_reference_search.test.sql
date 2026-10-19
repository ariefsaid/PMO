-- AC-S40-003: a bounded, role-gated reference search returns only canonical records in the caller's org.
-- All rows below are synthetic and are rolled back at the end of the test.
begin;
create extension if not exists pgtap;
select plan(28);

select ok((select p.provolatile = 's'
                 and not p.prosecdef
                 and p.proconfig @> array['search_path=public, pg_temp']
            from pg_proc p
           where p.oid = to_regprocedure('public.search_record_references(text,integer)')),
  'AC-S40-003 RPC is stable, SECURITY INVOKER, and pins search_path');                         -- 1
select ok(not has_function_privilege('anon', 'public.search_record_references(text,integer)', 'execute'),
  'AC-S40-003 anon cannot execute the reference search');                                      -- 2
select ok(has_function_privilege('authenticated', 'public.search_record_references(text,integer)', 'execute'),
  'AC-S40-003 authenticated callers can execute the reference search');                       -- 3
select is((select count(*)::int
             from pg_indexes
            where schemaname = 'public'
              and indexname in ('uxs40_projects_order_ref_idx','uxs40_projects_code_ref_idx',
                                'uxs40_projects_number_ref_idx','uxs40_invoices_si_ref_idx',
                                'uxs40_invoices_pmo_ref_idx','uxs40_invoices_customer_ref_idx',
                                'uxs40_receipts_ip_ref_idx','uxs40_receipts_pmo_ref_idx',
                                'uxs40_receipts_payment_ref_idx')),
  9, 'AC-S40-003 the nine bounded prefix aliases have dedicated indexes');                     -- 4

insert into organizations (id, name) values
  ('03290000-0000-0000-0000-000000000001', 'S40 Synthetic Org'),
  ('03290000-0000-0000-0000-000000000002', 'S40 Synthetic Other Org');
insert into auth.users (id, email) values
  ('03290000-0000-0000-0000-000000000101', 's40-finance@example.invalid'),
  ('03290000-0000-0000-0000-000000000102', 's40-engineer@example.invalid'),
  ('03290000-0000-0000-0000-000000000103', 's40-disabled@example.invalid'),
  ('03290000-0000-0000-0000-000000000104', 's40-manager@example.invalid'),
  ('03290000-0000-0000-0000-000000000105', 's40-admin@example.invalid'),
  ('03290000-0000-0000-0000-000000000106', 's40-executive@example.invalid'),
  ('03290000-0000-0000-0000-000000000201', 's40-other-finance@example.invalid');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('03290000-0000-0000-0000-000000000101', '03290000-0000-0000-0000-000000000001', 'S40 Finance', 's40-finance@example.invalid', 'Finance', 'active'),
  ('03290000-0000-0000-0000-000000000102', '03290000-0000-0000-0000-000000000001', 'S40 Engineer', 's40-engineer@example.invalid', 'Engineer', 'active'),
  ('03290000-0000-0000-0000-000000000103', '03290000-0000-0000-0000-000000000001', 'S40 Disabled', 's40-disabled@example.invalid', 'Finance', 'disabled'),
  ('03290000-0000-0000-0000-000000000104', '03290000-0000-0000-0000-000000000001', 'S40 Manager', 's40-manager@example.invalid', 'Project Manager', 'active'),
  ('03290000-0000-0000-0000-000000000105', '03290000-0000-0000-0000-000000000001', 'S40 Admin', 's40-admin@example.invalid', 'Admin', 'active'),
  ('03290000-0000-0000-0000-000000000106', '03290000-0000-0000-0000-000000000001', 'S40 Executive', 's40-executive@example.invalid', 'Executive', 'active'),
  ('03290000-0000-0000-0000-000000000201', '03290000-0000-0000-0000-000000000002', 'S40 Other Finance', 's40-other-finance@example.invalid', 'Finance', 'active');
insert into companies (id, org_id, name, type) values
  ('03290000-0000-0000-0000-000000000c01', '03290000-0000-0000-0000-000000000001', 'S40 Synthetic Client', 'Client');
insert into projects (id, org_id, code, name, status, contract_value, tax_treatment, tax_amount,
                      customer_contract_ref, pmo_project_number, client_id, archived_at) values
  ('03290000-0000-0000-0000-000000000d01', '03290000-0000-0000-0000-000000000001', 'S40-CODE-ALPHA', 'S40 Main Project', 'Ongoing Project', 10, 'exclusive', 0,
   'ORD-ALPHA-01', 'S40-P-0001', '03290000-0000-0000-0000-000000000c01', null),
  ('03290000-0000-0000-0000-000000000d02', '03290000-0000-0000-0000-000000000001', 'S40-CODE-ALPHA-EXT', 'S40 Prefix Project', 'Ongoing Project', 10, 'exclusive', 0,
   'ORD-ALPHA-01-EXT', null, '03290000-0000-0000-0000-000000000c01', null),
  ('03290000-0000-0000-0000-000000000d03', '03290000-0000-0000-0000-000000000001', 'S40-CODE-ARCHIVE', 'S40 Archived Project', 'Ongoing Project', 10, 'exclusive', 0,
   'ORD-ARCHIVED-1', null, '03290000-0000-0000-0000-000000000c01', now()),
  ('03290000-0000-0000-0000-000000000d04', '03290000-0000-0000-0000-000000000001', null, 'S40 Literal Project', 'Leads', 0, null, null,
   'WILD%_Q-1', null, null, null),
  ('03290000-0000-0000-0000-000000000d05', '03290000-0000-0000-0000-000000000001', 'S40-PREFIX-ONLY', 'S40 Prefix Only Project', 'Leads', 0, null, null,
   null, 'S40-P-UNIQUE', null, null);
insert into projects (id, org_id, code, name, status, contract_value, tax_treatment, tax_amount,
                      customer_contract_ref, client_id, archived_at) values
  ('03290000-0000-0000-0000-000000000d06', '03290000-0000-0000-0000-000000000001', 'S40-TENANT-ONE', 'S40 Tenant One Project', 'Leads', 0, null, null,
   null, null, null),
  ('03290000-0000-0000-0000-000000000d07', '03290000-0000-0000-0000-000000000002', 'S40-TENANT-TWO', 'S40 Tenant Two Project', 'Leads', 0, null, null,
   null, null, null),
  ('03290000-0000-0000-0000-000000000d08', '03290000-0000-0000-0000-000000000001', null, 'S40 Wildcard Near Match', 'Leads', 0, null, null,
   'WILDstuffaQ-1', null, null),
  ('03290000-0000-0000-0000-000000000d09', '03290000-0000-0000-0000-000000000001', null, 'S40 Backslash Reference', 'Leads', 0, null, null,
   'WILD' || chr(92) || 'X-1', null, null);

insert into sales_invoices (id, org_id, project_id, customer_id, si_number, reference_number, invoice_date,
                            amount, tax_treatment, tax_amount, currency, status) values
  ('03290000-0000-0000-0000-000000000f01', '03290000-0000-0000-0000-000000000001', '03290000-0000-0000-0000-000000000d01', '03290000-0000-0000-0000-000000000c01',
   'ORD-ALPHA-01', 'ORD-ALPHA-01-PO', '2026-10-01', 100, 'exclusive', 0, 'IDR', 'Unpaid'),
  ('03290000-0000-0000-0000-000000000f02', '03290000-0000-0000-0000-000000000001', null, null,
   'ORPHAN-DOC-7', 'ORPHAN-REF-7', '2026-10-01', 100, 'exclusive', 0, 'IDR', 'Unpaid'),
  ('03290000-0000-0000-0000-000000000f03', '03290000-0000-0000-0000-000000000001', null, null,
   'O''Brien-7', null, '2026-10-01', 100, 'exclusive', 0, 'IDR', 'Unpaid'),
  ('03290000-0000-0000-0000-000000000f04', '03290000-0000-0000-0000-000000000001', null, null,
   null, 'WILD-FAKE-X-1', '2026-10-01', 100, 'exclusive', 0, 'IDR', 'Unpaid'),
  ('03290000-0000-0000-0000-000000000f05', '03290000-0000-0000-0000-000000000001', null, null,
   null, 'TENANT-SHARED', '2026-10-01', 100, 'exclusive', 0, 'IDR', 'Unpaid'),
  ('03290000-0000-0000-0000-000000000f06', '03290000-0000-0000-0000-000000000002', null, null,
   null, 'TENANT-SHARED', '2026-10-01', 100, 'exclusive', 0, 'IDR', 'Unpaid');
insert into sales_invoices (id, org_id, pmo_number, pmo_native, native_lines, invoice_date, amount,
                            tax_treatment, tax_amount, currency, status)
select ('03290000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
       '03290000-0000-0000-0000-000000000001', 'CAP-' || lpad(n::text, 2, '0'), true, '[]'::jsonb,
       '2026-10-01', 100, 'exclusive', 0, 'IDR', 'Unpaid'
  from generate_series(10, 19) as n;
insert into incoming_payments (id, org_id, customer_id, sales_invoice_id, ip_number, reference_number, date, amount, status)
values ('03290000-0000-0000-0000-000000000e01', '03290000-0000-0000-0000-000000000001', '03290000-0000-0000-0000-000000000c01',
        '03290000-0000-0000-0000-000000000f01', 'ORD-ALPHA-01', 'ORD-ALPHA-01-RECEIPT', '2026-10-01', 100, 'Paid');
insert into incoming_payments (id, org_id, customer_id, sales_invoice_id, pmo_number, date, amount,
                               received_amount, withheld_amount, currency, status, pmo_native)
values ('03290000-0000-0000-0000-000000000e02', '03290000-0000-0000-0000-000000000001', '03290000-0000-0000-0000-000000000c01',
        '03290000-0000-0000-0000-000000000010', 'RCV-S40-1', '2026-10-01', 100, 100, 0, 'IDR', 'Paid', true);

set local role authenticated;
set local request.jwt.claims = '{"sub":"03290000-0000-0000-0000-000000000101","role":"authenticated"}';
select is(jsonb_array_length(public.search_record_references('ORD-ALPHA-01', 8) -> 'items'), 4,
  'AC-S40-003 exact and prefix aliases return one canonical row per project, invoice and receipt'); -- 5
select is((select jsonb_agg((item ->> 'exact')::boolean order by ordinal)
             from jsonb_array_elements(public.search_record_references('ORD-ALPHA-01', 8) -> 'items') with ordinality as rows(item, ordinal)),
  '[true,true,true,false]'::jsonb, 'AC-S40-003 exact references rank before prefix references');   -- 6
select is((select item -> 'aliases'
             from jsonb_array_elements(public.search_record_references('ORD-ALPHA-01', 8) -> 'items') as rows(item)
            where item ->> 'id' = '03290000-0000-0000-0000-000000000f01'),
  '["ORD-ALPHA-01","ORD-ALPHA-01-PO"]'::jsonb, 'AC-S40-003 repeated same-record aliases are preserved once and ordered'); -- 7
select is((select (item ->> 'exact')::boolean
             from jsonb_array_elements(public.search_record_references('oRd-Al', 8) -> 'items') as rows(item)
            where item ->> 'id' = '03290000-0000-0000-0000-000000000f01'),
  false, 'AC-S40-003 mixed-case literal prefixes match without becoming exact');                 -- 8
select ok(exists (select 1
                    from jsonb_array_elements(public.search_record_references('S40-CODE-AL', 8) -> 'items') as rows(item)
                   where item ->> 'kind' = 'project' and item ->> 'id' = '03290000-0000-0000-0000-000000000d01'),
  'AC-S40-003 project code prefixes are searchable');                                           -- 9
select is((select item ->> 'id'
             from jsonb_array_elements(public.search_record_references('S40-P-UNIQUE', 8) -> 'items') as rows(item)
            where item ->> 'kind' = 'project'),
  '03290000-0000-0000-0000-000000000d05', 'AC-S40-003 PMO project numbers are searchable');      -- 10
select ok(jsonb_array_length(public.search_record_references('WILD%_Q', 8) -> 'items') = 1
          and (public.search_record_references('WILD%_Q', 8) -> 'items' -> 0 ->> 'id') = '03290000-0000-0000-0000-000000000d04'
          and jsonb_array_length(public.search_record_references('WILD' || chr(92) || 'X-1', 8) -> 'items') = 1
          and (public.search_record_references('WILD' || chr(92) || 'X-1', 8) -> 'items' -> 0 ->> 'id') = '03290000-0000-0000-0000-000000000d09',
  'AC-S40-003 percent, underscore and backslash are literal search characters');                 -- 11
select is(jsonb_array_length(public.search_record_references('O''Brien-7', 8) -> 'items'), 1,
  'AC-S40-003 quoted references are passed as data, not parsed as SQL');                         -- 12
select is(jsonb_array_length(public.search_record_references('CAP-', 2) -> 'items'), 2,
  'AC-S40-003 caller limit bounds the returned page');                                           -- 13
select is((public.search_record_references('CAP-', 2) ->> 'hasMore')::boolean, true,
  'AC-S40-003 bounded pages signal more matches');                                               -- 14
select is(jsonb_array_length(public.search_record_references('CAP-', 99) -> 'items'), 8,
  'AC-S40-003 the server never returns more than eight matches');                                -- 15
select ok((select jsonb_array_length(public.search_record_references('x', 8) -> 'items') = 0
                  and jsonb_array_length(public.search_record_references('   ', 8) -> 'items') = 0
                  and jsonb_array_length(public.search_record_references(repeat('A', 121), 8) -> 'items') = 0
                  and (public.search_record_references('x', 8) ->> 'hasMore')::boolean = false),
  'AC-S40-003 short, blank and overlong searches return an empty page');                         -- 16
select is(jsonb_array_length(public.search_record_references('ORD-ARCHIVED', 8) -> 'items'), 0,
  'AC-S40-003 archived projects are not returned');                                             -- 17
select is((public.search_record_references('ORPHAN-REF-7', 8) -> 'items' -> 0) -> 'context', 'null'::jsonb,
  'AC-S40-003 missing related records remain unknown without fabricated context');              -- 18

set local request.jwt.claims = '{"sub":"03290000-0000-0000-0000-000000000102","role":"authenticated"}';
select is(jsonb_array_length(public.search_record_references('ORD-ALPHA-01', 8) -> 'items'), 0,
  'AC-S40-003 active Engineer members cannot use the revenue reference search');                 -- 19
set local request.jwt.claims = '{"sub":"03290000-0000-0000-0000-000000000103","role":"authenticated"}';
select is(jsonb_array_length(public.search_record_references('ORD-ALPHA-01', 8) -> 'items'), 0,
  'AC-S40-003 inactive members cannot use the reference search');                                -- 20
set local request.jwt.claims = '{"sub":"03290000-0000-0000-0000-000000000104","role":"authenticated"}';
select is(jsonb_array_length(public.search_record_references('ORD-ALPHA-01', 8) -> 'items'), 4,
  'AC-S40-003 Project Manager members can use the reference search');                           -- 21
set local request.jwt.claims = '{"sub":"03290000-0000-0000-0000-000000000105","role":"authenticated"}';
select is(jsonb_array_length(public.search_record_references('ORD-ALPHA-01', 8) -> 'items'), 4,
  'AC-S40-003 Admin members can use the reference search');                                     -- 22
set local request.jwt.claims = '{"sub":"03290000-0000-0000-0000-000000000106","role":"authenticated"}';
select is(jsonb_array_length(public.search_record_references('ORD-ALPHA-01', 8) -> 'items'), 4,
  'AC-S40-003 Executive members can use the reference search');                                 -- 23
set local request.jwt.claims = '{"sub":"03290000-0000-0000-0000-000000000101","role":"authenticated"}';
select ok((select position('S40 Main Project' in (item ->> 'context')) > 0
                  and position('S40 Synthetic Client' in (item ->> 'context')) > 0
             from jsonb_array_elements(public.search_record_references('ORD-ALPHA-01', 8) -> 'items') as rows(item)
            where item ->> 'id' = '03290000-0000-0000-0000-000000000f01'),
  'AC-S40-003 invoice results preserve recognizable project and customer context');              -- 24
reset role;
set local request.jwt.claims = '{"sub":"03290000-0000-0000-0000-000000000101","role":"authenticated"}';
select ok(jsonb_array_length(public.search_record_references('TENANT-SHARED', 8) -> 'items') = 1
          and (public.search_record_references('TENANT-SHARED', 8) -> 'items' -> 0 ->> 'id') = '03290000-0000-0000-0000-000000000f05'
          and (public.search_record_references('TENANT-SHARED', 8) -> 'items' -> 0 ->> 'kind') = 'invoice'
          and (public.search_record_references('TENANT-SHARED', 8) -> 'items' -> 0 ->> 'exact')::boolean
          and not exists(select 1 from jsonb_array_elements(public.search_record_references('TENANT-SHARED', 8) -> 'items') as rows(item)
            where item ->> 'id' = '03290000-0000-0000-0000-000000000f06'),
  'AC-S40-003 authenticated Finance gets the canonical own-org invoice and not the foreign same-reference invoice'); -- 25
set local request.jwt.claims = '{"sub":"03290000-0000-0000-0000-000000000201","role":"authenticated"}';
select is((select coalesce(jsonb_agg(item ->> 'id' order by item ->> 'id'), '[]'::jsonb)
             from jsonb_array_elements(public.search_record_references('TENANT-SHARED', 8) -> 'items') as rows(item)
            where item ->> 'kind' = 'invoice'),
  '["03290000-0000-0000-0000-000000000f06"]'::jsonb,
  'AC-S40-003 tenant two sees only its own match');                                              -- 26
select ok(not has_function_privilege('service_role', 'public.search_record_references(text,integer)', 'execute'),
  'AC-S40-003 function execution is limited to authenticated callers');                         -- 27
set local role authenticated;
set local request.jwt.claims = '{"sub":"03290000-0000-0000-0000-000000000101","role":"authenticated"}';
select ok(jsonb_array_length(public.search_record_references('CAP-10', 8) -> 'items') = 1
          and (public.search_record_references('CAP-10', 8) -> 'items' -> 0 ->> 'id') = '03290000-0000-0000-0000-000000000010'
          and jsonb_array_length(public.search_record_references('RCV-S40-1', 8) -> 'items') = 1
          and (public.search_record_references('RCV-S40-1', 8) -> 'items' -> 0 ->> 'id') = '03290000-0000-0000-0000-000000000e02',
  'AC-S40-003 PMO invoice and receipt numbers are searchable with canonical identities');         -- 28

select * from finish();
rollback;
