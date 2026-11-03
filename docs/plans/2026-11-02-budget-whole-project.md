# Plan: whole-project budgets with yearly spread to ERPNext v16 (#1472)

Spec: `docs/specs/budget-whole-project.spec.md` (owner decisions #1444, 2026-10-28/29). Builds on `budget-push-v16`,
`budget-fiscal-year-phasing`, `budget-versioning`; map in `docs/money-path-primer.md`. Money path: ERP push + predecessor
cancellation. Executor: Orca workers per `docs/orca-dispatch.md`; money slices Director-dispatched, one PR each.
Migration numbers used: **0500, 0501, 0502, 0503, 0504** (dev head is 0493). Each has `rollback/<NNNN>_<slug>_down.sql`.

## 0. Grounding: what ships today (file:line, read from this worktree)

| Fact | Where |
|---|---|
| v16 body: one Budget per account, `from_fiscal_year = to_fiscal_year = <year>`, `distribution_frequency: 'Monthly'`, `distribute_equally: 1`, `budget_amount` sent as a JS number | `pmo-portal/src/lib/adapterSeam/erpnext/bodies/budget.ts` `v16Bodies` (≈L133-160) |
| Two accounts for one category are refused (`commit-rejected`); the account map is `unique (org_id, erp_account)`, so "aggregate mapped categories per account" (FR-010) is a defensive no-op | `budgetAccountPlan.ts` `resolveV16BudgetAccounts` |
| Unit identity `<vid>:a:<len>:<fyToken>:<hexAccount>`; key `bud16:<identity>:<epoch>`; archive key `bud16-archive:…`; `isBudgetAccountPushKey` accepts any identity whose `parseBudgetIdentity(...).erpAccount !== null` | `budgetAccountIdentity.ts` |
| Served key guard routes `bud16:`/`bud16-archive:` to those predicates | `supabase/functions/adapter-dispatch/transitionTargetGuard.ts:293-296` |
| SQL twin of the identity | `budget_account_identity(uuid,text,text)` in `0293_budget_v16_accounts.sql`; used by `0379` and pinned by `supabase/tests/budget_v16_identity.test.sql` |
| Fan-out per fiscal year; `planBudgetAccountIntents` is year-filtered; mirror slots upserted on `(org_id,budget_version_id,fiscal_year,erp_account)` | `adapter-dispatch/index.ts` ≈L1040-1145; `budgetAccountPlan.ts` |
| Calendar-aware span, overlapping FYs refused, **open-ended project = start FY only** (matches owner ruling 1) | `pmo-portal/src/lib/budget/budgetGate.ts` `fiscalYearContaining`, `resolveSpanOrFailClosed` (≈L208-290) |
| Grain probe filters `account = X AND from_fiscal_year = <year>`; a single PMO-owned live occupant becomes `refs.self` and is **cancelled+amended** | `adapterSeam/erpnext/dispatchBudget.ts` `resolveBudgetRefs` (≈L190-330) |
| `activate_budget_version` archives the predecessor with a bare `update … status='Archived'`: **no cancel intent** | `0366_budget_travel_vehicle_categories.sql:214-257` (latest forward definition) |
| `archive_budget_version_with_cancel_intent` refuses when an Active successor exists and snapshots `fiscal_year` (no range) | `0387_budget_archive_cancel_intents.sql` (≈L85-190); fence `0388` |
| Sweep rebuilds identity from `job.fiscal_year` + account | `erpnext-sweep/index.ts` ≈L2188, 2343, 2374, 3748, 3887 |
| Inbound feed picks mirror table by `parseBudgetIdentity(...).erpAccount` | `_shared/erpnextFeedDeps.ts:113,134,158` |
| Mirror writer parses `record.outbox_identity` | `adapter-dispatch/readModelWriters.ts:950` |
| Editors = authorship for SoD; activation excludes editors unless sole operator | `0280_budget_version_editors.sql`, `0298` |
| `project_mapped_actuals(p_project_id, p_fiscal_year default null)` **already supports all years** (null) incl. attribution | `0376_cost_attribution.sql:459` |
| Line `fiscal_year` is nullable text on `budget_line_items` | `0153_budget_line_item_fiscal_year.sql` |
| Create is a direct insert (no RPC); clone is an RPC (latest def `0180`) | `pmo-portal/src/lib/db/budgets.ts:328-395` |
| Exact money helpers (bigint cents) | `pmo-portal/src/lib/exactDecimal.ts` `parseExactCents`/`formatExactCents` |

## 1. Design (decisions, one each)

1. **Mode** `budget_versions.budget_mode text not null default 'per_year' check in ('whole_project','per_year')`. Default `per_year` is the explicit
   historical backfill; `createBudgetVersion` sends `'whole_project'`. Immutable after Draft (trigger). `whole_project` lines must have `fiscal_year is null`.
2. **Distribution storage** (not in `budget_line_items`, NFR-001): `budget_distribution_plans` (1 row/version: method, budget-wide inputs, calendar
   `basis` witness) + `budget_year_distributions` (version × category × fiscal year, exact `numeric(14,2)`, method, `is_override`).
   Written only by `save_budget_distribution` (definer RPC, Draft-only, four write roles, stamps editor). No direct table writes.
3. **Who computes by-days:** the fiscal calendar lives in ERP, so the browser/edge computes with one shared pure module
   (`budgetDistribution.ts`, imported by UI and by `budgetGate.ts`); the DB enforces shape and exact reconciliation (per category
   Σ years = Σ lines). At activation precheck and again at push the gate recomputes the span from the live calendar and compares it to
   the stored `basis`; a difference = stale plan, refused, never silently re-spread (FR-016/022).
4. **ERP range unit** identity `<vid>:r:<lenFrom>:<fromTok>:<lenTo>:<toTok>:<hexAccount>`; key stays `bud16:<identity>:<epoch>` (so the served
   guard needs no change and `isBudgetAccountPushKey` works once `parseBudgetIdentity` understands `:r:`). A legacy `:a:` identity never parses as a range.
   Mirror gains nullable `to_fiscal_year` (null = legacy single year, `fiscal_year` = range start). Unique key unchanged: a version has one mode.
5. **Body (range):** `{company,budget_against:'Project',project,account,budget_amount:<number>,from_fiscal_year,to_fiscal_year,
   distribution_frequency:'Yearly', distribute_equally:0, budget_distribution:[…one row per year…], …applicable_on, …six action fields}`.
   ⚑ **Child-row field names are a hypothesis until Slice 1 freezes them** (spec checklist item 1). Hypothesis: rows
   `{start_date,end_date,amount,percent}` on child `budget_distribution`. No code in Slices 5+ may merge before Slice 1's spike doc exists.
6. **Grain probe for ranges:** list live/draft Budgets for `(company, project, account)` whose `[from_fiscal_year,to_fiscal_year]` **overlaps** the
   range (client-side date comparison via the version's calendar; ERP filters can't compare FY names). Rules: no occupant → create; exactly one live,
   PMO-owned, **identical range** → amend (revision); any other occupant (different range, per-year doc, draft rival, two live) → refuse
   `commit-rejected` naming it. A per-year predecessor is therefore never amended into a range doc; it must be cancelled first.
7. **Predecessor cancellation at activation:** extract the intent-insert half of `archive_budget_version_with_cancel_intent` into an internal
   helper `queue_budget_archive_cancel(version, actor, request_id)` (behaviour-preserving; existing pgTAP `budget_archive_cancel_intents.test.sql`
   proves it). `activate_budget_version` calls it for the Active predecessor when the org binding is v16, the predecessor has live ERP targets, and
   NOT (both whole-project with identical first/last year per `budget_distribution_plans.basis`). Intents snapshot `to_fiscal_year` too.
   Same transaction as the status flip; sweep (`budgetArchiveBackstop.ts`) drives cancellation unchanged.
8. **Ordering:** ERP refuses overlapping live Budgets, so range `ensure` units must not POST while the project has an unsettled cancel intent
   (`state in ('pending','held')`). Gate records units `pending` with a reason (not `failed`, not `commit-rejected`); the existing backstop
   (`budgetBackstop.ts`, `pending|failed` queue) re-drives them after settlement. A failed cancellation stays `held`/visible (FR-013, NFR-003).
9. **v15 / unsupported binding (FR-021):** whole-project push on `version_major = 15` (or unsupported) = explicit `commit-rejected`, no annual fallback.
   v15 body untouched (AC-017).
10. **Comparison (FR-015-018):** new read RPC `get_budget_comparison(p_project_id, p_fiscal_year default null)`; null = All years = Active category totals
    (Σ lines, once) vs `project_mapped_actuals(p_project_id, null)`; a year = approved yearly distribution (or legacy phased total) vs that year's actuals.
    Not folded into `get_budget_projection` (that carries ETC/EAC). Unknown stays `null`; `percent used` null on zero/absent budget.
11. **Other write entry points (FR-020):** import (`src/lib/import/budgetDescriptor.ts`) and CLI (`scripts/pmo.mjs`) insert versions without a mode, so they get
    `per_year` = their existing meaning; assert that in a test and add an explicit refusal if a caller passes `whole_project`.

## 2. Slice map

| # | Slice | Migration | Ships | PR |
|---|---|---|---|---|
| 1 | v16 yearly-distribution rehearsal spike (field contract) | none | docs + script only | batch with 2 |
| 2 | Pure `budgetDistribution.ts` (exact allocation, validation, span) | none | pure code | batch with 1 |
| 3 | Storage + roles: mode, plans/rows tables, `save_budget_distribution`, clone, activation validation | 0500, 0501 | **alone** (auth/SoD) | PR-A |
| 4 | Range identity + body + gate recompute + dispatch fan-out + sweep + feed + mirror writer + status | 0502 (mirror/intent range columns, SQL identity, status, `record_outbox_ref`) | **alone with 5** (money) | PR-B |
| 5 | Predecessor cancellation at activation + ordering hold | 0503 | **alone with 4** (money) | PR-B |
| 6 | Repository/hooks + authoring UI (mode, totals, distribution grid, readiness, stale banner) | none | batch | PR-D |
| 7 | All-years comparison RPC + Forecast scope selector | 0504 | batch with 6 | PR-D |
| 8 | Curated e2e AC-018 + isolated ERP rehearsal evidence | none | alone (release evidence) | PR-E |

Order: 1 → 2 → 3 → 4+5 → (6, 7) → 8. Slices 4 and 5 form one indivisible money PR, after 1 and 3. Until that PR lands, all entry points must refuse whole-project activation and dispatch; test this deployment fence in Slice 3. Remove the fence atomically with Slice 4+5. All branch off `origin/dev`; rebase translation files (`public/locales/en` + `id`) right before each PR.

---

## Slice 1: rehearsal spike — freeze the v16 yearly body

Files: `docs/spikes/2026-11-02-erpnext-v16-budget-yearly-distribution.md` (new), `scripts/bv16-rehearsal.mjs` (extend), `scripts/bv16-rehearsal.test.mjs`.
Rules: rehearsal copy only, rolled back; never print credentials/hostnames (the script already reads config from FD3).

- [x] 1.1 **Failing test first** (`scripts/bv16-rehearsal.test.mjs`): `buildRangeProbeBody({from:'FY-A',to:'FY-C',years:['FY-A','FY-B','FY-C'],amounts:['100.00','0.00','200.00']})` returns yearly amounts that sum to `budget_amount` and keeps the zero year. The failing import was observed before implementation.
- [x] 1.2 Add `buildRangeProbeBody` and materialize the v16 date rows from Fiscal Year records; test the routed runner and cleanup behavior.
- [ ] 1.3 **Director-run pending.** Use `scripts/with-erpnext-lock.sh node scripts/bv16-rehearsal.mjs --config-fd 3 --range-probe`. The script version-checks first, creates a run-owned Project, reads the three Fiscal Year dates, inserts a `Yearly` range draft, writes the explicit rows, submits and reads them back, tests percent-driven recalculation and overlap in both orders, then cancels submitted Budgets. Record live field acceptance, zero-year survival, amount/percent rounding, recalculation behavior, and both overlap results in `docs/spikes/2026-11-02-erpnext-v16-budget-yearly-distribution.md`. Do not infer a workaround if the real copy differs; take the observed contract to the owner before Slice 4.
- Verify: `node --test scripts/*.test.mjs`. Evidence goes in the PR body.
- Covers: NFR-006 first clause, FR-011 field contract. Gates Slice 4 and AC-018.

## Slice 2: pure distribution module

Files: `pmo-portal/src/lib/budget/budgetDistribution.ts` (new), `…/budgetDistribution.test.ts` (new). Owns AC-002, AC-003, AC-004.

- [ ] 2.1 **Failing tests** (`vitest`, all titles prefixed `budget-whole-project AC-###`):

```ts
import { describe, it, expect } from 'vitest';
import { allocate, byDays, yearsInSpan, fromPercents, fromAmounts, type FiscalYearSpan } from './budgetDistribution';

const cal = (rows: [string, string, string][]): FiscalYearSpan[] => rows.map(([name, start, end]) => ({ name, start, end }));
const CAL = cal([['2027', '2027-01-01', '2027-12-31'], ['2028', '2028-01-01', '2028-12-31']]);

describe('budget-whole-project', () => {
  it('AC-002 by-days over a year boundary: 300 minor units split 100/200', () => {
    const years = yearsInSpan('2027-12-31', '2028-01-02', CAL);
    expect(byDays('3.00', '2027-12-31', '2028-01-02', years).map((r) => r.amount)).toEqual(['1.00', '2.00']);
  });
  it('AC-003 leap day + non-calendar FY + remainder goes to the largest fraction', () => {
    const fy = cal([['FY27', '2027-03-01', '2028-02-29'], ['FY28', '2028-03-01', '2029-02-28']]);
    const years = yearsInSpan('2028-02-28', '2028-03-01', fy); // 2 days in FY27, 1 in FY28
    expect(byDays('10.00', '2028-02-28', '2028-03-01', years).map((r) => r.amount)).toEqual(['6.67', '3.33']);
  });
  it('AC-003 single-day project lands entirely in one year', () => {
    const years = yearsInSpan('2027-06-01', '2027-06-01', CAL);
    expect(byDays('5.00', '2027-06-01', '2027-06-01', years).map((r) => r.amount)).toEqual(['5.00']);
  });
  it('AC-003 exact tie breaks to the earlier fiscal year start', () => {
    expect(allocate(101n, [1n, 1n]).map(String)).toEqual(['51', '50']);
  });
  it('AC-003 no end date uses only the start fiscal year', () => {
    expect(yearsInSpan('2027-06-01', null, CAL).map((y) => y.name)).toEqual(['2027']);
  });
  it('AC-004 percentages 0/40/60 keep the zero year', () => {
    const years = cal([['A', '2026-01-01', '2026-12-31'], ['B', '2027-01-01', '2027-12-31'], ['C', '2028-01-01', '2028-12-31']]);
    const r = fromPercents('10.00', ['0', '40', '60'], years);
    expect(r.ok && r.rows.map((x) => x.amount)).toEqual(['0.00', '4.00', '6.00']);
  });
  it('AC-004 amounts must equal the category total; negative / non-finite are named', () => {
    const years = cal([['A', '2026-01-01', '2026-12-31'], ['B', '2027-01-01', '2027-12-31']]);
    expect(fromAmounts('10.00', ['4.00', '5.00'], years)).toMatchObject({ ok: false, errors: [{ code: 'sum-mismatch' }] });
    expect(fromAmounts('10.00', ['-1.00', '11.00'], years)).toMatchObject({ ok: false, errors: [{ year: 'A', code: 'negative' }] });
    expect(fromAmounts('10.00', ['x', '10.00'], years)).toMatchObject({ ok: false, errors: [{ year: 'A', code: 'invalid' }] });
  });
  it('AC-004 budget-wide amounts become proportions for categories with another total', () => {
    const years = cal([['A', '2026-01-01', '2026-12-31'], ['B', '2027-01-01', '2027-12-31']]);
    expect(fromAmounts('20.00', ['4.00', '6.00'], years, { proportional: true })).toMatchObject({ ok: true });
  });
});
```
  Run `cd pmo-portal && npx vitest run src/lib/budget/budgetDistribution.test.ts` → red (module missing).
- [ ] 2.2 Implement (all arithmetic in bigint cents; no floats; dates via strict validated civil dates and `Date.UTC`, timezone-free):

```ts
import { parseExactCents, formatExactCents } from '../exactDecimal.ts';

export interface FiscalYearSpan { name: string; start: string; end: string }
export interface YearAmount { year: string; amount: string }
export type DistributionError = { year?: string; code: 'invalid' | 'negative' | 'missing' | 'out-of-range' | 'sum-mismatch' };
export type DistributionResult = { ok: true; rows: YearAmount[] } | { ok: false; errors: DistributionError[] };

const day = (iso: string): number => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`bad civil date ${iso}`);
  return Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86_400_000;
};

/** Largest-remainder allocation. Ties go to the lower index (calendar order = fiscal-year start). Zero weights stay zero. */
export function allocate(total: bigint, weights: bigint[]): bigint[] {
  const sum = weights.reduce((a, b) => a + b, 0n);
  if (sum <= 0n) throw new Error('allocate: weights sum to zero');
  const out = weights.map((w) => (total * w) / sum);
  const rem = weights.map((w) => (total * w) % sum);
  let left = Number(total - out.reduce((a, b) => a + b, 0n));
  const order = weights.map((_, i) => i).filter((i) => weights[i] > 0n)
    .sort((a, b) => (rem[a] === rem[b] ? a - b : rem[a] > rem[b] ? -1 : 1));
  for (let k = 0; left > 0; k++, left--) out[order[k]] += 1n;
  return out;
}

/** Every fiscal year intersecting the span, date order. No end date => the year containing the start only (owner ruling 1). */
export function yearsInSpan(start: string, end: string | null, calendar: readonly FiscalYearSpan[]): FiscalYearSpan[] {
  const sorted = [...calendar].sort((a, b) => (a.start < b.start ? -1 : 1));
  if (end === null) return sorted.filter((y) => y.start <= start && start <= y.end).slice(0, 1);
  return sorted.filter((y) => y.start <= end && y.end >= start);
}

export function byDays(total: string, start: string, end: string | null, years: readonly FiscalYearSpan[]): YearAmount[] {
  const cents = parseExactCents(total);
  if (cents === null || cents < 0n) throw new Error('byDays: invalid total');
  const spanEnd = end ?? years[years.length - 1].end;
  const days = years.map((y) => BigInt(Math.max(0, Math.min(day(y.end), day(spanEnd)) - Math.max(day(y.start), day(start)) + 1)));
  return allocate(cents, days).map((c, i) => ({ year: years[i].name, amount: formatExactCents(c) }));
}
```
  `fromPercents(total, inputs, years)`: parse each input with `/^\d+(\.\d{1,4})?$/` into 1e-4 units (`invalid`/`negative`/`missing` errors per year; count must equal `years.length`, else `out-of-range`), require Σ = 1_000_000 (`sum-mismatch`), then `allocate(totalCents, weights)`. `fromAmounts(total, inputs, years, {proportional?})`: parse via `parseExactCents`; without `proportional` require Σ = total (`sum-mismatch`); with it use amounts as weights (owner ruling 2: budget-wide amounts become percentages of their own total), error if Σ = 0.
  Run the test → green.
- [ ] 2.3 Mutation check: change the tie sort to `b - a`; the AC-003 tie test must go red; restore.
- [ ] 2.4 Gate: `cd pmo-portal && npm run typecheck && npx eslint --max-warnings=0 src/lib/budget/budgetDistribution.ts src/lib/budget/budgetDistribution.test.ts && npm run check:guards`.

## Slice 3: storage, roles, clone, activation validation — migrations 0500, 0501 (PR-A, alone)

Read first: `0005`, `0180` (clone), `0271`, `0280`, `0298`, `0137` (service_role grants), `0178` (anon-executable allow-list), `0293` (RLS pattern). Re-read definitions with `pg_get_functiondef` at implementation time.

**0500_budget_whole_project_schema.sql** (`rollback/0500_budget_whole_project_schema_down.sql`):

```sql
alter table public.budget_versions
  add column budget_mode text not null default 'per_year'
  check (budget_mode in ('whole_project','per_year'));

create table public.budget_distribution_plans (
  budget_version_id uuid primary key references public.budget_versions(id) on delete cascade,
  org_id uuid not null default public.auth_org_id()
    references public.organizations(id) on delete cascade,
  method text not null check (method in ('by_days','percent_by_year','amount_by_year')),
  inputs jsonb not null default '{}'::jsonb,   -- budget-wide year -> entered value (text)
  basis jsonb not null,                        -- {projectStart, projectEnd|null, years:[{name,start,end}]}
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
create table public.budget_year_distributions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default public.auth_org_id()
    references public.organizations(id) on delete cascade,
  budget_version_id uuid not null references public.budget_versions(id) on delete cascade,
  category public.budget_category not null,
  fiscal_year text not null check (fiscal_year <> ''),
  ordinal integer not null check (ordinal >= 0),
  amount numeric(14,2) not null check (amount >= 0),
  method text not null check (method in ('by_days','percent_by_year','amount_by_year')),
  is_override boolean not null default false,
  unique (budget_version_id, category, fiscal_year)
);
-- RLS: select for active org members; no authenticated writes (definer RPC only); service_role all (0137 pattern)
-- both tables: enable + force RLS, stamp_org_id trigger, revoke all from anon, grant select to authenticated.
-- triggers: (a) budget_mode immutable when old.status <> 'Draft'; (b) whole_project line fiscal_year must be null.
```
  Rollback refuses (raise exception) if any `whole_project` version or distribution row exists; otherwise drops the objects and column.

**0501_budget_distribution_rpc.sql** (until PR-B, reject whole-project activation and dispatch despite a valid distribution): `save_budget_distribution(p_version uuid, p_method text, p_inputs jsonb, p_basis jsonb, p_rows jsonb) returns void`, definer, `set search_path = public, pg_temp`:
auth gate identical to `activate_budget_version` (four roles, `is_active_member()`, version org = `auth_org_id()`, project org match); version must be `Draft` and `whole_project`; rows validated: no duplicate (category, year), years ⊆ `basis.years`, amounts ≥ 0, every category with source lines, including a zero total, has exactly one row per basis year, and Σ years = Σ lines (`numeric`, exact) — failures raise `P0001` with the category name; delete+insert both tables in one statement block; `insert into budget_version_editors … on conflict do nothing` (authorship). Also `budget_distribution_gaps(p_version uuid) returns setof text` (stable, invoker) reused by activation. `clone_budget_version` replaced (copy the current body, add): copies `budget_mode`, plan and rows. `activate_budget_version` replaced (copy the current `0366` body verbatim; add): when `budget_mode = 'whole_project'`, raise `P0001` if `budget_distribution_gaps` is non-empty. Re-issue `revoke … from public, anon` / `grant execute … to authenticated` for each; update the `0178` allow-list test only if the anon-executable count moves (it must not).

pgTAP (write first; `supabase/tests/`; `begin; … rollback;`, namespaced UUIDs, `select finish();`):
- `budget_whole_project_storage.test.sql` — **AC-007**: save → reload equals; clone copies mode/plan/rows/is_override; second save replaces atomically (no duplicates); a row set that misses a year or does not sum fails and leaves the prior plan intact.
- `budget_whole_project_roles.test.sql` — **AC-008**: roles Viewer/Employee refused; other-org version refused; Active/Archived refused; direct `insert/update` on both tables as `authenticated` refused; editor row stamped; drafter or editor cannot activate; distinct eligible activator can; sole-operator exception still works; activation with a non-reconciling plan refused.
- `budget_whole_project_compatibility.test.sql` — **AC-011**: pre-existing versions read `per_year`, lines/`fiscal_year`/mirror rows/identities unchanged; `activate` on a `per_year` version behaves as before.
Mutation: replace the Σ check with `true` in the RPC → the AC-007 mismatch test must go red; restore.
Verify (one lock hold): `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/budget_whole_project_storage.test.sql supabase/tests/budget_whole_project_roles.test.sql supabase/tests/budget_whole_project_compatibility.test.sql supabase/tests/budget_archive_cancel_intents.test.sql supabase/tests/budget_sole_operator.test.sql supabase/tests/budget_second_activator.test.sql'`. Grep output for `Parse errors`. Also run the 0136/0137/0178 guards' files. Regenerate types: update `database.types.ts` for the new tables/columns/RPCs (hand-edit minimal, or the repo's generator).

