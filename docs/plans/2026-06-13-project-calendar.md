# Plan — Project Calendar view (read-only)

Date: 2026-06-13 · Feature: `project-calendar` · Branch target: `dev` (KANNA-parity)
Author: eng-planner · Status: build-ready (grill/mockup skipped per Director; FE → design-review round 2 after build)

---

## 1. Context & decisions (locked by Director)

A **third Projects view mode** — `calendar` — alongside `table | cards`. Read-only month grid
(NO drag-to-reschedule). Events: project `start_date`, project `end_date`, and milestone
`target_date`. Click a project event → `navigate('/projects/:id')`. Month nav (prev / next /
today). Role-scoped project list unchanged (reuse `useProjects()` → RLS-scoped `listProjects()`).
Desktop = month grid; mobile (< md) = agenda list. No heavy dependency — hand-rolled grid with
native `Date`/`Intl`.

### 1.1 Grounding findings (verified against `main`)

- **`useProjectView()` is NOT arbitrary-name-tolerant.** `src/hooks/useProjectView.ts` hard-guards
  the union via `isProjectView` (`v === 'table' || v === 'cards'`) and `ProjectView = 'table' | 'cards'`.
  The Director's "persists arbitrary view names" assumption is **false** — the union, the guard, and
  the `ViewToggle<...>` type param must all be widened to include `'calendar'`. (Task 2.)
- **No existing batch milestone-names/dates read.** `getProjectsDelivery` /
  `getProjectsDeliverySummary` return only rollup `delivery_pct` / spend / budget — **no milestone
  names or `target_date`s**. `listMilestones(projectId)` (RPC `get_project_milestones`) is
  **per-project** → calling it per visible project is an N+1. **Cheapest correct path = a new batch
  read** mirroring the `get_projects_delivery(p_ids uuid[])` security-invoker shape. (Tasks 3–6.)
- **`useIsDesktop()`** (`src/components/ui/useIsDesktop.ts`) single-renders at the `md` (768px)
  breakpoint with a synchronous `matchMedia` initializer (no first-paint flash). Reuse verbatim for
  the desktop-grid / mobile-agenda seam.
- `ViewToggle<V extends string>` (`src/components/ui/ViewToggle.tsx`) is generic over the view union
  — widening the type arg + adding an option is the only `Projects.tsx` toggle change.
- `ProjectWithRefs` (`src/lib/db/projects.ts`) already carries `start_date | null`, `end_date | null`,
  `id`, `name`, `code`, `status`. Project events need **no new project read**.
- Component-location convention: index-body view components live at **`pmo-portal/components/`**
  (e.g. `components/ProjectCard.tsx`), consumed by `pages/Projects.tsx`. → new component at
  `pmo-portal/components/ProjectCalendarView.tsx`.

### 1.2 Milestone data path (CHOSEN)

**New batch read** `get_projects_milestone_dates(p_ids uuid[])` — a `security invoker`, `stable` SQL
RPC returning `(id, project_id, name, target_date)` for milestones of the passed project ids whose
`target_date is not null`. RLS on `project_milestones` (`org_id = auth_org_id()`, migration 0023)
scopes rows; **`org_id` is never threaded from the client**. DAL `getProjectsMilestoneDates(ids)` +
repository `milestone.milestoneDatesForProjects(ids)` + hook `useProjectsMilestoneDates(ids)`. One
call for all visible projects (no N+1; NFR-CAL-PERF-001). Empty `ids` → `[]` without an RPC round-trip.

### 1.3 Collision check vs the Export stream (Director-required)

This stream **OWNS `pages/Projects.tsx`** view-mode wiring. Files touched: `pages/Projects.tsx`
(view union + ViewToggle option + calendar branch), the new `components/ProjectCalendarView.tsx`,
`src/hooks/useProjectView.ts` (union widen), and the additive milestone-dates read chain
(`supabase/migrations/00NN`, `src/lib/db/milestones.ts`, `src/lib/repositories/{types,index}.ts`,
`src/hooks/useProjects.ts`). The Export stream is kept off `Projects.tsx` via the Wave-0 S4 shared
toolbar seam — **no shared-file edit overlaps** beyond `Projects.tsx`, which this stream owns. The
milestone-read additions are append-only (new function/method/RPC) so they do not conflict with any
Export edit. **No collision.**

