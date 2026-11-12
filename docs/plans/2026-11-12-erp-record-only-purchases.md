# ERP purchase capture implementation plan — #2195

> **For agentic workers:** Use superpowers:executing-plans and the implementer role contract, one TDD task at a time, through Director-dispatched Orca workers. The owner selected **GPT Terra** for this money-path build; do not dispatch helper agents from a worker.

**Goal:** Bulk-capture existing project purchases at connection or on demand, prove coverage against the ledger, never resend history, and allow only remaining unpaid steps through the ordinary money path.

**Architecture:** Reuse the shipped document linker, supplier resolver, family locks and canonical commitment readers. Add a neutral capture census/proposer and source provenance, then narrow capability increments for assignments, project slices, journals and standalone payments. Preserve the ledger as the amount oracle; new PMO project assignments are an explicit placement overlay with precedence over rule attribution.

**Tech stack:** PostgreSQL security-definer RPCs / pgTAP; Deno server adapter modules and served-handler tests; Node 22 CLI; React 19 / typed repositories only in slice 2.

**Spec:** `docs/specs/erp-record-only-purchases.spec.md` (FR/NFR/AC-ROP), including the latest owner continuation ruling. `docs/specs/erp-connect-anytime.spec.md` and OD-ERP-ANYTIME-1 govern the four connection cases and setup vocabulary.

## Global constraints and shipping order

- **J / B3 first, alone:** journal-created purchases, Admin undo, one interim forward-step guard and CLI dry run. Then **A / bulk slice:** orders and single-project invoices through the **0380** linker, neutral census, bulk CLI and completeness. No frontend changes. A reports every unsupported source kind as named remainder. It may ship independently.
- **D immediately after the A unlock:** continue unpaid captured purchases with one per-step guard, shared with the separate existing `erp_link` continuation correction. Already recorded steps never resend; fully paid and journal-settled history never pushes.
- **B1 → B2 → B3 → B4:** each its own reviewed change: unassigned invoices in bulk; split invoices; journal-created purchases; payments without invoice. **C:** source lines/descriptions and additional historical states, separately reviewed alongside B. **Slice 2:** setup-pass offer and screen actions/markers after their respective server capabilities.
- Every money increment ships **alone**, with spec, code-quality and security review. No acceptance of the full goal until all applicable ACs and the completeness report pass. Dev is the ceiling unless the owner gives a newer explicit release instruction; the hotfix exception changes check selection, not promotion permission.
- Capture and preview produce **no ERP write and no outbox/intent**. D sends only new later steps through existing money dispatch, gates and SoD. A uses one interim forward-step refusal guard; description/title/notes/files stay editable.
- Never zero every captured commitment. Reuse `procurement_open_commitments` (0723), `procurement_open_commitment` (0560), `project_committed_spend` (0651), `procurement_ledger_held[_many]` (0687), and `erp_linked_documents_total` (0386). An open order commits once until invoiced; repeating capture changes neither actuals nor commitment.
- No ERP-shaped command inputs, kind switches or project fields in the new CLI or server rules. Existing doctype translation is confined to the adapter bridge; ordinary legacy RPC behavior remains compatible.
- No new dependencies or lockfile regeneration. No live data, client names, people or organization identifiers in tracked artifacts. Use synthetic fixtures only.
- **Current lane:** no heavy jobs before 19:30 on 2026-11-12; after that ask the coordinator once and wait for approval of the batch. All heavy jobs take the single-slot test lock; DB jobs take DB then test locks. Never reset the shared DB in this lane. CI owns full suites. Browser starts require load average below 30 and port 52xx.

## Migration allocation and rollback

Checked the worktree migration listing, `origin/dev` at `7556b969c3fafc6fba30be56c19f4bb85ec38e8d`, and `git ls-remote --heads origin` on 2026-11-12: numbered local migrations end at 0856; no remote branch name advertises the allocations below. This is a **planning allocation**, not a claim that unpushed sibling work has no reservation. The Director and active builder must reconcile their current allocation before writing SQL; keep their valid work and use `scripts/renumber-migration.sh` for collisions.

| Increment | Forward migration | Reverse migration |
|---|---|---|
| A | `supabase/migrations/0861_erp_purchase_capture.sql` | `supabase/migrations/rollback/0861_erp_purchase_capture_down.sql` |
| D | `supabase/migrations/0862_captured_purchase_continuation.sql` | `supabase/migrations/rollback/0862_captured_purchase_continuation_down.sql` |
| B1 | `supabase/migrations/0863_capture_invoice_project_assignment.sql` | `supabase/migrations/rollback/0863_capture_invoice_project_assignment_down.sql` |
| B2 | `supabase/migrations/0864_capture_project_source_slices.sql` | `supabase/migrations/rollback/0864_capture_project_source_slices_down.sql` |
| J / B3 (first) | `supabase/migrations/0860_capture_journal_purchases.sql` | `supabase/migrations/rollback/0860_capture_journal_purchases_down.sql` |
| B4 | `supabase/migrations/0865_capture_standalone_payments.sql` | `supabase/migrations/rollback/0865_capture_standalone_payments_down.sql` |
| C | `supabase/migrations/0866_capture_source_line_evidence.sql` | `supabase/migrations/rollback/0866_capture_source_line_evidence_down.sql` |

Reverse in reverse order. Restore previous function bodies/grants from the deciding head migrations, not from an older plan. Reject a destructive reverse while active captured records exist: first run Admin undo on eligible records, and reverse later PMO-authored steps through their ordinary controls. Preserve cancelled wrappers and audit history; remove only capture-specific indexes/functions/schema after references are inactive. A rollback must never turn surviving historical wrappers into pushable ordinary purchases: retain their provenance and the interim guard until the last such record is retired. Verify forward → reverse → forward on a disposable CI database, never by resetting the shared stack.

