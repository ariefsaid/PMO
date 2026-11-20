-- #1599 ECX-4 (migration 0975): a direct-cost account requested from PMO.
-- AC-ECX-031: only an active Admin or Finance member of the binding's org can request an account send; the parent must be a mirrored
-- expense group of the bound company; the queued send and the resulting map row are org-scoped. Also the DB half of AC-ECX-030: the
-- drain's result links the category to the created account once, and a category that has its account is never sent again.
begin;
select plan(65);

insert into organizations (id, name) values
 ('a9110000-0000-0000-0000-000000000001','Accounts A'),
 ('a9110000-0000-0000-0000-000000000002','Accounts B');
insert into auth.users (id, email) values
 ('a9110000-0000-0000-0000-0000000000a1','a911-admin@example.com'),
 ('a9110000-0000-0000-0000-0000000000f1','a911-finance@example.com'),
 ('a9110000-0000-0000-0000-0000000000c1','a911-pm@example.com'),
 ('a9110000-0000-0000-0000-0000000000f2','a911-finance-b@example.com'),
 ('a9110000-0000-0000-0000-0000000000f3','a911-finance-off@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
 ('a9110000-0000-0000-0000-0000000000a1','a9110000-0000-0000-0000-000000000001','Admin A','a911-admin@example.com','Admin','active'),
 ('a9110000-0000-0000-0000-0000000000f1','a9110000-0000-0000-0000-000000000001','Finance A','a911-finance@example.com','Finance','active'),
 ('a9110000-0000-0000-0000-0000000000c1','a9110000-0000-0000-0000-000000000001','PM A','a911-pm@example.com','Project Manager','active'),
 ('a9110000-0000-0000-0000-0000000000f2','a9110000-0000-0000-0000-000000000002','Finance B','a911-finance-b@example.com','Finance','active'),
 ('a9110000-0000-0000-0000-0000000000f3','a9110000-0000-0000-0000-000000000001','Finance off','a911-finance-off@example.com','Finance','disabled');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, status, config, activated_at) values
 ('a9110000-0000-0000-0000-000000000001','erpnext','https://erp.example.test','a911_a','active','{"company":"Example Co"}', now()),
 ('a9110000-0000-0000-0000-000000000002','erpnext','https://erp-b.example.test','a911_b','active','{"company":"Example Co"}', now());
-- The mirrored chart: A's bound company, another company A's ERP also holds, and B's company (the same name as A's, so only the org filter keeps them apart).
insert into erp_account_mirror (org_id, company, erp_name, account_name, root_type, report_type, parent_account, is_group, account_currency, lft, rgt, refresh_id, disabled) values
 ('a9110000-0000-0000-0000-000000000001','Example Co','Expenses - EC','Expenses','Expense','Profit and Loss',null,true,'IDR',1,8,gen_random_uuid(),false),
 ('a9110000-0000-0000-0000-000000000001','Example Co','Direct Expenses - EC','Direct Expenses','Expense','Profit and Loss','Expenses - EC',true,'IDR',2,5,gen_random_uuid(),false),
 ('a9110000-0000-0000-0000-000000000001','Example Co','Cost of Goods Sold - EC','Cost of Goods Sold','Expense','Profit and Loss','Direct Expenses - EC',false,'IDR',3,4,gen_random_uuid(),false),
 ('a9110000-0000-0000-0000-000000000001','Example Co','Old Expenses - EC','Old Expenses','Expense','Profit and Loss','Expenses - EC',true,'IDR',6,7,gen_random_uuid(),true),
 ('a9110000-0000-0000-0000-000000000001','Example Co','Current Assets - EC','Current Assets','Asset','Balance Sheet',null,true,'IDR',9,10,gen_random_uuid(),false),
 ('a9110000-0000-0000-0000-000000000001','Other Co','Direct Expenses - OC','Direct Expenses','Expense','Profit and Loss',null,true,'IDR',11,12,gen_random_uuid(),false),
 ('a9110000-0000-0000-0000-000000000002','Example Co','Direct Expenses - EB','Direct Expenses','Expense','Profit and Loss',null,true,'IDR',1,2,gen_random_uuid(),false);

