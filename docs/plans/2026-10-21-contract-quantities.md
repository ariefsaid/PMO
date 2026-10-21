# Contract quantities, allocations and BAST — implementation plan

**Date:** 2026-10-21. **Status:** decided design; build not started by this docs task.
**Spec:** `docs/specs/progress-billing.spec.md` §8. **ADR:** `docs/adr/0090-work-order-closing-value-and-bast.md`.
**Branch/worktree:** `feat/contract-quantities`, this worktree only, based on `origin/dev`.
**Executor:** Director-dispatched money/SoD work. Three build lanes **in sequence A → B → C on this
one branch**, not three parallel workers/branches. No push/merge/deploy is authorised by this plan.
Release ceiling dev; production needs its own explicit per-instance owner approval.

All examples are synthetic: generic 1,900 km contract line, WO 1,000 km, final 997 km, rate 50,000.
Do not copy client workbook contents into tracked fixtures or review reports. Source workbook/SPK
conversion produces a private JSON load file; this slice does not implement a workbook parser.

## 1. Decisions and architecture

OD-CQ-1..4 and DD-CQ-1..8 are fixed, reproduced in spec §8.1–2 and `docs/decisions.md`. Do not
reinterpret the PO freeze as a reason to edit order_value. Do not retain the old BoQ link as a
compatibility column. Keep claim/invoice work_order_id: the column being dropped belongs **only
to boq_items**. Closing acceptance and closing money form one server-written, immutable pair.

Data flow:

```text
private workbook/SPK → JSON → pmo validate → resolve (GET only) → apply POST boq_items
BoQ → work_order_lines → Draft BAST + register document → confirm RPC → closed WO + closing value
assessment + closed final quantities + live claims → get_project_billing → summarizeBilling
work_order_billing effective net → existing invoice dialogs / dashboards / assistant readers
FE → typed repositories → DAL → Supabase (no org_id sent by components)
```

Minimal extension, no new accounting engine: SQL owns earned and closing money; FE owns presentation
and editable claim suggestions. Evidence stays in the register. All current invoice/outbox/ERP
behavior, author-set SoD, tax normalization and mirror exemptions remain intact. Management-pack
recognition stays on its current percent calculation; record its earned-value follow-up, do not
claim those two screens remain numerically identical after this amendment.

### Read inventory and deciding artifacts

Read before planning: brief OD-CQ/DD-CQ; progress-billing spec; ADR-0077/0080; migrations 0250, 0252,
0262, 0197 (drawdown/transition), 0227 (value setter), 0298 (sole operator), 0239 (API guard);
`scripts/pmo.mjs`, `scripts/lib/pmo-load.mjs`; CLI starting-data spec; CLAUDE.md conventions;
product expectations and money-path primer. `scripts/prior-art.sh 'contract quantities'` located
#1278 and the prior billing issue. Repository visibility was checked: PUBLIC.

The production FE repository implementation is **`pmo-portal/src/lib/repositories/index.ts`**, with
interfaces in `types.ts`, not a `repositories/progressBilling.ts` module. Generated DB row types are
`pmo-portal/src/lib/supabase/database.types.ts` (`Tables<'...'>`), not new shadow interfaces.
0178's literal roster at this base has **70** names; adding the three BAST RPCs yields **73**.
The old ADR-0080 count of 59 is historical, not the baseline for this build.

### Component and cache design

- Extend `src/lib/db/progressBilling.ts`, `src/lib/progressBilling.ts`, repository `types.ts` and
  `index.ts`; add `src/lib/db/workOrderAcceptances.ts` for acceptance and allocation reads/writes.
  Add `workOrderAcceptance` repository interface/implementation using the existing `wrap` seam.
- Add `src/hooks/useWorkOrderAcceptances.ts`. Project-scoped reads use keys
  `['work-order-lines', orgId, projectId]` and `['work-order-acceptances', orgId, projectId]`.
  Fetch once per project, group by WO in memory; do not run one query per rendered WO row.
- New `pages/project-detail/WorkOrderLinesModal.tsx`, `WorkOrderAcceptanceModal.tsx` and
  `WorkOrderAcceptances.tsx`; existing Billing/WorkOrders tabs host them. Reuse EntityFormModal,
  useEntityForm, FormGrid, TextField/SelectField/FieldError and ConfirmDialog. No new route or drawer.
- Allocation writes invalidate lines + project-billing. BAST prepare/withdraw invalidate acceptances;
  confirmation additionally invalidates project-billing, work-orders, project-drawdown,
  work-order-billing and unbilled-work-orders (org/project prefixes as shipped). BoQ/rate changes
  also invalidate earned/acceptance-dependent reads; WO status changes invalidate allocation/billing
  facts. Never optimistically close a WO or guess dp_held.
- WorkOrders tab: one per-WO disclosure, Contract lines then Acceptances (BAST), beside existing
  billing actions; new preparation has one clear submit. Final confirmation uses the existing
  confirmation primitive; server refusal stays in dialog. Closed order shows original PO and separate
  closing net. DP notice persists, names the amount and remedy; no automatic refund action.
- Billing tab: existing table adds contract/ordered/not-yet-ordered/accepted/earned/claimed quantities;
  lump-sum fractions render as percent. Exact money in rows, existing compact KPI grammar with exact
  accessible value. Text identifies over-order/over-measure. Phone cards/labelled overflow and both
  locales/themes use DESIGN.md; do not turn every quantity into another card.

### Performance and precision

Indexes: `work_order_lines(org_id,work_order_id)`, `(boq_item_id)`, unique `(work_order_id,boq_item_id)`;
acceptances `(org_id,project_id)`, `(work_order_id,status,confirmed_at desc,id desc)`, `(document_id)`;
children PK `(acceptance_id,boq_item_id)` plus `(boq_item_id)`. Acceptance-line RLS joins its indexed
header to derive org. Final partial unique index is `(work_order_id) where status='Confirmed' and is_final`.
Aggregate each relation before joining; latest cumulative BAST is one **header** per WO ordered by
confirmed_at descending then id descending, not a per-line sum over history. Missing line in that
latest header contributes zero; do not accidentally resurrect an older stage's quantity.

SQL numeric and round-per-line decide earned/closing money. Reject nonfinite, excess-scale JSON
quantities before casting to numeric(14,3). FE calculations use existing cents/milli helpers with
safe-integer checks; decimal input converts 40.0% to 400 milli-units (0.400), not a binary-float
money calculation. Never convert already-net closing money through inclusive tax again.

## 2. Contracts and implementation sketches

All SQL changes below live in **`supabase/migrations/0335_contract_quantities.sql`**. Replaced
functions must contain their complete current body with only the named deltas; do not change older
forward migrations. Copy the latest definition, not a historical spec's approximation.