---

## 2. Requirements (EARS)

- **FR-CAL-001** (event-driven) — When the user selects the `Calendar` view toggle on Projects, the
  system shall render a month grid of the currently-scoped, currently-filtered projects' events and
  persist `calendar` as the active view (sessionStorage `views.project`).
- **FR-CAL-002** (ubiquitous) — The calendar shall render three event kinds per scoped project:
  a project `start_date` event, a project `end_date` event, and one event per milestone `target_date`,
  each placed in its day cell of the displayed month.
- **FR-CAL-003** (event-driven) — When the user activates a **project** event (start or end), the
  system shall `navigate('/projects/:id')` for that project.
- **FR-CAL-004** (event-driven) — When the user clicks Prev / Next / Today, the system shall change
  the displayed month accordingly; Today shall return to the month containing the current date.
- **FR-CAL-005** (state-driven) — While the projects query is pending, the calendar shall render a
  loading skeleton; while it is in error, an error state with retry; while the scoped+filtered set is
  empty, an empty state — reusing the page-level states already in `Projects.tsx`.
- **FR-CAL-006** (state-driven, responsive) — While the viewport is below the `md` breakpoint, the
  calendar shall render an **agenda list** (chronological, grouped by day) of the displayed month's
  events instead of the grid; at/above `md` it shall render the month grid (single-render via
  `useIsDesktop()`).
- **FR-CAL-007** (ubiquitous) — The calendar shall not widen project visibility: it consumes the same
  `useProjects()` (RLS-scoped) data and the page's active filter/search result set — no new unscoped read.
- **OBS-CAL-001** — Milestone events with a null `target_date` are not rendered (the RPC filters them).
- **NFR-CAL-PERF-001** — Milestone dates for all visible projects shall be fetched in **one** batched
  read (no per-project N+1); an empty id set shall not issue an RPC call.
- **NFR-CAL-A11Y-001** — Event activation targets are real `<button>`s with accessible names
  (`"{project name} — start"`, `"… — end"`, milestone `"{milestone name} ({project name})"`); month
  nav buttons have `aria-label`s; the grid uses semantic day headers.

---

## 3. Acceptance criteria (Given/When/Then) + ADR-0010 traceability

| AC | Behavior | Owning layer | Owning test file |
|---|---|---|---|
| **AC-CAL-001** | Given Projects loaded, When user clicks the `Calendar` toggle, Then the month grid renders and `views.project === 'calendar'` persists | E2E | `e2e/AC-CAL-001-calendar-toggle.spec.ts` |
| **AC-CAL-002** | Given a project with start_date 2026-06-03 and end_date 2026-06-20 in the displayed month, When the calendar renders, Then a start event sits in the day-3 cell and an end event in the day-20 cell | Unit (RTL) | `components/__tests__/ProjectCalendarView.events.test.tsx` |
| **AC-CAL-003** | Given a milestone with target_date 2026-06-12 in the displayed month, When the calendar renders, Then a milestone event labelled with its name sits in the day-12 cell | Unit (RTL) | `components/__tests__/ProjectCalendarView.events.test.tsx` |
| **AC-CAL-004** | Given the calendar rendered, When the user activates a project start/end event, Then `onOpenProject(project.id)` fires with that project's id | Unit (RTL) | `components/__tests__/ProjectCalendarView.events.test.tsx` |
| **AC-CAL-005** | Given June 2026 displayed, When the user clicks Next then Prev then Today, Then the month label reads July 2026, then June 2026, then the current month | Unit (RTL) | `components/__tests__/ProjectCalendarView.nav.test.tsx` |
| **AC-CAL-006** | Given no project has any event in the displayed month, When the calendar renders, Then a "No events this month" empty state shows (grid chrome still present) | Unit (RTL) | `components/__tests__/ProjectCalendarView.states.test.tsx` |
| **AC-CAL-007** | Given the viewport is below md, When the calendar renders, Then an agenda list (day-grouped) renders and the 7-column grid does not | Unit (RTL) | `components/__tests__/ProjectCalendarView.responsive.test.tsx` |
| **AC-CAL-008** | Given June 2026, When `buildMonthMatrix` runs, Then it returns 6 week-rows of 7 days with leading/trailing days from adjacent months flagged `inMonth: false` and the 1st on the correct weekday | Unit | `src/lib/calendar/monthMatrix.test.ts` |
| **AC-CAL-009** | Given ids `[]`, When `getProjectsMilestoneDates([])` is called, Then it returns `[]` without invoking the RPC (NFR-CAL-PERF-001) | Unit | `src/lib/db/milestones.calendar.test.ts` |
| **AC-CAL-010** | Given the toggle→render→click-through journey, When the user opens Calendar and clicks a project event, Then the app navigates to that project's detail route | E2E | `e2e/AC-CAL-001-calendar-toggle.spec.ts` (same journey, asserts nav) |