## Read before implementation

Read 0380 `link_erp_purchase_documents`; 0386 document-value readers; 0372 family locks; 0687 journal links; 0765 journal derivation; 0471 attribution engine; 0497 mapped actuals; 0720/0794 attribution fast paths; 0723 commitment batching; current `api_client_request_guard` in 0702. `pg_get_functiondef` on the test database after migrations decides the actual runtime body.

A reuses `scripts/lib/pmo-purchases.mjs:159` (`runLink`), which already validates/batches supplied link rows. It adds source discovery and complete reporting. The scoped linker/feed paths do not copy full item descriptions: C is real work. Retain ordinary 0380 `document_spans_projects`, `document_has_no_project`, supplier/family and SoD checks; B adds explicit new contracts.

## File responsibilities and stable interfaces

S1/A changes only `supabase/**`, `scripts/**` and docs. Extend the **server side of the shared adapter seam** under `supabase/functions/_shared/purchaseCapture/`; it uses the existing binding resolver and ERP clients from `pmo-portal/src/lib/adapterSeam/` by import, without changing app code for the no-frontend unlock. It must not introduce another credential store, master matcher or ERP transport. Slice 2 may later expose/re-export these neutral types through the existing app repository seam.

| Path | Responsibility |
|---|---|
| `supabase/functions/_shared/purchaseCapture/contract.ts` | PMO-shaped source/page/proposal/report types |
| `supabase/functions/_shared/purchaseCapture/erpnext.ts` | Read-only bridge to existing ERPNext feeds/client and legacy document links |
| `supabase/functions/_shared/purchaseCapture/odoo.ts` | Same contract; explicit unsupported capability until source/line facts are supplied |
| `supabase/functions/_shared/purchaseCapture/adapter.ts` | Select by existing binding; never fall back to another tier |
| `supabase/functions/_shared/purchaseCapture/propose.ts` | Strong identity/family grouping and clear/review outcomes |
| `supabase/functions/_shared/purchaseCapture/report.ts` | Signed ledger reconciliation, named remainder and read-generation checks |
| `supabase/functions/purchase-capture/index.ts` | Caller-JWT Admin entry; bounded read/preview/apply/report; imports shared modules |
| `scripts/lib/pmo-capture.mjs` | Neutral command parsing, pagination/resume, preview/apply and stable identities |
| `scripts/pmo-capture.test.mjs` | AC-ROP-012 command behavior, no live account dependency |
| `scripts/pmo.mjs` | Route capture/report/assign/undo; preserve existing purchase commands |
| `supabase/tests/0861_erp_purchase_capture.test.sql` | A canonical ACs and scoped regression proofs |
| `supabase/functions/purchase-capture/index.test.ts` | Import shipped handler; mock fetch at network boundary |
| `supabase/functions/_shared/purchaseCapture/contract.test.ts` | Shared ERP-neutral source/capability suite, AC-ROP-021 |
| `supabase/functions/_shared/purchaseCapture/report.test.ts` | AC-ROP-018 arithmetic/coverage/read completeness |

```ts
// contract.ts — decimals remain strings until existing display/format boundaries.
export type CaptureKind = 'order' | 'receipt' | 'supplier_invoice' | 'supplier_payment' | 'journal' | 'adjustment';
export type CaptureState = 'draft' | 'ordered' | 'received' | 'invoiced' | 'part_paid' | 'paid' | 'cancelled';
export interface CaptureScope { projectId: string | null }
export interface CaptureLine {
  id: string; projectId: string | null; description: string;
  account: string | null; documentAmount: string | null; ledgerAmount: string | null;
}
export interface CaptureSource {
  id: string; version: string; kind: CaptureKind; state: CaptureState;
  familyId: string | null; supplierId: string | null; reference: string | null; date: string | null;
  currency: string; amount: string; ledgerCurrency: string; lines: CaptureLine[];
  existingPurchaseIds: string[];
}
export type CaptureCapability = { supported: true } | { supported: false; missing: string[] };
export interface CapturePage { sources: CaptureSource[]; cursor: string | null; revision: string; complete: boolean }
export interface PurchaseCaptureAdapter {
  capability(): CaptureCapability;
  listCostDocuments(scope: CaptureScope, cursor: string | null): Promise<CapturePage>;
}
export interface CaptureProposal {
  key: string; sourceIds: string[]; sourceVersions: string[]; projectId: string | null;
  outcome: 'create' | 'skip' | 'review'; reason: string | null; existingPurchaseId: string | null;
}
export interface CaptureReport {
  projectId: string; currency: string; revision: string; complete: boolean;
  ledgerCost: string; representedCost: string; remainderCost: string; pmoAssignmentBridge: string;
  remainder: Array<{ sourceId: string; lineId: string; kind: CaptureKind; amount: string; reason: string }>;
}
```

RPCs are `capture_existing_purchases(p_groups jsonb,p_dry_run boolean default false) returns jsonb`, `undo_captured_purchase(p_procurement_id uuid,p_reason text,p_dry_run boolean default false) returns jsonb`, and in B1 `assign_capture_invoices(p_rows jsonb,p_dry_run boolean default false) returns jsonb`. Organization is always derived from auth. Groups carry `request_id`, `source_ids`, `source_versions`, `project_id`; source facts are re-read from trusted staging, never accepted as client money. Each result is `{request_id,outcome,reason,procurement_id,would_create,assignment_origin,actuals_delta,erp_write:false}`; keep D's transactional command result separate.

