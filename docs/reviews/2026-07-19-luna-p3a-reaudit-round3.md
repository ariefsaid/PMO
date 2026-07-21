Subagent async grouped result intercom delivery was not acknowledged for '/var/folders/6q/rvc4t63n3ps7g5w5ckgl59qm0000gp/T/pi-subagents-uid-502/async-subagent-results/95895023-6e0e-4a7b-b6f3-46c8e1d1f89c.json'.
## Verdict: **NO SHIP**

Read-only audit; no files edited or committed.

### Prior findings / closure status

- **BLOCK1 — REOPENED.** Fallback recovery still uses an unfiltered anchor probe (`index.ts:255-257`, `erpnext-sweep/index.ts:470-478`).
- **BLOCK2 — CLOSED for SI self-approval.** SI amend replacements remain drafts (`adapter.ts:183-190`) and submit is SoD-gated (`index.ts:495-510`); arbitrary transition targets remain open below.
- **BLOCK3 — CLOSED.** `author_user_id` is pinned by the mirror trigger (`0106_sales_invoices_mirror_guard_author.sql:19-36`).
- **BLOCK4 — CLOSED for actor recovery.** Actor identity is persisted (`index.ts:238-243`) and threaded during sweep finalization (`erpnext-sweep/index.ts:485-490`); NULL authors now fail closed (`0108_process_gates_merge_and_sod_author_guard.sql:103-111`).
- **BLOCK5 — CLOSED on the normal repository path.** PE references are rebuilt server-side (`dispatchFactory.ts:276-292`); fallback recovery remains unsafe.
- **SF6 — CLOSED for outbound mirror updates.**
- **SF7 — PARTIAL.** Cross-org preflight now precedes ERP work (`dispatchFactory.ts:390-395`), but remains non-atomic.
- **SF8 — CLOSED.** Org-guarded process-gate reads are present (`0107_process_gates_org_guard.sql:18-26`).

### Twelve claimed closures

1. Recovery discriminator — **REOPENED**.
2. SI amend SoD — **CLOSED**.
3. Actor identity — **CLOSED**.
4. Payment Entry sweep disambiguation — **CLOSED for normal sweeps** (`erpnext-sweep/index.ts:285-314`).
5. Direct-dispatch authorization — **CLOSED for ownership/role/kind** (`authGuard.ts:40-78`), but target binding is incomplete.
6. Cross-org validation — **PARTIAL**; TOCTOU remains.
7. PE reference rebuilding — **CLOSED for valid commands**.
8. Inbound customer/payment links — **PARTIAL/REOPENED** on sweep and event-order paths.
9. SI-cancel unlinking — **CLOSED** (`readModelWriters.ts:547-550`, `erpnextFeedDeps.ts:169-183`).
10. Project resolution — **PARTIAL**; lifecycle transitions bypass the gate.
11. Process-gate default merging — **CLOSED** (`0108_process_gates_merge_and_sod_author_guard.sql:52-70`).
12. NULL-author rejection — **CLOSED as security hardening**, but inbound drafts have no attribution workflow.

### Ranked remaining findings

1. **BLOCK — Recovery can adopt the wrong ERP document.**  
   `client.ts:251-253` interpolates the caller’s key into a `LIKE` pattern without escaping. A direct caller can use `%` or `_`; `dispatch.ts:199-206` then adopts the first matching ERP document without posting. PE fallback also omits the `payment_type` discriminator (`index.ts:255-257`, `erpnext-sweep/index.ts:470-478`).  
   **Money path:** a Finance caller can map a PMO command to another SI/PE, then cancel or submit the wrong document. Reusing a normal key across PMO IDs is also possible because uniqueness is `(org, domain, pmo_record_id, key)` (`0096_erpnext_seam_tables.sql:52-77`).

2. **BLOCK — Non-SI transitions have no PMO target binding.**  
   `transitionTargetGuard.ts:42-59` only protects revenue Sales Invoice transitions and permits missing mappings. The adapter operates directly on caller-supplied `externalRecordId` (`adapter.ts:121-150`).  
   **Money path:** an authorized caller can submit `incoming-payment` with a random PMO ID and another Payment Entry name, or cancel a Pay PE through the Receive kind. The mirror update does not require a matching row (`readModelWriters.ts:597-604`).

3. **BLOCK — Finalization is not retry-idempotent after a crash.**  
   Finalization records the ref, inserts the mirror, then confirms (`dispatch.ts:167-179`). A crash after the mirror insert leaves the outbox `committed`; retry re-enters a fixed-PK `insert` (`dispatch.ts:281-288`, `readModelWriters.ts:519-538`).  
   **Money path:** the ERP commit succeeds, but recovery repeatedly fails on duplicate mirror insertion and never reaches `confirmed`.

4. **BLOCK — Caller-controlled PMO IDs permit ref overwrite after an ERP write.**  
   The endpoint validates only that `record.id` is truthy (`index.ts:456-460`). A caller can reuse an existing `sales_invoices.id`; `record_outbox_ref` overwrites that PMO record’s external mapping (`0096_erpnext_seam_tables.sql:226-230`) before the mirror insert hits the existing-PK error (`readModelWriters.ts:530-538`).  
   **Money path:** an existing PMO invoice can be repointed to a new ERP document, losing the old external identity and enabling later operations against the wrong document.

5. **BLOCK — ERP POST has no timeout, but recovery reissues after five minutes.**  
   `client.ts:126-130` has no `AbortSignal` or request deadline. Quarantine becomes claimable after `claimed_at + 5 minutes` (`0096_erpnext_seam_tables.sql:164-176`), and immutable-anchor recovery reissues on a probe miss (`dispatch.ts:311-320`).  
   **Money path:** a delayed SI/PI POST can still commit after recovery starts a second POST, producing duplicate ERP money documents.

