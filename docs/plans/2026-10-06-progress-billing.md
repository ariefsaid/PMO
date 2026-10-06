# Plan: progress assessment, down payment and billing claims (issue #766)

> **Spec:** [`docs/specs/progress-billing.spec.md`](../specs/progress-billing.spec.md) (AC-PB-001..020, DD-PBL-1..11),
> revised 2026-10-06 after the owner's ruling that a PM's progress assessment is not an invoice.
> **ADR:** [ADR-0077](../adr/0077-down-payment-as-advance-item-invoice-lines.md).
> **Executor:** money path (an invoice body, a recovery figure, an SoD author set, an evidence gate, an outbox
> fence) — **Director-dispatched**, per CLAUDE.md executor routing. Slice C (UI) may go to an SSSF ADW with
> `--builder fe_builder --reviewer fe_reviewer` once Slices A and B are on `dev`.
> **Precondition for every slice:** #765 is on `dev` — `supabase/migrations/0245_management_pack.sql`
> (`project_progress_entries`, `record_project_progress`, `may_record_project_progress`, `org_current_month`,
> `get_management_pack`) and `pmo-portal/src/lib/reports/managementPack.ts` (`toCents`, `fromCents`, `pctOf`).
> Check from the worktree root: `ls supabase/migrations/0245_management_pack.sql pmo-portal/src/lib/reports/managementPack.ts`.
> If either is missing, stop and report to the Director.
> **Migration numbers:** this feature is `0250_progress_billing.sql` and `0251_management_pack_billed_work.sql`
> (Director-assigned; 0245 is the management pack, 0246/0247/0249 are other issues, 0248 is reserved). If either
> number is taken when you start, run `scripts/renumber-migration.sh <old> <next>` after creating the file — never
> hand-rename.

## Parts

The plan is split so each file stays readable. Run the tasks in this order.

| Part | File | Tasks |
|---|---|---|
| 1 | this file | design, traceability, Task 0 (ERP spike) |
| 2 | [`2026-10-06-progress-billing.part2-db.md`](2026-10-06-progress-billing.part2-db.md) | A1–A16 — migration 0250 + pgTAP |
| 3 | [`2026-10-06-progress-billing.part3-adapter-data.md`](2026-10-06-progress-billing.part3-adapter-data.md) | B1–B7 adapter · C1–C14 helpers, DAL, repository, hooks, policy, Admin setting |
| 4 | [`2026-10-06-progress-billing.part4-ui.md`](2026-10-06-progress-billing.part4-ui.md) | C15–C29 — dialogs, Billing tab, strings |
| 5 | [`2026-10-06-progress-billing.part5-pack-e2e.md`](2026-10-06-progress-billing.part5-pack-e2e.md) | D1–D3 migration 0251 · E1–E3 ERP journey · pre-enable checklist |

## 1. Design

### Two concepts (DD-PBL-2)