> ADR-0010 split: pure date math (AC-CAL-008) and the empty-RPC guard (AC-CAL-009) are unit;
> all component states/nav/event-placement/responsive are RTL unit (mocked props — the component
> takes plain data props, no network); the real toggle→render→click→navigate journey is the **single**
> E2E (AC-CAL-001 + AC-CAL-010 share one curated spec). RLS scope is already proven by the existing
> `project_milestones` pgTAP (migration 0023) — no new tenancy test; the new RPC is a `security invoker`
> read inheriting that RLS, so AC adds **no** pgTAP.

---

## 4. Architecture & data flow

```
useProjects() ──(RLS-scoped ProjectWithRefs[])──┐
                                                 ├─► Projects.tsx (filter/search) ──► filtered[]
useProjectsMilestoneDates(filtered ids) ─────────┘                                       │
   └─ repositories.milestone.milestoneDatesForProjects(ids)                              │
        └─ getProjectsMilestoneDates(ids)  [DAL]                                         │
             └─ supabase.rpc('get_projects_milestone_dates', { p_ids })  [RLS-scoped]    ▼
                                                          <ProjectCalendarView
                                                             projects={filtered}
                                                             milestoneDates={data}
                                                             onOpenProject={(id)=>navigate(`/projects/${id}`)} />
                                                                │
                                       useIsDesktop() ? <MonthGrid/> : <AgendaList/>
```

**Event model** (component-internal type):
```ts
type CalEventKind = 'start' | 'end' | 'milestone';
interface CalEvent {
  kind: CalEventKind;
  date: string;            // YYYY-MM-DD (local, no TZ shift — see Task 1 parsing rule)
  projectId: string;
  label: string;           // project name (start/end) or milestone name (milestone)
  projectName: string;     // for the milestone a11y suffix
}
```
Project events derive from `projects[]` (no fetch); milestone events from `milestoneDates[]`.

**DESIGN.md tokens** (binding — root font 16px → 32px controls):
- Grid container: `rounded-lg border border-border bg-card` (the card surface used by DataTable/ProjectCard).
- Day cells: `border border-border` 1px grid lines; today cell `ring-1 ring-primary` + `text-primary`
  day number; out-of-month cells `text-muted-foreground/60 bg-secondary/30`.
- Weekday header row: `text-[11px] font-semibold uppercase tracking-wide text-muted-foreground`.
- Event chips: project `bg-secondary text-foreground`, end-event `border-l-2 border-primary`,
  milestone `bg-primary/10 text-primary` — text+shape, never color-only (NFR-A11Y). Chip text `text-[11px]`.
