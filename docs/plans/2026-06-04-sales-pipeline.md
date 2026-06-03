# Plan — SalesPipeline → real Supabase data (read path) · 2026-06-04

Spec: `docs/specs/sales-pipeline.spec.md`. Branch: `feat/sales-pipeline`. Mirrors PR #4/#5.
TDD throughout: RED (failing test) → GREEN (minimal code) → REFACTOR. Run all commands from
`pmo-portal/` unless noted.

## Design summary
- **Data layer:** REUSE `src/lib/db/projects.ts` (`listProjects` / `ProjectWithRefs`) and
  `src/hooks/useProjects.ts` (`useProjects`, org-scoped `queryKey`). No new module — the funnel is a
  client-side `useMemo` over the same cached `projects` query (NFR-SP-001). This is deliberately
  simpler than adding a `listSalesPipeline` DAL: the page already needs the full list for win-rate
  (computed over ALL projects, OBS-005), so a server-side stage filter would force a *second* query.
- **Page:** rewrite `pages/SalesPipeline.tsx` to use `useProjects()`, derive funnel + KPIs in `useMemo`,
  add loading/empty/error states, use shared `formatCurrency`.
- **Shared board:** migrate `components/SalesKanbanBoard.tsx` from prototype `Project[]` (camelCase) to
  `ProjectWithRefs[]` (snake_case): `contractValue`→`contract_value`, `clientId`→joined
  `client?.name`, `id` stays (now uuid). This kills the `as unknown as` trap (FR-SP-008) and fixes the
  card to show the client *name* not a raw id (FR-SP-009).
- **No ADR:** routine read-swap, no architectural/irreversible decision.

## Test placement (ADR-0010 pyramid) — and the justification
- **All AC-SP-### → UNIT** (Vitest/RTL): filter, KPI math, win-rate formula, render, loading, empty,
  error. Page ACs in `pages/SalesPipeline.test.tsx`; board ACs in `components/SalesKanbanBoard.test.tsx`.
- **pgTAP: NONE new.** The RLS read contract for `projects` (in-org allowed / cross-org blocked) is
  already owned by `supabase/tests/0006_read_path.test.sql` (AC-407). SalesPipeline hits the *same*
  table via the *same* `projects_select` policy and the *same* `listProjects` DAL — no new contract.
  Duplicating it would violate §5 ("reuse, don't duplicate").
- **e2e: NONE new — deliberate.** This is NOT a new cross-stack journey: it is the same authenticated
  `projects` read already smoke-tested by `e2e/AC-401-projects-smoke.spec.ts` (PM sees real seeded
  projects). The SalesPipeline funnel/KPIs are pure client-side derivations of that same payload, fully
  and more precisely covered at the unit layer. Adding a SalesPipeline e2e would push derivation logic
  up the pyramid into the slow band — the "ice-cream cone" anti-pattern §9 explicitly warns against.
  The behavioral guard that the page renders against live data is the existing AC-401 smoke + the full
  e2e suite run as the release gate.

## Traceability (AC → owning test)
| AC | Owning test (file · title token) |
|---|---|
| AC-SP-001 | `pages/SalesPipeline.test.tsx` · "AC-SP-001" |
| AC-SP-002 | `pages/SalesPipeline.test.tsx` · "AC-SP-002" |
| AC-SP-003 | `pages/SalesPipeline.test.tsx` · "AC-SP-003" |
| AC-SP-004 | `pages/SalesPipeline.test.tsx` · "AC-SP-004" |
| AC-SP-005 | `pages/SalesPipeline.test.tsx` · "AC-SP-005" |
| AC-SP-006 | `components/SalesKanbanBoard.test.tsx` · "AC-SP-006" |
| AC-SP-007 | `pages/SalesPipeline.test.tsx` · "AC-SP-007" |
| AC-SP-008 | `pages/SalesPipeline.test.tsx` · "AC-SP-008" |
| AC-SP-009 | `components/SalesKanbanBoard.test.tsx` · "AC-SP-009" |
| AC-SP-010 | `components/SalesKanbanBoard.test.tsx` · "AC-SP-010" |
| AC-407 (reuse) | `supabase/tests/0006_read_path.test.sql` (no change) |

## Tasks

### T1 — RED: board unit tests (AC-SP-006, -009, -010)  (~4 min)
Create `pmo-portal/components/SalesKanbanBoard.test.tsx`. Mock `react-router-dom`'s `useNavigate`.
Render `<SalesKanbanBoard projects={fixture} />` where `fixture: ProjectWithRefs[]` uses snake_case
(`contract_value`, joined `client: { name }`, uuid `id`, `status`). Assert:
- AC-SP-006: a stage column ('Tender' for `Tender Submitted`) shows count `1` and `$1,200,000`.
- AC-SP-009: with `projects={[]}`, all six column titles render and `$0` appears (no throw).
- AC-SP-010: clicking a card calls `navigate('/projects/<uuid>')`; the rendered card shows the joined
  client *name*, and `JSON.stringify` of the test does not rely on any camelCase field.