The edge entry accepts `{action:'preview'|'apply'|'report'|'assign'|'undo',scope:{projectId:null|string},requestId,expectedRevision?,groups?,rows?,procurementId?,reason?}`. `preview` stages no durable data: return normalized proposals and revision; apply reads again, validates revision, then stages trusted source facts and calls the RPC. Stream/keyset pages; do not treat a bounded page cap as an empty completed census. CLI apply takes the printed `--revision` and `--request` values. Unknown outcomes reuse the request; a new request can discover new sources but uniqueness still prevents duplicate purchases.

## SQL sketches to implement in J foundation / A extension

The following is real schema/query shape; all rows are trusted adapter facts. J creates the provenance table, A adds the source census table. Add the named organization-consistency triggers and grants in the same migrations. The owner/purchase FK is preserved on undo; provenance never disappears just because links are removed.

```sql
create table public.erp_purchase_captures (
  procurement_id uuid primary key references public.procurements(id) on delete restrict,
  org_id uuid not null references public.organizations(id),
  binding_id uuid not null references public.external_org_bindings(id),
  request_id uuid not null,
  payload jsonb not null,
  kind text not null check (kind in ('order','receipt','supplier_invoice','supplier_payment','journal','adjustment')),
  stage text not null check (stage in ('draft','ordered','received','invoiced','part_paid','paid','cancelled')),
  captured_by uuid not null references public.profiles(id),
  captured_at timestamptz not null default now(),
  undone_at timestamptz,
  undo_reason text,
  unique (org_id, request_id)
);
create index erp_purchase_captures_org_binding_idx
  on public.erp_purchase_captures(org_id,binding_id);
alter table public.erp_purchase_captures enable row level security;
alter table public.erp_purchase_captures force row level security;
create policy erp_purchase_captures_select on public.erp_purchase_captures
  for select to authenticated using (
    org_id = (select public.auth_org_id()) and (select public.is_active_member())
    and (select public.auth_role()) in ('Admin','Finance','Executive','Project Manager')
  );
revoke all on public.erp_purchase_captures from anon, authenticated;
grant select on public.erp_purchase_captures to authenticated;

create table public.erp_capture_sources (
  org_id uuid not null references public.organizations(id),
  binding_id uuid not null references public.external_org_bindings(id),
  source_id text not null,
  version text not null,
  kind text not null,
  state text not null,
  normalized jsonb not null,
  read_at timestamptz not null default now(),
  primary key (org_id,binding_id,source_id)
);
alter table public.erp_capture_sources enable row level security;
alter table public.erp_capture_sources force row level security;
revoke all on public.erp_capture_sources from anon, authenticated;
-- Sources are server-only staging; RPC/edge readers return audience-filtered normalized facts.

-- At the start of capture_existing_purchases and undo_captured_purchase:
-- perform public.assert_is_active_member();
-- if public.auth_role()::text is distinct from 'Admin' then
--   raise exception 'Only an Admin can capture or undo purchase history.' using errcode='42501';
-- end if;

-- A7 interim rule, later replaced by D1's per-step decision:
create function public.captured_purchase_step_refusal(p_procurement_id uuid,p_step text)
returns text language sql stable security definer set search_path=public,pg_catalog as $$
  select case when exists (
    select 1 from public.erp_purchase_captures c
    where c.procurement_id=p_procurement_id
      and c.org_id=public.auth_org_id() and c.undone_at is null
  ) then 'capture_forward_step_blocked' end
$$;
revoke all on function public.captured_purchase_step_refusal(uuid,text) from public,anon;
grant execute on function public.captured_purchase_step_refusal(uuid,text) to authenticated,service_role;
```

Service-driven call sites must resolve and pass the same org through their existing authenticated/recorded actor context; an absent user context must not turn this guard into permission. The service outbox insertion guard separately reads provenance by the outbox row's org and resolved purchase. Preserve the ordinary call's not-found/active-member checks before this helper; the helper is one step decision, not a replacement for authorization.

B1's eligible amount is a ledger sum with an inner account-map join, never invoice face value:

```sql
select m.category, sum(g.debit-g.credit) as amount
from public.erp_gl_entry_mirror g
join public.budget_category_account_map m
  on m.org_id=g.org_id and m.erp_account=g.account
where g.org_id=public.auth_org_id() and not g.is_cancelled
  and g.id=any(p_gl_ids)
group by m.category;
```