- Nav: `Button variant="secondary"` (32px) for Prev/Next/Today; month label `text-[15px] font-semibold`.
- `Icon name="chevron-left" / "chevron-right"` for nav arrows.
- Agenda (mobile): day group header `text-[13px] font-semibold`, event rows reuse the chip tokens.
- Empty/loading/error reuse `ListState` (already imported in `Projects.tsx`).

---

## 5. Tasks (TDD; 2–5 min each; exact paths + verify commands)

> Run all commands from `pmo-portal/` unless noted. RED before GREEN on every behavior task.

### Task 1 — Pure date helpers (RED): month matrix + local date parse
**File (test, write first):** `pmo-portal/src/lib/calendar/monthMatrix.test.ts`
Write a failing test titled with **AC-CAL-008**:
```ts
import { describe, it, expect } from 'vitest';
import { buildMonthMatrix, parseLocalDate, monthLabel, addMonths } from './monthMatrix';

describe('monthMatrix', () => {
  it('AC-CAL-008: returns 6×7 days with adjacent-month days flagged and the 1st on the right weekday', () => {
    const weeks = buildMonthMatrix(2026, 5); // month is 0-based → June 2026
    expect(weeks).toHaveLength(6);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    const flat = weeks.flat();
    const june1 = flat.find((d) => d.iso === '2026-06-01')!;
    expect(june1.inMonth).toBe(true);
    expect(june1.weekdayIndex).toBe(1); // 2026-06-01 is a Monday (0=Sun)
    expect(flat.filter((d) => d.inMonth)).toHaveLength(30);
    expect(flat.some((d) => !d.inMonth)).toBe(true);
  });
  it('parseLocalDate does not TZ-shift a YYYY-MM-DD string', () => {
    expect(parseLocalDate('2026-06-03').getDate()).toBe(3);
  });
  it('monthLabel + addMonths', () => {
    expect(monthLabel(2026, 5)).toBe('June 2026');
    expect(addMonths({ year: 2026, month: 11 }, 1)).toEqual({ year: 2027, month: 0 });
  });
});
```
**Verify (RED):** `npm test -- monthMatrix` → fails (module missing).

### Task 2 — Date helpers (GREEN)
**File:** `pmo-portal/src/lib/calendar/monthMatrix.ts`
Implement, with no deps (native `Date`; `monthLabel` via `Intl.DateTimeFormat('en-US',{month:'long',year:'numeric'})`):
```ts
export interface MonthCursor { year: number; month: number; } // month 0-based
export interface DayCell { iso: string; day: number; inMonth: boolean; weekdayIndex: number; isToday: boolean; }

export function parseLocalDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d); // local — no UTC shift
}
function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function monthLabel(year: number, month: number): string {
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(new Date(year, month, 1));
}
export function addMonths(c: MonthCursor, delta: number): MonthCursor {
  const d = new Date(c.year, c.month + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
}
export function todayCursor(): MonthCursor { const n = new Date(); return { year: n.getFullYear(), month: n.getMonth() }; }
export function buildMonthMatrix(year: number, month: number): DayCell[][] {
  const todayIso = toIso(new Date());
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay()); // back up to the Sunday of week 1
  const weeks: DayCell[][] = [];
  for (let w = 0; w < 6; w++) {
    const row: DayCell[] = [];
    for (let i = 0; i < 7; i++) {
      const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + i);
      const iso = toIso(cur);
      row.push({ iso, day: cur.getDate(), inMonth: cur.getMonth() === month, weekdayIndex: cur.getDay(), isToday: iso === todayIso });
    }
    weeks.push(row);
  }
  return weeks;
}
```
**Verify (GREEN):** `npm test -- monthMatrix` → passes. `npm run typecheck` → 0 errors.

