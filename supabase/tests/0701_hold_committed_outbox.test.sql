-- 0701_hold_committed_outbox.test.sql
-- AC-OPP-062 — hold_committed_outbox: the fenced committed -> held transition (#1902).
begin;
select plan(8);

insert into organizations (id, name) values ('07010000-0000-0000-0000-00000000000a','Hold Committed Org');

insert into external_command_outbox (id, org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, claim_generation)
values
  ('07010000-0000-0000-0000-0000000000f1','07010000-0000-0000-0000-00000000000a','procurement','po-hc-1','k-hc-1','odoo','create','committed',3),
  ('07010000-0000-0000-0000-0000000000f2','07010000-0000-0000-0000-00000000000a','procurement','po-hc-2','k-hc-2','odoo','create','confirmed',1),
  ('07010000-0000-0000-0000-0000000000f3','07010000-0000-0000-0000-00000000000a','procurement','po-hc-3','k-hc-3','odoo','create','committing',1);

select is(hold_committed_outbox('07010000-0000-0000-0000-0000000000f1', 2, 'r'), 0,
  'AC-OPP-062: a superseded generation holds nothing');
select is((select state from external_command_outbox where id = '07010000-0000-0000-0000-0000000000f1'), 'committed',
  'AC-OPP-062: the stale-generation call left the row committed');
select is(hold_committed_outbox('07010000-0000-0000-0000-0000000000f2', 1, 'r'), 0,
  'AC-OPP-062: a confirmed row is never held');
select is(hold_committed_outbox('07010000-0000-0000-0000-0000000000f3', 1, 'r'), 0,
  'AC-OPP-062: a committing row is not this transition');
select is(hold_committed_outbox('07010000-0000-0000-0000-0000000000f1', 3, 'committed-anchor-owned-elsewhere: x'), 1,
  'AC-OPP-062: the current generation holds the committed row');
select is((select state || '|' || last_error from external_command_outbox where id = '07010000-0000-0000-0000-0000000000f1'),
  'held|committed-anchor-owned-elsewhere: x', 'AC-OPP-062: held with the stable reason recorded');
select is(hold_committed_outbox('07010000-0000-0000-0000-0000000000f1', 3, 'again'), 0,
  'AC-OPP-062: a second call is a no-op once held');

set local role authenticated;
select throws_ok($$ select hold_committed_outbox('07010000-0000-0000-0000-0000000000f1', 3, 'x') $$, '42501', null,
  'AC-OPP-062: authenticated users cannot call it (service_role only)');
reset role;

select * from finish();
rollback;