## Slice 4: range identity, body, gate, fan-out, sweep, feed, mirror — migration 0502 (PR-B, together with Slice 5)

Precondition: Slice 1 spike doc exists and design 5 matches it.

**0502_budget_range_units.sql** (+rollback, refuses when any non-null `to_fiscal_year` row exists or an unsettled range command is pending):
`alter table budget_version_account_erp_mirror add column to_fiscal_year text;` same on `budget_archive_cancel_intents`; `budget_account_identity(uuid,text,text,text)` 4-arg overload producing the `:r:` form (immutable, invoker, anon cannot execute); `get_budget_push_status` and `budget_push_mirror_rows` expose `to_fiscal_year`; `record_outbox_ref` (0293/0379 logic) matches `(version, fiscal_year, to_fiscal_year, account)` identity: legacy rows keep the 3-arg form, range rows the 4-arg form. Pin with `supabase/tests/budget_v16_identity.test.sql` additions (range bytes equal the TS output; the 3-arg result is unchanged — AC-011/010).

TS tasks, each test-first (vitest unless noted; Deno tests import the shipped handler and mock `globalThis.fetch`):
- [ ] 4.1 `budgetAccountIdentity.test.ts`: `budgetRangeIdentity(vid,'FY/2026:','FY2028','Salary: α')` round-trips through `parseBudgetIdentity` to `{fiscalYear, toFiscalYear, erpAccount}`; a legacy `:a:` identity parses with `toFiscalYear: null`; empty tokens rejected; chronological order validated against fiscal-year dates (names are opaque); `isBudgetAccountPushKey('bud16:'+rangeIdentity+':1700000000000')` true. Implement `budgetRangeIdentity`, extend `BudgetIdentity` with `toFiscalYear: string | null`, `parseBudgetIdentity` branch `rest.startsWith('r:')`, canonical re-encode check as the `a:` branch does. Check the key length against the guard's limit: add a test with a 140-char account.
- [ ] 4.2 **AC-009** `bodies/budget.v16.test.ts`: two years × two categories → exactly one body per account, `from_fiscal_year`≠`to_fiscal_year`, `distribution_frequency: 'Yearly'`, `distribute_equally: 0`, yearly rows sum to `budget_amount`, a zero year retained, no `Monthly`, still sends all six `action_if_*` and `applicable_on_*`. Implement `v16RangeBody` in `bodies/budget.ts`; record carries `to_fiscal_year` + `year_amounts: {year, amount}[]`. Header amount is `Number(...)` as today; yearly cell amounts are asserted by exact-cents sum before conversion (throw `commit-rejected` on mismatch).
- [ ] 4.3 **AC-017** `bodies/budget.test.ts`: the v15 body for an annual fixture is byte-identical to today's (snapshot copied from the current test); a whole-project record on a v15 binding throws `commit-rejected` with an "unsupported" message and issues no ERP call.
- [ ] 4.4 `budgetAccountPlan.test.ts`: `planRangeAccountIntents(range, desired, prior)` → `ensure` for each desired account; `remove` only for a PMO-witnessed live prior of the **same range** whose account is no longer desired; prior docs of other ranges never become predecessors (they are the cancel-intent path).
- [ ] 4.5 `dispatchFactory.budgetRecovery.test.ts` (extend): range grain probe — per-year occupant, different range, draft rival, two live → each refuses with a named message and zero writes; identical-range PMO-owned live → amend path; none → create. Implement in `dispatchBudget.ts` `resolveBudgetRefs` (overlap computed with the calendar; the filter list uses `account` + `project` + `company` only, never `fiscal_year`).
- [ ] 4.6 **AC-016** `budgetGate.fiscalYear.test.ts`: whole-project plan with a changed project end date, a missing calendar year, or an ambiguous calendar → readiness finding `budget-distribution-stale` / unresolved; ERP outage stays informational at precheck (FR-007) but refuses at push; no distribution mutated. Implement in `budgetGate.ts` (reads plan + rows via new deps, recomputes `yearsInSpan` and compares `basis`). Parity test: `yearsInSpan` equals `inSpanFYNames` of `resolveSpanOrFailClosed` on the shared fixtures.
- [ ] 4.7 **AC-010** `adapter-dispatch/budgetV16Replay.test.ts` (Deno, shipped handler + mocked fetch): range activation, interrupted after create/before finalize, retried and swept → one ERP create, same `bud16:…:r:…` key, mirror row keyed `(version, from, account)` with `to_fiscal_year`; a legacy annual mirror/ref for the same account is **not** adopted. Implement the range branch in the fan-out in `adapter-dispatch/index.ts` (one unit per account; slots upserted with `to_fiscal_year`), `readModelWriters.ts:950` (identity → mirror columns), `erpnextFeedDeps.ts:113-158` (scope by `to_fiscal_year`), `erpnext-sweep/index.ts` (≈2188, 2343, 2374, 3748, 3887: identity from `(from,to)` when `job.to_fiscal_year` is set), and the sweep's budget list fields (`budgetFromDocFields` already requests `from/to_fiscal_year`).
- [ ] 4.8 `budgetV16Partial.test.ts` (extend): one account fails, others succeed → worst-state status names the account; retry re-sends only the failed account (FR-012, NFR-003).
- [ ] 4.9 Mutation checks: (a) make `parseBudgetIdentity` accept `:a:` as a range → 4.1/4.7 red; (b) make the probe treat any occupant as `refs.self` → 4.5 red; (c) sum rows without the cents check → 4.2 red. Restore each.
- Gate: `npm run check:guards`, `npm run typecheck`, eslint on touched files, touched vitest files, `scripts/deno-test-edge-fns.sh` for `adapter-dispatch`, `erpnext-sweep`, `_shared`; pgTAP under `with-db-lock.sh` (reset+test one hold): `budget_v16_identity`, `budget_v16_accounts`, `budget_v16_status`, `budget_v16_fresh_ref`, `budget_v16_ref_handoff`, `budget_v16_rollback`, `budget_erp_mirror_rls`.