### Task 3 — Milestone-dates DAL (RED): empty-ids guard
**File (test):** `pmo-portal/src/lib/db/milestones.calendar.test.ts`
Mock `@/src/lib/supabase/client` (`vi.mock`, expose an `rpc` spy). Failing test titled **AC-CAL-009**:
```ts
it('AC-CAL-009: getProjectsMilestoneDates([]) returns [] without calling the RPC', async () => {
  const out = await getProjectsMilestoneDates([]);
  expect(out).toEqual([]);
  expect(rpcSpy).not.toHaveBeenCalled();
});
it('maps RPC rows to MilestoneDate[]', async () => {
  rpcSpy.mockResolvedValue({ data: [{ id: 'm1', project_id: 'p1', name: 'Kickoff', target_date: '2026-06-12' }], error: null });
  const out = await getProjectsMilestoneDates(['p1']);
  expect(out).toEqual([{ id: 'm1', projectId: 'p1', name: 'Kickoff', targetDate: '2026-06-12' }]);
  expect(rpcSpy).toHaveBeenCalledWith('get_projects_milestone_dates', { p_ids: ['p1'] });
});
```
**Verify (RED):** `npm test -- milestones.calendar` → fails.

### Task 4 — Milestone-dates DAL (GREEN)
**File:** append to `pmo-portal/src/lib/db/milestones.ts`:
```ts
export interface MilestoneDate {
  id: string;
  projectId: string;
  name: string;
  targetDate: string; // YYYY-MM-DD (RPC filters null target_date out)
}

/**
 * Batch read of dated milestones across a set of projects for the calendar view
 * (NFR-CAL-PERF-001 — one call, no per-project N+1). security-invoker RPC; RLS on
 * project_milestones (migration 0023) scopes rows — org_id is NEVER sent from the client.
 * Empty ids short-circuit to [] (no round-trip). Milestones with null target_date are
 * excluded server-side (OBS-CAL-001).
 */
export async function getProjectsMilestoneDates(ids: string[]): Promise<MilestoneDate[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase.rpc('get_projects_milestone_dates', { p_ids: ids });
  if (error) throwWrite(error);
  return (data ?? []).map((r: { id: string; project_id: string; name: string; target_date: string }) => ({
    id: r.id,
    projectId: r.project_id,
    name: r.name,
    targetDate: r.target_date,
  }));
}
```
**Verify (GREEN):** `npm test -- milestones.calendar` → passes.

### Task 5 — Migration: `get_projects_milestone_dates` RPC
**File:** `supabase/migrations/00NN_calendar_milestone_dates.sql` (NN = next sequential number — run
`ls supabase/migrations | tail -1` to pick it; current head is 0027 per deployment memory → likely `0028`).
Mirror the `get_projects_delivery` security-invoker pattern from migration 0023:
```sql
-- 00NN_calendar_milestone_dates.sql — Project Calendar read (FR-CAL-002).
-- Batch dated-milestone read across projects. security INVOKER → RLS on project_milestones
-- (0023: org_id = auth_org_id()) scopes rows; no org_id from client; no SoD axis (read-only).
-- Reversibility (forward-only post-deploy; `supabase db reset` pre-prod):
--   drop function if exists get_projects_milestone_dates(uuid[]);
create or replace function get_projects_milestone_dates(p_ids uuid[])
  returns table (id uuid, project_id uuid, name text, target_date date)
  language sql stable security invoker set search_path = public as $$
  select m.id, m.project_id, m.name, m.target_date
    from project_milestones m
   where m.project_id = any(p_ids)
     and m.target_date is not null
   order by m.target_date, m.sort_order;
$$;
revoke all     on function get_projects_milestone_dates(uuid[]) from public;
grant  execute on function get_projects_milestone_dates(uuid[]) to   authenticated;
revoke execute on function get_projects_milestone_dates(uuid[]) from anon;
```
**Verify:** `supabase db reset` (repo root) → migrations apply clean; `npm run typecheck` after
regenerating types in Task 6.

