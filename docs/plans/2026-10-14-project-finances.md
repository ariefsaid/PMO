# Project finances — blocked design/plan checkpoint (#1008)

Date: 2026-10-14. Spec: `docs/specs/project-finances.spec.md`.

**STOP: OQ-PFIN-001 needs a Director decision.** This is intentionally **not** an executable build plan. The requested schema-contradiction escalation takes precedence over inventing code, receipt oracles or a migration. The receipt model cannot express arbitrary historical per-project allocations using its current single invoice FK and header figures. No source, tests or schema may be changed under this checkpoint.

**Task count: 3 documentation/readiness tasks; 0 authorized implementation tasks.** No behavior task is presented as build-ready. A complete 2–5-minute TDD implementation plan must replace this checkpoint after the question is answered and the spec signed off. The path is retained as requested; its existence is not a build authorization.

## 1. Design constraints established by evidence

### A. One project resolver

The binding persists **PMO ID → ERP Project name**, not the inverse. Extract `invertProjectMap` from `pmo-portal/src/lib/adapterSeam/erpnext/actualsSnapshot.ts` into `pmo-portal/src/lib/adapterSeam/erpnext/projectMap.ts`, preserving this signature and behavior:

```ts
export function invertProjectMap(
  projectMap: Readonly<Record<string, unknown>> | undefined,
): ReadonlyMap<string, string | null>
```

Both the actuals refresh and invoice adoption must call it. Duplicate ERP names resolve to null; no trimming/name guessing or last-entry-wins attribution is introduced. Its PMO-ID result still needs a same-org project existence check before a service-role FK write. The backfill must consume this resolver too, not recreate the inversion in SQL.

Future code surfaces already identified:

- `pmo-portal/src/lib/adapterSeam/erpnext/projectMap.ts`
- `pmo-portal/src/lib/adapterSeam/erpnext/actualsSnapshot.ts`
- `pmo-portal/src/lib/adapterSeam/erpnext/bodies/salesInvoice.ts`
- `supabase/functions/_shared/erpnextFeedDeps.ts`
- `supabase/functions/adapter-dispatch/readModelWriters.ts`

`SI_FROM_DOC_FIELDS` must include `project`; canonical mapping must distinguish an omitted field from an explicit null. Add nullable `sales_invoices.erp_project`; outbound/read-back writers also preserve this provenance. Invoice attribution fills NULL only, as an atomic database conditional update, not read-then-unconditional-update. Preserve claim-first adoption, stale-event handling, amend lineage and existing notifications. Existing invoice mirrors require an explicit historical read by external reference: relying on the modified watermark will not recover an unchanged historical document.

Historical repair is a bounded, restartable one-shot operation, not an unbounded job inside a migration. It must hydrate provenance, use the shared resolver, restrict updates to NULL, and fail/report source-read errors without declaring a completed repair. Exact RPC/batch transport is withheld until the schema decision is made; no duplicate resolver is authorized.

### B. Narrow PMO attribution command

The intended public command is:

```ts
setSalesInvoiceProject(siId: string, projectId: string): Promise<void>
```

Proposed SQL entry point: `public.assign_sales_invoice_project(p_si_id uuid, p_project_id uuid)`. No client `org_id`; no ERP dispatch, outbox, native money edit or authorship claim. Null clearing is not requested; assigning and correcting to a non-null same-org project is.

The server contract must check active membership, Finance/Admin authority, same-org invoice and project, and eligible adopted ERP mirror. Retain compatible work-order/project invariants rather than clear billing links to force a reassignment through. Lock the invoice before correction; repeat assignment is an idempotent no-op. SQL null role handling must fail closed.

The final migration must make the security-definer setter coexist with the invoice mirror guard without broadening client writes. A caller-set session flag is not authorization. Retain explicit owner, fixed search path and least-privilege EXECUTE grants; test the runtime role/grant/policy bodies, not just their names.