## Slice 5: predecessor cancellation at activation + ordering hold — migration 0503 (PR-B, together with Slice 4)

**0503_budget_activation_cancels_predecessor.sql** (+rollback restoring the 0501 `activate_budget_version` and the 0387 archive body):
1. `queue_budget_archive_cancel(p_version uuid, p_actor uuid, p_request uuid) returns jsonb` (definer, internal; `revoke all from public, anon, authenticated`) = the request + intents + mirror `remove` marking block of `archive_budget_version_with_cancel_intent`, copying `to_fiscal_year`. The archive RPC now calls it; behaviour identical.
2. `activate_budget_version`: after the existing `Archived` flip, for the predecessor: if binding major = 16 and the predecessor has live `ensure` targets for its `activated_at` and NOT (both `whole_project` with equal first/last `basis.years` names) → call the helper with `cancel_erp = true`. Same transaction; failure rolls back activation.

Tests (write first):
- [ ] 5.1 **AC-012** extend `supabase/tests/budget_archive_cancel_intents.test.sql`: per-year Active predecessor with two live targets → activation of a whole-project successor creates one request + two intents (exact `erp_budget_name`, `fiscal_year`), predecessor mirror rows `remove/pending`, successor Active; identical-range whole-project predecessor → no intents (amend path); v15 binding → none; a `held`/`failed` intent keeps predecessor lifecycle fenced (0388) and is listed by the status read; the existing archive tests stay green.
- [ ] 5.2 Deno `adapter-dispatch/budgetV16Replay.test.ts`: with an unsettled intent on the project, range units are recorded `pending` with reason "waiting for predecessor cancellation", zero ERP creates, response 202-class (not 422); after the intent is `complete`, the sweep backstop drives them once. Implement the check in the gate section of `adapter-dispatch/index.ts` (new `BudgetGateError` code `budget-predecessor-cancel-pending`; `recordBudgetGateFailure` writes `pending` for that code, not `failed`).
- [ ] 5.3 Mutation: drop the helper call from activation → 5.1 red; drop the hold → 5.2 red.
- Verify: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/budget_archive_cancel_intents.test.sql supabase/tests/budget_sole_operator.test.sql supabase/tests/budget_second_activator.test.sql supabase/tests/budget_whole_project_roles.test.sql'` and the Deno tests above.