### Task 6 — Regenerate DB types + repository seam + hook
**File A:** regenerate `pmo-portal/src/lib/supabase/database.types.ts` so the new RPC is typed
(do NOT hand-cast — durable lesson "type-regen-not-casts"). Command (repo root):
`supabase gen types typescript --local > pmo-portal/src/lib/supabase/database.types.ts`.
**File B:** `pmo-portal/src/lib/repositories/types.ts` — import `MilestoneDate` from the milestones DAL
and add to `MilestoneRepository`:
```ts
  milestoneDatesForProjects: (ids: string[]) => Promise<MilestoneDate[]>;
```
**File C:** `pmo-portal/src/lib/repositories/index.ts` — import `getProjectsMilestoneDates` from
`@/src/lib/db/milestones` and add to the `milestone` object:
```ts
  milestoneDatesForProjects: (ids) => wrap(() => getProjectsMilestoneDates(ids)),
```
**File D:** `pmo-portal/src/hooks/useProjects.ts` — add the hook (org-scoped key, gated on non-empty ids):
```ts
export function useProjectsMilestoneDates(ids: string[]) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery({
    queryKey: ['milestone-dates', orgId, [...ids].sort()],
    queryFn: () => repositories.milestone.milestoneDatesForProjects(ids),
    enabled: Boolean(orgId) && ids.length > 0,
  });
}
```
**Verify:** `npm run typecheck` → 0 errors. `npm test -- milestones.calendar` still green.

### Task 7 — Widen the view union (RED → GREEN)
**File (test):** `pmo-portal/src/hooks/useProjectView.test.ts` — add a failing case:
```ts
it('persists and reads back the calendar view', () => {
  writeProjectView('calendar');
  expect(readProjectView()).toBe('calendar');
});
```
**File (impl):** `pmo-portal/src/hooks/useProjectView.ts` — change:
```ts
export type ProjectView = 'table' | 'cards' | 'calendar';
function isProjectView(v: unknown): v is ProjectView {
  return v === 'table' || v === 'cards' || v === 'calendar';
}
```
**Verify:** `npm test -- useProjectView` → passes. `npm run typecheck` → 0 errors.

### Task 8 — ProjectCalendarView: event derivation + grid placement (RED)
**File (test):** `pmo-portal/components/__tests__/ProjectCalendarView.events.test.tsx`
Render `<ProjectCalendarView>` with a forced `initialCursor={{year:2026,month:5}}` prop and `isDesktop`
forced true (mock `useIsDesktop` → true). Failing tests:
- **AC-CAL-002**: a project `{id:'p1',name:'Acme',start_date:'2026-06-03',end_date:'2026-06-20'}` →
  the day-3 cell contains a button named `/Acme — start/`, day-20 contains `/Acme — end/`.
- **AC-CAL-003**: `milestoneDates=[{id:'m1',projectId:'p1',name:'Kickoff',targetDate:'2026-06-12'}]` →
  the day-12 cell contains a button named `/Kickoff/`.
- **AC-CAL-004**: clicking the `Acme — start` button calls `onOpenProject` with `'p1'`.
**Verify (RED):** `npm test -- ProjectCalendarView.events` → fails (component missing).

### Task 9 — ProjectCalendarView: implementation (GREEN for Tasks 8/10/11/12)
**File:** `pmo-portal/components/ProjectCalendarView.tsx`. Props:
```ts
export interface ProjectCalendarViewProps {
  projects: ProjectWithRefs[];                 // already RLS-scoped + filtered by Projects.tsx
  milestoneDates: MilestoneDate[] | undefined; // from useProjectsMilestoneDates (undefined while loading)
  milestonesPending?: boolean;
  onOpenProject: (id: string) => void;
  /** Test seam: force the initial displayed month (defaults to todayCursor()). */
  initialCursor?: MonthCursor;
}
```
Implementation notes (bind to the tokens in §4):
- `const [cursor, setCursor] = useState<MonthCursor>(initialCursor ?? todayCursor());`
- `const isDesktop = useIsDesktop();`
- Derive `events: CalEvent[]` via `useMemo` from `projects` (start/end, skip null dates) +
  `milestoneDates` (milestone). Label: start/end → project name; milestone → milestone name; a11y
  name suffix `— start` / `— end` / `({projectName})`.