Verify (expected RED — component still camelCase): `npm test -- SalesKanbanBoard`.

### T2 — GREEN: migrate SalesKanbanBoard to the DB shape (AC-SP-006, -009, -010)  (~5 min)
Edit `pmo-portal/components/SalesKanbanBoard.tsx`:
- Import `ProjectWithRefs` from `@/src/lib/db/projects` and `ProjectStatus` from `../types`;
  change prop type to `projects: ProjectWithRefs[]`.
- Replace `p.contractValue` → `p.contract_value` (column total + weighted).
- Card: `project.status as ProjectStatus` for column match; show `project.client?.name ?? 'Unknown
  Client'` instead of `Client ID: {project.clientId}`; keep `project.id` (uuid) for the nav + key;
  `formatCurrency(project.contract_value)`.
- Replace the inline `Intl.NumberFormat` with `import { formatCurrency } from '@/src/lib/format'`.
Verify (expected GREEN): `npm test -- SalesKanbanBoard`.

### T3 — RED: page unit tests (AC-SP-001..005, -007, -008)  (~5 min)
Create `pmo-portal/pages/SalesPipeline.test.tsx` mirroring `Projects.test.tsx`:
- `vi.mock('@/src/hooks/useProjects', …)` returning a mutable `{ data, isPending, isError, refetch }`.
- `vi.mock('@/src/auth/useAuth', …)`, `vi.mock('@/src/auth/impersonation', …)`.
- Fixture: funnel rows (Tender $1.2M, PQ $0.8M, Negotiation $0.5M, Won-Pending $2M) + non-funnel
  (Ongoing $5M, Loss Tender $0, Close Out $0) so AC-SP-001/005 are meaningful.
- AC-SP-001: non-funnel project name absent from board; funnel ones present.
- AC-SP-002: Total Pipeline Value card shows formatted Σ funnel contract_value.
- AC-SP-003: Weighted Forecast card shows formatted Σ(value×prob).
- AC-SP-004: Active Deals count excludes Won-Pending; avg size formatted.
- AC-SP-005: win-rate card shows the OBS-005 percentage for a fixture incl. a Loss row.
- AC-SP-007: `isPending` → `getByTestId('sales-loading')`.
- AC-SP-008: `isError` → Retry button present.
Verify (expected RED): `npm test -- SalesPipeline`.

### T4 — GREEN: rewrite SalesPipeline.tsx on real data (AC-SP-001..005, -007, -008)  (~6 min)
Edit `pmo-portal/pages/SalesPipeline.tsx`:
- Remove `import { projects } from '../data/mockData'`; import `useProjects` from
  `@/src/hooks/useProjects`, `formatCurrency` from `@/src/lib/format`, `ProjectWithRefs` type,
  `useEffectiveRole`/`useAuth` as the other pages do.
- `const { data, isPending, isError, refetch } = useProjects();`
- `const allProjects = useMemo<ProjectWithRefs[]>(() => data ?? [], [data]);`
- `useMemo` funnel list (OBS-001), KPI block (OBS-002..005) over `allProjects` / funnel.
- Loading state `data-testid="sales-loading"` (skeleton like Projects); error state with Retry →
  `refetch()`; pass funnel list to `<SalesKanbanBoard>`.
- Replace inline `Intl.NumberFormat` with `formatCurrency`. Keep "Add Lead" button as a no-op.
Verify (expected GREEN): `npm test -- SalesPipeline`.

### T5 — REFACTOR + full local gates  (~4 min)
Tidy naming/dedupe; ensure no `as unknown as` cast and no `mockData` import remain in the two files.
Run, from `pmo-portal/`:
- `npm run typecheck`  → 0 errors
- `npm run lint:ci`    → 0 warnings
- `npm test`           → all unit green (incl. new files); check changed-file coverage ≥80%
- `npm run build`      → succeeds
Quick grep guard: `grep -n "as unknown as\|mockData\|contractValue\|clientId\|Intl.NumberFormat" pages/SalesPipeline.tsx components/SalesKanbanBoard.tsx` → no matches.

### T6 — Live-stack acceptance (release gate, §6/§7)  (~6 min)
From repo root (sandbox-disabled for supabase): `supabase start` then `supabase db reset`.
Put printed URL/anon key in `pmo-portal/.env.local` if not present. Then from `pmo-portal/`:
- `npx playwright test`  → existing curated suite green (AC-401 smoke is the SalesPipeline read guard).
- DB untouched → `supabase test db` not strictly required, but run it to confirm the reused
  `0006_read_path` AC-407 still passes (cheap, proves no regression).

### T7 — Commit (no push, no merge)  (§6)
Stage explicitly (NO `git add -A`): the two source files, the two new tests, the spec, the plan.
Commit with the trailer. Leave on `feat/sales-pipeline`. Do not push, do not open PR, do not merge.