### 2.1 Schema, backfill and guards

```sql
alter table public.boq_items
  add column earning_basis text not null default 'unit_rate'
    check (earning_basis in ('unit_rate','lump_sum')),
  add column line_no integer,
  add column import_key text,
  add constraint boq_items_lump_sum_quantity check (earning_basis <> 'lump_sum' or quantity=1),
  add constraint boq_items_project_import_key unique(project_id,import_key);

create table public.work_order_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  work_order_id uuid not null references public.work_orders(id),
  boq_item_id uuid not null references public.boq_items(id),
  quantity numeric(14,3) not null check(quantity>0 and quantity<'Infinity'::numeric),
  created_at timestamptz not null default now(),
  unique(work_order_id,boq_item_id)
);
-- Before attaching state guard: preserve links even on historical Closed/Cancelled WOs.
insert into public.work_order_lines(org_id,work_order_id,boq_item_id,quantity)
select org_id,work_order_id,id,quantity from public.boq_items where work_order_id is not null;
drop trigger boq_items_zz_check_work_order on public.boq_items;
drop function public.check_boq_item_work_order_same_project();
alter table public.boq_items drop column work_order_id;
```

Reissue BoQ INSERT/UPDATE column grants without work_order_id, with earning_basis/line_no;
import_key is INSERT-only for loading, not an edit identity. Existing rows stay unit_rate by default;
do not reclassify historical lots by guessing. New FE/CLI inputs default from unit.

Acceptance header types follow spec §8.2 exactly: UUID PK and org/project/WO FKs; NOT NULL date,
final flag, status default Draft, prepared_by/profile and prepared_at default now; nullable
confirmed_by/profile, confirmed_at, confirm_basis, withdrawn_at, note ≤500 and document FK.
Pair checks require confirmation stamps/basis exactly for Confirmed; Withdrawn requires withdrawn_at.
Children have no org_id: header FK + BoQ FK + composite PK; finite nonnegative numeric(14,3).
No ON DELETE CASCADE that could silently erase confirmed acceptance. Project/document/line scope
is checked by RPCs and immutable triggers; cited register document remains FK-protected.

```sql
alter table public.work_orders
  add column closing_value numeric(14,2)
    check(closing_value>=0 and closing_value<'Infinity'::numeric),
  add column closing_acceptance_id uuid references public.work_order_acceptances(id),
  add constraint work_orders_closing_pair
    check((closing_value is null)=(closing_acceptance_id is null));
```

Attach allocation stamp_org_id before its same-project/state trigger (trigger names sort in that
order). RLS SELECT = own org + is_active_member; write policy = same plus existing BoQ writer role
set and both parents in own org. Column DML grants omit identity/parent re-pointing on UPDATE.
Same-project/state trigger locks the WO before reading status, refuses Closed/Cancelled 42501 and
confirmed-line deletion/below-latest reduction 23514; UPDATE cannot re-point parent/line/org/id.
Serialise prepare/confirm and allocation changes on the same WO row, and revalidate final completeness
at confirm (allocations may change after preparation). Validate child and header immutability on
UPDATE **and DELETE**; Draft replacement is performed by the prepare RPC only.

The new closing guard handles INSERT too (closing fields initially null), allows the first pair
only in confirm's narrow flag window, and always refuses overwriting/clearing an old non-null pair.
It must verify matching Confirmed final acceptance on this WO/project/org as well as flag/state.
Leave 0193's original body freeze and 0227's value setter unchanged.

Classify the two new work_orders columns in record_history_config: closing_value as money,
closing_acceptance_id as ref. Restore this exact registry delta on rollback; record the BAST RPC
operations with log_audit rather than registering unrelated new history surfaces.

### 2.2 RPC signatures, confirmation and effective net

Use these exact public signatures (PostgREST named parameters; no overloads):

```sql
prepare_work_order_acceptance(p_work_order_id uuid,p_acceptance_date date,p_is_final boolean,
  p_lines jsonb,p_document_id uuid default null,p_note text default null,
  p_acceptance_id uuid default null) returns uuid
withdraw_work_order_acceptance(p_id uuid) returns void
confirm_work_order_acceptance(p_id uuid) returns jsonb
```

All three: SECURITY DEFINER, search_path=public, assert_is_active_member, explicit own-org check
on every located parent, exact role gate, authenticated EXECUTE only. Prepare uses
may_record_project_progress(WO.project_id), supports Draft replacement with fields+lines in one
transaction, and sets preparer/time to the actor of that preparation. Withdraw accepts Draft only,
preparer or Admin/Finance. Confirm reads WO identity before locking, then **billing advisory lock →
WO FOR UPDATE → acceptance FOR UPDATE**; prepare/withdraw use WO→acceptance order too. Re-read
status after locks. Confirmation SoD exception is precisely:

```sql
select count(*)=1 and bool_or(p.id=auth.uid()) into v_sole_operator
from public.profiles p where p.org_id=v_org and public.is_active_member(p.id);
-- Only consulted when prepared_by=auth.uid(); caller still must be Admin/Finance.
```

Document rule is the existing attach_claim_evidence rule in 0250: own project/org,
status Issued/Approved and nonblank file_path, checked again at confirm. Select/lock the document
while validating. Do not create a new upload/evidence mechanism or admit a reference-only folder.
Final sums are `coalesce(sum(round(l.quantity*b.rate,2)),0)` over BAST children joined by BoQ id;
compare to original PO net, never to a prior closing value. Check billed/pending amounts using
work_order_billing_lines, and preserve 0262's in-flight reservations under its lock.

An implementable atomic reuse for the latter is: after upper-bound validation, set Confirmed and
closing pair/Closed in the current transaction, clear the narrow flag immediately, then call
assert_work_order_invoiceable(org,wo,project,acceptance_id::text,0,currency). Its new effective-net
ceiling checks all reservations, including in-flight commands; any BW001 rolls back **every stamp**.
Wrap that check to report the closing value and billed/pending figures, not a misleading successful
close. Do not catch/commit a refusal. Stage confirmation only stamps the acceptance.

Return closing_value (null for stage) and dp_held from the existing get_project_billing DP facts
(dp_billed−dp_recovered, not claim reservation balance). Audit prepare/replace/withdraw/confirm
with WO/project/acceptance ids, basis and final/closing facts. Confirmation creates no invoice.

Replace all four operational order-net readers with:

```sql
coalesce(wo.closing_value,
  case when wo.tax_treatment='inclusive' then wo.order_value-wo.tax_amount else wo.order_value end)
```

- `work_order_billing` from 0262 §3: both order_net and remaining, unchanged view signature/ACL.
- `assert_work_order_invoiceable` from 0262 §4: v_net expression only; preserve lock, CTE,
  project/status/currency checks, reductions and all existing callers.
