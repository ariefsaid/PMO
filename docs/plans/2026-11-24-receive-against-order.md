# Receive against order implementation

Spec: `docs/specs/receive-against-order.spec.md`. Lane: `feat/1124d-receive-against-order`, migrations 2220–2239.

1. Add pgTAP receipt contracts, run them on the spare runner and retain the initial failure.
2. Add opt-in settings guarded against ERP ownership, purchasing-owned stock mappings, immutable receipt intents and their counted quantities. Serialize every writer on the purchase row. Use the existing stock posting writer and existing receipt-match lines.
3. Add blind receiving and purchasing progress reads. Apply the receiving blind boundary to existing granted ordered-line readers. Add mutation proofs for mapping authority, valuation, over-receipt, approval separation and tenancy.
4. Add repository and purchasing/receiving components using shared primitives, English/Bahasa translations and role policy gates. Keep the disabled path unchanged.
5. Run guards, typecheck, touched ESLint and touched unit files. Push source; run only touched pgTAP on the spare runner. Browser journeys and rendered proofs belong to the integration executor under the dispatch's shared-machine restriction.

## Valuation and ownership

The Director approved receipt-date JISDOR snapshots in organisation currency; missing rate refuses with pair/date, same currency uses 1. Existing supplier bills and three-way match stay in purchase currency. This lane applies only while PMO owns both purchasing and inventory; the setting refuses enablement under either ERP owner. Connected inventory receiving and valuation remain a separate follow-up.

## Traceability

Planned: `supabase/tests/2220_receive_against_order.test.sql` will own AC-RGO-001 through AC-RGO-011; currently it contains only four failing schema-contract assertions. The receiving component test will own AC-RGO-012; it has not been authored. A mutation is evidence only when the owning assertion actually fails with the rule broken and then passes restored.