- Group events by `iso` into a `Map<string, CalEvent[]>`.
- Desktop: weekday header row + `buildMonthMatrix(cursor.year, cursor.month)` → 7-col grid; each cell
  renders its `events` as chips (project chips → `<button onClick={() => onOpenProject(ev.projectId)}>`;
  milestone chip → non-interactive `<span>` per "click a **project** event navigates" — milestones are
  display-only in v1). Out-of-month cells dimmed.
- Mobile (`!isDesktop`): `<AgendaList>` — events of the displayed month sorted by `iso`, grouped by day
  with a day header, each project event a button (same `onOpenProject`).
- Nav row: `Button` Prev `onClick={() => setCursor((c) => addMonths(c, -1))}`, Next `+1`, Today
  `onClick={() => setCursor(todayCursor())}`; label `monthLabel(cursor.year, cursor.month)`.
- Empty: when the displayed month has zero events → render the grid/agenda chrome + a centered
  "No events this month" `ListState variant="empty"` overlay/below (AC-CAL-006).
**Verify:** `npm test -- ProjectCalendarView.events` → passes; `npm run typecheck` → 0 errors.

### Task 10 — ProjectCalendarView: month navigation (RED→GREEN)
**File (test):** `pmo-portal/components/__tests__/ProjectCalendarView.nav.test.tsx`
**AC-CAL-005**: render with `initialCursor={{year:2026,month:5}}`; assert label `June 2026`; click
`Next` → `July 2026`; click `Prev` → `June 2026`; click `Today` → label equals
`monthLabel(todayCursor())`. (Today implementation lands in Task 9.)
**Verify:** `npm test -- ProjectCalendarView.nav` → passes.

### Task 11 — ProjectCalendarView: empty state (RED→GREEN)
**File (test):** `pmo-portal/components/__tests__/ProjectCalendarView.states.test.tsx`
**AC-CAL-006**: render with `projects` whose dates are all outside June 2026 and
`milestoneDates=[]`, `initialCursor` June 2026 → assert `/no events this month/i` is shown AND the
weekday header row is still present (chrome retained). (Implemented in Task 9.)
**Verify:** `npm test -- ProjectCalendarView.states` → passes.

### Task 12 — ProjectCalendarView: responsive agenda (RED→GREEN)
**File (test):** `pmo-portal/components/__tests__/ProjectCalendarView.responsive.test.tsx`
**AC-CAL-007**: `vi.mock('@/src/components/ui/useIsDesktop', () => ({ useIsDesktop: () => false }))`;
render with one project having a June event, `initialCursor` June 2026 → assert an agenda list item
(role/text) renders AND the 7-column grid (`data-testid="calendar-month-grid"`) is **absent**.
Add `data-testid="calendar-month-grid"` to the desktop grid root and `data-testid="calendar-agenda"`
to the agenda root in Task 9. (Implemented in Task 9.)
**Verify:** `npm test -- ProjectCalendarView.responsive` → passes.

### Task 13 — Wire the Calendar toggle + branch into Projects.tsx (RED→GREEN)
**File:** `pmo-portal/pages/Projects.tsx`. Changes (this stream OWNS this file):
1. Widen the ViewToggle generic + add the option:
```tsx
<ViewToggle<'table' | 'cards' | 'calendar'>
  options={[
    { value: 'table', label: 'Table', icon: 'table' },
    { value: 'cards', label: 'Cards', icon: 'cards' },
    { value: 'calendar', label: 'Calendar', icon: 'calendar' },
  ]}
  value={view}
  onChange={setView}
  ariaLabel="Projects view"
/>
```
   (Keep the existing `hidden md:block` wrapper — on mobile the toggle is hidden and the calendar's own
   agenda mode is reached only when `view==='calendar'` was set on desktop; the existing
   table↔cards mobile force-render is unchanged.)