- `get_project_drawdown` from 0197 §3: both WO sums, unchanged five-column return and INVOKER.
- `transition_work_order` from 0197 §4: committed sum and candidate read consistent with effective
  net; preserve issue SoD and acknowledgment/audit. Candidate Draft has null closing value.

Inspect all current readers, leaving original PO displays, immutable setters, ERP PO references
and final upper bound on original fields. `get_unbilled_work_orders` reads the view and needs no
second calculation. Include the manual-close disposition in Open points before editing that arm.

### 2.3 Earned summary and allocation claim scope

In get_project_billing retain existing currency/contract/work/DP/not-submitted/assessment fields.
Pre-aggregate allocation totals, live claimed by WO+line, latest confirmed header per WO and closed
final lines. A = latest assessment's quantity or zero; keep org-current-month cutoff from 0250.

```sql
-- b = contract line; a = latest assessment; cf/ca = pre-aggregated closed final/ordered totals.
coalesce(cf.quantity,0) + least(
  greatest(coalesce(a.quantity_to_date,0)-coalesce(ca.quantity,0),0),
  greatest(b.quantity-coalesce(cf.quantity,0),0)) as earned_quantity
-- Per-line value: round(earned_quantity * b.rate,2), project earned_value = sum of those.
-- Balance: b.quantity - coalesce(issued_alloc.quantity,0) - coalesce(cf.quantity,0).
```

Every BoQ JSON row includes earning_basis, line_no, ordered_quantity, accepted_quantity,
closed_final, earned_quantity, contract_balance and allocations[] from spec. Keep existing
assessed_quantity and claimed_quantity fields for compatibility with non-WO UI. Ordered counts
Issued+Closed allocations; final earned substitutions count only Closed WOs with confirmed final.
Stage BAST doesn't change earned. Use line_no nulls last, then created_at,id for display ordering.
get_project_billing stays SECURITY INVOKER; no new allow-list exemption for it.

In 0262's create_progress_claim replacement, change **only** the BoQ scope predicate, retaining
membership, project lock, advisory lock first, evidence/DP/recovery/cap/snapshot logic:

```sql
where b.id is null or
  (p_work_order_id is not null and not exists (
    select 1 from public.work_order_lines wl
    where wl.boq_item_id=b.id and wl.work_order_id=p_work_order_id)) or
  (p_work_order_id is null and exists (
    select 1 from public.work_order_lines wl where wl.boq_item_id=b.id))
```

No allocation status filter in no-WO eligibility. Add lump-sum ≤1 validation to
record_progress_assessment (latest 0252 body); retain derived-percent set/clear behavior and
weighted pct formula. BAST prepare uses the same precision validation before its numeric typmod.

### 2.4 CLI and FE type sketches

In `scripts/lib/pmo-load.mjs`, add contract_lines to PROJECT_FIELDS and validate it **before**
the existing early return when budget is absent. Unknown fields remain errors; required strings
use the existing BoQ lengths (item_code 140, description 500, unit 40), quantity positive finite
<1e11 with ≤3 dp, rate per isAmount; line_no optional integer; key required nonblank unique within
project; explicit basis must be unit_rate/lump_sum. Keep amount checks before writes.

```js
export const defaultContractLineBasis = (unit) =>
  ['lot','ls','lump sum'].includes(String(unit).trim().toLowerCase()) ? 'lump_sum' : 'unit_rate';
const contractLinePayload = (projectId, line) => ({
  project_id: projectId, import_key: line.key, line_no: line.line_no ?? null,
  item_code: line.item_code, description: line.description, unit: line.unit,
  quantity: line.quantity, rate: line.rate,
  earning_basis: line.basis ?? defaultContractLineBasis(line.unit),
});
```

Resolve existing line keys with GET boq_items filtered by project_id, select id,import_key; treat
1000-row saturation as preflight failure, not absence. New planned projects retain a parent plan
reference until created (dry-run must not demand an already-generated UUID). Each project plan
adds contractLines actions. Apply after its project stage/budget operations; for each new key POST
one line, catch only 23505 as skip, never PATCH/upsert. Existing keys remain skips even if file
values differ; report correction-in-app. Preserve project.diverged's no-writes rule and partial
loadReport errors. Update CLI load-only help text (it currently says only draft budgets).

```ts
export type EarningBasis = 'unit_rate' | 'lump_sum';
export interface AllocationFacts {
  workOrderId: string; boqItemId: string; quantity: number; claimedQuantity: number;
  acceptedQuantity: number | null; final: boolean;
}
export interface ContractLineFacts {
  boqItemId: string; earningBasis: EarningBasis; lineNo: number | null;
  orderedQuantity: number; acceptedQuantity: number; closedFinal: number;
  earnedQuantity: number; contractBalance: number; allocations: AllocationFacts[];
}
// Add to ProjectBillingFacts: earnedValue: number; contractLines: ContractLineFacts[].
// Replace BoqItemInput.workOrderId with earningBasis:EarningBasis and lineNo:number|null.
export interface PrepareWorkOrderAcceptanceInput {
  workOrderId: string; acceptanceDate: string; isFinal: boolean;
  lines: Array<{boqItemId: string; quantity: number}>;
  documentId: string | null; note: string | null; acceptanceId?: string;
}
export interface ConfirmWorkOrderAcceptanceResult { closingValue: number | null; dpHeld: number }
```

DAL parses all required numeric/array/status fields strictly: null/missing/nonfinite isn't zero.
Determine has-lines from contractLines.length, not a separate unreliable UI boolean:

```ts
const assessedCents = facts.contractLines.length > 0
  ? toCents(facts.earnedValue)
  : facts.assessment ? pctOf(toCents(facts.contractNet), facts.assessment.pctComplete) : null;
```

Line projects with no assessment have earned 0 (unless confirmed finals contribute), but still
state “No assessment yet” for the assessment record. They must not hide confirmed earned work.
`acceptedQuantity:null` in allocation facts means **no confirmed BAST**, distinct from a BAST of
zero; this is how pre-fill chooses its branch. Do arithmetic in integer milli-quantities:

```ts
const suggested = acceptanceExists
  ? acceptedMilli - claimedOnWoMilli
  : Math.min(assessedMilli - claimedAllMilli, allocatedMilli - claimedOnWoMilli);
if (suggested > 0) fill[boqItemId] = suggested / 1000;
```

## 3. Test-impact inventory — column drop sweep

Scope: searched **pmo-portal, supabase/tests, supabase/functions and scripts**, first for BoQ table/
row references, then inspected work_order_id/workOrderId in those files. Repeat after rebase:

```bash
rg -l 'boq_items|BoqItem' pmo-portal supabase/tests supabase/functions scripts
rg -n 'work_order_id|workOrderId' pmo-portal/pages/project-detail pmo-portal/src/lib/db/progressBilling.test.ts supabase/tests/0250_progress_billing_boq.test.sql supabase/tests/0250_progress_billing_claims.test.sql supabase/tests/0262_work_order_billing_refusal.test.sql
```

The following **seven existing test files directly encode the removed line-level link**; their
old fixture/assertion meaning must change. Do not remove their goal assertions:

| Existing test file | Break/change and update task |
|---|---|
| `supabase/tests/0250_progress_billing_boq.test.sql` | INSERT names removed column; move same-project WO assertions to allocation rows, retain BoQ role/number tests. A04. |
| `supabase/tests/0250_progress_billing_claims.test.sql` | linked BoQ fixture and scope-error assertions; insert allocations instead, keep allowed/forbidden claims. A16. |
| `supabase/tests/0262_work_order_billing_refusal.test.sql` | linked BoQ fixture; insert allocation for that WO so reservation/fence tests retain their intent. A16. |
| `pmo-portal/pages/project-detail/__tests__/BoqItemFormModal.test.tsx` | old picker and workOrderId save expectation; basis/default/edit fixture replaces it. C08. |
| `pmo-portal/pages/project-detail/__tests__/ProgressClaimModal.test.tsx` | fixture encodes scope on BoqItemRow; use separate allocations/BAST facts and retain claim workOrderId output. C11. |
| `pmo-portal/pages/project-detail/__tests__/ProgressAssessmentModal.test.tsx` | obsolete work_order_id fixture (cast may mask type failure); remove it and add basis/line_no/import_key row fields. C09. |
| `pmo-portal/pages/project-detail/tabs/__tests__/BillingTab.test.tsx` | typed BoQ rows still have removed column; replace row fields and wire summary/allocation facts. C12. |

Within the searched scopes, no supabase/functions or scripts test directly references the removed
BoQ column. `scripts/pmo.test.mjs` **will** require load-list/guard expectation updates for the
intentional guard extension (B01/B05), not for the drop. `src/lib/db/progressBilling.test.ts`,
`src/lib/repositories/progressBilling.test.ts`, `src/lib/progressBilling.test.ts`,
`src/lib/progressBilling.i18n.test.ts`, `pages/project-detail/__tests__/BillingTab.start.test.tsx`
need summary/input/mock changes in C01–C03/C12/C15. Claim workOrderId expectations in DAL and
repository tests are legitimate and remain. The serial AC-PB-003 e2e inserts an **unallocated** BoQ
without the dropped column; preserve its journey and run it at the lane-closing regression gate.
Other BoQ SQL fixtures omit work_order_id and are regressions to run, not asserted drop failures.

## 4. Sequenced build tasks (2–5 minute editing units)

Each row is a bounded editing unit, not a claim that DB reset/browser runtime fits five minutes.
For each behavior write the named failing test first, observe RED, implement the stated delta,
observe GREEN. Never relax a test to make the column drop green. Commands A-test/B-test/C-test
below are exact reusable invocations; each row names the command and exact test path(s) to supply.
All paths below are relative to this worktree root; `src/` and `pages/` in lane C mean under
`pmo-portal/`, explicitly as in command C-test. Retain stdout/body and RED/GREEN evidence privately.

```bash
# Define once in the shell in this worktree root. A-test resets ONLY because Lane A changes schema.
A-test() { scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db "$@"' -- "$@"; }
# After Lane A is applied, B guard tests use the same forward schema; no separate migration.
B-test() { node --test scripts/pmo-load.test.mjs scripts/pmo.test.mjs; }
C-test() { scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run "$@"' -- "$@"; }
```

### Lane A — schema, server behavior, pgTAP, manifest and generated types

Only 0335 forward + its matching rollback. SQL files below are new unless explicitly called
existing. Acceptance matrix and synthetic fixtures are shared within each pgTAP transaction, never
by mutating common seed data. Start new feature fixtures with isolated IDs and roles; use the
existing 0250/0262 JWT fixture pattern, without committing people details.