## Slice 6: repository, hooks, authoring UI (PR-D)

Files: `src/lib/db/budgets.ts`, `src/lib/repositories/budget.ts` + `contracts/budget.ts`, `src/hooks/useBudget.ts`, `pages/ProjectBudget.tsx`, `pages/project-detail/tabs/BudgetTab.tsx`, new `src/components/budget/DistributionGrid.tsx`, `public/locales/{en,id}/*.json`. Design tokens only; existing primitives (`SelectField`, `TextField`, `FormGrid`, `FieldError`, `ConfirmDialog`).

- [ ] 6.1 **AC-001** `pages/ProjectBudget.test.tsx`: a new budget is created with `budget_mode: 'whole_project'`, by-days selected, and the category totals form has no fiscal-year control. Implement: `createBudgetVersion` sends `budget_mode: 'whole_project'` (import path passes none, test asserts); lines created in this mode send `fiscal_year: null`.
- [ ] 6.2 **AC-005** same file: budget-wide method + one category override render "inherited"/"overridden"; budget-wide amounts are converted to proportions and allocated to each inheriting category; a category override must sum to its own total.
- [ ] 6.3 **AC-006** same file: incomplete year, out-of-span year, negative/non-finite, % ≠ 100, amounts ≠ total → the field is named, entered values preserved, `Activate` blocked, totals unchanged.
- [ ] 6.4 Preview grid (FR-004): category totals + year × category grid, yearly sums equal totals, method labels; keyboard reachable, labelled. Repository: `saveDistribution(versionId, plan)` → `save_budget_distribution` (never sends `org_id`); `getDistribution(versionId)`. Preview is computed by `budgetDistribution.ts` from the precheck's calendar (extend `runBudgetActivationPrecheck` result to carry `fiscalYears` with dates, not only `fiscalYearNames`; update `budgetGate.activationPrecheck.test.ts`). Save happens on "Confirm distribution"; activation requires a saved plan whose `basis` matches the live one.
- [ ] 6.5 Stale banner (owner ruling 3, FR-022): when project dates/calendar differ from the Active plan's `basis`, show "the project now runs to <date>; this budget covers <years>" with a "Prepare new draft" action = `cloneVersion` (copies lines + method) then re-preview; nothing is pushed or mutated on read.
- [ ] 6.6 Mode switch (FR-019): a Draft can switch mode only through explicit preview; clone preserves mode. Disabled controls on Active/Archived (FR-009).
- [ ] 6.7 `can()`/`usePermission` gating on every affordance; `scripts/pmo.mjs` refuses `whole_project` explicitly (extend `cliParity.test.ts`).
- Gate: `npm run typecheck`, eslint on touched files, touched vitest files plus sibling suites that mock these modules (`grep -rl "repositories/budget\|useBudget" pmo-portal --include=*.test.tsx`), `scripts/ux-proof.sh` on the project budget route, i18n keys in **both** locales.