Extend the existing invoice history registration to capture `project_id` as a reference and classify `erp_project` as mirror provenance. Keep the real actor and old/new references in `record_changes`; account for project parent context on correction. Do not add another audit table or expose mirror churn as operator history.

Repository transport belongs in the existing revenue seam (`pmo-portal/src/lib/repositories/types.ts`, repository implementation/export in `src/lib/repositories/index.ts`, and `src/lib/db/revenue.ts`), consumed by `src/hooks/useRevenue.ts`. Add an explicit `assign_project` action in `src/auth/policy.ts` mirroring REVENUE_WRITE, not generic edit or submit. On success invalidate revenue, invoice, incoming-payment, old/new project finance and relevant record-history keys. No optimistic money success.

UI entry points: `pages/RevenueByProject.tsx` Unassigned → eligible invoice selection; `pages/SalesInvoices.tsx` row menu. Share one assignment form, built from `EntityFormModal`, `Combobox`, `ConfirmDialog` for correction, and `classifyMutationError`. Display current/target project context; preserve pending/error selection; block duplicate saves. Use DESIGN tokens and localized copy. Exact component props and tests are frozen only in the replacement implementation plan.

### C. Consolidated project section — decision-dependent

Use `pmo-portal/pages/project-detail/tabs/OverviewTab.tsx` and consolidate the existing invoicing-against-contract section into `ProjectFinancesSection`, not a new top-level route or another competing summary. Keep the shell, existing tabs, contract-value authority and unrelated procurement/budget widgets unchanged.

Data flow: section → org/project-scoped query hook → typed repository → Supabase read RPC/DAL. Never synchronously fetch ERP from the UI. Receipt aggregation is blocked at OQ-PFIN-001; a simple header SUM against the current invoice FK is not an approved solution.

Factor the actuals-generation/account/category aggregation out of `get_budget_projection(uuid,text)` into one caller-visible SQL read definition. The new finance read must work without an Active budget, and the existing projection must consume the shared definition without changing its output columns or year/attribution/ETC semantics. Preserve generation scoping, all accounts per category, and unknown-reading vs known-zero semantics.

Budget selection: Active if any; otherwise latest Draft, visibly labelled. Use version identity plus a deterministic ordering, not an arbitrary first response. Lifetime contract/budget and fiscal-year figures must not be compared under an unstated time scope. Billed-work revenue follows `sales_invoice_work_billed`, not gross invoice header totals; outstanding follows the ERP mirror, never invoice-minus-receipts arithmetic.

Currency contract: invoice and receipt groups use their own denomination; budget and contract use header denomination; GL debit/credit actuals use ERP company/base denomination. No currency conversion and no cross-currency margin. The actuals schema does not carry document currency; do not relabel it to a foreign invoice or contract currency.

Read-scope decision must be pinned before freezing SQL oracles: either restrict the new finance section/read to the existing approval-rank revenue readers, or provide caller-visible actuals with an explicit restricted-row qualification. Existing project Overview also serves Engineer readers, so audience cannot be inferred from the route. Public documentation records this prospective contract only; sensitive review detail does not belong here.

### Scaling and behavior-preserving quality work

- One inverse resolver; one SQL category aggregate; reuse existing exact-money helpers.
- Aggregate by org/project/currency at the server, rather than load every org invoice into every project view.
- Reuse invoice `(org_id,project_id)` and receipt `(org_id,sales_invoice_id)` indexes. Audit the actuals project's generation/account filters with `EXPLAIN (ANALYZE, BUFFERS)` on synthetic fixtures before adding a composite index.
- Page historical source reads with stable keys; no per-render ERP reads or per-invoice name N+1.
- Query caches include authenticated org and project; correction invalidates both old and new attribution scopes.
- A failed source read is an error, not a fabricated zero. A partial/unknown source must propagate to margin.

## 2. Migration reservation and reversibility

Reserve **`supabase/migrations/0287_project_finances.sql`**, with **`supabase/migrations/rollback/0287_project_finances_down.sql`**. Do not use **0286** and do not renumber another branch's work.