set local role authenticated;
-- 1. who may ask
set local request.jwt.claims = '{"sub":"a9110000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select throws_ok($$select public.request_account_send('erpnext','Materials','Direct Expenses - EC','Site materials')$$, '42501', null, 'AC-ECX-031 a Project Manager cannot request an account send');
select throws_ok($$select * from public.account_send_groups('erpnext')$$, '42501', null, 'AC-ECX-031 a Project Manager cannot list the expense groups');
set local request.jwt.claims = '{"sub":"a9110000-0000-0000-0000-0000000000f3","role":"authenticated"}';
select throws_ok($$select public.request_account_send('erpnext','Materials','Direct Expenses - EC','Site materials')$$, '42501', null, 'AC-ECX-031 a disabled Finance member cannot request an account send');

-- 2. the parent must be a mirrored, enabled expense group of the bound company
set local request.jwt.claims = '{"sub":"a9110000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select throws_ok($$select public.request_account_send('erpnext','Materials','Cost of Goods Sold - EC','Site materials')$$, 'P0001', 'Choose an expense group of the connected company', 'AC-ECX-031 a leaf account is refused as the parent');
select throws_ok($$select public.request_account_send('erpnext','Materials','Current Assets - EC','Site materials')$$, 'P0001', 'Choose an expense group of the connected company', 'AC-ECX-031 a group outside the expense root is refused as the parent');
select throws_ok($$select public.request_account_send('erpnext','Materials','Direct Expenses - OC','Site materials')$$, 'P0001', 'Choose an expense group of the connected company', 'AC-ECX-031 a group of another ERP company is refused as the parent');
select throws_ok($$select public.request_account_send('erpnext','Materials','Direct Expenses - EB','Site materials')$$, 'P0001', 'Choose an expense group of the connected company', 'AC-ECX-031 another organisation''s group is refused as the parent');
select throws_ok($$select public.request_account_send('erpnext','Materials','Old Expenses - EC','Site materials')$$, 'P0001', 'Choose an expense group of the connected company', 'AC-ECX-031 a disabled group is refused as the parent');
select throws_ok($$select public.request_account_send('erpnext','Materials','No Such Group - EC','Site materials')$$, 'P0001', 'Choose an expense group of the connected company', 'AC-ECX-031 an unknown parent is refused');

-- 3. the request itself
select throws_ok($$select public.request_account_send('erpnext','Materials','Direct Expenses - EC','')$$, '22023', 'Give the account a name', 'AC-ECX-031 an empty name is refused before anything is queued');
select throws_ok($$select public.request_account_send('erpnext','Materials','Direct Expenses - EC','   ')$$, '22023', 'Give the account a name', 'AC-ECX-031 a blank name is refused before anything is queued');
select throws_ok($$select public.request_account_send('erpnext','Materials','Direct Expenses - EC',repeat('x', 141))$$, '22023', 'The account name is too long', 'an over-long name is refused');
select throws_ok($$select public.request_account_send('erpnext','Not a category','Direct Expenses - EC','Site materials')$$, '22023', 'Unknown budget category', 'an unknown budget category is refused');
select throws_ok($$select public.request_account_send('odoo','Materials','Direct Expenses - EC','Site materials')$$, 'P0001', null, 'an ERP that does not create accounts from PMO yet is refused');
select is((select count(*)::int from erp_connect_proposals where kind = 'account'), 0, 'AC-ECX-031 no refused request queued anything');

-- 4. the picker lists only enabled expense groups of the bound company, of the caller's org
select results_eq($$select erp_name from public.account_send_groups('erpnext')$$, $$values ('Expenses - EC'::text), ('Direct Expenses - EC'::text)$$, 'AC-ECX-031 Finance sees the enabled expense groups of the bound company only');
set local request.jwt.claims = '{"sub":"a9110000-0000-0000-0000-0000000000f2","role":"authenticated"}';
select results_eq($$select erp_name from public.account_send_groups('erpnext')$$, $$values ('Direct Expenses - EB'::text)$$, 'AC-ECX-031 another organisation sees its own groups only');