6. **BLOCK — Sweep adoption drops financial fields and cannot repair links.**  
   Sweep fetches only lifecycle fields (`erpnext-sweep/index.ts:285-314`), while `siFromDoc` and `peReceiveFromDoc` expect customer, date, amount, outstanding, and references (`salesInvoice.ts:29-45`, `incomingPayment.ts:34-52`). The feed then inserts NULL financial/link fields (`erpnextFeedDeps.ts:102-147`). Existing-row updates only patch lifecycle columns (`erpnextFeedDeps.ts:50-57`, `226-236`).  
   **Money path:** a native SI can enter the PMO rollup with `amount=NULL` and `outstanding=NULL`; a PE received before its SI is adopted can permanently retain `sales_invoice_id=NULL`.

7. **BLOCK — Concurrent webhook/sweep adoption leaves orphan mirrors.**  
   `applyEngine.ts:86-95` mints the mirror before recording `external_refs`. The unique external-ID constraint does exist (`0093_clickup_tasks_flip.sql:166-169`), but the losing transaction has already inserted its random mirror row.  
   **Money path:** concurrent delivery creates duplicate visible revenue rows; one loses the ref write and remains orphaned indefinitely.

8. **BLOCK — Inbound cancellation does not update `status`.**  
   Feed updates write only `erp_*` fields (`erpnextFeedDeps.ts:226-236`), not derived SI/payment status. Revenue rollups exclude only `status='Cancelled'` (`db/revenue.ts:152-165`).  
   **Money path:** a native SI with `amount=125000` can be cancelled in ERP yet remain `Unpaid` in PMO and continue contributing to project revenue/open AR.

9. **BLOCK — Sweep/webhook adopt revenue without checking revenue ownership.**  
   `listEmployingOrgsLive` selects every activated ERPNext binding (`erpnext-sweep/index.ts:210-223`); neither sweep nor webhook checks `domain_externally_owned` (`erpnext-webhook/index.ts:178-195`).  
   **Money path:** a procurement-only org can receive native Sales Invoice/Receive PE mirrors and expose them through its revenue read model.

10. **BLOCK — Offboarded users can still read AR data.**  
    The new revenue SELECT policies use only `org_id = auth_org_id()` (`0104_sales_incoming_payments_flip.sql:87-101`), omitting `is_active_member()`, despite the global active-member requirement (`0062_ops_admin_profile_status.sql:20-27`).  
    **Money path:** a disabled user with a cached JWT can export invoice amounts, outstanding balances, customers, and payment allocations.

11. **BLOCK — Cross-org preflight remains TOCTOU-prone.**  
    Ownership is checked at `dispatchFactory.ts:145-158`, then ERP work occurs; the post-commit writer checks again (`readModelWriters.ts:521-538`, `581-594`).  
    **Money path:** an Admin can delete a linked project/customer after preflight but before the ERP POST; ERP money is created, then mirror finalization rejects the missing FK.

12. **BLOCK — `require_project_on_si` is enforced only on create.**  
    The edge function gates only SI `create` (`index.ts:518-541`), and the factory explicitly returns for non-create operations (`dispatchFactory.ts:206-214`). Amend creates a replacement using a body that omits `project` when unresolved (`adapter.ts:169-192`, `salesInvoice.ts:22-25`).  
    **Money path:** amend/update a submitted SI without `projectId`, then have another approver submit the replacement; ERP GL lacks the project while PMO preserves the old project attribution (`readModelWriters.ts:505-507`). This contradicts the signed spec’s create/submit requirement (`erpnext-adapter-p3a-sales-ar.spec.md:713-718`).

13. **BLOCK — Required action-required surfacing is not implemented.**  
    The feed contains only a comment promising Finance notification (`erpnextFeedDeps.ts:83-87`); the SI insert has no notification/operator-task write (`erpnextFeedDeps.ts:102-119`). The acceptance test explicitly leaves this oracle loose (`AC-SAR-043-inbound-si-adopt.spec.ts:178-186`).  
    **Money path:** native project-less invoices can remain in the Unassigned bucket without an operator ever being prompted to assign them.

### SHOULD-FIX

- **Gate administration is incomplete:** `external_org_bindings` grants only SELECT (`0096_erpnext_seam_tables.sql:95-103`), while the later policy is restrictive UPDATE-only (`0105_sales_invoice_submit_sod.sql:17-22`); the required Admin gate flip has no usable user path.
- **NULL-author inbound drafts are stranded:** the RPC correctly rejects them (`0108_process_gates_merge_and_sod_author_guard.sql:103-111`), but inbound minting sets no author (`erpnextFeedDeps.ts:102-119`) and the Sales Invoice edit handler is currently a no-op (`pages/SalesInvoices.tsx:343-347`).

### Clean coverage notes

- Normal PE sweep filtering and composite probing are correctly implemented.
- SI draft-on-create versus PI/Pay auto-submit remains correct (`doctypeRegistry.ts:89-99`).
- Repository Submit/Cancel commands now include `verb` and `externalRecordId` (`repositories/index.ts:473-512`).
- Actor stamping, SI SoD, author immutability, server-side PE-reference rebuilding, cancel unlinking, process-gate default merging, and normal cross-org preflight are genuinely improved.
- The unique external-reference constraint exists; the remaining inbound defect is mint-before-ref ordering, not absence of uniqueness.
- Green `verify`, pgTAP, and live E2E results do not cover wildcard recovery, arbitrary direct transitions, crash-after-mirror recovery, concurrency, offboarding RLS, or the gate divergence.