| Task / minutes | RED first → implementation (exact paths/delta) | AC / verify |
|---|---|---|
| A01 / 3 | Write `supabase/tests/0335_contract_lines.test.sql`: basis domain, quantity=1, finite checks, optional line_no/import key uniqueness. Apply §2.1 BoQ ALTER in 0335. | AC-CQ-001; `A-test supabase/tests/0335_contract_lines.test.sql` |
| A02 / 3 | Write `scripts/contract-quantities-rollback.test.sql` transaction harness: `\ir ../supabase/migrations/rollback/0335_contract_quantities_down.sql`, insert old linked BoQ fixtures, `\ir ../supabase/migrations/0335_contract_quantities.sql`, assert full allocation and absent old column. Start work_order_lines creation/backfill/drop in 0335. | AC-CQ-003; `A-test scripts/contract-quantities-rollback.test.sql` (GREEN after A20) |
| A03 / 3 | Add allocation own/foreign/disabled/Engineer read-write tests in `supabase/tests/0335_work_order_lines.test.sql`; create allocation indexes, RLS/FORCE RLS, stamp trigger and column grants in 0335 per §2.1. | AC-CQ-002; `A-test supabase/tests/0335_work_order_lines.test.sql` |
| A04 / 3 | Add allocation wrong-project/parent-repoint/duplicate/precision tests and convert existing `supabase/tests/0250_progress_billing_boq.test.sql` old-link inserts to allocations. Implement allocation scope trigger; preserve all BoQ authority/numeric assertions. | AC-CQ-001/002; `A-test supabase/tests/0335_work_order_lines.test.sql supabase/tests/0250_progress_billing_boq.test.sql` |
| A05 / 3 | Add Closed/Cancelled insert/update/delete and latest-confirmed-quantity floor assertions to 0335_work_order_lines test. Attach WO-row locking state/floor trigger after migration backfill. | AC-CQ-002; `A-test supabase/tests/0335_work_order_lines.test.sql` (BAST fixtures GREEN after A11) |
| A06 / 4 | Write table/grant/parent-tenancy assertions in `supabase/tests/0335_work_order_acceptances.test.sql`; create header/children/indexes/partial-final-unique index from §2.1, own-org SELECT policies, child parent-derived SELECT, no client DML. | AC-CQ-004/005; `A-test supabase/tests/0335_work_order_acceptances.test.sql` |
| A07 / 4 | Add prepare permission/create-stamp/audit tests to same file; implement prepare signature and membership/WO/project/permission checks, insert Draft and children, log_audit. | AC-CQ-004; `A-test supabase/tests/0335_work_order_acceptances.test.sql` |
| A08 / 4 | Add repeat/foreign/unallocated/4-dp/NaN/LS>1/final-missing-line and Draft replacement assertions; implement pre-cast validation and replacement under WO→acceptance locks. Recheck allocations on confirm as well. | AC-CQ-004; `A-test supabase/tests/0335_work_order_acceptances.test.sql` |
| A09 / 3 | Add withdraw actor/status/audit assertions; implement withdraw_work_order_acceptance, Draft-only, preparer-or-Admin/Finance, stamps. | AC-CQ-004; `A-test supabase/tests/0335_work_order_acceptances.test.sql` |
| A10 / 4 | Add confirmer role, two-member self-refusal, sole Finance/Admin success, second active Engineer blocks, offboarded/cross-org/anon cases; implement confirm membership/org/role and exact 0298 count predicate plus basis stamps. | AC-CQ-005; `A-test supabase/tests/0335_work_order_acceptances.test.sql` |
| A11 / 4 | Add document, immutable header/children incl. DELETE, stage behavior and duplicate-final assertions; implement document check and immutability triggers; index race oracle on confirmed final. | AC-CQ-005/010; `A-test supabase/tests/0335_work_order_acceptances.test.sql supabase/tests/0335_work_order_lines.test.sql` |
| A12 / 3 | Write `supabase/tests/0335_work_order_closing_value.test.sql` closing pair client/definer/overwrite assertions; add money columns, pair check, narrow guard and history registry delta in 0335. Confirm uses guarded write window, immediately clears it. | AC-CQ-006; `A-test supabase/tests/0335_work_order_closing_value.test.sql` |
| A13 / 4 | Add 1,000→997 close, 1,001 BW001, below-billed/pending BW001, equality and rollback-of-stamps assertions; finish final-confirm sum/upper bound/billing-lock/WO-close/DP-result/audit path per §2.2. Include two confirms' unique-final oracle. | AC-CQ-006/007; `A-test supabase/tests/0335_work_order_closing_value.test.sql` |
| A14 / 4 | Write `supabase/tests/0335_work_order_effective_net.test.sql` view/fence/drawdown/next-issue cases, incl. inclusive order and exact one-cent boundary. Replace work_order_billing and assert_work_order_invoiceable expressions, retaining all view grants/callers. | AC-CQ-008; `A-test supabase/tests/0335_work_order_effective_net.test.sql` |
| A15 / 3 | Complete same test's reduced committed drawdown/issue-overcommit acknowledgment oracle; replace 0197 drawdown and transition committed sums. Do not change the manual-close arm before Open point 1 disposition. | AC-CQ-008; `A-test supabase/tests/0335_work_order_effective_net.test.sql` |
| A16 / 4 | Write `supabase/tests/0335_progress_claim_allocations.test.sql`; change 0262 claim scope per §2.3. Update old linked fixtures/messages in `supabase/tests/0250_progress_billing_claims.test.sql` and `supabase/tests/0262_work_order_billing_refusal.test.sql` to allocation inserts, without changing evidence/SoD/cap oracles. | AC-CQ-011; `A-test supabase/tests/0335_progress_claim_allocations.test.sql supabase/tests/0250_progress_billing_claims.test.sql supabase/tests/0262_work_order_billing_refusal.test.sql` |
| A17 / 4 | Write `supabase/tests/0335_contract_earned_value.test.sql`: synthetic 1900/1000/997, A=1000 then 1050 then 2000; implement pre-aggregated closed/order/assessment earning CTEs and earned_value/line facts in get_project_billing. | AC-CQ-009; `A-test supabase/tests/0335_contract_earned_value.test.sql` |
| A18 / 4 | Add lump-sum 0.4, stage vs final, latest-cumulative-not-history-sum, cancelled WO and multi-WO cases; finish allocations[]/balance/accepted fields. Add assessment LS-bound validation to latest 0252 body, retaining percent flag and scalar fallback. | AC-CQ-009/010; `A-test supabase/tests/0335_contract_earned_value.test.sql supabase/tests/0252_progress_pct_derived_guard.test.sql` |
| A19 / 3 | Write `supabase/tests/0335_contract_lines_api_guard.test.sql` active-Admin GET/POST, PATCH/DELETE/upsert/non-Admin/disabled/BAST refusal, browser pass-through. Put complete 0239 api_client_request_guard replacement in 0335 with only boq_items added to admin_write_tables and original grants/notify retained. | AC-CQ-018; `A-test supabase/tests/0335_contract_lines_api_guard.test.sql supabase/tests/api_client_seed_surface.test.sql` |
| A20 / 5 | Complete `supabase/migrations/rollback/0335_contract_quantities_down.sql`: restore old column/grants/trigger and unique-single-allocation links; restore pre-0335 get_project_billing (0250), assessment (0252), claim/view/fence (0262), drawdown/transition (0197), API guard (0239), history registry; drop closing FK/columns, new guards/RPCs/tables/line fields in dependency order. Extend rollback harness with second allocation and down assertions, then ROLLBACK entire harness transaction. | AC-CQ-003; `A-test scripts/contract-quantities-rollback.test.sql` |
| A21 / 3 | Add three RPC names to existing `supabase/tests/0178_anon_executable_definers.test.sql`, manually enumerate baseline 70 +3 and set both hardcoded assertions/messages to 73. Preserve throwaway-writer mutation. Add explicit new function/table/column privilege assertions to 0335 tests and migration end DO block. | AC-CQ-005/006/018; `A-test supabase/tests/0178_anon_executable_definers.test.sql supabase/tests/0335_work_order_acceptances.test.sql` |
| A22 / 3 | Regenerate `scripts/isolation-probe-denominator.json` against this forward schema; classify three tables and three definer write RPCs, child parent-org semantics and synthetic refusal args, remove old column from boq_items select list. Regenerate types into a temporary file and merge only 0335 schema/RPC deltas, preserving hand-corrected nullability of unrelated RPC/view outputs. | AC-CQ-001–011/018; commands below |
| A23 / 5 | Run SQL targeted gate and rollback harness, inspect actual pgTAP result body. Locally mutate final cap/SoD/immutability rules one at a time under lock, require owning tests RED, restore exact forward file and repeat GREEN. Record private mutation evidence, not public open-control notes. | AC-CQ-002/005–008/011; Lane A gate below |

A22 exact commands (one hold keeps schema and type source coherent):

```bash
scripts/with-db-lock.sh bash -c 'supabase db reset && node scripts/check-isolation-denominator.mjs --write && supabase gen types typescript --local > /tmp/contract-quantities-database.types.ts'
node scripts/check-isolation-denominator.mjs
node scripts/check-shadow-types.mjs
```