-- 5. a good request queues one org-scoped send, trimmed
set local request.jwt.claims = '{"sub":"a9110000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select set_config('a911.req', public.request_account_send('erpnext','Materials','Direct Expenses - EC','  Site materials  ')::text, true);
reset role;
select results_eq($$select org_id, kind, outcome, state, pmo_ids, decided_by, snapshot from erp_connect_proposals where id = current_setting('a911.req')::uuid$$,
  $$values ('a9110000-0000-0000-0000-000000000001'::uuid, 'account'::text, 'send'::text, 'sending'::text, array['Materials']::text[], 'a9110000-0000-0000-0000-0000000000f1'::uuid,
            '{"accountName":"Site materials","parentAccount":"Direct Expenses - EC"}'::jsonb)$$, 'AC-ECX-031 Finance queues one send in its own org, name trimmed, with the chosen group');
select is((select count(*)::int from audit_events where action = 'integration.account_send_request' and entity_id = current_setting('a911.req')::uuid), 1, 'the request is audited with its real actor');
set local role authenticated;
select throws_ok($$select public.request_account_send('erpnext','Materials','Direct Expenses - EC','Other name')$$, 'P0001', 'An account for this category is already on its way to the ERP', 'a second request while one is on its way is refused');
set local request.jwt.claims = '{"sub":"a9110000-0000-0000-0000-0000000000f2","role":"authenticated"}';
select is((select count(*)::int from erp_connect_proposals where kind = 'account'), 0, 'AC-ECX-031 another organisation cannot see the queued send');
set local request.jwt.claims = '{"sub":"a9110000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$select public.request_account_send('erpnext','Labor','Direct Expenses - EC','Site labour')$$, 'AC-ECX-031 an Admin may request an account send too');
reset role;

-- 6. the drain (service role, the org from the connection) claims it, and its result links the category once
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is((select count(*)::int from public.claim_connect_sends('a9110000-0000-0000-0000-000000000002','erpnext',10)), 0, 'AC-ECX-031 another organisation''s drain claims none of A''s account sends');
select is((select count(*)::int from public.claim_connect_sends('a9110000-0000-0000-0000-000000000001','erpnext',10) where kind = 'account'), 2, 'the drain claims the queued account sends');
select is(public.connect_send_existing_link('a9110000-0000-0000-0000-000000000001','erpnext','account','Materials'), null, 'a category with no account has no link yet');
select public.record_connect_send_result('a9110000-0000-0000-0000-000000000001', current_setting('a911.req')::uuid, 'Site materials - EC', null);
reset role;
select results_eq($$select org_id, category::text, erp_account, is_push_target, updated_by from budget_category_account_map where erp_account = 'Site materials - EC'$$,
  $$values ('a9110000-0000-0000-0000-000000000001'::uuid, 'Materials'::text, 'Site materials - EC'::text, true, 'a9110000-0000-0000-0000-0000000000f1'::uuid)$$,
  'AC-ECX-030 the result maps the category to the created account, in the requester''s org, as its push account');
select is((select state from erp_connect_proposals where id = current_setting('a911.req')::uuid), 'applied', 'AC-ECX-030 the send is applied');
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.connect_send_existing_link('a9110000-0000-0000-0000-000000000001','erpnext','account','Materials'), 'Site materials - EC', 'AC-ECX-030 a category that has its account answers it, so it is never sent again');
select is(public.connect_send_existing_link('a9110000-0000-0000-0000-000000000002','erpnext','account','Materials'), null, 'AC-ECX-031 another organisation''s link reader does not see A''s map');
select public.record_connect_send_result('a9110000-0000-0000-0000-000000000001', current_setting('a911.req')::uuid, 'Site materials - EC', null);
reset role;
select is((select count(*)::int from budget_category_account_map where org_id = 'a9110000-0000-0000-0000-000000000001' and category = 'Materials'), 1, 'a repeated result writes no second map row');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a9110000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select throws_ok($$select public.request_account_send('erpnext','Materials','Direct Expenses - EC','Again')$$, 'P0001', 'This category already has an account', 'a category that has its account cannot be sent again');
reset role;

