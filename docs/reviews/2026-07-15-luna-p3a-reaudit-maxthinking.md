# Luna P3a money re-audit (gpt-5.6-luna, --thinking max, 2026-07-15)

Verdict: **NO SHIP** — 8 BLOCK + 2 SHOULD-FIX. Director-verified real (BLOCK 2/4/8 spot-checked).
Theme: happy-path e2e (19/19 green) hand-builds correct commands; the dispatch/repo layer lacks
authorization, transition-targeting, and reference hardening for adversarial/real-FE inputs.
Hardening round dispatched. Findings verbatim below.

---

Subagent async grouped result intercom delivery was not acknowledged for '/var/folders/6q/rvc4t63n3ps7g5w5ckgl59qm0000gp/T/pi-subagents-uid-502/async-subagent-results/0fde64b4-1084-4e6e-9dcb-7c886abccc71.json'.
## Verdict: **NO SHIP**

No files edited.

### Prior findings

- **BLOCK1 — REOPENED.** `recoveryProbe.ts:115-126` correctly filters normal composite probes, but fallback paths call the unfiltered probe:
  - `supabase/functions/adapter-dispatch/index.ts:245-247`
  - `supabase/functions/erpnext-sweep/index.ts:439-440`  
  A Receive recovery with incomplete composite data can still adopt a Pay entry sharing its `reference_no`.

- **BLOCK2 — REOPENED.** Exact `transition/verb:'submit'` is gated at `index.ts:476-485`, but:
  - `adapter.ts:149-150` allows `amend`
  - `adapter.ts:165-185` recreates **and submits** the new SI without SoD
  - `adapter.ts:197-208` routes `update` of a submitted SI into that amend path  
  The author can amend a submitted SI and self-submit the replacement.

- **BLOCK3 — CLOSED.** `0106_sales_invoices_mirror_guard_author.sql:31` pins `author_user_id`.

- **BLOCK4 — REOPENED for recovery.** Normal create stamping is present at `readModelWriters.ts:486-492`, but sweep finalization calls the writer without `callerUserId` at `erpnext-sweep/index.ts:455-456`. A committed SI whose mirror failed can be finalized with `author_user_id = NULL`, making SoD a no-op.

- **BLOCK5 — CLOSED on the normal repository path.** `repositories/index.ts:461-468` maps snake_case fields, and adapter resolution mutates `references` before money payload construction (`index.ts:550-556`, `dispatchFactory.ts:179-194`). Direct malformed commands remain unsafe; see findings below.

- **SF6 — CLOSED** for outbound mirror updates (`readModelWriters.ts:517-545`).

- **SF7 — CLOSED only for mirror insertion.** `assertLinkSameOrg` exists (`readModelWriters.ts:432-448`), but validation still occurs after ERP commit; see the orphan-money finding below.

- **SF8 — CLOSED.** `0107_process_gates_org_guard.sql:18-25` correctly guards user reads and preserves the service-role dispatch path.

### New / remaining blockers

1. **BLOCK — Payment Entry sweep is not disambiguated.**  
   `erpnext-sweep/index.ts:60-62,252-285` polls the same `Payment Entry` doctype once for `payment` and once for `incoming-payment`, with no `payment_type` filter and without fetching `payment_type`. A Pay entry can be adopted into `incoming_payments`, creating a wrong-domain mirror.

2. **BLOCK — UI transition commands cannot execute.**  
   `repositories/index.ts:473-503` omits both `verb` and `externalRecordId`. `adapter.ts:126-153` rejects the transition before ERP submission. The real UI Submit/Cancel actions therefore fail; only the bespoke e2e helper supplies the missing fields.

3. **BLOCK — Transition target is unbound to the PMO mapping.**  
   SoD checks `record.id` (`index.ts:476-477`), but ERP operates on arbitrary client-supplied `record.externalRecordId` (`adapter.ts:126-145`). A caller can pass an authorized/null-author PMO ID while targeting another SI, or target a Pay Payment Entry through `incoming-payment`.

4. **BLOCK — Direct dispatch lacks ownership, role, and kind/domain enforcement.**  
   `index.ts:423-434` verifies only active membership/org. `ADAPTER_REGISTRY` (`index.ts:345-351`) accepts `revenue` without checking `external_domain_ownership`, caller role, or `KIND_DOMAIN`. An active unauthorized member, or a `procurement` command carrying `erp_doc_kind:'incoming-payment'`, can cause an ERP money write before the mirror writer rejects it.

5. **BLOCK — Raw PE references fail open.**  
   If `resolveRevenueRefs` cannot resolve `salesInvoiceId`, it leaves caller-supplied `references` untouched (`dispatchFactory.ts:179-195`), and `peReceiveToBody` sends them (`incomingPayment.ts:28-29`). A direct command can receive money against an arbitrary ERP SI while PMO records the payment as on-account or against a different SI.

6. **BLOCK — Cross-org validation happens after the external write.**  
   `readModelWriters.ts:537-547` rejects a cross-org `salesInvoiceId`, but only after `recordOutboxRef` and the ERP commit (`dispatch.ts:167-179`). A valid customer plus another-org SI can create a real on-account ERP receipt, then fail mirror insertion, leaving committed money with no PMO row.

7. **BLOCK — Inbound adoption loses customer/payment links.**  
   `siFromDoc` omits `customer` (`salesInvoice.ts:29-41`); `peReceiveFromDoc` omits `customer`, `posting_date`, and `references` (`incomingPayment.ts:34-44`). `erpnextFeedDeps.ts:92-140` consequently adopts native SI rows with `customer_id=NULL` and native Receive entries with `sales_invoice_id=NULL`.

8. **BLOCK — SI cancel auto-unlink reconciliation is unwired.**  
   The helper exists at `transitionPolicy.ts:54-73`, but no writer invokes it. SI cancel updates only the SI (`readModelWriters.ts:456-506`), while feed updates only lifecycle columns (`erpnextFeedDeps.ts:209-219`). ERP auto-unlinks a referenced Receive PE, but PMO retains the stale `sales_invoice_id`.

9. **SHOULD-FIX — Project gate can pass without an ERP project.**  
   The gate checks only non-null `projectId` (`index.ts:507-515`); a missing `project_map` entry yields `ctx.refs.project=null` (`dispatchFactory.ts:172-175`), and `salesInvoice.ts:25` omits the ERP project. PMO shows project-attributed revenue while ERP GL lacks the project dimension.

10. **SHOULD-FIX — Partial `process_gates` objects bypass defaults.**  
    `0107_process_gates_org_guard.sql:22-26` returns a partial JSON object unchanged. With `process_gates:{}`, `index.ts:507-510` sees `require_project_on_si` as `undefined` and treats it as false.

### Procurement invariant

**Confirmed unchanged:** purchase-invoice and Pay payment entries remain `submittable:true` without `submitOnCreate:false` (`doctypeRegistry.ts:77-89`), and `adapter.ts:91,101-108` still performs POST → submit → refetch.

The standard same-key PE recovery remains held/no-reissue, but the blockers above make the P3a money path unsafe.
__PI_EXIT_0__