The replacement plan must contain the actual forward and reverse SQL, not an instruction to invent it. It must name every function grant, business-table RLS policy, history catalog change and index, including the `org_id` enforcement of service-role writes. New security-definer surfaces require `scripts/isolation-probe-denominator.json` registration in the same implementation change.

Down migration must remove only the new surfaces, restore the prior mirror guard/history configuration/projection definitions, and preserve existing attribution and audit events. Provenance removal needs an explicit retention/export precondition; rollback must refuse destructive loss rather than delete operator history. Allocation-schema rollback depends on OQ-PFIN-001 and is not fabricated here.

No migration file is created by this documentation-only dispatch.

## 3. Readiness tasks (2–5 minutes each)

### Task 1 — Record the deciding schema contradiction (3 minutes)

**Paths:** `docs/specs/project-finances.spec.md` §top, §2; this plan §top.

**Actual documentation change:** record OQ-PFIN-001: header receipt figures plus a single invoice FK cannot represent multi-invoice allocation/remainder; record the allocation-mirror and explicitly-qualified-coverage alternatives; prohibit inferred cash from outstanding or proportional withholding allocation without a decision.

**AC coverage:** no behavior implementation. Unblocks the future receipt criteria and affects AC-PFIN-005/013/016.

**Verify from repository root:**

```bash
python3 - <<'PY'
from pathlib import Path
s = Path('docs/specs/project-finances.spec.md').read_text()
p = Path('docs/plans/2026-10-14-project-finances.md').read_text()
assert s.index('OPEN QUESTION OQ-PFIN-001') < s.index('## 1.')
assert 'BLOCKED' in s and 'not an executable build plan' in p
assert 'multiple invoice allocations' in s
print('PASS: blocking decision is explicit')
PY
```

### Task 2 — Preserve defaults and test ownership (4 minutes)

**Paths:** `docs/specs/project-finances.spec.md` §§3–6; this plan §§1–2.

**Actual documentation change:** record D1 PMO-only/D2 NULL-fill-only/D3 audited correction; pin verified v15/v16 allow-on-submit evidence; retain existing Finance/Admin authority; reserve 0287; enumerate requested EARS requirements and Given/When/Then criteria with one owning layer each. Explicitly do not certify unresolved receipt arithmetic or authorize a schema expansion.

**AC coverage:** documentary traceability for AC-PFIN-001 through AC-PFIN-016; none claimed implemented or passing.

**Verify from repository root:**

```bash
python3 - <<'PY'
from pathlib import Path
s = Path('docs/specs/project-finances.spec.md').read_text()
p = Path('docs/plans/2026-10-14-project-finances.md').read_text()
for n in range(1, 17):
    assert f'AC-PFIN-{n:03d}' in s
for token in ['D1', 'D2', 'D3', 'allow_on_submit: 1', 'Owning-layer traceability']:
    assert token in s
assert '0287_project_finances.sql' in p
assert '0287_project_finances_down.sql' in p
print('PASS: defaults, criterion inventory and migration reservation')
PY
```

### Task 3 — Freeze the stop boundary and hand back (3 minutes)

**Paths:** both requested documents; no source/test edits.

**Actual documentation change:** record the required builder gates below and the release boundary; report that this checkpoint contains three readiness tasks, no complete implementation plan, and no schema authorization. The Director must answer OQ-PFIN-001, pin audience/time scope, obtain spec sign-off and request the replacement no-placeholder TDD plan before dispatching a builder.

**AC coverage:** none; process checkpoint only.

**Verify from repository root:**

```bash
git diff --check
git status --short
git diff --name-only
```

Before committing, stage only the two named documents. No push, PR or deploy is authorized. No ADR is filed for an undecided architecture; the allocation-mirror alternative, if approved, needs an ADR at the replacement-plan phase.

## 4. Required TDD evidence in the replacement plan