-- 7. a refused send is a decision row; asking again settles it and queues a fresh send
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.record_connect_send_result('a9110000-0000-0000-0000-000000000001',
  (select id from erp_connect_proposals where kind = 'account' and pmo_ids[1] = 'Labor'), null, 'The ERP refused this account: Parent account can not be a ledger');
reset role;
select results_eq($$select outcome, reason, state from erp_connect_proposals where kind = 'account' and pmo_ids[1] = 'Labor'$$, $$values ('review'::text, 'rejected'::text, 'open'::text)$$,
  'a refused account send waits as a decision in plain words');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a9110000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select lives_ok($$select public.request_account_send('erpnext','Labor','Direct Expenses - EC','Site labour')$$, 'Finance asks again after a refusal');
reset role;
select results_eq($$select outcome, state from erp_connect_proposals where kind = 'account' and pmo_ids[1] = 'Labor' order by state$$,
  $$values ('review'::text, 'dismissed'::text), ('send'::text, 'sending'::text)$$, 'asking again dismisses the refusal and queues one fresh send');

-- 9. what is stored per outcome of an account send (#1599): the outbox row under seed:account:<category>, and the words Finance reads.
--    Clients never work in the ERP: no stored account text points into it; a party send keeps its 0494 wording.
insert into erp_connect_proposals (org_id, binding_id, external_tier, kind, outcome, identity, pmo_ids, external_ids, snapshot, state, decided_by, decided_at)
select 'a9110000-0000-0000-0000-000000000001', b.id, 'erpnext', v.kind, 'send', 'send|' || v.pmo || '|[]|a911', array[v.pmo], '{}', '{}', 'sending',
       'a9110000-0000-0000-0000-0000000000f1', now()
  from external_org_bindings b,
       (values ('account','Equipment'), ('account','Subcontractors'), ('account','Overheads'), ('party','a911-party'), ('party','a911-party-2')) v(kind, pmo)
 where b.org_id = 'a9110000-0000-0000-0000-000000000001' and b.external_tier = 'erpnext';
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
-- the money outbox accepts the account domain and key: one row per category, created, claimed and confirmed
select lives_ok($$insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state)
  values ('a9110000-0000-0000-0000-000000000001', 'accounts', 'Equipment', 'seed:account:Equipment', 'erpnext', 'create', 'pending')$$, 'AC-ECX-030 the outbox takes an account send under seed:account:<category>');
select throws_ok($$insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state)
  values ('a9110000-0000-0000-0000-000000000001', 'accounts', 'Equipment', 'seed:account:Equipment', 'erpnext', 'create', 'pending')$$, '23505', null,
  'AC-ECX-030 a second outbox row for the same category and key is refused (one create per category)');
select is((select (public.claim_outbox_for_commit(id, interval '5 minutes')).state from external_command_outbox where idempotency_key = 'seed:account:Equipment'), 'committing', 'the account send is claimed for its one create');
-- the commit writes the ERP name back under the claim's generation (the outbox's fenced write), then confirms
update external_command_outbox set state = 'committed', external_record_id = 'Equipment - EC' where idempotency_key = 'seed:account:Equipment' and state = 'committing';
select is(public.confirm_outbox((select id from external_command_outbox where idempotency_key = 'seed:account:Equipment'),
  (select claim_generation from external_command_outbox where idempotency_key = 'seed:account:Equipment')), 1, 'the created account confirms the outbox row');
select results_eq($$select state, external_record_id, domain, pmo_record_id from external_command_outbox where idempotency_key = 'seed:account:Equipment'$$,
  $$values ('confirmed'::text, 'Equipment - EC'::text, 'accounts'::text, 'Equipment'::text)$$, 'AC-ECX-030 the outbox stores a created account as confirmed, with its ERP name');
-- success: linked and applied; a note saying where an account already held elsewhere was linked stays on the applied row
update erp_connect_proposals set snapshot = '{"accountName":"Equipment","parentAccount":"Direct Expenses - EC"}'
 where org_id = 'a9110000-0000-0000-0000-000000000001' and pmo_ids[1] = 'Equipment' and state = 'sending';
