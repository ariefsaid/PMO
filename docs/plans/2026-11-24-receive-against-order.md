# Receive against order implementation

Spec: `docs/specs/receive-against-order.spec.md`. Lane: `feat/1124d-receive-against-order`, migrations 2220–2239.

1. Completed: initial four schema contracts observed red on the spare runner before implementation.
2. Completed: 2220 settings, mappings, receipt intent, role-scoped readers; 2221 existing receiving/match integration; 2222 reversing movements.
3. Completed: 2223 shared masked price boundary; 2224 shared purchasing inbox; 2225 draft authoring retained within blind order reads; 2226 explicit new rental quantities for blind receivers; 2227 immutable per-line excess approval snapshots and fresh review after an intervening receipt.
4. Completed: typed DAL/repository/hooks, opt-in route, purchaser mapping/progress, blind counted-quantity form, approval/reversal actions, existing record progress, English/Bahasa copy and real-role policy gates.
5. Verification results and candidate identities are recorded in `docs/briefs/decisions-1124/receive-report.md`. The integration executor owns rendered captures and `ux-proof` under the Director's explicit ruling; no local browser journeys or database resets were run.

## Valuation and ownership

The Director approved receipt-date JISDOR snapshots in organisation currency; missing rate refuses with pair/date, same currency uses 1. Existing supplier bills and three-way match stay in purchase currency. This lane applies only while PMO owns both purchasing and inventory; the setting refuses enablement under either ERP owner. Connected inventory receiving and valuation remain a separate follow-up.

## Traceability

`supabase/tests/2220_receive_against_order.test.sql` owns AC-RGO-001 through AC-RGO-011. `pmo-portal/pages/stock/OrderReceivingLines.test.tsx` owns AC-RGO-012 in both languages. The receiving workflow, route fallback, purchase-record progress, policy, shared inbox registry and refusal wording have supporting unit tests. Mutation probes require a true baseline behaviour oracle, observe that oracle fail with its rule broken, and roll back each mutation and its writes.