Each future behavior task must first write an ID-tagged failing test, demonstrate RED against shipped code, implement exact changes, then show GREEN. Current proposed owning locations are in the spec; no passing-test claim is made by this checkpoint.

Mandatory oracles to freeze:

- Feed/adoption: shared resolver duplicates, stale/nonexistent/foreign-org targets, gate-on adoption, provenance absent vs null, and assigned-link preservation. Edge tests import the shipped sweep `./index.ts` and mock `globalThis.fetch`, not copied handlers.
- pgTAP: setter roles/active membership/org boundary/direct-write refusal; actor and old/new history; service-only historical repair, NULL-only repeat behavior and same-org validation; snapshot-generation/category/read-visibility contracts.
- Unit: repository RPC-only transport, real-role permission gate, old/new cache invalidation, accessible form confirmation/error/retry, deterministic version choice, per-currency arithmetic and unavailable states.
- One curated e2e, AC-PFIN-016, earns its cost by proving persisted UI → RPC → read-model → project Overview wiring, not by repeating role matrices. Author it only after the finalized contract; read `docs/e2e-parallel-conventions.md` first, use isolated fixture ownership, real auth/DB, and no money-path request interception.
- Mutation proof: in an isolated local worktree experiment, replace only the assignment RPC's Finance/Admin predicate with an unconditional allow, retain membership/org checks, reset+run the targeted pgTAP under one lock hold, require denied-role assertions to turn RED, restore the predicate, reset+run again and require GREEN. Never commit the mutant, skip a denied-role case or weaken an assertion. A successful command alone is not proof; inspect pgTAP output and record the specific failed assertions.

## 5. Builder verification commands (not run for this docs-only checkpoint)

Run from repository root. These are mandatory gates for the eventual implementation, not permission to create its files now.

```bash
scripts/with-test-lock.sh bash -c 'cd pmo-portal && npm run typecheck'
scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run --changed origin/dev'

# Derive the touched lintable paths from the actual implementation, not a guessed file list.
git diff --name-only -z origin/dev -- pmo-portal | \
  python3 -c 'import sys,subprocess; from pathlib import Path; paths=[p.removeprefix("pmo-portal/") for p in sys.stdin.buffer.read().decode().split("\0") if p.endswith((".ts",".tsx",".js",".jsx",".mjs")) and Path(p).is_file()]; sys.exit(subprocess.call(["npx","eslint","--max-warnings=0",*paths],cwd="pmo-portal") if paths else 0)'

# Migration and tests are chained in ONE shared-DB lock hold.
scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0287_assign_invoice_project.test.sql supabase/tests/0287_project_invoice_backfill.test.sql supabase/tests/0287_project_finances_reads.test.sql'

# One curated journey, only after its cross-stack AC is finalized.
scripts/e2e-local.sh AC-PFIN-016
```

The final implementation also runs changed edge-function Deno tests under each function's existing `deno.json`, the edge-handler binding guard, catalog/history inventory checks and the isolation denominator check. Exact edge commands and all actual code belong in the unblocked plan, not fabricated here.

CI's full `verify`/`pgtap` or `verify`/`integration` gates decide merge according to the target branch. Local changed-suite evidence is not a substitute. Three code reviewers remain mandatory. UI receives the portfolio Discover pass and affected-route × oracle sweep; every finding graduates to a test and design/decision note.

## 6. Director handoff

**Required answers:** receipt allocation/coverage and cash-vs-settlement definition (OQ-PFIN-001), new-section read audience (OQ-PFIN-002), and lifetime/fiscal-year scope (OQ-PFIN-003). **Decided:** D1/D2/D3; Finance/Admin attribution authority; invoice-join project identity; shared resolver/category logic; migration 0287.

**Delivery boundary:** two documentation files only, committed locally on `feat/1008-project-finances`. No implementation, runtime tests, push, PR or production action. The full requested implementation plan remains blocked rather than falsely marked complete.