select public.record_connect_send_result('a9110000-0000-0000-0000-000000000001', (select id from erp_connect_proposals where pmo_ids[1] = 'Equipment'), 'Equipment - EC', null, 'Expenses - EC');
select results_eq($$select outcome, state, reason_text from erp_connect_proposals where pmo_ids[1] = 'Equipment'$$,
  $$values ('send'::text, 'applied'::text, 'Equipment already exists under Expenses - EC; linked there.'::text)$$, 'AC-ECX-030 a linked account send is applied and keeps the note of where it was linked');
select is((select erp_account from budget_category_account_map where org_id = 'a9110000-0000-0000-0000-000000000001' and category = 'Equipment'), 'Equipment - EC', 'AC-ECX-030 the linked account is the category''s map row');
-- a permission refusal: the one sentence for Finance, a decision row, no map row
select public.record_connect_send_result('a9110000-0000-0000-0000-000000000001', (select id from erp_connect_proposals where pmo_ids[1] = 'Subcontractors'), null,
  'PMO could not create the account; your administrator has been told.');
select results_eq($$select outcome, reason, state, reason_text from erp_connect_proposals where pmo_ids[1] = 'Subcontractors'$$,
  $$values ('review'::text, 'rejected'::text, 'open'::text, 'PMO could not create the account; your administrator has been told.'::text)$$, 'AC-ECX-030 a refused account send stores the plain sentence as a decision');
select is((select count(*)::int from budget_category_account_map where org_id = 'a9110000-0000-0000-0000-000000000001' and category = 'Subcontractors'), 0, 'AC-ECX-030 a refused account send maps nothing');
-- undecided (held): the account text names no ERP step; a party keeps its own
select public.record_connect_send_held('a9110000-0000-0000-0000-000000000001', (select id from erp_connect_proposals where pmo_ids[1] = 'Overheads'));
select public.record_connect_send_held('a9110000-0000-0000-0000-000000000001', (select id from erp_connect_proposals where pmo_ids[1] = 'a911-party'));
select results_eq($$select reason, reason_text from erp_connect_proposals where pmo_ids[1] = 'Overheads'$$,
  $$values ('held'::text, 'PMO could not confirm whether the account was created; your administrator has been told.'::text)$$, 'AC-ECX-030 an undecided account send tells Finance the administrator has been told, never to look in the ERP');
select is((select reason_text from erp_connect_proposals where pmo_ids[1] = 'a911-party'),
  'We could not confirm whether the ERP created this record. Look for it in the ERP by name and tax id; if it is not there, send it again.', 'a held party send keeps its own wording');
-- the last try: five failures end an account send with the same sentence; a party keeps its own
update erp_connect_proposals set outcome = 'send', reason = null, reason_text = null, state = 'sending', send_failures = 4 where pmo_ids[1] in ('Overheads', 'a911-party-2');
select is(public.record_connect_send_failure('a9110000-0000-0000-0000-000000000001', (select id from erp_connect_proposals where pmo_ids[1] = 'Overheads')), true, 'the fifth failure ends the account send');
select is((select reason_text from erp_connect_proposals where pmo_ids[1] = 'Overheads'), 'PMO could not create the account; your administrator has been told.',
  'AC-ECX-030 an account send that failed on every try tells Finance the administrator has been told');
select is(public.record_connect_send_failure('a9110000-0000-0000-0000-000000000001', (select id from erp_connect_proposals where pmo_ids[1] = 'a911-party-2')), true, 'the fifth failure ends the party send');
select is((select reason_text from erp_connect_proposals where pmo_ids[1] = 'a911-party-2'), 'We could not finish sending this record. Check it in the ERP, then try again.', 'a party send that failed on every try keeps its own wording');
reset role;

-- 8. grants: the two functions are for signed-in members only; the drain's writers stay service-only
select ok(not has_function_privilege('anon', 'public.request_account_send(text, text, text, text)', 'execute'), 'anon cannot request an account send');
select ok(not has_function_privilege('authenticated', 'public.connect_send_existing_link(uuid, text, text, text)', 'execute'), 'members cannot call the drain''s link reader');
select ok(not has_function_privilege('authenticated', 'public.record_connect_send_result(uuid, uuid, text, text)', 'execute'), 'members cannot write a send result');