2. Import the component + hook:
```tsx
import ProjectCalendarView from '../components/ProjectCalendarView';
import { useProjects, useClientCompanies, useProjectManagers, useProjectMutations, useProjectsMilestoneDates } from '@/src/hooks/useProjects';
```
3. After `filtered` is computed, fetch dated milestones for the visible set:
```tsx
const { data: milestoneDates, isPending: milestonesPending } = useProjectsMilestoneDates(filtered.map((p) => p.id));
```
4. Add the body branch (calendar takes precedence over the table/cards branch):
```tsx
{view === 'calendar' ? (
  <ProjectCalendarView
    projects={filtered}
    milestoneDates={milestoneDates}
    milestonesPending={milestonesPending}
    onOpenProject={(id) => navigate(`/projects/${id}`)}
  />
) : view === 'table' ? (
  /* …existing DataTable… */
) : (
  /* …existing cards branch… */
)}
```
**Test (E2E, write the journey test in Task 14 — this task's unit guard):** existing
`pages/__tests__/*Projects*` suites must stay green (no regression to table/cards). 
**Verify:** `npm test -- Projects` → all existing Projects suites pass; `npm run typecheck` → 0 errors;
`npm run lint -- --max-warnings=0` → clean.

### Task 14 — E2E: toggle → render → click-through (RED→GREEN)
**File:** `pmo-portal/e2e/AC-CAL-001-calendar-toggle.spec.ts` (run Playwright **from `pmo-portal/`** —
memory gotcha). One curated journey covering **AC-CAL-001 + AC-CAL-010**:
```ts
test('AC-CAL-001: Projects calendar toggle renders the month grid and a project event navigates to detail', async ({ page }) => {
  // sign in (reuse the e2e auth helper/fixture), go to /projects
  await page.getByRole('button', { name: /Calendar/ }).click();
  await expect(page.getByTestId('calendar-month-grid')).toBeVisible();
  // a seeded project with a start_date in the current month → its start chip is a button
  const ev = page.getByRole('button', { name: /— start/ }).first();
  await ev.click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+$/); // AC-CAL-010 nav assertion
});
```
> Goal-oracle (BDD rule): the assertion is "calendar renders AND a project event navigates to its
> detail route" — never downgrade to "a Calendar button exists". If a seeded current-month-dated
> project is missing, add a dedicated fixture row (durable lesson "dedicated e2e fixtures"), do not
> weaken the assertion.
**Verify:** `npx playwright test AC-CAL-001` (from `pmo-portal/`) → passes.

### Task 15 — Full gate sweep
**Verify (from `pmo-portal/`):**
- `npm run typecheck` → 0 errors
- `npm run lint -- --max-warnings=0` → 0
- `npm test` → all green; changed-line coverage ≥ 80% on the new files (CI-enforced gate, PR #83)
- `npx playwright test AC-CAL-001` → green

---

## 6. ADR

No new ADR required — this reuses ADR-0017 (repository seam), ADR-0010 (test pyramid), and the 0023
milestone RLS model; the new RPC is an additive security-invoker read inside an existing pattern. If
the Director later wants drag-to-reschedule (v2, a write path with an SoD/permission axis), that
warrants an ADR then.

## 7. Open questions for the Director

1. **Milestone events clickable?** v1 renders milestone chips as **display-only** (only *project*
   events navigate, per the locked decision "click a **project** event → `/projects/:id`"). Confirm
   milestones should NOT also be clickable in v1. *(Assumed: display-only.)*
2. **Mobile entry to calendar:** the Projects view toggle is `hidden md:block` (mobile force-renders
   cards for table/cards). v1 reaches calendar's agenda mode only if `calendar` was selected on desktop
   then the viewport narrows. Is that acceptable for v1, or should the Calendar option also be exposed
   in the mobile toolbar? *(Assumed: acceptable — agenda is the responsive fallback, not a mobile-first
   entry. No `[OWNER-ESCALATION]` — it's a UX nicety for design-review round 2.)*