## Slice 7: all-years comparison — migration 0504 (PR-D)

**0504_budget_comparison.sql** (+rollback = `drop function`): `get_budget_comparison(p_project_id uuid, p_fiscal_year text default null) returns table(category budget_category, budget_total numeric, recorded numeric, recorded_as_of timestamptz, mapped boolean, has_ledger boolean, remaining numeric, percent_used numeric)`, `stable`, `security invoker`, `set search_path = public, pg_temp`, `revoke from public, anon`, `grant to authenticated`. Null year: `budget_total` = Σ Active-version lines per category (counted once); `recorded` from `project_mapped_actuals(p_project_id, null)` (already generation-correct, attribution included). With a year: whole-project version → `budget_year_distributions.amount`; per-year version → the existing phased total. Server aggregation only (NFR-005); `remaining` null when budget or ledger unknown; `percent_used` null when budget or ledger unknown or budget = 0; a known zero distribution is `0`, absent is `null`.

- [ ] 7.1 **AC-014** `supabase/tests/budget_whole_project_comparison.test.sql`: ledger across two years in the current snapshot → totals counted once, recorded not doubled, remaining = total − recorded (not EAC); an older snapshot generation ignored; unmapped category → `mapped=false`, nulls; other org sees nothing; > 1000 category-year inputs not truncated (the RPC returns ≤ one row per category).
- [ ] 7.2 **AC-013/015** `pages/BudgetProjection.test.tsx`: multi-year project opens on `All years (project to date)`, can switch to a year, scope label visible; single-year project keeps its default; zero vs unknown vs unmapped vs missing-ledger render distinctly with provenance, no invented percent. Implement via `fetchBudgetComparison` in `src/lib/repositories/budgetProjection.ts`, scope select in `pages/BudgetProjection.tsx`, pure mapping in `src/lib/budget/budgetProjection.ts`. ETC/EAC columns stay on the per-year view only.
- Verify: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/budget_whole_project_comparison.test.sql supabase/tests/budget_projection_rpc.test.sql supabase/tests/budget_v16_projection.test.sql'`; `npx vitest run pages/BudgetProjection.test.tsx src/lib/budget/budgetProjection.test.ts`; `scripts/ux-proof.sh` on Forecast.

