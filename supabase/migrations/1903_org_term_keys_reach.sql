-- 1903_org_term_keys_reach.sql — the general terms that had no rename key get one (#2799, slice A).
--
-- 1491 made the accepted keys a seeded table: a new nameable term is one inserted key and the foreign key on
-- org_terminology never changes. This adds the 23 general terms the product names on screens, in emails and on prints
-- (service request, purchase order, daily site report, survey quantity, quantity change request, transfer between work
-- orders, billing plan, billing step, handover certificate, stock transfer, stock receipt, stock return, reservation,
-- crew, roster, issue, checkpoint, milestone, daily target, root cause, safety record, candidate work order, close-out).
-- The key list is the front-end registry (pmo-portal/src/lib/i18n/terms.registry.json); orgTerms.registry.test.ts fails
-- if the two differ. No policy, grant or existing row changes: the key table stays code-owned reference data.
-- Reversal: supabase/migrations/rollback/1903_org_term_keys_reach_down.sql

insert into public.org_term_keys (term_key) values
  ('serviceRequest'), ('purchaseOrder'), ('dailySiteReport'), ('surveyQuantity'), ('quantityChangeRequest'),
  ('workOrderTransfer'), ('billingPlan'), ('billingStep'), ('handoverCertificate'), ('stockTransfer'), ('stockReceipt'),
  ('stockReturn'), ('reservation'), ('crew'), ('roster'), ('issue'), ('checkpoint'), ('milestone'), ('dailyTarget'),
  ('rootCause'), ('safetyRecordType'), ('candidateWorkOrder'), ('closeOut')
on conflict (term_key) do nothing;

-- Closing self-assertion: 16 from 1491 plus the 23 above, and every override names a seeded key.
do $$
begin
  if (select count(*) from public.org_term_keys) <> 39 then
    raise exception '1903: org_term_keys must carry the 39 accepted terms';
  end if;
end $$;