select ok(not has_function_privilege('anon', 'public.record_connect_send_result(uuid, uuid, text, text, text)', 'execute'), 'anonymous callers cannot record an account result');
select ok(not has_function_privilege('authenticated', 'public.record_connect_send_result(uuid, uuid, text, text, text)', 'execute'), 'members cannot record an account result');
select ok(has_function_privilege('service_role', 'public.record_connect_send_result(uuid, uuid, text, text, text)', 'execute'), 'service role can record an account result');
set local role service_role;
select throws_ok(format('select public.record_connect_send_result(%L::uuid, %L::uuid, %L, null, %L)', 'a9110000-0000-0000-0000-000000000002', current_setting('a911.req'), 'x', 'group'), 'P0002', null, 'an account result cannot cross organizations');
reset role;

-- An actuals-only account is compatible with creating the missing push target.
set local role authenticated;
set local request.jwt.claims = '{"sub":"a9110000-0000-0000-0000-0000000000a1","role":"authenticated"}';
insert into public.budget_category_account_map (org_id, category, erp_account, is_push_target)
values ('a9110000-0000-0000-0000-000000000001', 'Vehicle', 'Existing actuals only - EC', false);
reset role;
set local role service_role;
select is(public.connect_send_existing_link('a9110000-0000-0000-0000-000000000001','erpnext','account','Vehicle'), null, 'AC-ECX-030 an actuals-only row is not a push-target link');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a9110000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select lives_ok($$select public.request_account_send('erpnext','Vehicle','Direct Expenses - EC','Vehicle budget')$$, 'AC-ECX-031 Finance can request a missing push target alongside an actuals-only account');
reset role;
set local role service_role;
select is(public.record_connect_send_result('a9110000-0000-0000-0000-000000000001', (select id from erp_connect_proposals where kind='account' and pmo_ids[1]='Vehicle' and state='sending'), 'Vehicle budget - EC', null, 'Direct Expenses - EC'), true, 'the created push target reports applied');
reset role;
select results_eq($$select erp_account, is_push_target from budget_category_account_map where org_id='a9110000-0000-0000-0000-000000000001' and category='Vehicle' order by erp_account$$,
 $$values ('Existing actuals only - EC'::text, false), ('Vehicle budget - EC'::text, true)$$, 'AC-ECX-030 the result preserves the actuals-only account and adds the push target');

-- A person choosing a push target while the send waits keeps their explicit choice.
set local role authenticated;
set local request.jwt.claims = '{"sub":"a9110000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select lives_ok($$select public.request_account_send('erpnext','Special expenses','Direct Expenses - EC','Requested account')$$, 'an unmapped category may queue a send');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a9110000-0000-0000-0000-0000000000a1","role":"authenticated"}';
insert into public.budget_category_account_map (org_id, category, erp_account, is_push_target)
values ('a9110000-0000-0000-0000-000000000001', 'Special expenses', 'Manually chosen - EC', true);
reset role;
set local role service_role;
select is(public.connect_send_existing_link('a9110000-0000-0000-0000-000000000001','erpnext','account','Special expenses'), 'Manually chosen - EC', 'the drain sees the manually chosen push target');
select is(public.record_connect_send_result('a9110000-0000-0000-0000-000000000001', (select id from erp_connect_proposals where kind='account' and pmo_ids[1]='Special expenses' and state='sending'), 'Requested account - EC', null, 'Direct Expenses - EC'), false, 'a conflicting manual push choice is not reported as applied');
reset role;
select results_eq($$select erp_account, is_push_target from budget_category_account_map where org_id='a9110000-0000-0000-0000-000000000001' and category='Special expenses'$$,
 $$values ('Manually chosen - EC'::text, true)$$, 'a competing push target is never overwritten');
select results_eq($$select outcome, state from erp_connect_proposals where kind='account' and pmo_ids[1]='Special expenses'$$,
 $$values ('review'::text, 'open'::text)$$, 'a conflicting result remains operator-visible instead of reporting a link');

select * from finish();
rollback;
