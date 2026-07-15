# Plan: ERPNext adapter — Sales / AR full write-through (Issue P3a, ADR-0055 P3 phase, sales spine)

> **⚑ BUILD STATUS (2026-07-15):** all 8 slices BUILT; served-fn money e2e **19/19 GREEN** at the live
> bench with the two-person SoD flow (create=DRAFT → approver submits, OD-SAR-DRAFT-SUBMIT). A max-thinking
> Luna re-audit ([`../reviews/2026-07-15-luna-p3a-reaudit-maxthinking.md`](../reviews/2026-07-15-luna-p3a-reaudit-maxthinking.md))
> found the dispatch/repo layer had authz/targeting/reference holes the happy-path e2e missed → a
> **HARDENING ROUND is mid-flight** (BLOCK 2/3/4/5 done; BLOCK 6/1/PE-sweep/7/8 + SF9/10 remaining →
> re-Luna@max until SHIP). **Resume authority = that review doc + `docs/backlog.md` CURRENT-FOCUS block.**
> Branch `feat/erpnext-adapter-p3`, HOLD-NO-PR. Migs shipped: 0104–0107.


> **Spec:** `docs/specs/erpnext-adapter-p3a-sales-ar.spec.md` (**SIGNED OFF** — 2026-07-14 rediscussion;
> all six OQ-SAR-SIGN-* decided; **OQ-SAR-1 ANSWERED** — the R9-P3a live-bench spike froze the SI +
> PE-receive body maps 2026-07-14; `FR-SAR-004..195` / `NFR-SAR-*` / `AC-SAR-001..073` pinned. Two owner
> rulings folded in: **OD-SAR-GATES** (process-gating org-config seam, §5.13) + **OD-SAR-PMO-IS-THE-UI**
> (accountant's UI is PMO → SI cancel/amend in-app + SoD on SI submit, §5.14). Do NOT re-litigate.)
> **ADRs:** **ADR-0055** (binding adapter architecture; §5 "Sales money documents → ERP"; §8 P3 = sales
> spine), **ADR-0058** (the fenced money outbox — applies **verbatim** to SI + PE-receive; the **C-1
> mutable-anchor ruling applies verbatim to PE-receive** because it is the *same* `Payment Entry` doctype
> as PE-pay, only `payment_type` flipped), **ADR-0048** (ERPNext = accounting engine; ledger-sourced-display),
> **ADR-0019** (server-enforced SoD — the SI-submit RPC).
> **Builds on the SHIPPED P2 ERPNext adapter** (`docs/plans/2026-07-11-erpnext-adapter.md`, signed off
> 2026-07-11) — this is its **direct sequel**. P3a **extends, never forks** the shipped surfaces; reuse
> their idioms EXACTLY, do not re-invent:
> - `pmo-portal/src/lib/adapterSeam/erpnext/{doctypeRegistry,doctypeBodies,recoveryProbe,agingSnapshot,transitionPolicy,lineage,feedKinds,piStatus,poGrStatus,dispatchFactory,adapter,client,moneyShape}.ts` + `bodies/{shared,purchaseInvoice,paymentEntry,customer,supplier}.ts`;
> - `supabase/functions/{adapter-dispatch/{index,readModelWriters,moneyOutboxDeps},_shared/erpnextFeedDeps,erpnext-webhook,erpnext-sweep,erpnext-onboard}/`;
> - migrations `0096` (seam tables — `external_command_outbox` + `external_refs` + `external_org_bindings`
>   + the two `claim_outbox_for_commit`/`quarantine_committing`/`record_outbox_ref`/`confirm_outbox`/
>   `mark_outbox_held` RPCs) and **`0100_invoices_payments_flip.sql`** (the per-command-RLS flip template:
>   INSERT `WITH CHECK (… and not domain_externally_owned(auth_org_id(),'revenue'))` → `42501`; UPDATE
>   trigger-pin via `*_native_mirror_guard`; DELETE `using (… and not …)` → 0-row no-op; the four `erp_*`
>   feed cols; the `0103` lesson — ship **all four** `erp_*` columns day one), `0074` (`stamp_org_id()`
>   BEFORE-INSERT), `0087` (`domain_externally_owned`), `0096`/`0102` (sweep cron);
> - `e2e/serial/AC-ENA-{010,013,023,023b,040,053,061}-*.spec.ts` (the served-fn serial e2e lane) +
>   `scripts/{serve-functions,with-db-lock,with-erpnext-lock}.sh`.
>
> **No-placeholder rule (binding):** every task has an exact path, the actual code/diff, its `AC-SAR-###`,
> and an exact verify command. TDD order: the failing-test task precedes its implementation task. Types
> are consistent across tasks (`AdapterCommand`/`PmoRecord`/`ErpDocKind`/`ErpCtx`/`OutboxRow` from the P2
> contract are the shared vocabulary; P3a adds the `revenue` domain + two kinds, no new contract field).
>
> **⚑ Migration numbering (binding — `ls supabase/migrations | tail -1` = `0103` at write time):** this
> plan reserves **`0104`** (`sales_invoices` + `incoming_payments` tables + flip RLS + guards) and **`0105`**
> (the SI-submit SoD RPC). **The builder MUST re-verify at write time** with
> `ls supabase/migrations | tail -3` and bump every number in this plan if either is taken. Renumber
> consistently across this plan + the pgTAP file references. **Renumber-on-collision routine:** (1) run
> `ls supabase/migrations | sort | tail -5`; (2) pick `max+1`, `max+2`; (3) if a number is taken by a
> concurrent writer, bump to the next free pair and update every reference in this plan + the
> `supabase/tests/*` comments; (4) never edit a migration that has already shipped to `main`/`production`.
>
> **Confinement invariant (FR-SAR-014 / NFR-SAR-CONTRACT-001, carried from FR-ENA-013):** ERPNext/Frappe
> vocabulary (doctype names, `payment_type`, `remarks`, `reference_no`, `debit_to`, `paid_from`/`paid_to`,
> `po_no`, `project`, account names, `/api/resource`, `docstatus`) lives **only** under
> `pmo-portal/src/lib/adapterSeam/erpnext/**` + the ERPNext edge fns. The PMO-side discriminators that
> cross the contract are the `revenue` domain + the `sales-invoice`/`incoming-payment` kinds (PMO verbs,
> never Frappe names). The `incoming-payment` kind and the `payment` kind map to the **same** ERP doctype
> (`Payment Entry`) — disambiguated by `payment_type` **inside** the adapter/feed, never above the contract.
>
> **Spike authority (binding — `~/Coding/frappe-docker-pmo/PMO-BENCH-NOTES.md §R9-P3a spike`, filed copy
> `docs/spikes/2026-07-14-erpnext-si-pe-receive-fields.md`):** the R9-P3a live-bench spike ran against the
> same stock Docker ERPNext v15 bed P2 uses (`frappe/erpnext:v15.94.3`, site `frontend` @ `:8080`,
> `PMO Smoke Co`, IDR, Standard COA). Its frozen findings are the binding field maps for
> `bodies/salesInvoice.ts` + `bodies/incomingPayment.ts` — **no body may diverge from them.** (Task 1.1
> files the repo copy; tasks 1.3/1.4 cite the R9-P3a finding numbers inline.)

---

## 0. Job story (from spec §0)

> When a client employs ERPNext as the money source of truth, PMO must let users issue client invoicing
> and record incoming payments through PMO while ERPNext remains the sole writer of committed/happened
> receivables money — and tie every sales invoice to a PMO project so revenue is accountable per project —
> and every client who does NOT employ ERPNext stays byte-for-byte the pre-P3a system.

PMO = app + user surface; ERPNext = native sell-side money objects (**Sales Invoice**, **Payment Entry
`payment_type="Receive"`**); Supabase = read-model (`sales_invoices`/`incoming_payments`) + PMO-only
enhancement (the **project link** — the revenue-per-project product goal). Commands go down
**synchronously** through the same `adapter-dispatch` boundary P2 shipped, guarded by the ADR-0058
idempotency key + outbox so a retry can never mint a duplicate SI or a double-received payment. Change-feed
truth comes up via the same webhook + modified-poll sweep; the SI's `outstanding_amount` and the PE's
allocation are mirrored from ERP server-computed truth, never recomputed (ADR-0048). The flip is per-org and
reversible; with no `revenue`→`erpnext` assignment it is inert (FR-SAR-004 — P3a's critical regression risk,
the served-fn regression net AC-ENA-002/AC-SAR-002 is the gate).

---

## 1. Architecture overview (how P3a plugs into P2)

```
 User revenue write (invoice/payment authoring UI — slice 4)
   → repositories.revenue.{createInvoice,createPayment,submitInvoice,cancelInvoice,cancelPayment}
      → routeDomainWrite('revenue')  [generalized ADR-0056 cache, fail-closed 'pmo']
          ├─ 'pmo'      → REJECT `revenue-not-enabled` (OQ-SAR-6: no PMO-native revenue path today)  ← FR-SAR-005
          └─ 'external' → dispatchDomainCommand('revenue', op, record{erp_doc_kind, idempotencyKey})
                             → POST functions/v1/adapter-dispatch  [fault seams reused from P2]
                             → dispatchExternallyOwnedWrite (dispatch.ts) → resolveErpDispatchAdapter
                                 ├─ SI  (sales-invoice)  → siToBody {customer, items, project?} → two-step insert→submit
                                 │     anchor=remarks IMMUTABLE (reissue-capable); SoD-gated submit (RPC, slice 3)
                                 └─ PE-receive (incoming-payment) → peReceiveToBody {payment_type:Receive, party:Customer,
                                       paid_from:receivable, paid_to:cash, received_amount, references:[SI]} → insert→submit
                                       anchor=reference_no MUTABLE (C-1: composite probe + held-on-inconclusive, NEVER auto-reissue)
                                 both ride external_command_outbox verbatim (FR-SAR-040..045) →
                                   revenue read-model writer (sales_invoices / incoming_payments, slice 2)
 Native ERPNext SI/PE edit / desk cancel+amend / native SI with no PMO project
   → erpnext-webhook (HMAC, reused) → applyErpFeedEvent [hint, lossy]
        ↘                                                          ↘
         both apply through the SAME source-mod-guarded full-row upsert + lineage repoint (slice 5);
         Payment Entry inbound disambiguated by payment_type (Receive→incoming-payment, Pay→payment)
   → erpnext-sweep (pg_cron, reused) → modified-poll + outbox recovery (revenue rows) + aging refresh (AR scope, slice 6)
 AR aging read-back (read-only)
   → erpnext-sweep → refreshAging('Accounts Receivable','erp_ar_aging_snapshot',…) [ALREADY shipped; slice 6 wires the scope]
```

Ownership is per-org in `external_domain_ownership` (0087) via the **reused** Operator RPC
(`operator_set_domain_ownership(org,'erpnext','revenue','employ')`). The per-org binding
(`external_org_bindings`, 0096) grows **receivable-side account defaults** in its `config` jsonb
(`default_receivable_account`/`default_income_account`/`default_cash_account`) + the **`process_gates`**
jsonb key (data, not schema — OD-SAR-GATES). Reads are always the Supabase read-model (FR-SAR-172).

---

## 2. Key design decisions (binding — carry these into every task)

1. **One `erpnext` adapter, three domains now — `revenue` is additive (OQ-SAR-2).** `capabilityMap` grows
   `{companies, procurement}` → `{companies, procurement, revenue}` (one `Set` entry + a new
   `ERPNEXT_REVENUE_DOMAIN` constant). The adapter remains a single tier owning multiple domains. The
   `revenue` domain is internally discriminated by `erp_doc_kind` (`'sales-invoice'`/`'incoming-payment'`),
   exactly as `procurement` is — the SAME registry pattern, no fork.
2. **Money idempotency = ADR-0058 applied VERBATIM (FR-SAR-040..045).** SI + PE-receive ride
   `external_command_outbox` + the atomic recovery algorithm unchanged. The only per-kind facts are the
   registry entries: **SI** anchors `remarks`, `anchorMutable:false` (reissue-capable, the PI twin —
   OQ-SAR-4); **PE-receive** anchors `reference_no`, `anchorMutable:true` (C-1 verbatim — composite probe,
   `held`-on-inconclusive, **NEVER auto-reissued**, the double-receive guard — OQ-SAR-3). The served
   dispatch's `reissueOnInconclusiveAbsence = !entry.anchorMutable` (already shipped in `index.ts`) drives
   both — no outbox code change beyond routing the `revenue` domain.
3. **The spike froze the bodies — send neither SI account (OQ-SAR-1 #1), supply BOTH PE-receive accounts
   (OQ-SAR-1 #3).** SI `{customer, items:[{item_code,qty,rate}], project?}` → ERP server-derives `debit_to`
   (`default_receivable_account`) + `items[].income_account` (`default_income_account`). PE-receive
   `{payment_type:"Receive", party_type:"Customer", party, paid_amount, received_amount, paid_from, paid_to,
   references:[…]}` — the adapter supplies `paid_from`=`default_receivable_account`, `paid_to`=
   `default_cash_account` (cash; `default_bank_account` fallback) from binding config; `received_amount` is
   mandatory even same-currency. `reference_no` is NEVER sent by the body (PMO owns it — `stampAnchor`
   writes the idempotency key into it). Client pre-validates non-empty `items` (the empty-items `500
   TypeError`, OQ-SAR-1 #7 — same shape as PI).
4. **Project linkage = the ERP `project` field, NOT `cost_center` (OQ-SAR-1 #5, FR-SAR-101).** A header
   `project:"<ERP-name>"` propagates to BOTH GL legs (Debtors debit + Sales credit) on submit. The dispatch
   resolves the ERP project name from the binding's ERP-project→PMO map (`ctx.refs.project`) and the body
   stamps it. `sales_invoices.project_id` is machine-written (resolved from the command's `projectId` +
   binding map); revenue-per-project views aggregate on it. The `require_project_on_si` gate (default ON,
   FR-SAR-191) makes a null project rejectable at the dispatch boundary, relaxable to an 'Unassigned' rollup.
5. **Per-command RLS flip mirroring 0100 (FR-SAR-170, OQ-SAR-SIGN-3).** The two NEW tables ship flip-shaped
   from day one (forward-compat for a future PMO-native revenue path, OQ-SAR-6): INSERT
   `WITH CHECK (… and not domain_externally_owned(auth_org_id(),'revenue'))` → `42501`; UPDATE column-pinned
   by `*_native_mirror_guard` BEFORE-UPDATE triggers; DELETE 0-row no-op when flipped. Today the only writer
   is the service role; the user-JMT INSERT is flip-gated. All four `erp_*` feed columns ship day one (the
   0103 lesson). No `GENERATED` column, no derived-completion trigger → no service-role bypass (FR-SAR-171).
6. **Process gates are org-config data, not schema (OD-SAR-GATES, FR-SAR-190..192).** `process_gates` lives
   in `external_org_bindings.config` (jsonb) — `{require_so_before_si:false, require_bast_before_si:false,
   require_project_on_si:true}`. SO/BAST are **recognized-but-inert** keys (fast-follow issue); only
   `require_project_on_si` is enforced (default ON, dispatch boundary + UI affordance). Admin-only flip
   (`can('manage_external_bindings')`). No migration column change.
7. **SoD on SI submit = a security-definer RPC (ADR-0019, OD-SAR-PMO-IS-THE-UI, FR-SAR-195).** The SI
   `docstatus 0→1` (the money commitment) requires **approver ≠ author**, enforced by a SECURITY DEFINER RPC
   `submit_sales_invoice(p_si_id)` that reads the draft's `author_user_id` and rejects a self-submit with
   `sod-self-approval` (`42501`). Draft authoring is ungated. PE-receive submit is NOT SoD-gated in P3a.
   The RPC is the enforcement authority; the UI Submit affordance is UX-only (`can('submit_sales_invoice')`
   hidden from the author).
8. **Change-feed: reuse the P2 engine + the one Payment-Entry-disambiguation rule (FR-SAR-080..085).** The
   sweep/webhook apply the lifecycle + adopt for the two new kinds with NO engine change — `feedKinds.ts`
   gains the `revenue`/`sales_invoices`/`incoming_payments` entries + the **`payment_type` disambiguation**
   (one `Payment Entry` doctype → two PMO kinds; `kindFromDoctype` alone is insufficient). The composite
   recovery probe gains a `payment_type` discriminator (FR-SAR-083) so a PE-receive probe cannot
   cross-match a PE-pay.
9. **SI cancel is NOT hard-blocked by an active PE-receive (OQ-SAR-1 #8, FR-SAR-051) — the AR delta from
   procurement.** ERPNext cancels a referenced SI with **200** and **auto-un-links** the PE-receive's
   `references` (NOT a `LinkExistsError` block). PE-receive-first remains POLICY, but the cancel/lineage
   logic must **tolerate an already-unlinked PE-receive** (re-derive `sales_invoice_id`→null, tombstone the
   SI, leave the PE-receive's status/money untouched). `transitionPolicy.cancelChain` propagates rejections
   uncaught — unchanged; the delta is in the read-model reconcile, not the chain.
10. **Non-ERPNext byte-for-byte invariant FIRST (P2 discipline).** Slice 2 lands the AC-SAR-001 regression
    net (cold map ⇒ revenue rejected; P2 writes byte-for-byte) BEFORE any flipped-org behavior. Every slice
    ends with `npm run verify` (AC-SAR-002 — the unchanged P2 suite IS the regression gate).

---

## 3. Slice plan (8 independently-mergeable slices; one PR each to `dev`; all green flag-off)

Each slice is a standalone PR that builds and passes `npm run verify` **with no org employing `revenue`**
(so it is behavior-off / byte-for-byte for every existing client — `revenue` is a brand-new domain with no
pre-P3a assignment). Merge order 0→1→2→…→7 is the natural dependency order; each stands alone (later
slices' modules are inert until an org is flipped by the Operator, which no test-or-prod org is).

| Slice | Scope (1 line) | ACs owned | Migrations | Tasks |
|---|---|---|---|---|
| **0** | Storage: `sales_invoices` + `incoming_payments` tables (org seam + 4 day-one `erp_*` cols + status CHECK) + the per-command RLS flip (0100 template) + `*_native_mirror_guard` triggers + pgTAP; extend the outbox pgTAP for `'revenue'` | 003, 012, 061 | `0104_sales_incoming_payments_flip.sql` | 0.1–0.7 |
| **1** | ERPNext tier core — `revenue` capability-map entry + `sales-invoice`/`incoming-payment` registry kinds (anchor/mutable per the spike) + the spike-frozen `salesInvoice.ts`/`incomingPayment.ts` bodies + `siStatus.ts` derivation + money-shape unit | 030, 031 | — | 1.1–1.7 |
| **2** | Dispatch wiring: router/dispatchFactory revenue resolver (customer + project + SI refs); `revenue` read-model writer (sales_invoices / incoming_payments); recovery-probe `payment_type` discriminator; **AC-SAR-001 regression net FIRST**; `held`-on-inconclusive unit | 001, 013, 014 | — | 2.1–2.10 |
| **3** | `process_gates` org-config seam (jsonb, no schema) + the `require_project_on_si` boundary enforcement + the SI-submit SoD security-definer RPC + pgTAP (defaults/Admin-flip + self-approval-rejected) | 070, 072, 073 | `0105_sales_invoice_submit_sod.sql` | 3.1–3.8 |
| **4** | FE: `repositories.revenue` seam (route external when flipped, reject otherwise, mint idempotencyKey + erp_doc_kind) + invoice/payment authoring UI on the flipped org (DESIGN.md tokens, shared form primitives, `CanWrite`/approval gates) + revenue-per-project read surface | (enables 040/041/042 e2e) | — | 4.1–4.10 |
| **5** | Inbound feed: `feedKinds` revenue entries + Payment-Entry `payment_type` disambiguation + `erpnextFeedDeps` revenue adopt (project-less SI → `action-required`) + lifecycle/lineage (cancel auto-unlink delta) + webhook HMAC for revenue kinds | 020, 021, 022, 060, 062 | — | 5.1–5.9 |
| **6** | AR aging scope wiring (binding config + sweep scheduling, reuse the shipped `refreshAging('Accounts Receivable',…)`) + Customer `payment_terms` due-date display (read-only) | 051 | — | 6.1–6.4 |
| **7** | Served-fn serial e2e lane (`e2e/serial/AC-SAR-*.spec.ts`, `@e2e-isolation: serial`, `EDGE_JWT_ISSUER` lane, `ERPNEXT_SITE_URL=host.docker.internal`) — SI/PE-receive write-through, idempotency + recovery (fault seam), cancel/amend, inbound adopt, AR aging, gate-off rollup + smokes | 010, 011, 040, 041, 042, 043, 050, 071 | — | 7.1–7.10 |

**AC-SAR-002** (zero-regression meta-AC) is the `npm run verify` + full pgTAP gate at the end of **every**
slice — no single new test owns it (mirrors AC-ENA-002). **AC-SAR-001** (revenue rejected for a
non-`revenue` org + P2 byte-for-byte) is the slice-2 RED-first regression net.

---

## Slice 0 — Storage: `sales_invoices` + `incoming_payments` (tables + flip RLS + guards + pgTAP)

**Goal:** two NEW machine-written mirror tables with the org seam, the four day-one `erp_*` feed columns,
the per-command RLS flip (0100 template), and the `*_native_mirror_guard` triggers — all reversible. The
slice's pgTAP owns AC-SAR-003 (org-scoped flip) + AC-SAR-061 (machine-only native writes + day-one cols);
the outbox pgTAP extension owns AC-SAR-012 (unique key rejects a concurrent revenue command). **No app
code; no org flipped → byte-for-byte.**

### 0.1 — File the R9-P3a spike write-up into the repo (the binding body-map authority)

**File:** `docs/spikes/2026-07-14-erpnext-si-pe-receive-fields.md` (new — copy of
`~/Coding/frappe-docker-pmo/PMO-BENCH-NOTES.md §R9-P3a spike`, in the P2 R9 format
`docs/spikes/2026-07-11-erpnext-pe-mandatory-fields.md`). Records the 8 frozen findings (SI body
`{customer,items,project?}` accounts-auto-derived; SI anchor `remarks` immutable; PE-receive body incl.
both adapter-supplied accounts + `received_amount`; PE-receive anchor `reference_no` mutable; `project`
propagates to both GL legs; AR aging = AP shape; empty-items `500 TypeError`; SI cancel not hard-blocked).

**Verify:** `ls docs/spikes/2026-07-14-erpnext-si-pe-receive-fields.md` (exists); the doc cites the exact
frozen field maps tasks 1.3/1.4 implement.

### 0.2 — RED: pgTAP `supabase/tests/erpnext_sales_invoices_flip_rls.test.sql` (OWNS AC-SAR-003 + AC-SAR-061 SI side)

**File** (new). Model on `erpnext_money_flip_rls.test.sql` (the P2 owner). Seeds two orgs (A flipped on
`revenue`, B not), a Customer + Project in A, a `sales_invoices` row in A (owner/service insert), asserts:
- **AC-SAR-061 SI:** a user-JMT `UPDATE sales_invoices SET amount=…` → `42501`; a user-JMT
  `INSERT INTO sales_invoices (org_id, si_number, …)` → `42501`; the service-role
  `UPDATE sales_invoices SET amount=750, erp_outstanding_amount=0, status='Paid', erp_docstatus=1, …`
  succeeds; `information_schema.columns` confirms `erp_docstatus`/`erp_modified`/`erp_amended_from`/
  `erp_cancelled_at` + `erp_outstanding_amount` exist; `project_id` is machine-only (user UPDATE of
  `project_id` → `42501`).
- **AC-SAR-003:** org A user read of A's SI row returns it; org B user read returns 0 rows (org isolation);
  org B's `companies`/`procurement` behavior is byte-for-byte (a `create_procurement_invoice` RPC in B
  still succeeds).
- Reversibility trigger note: `stamp_org_id()` overrides null/seed `org_id` only (0074 pattern) — safe for
  the service-role writer (no `GENERATED` column → no bypass, FR-SAR-171).
**Verify:** `scripts/with-db-lock.sh supabase test db -- -f erpnext_sales_invoices_flip_rls` → RED (table
does not exist yet → errors).

### 0.3 — RED: pgTAP `supabase/tests/erpnext_incoming_payments_flip_rls.test.sql` (AC-SAR-061 PE-receive side)

**File** (new). Same shape as 0.2 for `incoming_payments`. Asserts: user-JMT native write → `42501`;
service-role write ok; `reference_number` (the anchor carrier) is machine-only; `sales_invoice_id` FK +
the AR same-scope invariant (FR-SAR-161) preserved; the four `erp_*` cols exist; org isolation.
**Verify:** `scripts/with-db-lock.sh supabase test db -- -f erpnext_incoming_payments_flip_rls` → RED.

### 0.4 — RED: extend `supabase/tests/external_command_outbox_rls.test.sql` for `'revenue'` (OWNS AC-SAR-012)

**File** (extend the P2 file). Add: insert one `external_command_outbox` row
`(org, 'revenue', pmo_record_id, idempotency_key)`; assert a second insert of the SAME 4-tuple raises
`23505` (the unique constraint — FR-SAR-041); assert a different `idempotency_key` for the same
`pmo_record_id` succeeds (a re-command). No schema change — the outbox is domain-agnostic (shipped 0096).
**Verify:** `scripts/with-db-lock.sh supabase test db -- -f external_command_outbox_rls` → the new
assertions RED only if the existing file lacks the revenue case (it passes structurally; the unique
constraint already rejects — this task is the explicit AC-SAR-012 proof).

### 0.5 — GREEN: migration `0104_sales_incoming_payments_flip.sql` (tables + flip RLS + guards)

**File** `supabase/migrations/0104_sales_incoming_payments_flip.sql` (new — re-verify the number with
`ls supabase/migrations | tail -3`). Creates both tables fresh **with the flip already baked in**
(unlike 0100 which ALTERed existing tables). Reversibility block at the top (drop triggers/policies/tables
→ restore pre-P3a). Full body:

```sql
-- 0104_sales_incoming_payments_flip.sql (ERPNext P3a, Slice 0, tasks 0.2–0.5)
-- Creates the two NEW machine-written revenue mirror tables (FR-SAR-170, OQ-SAR-SIGN-3) with the org
-- seam (0074 stamp_org_id), the four day-one erp_* feed cols (the 0103 lesson), and the per-command RLS
-- flip mirroring 0100 (forward-compat for a future PMO-native revenue path, OQ-SAR-6): INSERT
-- WITH CHECK (… and not domain_externally_owned(auth_org_id(),'revenue')) → 42501; UPDATE column-pinned
-- by *_native_mirror_guard; DELETE using (… and not …) → 0-row no-op when flipped. No GENERATED column,
-- no derived-completion trigger → no service-role bypass needed (FR-SAR-171). No org is flipped in this
-- migration; the policies are inert until an Operator employs revenue→erpnext.
--
-- Reversibility (pre-production): `supabase db reset`. Manual reverse block (forward-only if promoted):
--   drop table if exists public.sales_invoices;   -- cascades its policies + triggers
--   drop table if exists public.incoming_payments;

-- ============================================================================
-- §1 — sales_invoices (the SI read-model + project enhancement, spec §4.1)
-- ============================================================================
create table if not exists public.sales_invoices (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null default '00000000-0000-0000-0000-000000000001',
  project_id    uuid references public.projects(id),
  customer_id   uuid references public.companies(id),
  si_number      text,
  reference_number text,                 -- ERP po_no (the customer's PO/bill ref, OQ-SAR-1 #6)
  invoice_date  date,
  amount        numeric(14,2),
  erp_outstanding_amount numeric(14,2),  -- the paid-detection oracle (R9 §2 AR twin)
  status        text not null default 'Draft'
    check (status in ('Draft','Submitted','Unpaid','Paid','Cancelled')),
  erp_docstatus    smallint,
  erp_modified     text,
  erp_amended_from text,
  erp_cancelled_at timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists sales_invoices_org_project_idx on public.sales_invoices (org_id, project_id);
create index if not exists sales_invoices_org_customer_idx on public.sales_invoices (org_id, customer_id);

-- ============================================================================
-- §2 — incoming_payments (the PE-receive read-model, spec §4.2)
-- ============================================================================
create table if not exists public.incoming_payments (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null default '00000000-0000-0000-0000-000000000001',
  customer_id   uuid references public.companies(id),
  sales_invoice_id uuid references public.sales_invoices(id),  -- nullable (on-account receipt)
  ip_number      text,
  reference_number text,                 -- ERP reference_no — ALSO the idempotency-anchor carrier (FR-SAR-042)
  date          date,
  amount        numeric(14,2),
  status        text not null default 'Scheduled'
    check (status in ('Scheduled','Paid')),
  erp_docstatus    smallint,
  erp_modified     text,
  erp_amended_from text,
  erp_cancelled_at timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists incoming_payments_org_customer_idx on public.incoming_payments (org_id, customer_id);
create index if not exists incoming_payments_org_si_idx     on public.incoming_payments (org_id, sales_invoice_id);

-- ============================================================================
-- §3 — stamp_org_id() BEFORE-INSERT on both (0074 pattern). Overrides null/seed org_id only.
-- ============================================================================
create trigger sales_invoices_stamp_org_id
  before insert on public.sales_invoices for each row execute function public.stamp_org_id();
create trigger incoming_payments_stamp_org_id
  before insert on public.incoming_payments for each row execute function public.stamp_org_id();

-- ============================================================================
-- §4 — enable RLS + the per-command flip (0093/0100 template). The revenue domain gates native writes.
-- ============================================================================
alter table public.sales_invoices    enable row level security;
alter table public.incoming_payments enable row level security;

create policy sales_invoices_select on sales_invoices for select
  using (org_id = auth_org_id());
create policy sales_invoices_insert on sales_invoices for insert
  with check (org_id = auth_org_id()
    and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and not public.domain_externally_owned(auth_org_id(), 'revenue'));
create policy sales_invoices_update on sales_invoices for update
  using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance'))
  with check (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance'));
create policy sales_invoices_delete on sales_invoices for delete
  using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and not public.domain_externally_owned(auth_org_id(), 'revenue'));

create policy incoming_payments_select on incoming_payments for select
  using (org_id = auth_org_id());
create policy incoming_payments_insert on incoming_payments for insert
  with check (org_id = auth_org_id()
    and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and not public.domain_externally_owned(auth_org_id(), 'revenue'));
create policy incoming_payments_update on incoming_payments for update
  using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance'))
  with check (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance'));
create policy incoming_payments_delete on incoming_payments for delete
  using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and not public.domain_externally_owned(auth_org_id(), 'revenue'));

-- ============================================================================
-- §5 — *_native_mirror_guard BEFORE-UPDATE triggers (0100 §3 template). Service-role exempt; a
-- non-service caller is exempt only while NOT flipped; while flipped, a native-field change → 42501.
-- ============================================================================
create or replace function public.sales_invoices_native_mirror_guard() returns trigger
  language plpgsql set search_path = public as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then return new; end if;
  if not public.domain_externally_owned(new.org_id, 'revenue') then return new; end if;
  if new.si_number is distinct from old.si_number
     or new.customer_id is distinct from old.customer_id
     or new.project_id is distinct from old.project_id
     or new.reference_number is distinct from old.reference_number
     or new.invoice_date is distinct from old.invoice_date
     or new.amount is distinct from old.amount
     or new.erp_outstanding_amount is distinct from old.erp_outstanding_amount
     or new.status is distinct from old.status
     or new.erp_docstatus is distinct from old.erp_docstatus
     or new.erp_modified is distinct from old.erp_modified
     or new.erp_amended_from is distinct from old.erp_amended_from
     or new.erp_cancelled_at is distinct from old.erp_cancelled_at
     or new.id is distinct from old.id or new.org_id is distinct from old.org_id
     or new.created_at is distinct from old.created_at
  then
    raise exception 'sales_invoices native fields are read-only while revenue is externally-owned'
      using errcode = '42501';
  end if;
  return new;
end; $$;
drop trigger if exists sales_invoices_native_mirror_guard_trg on public.sales_invoices;
create trigger sales_invoices_native_mirror_guard_trg
  before update on public.sales_invoices for each row execute function public.sales_invoices_native_mirror_guard();

create or replace function public.incoming_payments_native_mirror_guard() returns trigger
  language plpgsql set search_path = public as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then return new; end if;
  if not public.domain_externally_owned(new.org_id, 'revenue') then return new; end if;
  if new.ip_number is distinct from old.ip_number
     or new.customer_id is distinct from old.customer_id
     or new.sales_invoice_id is distinct from old.sales_invoice_id
     or new.reference_number is distinct from old.reference_number
     or new.date is distinct from old.date
     or new.amount is distinct from old.amount
     or new.status is distinct from old.status
     or new.erp_docstatus is distinct from old.erp_docstatus
     or new.erp_modified is distinct from old.erp_modified
     or new.erp_amended_from is distinct from old.erp_amended_from
     or new.erp_cancelled_at is distinct from old.erp_cancelled_at
     or new.id is distinct from old.id or new.org_id is distinct from old.org_id
     or new.created_at is distinct from old.created_at
  then
    raise exception 'incoming_payments native fields are read-only while revenue is externally-owned'
      using errcode = '42501';
  end if;
  return new;
end; $$;
drop trigger if exists incoming_payments_native_mirror_guard_trg on public.incoming_payments;
create trigger incoming_payments_native_mirror_guard_trg
  before update on public.incoming_payments for each row execute function public.incoming_payments_native_mirror_guard();
```

**Verify:** `scripts/with-db-lock.sh supabase db reset` (clean); then re-run 0.2/0.3/0.4 → GREEN.

### 0.6 — GREEN: re-run the three pgTAP files → GREEN (AC-SAR-003, AC-SAR-012, AC-SAR-061)

**Verify:** `scripts/with-db-lock.sh supabase test db` → all three files green; the full pgTAP suite green
(no P2 regression — AC-ENA-002/AC-SAR-002).

### 0.7 — Slice-0 gate

**Verify:** `cd pmo-portal && npm run verify` (typecheck + lint:ci + test + build) green — the new tables
are referenced by no app code yet, so this is a pure-storage slice (byte-for-byte). **AC-SAR-003, AC-SAR-012,
AC-SAR-061 owned.** PR to `dev`.

---

## Slice 1 — ERPNext tier core: `revenue` capability + `sales-invoice`/`incoming-payment` kinds + spike-frozen bodies

**Goal:** the additive capability-map + registry entries + the two spike-frozen bodies + the SI status
derivation. No dispatch routing yet (the kinds are registered but no flipped org routes to them — inert).
Owns AC-SAR-030 (SI money shape) + AC-SAR-031 (PE-receive money shape).

### 1.1 — `ERPNEXT_REVENUE_DOMAIN` constant + capability-map entry (FR-SAR-010)

**File** `pmo-portal/src/lib/adapterSeam/erpnext/adapter.ts` — add the constant + grow the `Set`:

```ts
export const ERPNEXT_REVENUE_DOMAIN: PmoDomain = 'revenue';
// …in createErpAdapter:
capabilityMap: new Set<PmoDomain>([ERPNEXT_COMPANIES_DOMAIN, ERPNEXT_PROCUREMENT_DOMAIN, ERPNEXT_REVENUE_DOMAIN]),
```

Update the module docstring (`capabilityMap:{companies,procurement,revenue}`). **No other change** — the
router reads `capabilityMap` generically; the dispatch reads `domain_externally_owned` generically. Additive.
**Verify:** `npx vitest run src/lib/adapterSeam/erpnext/adapter.test.ts` — extend the capability-map
assertion to expect `'revenue'` in the set; `npm run typecheck`.

### 1.2 — Registry kinds `sales-invoice` + `incoming-payment` (FR-SAR-011, anchors per the spike)

**File** `pmo-portal/src/lib/adapterSeam/erpnext/doctypeRegistry.ts` — extend the `ErpDocKind` union +
`DOCTYPE_REGISTRY` (additive, no existing entry edited):

```ts
export type ErpDocKind =
  | 'purchase-request' | 'rfq' | 'quotation' | 'purchase-order' | 'goods-receipt'
  | 'purchase-invoice' | 'payment' | 'supplier' | 'customer'
  | 'sales-invoice' | 'incoming-payment';   // P3a (FR-SAR-011)

// appended to DOCTYPE_REGISTRY:
// SI — anchor 'remarks', IMMUTABLE (OQ-SAR-4, R9-P3a spike #2: remarks survives validate+submit+refetch
// verbatim — the PI twin, reissue-capable). ERP server-derives debit_to + items[].income_account.
'sales-invoice': { doctype: 'Sales Invoice', submittable: true, anchorField: 'remarks', anchorMutable: false },
// PE-receive — anchor 'reference_no', MUTABLE (OQ-SAR-3, R9-P3a spike #4: remarks is clobbered by PE
// validate; reference_no survives. C-1 applies verbatim: composite probe + held-on-inconclusive, NEVER
// auto-reissued — the double-receive guard). Same doctype as 'payment', payment_type='Receive'.
'incoming-payment': { doctype: 'Payment Entry', submittable: true, anchorField: 'reference_no', anchorMutable: true },
```

**Verify:** `npx vitest run src/lib/adapterSeam/erpnext/doctypeRegistry.test.ts` — extend to assert the two
new entries' doctype/submittable/anchorField/anchorMutable; `npm run typecheck`.

### 1.3 — `bodies/salesInvoice.ts` — the spike-frozen SI body (FR-SAR-100/103, OQ-SAR-1 #1/#2/#5)

**File** `pmo-portal/src/lib/adapterSeam/erpnext/bodies/salesInvoice.ts` (new):

```ts
/**
 * Sales Invoice `toBody`/`fromDoc` — R9-P3a spike §1 frozen
 * (docs/spikes/2026-07-14-erpnext-si-pe-receive-fields.md). `toBody` sends exactly
 * `{customer, items:[{item_code,qty,rate}], project?}`; ERPNext SERVER-DERIVES `debit_to`
 * (← default_receivable_account), `items[].income_account` (← default_income_account), `company`,
 * `posting_date`/`due_date`, currency, cost_center, warehouse, and all totals — the adapter sends
 * NEITHER account (OQ-SAR-1 #1). `project` (NOT cost_center) is the ERP dimension that realizes
 * revenue-per-project and propagates to BOTH GL legs on submit (OQ-SAR-1 #5, FR-SAR-101).
 * `fromDoc` mirrors `grand_total`/`outstanding_amount` as the money ORACLE (ADR-0048).
 */
import type { PmoRecord } from '../../contract.ts';
import type { ErpCtx } from '../doctypeRegistry.ts';
import { mirrorMoney } from '../moneyShape.ts';
import { requireItems } from './shared.ts';

export function siToBody(rec: PmoRecord, ctx: ErpCtx): unknown {
  const items = requireItems(rec, 'Sales Invoice');   // empty-items 500 TypeError guard (OQ-SAR-1 #7)
  const body: Record<string, unknown> = {
    customer: ctx.refs.customer,
    items: items.map((i) => ({ item_code: i.item_code, qty: i.qty, rate: i.rate })),
  };
  // FR-SAR-101: the dispatch resolves the ERP project name (via project_name search → ERP name, from the
  // binding's ERP-project→PMO map) and supplies it in ctx.refs.project. Header `project` suffices (it
  // propagates to both GL legs on submit). Omitted when no project (gate OFF / inbound-adopted).
  if (ctx.refs.project) body.project = ctx.refs.project;
  return body;
}

export function siFromDoc(doc: unknown): PmoRecord {
  const d = doc as Record<string, unknown>;
  return {
    id: String(d.name),
    si_number: String(d.name),
    invoice_date: (d.posting_date as string | null) ?? null,
    reference_number: (d.po_no as string | null) ?? null,   // customer PO/bill ref (AR-aging row, #6)
    amount: mirrorMoney(d.grand_total),
    erp_outstanding_amount: mirrorMoney(d.outstanding_amount),
    erp_docstatus: (d.docstatus as number | null) ?? null,
    erp_modified: (d.modified as string | null) ?? null,
    erp_amended_from: (d.amended_from as string | null) ?? null,
  };
}
```

**Verify:** `npx vitest run src/lib/adapterSeam/erpnext/bodies` (extend `bodies.test.ts` — `siToBody` sends
`{customer,items,project}` and NO account; `siFromDoc` mirrors `grand_total`/`outstanding_amount`/`po_no`;
empty `items` throws `commit-rejected`).

### 1.4 — `bodies/incomingPayment.ts` — the spike-frozen PE-receive body (FR-SAR-120, OQ-SAR-1 #3/#4)

**File** `pmo-portal/src/lib/adapterSeam/erpnext/bodies/incomingPayment.ts` (new — the AR twin of
`paymentEntry.ts`, NOT a fork):

```ts
/**
 * Payment Entry (Receive) `toBody`/`fromDoc` — R9-P3a spike §3 frozen. The AR twin of `paymentEntry.ts`
 * (PE-pay): same `Payment Entry` doctype, `payment_type:'Receive'` + `party_type:'Customer'`. The REST
 * API defaults NEITHER account (OQ-SAR-1 #3) — the adapter supplies BOTH from binding config
 * (`paid_from`=default_receivable_account/Debtors; `paid_to`=default_cash_account/Cash, bank fallback).
 * `received_amount` is MANDATORY even same-currency. `reference_no` is NEVER sent (PMO owns it for
 * PMO-originated PE-receives — it IS the idempotency-anchor carrier; `stampAnchor` writes the key).
 */
import type { PmoRecord } from '../../contract.ts';
import type { ErpCtx } from '../doctypeRegistry.ts';
import { mirrorMoney } from '../moneyShape.ts';

export function peReceiveToBody(rec: PmoRecord, ctx: ErpCtx): unknown {
  return {
    payment_type: 'Receive',
    party_type: 'Customer',
    party: ctx.refs.customer,
    paid_amount: rec.paid_amount,
    received_amount: rec.received_amount ?? rec.paid_amount,   // mandatory even same-currency (#3)
    // The adapter supplies BOTH accounts (REST defaults neither). paid_to: cash preferred, bank fallback.
    paid_from: ctx.config.default_receivable_account,
    paid_to: ctx.config.default_cash_account ?? ctx.config.default_bank_account,
    // references[] cites the SI (optional — an unreferenced PE-receive is a valid on-account receipt).
    references: rec.references ?? [],
    // No exchange rates — both auto-derive to 1.0 once the accounts are present (#3).
  };
}

export function peReceiveFromDoc(doc: unknown): PmoRecord {
  const d = doc as Record<string, unknown>;
  return {
    id: String(d.name),
    ip_number: String(d.name),
    reference_number: (d.reference_no as string | null) ?? null,   // also the anchor carrier
    amount: mirrorMoney(d.paid_amount),                             // header = money oracle
    erp_docstatus: (d.docstatus as number | null) ?? null,
    erp_modified: (d.modified as string | null) ?? null,
    erp_amended_from: (d.amended_from as string | null) ?? null,
  };
}
```

**Verify:** `npx vitest run src/lib/adapterSeam/erpnext/bodies` (extend — `peReceiveToBody` sends
`payment_type:'Receive'`, `party_type:'Customer'`, both accounts from config, `received_amount` explicit,
`references`, and NO `reference_no`; `peReceiveFromDoc` mirrors `paid_amount`/`reference_no`).

### 1.5 — Wire the two bodies into `DOCTYPE_BODIES` (FR-SAR-012, additive)

**File** `pmo-portal/src/lib/adapterSeam/erpnext/doctypeBodies.ts` — append the two imports + entries:

```ts
import { siToBody, siFromDoc } from './bodies/salesInvoice.ts';
import { peReceiveToBody, peReceiveFromDoc } from './bodies/incomingPayment.ts';
// appended to DOCTYPE_BODIES:
'sales-invoice': { toBody: siToBody, fromDoc: siFromDoc },
'incoming-payment': { toBody: peReceiveToBody, fromDoc: peReceiveFromDoc },
```

**Verify:** `npm run typecheck`; `npx vitest run src/lib/adapterSeam/erpnext/doctypeBodies.test.ts`.

### 1.6 — `siStatus.ts` — SI status derivation (FR-SAR-103, the piStatus twin)

**File** `pmo-portal/src/lib/adapterSeam/erpnext/siStatus.ts` (new — mirrors `piStatus.ts`):

```ts
/**
 * erpnext/siStatus.ts (P3a, FR-SAR-103) — derives the PMO `sales_invoices.status`
 * (`'Draft'|'Submitted'|'Unpaid'|'Paid'|'Cancelled'`) from ERPNext's mirrored `docstatus` +
 * `erp_outstanding_amount` (R9 §2 AR paid-detection: a referenced PE-receive submit flips the SI's
 * `outstanding_amount` to 0 server-side — the mirror never recomputes this, ADR-0048).
 */
export type SalesInvoiceStatus = 'Draft' | 'Submitted' | 'Unpaid' | 'Paid' | 'Cancelled';

export function deriveSiStatus(erpOutstandingAmount: string | null | undefined, docstatus: number | null | undefined): SalesInvoiceStatus {
  if (docstatus === 2) return 'Cancelled';
  if (docstatus === 1) {
    // a submitted SI with outstanding 0 is Paid; otherwise Unpaid (R9: a submitted SI is Unpaid until paid)
    return erpOutstandingAmount != null && Number(erpOutstandingAmount) === 0 ? 'Paid' : 'Unpaid';
  }
  return 'Draft'; // docstatus 0 / null
}
```

**Verify:** `npx vitest run src/lib/adapterSeam/erpnext/siStatus.test.ts` (new — Draft/Unpaid/Paid/Cancelled
for the docstatus×outstanding matrix).

### 1.7 — RED+GREEN: `moneyShape.test.ts` extended for SI + PE-receive (OWNS AC-SAR-030 + AC-SAR-031)

**File** `pmo-portal/src/lib/adapterSeam/erpnext/moneyShape.test.ts` (extend). AC-SAR-030: a cents-bearing
SI `grand_total`/`outstanding_amount` round-trip through `siFromDoc`→`mirrorMoney`→numeric exactly, no JS
float; the header total is the oracle. AC-SAR-031: PE-receive `paid_amount`/`allocated_amount` round-trip
into `incoming_payments.amount`; an absent optional → SQL `NULL` (not `0`); an over-`numeric(14,2)` value
→ `commit-rejected` (never truncated). GREEN via `mirrorMoney` (already shipped) — these prove the bodies
use it correctly. **Verify:** `npx vitest run src/lib/adapterSeam/erpnext/moneyShape.test.ts` → GREEN.

### 1.8 — Slice-1 gate

**Verify:** `cd pmo-portal && npm run verify` green. **AC-SAR-030, AC-SAR-031 owned.** PR to `dev`.

---

## Slice 2 — Dispatch wiring: revenue resolver + read-model writer + recovery probe + regression net

**Goal:** route a flipped org's `revenue` command through the served dispatch to the erpnext adapter with
the new bodies; mirror into the new tables; add the `payment_type` recovery-probe discriminator; land the
**AC-SAR-001 regression net FIRST** (cold map ⇒ revenue rejected, P2 byte-for-byte). Owns AC-SAR-001,
AC-SAR-013 (held-on-inconclusive), AC-SAR-014 (payment_type discriminator).

### 2.1 — RED: `pmo-portal/src/lib/repositories/revenue.external.test.ts` (OWNS AC-SAR-001, the regression net — FIRST)

**File** (new — mirrors `procurement.external.test.ts`'s discipline). Asserts on a **cold ownership map**
(no org employs `revenue`, the shipped default):
- a `revenue` command (createInvoice/createPayment) is rejected at the repository layer with
  `revenue-not-enabled` (OQ-SAR-6: no PMO-native path today) and **never** dispatches — `dispatchSpy` uncalled;
- a flipped-org revenue command (setDomainOwnership `revenue`→`erpnext`) routes to `dispatchDomainCommand`
  with `erp_doc_kind` + a minted `idempotencyKey`;
- P2 procurement/company writes stay byte-for-byte on the direct DAL (re-assert the AC-ENA-001 invariant —
  P3a must not perturb P2).
The repository does not exist yet → RED. **Verify:** `npx vitest run src/lib/repositories/revenue.external.test.ts` → RED.

### 2.2 — GREEN: `repositories.revenue` seam (FR-SAR-005, OQ-SAR-6) — routes external when flipped, rejects otherwise

**File** `pmo-portal/src/lib/repositories/index.ts` (extend — add a `revenue` repository object alongside
`procurement`/`company`/`task`). Methods: `createInvoice`, `createPayment`, `submitInvoice`,
`cancelInvoice`, `cancelPayment`. Each: read ownership via `routeDomainWrite('revenue')`; on `'pmo'` (cold /
not employed) throw `AppError('revenue is not enabled for this org', 'revenue-not-enabled')`; on
`'external'` mint an `idempotencyKey` (`crypto.randomUUID()`) + set `erp_doc_kind` and call
`dispatchDomainCommand`. (The detailed UI-facing shape lands in slice 4; this is the routing seam the test
needs.) **Verify:** 2.1 → GREEN.

### 2.3 — `dispatchFactory.ts` — revenue ref resolver (customer + project + SI, FR-SAR-100/101/121)

**File** `pmo-portal/src/lib/adapterSeam/erpnext/dispatchFactory.ts` (extend). Add
`resolveRevenueRefs(deps, binding)` mirroring `resolveProcurementOrderRefs`: for a `sales-invoice` command
resolve `ctx.refs.customer` from `record.customerId` via `external_refs` (companies domain,
`Customer:<name>` → strip prefix) + `ctx.refs.project` from `record.projectId` via the binding's
ERP-project→PMO map (`binding.config.project_map[projectId]` → ERP `project` name; the map is binding data,
not a new table); for an `incoming-payment` command resolve `ctx.refs.customer` + the `references[]` row's
`reference_name` from `record.salesInvoiceId` via `external_refs` (revenue domain → the SI's ERP name). Wire
it into `resolveErpDispatchAdapter`'s refs assembly (additive — `record.erp_doc_kind in
('sales-invoice','incoming-payment')` takes the revenue branch; others unchanged). **Verify:**
`npx vitest run src/lib/adapterSeam/erpnext/dispatchFactory.test.ts` (extend — revenue refs resolved; the
`revenue` domain takes the new branch; procurement byte-for-byte).

### 2.4 — `revenue` read-model writer (FR-SAR-013/103/121/161, the procurementWriter twin)

**File** `supabase/functions/adapter-dispatch/readModelWriters.ts` (extend). Add `upsertSalesInvoiceMirror`
(`si_number`/`customer_id`/`project_id`/`reference_number`/`invoice_date`/`amount`←`grand_total`/
`erp_outstanding_amount`/`status`←`deriveSiStatus`/`erp_*`; on create insert with `project_id`/`customer_id`
from the command record; `erp_cancelled_at` on docstatus 2) + `upsertIncomingPaymentMirror`
(`ip_number`/`customer_id`/`sales_invoice_id`/`reference_number`/`date`/`amount`←`paid_amount`/
`status`←docstatus 1?'Paid':'Scheduled'/`erp_*`; `sales_invoice_id` resolved from the command's
`record.salesInvoiceId`). Add a `revenueWriter: ReadModelWriter` whose `upsert` switches on `erp_doc_kind`
(the procurementWriter twin), and register `revenue: revenueWriter` in `READ_MODEL_WRITERS`. Reuse
`recordOutboundLineage` for the revenue domain (domain `'revenue'`). The `sales_invoice_id` is the command's
own resolved PMO id (the FE/repository sets it), mirroring `payments.invoice_id`. **Verify:**
`cd supabase/functions/adapter-dispatch && deno check readModelWriters.ts && deno test readModelWriters.test.ts`
(extend — revenue writer upserts the right shape; `project_id`/`sales_invoice_id` machine-set).

### 2.5 — Recovery probe `payment_type` discriminator (FR-SAR-083, AC-SAR-014)

**File** `pmo-portal/src/lib/adapterSeam/erpnext/recoveryProbe.ts` (extend). Add `paymentType: 'Pay' |
'Receive'` to `ErpPaymentCompositeInput` + the filter set:

```ts
export interface ErpPaymentCompositeInput {
  partyType: string;
  party: string;
  paidAmount: string | number;
  piNames: string[];          // procurement: Purchase Invoice names
  siNames: string[];          // P3a: Sales Invoice names (PE-receive references)
  createdAfter: string;
  paymentType: 'Pay' | 'Receive';   // FR-SAR-083 — discriminates the one-Payment-Entry-doctype/two-kinds
}
// in probeErpByPaymentComposite, add to filters:
['payment_type', '=', input.paymentType],
// and the references match: a PE-receive cites Sales Invoices (input.siNames); a PE-pay cites Purchase
// Invoices (input.piNames) — match against the union so a PE-receive cannot adopt a PE-pay (and vice-versa):
if (references.some((r) => input.piNames.includes(String(r.reference_name)) || input.siNames.includes(String(r.reference_name))))
```

Update the existing PE-pay caller (`index.ts`) to supply `paymentType:'Pay'` + `siNames:[]` (additive — the
composite currently omits it; adding it is correctness hardening for the two-kind world). The PE-receive
caller supplies `paymentType:'Receive'` + `piNames:[]`. **Verify:**
`npx vitest run src/lib/adapterSeam/erpnext/recoveryProbe.test.ts` (AC-SAR-014 — a PE-pay and PE-receive of
the same customer/amount do not cross-match; the discriminator routes each to its own).

### 2.6 — Wire the PE-receive composite probe + `held`-on-inconclusive into the served dispatch (FR-SAR-042/123, AC-SAR-013)

**File** `supabase/functions/adapter-dispatch/index.ts` (extend). In the money-dispatch probe-builder
branch: for `erp_doc_kind === 'incoming-payment'`, build the composite payload
(`paymentType:'Receive'`, `partyType:'Customer'`, `party`←resolved customer, `paidAmount`←`paid_amount`,
`siNames`←resolved SI ERP names, `createdAfter`) and select `probeErpByPaymentComposite` as the probe +
`reissueOnInconclusiveAbsence: !entry.anchorMutable` (= `false` for PE-receive → `held`-on-inconclusive,
C-1 verbatim — already the shipped contract). For `sales-invoice`, the anchor is `remarks`/immutable →
`probeErpByAnchorKey` + reissue-capable (the PI twin — already the shipped path). The `isErpDomain` check
grows to include `ERPNEXT_REVENUE_DOMAIN`. **Verify:**
`cd supabase/functions/adapter-dispatch && deno test` (extend `moneyOutboxDeps.test.ts`/the dispatch money
test — a PE-receive post-window inconclusive recovery → `held`, `command-held` on retry, no reissue; AC-SAR-013).

### 2.7 — RED+GREEN: `recoveryProbe.test.ts` held-on-inconclusive for Receive (OWNS AC-SAR-013)

**File** `pmo-portal/src/lib/adapterSeam/erpnext/recoveryProbe.test.ts` (extend). AC-SAR-013: a quarantined
PE-receive outbox row past its window whose composite probe returns 0 (or >1) matches → the dispatch path
transitions to `held` (the contract is `reissueOnInconclusiveAbsence=false` for `incoming-payment`); assert
no second Payment Entry is ever created. This is the unit proof; the served-fn proof is AC-SAR-010 (slice 7).
**Verify:** `npx vitest run src/lib/adapterSeam/erpnext/recoveryProbe.test.ts` → GREEN.

### 2.8 — Confirm the byte-for-byte path (AC-SAR-001 part 2 + AC-ENA-001 re-assert)

Re-run `procurement.external.test.ts` + the P2 dispatch/ownership tests unchanged → green (the revenue
additions are additive; no procurement/company path touched). **Verify:** `npx vitest run src/lib/repositories/
src/lib/adapterSeam/` (full adapter+repository suite green).

### 2.9 — `process_gates` read helper stub (used by slice 3; minimal here so the dispatch compiles)

**File** `pmo-portal/src/lib/adapterSeam/erpnext/processGates.ts` (new — pure helper, no enforcement yet):
`readProcessGates(config): {require_so_before_si:boolean; require_bast_before_si:boolean;
require_project_on_si:boolean}` returning the defaults when the key is absent. Slice 3 wires enforcement +
the pgTAP. **Verify:** `npx vitest run src/lib/adapterSeam/erpnext/processGates.test.ts` (defaults hold).

### 2.10 — Slice-2 gate

**Verify:** `cd pmo-portal && npm run verify` green; `cd supabase/functions/adapter-dispatch && deno check`.
**AC-SAR-001, AC-SAR-013, AC-SAR-014 owned.** PR to `dev`.

---

## Slice 3 — Process gates (org-config seam) + SoD RPC on SI submit

**Goal:** ship the `process_gates` org-config seam (`require_project_on_si` enforced at the dispatch
boundary + UI affordance; SO/BAST inert) + the security-definer `submit_sales_invoice` RPC (approver ≠
author). Owns AC-SAR-070 (unit gate-ON), AC-SAR-072 (pgTAP defaults + Admin-flip), AC-SAR-073 (pgTAP SoD).

### 3.1 — RED: pgTAP `supabase/tests/process_gates_defaults.test.sql` (OWNS AC-SAR-072)

**File** (new). Seeds a `revenue`-employed binding with NO explicit `process_gates`; asserts
`readProcessGates`-equivalent SQL (a helper RPC `get_process_gates(org)` or inline jsonb reads) returns the
defaults `{require_so_before_si:false, require_bast_before_si:false, require_project_on_si:true}`; asserts a
non-Admin (`auth_role()!='Admin'`) `UPDATE external_org_bindings … config.process_gates=…` is denied by RLS
(only `can('manage_external_bindings')` = Admin may flip); asserts a non-`revenue` org has no
`process_gates` key surfaced (inert). **Verify:** `scripts/with-db-lock.sh supabase test db -- -f process_gates_defaults` → RED (helper/RLS not present).

### 3.2 — GREEN: `get_process_gates(org)` RPC + the Admin-only flip (FR-SAR-190/192)

**File** `supabase/migrations/0105_sales_invoice_submit_sod.sql` (new — re-verify the number; this
migration carries BOTH the process_gates helper RPC and the SoD RPC, since they are one PR). Add:

```sql
-- §A — process_gates (data in external_org_bindings.config; no schema change). A read helper so the
-- dispatch + the UI read ONE normalized shape with safe defaults.
create or replace function public.get_process_gates(p_org uuid)
returns jsonb language sql security definer set search_path = public as $$
  select coalesce(
    (select (config -> 'process_gates') from public.external_org_bindings
       where org_id = p_org and external_tier = 'erpnext'),
    '{"require_so_before_si":false,"require_bast_before_si":false,"require_project_on_si":true}'::jsonb
  );
$$;
revoke all from public; grant execute on function public.get_process_gates(uuid) to authenticated;
-- The Admin-only flip is the EXISTING external_org_bindings RLS (Admin-only UPDATE, 0096) — no new policy.
```

(The flip is `UPDATE external_org_bindings SET config = jsonb_set(config,'{process_gates,…}',…)` — already
Admin-gated by 0096's binding UPDATE policy; task 4 wires the UI.) **Verify:** 3.1 → GREEN.

### 3.3 — RED: pgTAP `supabase/tests/si_submit_sod.test.sql` (OWNS AC-SAR-073)

**File** (new). Seeds a draft `sales_invoices` row authored by user A (`author_user_id=A`); asserts:
- user A calling `submit_sales_invoice(si_id)` → `sod-self-approval` (`42501`), no `docstatus` change;
- user B calling `submit_sales_invoice(si_id)` → succeeds (returns the row; the dispatch then issues the ERP
  submit). (The RPC is the PMO-side authority gate BEFORE the ERP submit; the ERP `docstatus 0→1` itself is
  issued by the dispatch under the caller B's command.)
- draft authoring by A (create/edit) is ungated (the SoD applies to submit only).
**Verify:** `scripts/with-db-lock.sh supabase test db -- -f si_submit_sod` → RED (RPC + column absent).

### 3.4 — GREEN: the SI-submit SoD RPC + `author_user_id` column (FR-SAR-195, ADR-0019)

**File** `supabase/migrations/0105_sales_invoice_submit_sod.sql` (append §B):

```sql
-- §B — author_user_id on sales_invoices (records who authored the draft; the SoD compares against the
-- submitting JWT user). Nullable for inbound-adopted SIs (no PMO author).
alter table public.sales_invoices add column if not exists author_user_id uuid references auth.users(id);

-- §C — submit_sales_invoice: SECURITY DEFINER, enforces approver ≠ author on the money-commitment step.
-- Mirrors the ADR-0019 procurement approver pattern. The dispatch calls this BEFORE issuing the ERP submit;
-- a self-approval is rejected with a typed error (no ERP call).
create or replace function public.submit_sales_invoice(p_si_id uuid)
returns public.sales_invoices language plpgsql security definer set search_path = public as $$
declare v_row public.sales_invoices; v_org uuid; v_author uuid; v_submitter text;
begin
  select * into v_row from public.sales_invoices where id = p_si_id;
  if not found then raise exception 'sales invoice not found' using errcode = 'P0002'; end if;
  v_org := v_row.org_id;
  if v_org is distinct from auth_org_id()
     or auth_role() not in ('Admin','Executive','Project Manager','Finance')
  then raise exception 'not authorized' using errcode = '42501'; end if;
  v_author := v_row.author_user_id;
  v_submitter := coalesce(auth.uid()::text, '');
  -- SoD (FR-SAR-195): the submitter must differ from the author. Null author (inbound-adopted) is allowed.
  if v_author is not null and v_author::text = v_submitter then
    raise exception 'approver must differ from author (SoD)' using errcode = '42501', 'sod-self-approval';
  end if;
  return v_row;
end; $$;
revoke all from public; grant execute on function public.submit_sales_invoice(uuid) to authenticated;
```

**Verify:** 3.3 → GREEN; `scripts/with-db-lock.sh supabase db reset` clean.

### 3.5 — Dispatch-boundary `require_project_on_si` enforcement (FR-SAR-191, AC-SAR-070)

**File** `supabase/functions/adapter-dispatch/index.ts` (extend). In the revenue-command pre-flight (before
constructing the SI body), read `get_process_gates(org)`; if `require_project_on_si` and the command's
`projectId` is null → respond `commit-rejected` / `project-required` **before** any ERP call (no outbox row
created). SO/BAST gates are recognized but NOT enforced (inert — log + skip). **File**
`pmo-portal/src/lib/adapterSeam/erpnext/processGates.ts` — finalize `readProcessGates` (slice 2.9 stub) +
`enforceGates(gates, command)` returning `null | {code:'project-required'}`. **Verify:**
`cd supabase/functions/adapter-dispatch && deno test` (extend — a null-project SI under gate-ON → rejected
before ERP; gate-OFF → proceeds).

### 3.6 — RED+GREEN: `revenue.external.test.ts` extended for the gate (OWNS AC-SAR-070)

**File** (extend 2.1). AC-SAR-070: a flipped org with `require_project_on_si=true` + a null-`projectId` SI
command → `project-required` before ERP; the UI Submit affordance is disabled for a project-less SI
(`can()`). GREEN via 3.5. **Verify:** `npx vitest run src/lib/repositories/revenue.external.test.ts` → GREEN.

### 3.7 — `can('submit_sales_invoice')` policy (FR-SAR-195 UI affordance)

**File** `pmo-portal/src/auth/policy.ts` (extend). Add `submit_sales_invoice` to the action map: permitted
for the money-author roles **AND** `ctx.userId !== record.author_user_id` (the author cannot submit their
own draft — UX-only; the RPC is the authority). Add `manage_external_bindings` (Admin-only) for the gate
flip. **Verify:** `npx vitest run src/auth/policy.test.ts` (extend — author blocked from submit; non-author
permitted; Admin-only gate flip).

### 3.8 — Slice-3 gate

**Verify:** `cd pmo-portal && npm run verify`; `scripts/with-db-lock.sh supabase test db` (process_gates +
si_submit_sod green; full pgTAP green). **AC-SAR-070, AC-SAR-072, AC-SAR-073 owned.** PR to `dev`.

---

## Slice 4 — FE: revenue repository seam + authoring UI + revenue-per-project read surface

**Goal:** the PMO-side authoring surface for a flipped org — the `repositories.revenue` methods wired to
the dispatch (slice 2 laid the routing; here the full command surface + UI), the Sales Invoice + Incoming
Payment authoring pages (DESIGN.md tokens, shared form primitives, `CanWrite`/approval gates), and the
revenue-per-project read view. No unique AC owner (exercised by the served-fn e2e in slice 7); gated by
`npm run verify` (AC-SAR-002) + the repository unit (AC-SAR-001/070 from slices 2/3).

### 4.1 — Full `repositories.revenue` command surface (FR-SAR-100/102/120/122)

**File** `pmo-portal/src/lib/repositories/index.ts` (extend 2.2). Complete: `createInvoice(procurementId?,
customerId, projectId?, items[])` → dispatch `create`/`sales-invoice`; `submitInvoice(siId)` → dispatch
`transition{submit}` (the FE first calls the SoD RPC `submit_sales_invoice`, then the dispatch submit);
`cancelInvoice(siId)` → `transition{cancel}`; `amendInvoice(siId, …)` → `transition{amend}`;
`createPayment(customerId, salesInvoiceId?, paidAmount, …)` → `create`/`incoming-payment`;
`cancelPayment(ipId)` → `transition{cancel}`. Each mints `idempotencyKey` + sets `erp_doc_kind`. **Verify:**
`npx vitest run src/lib/repositories/revenue.external.test.ts` (extend — full surface routes with the right
kind + key).

### 4.2 — `src/lib/db/revenue.ts` — read accessors (FR-SAR-172)

**File** (new — the read-model DAL, mirrors `db/companies.ts`). `listSalesInvoices(orgId, {projectId?})`,
`getSalesInvoice(id)`, `listIncomingPayments(orgId, {customerId?})`, `getIncomingPayment(id)`. Reads from
`sales_invoices`/`incoming_payments` ONLY (never ERPNext). **Verify:** `npx vitest run src/lib/db/revenue.test.ts`.

### 4.3 — `useRevenue` hooks (repository consumers, ADR-0017)

**File** `pmo-portal/src/hooks/useRevenue.ts` (new). `useSalesInvoices`, `useIncomingPayments`,
`useRevenuePerProject` (the rollup: `SUM(sales_invoices.amount) GROUP BY project_id`, with an 'Unassigned'
bucket for null `project_id`, FR-SAR-191 OFF case). Consume `repositories.revenue`/`useQuery`; never thread
DAL calls or `org_id`. **Verify:** `npx vitest run src/hooks/useRevenue.test.ts` (RTL — render + filter).

### 4.4 — `pages/SalesInvoices.tsx` — the invoice list + authoring (DESIGN.md tokens, shared primitives)

**File** (new — reference template `pages/Companies.tsx`). List of `sales_invoices` (status badge, customer,
amount, `erp_outstanding_amount`, the read-only `payment_terms` due-date display from slice 6); "New Invoice"
opens `EntityFormModal` with `TextField`/`Combobox` (customer)/`Combobox` (project)/a line-items editor,
`FormGrid`/`FieldError`, `classifyMutationError`. `CanWrite` gates create/edit; the Submit affordance is
`can('submit_sales_invoice')`-gated (hidden from the author — slice 3.7). **Verify:** `npx vitest run
pages/SalesInvoices.test.tsx` (RTL — render empty/error/filter; the Submit affordance hidden from author).

### 4.5 — `pages/IncomingPayments.tsx` — the payment list + authoring

**File** (new — same template). List of `incoming_payments`; "Receive Payment" modal (customer Combobox,
optional SI Combobox → resolves `sales_invoice_id`, `paid_amount`, `received_amount`, date); `CanWrite` gate.
**Verify:** `npx vitest run pages/IncomingPayments.test.tsx`.

### 4.6 — Revenue-per-project read surface (FR-SAR-101, the product goal)

**File** `pages/RevenueByProject.tsx` (new) — a read-only rollup table/chart (recharts) of
`useRevenuePerProject`, columns: project, `SUM(amount)`, `SUM(erp_outstanding_amount)` (open AR), count; an
'Unassigned' bucket when `require_project_on_si` is OFF. Drills into the project's invoices. **Verify:**
`npx vitest run pages/RevenueByProject.test.tsx`.

### 4.7 — Route + nav wiring

**File** `pmo-portal/App.tsx` (extend) — add `/sales-invoices`, `/incoming-payments`, `/revenue-by-project`
routes; `components/Shell.tsx` (or the nav) — add the nav entries (Finance section), `CanWrite`-gated for
the money-author roles; hidden entirely for a non-`revenue` org (the ownership cache drives a
`useDomainOwnership('revenue')` hook). **Verify:** `npm run typecheck`; `npx vitest run App.test.tsx`.

### 4.8 — Approval affordance UX (OD-SAR-PMO-IS-THE-UI)

**File** `pages/SalesInvoices.tsx` (extend 4.4). A draft SI authored by the current user shows an
"awaiting approval" state (no Submit button); a different user sees "Approve & Submit"
(`can('submit_sales_invoice')`); clicking calls the SoD RPC then the dispatch submit. A self-approval error
from the RPC surfaces via `classifyMutationError`. **Verify:** `npx vitest run pages/SalesInvoices.test.tsx`
(the author sees no Submit; a non-author sees it; a self-approval attempt is blocked).

### 4.9 — `ConfirmDialog` on cancel (ADR-0019 destructive-write discipline)

SI/PE-receive cancel confirms via the shared `ConfirmDialog` before the dispatch `transition{cancel}`.
**Verify:** `npx vitest run pages/SalesInvoices.test.tsx` (cancel opens the dialog).

### 4.10 — Slice-4 gate

**Verify:** `cd pmo-portal && npm run verify` green (typecheck + lint:ci + test + build; `axe-core` a11y on
the new pages — ADR-0030 Layer-1 gate). PR to `dev`.

---

## Slice 5 — Inbound feed: lifecycle + adopt + Payment-Entry disambiguation + the SI-cancel auto-unlink delta

**Goal:** the existing webhook + sweep apply the lifecycle + adopt for the two new kinds; the one
Payment-Entry-doctype/two-kinds `payment_type` disambiguation; the project-less inbound SI surfaces
`action-required`; the SI-cancel-auto-unlink reconcile (the AR delta — lineage must NOT assume
`LinkExistsError`). Owns AC-SAR-020, AC-SAR-021, AC-SAR-022, AC-SAR-060, AC-SAR-062.

### 5.1 — RED+GREEN: `feedKinds.test.ts` Payment-Entry disambiguation (OWNS AC-SAR-060)

**File** `pmo-portal/src/lib/adapterSeam/erpnext/feedKinds.test.ts` (extend). AC-SAR-060: an inbound
`Payment Entry` event with `payment_type:'Receive'` → kind `incoming-payment`/domain `revenue`/table
`incoming_payments`; `payment_type:'Pay'` → kind `payment`/domain `procurement`/table `payments` — never
cross-routed. `Sales Invoice` is a unique doctype→kind (no disambiguation). GREEN needs 5.2. **Verify:** RED
→ `npx vitest run src/lib/adapterSeam/erpnext/feedKinds.test.ts`.

### 5.2 — `feedKinds.ts` revenue entries + `kindFromDoctypeAndPaymentType` (FR-SAR-081)

**File** `pmo-portal/src/lib/adapterSeam/erpnext/feedKinds.ts` (extend). Add to `KIND_DOMAIN`:
`'sales-invoice':'revenue'`, `'incoming-payment':'revenue'`; `KIND_MIRROR_TABLE`:
`'sales-invoice':'sales_invoices'`, `'incoming-payment':'incoming_payments'`. Because `Payment Entry` maps
to two kinds, add:

```ts
/** Disambiguate an inbound Payment Entry by payment_type (FR-SAR-081): one doctype → two PMO kinds. */
export function kindFromDoctypeAndPaymentType(doctype: string, paymentType?: string): ErpDocKind | undefined {
  if (doctype === 'Payment Entry') {
    if (paymentType === 'Receive') return 'incoming-payment';
    if (paymentType === 'Pay') return 'payment';
    return undefined; // unknown/absent payment_type → ack-and-skip (lossy hint, FR-SAR-083)
  }
  return kindFromDoctype(doctype); // Sales Invoice + every other doctype is unique
}
```

`externalIdForKind` gains the revenue kinds (raw ERP name — revenue uses no doctype prefix, like procurement).
**Verify:** 5.1 → GREEN.

### 5.3 — `erpnextFeedDeps.ts` revenue adopt (FR-SAR-085, project-less SI → action-required)

**File** `supabase/functions/_shared/erpnextFeedDeps.ts` (extend). In `createErpFeedDeps`, the `mintMirror`
branch: for `domain==='revenue'` + `kind==='sales-invoice'`, mint the `sales_invoices` row with
`project_id=NULL` + insert an `action-required` operator task (the AR twin of the companies ambiguous-match
surfacing — never auto-assign the wrong project); for `kind==='incoming-payment'`, resolve
`sales_invoice_id` from the PE `references[]` row's SI ERP name via `external_refs` (nullable for
on-account); a PE-receive referencing an unknown SI → `action-required`. (Procurement inbound adopt stays
the slice-8 throw — unchanged.) The `mirrorStatusPatch` already writes the uniform `erp_*` set to every
mirror table — no change. **Verify:** `cd supabase/functions && deno check _shared/erpnextFeedDeps.ts`.

### 5.4 — Webhook/sweep route by `payment_type` (FR-SAR-060/081)

**File** `supabase/functions/erpnext-webhook/index.ts` + `supabase/functions/erpnext-sweep/index.ts`
(extend). When decoding an inbound `Payment Entry` event, read `doc.payment_type` and call
`kindFromDoctypeAndPaymentType('Payment Entry', payment_type)` (not `kindFromDoctype`) before building the
feed deps. `Sales Invoice` events use `kindFromDoctype` (unique). **Verify:** `cd supabase/functions &&
deno test erpnext-webhook/index.test.ts erpnext-sweep/` (extend — Receive→incoming-payment, Pay→payment).

### 5.5 — RED+GREEN: `lineage.test.ts` extended for revenue kinds (OWNS AC-SAR-020 + AC-SAR-021)

**File** `pmo-portal/src/lib/adapterSeam/erpnext/lineage.test.ts` (extend). AC-SAR-020: a cancelled SI (and
separately PE-receive) → `applyCancel` soft-tombstones (`erp_cancelled_at`/`erp_docstatus=2`), retains
`external_refs`, writes a `cancelled` lineage row. AC-SAR-021: an amended SI (new ERP name,
`amended_from`=old) → `applyAmend` repoints `external_refs` for the same `pmo_record_id`, stamps
`erp_amended_from`, writes an `amended` lineage row, NO duplicate mirror. (The `lineage.ts` module is
domain-agnostic — already shipped; these tests prove it holds for revenue kinds via `createErpFeedDeps`
domain=`'revenue'`.) **Verify:** `npx vitest run src/lib/adapterSeam/erpnext/lineage.test.ts` → GREEN.

### 5.6 — RED+GREEN: `transitionPolicy.test.ts` extended for the SI-cancel auto-unlink (OWNS AC-SAR-022)

**File** `pmo-portal/src/lib/adapterSeam/erpnext/transitionPolicy.test.ts` (extend). AC-SAR-022: cancelling
a referenced SI is NOT hard-blocked by an active PE-receive (the AR delta, OQ-SAR-1 #8). Assert the
read-model reconcile (a separate pure helper `reconcileSiCancelAutoUnlink(siMirror, peMirror)` — see 5.7)
re-derives `incoming_payments.sales_invoice_id`→null + tombstones the SI + leaves the PE-receive's
status/money untouched, given an ERP `200` + `_server_messages` "un-linked" (NOT a `LinkExistsError`). Also
assert `cancelChain` still propagates a real `LinkExistsError` uncaught (procurement behavior unchanged).
**Verify:** `npx vitest run src/lib/adapterSeam/erpnext/transitionPolicy.test.ts` → RED.

### 5.7 — GREEN: the auto-unlink reconcile helper (FR-SAR-051, the AR delta)

**File** `pmo-portal/src/lib/adapterSeam/erpnext/transitionPolicy.ts` (extend) — add a pure helper that,
given a successful SI-cancel response (200) + the knowledge that a PE-receive referenced it, returns the
mirror patch `{sales_invoice_id:null}` for the PE-receive (it becomes on-account) + the SI tombstone. This
is NOT a chain-block (the chain proceeds); it is the read-model reconcile. The dispatch read-model writer
(slice 2.4) applies it on a cancel. **`transitionPolicy.cancelChain` itself is unchanged** — it propagates
rejections uncaught; the SI-cancel path simply does not throw (ERP returns 200). **Verify:** 5.6 → GREEN.

### 5.8 — RED+GREEN: webhook HMAC for revenue kinds (OWNS AC-SAR-062)

**File** `supabase/functions/erpnext-webhook/index.test.ts` (extend). AC-SAR-062: an inbound SI/PE-receive
webhook with invalid/absent `X-Frappe-Webhook-Signature` → `401`, no side effect; valid → applied as a hint.
(The HMAC verification is already shipped; this proves it covers the revenue kinds.) **Verify:** `cd
supabase/functions && deno test erpnext-webhook/index.test.ts` → GREEN.

### 5.9 — Slice-5 gate

**Verify:** `cd pmo-portal && npm run verify`; `cd supabase/functions && deno check && deno test`.
**AC-SAR-020, AC-SAR-021, AC-SAR-022, AC-SAR-060, AC-SAR-062 owned.** PR to `dev`.

---

## Slice 6 — AR aging scope wiring + Customer payment_terms due-date display

**Goal:** wire the AR scope into the binding config + the sweep scheduling (the
`refreshAging('Accounts Receivable','erp_ar_aging_snapshot',…)` path is ALREADY shipped — slice 6 only
wires + confirms the bench-probed shape); add the read-only Customer `payment_terms` due-date display. Owns
AC-SAR-051 (unit). (AC-SAR-050 served-fn e2e lands in slice 7.)

### 6.1 — AR aging scope wiring in the sweep + binding (FR-SAR-151)

**File** `supabase/functions/erpnext-sweep/index.ts` (extend). The sweep already refreshes AP aging; add the
AR refresh call alongside it: `refreshAging(serviceClient, client, orgId, { reportName:'Accounts Receivable',
snapshotTable:'erp_ar_aging_snapshot', filters: <AR pinned shape from binding config>, partyType:'Customer',
… })`. The binding config's `aging_report_names` already carries `'Accounts Receivable'` (P2 shipped it) —
this task ensures the sweep iterates BOTH report names. The `parseAgingReport` parser handles both (the AR
shape = AP shape, OQ-SAR-1 #6 — strip the non-dict totals row). **Verify:** `cd supabase/functions && deno
test erpnext-sweep/` (extend — the sweep calls refreshAging for both AP + AR).

### 6.2 — RED+GREEN: `revenueDisplay.test.ts` payment_terms due-date (OWNS AC-SAR-051)

**File** `pmo-portal/src/lib/repositories/revenueDisplay.test.ts` (new). AC-SAR-051: given a mirrored
Customer with `erp_payment_terms_days` + a mirrored SI with `invoice_date`, the derived display due-date is
`invoice_date + erp_payment_terms_days` (or ERP's own `due_date` when ERPNext provides one) — read-only
display; PMO never writes receivables-terms truth. GREEN: `src/lib/repositories/revenueDisplay.ts` — a pure
`deriveArDueDate(invoiceDate, paymentTermsDays, erpDueDate?)` helper. **Verify:**
`npx vitest run src/lib/repositories/revenueDisplay.test.ts` → GREEN.

### 6.3 — Wire the due-date display into the UI (FR-SAR-141)

**File** `pages/SalesInvoices.tsx` (extend 4.4) + `pages/RevenueByProject.tsx` — show the derived AR due
date column via `deriveArDueDate`, sourced from the mirrored `erp_payment_terms_days` (already on
`companies`, P2). Read-only. **Verify:** `npx vitest run pages/SalesInvoices.test.tsx` (the due-date column
renders).

### 6.4 — Slice-6 gate

**Verify:** `cd pmo-portal && npm run verify`; `cd supabase/functions && deno check`. **AC-SAR-051 owned.**
PR to `dev`. (AC-SAR-050 served-fn e2e → slice 7.)

---

## Slice 7 — Served-fn serial e2e lane (`e2e/serial/AC-SAR-*.spec.ts`) + smokes

**Goal:** the real-boundary money-command e2e for the revenue domain at the **real served
`adapter-dispatch`** + the server-side fault seams (NEVER `page.route`, NFR-SAR-TEST-001). Lane:
`e2e/serial/`, `// @e2e-isolation: serial`, run under
`scripts/with-db-lock.sh scripts/with-erpnext-lock.sh scripts/serve-functions.sh -- npx playwright test …`
with `EDGE_JWT_ISSUER` lane + `ERPNEXT_SITE_URL=http://host.docker.internal:8080` (Docker-reachable from the
served fn; `ERPNEXT_BENCH_URL=http://localhost:8080` host-reachable for the optional ERP-side proof). Owns
**all** the served-fn e2e ACs: AC-SAR-010, 011, 040, 041, 042, 043, 050, 071.

### 7.1 — Shared e2e helpers + the revenue seed/cleanup (model on AC-ENA-053)

**File** `pmo-portal/e2e/serial/_sarHelpers.ts` (new — shared seed/cleanup). Seeds: a Client `companies`
row + `external_refs` (`Customer:<name>`), a `projects` row, a pre-activated `external_org_bindings` row
with the receivable-side account defaults (`default_receivable_account:'Debtors - PSC'`,
`default_income_account:'Sales - PSC'`, `default_cash_account:'Cash - PSC'`, + `project_map`), + the
`external_domain_ownership` flip (`domain:'revenue'`). Cleanup deletes scoped to the run's suffix (mirror
the P2 cleanup + the OD-ENA-E2E-CLEANUP note — delete the `revenue` ownership + binding rows). Uses
`ORG_ID=00000000-0000-0000-0000-000000000001`, `EDGE_JWT_ISSUER` for the served-fn JWT lane. **Verify:**
`npm run typecheck`.

### 7.2 — RED+GREEN: `e2e/serial/AC-SAR-040-sales-invoice.spec.ts` (OWNS AC-SAR-040, spike-frozen gate)

**File** (new). Real boundary: create + submit a Sales Invoice (`{customer, items:[{item_code,qty,rate}],
project}`) through the served dispatch → ERP commits (two-step insert→submit); assert `sales_invoices`
mirrors (`si_number`←ERP name, `customer_id`, `amount`←`grand_total`, `erp_outstanding_amount`←
`outstanding_amount`, `project_id`←the PMO project, status), `external_refs` (`'revenue'`) recorded, the
ERP-side `project` dimension stamped (verify via the optional ERP GET). **No `page.route`.**
**Verify:** `scripts/with-db-lock.sh scripts/with-erpnext-lock.sh scripts/serve-functions.sh -- npx
playwright test AC-SAR-040` → GREEN.

### 7.3 — RED+GREEN: `e2e/serial/AC-SAR-041-pe-receive.spec.ts` (OWNS AC-SAR-041, spike-frozen gate)

**File** (new). Real boundary: given a submitted SI with non-zero `erp_outstanding_amount`, create + submit
a PE-receive (adapter supplies `paid_from`=receivable, `paid_to`=cash, `received_amount` explicit,
`references[]` to the SI) → ERP commits the Receive Payment Entry; assert `incoming_payments` mirrors
(`amount`=paid_amount, `sales_invoice_id`→the SI, `reference_number`=the anchor carrier), and the SI flips
`Paid`/`erp_outstanding_amount=0` server-side (mirrored). **No `page.route`.** **Verify:** `… npx playwright
test AC-SAR-041` → GREEN.

### 7.4 — RED+GREEN: `e2e/serial/AC-SAR-010-pe-receive-idempotency.spec.ts` (OWNS AC-SAR-010, the fault seam)

**File** (new — model on `AC-ENA-010-payment-idempotency.spec.ts`). Real boundary +
`ERPNEXT_TEST_FAULTS=1` + header `x-erpnext-test-fault: after-commit-before-mirror`: a PE-receive command
with an `idempotencyKey` whose ERP commit succeeds but the function's response is interrupted server-side;
retry the exact command → ERPNext holds **one** Receive Payment Entry, the outbox reconciles
(`pending`/`committed`→`confirmed` via the `reference_no`-anchor or composite probe), PMO holds **one**
`incoming_payments` mirror row, no duplicate (the double-receive guard). **No `page.route`.** **Verify:** `…
npx playwright test AC-SAR-010` → GREEN.

### 7.5 — RED+GREEN: `e2e/serial/AC-SAR-011-si-recovery-adopt.spec.ts` (OWNS AC-SAR-011)

**File** (new — model on `AC-ENA-013-pi-recovery-adopt.spec.ts`). Real boundary + the `after-commit-before-
mirror` fault: a SI whose ERP create committed but the outbox is left `pending`/`committed`; the sweep/retry
runs → adopts the existing ERP SI (via `committed` fenced-finalize or the `remarks`-key probe, immutable
anchor) and finishes **one** `sales_invoices` mirror row — never a second. **Verify:** `… npx playwright test
AC-SAR-011` → GREEN.

### 7.6 — RED+GREEN: `e2e/serial/AC-SAR-042-si-cancel-amend.spec.ts` (OWNS AC-SAR-042)

**File** (new — model on `AC-ENA-023-pi-cancel-amend.spec.ts`). Real boundary: cancel then amend a
submitted SI through the served dispatch → cancel soft-tombstones (+ lineage), amend repoints
`external_refs` to the new ERP `name` + stamps `erp_amended_from` + writes lineage, PMO holds exactly one
live `sales_invoices` row for the `pmo_record_id`. (If a PE-receive references the SI, the cancel reconciles
the auto-unlink — AC-SAR-022's served-fn proof.) **Verify:** `… npx playwright test AC-SAR-042` → GREEN.

### 7.7 — RED+GREEN: `e2e/serial/AC-SAR-043-inbound-si-adopt.spec.ts` (OWNS AC-SAR-043)

**File** (new). Real boundary: a SI created natively in ERPNext (no PMO command) + an inbound
webhook/sweep event → a `sales_invoices` mirror row is minted with `project_id=NULL` + an `action-required`
operator task; the webhook acks, the sweep re-surfaces it; no project auto-assigned. **Verify:** `… npx
playwright test AC-SAR-043` → GREEN.

### 7.8 — RED+GREEN: `e2e/serial/AC-SAR-050-ar-aging-readback.spec.ts` (OWNS AC-SAR-050)

**File** (new — model on `AC-ENA-061-aging-readback.spec.ts`). Real boundary: an ERPNext org owning
`revenue` with open AR entries + the aging-report binding configured; refresh AR aging through the served
sweep → `erp_ar_aging_snapshot` stores report-backed buckets verbatim with
`report_date`/`range_labels`/`ageing_based_on`/`as_of`/`report_version`, snapshot-replaced per scope, and
**no** bucket is computed by invoice-only local math over `sales_invoices` (FR-SAR-152). **Verify:** `… npx
playwright test AC-SAR-050` → GREEN.

### 7.9 — RED+GREEN: `e2e/serial/AC-SAR-071-gate-off-unassigned.spec.ts` (OWNS AC-SAR-071)

**File** (new). Real boundary: an org with `process_gates.require_project_on_si=false` (Admin-relaxed) + a
null-`projectId` SI command → ERP commits the SI (project-less), the `sales_invoices` mirror has
`project_id=NULL`, and the revenue-per-project view rolls it up under 'Unassigned' (never silently dropped).
**Verify:** `… npx playwright test AC-SAR-071` → GREEN.

### 7.10 — Smokes + the full serial-lane gate

**File** `pmo-portal/e2e/served-fn-smoke.spec.ts` (extend) — a revenue smoke (one SI create+submit + one
PE-receive) asserting the served boundary is healthy for the revenue domain. **Verify (the binding gate):**
`scripts/with-db-lock.sh scripts/with-erpnext-lock.sh scripts/serve-functions.sh -- npx playwright test
e2e/serial/AC-SAR- e2e/served-fn-smoke.spec.ts` (full serial lane green); then `cd pmo-portal && npm run
verify` (the WHOLE suite — AC-SAR-002, no P2 regression). **AC-SAR-010, 011, 040, 041, 042, 043, 050, 071
owned.** PR to `dev`.

---

## 4. Traceability (every AC-SAR-### → owning layer + slice)

| AC | Requirement(s) | Owning layer | Slice | Planned proof |
|---|---|---|---|---|
| AC-SAR-001 | FR-SAR-004, FR-SAR-005 | Vitest (unit) | 2 | `pmo-portal/src/lib/repositories/revenue.external.test.ts` |
| AC-SAR-002 | FR-SAR-004 | **Cross-layer regression gate** | every slice | the unchanged P2 suite (`npm run verify` + pgTAP + `e2e/serial/AC-ENA-*`) staying green IS the proof (mirrors AC-ENA-002) |
| AC-SAR-003 | FR-SAR-004, FR-SAR-170 | pgTAP | 0 | `supabase/tests/erpnext_sales_invoices_flip_rls.test.sql` |
| AC-SAR-010 | FR-SAR-040..045, NFR-SAR-IDEM-001 | served-fn e2e | 7 | `pmo-portal/e2e/serial/AC-SAR-010-pe-receive-idempotency.spec.ts` |
| AC-SAR-011 | FR-SAR-045 | served-fn e2e | 7 | `pmo-portal/e2e/serial/AC-SAR-011-si-recovery-adopt.spec.ts` |
| AC-SAR-012 | FR-SAR-041 | pgTAP | 0 | `supabase/tests/external_command_outbox_rls.test.sql` (extend for `'revenue'`) |
| AC-SAR-013 | FR-SAR-042, FR-SAR-123 | Vitest (unit) | 2 | `pmo-portal/src/lib/adapterSeam/erpnext/recoveryProbe.test.ts` (Receive + held) |
| AC-SAR-014 | FR-SAR-083 | Vitest (unit) | 2 | `pmo-portal/src/lib/adapterSeam/erpnext/recoveryProbe.test.ts` (payment_type discriminator) |
| AC-SAR-020 | FR-SAR-052 | Vitest (unit) | 5 | `pmo-portal/src/lib/adapterSeam/erpnext/lineage.test.ts` (revenue kinds cancel) |
| AC-SAR-021 | FR-SAR-053, NFR-SAR-DOC-001 | Vitest (unit) | 5 | `pmo-portal/src/lib/adapterSeam/erpnext/lineage.test.ts` (revenue amend) |
| AC-SAR-022 | FR-SAR-051, FR-SAR-102 | Vitest (unit) | 5 | `pmo-portal/src/lib/adapterSeam/erpnext/transitionPolicy.test.ts` (SI cancel auto-unlink, NOT LinkExistsError) |
| AC-SAR-030 | FR-SAR-070, FR-SAR-071, NFR-SAR-MONEY-001 | Vitest (unit) | 1 | `pmo-portal/src/lib/adapterSeam/erpnext/moneyShape.test.ts` (SI) |
| AC-SAR-031 | FR-SAR-070, FR-SAR-072 | Vitest (unit) | 1 | `pmo-portal/src/lib/adapterSeam/erpnext/moneyShape.test.ts` (PE-receive) |
| AC-SAR-040 | FR-SAR-100, FR-SAR-101, FR-SAR-103 | served-fn e2e | 7 | `pmo-portal/e2e/serial/AC-SAR-040-sales-invoice.spec.ts` *(spike-frozen)* |
| AC-SAR-041 | FR-SAR-120..122, FR-SAR-161 | served-fn e2e | 7 | `pmo-portal/e2e/serial/AC-SAR-041-pe-receive.spec.ts` *(spike-frozen)* |
| AC-SAR-042 | FR-SAR-050, FR-SAR-052, FR-SAR-053 | served-fn e2e | 7 | `pmo-portal/e2e/serial/AC-SAR-042-si-cancel-amend.spec.ts` |
| AC-SAR-043 | FR-SAR-085 | served-fn e2e | 7 | `pmo-portal/e2e/serial/AC-SAR-043-inbound-si-adopt.spec.ts` |
| AC-SAR-050 | FR-SAR-150..152 | served-fn e2e | 7 | `pmo-portal/e2e/serial/AC-SAR-050-ar-aging-readback.spec.ts` |
| AC-SAR-051 | FR-SAR-141 | Vitest (unit) | 6 | `pmo-portal/src/lib/repositories/revenueDisplay.test.ts` |
| AC-SAR-060 | FR-SAR-081 | Vitest (unit) | 5 | `pmo-portal/src/lib/adapterSeam/erpnext/feedKinds.test.ts` (Payment Entry disambiguation) |
| AC-SAR-061 | FR-SAR-170, FR-SAR-171, NFR-SAR-SEC-003/004 | pgTAP | 0 | `supabase/tests/erpnext_sales_invoices_flip_rls.test.sql` + `erpnext_incoming_payments_flip_rls.test.sql` |
| AC-SAR-062 | FR-SAR-084 | Vitest (unit) | 5 | `supabase/functions/erpnext-webhook/index.test.ts` (revenue kinds HMAC) |
| AC-SAR-070 | FR-SAR-191, FR-SAR-192 | Vitest (unit) | 3 | `pmo-portal/src/lib/repositories/revenue.external.test.ts` (gate-ON blocks null-project SI) |
| AC-SAR-071 | FR-SAR-191 | served-fn e2e | 7 | `pmo-portal/e2e/serial/AC-SAR-071-gate-off-unassigned.spec.ts` |
| AC-SAR-072 | FR-SAR-190, FR-SAR-192 | pgTAP | 3 | `supabase/tests/process_gates_defaults.test.sql` (defaults + Admin-only flip) |
| AC-SAR-073 | FR-SAR-195, ADR-0019 | pgTAP | 3 | `supabase/tests/si_submit_sod.test.sql` (self-approval rejected, cross-user permitted) |

> NFR-SAR-SEC-001/002, CONTRACT-001, PERF-001, REV-001, DEVBED-001 are structural — proven transitively
> (no-custom-app + secret-confinement via `credentials.ts` + vocabulary-confinement + reversibility are
> preconditions exercised by the rows above) and reviewed at the gate. NFR-SAR-IDEM-001 / DOC-001 /
> MONEY-001 / FEED-001 are owned by AC-SAR-010/013/014, AC-SAR-021/022, AC-SAR-030/031, AC-SAR-060
> respectively. **AC-SAR-040/041 are spike-frozen gates** (OQ-SAR-1 froze the SI/PE-receive body map
> 2026-07-14) — unblocked.

---

## 5. Open questions for the Director

1. **`project_map` binding shape (FR-SAR-101).** The dispatch resolves the ERP `project` name from the
   PMO `projectId` via `binding.config.project_map`. The spike confirmed the ERP `project` field propagates
   to both GL legs, but the **resolution mechanism** (PMO project → ERP project name) needs the ERP project
   to exist with a `project_name` matching a PMO project (Projects use a `PROJ-#####` series, client `name`
   ignored — OQ-SAR-1 #5). **Q:** is `project_map` a hand-curated jsonb map (Admin sets it at binding time),
   or does the dispatch search ERP Projects by `project_name == pmo_project.name`? Plan assumes a jsonb map
   (simplest, Admin-owned, matches `default_*_account` being binding data); the search-by-name fallback is a
   one-line alternative in `resolveRevenueRefs` (task 2.3). Director to confirm.
2. **`action-required` operator task surface (FR-SAR-085).** The project-less inbound SI mints an
   `action-required` row. **Q:** is this the existing `audit_events`/automation-task surface, or a new
   lightweight `operator_tasks` table? Plan reuses the companies ambiguous-match pattern (an
   `external_refs`-adjacent surfacing) without prescribing the table — confirm the surface before slice 5.
3. **`EDGE_JWT_ISSUER` lane (slice 7).** The served-fn e2e uses the EDGE JWT lane (P2 FR-ENA-001..003). The
   plan assumes the P2 `serve-functions.sh` + `with-erpnext-lock.sh` recipe carries over verbatim with the
   revenue domain; if the edge-fn JWT issuer needs a per-domain claim, surface it now.

---

**SPEC-DONE. PLAN-DONE.** Plan path: `docs/plans/2026-07-14-erpnext-adapter-p3a-sales-ar.md`. 8 slices
(0–7), 25 functional AC-SAR-### + the AC-SAR-002 meta-gate all mapped to an owning layer + slice; 2
migrations (`0104` tables+flip, `0105` SoD RPC + `get_process_gates`); the R9-P3a spike is the binding
body-map authority (filed `docs/spikes/2026-07-14-erpnext-si-pe-receive-fields.md`). ADR-0058 + C-1 apply
verbatim to PE-receive; the byte-for-byte invariant (AC-SAR-001/002) lands first in slice 2; the served-fn
serial e2e lane (slice 7) proves the money-safety + write-through ACs at the real boundary.

## 6. Director rulings on §5 (2026-07-14)

1. **project_map → resolve-by-name + auto-create-on-miss (NOT a hand-curated map).** A jsonb map means
   every new PMO project needs an Admin edit — and OD-SAR-PMO-IS-THE-UI forbids requiring the Desk, so a
   missing ERP Project cannot be a dead end. Dispatch resolves `project_name == pmo_project.name` (GET
   probe, external_refs-cached per project like the ClickUp per-project binding pattern); on miss it
   CREATES the ERP Project (non-submittable master — same machine-write class as Supplier create;
   idempotent because it searches by name first) and records the ref. `binding.config.project_map`
   stays as an optional OVERRIDE for pre-existing ERP projects with mismatched names.
2. **action-required surface → NO new table.** Reuse the existing surfaces: the project-less inbound SI
   mirrors with `project_id = null`, appears in the revenue view's 'Unassigned' bucket (first-class,
   filterable), and emits an in-app notification to Finance/Admin (the existing notifications path).
   An `operator_tasks` table is YAGNI until a second consumer exists.
3. **EDGE_JWT_ISSUER — carries over verbatim.** The issuer is global, no per-domain claim exists.
   Plan erratum: the lock script is `scripts/with-db-lock.sh` (there is no `with-erpnext-lock.sh`).
