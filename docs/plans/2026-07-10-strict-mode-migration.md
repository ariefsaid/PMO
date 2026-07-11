# TypeScript strict-mode migration — triage & fix plan

**Date:** 2026-07-10 · **Branch:** `dev` · **Status:** analysis only (no code changed)

Reproduce the error set:

```bash
cd pmo-portal && npx tsc --noEmit --strict 2>&1 | grep "error TS"   # → 94 errors
```

`pmo-portal/tsconfig.json` has no `strict` key today, so classic `tsc` runs non-strict (0 errors).
The 94 below are exactly what `strict: true` (and TS7/tsgo's default) surfaces.

---

## 1. Summary counts

**Total: 94 errors.**

### (a) By error code

| Code | Count | Meaning |
|---|---:|---|
| TS2322 | 75 | Type not assignable (the bulk = RPC `\| null` args + fixtures) |
| TS2769 | 5 | No overload matches (test mock predicate sigs) |
| TS2345 | 4 | Argument not assignable (test mock predicates + commit.ts) |
| TS7006 | 3 | Parameter implicitly `any` (useBudget.test) |
| TS2339 | 3 | Property does not exist on `never` (useQuery/CFA) |
| TS18048 | 2 | Value possibly `undefined` (DataTable sort, handlerContext.test) |
| TS2531 | 1 | Object possibly `null` (e2e invite) |
| TS18047 | 1 | Value possibly `null` (useAssistantPanel runtime) |

### (b) By source layer

| Layer | Count |
|---|---:|
| DB mappers (`src/lib/db/*` non-test) | 54 |
| Unit test files (`*.test.ts(x)`) | 26 |
| recharts usage (`ProjectSCurve`, `AgentCostMetrics`) | 4 |
| Pages non-test (`ProcurementDetails` 2, `Incidents` 1) | 3 |
| Import util (`commit.ts`) | 1 |
| Shared component (`DataTable.tsx`) | 1 |
| Hook (`useAssistantPanel.ts`) | 1 |
| e2e (`AC-AUTHF-020…`) | 1 |

DB-mapper breakdown: `procurementRecords.ts` 29 · `procurementLifecycle.ts` 16 · `timesheetTransition.ts` 4 · `projectTransitions.ts` 2 · `dashboard.ts` 2 · `timesheets.ts` 1.

### (c) By fix-class

| Class | Count | Mechanical? | Real null bug? |
|---|---:|---|---|
| A. RPC nullable-arg friction (Supabase typegen) | 54 | mostly | **No** — generated types wrong, null is legal |
| B. recharts formatter signature friction | 4 | yes | No |
| C. useQuery narrowing / `never` (prod) | 2 | no (small refactor) | No (guards exist) |
| D. **Real null-safety guards** | 2 | no (add guard) | **Yes (benign)** |
| E. Prod type under-narrowing (`\| null`) | 3 + 1 | judgment | No, but a real type-accuracy fix |
| F. Test-file mock/fixture typing | 26 | yes | No |
| G. e2e null-narrow | 1 | yes | No |
| H. commit.ts guard gap | 1 | judgment | Borderline (defensive) |

Sum = 54 + 4 + 2 + 2 + 4 + 26 + 1 + 1 = **94**.

---

## 2 & 3. Fix-classes — files, pattern, risk

### Class A — RPC nullable-arg friction (54, DB mappers) — **NOT null bugs**

**Root cause (verified against the migrations).** The mapper functions are thin `supabase.rpc(...)`
wrappers whose *return* is `as unknown as {...}`, but the **args object is still type-checked** against
the generated `Database…Functions[fn].Args`. Supabase's typegen **never emits `| null` for scalar RPC
params** — it types every non-defaulted param as bare `string`/`number` and every `DEFAULT`-ed param as
optional `string | undefined`. The actual Postgres functions accept NULL:

```sql
-- supabase/migrations/0072_import_provenance.sql
create or replace function create_purchase_request(
  p_procurement_id uuid, p_reference_number text, p_status text, p_date date, p_amount numeric,
  p_import_key text default null, p_import_batch_id uuid default null, p_imported_at timestamptz default null)
  ...
  values (..., p_reference_number, coalesce(p_status,'Draft'), p_date, p_amount, ...)
```

`p_reference_number/p_date/p_amount` are plain nullable columns; `p_status` is coalesced. **Passing null
is genuinely valid at runtime** — this is type friction, so an annotation/adapter is the correct fix
(NOT a guard/default, which would silently change behavior — e.g. defaulting `reference_number` would
lose the ability to store a null reference). Two sub-patterns:

**A1 — optional param passed as `?? null` / `null` literal** (arg type is `string | undefined`).
Fix = pass the value directly (or `undefined`); `undefined` omits the arg → the RPC's `DEFAULT NULL`
applies. **Behavior-equivalent, mechanical.**

- `procurementRecords.ts` import trailers: 61,62,63 · 89,90,91 · 117,118,119 · 148,149,150 (12)
- `procurementLifecycle.ts` `?? null` trailers: 209, 232-234, 258-261, 286-290, 316-318 (16)
- `timesheetTransition.ts` `p_notes`: 75, 88, 101, 115 (4)
- `projectTransitions.ts`: 111, 112 (2)
- `dashboard.ts` `get_win_rate` `p_from/p_to`: 115×2 (2)

```ts
// before  (src/lib/db/procurementRecords.ts:61)
p_import_key: importKey ?? null,          // string|null  ✗  arg is string|undefined
// after
p_import_key: importKey,                  // string|undefined  ✓  (undefined ⇒ RPC DEFAULT NULL)
```
```ts
// before  (src/lib/db/dashboard.ts:113-115)
const p_from = from ? toIso(from) : null;   // → passed as string|null
// after
const p_from = from ? toIso(from) : undefined;
```

**A2 — required nullable scalar param** (arg type is non-null `string`/`number`, value is `… | null`).
Fix = a **localized typed adapter** — these are provably null-safe (SQL accepts NULL), so per the
guardrail an annotation is acceptable; do **not** substitute a default. Cleanest is a tiny cast of the
**args object** to the generated `Args` type (consistent with the file's existing `as unknown as` on the
return), with a comment noting the typegen limitation.

- `procurementRecords.ts`: 57-60 · 85-88 · 113-116 · 143-147 (17)
- `timesheets.ts`: 136 (`p_timesheet_id: timesheetId` where `timesheetId: string | null` — null is the
  "create new sheet" signal the RPC resolves; **verified valid**) (1)

```ts
// before  (src/lib/db/procurementRecords.ts:55-64)
const { data, error } = (await supabase.rpc('create_purchase_request', {
  p_procurement_id: procurementId,
  p_reference_number: referenceNumber,   // string|null ✗ arg typed string
  p_status: status, p_date: date, p_amount: amount, ...
})) as unknown as { data: PurchaseRequestRow; error: RpcErrorLike | null };

// after — one adapter, documents WHY (Supabase typegen omits |null on RPC params)
import type { Database } from '@/src/lib/supabase/database.types';
type CreatePRArgs = Database['public']['Functions']['create_purchase_request']['Args'];
const args: CreatePRArgs = {
  p_procurement_id: procurementId,
  // NOTE: SQL accepts NULL for these (0072); typegen types them non-null. Not a null bug.
  p_reference_number: referenceNumber as CreatePRArgs['p_reference_number'],
  p_status: status as CreatePRArgs['p_status'],
  p_date: date as CreatePRArgs['p_date'],
  p_amount: amount as CreatePRArgs['p_amount'],
  p_import_key: importKey, p_import_batch_id: importBatchId, p_imported_at: importedAt,
};
const { data, error } = (await supabase.rpc('create_purchase_request', args)) as unknown as …;
```

> **Better long-term option (raise with owner):** wrap `supabase.rpc` in a small typed helper
> `rpcNullable(fn, args)` whose `args` param maps every `Args` field to `T | null`, centralizing the
> friction so no per-call casts leak into mappers. Larger blast radius — defer to a follow-up.

**Risk:** low. A1 is behavior-identical. A2 preserves runtime behavior; the only "risk" is that a cast
could mask a *future* genuinely-required param — mitigate with the explanatory comment + keeping the cast
field-scoped, not `as never`/`as any` on the whole object. **Never** collapse these to `!` or `as any`.

### Class B — recharts formatter friction (4) — safe library-type friction

`ProjectSCurve.tsx` 112,113 · `AgentCostMetrics.tsx` 254,255. Our `(label: number) => string` /
`(value: number) => string|[string,string]` don't match recharts' `labelFormatter`/`formatter`
overloads (which type the arg as `ReactNode`/`ValueType`). The values ARE numbers at runtime (numeric
axes). Fix = accept recharts' wide type and narrow internally.

```ts
// before  (pages/project-detail/ProjectSCurve.tsx:112)
labelFormatter={(label: number) => formatSCurveAxisDate(label)}
// after
labelFormatter={(label) => formatSCurveAxisDate(Number(label))}
formatter={(value) => `${Number(value)}%`}
```

**Risk:** minimal. Mechanical. `Number(...)` is the honest coercion (recharts hands us the datum).

### Class C — useQuery narrowing / `never` (2, prod) — small refactor, no bug

`ProcurementDetails.tsx` 316 (`.isPending` on `never`), 349 (`NoInfer<ProcurementDetail> | undefined`
→ `ProcurementDetail`). **Not a `never` from a lost generic** — the hook correctly declares
`useQuery<ProcurementDetail>`. The cause: `ProcurementDetails.tsx:274` aliases `const data =
detailQuery.data` **before** the `isPending`/no-access/`isError` early-returns, so narrowing
`detailQuery` later never narrows the local `data`; at line 349 `data` is still `ProcurementDetail |
undefined` and the union CFA degenerates. At runtime `data` is guaranteed defined there (all three
guards returned).

Fix = read from the query object after the guards (discriminated-union narrowing), don't pre-alias:

```ts
// after — drop the early `const data = detailQuery.data`; in the success body:
if (detailQuery.isPending) { … return … }
if (isNoAccess || (!detailQuery.isError && !detailQuery.data)) { … return … }
if (detailQuery.isError) { … return … }
const p = detailQuery.data;   // ProcurementDetail (union narrowed) — no `!`, no cast
```

The `useEffect` at 283 that consumes `data` keeps working off `detailQuery.data`.
**Risk:** low, but touches control flow → needs a test run (existing `ProcurementDetails` tests cover
loading/no-access/error/success). **Judgment call, not mechanical.**

### Class D — **Real null-safety guards (2)** — genuine, fix with a guard (NOT a cast)

1. **`src/hooks/useAssistantPanel.ts:701`** — `runtime.adoptRun?.(…)` where `runtime` is
   `AgentRuntimePort | null`. Every *other* callback in this hook guards it (`if (!runtime) return;` at
   463, 528, 559, 570); the `openThread` callback does **not**. If the panel loads a thread before the
   runtime context is ready, this **throws at runtime**. Fix = guard, matching siblings:
   ```ts
   if (!runtime) return;                 // add at the top of the openThread callback
   // …
   runtime.adoptRun?.(targetRunId, priorMessages, threadId ? { threadId } : undefined);
   ```
   (`runtime?.adoptRun?.(…)` also silences tsc but the early-return is the correct, sibling-consistent
   fix so downstream `runtime` uses in the same callback are covered too.)

2. **`src/components/ui/DataTable.tsx:198`** — `sort?.key === col.sortKey && ( … sort.dir … )`. The
   `?.` guards `.key` but `sort.dir` on the next line is unguarded; if `sort` is undefined **and**
   `col.sortKey` is undefined, `undefined === undefined` is true and `sort.dir` derefs undefined. Fix =
   real guard:
   ```ts
   {sort && sort.key === col.sortKey && (<Icon name={sort.dir === 'asc' ? 'up' : 'down'} />)}
   ```

**Risk:** low; both are the correct hardening. **These are the two errors the guardrail is about — do
NOT use `!`/`as` here.**

### Class E — Production type under-narrowing (3 + 1) — real type-accuracy fix

- `Administration.usage.margin.test.tsx:23`, `Administration.usage.providerCost.test.tsx:25,40` (3):
  fixtures set `margin_usd: null`, but the `AdministrationUsage` row prop types `margin_usd: number`.
  The test names ("…when every row has margin_usd = null") confirm **null is a real state** (pricing not
  configured). The **prod type is wrong** → widen the row type to `margin_usd: number | null` (and
  confirm the component already renders the null path — it does; that's the feature). Correct fix in
  prod code, then the tests type-check unchanged.
- `Incidents.tsx:270` (1): `rowMenuOrNone: (i) => RowMenuItem[] | undefined` passed to DataTable's
  `rowMenu?: (row) => RowMenuItem[]`. "No menu for this row" is a real state. Fix = **widen the
  DataTable prop** to `rowMenu?: (row: Row) => RowMenuItem[] | undefined` and skip rendering the menu
  cell when the per-row result is empty/undefined. (Alternative: `rowMenuOrNone` returns `[]` — but
  widening the prop is the more honest contract.) **Small judgment call, touches the shared component.**

**Risk:** low, but E touches shared prod types → run the full suite.

### Class F — Test-file mock/fixture typing (26) — annotate/type fixtures, no product impact

| File | Lines | Pattern | Fix |
|---|---|---|---|
| `components/procurement.test.ts` | 180,189,203,213 (7) | `q()` factory returns an object literal not matching `Tables<'procurement_quotations'>` (missing/renamed fields) | type the factory param `Partial<Row>` and spread over a complete default row |
| `agentWriteActions.test.ts` | 326,404,453,510,677,727,769 (7) | `.some(([table]: [string]) => …)` — 1-tuple annotation vs mock's `any[]` predicate sig | drop the tuple annotation: `.some((call) => call[0] === 'crm_activities')` |
| `useBudget.test.ts` | 110,111,113 (3) | `invalidateSpy: ReturnType<typeof vi.spyOn>` → `mock.calls` is `any[]`, callback param implicit-any | annotate `(c: unknown[])` in the `.map`, or give `vi.spyOn` its generics |
| `procurementFiles.test.ts` | 168,268 (2) | `h.storageResult.value` inferred from 1st assignment → later `{data:null}` mismatches | type the harness `value` field explicitly (`{ data: X \| null; error: Y \| null }`) |
| `documents.storage.test.ts` | 176,215 (2) | same harness-inference issue (`file_path` string vs inferred null) | type `mockDocRow` as the Row / type the harness value |
| `ExecutiveDashboard.test.tsx` | 171,173 (2) | `let lastWinRateRange` reassigned inside a mock closure → CFA reports `never`/`null` at read | reassignment is via closure; read is fine at runtime — annotate the read or restructure the capture |
| `ViewBuilderPage.test.tsx` | 499 (1) | `mockUseUserViews.mockReturnValue({data:[…]})` infers `data: never[]` | type the mock's return as the hook's `UseQueryResult` shape (or cast the return to it) |
| `analytics/index.test.ts` | 34 (1) | `.map((c: unknown[]) => c[1])` vs mock-calls predicate sig | adjust annotation to the mock-calls element type |
| `handlerContext.test.ts` | 324 (1) | `insertedRow.scope.label` possibly undefined | assert-then-use (`expect(insertedRow.scope.label).toBe(…)`) or narrow |

**Risk:** none to product. Mechanical except the mock-return-type shapes (small judgment).

### Class G — e2e null-narrow (1)

`e2e/AC-AUTHF-020-invite-acceptance.spec.ts:38` — `inviteData!.user.id`; under strict `.user` (or the
already-`!`'d `inviteData`) still trips `Object is possibly null`. Fix = a **test assertion** that
narrows: `expect(inviteData?.user).toBeTruthy(); const userId = inviteData!.user.id;` — the assertion is
the runtime proof, keeping the (already-present) `!` honest. Prefer `expect(...).not.toBeNull()` over
adding *new* bare `!`. Mechanical, test-only.

### Class H — commit.ts guard gap (1) — defensive, borderline

`src/lib/import/procurementCycle/commit.ts:339` — in the unique-violation **catch**, the guard is
`table && recordImportKey ? findExistingRecord(table, procurementId, recordImportKey, importBatchId)`;
`importBatchId` is `string | undefined` but the param is `string`. The happy-path call at :305 is guarded
so importBatchId is defined there; the catch omits it. Practically the race path only runs in import mode
(importBatchId set), but TS can't prove it. Fix = **include it in the guard** (correct AND type-clean):
```ts
const raced = table && recordImportKey && importBatchId
  ? await skipLookup?.findExistingRecord(table, procurementId, recordImportKey, importBatchId)
  : null;
```
**Risk:** low; strictly narrows an already-safe path. **Judgment call — confirm `findExistingRecord`
should never be called without a batch id (it shouldn't).**

---

## Items needing a product/logic decision (surface to owner)

- **E (margin_usd / rowMenu):** widening prod types to admit `| null`/`| undefined` — confirm null margin
  = "pricing not configured" is the intended domain state (the tests say yes). Low-stakes; owner FYI.
- **A2 adapter vs. `rpcNullable` helper:** the tactical per-call cast unblocks now; the helper is a
  cleaner cross-cutting fix. Recommend shipping A2 casts, filing the helper as a follow-up.
- Everything else is mechanical or a local engineering judgment (no product decision).

**No error requires bending a test assertion to the app** — the BDD authoring rule is not implicated;
Class F/G fixes touch fixture *types*, never oracles.

---

## 4. Suggested execution split (parallel implementers, no collisions)

Each dispatch = its own `git worktree` off `dev` → feature branch → PR to `dev` (per CLAUDE.md
parallel-agent hygiene). Split by **directory** so no two agents touch the same file. **Order matters
only weakly** (these are type-only; pages don't import mapper *types* that change), so most can run
concurrently — but land the mapper PR first since it's the largest surface.

| # | Agent / bucket | Files | Errors | Model | Notes |
|---|---|---|---:|---|---|
| 1 | **DB-mapper RPC args (A)** | `src/lib/db/{procurementRecords,procurementLifecycle,timesheetTransition,projectTransitions,dashboard,timesheets}.ts` | 54 | sonnet | Land first. A1 mechanical; A2 needs the typed-args adapter pattern above. |
| 2 | **recharts + shared component (B, D-DataTable, E-Incidents)** | `pages/project-detail/ProjectSCurve.tsx`, `src/components/admin/AgentCostMetrics.tsx`, `src/components/ui/DataTable.tsx`, `pages/Incidents.tsx` | 8 | sonnet | DataTable prop-widen (E) + sort guard (D) in one PR (same file family). |
| 3 | **ProcurementDetails narrowing + useAssistantPanel guard (C, D-runtime)** | `pages/ProcurementDetails.tsx`, `src/hooks/useAssistantPanel.ts` | 3 | sonnet→opus | Judgment: CFA refactor + the real runtime null-guard. Run the affected tests. |
| 4 | **Test fixtures & mocks (F, G, E-Admin, H)** | the 9 `*.test.ts(x)` files + `e2e/AC-AUTHF-020…` + `commit.ts` | 29 | sonnet | All isolated; can be one agent or split db-tests vs page-tests. `Administration.usage.*` fix requires the E prod-type widen from bucket 2 — sequence bucket 2 before this file, or land the type-widen in bucket 4. |

**Collision note:** the `Administration.usage.*` tests (bucket 4) only go green once
`AdministrationUsage`'s row type is widened (bucket 2/E). Assign the `margin_usd: number | null` widen to
**whichever bucket owns the component file** and let the test agent rebase after. Keep `DataTable.tsx`
(buckets 2's D+E) out of any other agent's worktree.

---

## 5. Migration mechanics

**Flip `strict: true` all-at-once, in ONE PR that also lands all 94 fixes** — do **not** go per-flag.

- 93 of 94 errors are `strictNullChecks`-family; the other flags (`noImplicitAny` → the 3 TS7006,
  `strictFunctionTypes` → recharts) add trivially few. Splitting per-flag means multiple CI-red windows
  and re-reviewing the same files twice; the buckets above already partition the work cleanly for
  parallel agents landing on `dev` behind the flag flip.
- **Sequencing:** land buckets 1-4 as separate PRs to `dev` **with `strict` still off** (each is
  green under non-strict too — they're type-narrowings, not behavior changes), then a final tiny PR
  flips `"strict": true` in `tsconfig.json` once `npx tsc --noEmit --strict` is clean. That keeps every
  intermediate PR green under CI's current (non-strict) `verify` while assembling the fix, and the flag
  flip is a 1-line, instantly-verifiable change.
- **`// @ts-expect-error` scaffolding: avoid.** None of the 94 warrant it — every case has a real fix
  above (adapter, guard, annotation, or type-widen). A blanket `@ts-expect-error` sweep would rot (they
  don't fail-closed when the underlying code changes) and hide the Class D real bugs. The only sanctioned
  "silencer" is the **field-scoped, commented A2 args cast**, which is an annotation of provably-safe
  friction, not a bug mask.
- **`typescript` dependency stays regardless** — typescript-eslint's type-aware rules and the editor
  language service both need it even if the *build* type-check migrates to tsgo/TS7. Do not remove it.
- **CI:** once green, add `--strict` (or the flag in tsconfig) so `npm run typecheck` enforces it; the
  pre-push `npm run verify` then guards regressions. Consider gating the flip PR on a full
  `npm run verify` (typecheck+lint:ci+test+build) since it touches shared types.

### Post-migration verification (the flip PR)

```bash
cd pmo-portal
npx tsc --noEmit --strict 2>&1 | grep -c "error TS"   # → 0
npm run verify                                          # typecheck && lint:ci && test && build
```