## Slice 8: curated journey + isolated ERP rehearsal (PR-E)

- [ ] 8.1 **AC-018** `pmo-portal/e2e/serial/AC-018-budget-whole-project.spec.ts` (read `docs/e2e-parallel-conventions.md`; tag `@e2e-isolation`; no `process.env.CI` gating): annual Active predecessor with ERP targets → Draft in whole-project mode → preview grid → eligible second approver activates → asserts against the ERP fixture's returned documents: one Budget per account with the right `from/to_fiscal_year`, yearly rows, total, predecessor docs `docstatus 2`, and Forecast shows approved totals vs recorded. Asserts documents, not the toast.
- [ ] 8.2 Director-run rehearsal on the v16 copy using `scripts/bv16-rehearsal.mjs` with the shipped builder output (as AC-BV16-008 did); evidence in the PR body.
- Verify: `scripts/e2e-local.sh AC-018` (browser e2e runs on the PR to main per the 2026-10-30 rule; this local run is diagnosis/evidence).

## 3. Traceability (AC → one owning layer)

| AC | Layer | Test | Slice |
|---|---|---|---|
| 001 | unit | `pages/ProjectBudget.test.tsx` | 6 |
| 002, 003, 004 | unit | `src/lib/budget/budgetDistribution.test.ts` | 2 |
| 005, 006 | unit | `pages/ProjectBudget.test.tsx` | 6 |
| 007 | pgTAP | `budget_whole_project_storage.test.sql` | 3 |
| 008 | pgTAP | `budget_whole_project_roles.test.sql` | 3 |
| 009 | unit | `bodies/budget.v16.test.ts` | 4 |
| 010 | Deno unit | `adapter-dispatch/budgetV16Replay.test.ts` | 4 (hold: 5) |
| 011 | pgTAP | `budget_whole_project_compatibility.test.sql` | 3 (+4 identity) |
| 012 | pgTAP | `budget_archive_cancel_intents.test.sql` | 5 |
| 013, 015 | unit | `pages/BudgetProjection.test.tsx` | 7 |
| 014 | pgTAP | `budget_whole_project_comparison.test.sql` | 7 |
| 016 | unit | `src/lib/budget/budgetGate.fiscalYear.test.ts` | 4 |
| 017 | unit | `bodies/budget.test.ts` | 4 |
| 018 | e2e | `e2e/serial/AC-018-budget-whole-project.spec.ts` | 8 |
Non-AC proofs: FR-007 outage-informational → `budgetGate.activationPrecheck.test.ts` (6.4); FR-020 entry points → `cliParity.test.ts` + import descriptor test (6.7); FR-021 → 4.3; NFR-005 → 7.1; NFR-006 rehearsal → Slice 1 + 8.2.