Here `p_gl_ids uuid[]` is read from trusted source-to-GL lineage inside the definer, never client-sent. If that inner join produces no eligible mapped lines for an invoice, assignment returns `invoice_has_no_mapped_cost`; mixed invoices show the other lines as excluded. Credit/negative journal groups are refused independently and never netted into positive journal wrapper amounts. No new asset recognition rule is part of this SQL (#2196).

## Review focus

1. One invoice allocated to two projects: source-line ownership must not weaken ordinary whole-document uniqueness (B2).
2. An ERP tag/cancellation arrives between mirror and snapshot refresh: show refreshing/unknown until coherent; never a transient credible duplicate (B1).
3. Order plus invoices plus payments: different document face values are evidence of one family, not three expenses (A).
4. More than one page or a permission-denied source kind: report incomplete, never falsely claim all captured (A).
5. A captured unpaid invoice reaches payment: existing invoice is referenced, earlier order/invoice steps never resend, and author/approver/payer SoD stays intact (D).

## Exact verification commands used by the tasks

Run from repo root unless a command explicitly enters `pmo-portal`. These are **future builder commands**, not evidence that this docs worker ran tests. Run each task's targeted command once red and once green; do not run a full suite between microtasks.

```bash
# A database ACs
scripts/with-db-lock.sh env PMO_TEST_LOCK_SLOTS=1 scripts/with-test-lock.sh supabase test db supabase/tests/0861_erp_purchase_capture.test.sql
# A neutral contract / report / served entry
scripts/with-db-lock.sh env PMO_TEST_LOCK_SLOTS=1 scripts/with-test-lock.sh deno test --allow-env --allow-read --allow-net supabase/functions/_shared/purchaseCapture/contract.test.ts supabase/functions/_shared/purchaseCapture/report.test.ts supabase/functions/purchase-capture/index.test.ts
# CLI: node:test, scoped
node --test scripts/pmo-capture.test.mjs
```

Apply migrations only through the coordinator-approved local migration path under the DB lock; never `db reset` here. If the shared database is not at this migration's parent, report the schema mismatch and use the disposable CI database for the red/green migration proof. The returned TAP body, not a piped exit code, decides pgTAP pass/fail.

## Journal-first execution checkpoint (J / B3)

Before A, ship the journal unlock alone: execute the journal portions of A1 (neutral source ids), A4 (Admin/tenancy), A7 (single interim guard), A9 (preview/retry), A11 (journal CLI), A12 (undo), then B3.1–B3.2. Their **journal foundation** SQL belongs in `0860_capture_journal_purchases.sql`; A's added bulk discovery/order/invoice SQL belongs in 0861. The first CLI exposes journal record/preview/undo, not a false claim that org-wide capture is complete. A later adds org/project census and report. Avoid two core schemas: A expands J's provenance and guard.

The journal CLI accepts a required non-blank title and optional reference; never require an invented order number. Preview of a negative or refund line returns `negative_journal_not_capturable`, leaves it in named remainder and does not net it with positive lines. Add these assertions to the journal pgTAP file before release.

## A — existing source kinds, bulk proposer and completeness (after journal unlock)

Each numbered task is a 2–5 minute TDD iteration; repeat only its named check and commit the completed increment after its related tasks pass. SQL changes in A accumulate in 0861 and its reverse. Use existing fixture patterns from `supabase/tests/0687_erp_journal_cost_lines.test.sql`; create synthetic org/project/vendor/binding/source records in a rolled-back transaction, never copy production data.

### A1 (3 min): neutral contract and explicit adapter capability — AC-ROP-021

- [ ] Red: `contract.test.ts` runs one suite against ERPNext and Odoo implementations; asserts neutral kind/state/opaque ids, zero ERP write calls, and Odoo `{supported:false,missing:['purchase-history-source-lines']}` until implemented.
- [ ] Green: create the four contract/adapter modules named above. ERPNext reuses existing ERP client/binding context; Odoo's stub must throw a typed `capture_unsupported` result, not return an empty page. Reject unknown tiers. Verify with the targeted Deno command.

### A2 (4 min): enumerate sources across pages — AC-ROP-017/018

- [ ] Red: handler test mocks two source pages, then a failed third page; assert all successful source identities retained and `complete:false` on failure. A page with the same cursor twice must fail `source_cursor_stalled`.
- [ ] Green: implement `listCostDocuments` and the bounded edge loop with opaque cursor/revision. In `erpnext.ts`, translate existing mirrored order/invoice identities and inspect other kinds for named remainder; fetch draft/item detail through read-only existing transport when header mirrors lack it. No epoch-date exclusion. Run the Deno command.

### A3 (4 min): propose existing matches and source families — AC-ROP-017

- [ ] Red: in `contract.test.ts`, assert a known order and its billed invoice propose one group for the same supplier/project/currency; an existing strong external match proposes skip; two conflicting existing purchases propose review, never a name-based merge.
- [ ] Green: `proposeCapture(sources:CaptureSource[]):CaptureProposal[]` in `propose.ts`, sorting source ids and grouping only trusted family references. Do not add amount/name fuzzy matching. Keep >500 sources split at group boundaries. Run Deno contract tests.

### A4 (4 min): provenance and Admin/tenancy enforcement — AC-ROP-005/006

- [ ] Red: 0861 pgTAP calls preview/apply/undo as every role, inactive and anonymous; cross-org source/project/vendor inputs return not-found with no row leakage.
- [ ] Green: create capture provenance/staging schema with `org_id`, binding id, opaque source id, revision and unique `(org_id,binding_id,source_id)`; authenticated has scoped SELECT only, no direct writes. `capture_existing_purchases` and undo require `assert_is_active_member()` plus exact Admin role, pin search path, derive org/actor and check FK organization consistency. Update 0702 guard's current body with exact new Admin-only RPC allowlist. Run pgTAP.

### A5 (5 min): mark historical wrappers through the existing linker — AC-ROP-002/007/017

- [ ] Red: pgTAP creates a tagged order/invoice group through the new RPC; asserts one `origin='erp_link'` wrapper, known supplier/project, existing links, correct derived stage, same tagged actuals, no PMO invoice/order/payment copies, preserved ordinary-link refusals.
- [ ] Green: reuse the **0380** linker body; add an explicit server-validated captured mode for groups created by the Admin capture RPC, leaving the ordinary default path unchanged. Historical capture bypasses request-chain prerequisites only for existing evidence; it does not fabricate approval or pay actors. New wrapper provenance is set in the same transaction. Reuse supplier/family/0386 total helpers. Run pgTAP.

### A6 (4 min): prove canonical commitment rather than recompute it — AC-ROP-002/017

- [ ] Red: pgTAP reads both `procurement_open_commitments(array[purchase])` and `project_committed_spend(project)`: an open order contributes its net value once, a fully ledger-held invoice leaves no open portion, an identical capture rerun changes neither figure. Include partial invoice and cancellation cases.
- [ ] Green: route capture reads through existing canonical SQL only; do not add a captured-record exemption. Recompute wrapper totals through 0386 on source changes using existing refresh logic. Run pgTAP.

### A7 (4 min): one interim step guard — AC-ROP-004

- [ ] Red: pgTAP tries transition, transactional child insertion, outbox insertion and claim for captured sources; assert `capture_forward_step_blocked`, zero outbox/intent rows and allowed title/description edits. Existing ordinary-link SoD failures must remain failures.
- [ ] Green: define `captured_purchase_step_refusal(p_procurement_id uuid,p_step text) returns text`; in A it returns refusal for every forward step. Call it from lifecycle/child-write guards, `procurement_gate_violation`, `procurement_create_refusal`, and outbox insertion/claim before any write. Resolve parent purchase from existing records for commands targeting children. Guard every operation, not only create. Run pgTAP; mutate this guard to return null and confirm the owning refusal assertion goes red, then restore.

### A8 (4 min): served boundary refuses before dispatch — AC-ROP-004 support

- [ ] Red: `supabase/functions/purchase-capture/index.test.ts` imports `./index.ts`; mock global fetch, assert non-Admin rejection, no outgoing ERP mutation, and no outbox request on capture. Add the captured refusal case to `supabase/functions/adapter-dispatch/procurementGateGuard.test.ts`, retaining served-handler binding for any new served test.
- [ ] Green: wire the shared RPC guard before adapter dispatch/outbox. Use existing caller-JWT and binding resolvers; service access is only for trusted source staging after caller authorization. Run targeted Deno tests and `node scripts/check-edge-fn-test-binding.mjs`.

### A9 (4 min): replay and preview leave no residue — AC-ROP-008

- [ ] Red: pgTAP snapshots capture/procurement/link/audit/outbox rows and numbering state, previews, and compares all unchanged; apply then retry returns the same purchase; changed payload for the same identity is refused. Duplicate sources inside/across groups never create partial wrappers.
- [ ] Green: reuse the existing dry-run subtransaction rollback pattern, group-level rollback and source/family locks. Persist request/payload equality on apply, unique source ownership and one audit-create. Do not allocate an identity afresh for retry. Run pgTAP.

### A10 (5 min): signed reconciliation report — AC-ROP-018

- [ ] Red: `report.test.ts` asserts exact decimal equality `ledgerCost = representedCost + remainderCost` for order+invoice+payment, a negative correction, PMO-posted source, unmapped project/account, missing vendor, negative/refund journal refused without netting, unsupported kind and a failed page. No double addition of document face values.
- [ ] Green: `buildCaptureReport(sources:CaptureSource[],ledgerRows:CaptureLine[],revision:string,complete:boolean):CaptureReport[]` in `report.ts`. Join each eligible GL line to exactly one purchase/source slice; matched ordinary PMO purchases count as represented. Preserve named signed remainder. Use integer minor-unit arithmetic consistent with existing currency scale; refuse unsupported scale instead of rounding a false equality. Separate PMO-only assignment bridge. Run Deno report tests.

### A11 (5 min): org/project CLI capture and report — AC-ROP-012

- [ ] Red: `scripts/pmo-capture.test.mjs` asserts `--all` and `--project` exclusivity; `--dry-run` prints proposal/revision/request, `--apply` requires that revision/request, pagination preserves identity, refusals exit 2 and transport errors print safe retry guidance. Report every unsupported B/C kind.
- [ ] Green: implement `runCapture(api,{scope,dryRun,requestId,expectedRevision})` and `runCaptureReport(api,{scope})` in `scripts/lib/pmo-capture.mjs`; route `purchases capture` and `capture-report` in `scripts/pmo.mjs`. New CLI fields use neutral source ids; legacy calls live inside the server adapter bridge. Run `node --test scripts/pmo-capture.test.mjs`.

### A12 (4 min): undo and rollback contract — AC-ROP-009/015

- [ ] Red: pgTAP asserts Admin undo removes capture source links, cancels wrapper, keeps audit, restores set-aside, leaves tagged actuals alone and removes any prior open commitment; repeated undo is skip. Later transactional PMO steps cause `has_later_pmo_steps` refusal.
- [ ] Green: implement `undo_captured_purchase` as one locked transaction, with a required trimmed reason, no hard-delete and previous placement/mark audit. Add CLI `undo-record-only --dry-run` through the same RPC. Reverse migration restores prior functions/grants and preserves guard/provenance for surviving historical records. Run pgTAP and CLI tests.

## D — immediately after unlock: continue only the remaining steps

### D1 (4 min): stage comparison and SoD — AC-ROP-024

- [ ] Red: `supabase/tests/0862_captured_purchase_continuation.test.sql` asserts unpaid captured invoice permits only a genuinely new payment after ordinary authorization/SoD, linked order/invoice steps refuse replay, journal/fully paid history refuses every later transaction. Existing `erp_link` path must produce identical guard decisions.
- [ ] Green: 0862 replaces **only** `captured_purchase_step_refusal` with evidence-based stage checks, then delegates remaining rules to the existing gates. No duplicate stage rank map in CLI/FE. Source state and linked document identity decide historical steps, not a user payload or mutable title. Run the exact scoped pgTAP command with this file replacing the A filename.

### D2 (5 min): reference the existing bill, never recreate it — AC-ROP-024 support

- [ ] Red: add to `supabase/functions/adapter-dispatch/vendorPaymentGateServed.test.ts` a real-handler imported fixture: later payment targets the existing ERP invoice id; order/invoice POST count is zero; wrong payer/approver is refused; unknown-outcome retry uses the same ordinary outbox identity.
- [ ] Green: reuse external references and existing adapter payment dispatch to resolve the bill from captured source links; wire the separate existing `erp_link` continuation fix to the same shared guard. No second money transport/recovery loop. Run the targeted Deno file under DB/test locks; mutation-flip the historical-step decision and verify red, then restore. D reverse restores A's interim refusal, never permits historical resend.

## B — new source kinds, one reviewed change each

### B1.1 (5 min): explicit PMO invoice assignments — AC-ROP-003/006/015

- [ ] Red: `supabase/tests/0863_capture_invoice_project_assignment.test.sql`: genuinely unprojected invoice assigned once; unrelated org/unmapped ERP project refused; bulk overhead decisions write no assignment; marked invoice requires explicit acceptance and undo restores mark.
- [ ] Green: 0863 creates `erp_capture_invoice_assignments` keyed by org/binding/source, owning purchase/project, actor/time and active/undone history. RLS scoped money-role SELECT, RPC-only writes; `assign_capture_invoices` allows only active Admin. Project/overhead decision is per normalized source id; no ERP doctype constants and no direct mirror project edits. Existing mark RPC is reused for overhead. Run scoped pgTAP.

### B1.2 (5 min): one GL placement engine — AC-ROP-003/010

- [ ] Red: same pgTAP file proves rule-attributed and equipment-pooled invoice GL lines move to the explicit project once, foreign document currency uses company-currency GL, unmapped/unknown expense coverage remains explicit, an all-unmapped/capitalised invoice is refused and remains named non-cost remainder, mixed invoices count mapped lines only, and existing mapped amortisation journals count once, and single/all-project actuals agree.
- [ ] Green: add private `capture_assigned_gl(p_org_id uuid,p_project_id uuid default null)` returning current eligible GL identities/project/account/year/net/as_of. Join trusted normalized source-to-GL lineage; require truly empty ERP project and active invoice assignment, never match invoice names across tiers. Exclude these GL ids at the **0471 `cost_attribution_engine` ledger CTE**, then union the explicit allocation into shared attribution aggregation. Extend 0720/0794 fast-path predicates to include active assignments even with no rules/equipment. Invoice contribution uses only mapped expense accounts; refuse assignment with `invoice_has_no_mapped_cost` when every invoice line is outside the map, preserve it as capitalised/non-cost remainder, count only mapped lines for mixed invoices and label excluded lines in preview/read metadata (AC-ROP-025). Keep 0497 output signatures; include explicit placements in existing attributed totals and expose their origin separately in source drilldown. Run scoped pgTAP.

### B1.3 (5 min): synchronize placement and undo — AC-ROP-009/011

- [ ] Red: same file changes source project/cancellation/version between GL mirror refresh and snapshot refresh; reads return refreshing/unknown until coherent, then tagged cost wins once. Undo restores pre-existing rule placement and leaves ERP rows untouched.
- [ ] Green: persist assignment evidence revision; compare source/GL `as_of` with the latest tagged snapshot generation in both single/all-project aggregate entry points. If source changed and the tagged snapshot is behind, return unknown with existing freshness metadata, never add live untagged and stale tagged cost. Once coherent use ERP tag > active assignment > rule/equipment. Do not refresh ERP books or invent an FX rate. Run scoped pgTAP.

### B1.4 (4 min): bulk assignment CLI — AC-ROP-012/015

- [ ] Red: CLI test supplies several rows with `{source_id,decision:'project',project_id}` or `{source_id,decision:'set_aside'}`; rejects both/neither, reports deltas by affected project and stable refusal reasons.
- [ ] Green: `runCaptureAssignments(api,rows,{dryRun})` in `pmo-capture.mjs`, route `purchases assign`, preserve bounded groups and no direct table writes. Add exact commands/output to `docs/runbooks/pmo-cli.md` §6. Run node:test.

### B2.1 (5 min): per-project source slices — AC-ROP-019

- [ ] Red: `supabase/tests/0864_capture_project_source_slices.test.sql` proves a two-project invoice creates two wrappers with exact source line shares, no duplicate GL component, no whole-document double link, same-org enforcement and undo of one slice not disturbing the other.
- [ ] Green: 0864 adds `erp_capture_source_slices(org_id,binding_id,source_id,line_id,project_id,procurement_id)` with unique `(org_id,binding_id,source_id,line_id,project_id)`. Enforce one owner per source-project share and block overlap with existing whole-document `procurement_erp_links`. Do **not** simply drop its unique document constraint; ordinary linker rejects a document with live slices. Use adapter-proved project line shares, including precise signed ledger allocation; ambiguous residual shares remain named remainder. Run scoped pgTAP.

### B2.2 (4 min): shared totals and partial source undo — AC-ROP-019/010

- [ ] Red: same file checks 0723/0651 canonical commitment readers against slice net values, invoice-held amounts and cancelled sources; source shares sum to invoice basis without duplicating invoice face amount.
- [ ] Green: feed sliced value/held terms into 0386 and 0687 canonical readers with source identity exclusions. Keep source-family locks in sorted order; per-project capture is idempotent. Extend completeness joins to GL slice identity. Run scoped pgTAP; reverse refuses while active slices remain.

### B3.1 (5 min): journal-created wrapper — AC-ROP-001/007

- [ ] Red: `supabase/tests/0860_capture_journal_purchases.test.sql` uses multiple same-project/vendor journal lines, expects one wrapper with required title, optional reference and sum, source rows naming its purchase; conflicting known vendors, cross-org, zero/negative/refund/cancelled/PMO-posted lines refuse as a whole group; negative/refund lines remain separately named remainder and never reduce a positive purchase amount.
- [ ] Green: 0860 creates wrapper then calls existing `attach_erp_journal_lines` with adapter-translated stable keys in one transaction; no second journal mirror. Unknown party requires an explicit same-org vendor confirmation in the proposal. Store journal-settled provenance, no fake Payment Entry or approval. Run scoped pgTAP.

### B3.2 (4 min): journal refresh and undo — AC-ROP-009/011

- [ ] Red: same file asserts actuals unchanged on apply/undo, cancelled/reposted journal changes current held/total consistently without a spurious open commitment, possibly-reversed warning remains and ordinary detach cannot leave half a captured group.
- [ ] Green: refresh journal wrapper total from its current linked lines, reuse 0687 held terms and 0765 exclusions, route record-only detach through complete Admin undo. Preserve opaque adapter identity even if ERP repost replaces individual GL row ids. Run scoped pgTAP.

### B4.1 (5 min): payments without invoice — AC-ROP-020

- [ ] Red: `supabase/tests/0865_capture_standalone_payments.test.sql` distinguishes supplier advance (no expense GL) from direct expense payment, captures existing paid evidence without creating expense, and proves later invoice matching cannot claim the same component twice.
- [ ] Green: 0865 routes normalized payment sources through existing document-link evidence where available, marks payment-only/advance provenance, and joins only eligible expense GL lines to the report. Keep amount/currency and payment-to-invoice lineage from adapter facts. No inferred cost from payable/bank movement. Run scoped pgTAP.

## C — actual purchase content and every historical state

### C1 (5 min): normalized source lines — AC-ROP-023

- [ ] Red: Deno contract suite checks source descriptions/items, dates, supplier/reference, original currency, draft/cancelled/return state, signed correction identity and read-only transport. Missing data yields named capability/remainder rather than synthetic items.
- [ ] Green: extend ERPNext read-only bridge to fetch full line evidence using existing transport; 0866 stores trusted `erp_capture_source_lines` with source/version/line identity and preserves signed facts. Join through source ownership to purchases, not transactional PMO child writers. Existing purchase detail read contracts gain captured items through a separate evidence list in slice 2. Implement Odoo or keep its specific tested capability result. Run targeted Deno suite.

### C2 (4 min): all states stay historical — AC-ROP-023/018

- [ ] Red: source-state test checks draft contributes zero posted cost, cancelled source stays inspectable, credit/return nets against original recognized cost, and mixed pages keep exact signed reconciliation.
- [ ] Green: use the normalized kind/state matrix from spec §0; do not apply live ordinary-link semantics to a cancelled/draft historical row. Store source stage in provenance while existing transactional status remains compatible with lifecycle guards. Render truthful capture stage in slice 2. Run Deno and the scoped `supabase/tests/0866_capture_source_line_evidence.test.sql` proof of source-line tenancy and unique ownership.

## Slice 2 — setup and on-demand screens

Read DESIGN.md, `docs/ux/screen-rules.md` and `docs/e2e-parallel-conventions.md` first. No new common-namespace translation keys. S2 files are the existing `pmo-portal/pages/ErpPurchases.tsx`, `pages/project-detail/ErpJournalLinesSection.tsx`, `pages/project-detail/ErpPurchasesSection.tsx`, `pages/ProcurementDetails.tsx`, `src/hooks/useErpJournalLines.ts`, `src/hooks/useErpPurchaseLinks.ts`, and a new typed `src/lib/repositories/erpCapture.ts` / `contracts/erpCapture.ts` registered in repository index. Create `components/ErpPurchaseCaptureDialog.tsx` and feature namespaces `public/locales/en/erpCapture.json` / `id/erpCapture.json`.

### U1 (4 min): typed capture repository and states — AC-ROP-016

- [ ] Red: `src/lib/repositories/erpCapture.test.ts` asserts neutral endpoint payload, AppError mapping and all-project/project scope; `components/ErpPurchaseCaptureDialog.test.tsx` covers loading, empty, error, review/refusal and non-Admin keyboard states.
- [ ] Green: repository `preview(scope)`, `apply(scope,revision,requestId)`, `report(scope)`, `assign(rows,dryRun)` and `undo(id,reason,dryRun)` wrap the server entry. Use existing form/confirm primitives and real-role `can()` actions. Regenerate database types only now if S2 needs new SQL types; no direct DAL writes from components. Run touched Vitest files under the single-slot lock with `--maxWorkers=2`.

### U2 (5 min): journal/invoice capture actions and markers — AC-ROP-013/014/016

- [ ] Red: `pages/project-detail/ErpJournalLinesSection.test.tsx` and `pages/ErpPurchases.test.tsx` assert bulk selection/accept-all, same-vendor conflict, PMO assignment warning, source purchase link, marker on purchase and cost line, undo focus and refresh.
- [ ] Green: wire existing sections to the new dialog and repository; invoice list supports bulk project assignment/set aside, journal list supplies eligible source ids. Capture invalidates procurement, journal/orphan, actuals and dashboard query keys through existing hook invalidation patterns. Description/title/notes/files remain editable; stage actions call shared server decisions. Run touched RTL files.

### U3 (5 min): setup offer and four scenarios — AC-ROP-022

- [ ] Red: `pmo-portal/e2e/AC-ROP-022-connect-capture.spec.ts` is self-isolated and covers S-A/S-D propose all/accept all/unclear rows, S-B no ERP action, S-C empty census without send.
- [ ] Green: add capture offer to the existing connect setup pass after accepted master matches; use `supabase/functions/_shared/connectRun.ts` and current setup state, not a new wizard/matcher. Show capability-specific missing work and resume previously accepted capture decisions. Run that one journey under DB/test locks with a 52xx server.

### U4 (5 min): two real goal journeys — AC-ROP-013/014

- [ ] Red: create `pmo-portal/e2e/AC-ROP-013-journal-purchase.spec.ts` and `AC-ROP-014-invoice-assignment.spec.ts`, each `@e2e-isolation: self-isolated`, owning its own synthetic sources and cleanup.
- [ ] Green: journal journey creates the purchase from selected lines, opens it and compares displayed spending; invoice journey assigns, verifies both PMO-origin markers/project cost placement and undoes. Keep goal assertions; fix app failures, never weaken tests. Close browser in finally. Run only these journeys; capture touched routes with ux-proof.

## AC traceability and final checks

| AC | Canonical owning test | Tasks |
|---|---|---|
| 001 | `supabase/tests/0860_capture_journal_purchases.test.sql` | B3.1 |
| 002,004–008,017 | `supabase/tests/0861_erp_purchase_capture.test.sql` | A4–A9 |
| 003,010,011,015 | `supabase/tests/0863_capture_invoice_project_assignment.test.sql` | B1.1–B1.3; source-specific support in B2/B3 |
| 009 | `supabase/tests/0861_erp_purchase_capture.test.sql` | A12, B1.3, B3.2 (same AC, source-specific fixtures) |
| 012 | `scripts/pmo-capture.test.mjs` | A11, B1.4 |
| 013 | `pmo-portal/e2e/AC-ROP-013-journal-purchase.spec.ts` | U4 |
| 014 | `pmo-portal/e2e/AC-ROP-014-invoice-assignment.spec.ts` | U4 |
| 016 | `pmo-portal/components/ErpPurchaseCaptureDialog.test.tsx` | U1–U2 |
| 018 | `supabase/functions/_shared/purchaseCapture/report.test.ts` | A10, C2 |
| 019 | `supabase/tests/0864_capture_project_source_slices.test.sql` | B2.1–B2.2 |
| 020 | `supabase/tests/0865_capture_standalone_payments.test.sql` | B4.1 |
| 021,023 | `supabase/functions/_shared/purchaseCapture/contract.test.ts` | A1, C1–C2 |
| 022 | `pmo-portal/e2e/AC-ROP-022-connect-capture.spec.ts` | U3 |
| 025 | `supabase/tests/0863_capture_invoice_project_assignment.test.sql` | B1.2, B3.1 |
| 024 | `supabase/tests/0862_captured_purchase_continuation.test.sql` | D1–D2 |

There are **29 numbered TDD iterations**. Four-case mapping is in the spec; run the shared adapter suite with S-A and S-D source fixtures and S-B/S-C no-source fixtures. No owner question remains: all-unmapped/capitalised invoices are not assignable; mixed invoices count mapped lines only; new amortised/internal-asset recognition is deferred to #2196. Amount placement, provenance and continuation semantics above are fixed outcomes; an active builder's equivalent already-written function names can be retained by updating both interface blocks together before acceptance.

Final builder checks, only after the coordinator releases the heavy batch:

```bash
# root: guards/edge bindings and directly touched CLI tests
node scripts/check-edge-fn-test-binding.mjs
node --test scripts/pmo-capture.test.mjs
# app directory, every code increment: repository final gates, no full local unit suite
env PMO_TEST_LOCK_SLOTS=1 ../scripts/with-test-lock.sh npm run check:guards
env PMO_TEST_LOCK_SLOTS=1 ../scripts/with-test-lock.sh npm run typecheck
# A: from root, lint exact changed JS/server files
pmo-portal/node_modules/.bin/eslint --max-warnings=0 scripts/pmo.mjs scripts/lib/pmo-capture.mjs scripts/pmo-capture.test.mjs
# Deno served entry and shared tests: use the A command above plus the changed served payment test for D.
# S2, from app: touched tests only
env PMO_TEST_LOCK_SLOTS=1 ../scripts/with-test-lock.sh npx vitest run --maxWorkers=2 components/ErpPurchaseCaptureDialog.test.tsx src/lib/repositories/erpCapture.test.ts pages/ErpPurchases.test.tsx pages/project-detail/ErpJournalLinesSection.test.tsx
node ../scripts/affected-e2e.mjs
# S2, root: targeted journeys (no --reset)
scripts/with-db-lock.sh env PMO_TEST_LOCK_SLOTS=1 scripts/with-test-lock.sh scripts/e2e-local.sh AC-ROP-013
scripts/with-db-lock.sh env PMO_TEST_LOCK_SLOTS=1 scripts/with-test-lock.sh scripts/e2e-local.sh AC-ROP-014
scripts/with-db-lock.sh env PMO_TEST_LOCK_SLOTS=1 scripts/with-test-lock.sh scripts/e2e-local.sh AC-ROP-022
```

For S2 lint use `npx eslint --max-warnings=0 pages/ErpPurchases.tsx pages/ProcurementDetails.tsx pages/project-detail/ErpJournalLinesSection.tsx pages/project-detail/ErpPurchasesSection.tsx src/hooks/useErpJournalLines.ts src/hooks/useErpPurchaseLinks.ts src/lib/repositories/erpCapture.ts src/lib/repositories/contracts/erpCapture.ts components/ErpPurchaseCaptureDialog.tsx` from app; append any additional actually changed TS files. Run `scripts/ux-proof.sh` using its current help for `/procurement`, the touched project Procurement tab and `/procurement/:id`; render loading/empty/error/conflict and captured/assigned stages. Keep route capture evidence private. No local full-suite or DB reset.

CI merge gates: A/D/B/C without frontend app code use verify + affected unit + pgTAP; a no-frontend hotfix may follow the owner-approved exception without integration. S2 follows the full frontend release gate. Mutation evidence must show that removing the Admin, source uniqueness, no-resend or count-once rule turns its test red. Update `docs/runbooks/pmo-cli.md` and ADR-0093's historical-capture/remaining-step explanation after owner sign-off; no new integration posture or standalone money writer is introduced. The current docs-only worker runs no heavy checks and does not claim the feature implemented.