Merge `boq_items` removal/new fields, three new tables, closing fields and three new RPC signatures
from that generated artifact into `pmo-portal/src/lib/supabase/database.types.ts`; do not raw-overwrite
unrelated nullable outputs (ADR-0003 plus the existing money-honesty annotations). Lane A may expose
expected FE compile failures from the column drop; they are explicitly owned by C02/C08–C12, not
permission to cast away rows or claim a green PR before Lane C.

Lane A gate (root, one lock; no full suite):

```bash
scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0335_contract_lines.test.sql supabase/tests/0335_work_order_lines.test.sql supabase/tests/0335_work_order_acceptances.test.sql supabase/tests/0335_work_order_closing_value.test.sql supabase/tests/0335_work_order_effective_net.test.sql supabase/tests/0335_contract_earned_value.test.sql supabase/tests/0335_progress_claim_allocations.test.sql supabase/tests/0335_contract_lines_api_guard.test.sql supabase/tests/0178_anon_executable_definers.test.sql supabase/tests/0005_force_rls.test.sql supabase/tests/0250_progress_billing_boq.test.sql supabase/tests/0250_progress_billing_claims.test.sql supabase/tests/0250_progress_billing_summary.test.sql supabase/tests/0250_progress_billing_assessment.test.sql supabase/tests/0252_progress_pct_derived_guard.test.sql supabase/tests/0262_work_order_billing_refusal.test.sql supabase/tests/0262_work_order_billing_figures.test.sql supabase/tests/record_history_read.test.sql scripts/contract-quantities-rollback.test.sql'
```

### Lane B — operator load, node tests and CLI documentation

Lane A's 0335 **already contains** the guard replacement (A19). Lane B does not create 0336 or edit
0239. Keep the paired CLI/server list change in this branch; nothing is shipped between lanes.

| Task / minutes | RED first → implementation | AC / verify |
|---|---|---|
| B01 / 3 | Extend `scripts/pmo.test.mjs` latest-guard parity and generic get/create/update refusal for boq_items. In `scripts/pmo.mjs` add boq_items to LOAD_TABLES only; change load-tier refusal/help to say draft budgets and contract lines, not ordinary ALLOWED_TABLES. | AC-CQ-018; `B-test` |
| B02 / 4 | In `scripts/pmo-load.test.mjs` add all-errors, unknown fields, no-budget-but-lines, explicit/default basis, length/scale/range and duplicate-key cases. Implement §2.4 validation/default helper in `scripts/lib/pmo-load.mjs`. | AC-CQ-016; `B-test` |
| B03 / 4 | Add resolve tests for known/new planned/missing/ambiguous project and existing keys/1000-cap; implement project-plan contractLines in same module using filtered GETs and planned parent refs. No write during resolve. | AC-CQ-016; `B-test` |
| B04 / 4 | Add apply tests for exact POST payload, skip-existing, raced 23505, re-run zero writes, stop/report failure, dry-run GET-only; implement contractLinePayload and per-line apply after project stage/budget steps. | AC-CQ-017; `B-test` |
| B05 / 3 | Add CLI-run integration mocks in `scripts/pmo.test.mjs` covering row validation before all requests, active Admin only, dry-run no POST and counts/actions output; retain AC-CSD-014 latest guard loader (it already locates newest definition). Fix orchestration only if new tests expose a missing report/skip branch. | AC-CQ-016–018; `B-test` |
| B06 / 3 | Amend `docs/specs/client-starting-data-cli.spec.md` §2 field table with projects[].contract_lines schema, §3 D4/D8 and traceability as necessary; `docs/runbooks/pmo-cli.md` §4 workflow adds price-sheet/SPK conversion, item_code, dry-run, skip/correct-in-app. Generic one-line example only, never real source data. | AC-CQ-016–018; `B-test` and `git diff --check` |

Lane B closes with `node --test scripts/pmo-load.test.mjs scripts/pmo.test.mjs` and
`scripts/with-db-lock.sh supabase test db supabase/tests/0335_contract_lines_api_guard.test.sql supabase/tests/api_client_seed_surface.test.sql`.
Do not run a separate browser dispatch for this intermediate lane.

### Lane C — DAL, repositories, hooks, helpers, dialogs, tabs, i18n and one journey