| | Progress assessment | Billing claim |
|---|---|---|
| Who | the project's PM, or Finance rank and above (#765's `may_record_project_progress`) | Admin, Finance |
| What | quantity done to date per BoQ line for a month (or #765's typed % where there is no BoQ) | quantities billed this time, or a down payment |
| Record | #765's `project_progress_entries` row + `progress_assessment_quantities` children | `progress_claims` + `progress_claim_lines` |
| Editable | yes — re-recording the month replaces it | never; withdraw before raising, cancel the invoice after |
| Evidence | none | ≥ 1 Issued/Approved project document with a file, before raising |
| ERP | never | one Sales Invoice per claim (ADR-0077) |

### Architecture

```
pages/project-detail/tabs/BillingTab.tsx
  ├─ useProjectBilling ─ repositories.progressBilling.summary ─ rpc get_project_billing            [INVOKER]
  │     └─ reads view sales_invoice_work_billed (shared with get_management_pack, 0251) + latest assessment
  ├─ ProgressAssessmentModal ─ recordAssessment ─ rpc record_progress_assessment                     [INVOKER, #765 rule]
  │     └─ upserts project_progress_entries (pct derived) + progress_assessment_quantities
  ├─ BoqItemFormModal ─ boq_items (RLS table writes)
  ├─ ProgressClaimModal (pre-fill from latest assessment) ─ rpc create_progress_claim               [DEFINER, Admin/Finance]
  ├─ ClaimEvidenceModal ─ rpc attach_claim_evidence                                                 [DEFINER, Admin/Finance]
  ├─ withdraw ─ rpc withdraw_progress_claim                                                          [DEFINER]
  └─ raise ─ dispatchCreate('revenue', {erp_doc_kind:'sales-invoice'}, {id: claim.id})
               └─ adapter-dispatch ─ resolveProgressClaimInvoice (evidence check, items FROM THE CLAIM)
                    └─ outbox insert ─ trigger: refuses a withdrawn claim or one without evidence
                         └─ ERPNext SI draft ─ mirror row id = claim id (+ work_order_id) ─ creator → author set
```

- **One source of operational progress (DD-PBL-3).** No new progress table: quantities hang off #765's monthly
  entry and drive its `pct_complete` (BoQ-value-weighted, each line capped at its BoQ quantity). The management
  pack reads `pct_complete` unchanged. `record_project_progress` gains one refusal: a month measured by
  quantities does not accept a typed percent.
- **One definition of billed work (DD-PBL-9).** View `sales_invoice_work_billed` (`security_invoker`): per invoice,
  its net of tax, whether it is a down-payment invoice, and the recovery its claim removed. `get_project_billing`
  and `get_management_pack` (0251) both read it. Assessed to date and the gap use the pack's `pctOf`.
- **Claim = invoice record, evidence-gated (DD-PBL-7).** The claim id is the invoice's PMO record id; the outbox's
  existing constraints give one claim at most one invoice. A BEFORE INSERT trigger on `external_command_outbox`
  (claim row `for share`) refuses a withdrawn claim and a claim with no evidence; the outbox insert precedes every
  ERP POST, so neither can mint.

### Data model

| Object | Shape | Writers |
|---|---|---|
| `organizations.down_payment_item` | text, 1–140, nullable | Admin, audited |
| `boq_items` | project_id, work_order_id?, item_code, description, unit, quantity numeric(14,3) > 0, rate numeric(14,2) ≥ 0 | RLS table writes, Admin·Exec·PM·Finance |
| `progress_assessment_quantities` | entry_id → `project_progress_entries`, boq_item_id, quantity_to_date numeric(14,3) ≥ 0; unique (entry, line) | `record_progress_assessment` (invoker; RLS = #765 rule) |
| `progress_claims` / `progress_claim_lines` | kind, currency, gross, DP amount + %, recovery, DP item snapshot, creator, withdraw stamp / BoQ snapshot per line | `create_progress_claim` / `withdraw_progress_claim` only |
| `progress_claim_evidence` | claim_id, document_id → `project_documents` (no action on delete), document_status, document_revision, attached_by | `attach_claim_evidence` only |
| view `sales_invoice_work_billed` | id, org_id, project_id, currency, invoice_date, status, is_down_payment, net, recovery | read-only |
| `get_project_billing(uuid) → jsonb` | currency, contract_net, work_billed, dp_billed, dp_recovered, not_submitted, assessment{month,pct_complete}?, boq[{boq_item_id, claimed_quantity, assessed_quantity}] | read |

### Error handling

| Where | Refusal | Code |
|---|---|---|
| `record_progress_assessment` | not the project's PM / not Finance rank | 42501 (#765's message) |
| | missing input; bad quantity; line outside BoQ; repeated line; BoQ with no value | 23502; 23514 (named) |
| `record_project_progress` | month measured by quantities | P0001 |
| `create_progress_claim` | role, membership / project / scope, amounts / caps / DP rules | 42501 / P0002 / 23514 / 22023 / P0001 |
| `attach_claim_evidence` | role; claim; withdrawn; document scope; status; no file | 42501; P0002; P0001; 23514; P0001; P0001 |
| `withdraw_progress_claim` | withdrawn, raised, attempt in flight / role / not found | P0001 / 42501 / P0002 |
| outbox fence | withdrawn claim; claim without evidence | 55000 |
| dispatch resolver | project/customer mismatch, edit/amend, no evidence, withdrawn | `commit-rejected`, before any ERP call |
| UI | refusals → `classifyMutationError` toast + persistent dialog error; summary null/malformed → error state; no assessment → "No assessment yet" | |

### Scaling and existing-code notes

- Summary: one invoker RPC per project view; claims list capped at 500 per project; claim lines ≤ 500 (dispatch
  reads ≤ 501, below PostgREST `max_rows`). Assessment writes are one RPC per month per project.
- The net-of-tax CASE for billed work is now defined once (the view) and the pack stops carrying its own copy.
- Behaviour-neutral fix: `sales_invoices.work_order_id` is written for claim invoices.
- Known limit (OBS-PB-004): `project_progress_entries.pct_complete` stays directly writable (#765's grant), so a
  direct write can disagree with that month's quantities. Accepted — an assessment moves no money.

### Files

| Path | Change |
|---|---|
| `supabase/migrations/0250_progress_billing.sql` (+ `rollback/0250_progress_billing_down.sql`) | new |
| `supabase/tests/0250_progress_billing_{boq,assessment,claims,evidence,withdraw,summary}.test.sql` | new pgTAP |
| `supabase/tests/0178_anon_executable_definers.test.sql` | +3 allow-list names, 53 → 56 |
| `supabase/tests/0171_sod_class_completeness.test.sql` | §K, plan 97 → 99 |
| `supabase/migrations/0251_management_pack_billed_work.sql` (+ rollback, + `supabase/tests/0251_management_pack_billed_work.test.sql`) | pack reads the view |
| `pmo-portal/src/lib/supabase/database.types.ts` | regenerated |
| `pmo-portal/src/lib/adapterSeam/erpnext/progressClaimItems.ts` (+ test), `progressClaimInvoice.test.ts` | new |
| `pmo-portal/src/lib/adapterSeam/erpnext/dispatchFactory.ts` | resolver, link field, PO fallback |
| `supabase/functions/adapter-dispatch/readModelWriters.ts` (+ `readModelWriters.money.test.ts`) | `work_order_id` |
| `pmo-portal/src/lib/progressBilling.ts` (+ `.test.ts`, `.i18n.test.ts`) | pure helpers |
| `pmo-portal/src/lib/db/progressBilling.ts` (+ test), `src/lib/db/orgs.ts` (+ `orgs.downPaymentItem.test.ts`) | DAL |
| `pmo-portal/src/lib/repositories/{types,index}.ts`, `index.test.ts`, `progressBilling.test.ts` | repository |
| `pmo-portal/src/hooks/useProgressBilling.ts` (+ test) | hooks |
| `pmo-portal/src/auth/policy.ts` (+ `policy.progressBilling.test.ts`) | 2 entities |
| `pmo-portal/pages/admin/OrgDownPaymentItem.tsx` (+ test), `pages/Administration.tsx` | Admin setting |
| `pmo-portal/pages/project-detail/{BoqItemFormModal,ProgressClaimModal,ProgressAssessmentModal,ClaimEvidenceModal}.tsx` (+ tests) | dialogs |
| `pmo-portal/pages/project-detail/tabs/BillingTab.tsx` (+ test), `ProjectDetail.tsx`, `__tests__/ProjectDetail.tabs.test.tsx` | tab |
| `pmo-portal/public/locales/{en,id}/common.json`, `src/lib/i18n/launch-scope-routes.txt` | strings |
| `pmo-portal/e2e/serial/AC-PB-003-progress-billing-erp.spec.ts`, `scripts/check-e2e-skips.mjs` | ERP journey |

### Traceability (one owning test per AC, ADR-0010)

| AC | Owning layer | Canonical proof | Tasks |
|---|---|---|---|
| AC-PB-001 | pgTAP | `supabase/tests/0250_progress_billing_boq.test.sql` | A1, A2 |
| AC-PB-002 | pgTAP | `supabase/tests/0250_progress_billing_claims.test.sql` | A5, A6, A7 |
| AC-PB-003 | Playwright | `pmo-portal/e2e/serial/AC-PB-003-progress-billing-erp.spec.ts` | 0, E1–E3 |
| AC-PB-004 | pgTAP | `supabase/tests/0250_progress_billing_claims.test.sql` | A5, A6, A7, A15 |
| AC-PB-005 | pgTAP | `supabase/tests/0250_progress_billing_withdraw.test.sql` | A10, A11 |
| AC-PB-006 | Vitest | `src/lib/adapterSeam/erpnext/progressClaimInvoice.test.ts` | B1–B4 |
| AC-PB-007 | pgTAP | `supabase/tests/0250_progress_billing_summary.test.sql` | A12, A13 |
| AC-PB-008 | Vitest/RTL | `pages/project-detail/tabs/__tests__/BillingTab.test.tsx` | C3, C4, C9–C12, C23–C25 |
| AC-PB-009 | Vitest/RTL | `pages/project-detail/__tests__/ProgressClaimModal.test.tsx` | C7, C8, C17, C18, C23, C24 |
| AC-PB-010 | pgTAP | `supabase/tests/0251_management_pack_billed_work.test.sql` | D1, D2 |
| AC-PB-011 | pgTAP | `supabase/tests/0250_progress_billing_boq.test.sql` | A1, A2, C5, C6, C13, C14 |
| AC-PB-012 | pgTAP | `supabase/tests/0250_progress_billing_withdraw.test.sql` | A10, A11 |
| AC-PB-013 | Deno | `supabase/functions/adapter-dispatch/readModelWriters.money.test.ts` | B5, B6 |
| AC-PB-014 | Vitest | `src/lib/progressBilling.i18n.test.ts` | C27, C28 |
| AC-PB-015 | Vitest/RTL | `pages/project-detail/__tests__/BoqItemFormModal.test.tsx` | C15, C16 |
| AC-PB-016 | Vitest | `src/lib/progressBilling.test.ts` | C1, C2 |
| AC-PB-017 | pgTAP | `supabase/tests/0250_progress_billing_assessment.test.sql` | A3, A4 |
| AC-PB-018 | pgTAP | `supabase/tests/0250_progress_billing_evidence.test.sql` | A8, A9, A11 |
| AC-PB-019 | Vitest/RTL | `pages/project-detail/__tests__/ProgressAssessmentModal.test.tsx` | C19, C20 |
| AC-PB-020 | Vitest/RTL | `pages/project-detail/__tests__/ClaimEvidenceModal.test.tsx` | C21, C22 |

### Conventions for every task

All paths are relative to the worktree root (off `origin/dev`, created by the Director). DB commands run under
`scripts/with-db-lock.sh`, vitest under `scripts/with-test-lock.sh`. A reset and the tests that follow it run in
ONE lock hold. Every pgTAP denial asserts errcode **and** message (0193's oracle discipline). Mutation checks
marked "do not commit" are mandatory for the money tasks; revert each before moving on.

## 2. Task 0 — ERP spike (Director, gate) · AC-PB-003 prerequisite

Against the local bench only (never a client's ERP). Export `ERPNEXT_BENCH_API_KEY`/`ERPNEXT_BENCH_API_SECRET`
in the shell first (never read env files).

```bash
B=http://localhost:8080
H="Authorization: token $ERPNEXT_BENCH_API_KEY:$ERPNEXT_BENCH_API_SECRET"
J='Content-Type: application/json'
curl -s -X POST "$B/api/resource/Account" -H "$H" -H "$J" \
  -d '{"account_name":"Customer Advances","parent_account":"Current Liabilities - PSC","company":"PMO Smoke Co","is_group":0}' | jq -r '.data.name // .exc_type'
curl -s -X POST "$B/api/resource/Item" -H "$H" -H "$J" \
  -d '{"item_code":"PB-DOWN-PAYMENT","item_name":"Down payment","item_group":"Services","stock_uom":"Nos","is_stock_item":0,"is_sales_item":1,"item_defaults":[{"company":"PMO Smoke Co","income_account":"Customer Advances - PSC"}]}' | jq -r '.data.name // .exc_type'
DP=$(curl -s -X POST "$B/api/resource/Sales%20Invoice" -H "$H" -H "$J" \
  -d '{"customer":"Spike Customer","items":[{"item_code":"PB-DOWN-PAYMENT","qty":1,"rate":200000}]}' | jq -r .data.name)
curl -s -X PUT "$B/api/resource/Sales%20Invoice/$DP" -H "$H" -H "$J" -d '{"docstatus":1}' | jq -r .data.docstatus
CL=$(curl -s -X POST "$B/api/resource/Sales%20Invoice" -H "$H" -H "$J" \
  -d '{"customer":"Spike Customer","items":[{"item_code":"SPIKE-ITEM-1","qty":4,"rate":50000},{"item_code":"PB-DOWN-PAYMENT","qty":1,"rate":-40000}]}' | jq -r .data.name)
curl -s -X PUT "$B/api/resource/Sales%20Invoice/$CL" -H "$H" -H "$J" -d '{"docstatus":1}' | jq -r '.data.docstatus, .data.grand_total'
for V in "$DP" "$CL"; do
  curl -s -G "$B/api/resource/GL%20Entry" -H "$H" \
    --data-urlencode "filters=[[\"voucher_no\",\"=\",\"$V\"],[\"is_cancelled\",\"=\",0]]" \
    --data-urlencode 'fields=["account","debit","credit"]' | jq -c .data
done
```

Expect: both submits print `1`; the claim prints grand total `160000`; the DP's GL has `Customer Advances - PSC`
credit 200000; the claim's GL has `Customer Advances - PSC` debit 40000 and `Debtors - PSC` debit 160000.
**Stop condition:** if ERPNext refuses the negative-rate line or the liability income account, STOP the build and
report to the Director — ADR-0077 must be revisited. Record the result as a comment on #766 (no hostnames, no
credentials).

Next: [part 2 — database](2026-10-06-progress-billing.part2-db.md).
