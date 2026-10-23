-- Round trip for 0368 (#1319 slice G review): down, then up again. Run by
-- scripts/test-procurement-payment-allowed-rollback.sh, which inlines the migration files at the markers.
begin;
select plan(8);
-- @0368_DOWN@
select hasnt_function('public','procurement_payment_allowed', array['uuid'], 'down 0368: the payment rule function is gone');
select ok((select prosrc not like '%procurement-payment-refused%' from pg_proc where oid = 'public.claim_outbox_for_commit(uuid,interval)'::regprocedure),
  'down 0368: the claim is 0262''s body');
select ok((select prosrc not like '%awaiting_approval%' from pg_proc where oid = 'public.procurement_gate_violation(uuid,procurement_status)'::regprocedure),
  'down 0368: the gate is 0360''s body');
select ok((select prosrc like '%procurement_gate(old.org_id, ''approval_before_payment'')%' from pg_proc where oid = 'public.guard_procurement_approved_total()'::regprocedure),
  'down 0368: the guard is 0362''s body');
-- @0368_UP@
select has_function('public','procurement_payment_allowed', array['uuid'], 'up again: the payment rule function');
select ok((select prosrc like '%procurement-payment-refused%' from pg_proc where oid = 'public.claim_outbox_for_commit(uuid,interval)'::regprocedure),
  'up again: the claim re-checks a queued payment');
select ok((select prosrc like '%awaiting_approval%' from pg_proc where oid = 'public.procurement_gate_violation(uuid,procurement_status)'::regprocedure),
  'up again: the gate refuses while awaiting approval');
select ok(has_function_privilege('service_role','public.claim_outbox_for_commit(uuid,interval)','execute')
          and not has_function_privilege('authenticated','public.claim_outbox_for_commit(uuid,interval)','execute'),
  'up again: the claim keeps its service-role-only grant');
select * from finish();
rollback;