| Task / minutes | RED first → implementation | AC / verify (C-test paths app-relative) |
|---|---|---|
| C01 / 3 | Add earned server vs percent/no-line/null assertions and milli-quantity pre-fill tests to existing `pmo-portal/src/lib/progressBilling.test.ts`. Extend `ProjectBillingFacts` and helper contracts per §2.4 in `src/lib/progressBilling.ts`. | AC-CQ-012/013; `C-test src/lib/progressBilling.test.ts` |
| C02 / 4 | Add strict parser/malformed facts and BoQ write payload assertions in existing `src/lib/db/progressBilling.test.ts`. Remove BoqItemInput.workOrderId, add earningBasis/lineNo, parse earnedValue+contractLines+allocation null-vs-zero in `src/lib/db/progressBilling.ts`, order list by line_no/created_at/id. Update only affected fixtures in same file. | AC-CQ-001/012; `C-test src/lib/db/progressBilling.test.ts` |
| C03 / 3 | Extend `src/lib/repositories/progressBilling.test.ts` exact delegation for new BoQ inputs/summary facts; update `repositories/types.ts` and `repositories/index.ts` without a new progressBilling repository file. Keep claim workOrderId unchanged. | AC-CQ-012; `C-test src/lib/repositories/progressBilling.test.ts` |
| C04 / 4 | Create `src/lib/db/workOrderAcceptances.test.ts` for project-filtered lists, direct allocation writes, exact three RPC args, malformed confirmation and no org in writes; implement `src/lib/db/workOrderAcceptances.ts` with generated row types, assertWriteLanded, saturation detection and RPC parsing. | AC-CQ-002/004–006/015; `C-test src/lib/db/workOrderAcceptances.test.ts` |
| C05 / 3 | Add `src/lib/repositories/workOrderAcceptances.test.ts` delegation cases; add WorkOrderAcceptanceRepository type and repository member in `types.ts`/`index.ts`, including allocation CRUD and prepare/withdraw/confirm. No DAL calls from components. | AC-CQ-015; `C-test src/lib/repositories/workOrderAcceptances.test.ts` |
| C06 / 4 | Create `src/hooks/useWorkOrderAcceptances.test.tsx`, testing read keys and prepare/withdraw/confirm invalidations; implement `src/hooks/useWorkOrderAcceptances.ts` per cache design. Update `src/hooks/useWorkOrders.billingInvalidation.test.tsx` then `useWorkOrders.ts` to refresh new allocation/earned facts after WO status changes. | AC-CQ-008/015; `C-test src/hooks/useWorkOrderAcceptances.test.tsx src/hooks/useWorkOrders.billingInvalidation.test.tsx` |
| C07 / 3 | Add `src/auth/policy.contractQuantities.test.ts` for real-role allocation, project-PM/Finance-rank prepare, Admin/Finance confirm, preparer withdrawal; extend `src/auth/policy.ts` entities/actions. UI may hide self-confirm rather than add a fourth mode RPC; server remains authority. Impersonation stays view-only. | AC-CQ-015; `C-test src/auth/policy.contractQuantities.test.ts` |
| C08 / 4 | Update existing `pages/project-detail/__tests__/BoqItemFormModal.test.tsx` picker/default/edit fixtures; add AC-CQ-014 owner assertions in new `ContractQuantityDialogs.test.tsx`. Change `BoqItemFormModal.tsx`: remove workOrders prop/picker, basis select with unit-derived default unless overridden, hidden fixed quantity=1 for LS. | AC-CQ-014; `C-test pages/project-detail/__tests__/BoqItemFormModal.test.tsx pages/project-detail/__tests__/ContractQuantityDialogs.test.tsx` |
| C09 / 3 | Update existing `pages/project-detail/__tests__/ProgressAssessmentModal.test.tsx` obsolete row fixture; add 40.0/40.01/100 percent cases to ContractQuantityDialogs owner test. Change `ProgressAssessmentModal.tsx` to decimal-safe percent labels/validation/fraction payload for LS; unit-rate remains quantities. | AC-CQ-014; `C-test pages/project-detail/__tests__/ProgressAssessmentModal.test.tsx pages/project-detail/__tests__/ContractQuantityDialogs.test.tsx` |
| C10 / 4 | Add balance/over-order/zero/error/permission save cases in ContractQuantityDialogs; create `WorkOrderLinesModal.tsx` using shared form primitives, one WO-line row at a time (upsert is not used), explicit delete with confirmation, direct allocation mutations. Persist each operation and refetch authoritative list; never report a multi-row atomic save that the table API did not provide. | AC-CQ-014/015; `C-test pages/project-detail/__tests__/ContractQuantityDialogs.test.tsx` |
| C11 / 4 | Update `pages/project-detail/__tests__/ProgressClaimModal.test.tsx` fixture scope to allocations, add BAST/no-BAST/null-zero pre-fill coverage; change `ProgressClaimModal.tsx` inScope and suggestions using §2.4 helpers, keeping claim workOrderId and editable quantities. | AC-CQ-013/014; `C-test pages/project-detail/__tests__/ProgressClaimModal.test.tsx src/lib/progressBilling.test.ts` |
| C12 / 4 | Update typed BoQ rows and facts in `pages/project-detail/tabs/__tests__/BillingTab.test.tsx` and `pages/project-detail/__tests__/BillingTab.start.test.tsx`; add AC-CQ-015 owner cases to `ContractQuantitiesTabs.test.tsx`. Change `tabs/BillingTab.tsx` columns, earned summary, unassessed indicator and child props; invalidate dependent facts after BoQ changes in `src/hooks/useProgressBilling.ts`. | AC-CQ-012/015; `C-test pages/project-detail/tabs/__tests__/BillingTab.test.tsx pages/project-detail/__tests__/BillingTab.start.test.tsx pages/project-detail/__tests__/ContractQuantitiesTabs.test.tsx` |
| C13 / 4 | Add acceptance prepare/edit/withdraw/status/list/confirm-refusal tests to ContractQuantitiesTabs; create `WorkOrderAcceptanceModal.tsx` and `WorkOrderAcceptances.tsx` with cumulative quantities, final completeness, same-project document picker, role actions and persistent submitError. Data comes from one project query, grouped by WO. | AC-CQ-014/015; `C-test pages/project-detail/__tests__/ContractQuantityDialogs.test.tsx pages/project-detail/__tests__/ContractQuantitiesTabs.test.tsx` |
| C14 / 4 | Add final confirm, distinct order/closing display and dp_held notice tests to ContractQuantitiesTabs, incl. failed read/save and no optimistic close. Integrate components into `tabs/WorkOrdersTab.tsx`, closing response notice and all cache invalidations. Preserve Invoice action based on server billing facts. | AC-CQ-008/015; `C-test pages/project-detail/__tests__/ContractQuantitiesTabs.test.tsx pages/project-detail/__tests__/WorkOrdersTab.billing.test.tsx` |
| C15 / 3 | Extend `src/lib/progressBilling.i18n.test.ts` with every new key and used-key scan; add translations to `pmo-portal/public/locales/en/common.json` and `id/common.json`. Rebase these edits immediately before PR. New prefix subtrees projectDetail.billing and projectDetail.workOrders.acceptances/contractLines. | AC-CQ-019; `C-test src/lib/progressBilling.i18n.test.ts` |
| C16 / 4 | After reading `docs/e2e-parallel-conventions.md`, write `pmo-portal/e2e/AC-CQ-020-contract-quantities.spec.ts`: unique test-owned generic project/WO/line/register file, PM allocation/preparation then distinct Finance confirmation, reload and assert 997/903/49,850,000 and reduced still-to-invoice. Declare correct isolation class, seed prerequisite stages by APIs but perform the goal through UI. | AC-CQ-020; `scripts/e2e-local.sh AC-CQ-020` |
| C17 / 4 | Keep existing `pmo-portal/e2e/serial/AC-PB-003-progress-billing-erp.spec.ts` goal intact; run the touched journey and old billing regression. Fix production code on failure, never weaken assertions or gate by CI. | AC-CQ-011/020 supporting regression; `scripts/e2e-local.sh AC-PB-003` |
| C18 / 5 | Run final targeted type/lint/changed-unit gate below; collect ≥80% changed-line coverage and actual outputs. Fix defects in their owning task, no blanket rerun chains. | AC-CQ-012–020; final gate below |
| C19 / 5 | Render Billing/WorkOrders in EN/ID, both themes, 1440/390, rich synthetic seed; Discover reviewer checks allocation→BAST→close flow, phones, keyboard and remedies using impeccable, taste and ui-ux-pro-max. Graduate every finding to owning test + existing routes×oracles matrix and DESIGN.md/decisions note, then re-render clean. | AC-CQ-014/015/019/020; targeted C-test files plus journey, no extra full suite |

## 5. Traceability (canonical owner; supporting regressions do not move ownership)