## 4. What ships alone

PR-A (3: auth/SoD), PR-B (4+5: indivisible money push and cancellation), PR-E (8). Batchable: PR-D (6+7, UI + read-only RPC), and Slices 1+2 as one pure/docs PR. Each money PR: Sol review, the mutation checks above, served-handler tests against the frozen body. Dev PRs run `verify` + `pgtap`; browser e2e on the release PR. No push to `dev` while a release PR's CI runs.

## 5. Open questions and the default taken

1. **Yearly child-row field names / `Yearly` frequency behaviour.** Default: hypothesis in design 5; Slice 1 freezes it; Slice 4 blocked until then.
2. **Range changes on a live whole-project budget (same mode, different range).** Default: treated like a per-year predecessor (cancel via intents, new range created); identical range = amend in place.
3. **When is the plan saved?** Default: on "Confirm distribution" in the Draft; activation requires a saved, non-stale plan (no auto-save of an unreviewed proposal).
4. **Category with zero total.** Default: persist zero rows for every in-range year for a category with an explicit zero total, preserving known zero in comparison; do not push a zero account. Otherwise a manager viewing a year sees unknown instead of the explicitly approved zero.
5. **Percent precision.** Default: up to 4 decimals, Σ exactly 100.
6. **Cancellation failure policy.** Default: successor stays Active in PMO, range units `pending` with the visible reason until intents settle; operator retries/releases through the existing held-intent recovery. No automatic forced create.
7. **Server cannot recompute by-days (calendar is in ERP).** Default: DB enforces shape + exact sums; gate enforces calendar/basis freshness at precheck and push.

