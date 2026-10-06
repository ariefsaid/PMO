-- client_starting_data_sequence.test.sql — the exact calls `pmo load` makes for a won project
-- (scripts/lib/pmo-load.mjs applyLoad), run as an active Admin (#796, AC-CSD-015). Pins that the load
-- lands at the real stage through the shipped RPCs, with every step audited to the Admin.
begin;
select plan(9);

insert into auth.users (id, email) values ('07960000-0000-0000-0000-0000000000b1', 'seq-admin@example.com');
insert into public.profiles (id, org_id, full_name, email, role, status) values
  ('07960000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000001', 'Seq Admin', 'seq-admin@example.com', 'Admin', 'active');
insert into public.companies (id, org_id, name, type) values
  ('07960000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000001', 'Sequence Client Co', 'Client');

set local role authenticated;
set local request.jwt.claims = '{"sub":"07960000-0000-0000-0000-0000000000b1","role":"authenticated"}';

insert into public.projects (id, code, name, status, client_id)
  values ('07960000-0000-0000-0000-0000000000d1', 'SEQ-001', 'Sequence project', 'Leads', '07960000-0000-0000-0000-0000000000c1');
select lives_ok($$ select public.set_project_contract_value('07960000-0000-0000-0000-0000000000d1', 1000000, 'exclusive', 110000) $$,
  'AC-CSD-015 an Admin sets the contract value of a Lead');
select lives_ok($$ select public.transition_project('07960000-0000-0000-0000-0000000000d1', 'PQ Submitted') $$,
  'AC-CSD-015 Leads -> PQ Submitted');
select lives_ok($$ select public.transition_project('07960000-0000-0000-0000-0000000000d1', 'Quotation Submitted') $$,
  'AC-CSD-015 PQ Submitted -> Quotation Submitted');
select lives_ok($$ select public.transition_project('07960000-0000-0000-0000-0000000000d1', 'Won, Pending KoM', 'PO-SEQ-1', '2025-02-01') $$,
  'AC-CSD-015 the Admin wins it (holds won-value authority: no second person needed)');
select lives_ok($$ select public.transition_project('07960000-0000-0000-0000-0000000000d1', 'Ongoing Project') $$,
  'AC-CSD-015 Won, Pending KoM -> Ongoing Project');

reset role;
select results_eq(
  $$ select status::text, contract_value, customer_contract_ref, contract_date, decided_at::date
       from public.projects where id = '07960000-0000-0000-0000-0000000000d1' $$,
  $$ values ('Ongoing Project'::text, 1000000::numeric, 'PO-SEQ-1'::text, '2025-02-01'::date, '2025-02-01'::date) $$,
  'AC-CSD-015 the project stands at its real stage with its value and win artifacts (decided on the contract date)');
select is(
  (select count(*)::int from public.audit_events
    where entity_id = '07960000-0000-0000-0000-0000000000d1' and action = 'project.create'
      and actor_id = '07960000-0000-0000-0000-0000000000b1'),
  1, 'AC-CSD-015 the create is audited to the Admin');
select is(
  (select count(*)::int from public.audit_events
    where entity_id = '07960000-0000-0000-0000-0000000000d1' and action = 'project.contract_value.set'
      and actor_id = '07960000-0000-0000-0000-0000000000b1'),
  1, 'AC-CSD-015 the value is audited to the Admin');
-- Ordered by the step text: created_at is now() (transaction time), so every row in this one-transaction
-- test ties and the uuid id is random — neither gives a stable order.
select is(
  (select array_agg((detail ->> 'from') || '->' || (detail ->> 'to')
                    order by (detail ->> 'from') || '->' || (detail ->> 'to'))
     from public.audit_events
    where entity_id = '07960000-0000-0000-0000-0000000000d1' and action = 'project.transition'
      and actor_id = '07960000-0000-0000-0000-0000000000b1'),
  array['Leads->PQ Submitted', 'PQ Submitted->Quotation Submitted',
        'Quotation Submitted->Won, Pending KoM', 'Won, Pending KoM->Ongoing Project'],
  'AC-CSD-015 every stage step is audited to the Admin');

select * from finish();
rollback;