| AC | Owning test file | Build tasks |
|---|---|---|
| AC-CQ-001 | `supabase/tests/0335_contract_lines.test.sql` | A01/A04 |
| AC-CQ-002 | `supabase/tests/0335_work_order_lines.test.sql` | A03–A05/A11 |
| AC-CQ-003 | `scripts/contract-quantities-rollback.test.sql` | A02/A20 |
| AC-CQ-004 | `supabase/tests/0335_work_order_acceptances.test.sql` | A06–A09 |
| AC-CQ-005 | `supabase/tests/0335_work_order_acceptances.test.sql` | A10/A11/A21/A23 |
| AC-CQ-006 | `supabase/tests/0335_work_order_closing_value.test.sql` | A12/A13/A23 |
| AC-CQ-007 | `supabase/tests/0335_work_order_closing_value.test.sql` | A13/A23 |
| AC-CQ-008 | `supabase/tests/0335_work_order_effective_net.test.sql` | A14/A15/A23 |
| AC-CQ-009 | `supabase/tests/0335_contract_earned_value.test.sql` | A17/A18 |
| AC-CQ-010 | `supabase/tests/0335_contract_earned_value.test.sql` | A11/A18 |
| AC-CQ-011 | `supabase/tests/0335_progress_claim_allocations.test.sql` | A16 |
| AC-CQ-012 | `pmo-portal/src/lib/progressBilling.test.ts` | C01–C03/C12 |
| AC-CQ-013 | `pmo-portal/src/lib/progressBilling.test.ts` | C01/C11 |
| AC-CQ-014 | `pmo-portal/pages/project-detail/__tests__/ContractQuantityDialogs.test.tsx` | C08–C11/C13 |
| AC-CQ-015 | `pmo-portal/pages/project-detail/__tests__/ContractQuantitiesTabs.test.tsx` | C04–C07/C10/C12–C14/C19 |
| AC-CQ-016 | `scripts/pmo-load.test.mjs` | B02/B03/B05/B06 |
| AC-CQ-017 | `scripts/pmo-load.test.mjs` | B04/B05/B06 |
| AC-CQ-018 | `supabase/tests/0335_contract_lines_api_guard.test.sql` | A19/B01/B05 |
| AC-CQ-019 | `pmo-portal/src/lib/progressBilling.i18n.test.ts` | C15/C19 |
| AC-CQ-020 | `pmo-portal/e2e/AC-CQ-020-contract-quantities.spec.ts` | C16/C18/C19 |

There are **48 bounded editing/verification tasks** (A01–A23, B01–B06, C01–C19). Each test names
its AC in its title/pgTAP description. The seven legacy direct-link test updates are allocated
explicitly in §3; they are not silently deleted or made conditional on schema version.

## 6. Final gates and handoff

Commands are build instructions, **not evidence that this docs-only author ran the app/DB tests**.
From worktree root, after all lanes (locks self-wrap/re-enter safely):

```bash
scripts/with-test-lock.sh bash -c 'cd pmo-portal && npm run typecheck && npx vitest run --changed origin/dev'
# All changed TS/TSX/JS/MJS, with paths relative to pmo-portal for ESLint's config.
git diff --name-only --diff-filter=ACMR origin/dev -- pmo-portal | grep -E '\.(ts|tsx|js|mjs)$' | cut -d/ -f2- | while IFS= read -r file; do (cd pmo-portal && npx eslint --max-warnings=0 "$file") || exit; done
node --check scripts/lib/pmo-load.mjs
node --check scripts/pmo.mjs
node --test scripts/pmo-load.test.mjs scripts/pmo.test.mjs
node scripts/check-isolation-denominator.mjs
node scripts/check-shadow-types.mjs
scripts/e2e-local.sh AC-CQ-020
scripts/e2e-local.sh AC-PB-003
git diff --check
```

Run Lane A's targeted pgTAP gate after the final SQL change under a single reset+test hold. No full
local verify suite, no reset after the FE-only lane unless schema/seed changed. CI decides the full
suite; local results are not a substitute. Required PR-to-dev CI = verify, normal unit shards and
pgTAP. After owner push approval and at the completed money/FE lane boundary only, the Director
runs `scripts/ci-e2e.sh feat/contract-quantities` through the shared logged wrapper, within the two
concurrent-browser cap. Do not dispatch one per intermediate lane. A red gate stops completion.

Three reviewers always: spec-reviewer, code-quality-reviewer (including indexes/query-plan audit),
security-auditor (new RPC/tenancy/SoD/money surface). Reviewers consume builder evidence; rerun
only a targeted check in doubt. FE lane gets the rendered Discover pass and graduated findings.
Acceptance returns per-AC owning-test evidence, rollback result, exact allow-list count, mutation
RED→GREEN evidence, changed-line coverage and honest-state/screenshots evidence to the Director.
No production action. No attribution trailers. Release engineer checks actual green CI before any
approved dev merge; preserve the branch/worktree until verified post-merge cleanup is authorised.

## 7. Open points

These are integration dispositions for the Director, not invitations to reopen OD-CQ/DD-CQ.

1. **Existing manual close and already-Closed WOs.** Shipped `transition_work_order` directly closes
   Issued→Closed without an acceptance (`supabase/migrations/0197_project_contract_value_tax.sql:481–482`);
   its current UI has a Close button (`pmo-portal/pages/project-detail/tabs/WorkOrdersTab.tsx:479`).
   DD-CQ-3 permits BAST preparation/confirmation only while Issued, while DD-CQ-5 substitutes finals
   only on Closed WOs with a confirmed final. A user taking the old Close path on a quantity WO would
   therefore leave it closed without the accepted 997/903 outcome and unable to record its final BAST.
   **Needed:** Director disposition before A15/C14: route quantity-WO closure through final BAST,
   preserve or replace manual close for no-line WOs, and specify treatment of historical Closed
   allocations (do not fabricate an acceptance or reopen a closed WO implicitly). Existing Closed
   rows retain null closing money/original-net fallback unless explicitly migrated by a separately
   approved rule. Tests for the chosen integration must extend AC-CQ-006/015 without changing the
   decided final-confirm flow. No new ruling is assumed in this plan.

2. **Management-pack follow-up identity.** DD-CQ-5 explicitly leaves its recognised figure on percent;
   shipped Billing helper currently documents equality with that pack
   (`pmo-portal/src/lib/progressBilling.ts:3–7`). C01 must remove that now-superseded equality claim,
   not change the pack. Director should assign a follow-up issue for earned-value recognition after
   this docs handoff (no public issue was filed by this author). This does not block the three lanes.

### Dispositions (Director 2026-10-21)

1. **Manual close → DD-CQ-9.** In A15 add to `transition_work_order` (latest body 0197:303, re-create in 0335):
   on Issued → Closed, if `exists (select 1 from public.work_order_lines l where l.work_order_id = p_id)`
   raise 42501 'this work order has contract lines: close it by confirming its final BAST'. The confirm RPC
   closes the work order itself (not via this function). No backfill of historical Closed rows. In C14 hide
   Close for a work order with allocations. Extend AC-CQ-006 (pgTAP) and AC-CQ-015 (RTL).
2. **Management pack → #1279.** C01 removes the equality comment only.