## 6. What #1473 (paste rows) needs from this plan

- Pasted lines go to the selected Draft through `repositories.budget.createLineItem` with `fiscal_year` null. In a `whole_project` Draft that is now the only valid shape; the 0500 trigger rejects a phased line, so paste must not set `fiscal_year` (matches paste FR-009).
- After a paste changes category totals, any saved distribution no longer reconciles. Slice 3 makes that visible (`budget_distribution_gaps`), and Slice 6 shows "re-spread needed"; paste should call the same "invalidate/preview again" hook rather than editing distribution rows. Land Slice 3 + 6.1 before #1473 so paste targets the final line shape.
- Paste does not touch mode, distribution or activation; no migration from #1473.

## 7. Spec corrections found while grounding (for the owner/Director)

1. FR-013/AC-012 specify the future cancellation outcome; they do not claim the activation path already provides it. The latest forward activation definition is `0366` (not `0298`); Slice 5 implements the specified transition using the archive-cancel workflow.
2. FR-010 is amended in the spec to preserve the shipped shared-account refusal; aggregation must not imply changing that rule.
3. The existing grain probe is account/start-year based and a PMO-owned live occupant can enter the amend path. The spec now explicitly requires range-aware matching; Slice 4.5 covers it.
4. AC-016 specifies future behavior, not an existing calendar-date return. Precheck currently returns names; Slice 6.4 extends it to return dates.
5. All-years actuals already have a nullable-year source in `0376:459`; the spec never claims otherwise. Slice 7 adds the comparison read, not a second ledger source.
6. A new prefix is not required if the existing key guard accepts the canonical range identity; prove this in served-handler tests. SQL and sweep need matching range identities.

## 8. Money-path review gates (2026-11-02)

- **Deployment and concurrency:** PR-A must refuse whole-project activation and push on every entry point until PR-B atomically enables both range dispatch and predecessor cancellation. Lock the project and predecessor during activation, serialize concurrent activation/dispatch/cancellation, and fence outstanding predecessor commands before snapshotting targets. A mirror-only snapshot is insufficient while a create can still be in flight: reconcile to a confirmed exact ERP target or hold; never start successor creates on an inconclusive probe. Test interleavings in a real concurrent harness, not only single-session pgTAP.
- **Recovery:** bind stable outbox identity and request IDs to the approved activation and immutable payload; test simultaneous foreground/sweep, timeout after ERP create, lost finalize, stale generation and repeated cancel after timeout. An inconclusive recovery holds without a second POST; stale claimants cannot mint a second document. Cancel only the witnessed exact predecessor; verify ERP cancellation before settling. A superseded intent is not proof of cancellation: hold successor until its live-target absence is positively established. Cancellation and create failures remain visible and retryable without duplicate documents.
- **Same-range revisions:** prove same-range amend ownership and recovery across cancel/create interruption, changed or removed accounts, and concurrent retries; do not use identical endpoints alone as ownership proof. Preserve and fence prior outbox generations. ERP coverage during cancellation-to-create is an operational gap to show visibly; do not report the transition complete until all required accounts settle.
- **Rollback:** every down migration checks for whole-project versions, range mirrors, references, live or unsettled outbox commands and archive intents before removing data or behavior; refuse if any would be stranded, including completed live ERP documents. Rollback never cancels or converts ERP documents implicitly. Test refusal and clean rollback in reverse migration order.
- **Validation:** reject invalid civil dates, overlapping or incomplete calendar coverage and reversed dates; validate project/calendar witnesses and all category override inputs, uniqueness and year membership server-side. Save source-line changes and distribution validation under the same version lock, and revalidate immediately on activation. Persist explicit override inputs as well as resolved amounts so clone and reload reproduce the approved plan. Tests must exercise direct RPC calls and concurrent edits, not just UI validation.
- **Rehearsal is a blocking discovery, not a payload specification:** replace the hypothetical body with the actual ERP v16 schema and accepted, read-back behavior before implementing or merging PR-B. If ERP does not enforce the required whole-project total with yearly figures, stop for the owner; do not infer a workaround. Recheck migration numbers against the integration base immediately before implementation and coordinate reservations.
- **Release evidence:** AC-018 and real ERP rehearsal are release blockers and run before feature release, with ERP and DB locks in the prescribed order. Every PR uses the local final gates applicable to its touched files; money PR-B receives Sol review, mutation checks and served-handler tests. UI proof and both translations accompany PR-D.
