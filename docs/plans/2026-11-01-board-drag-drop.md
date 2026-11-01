# Plan: board drag and drop, Sales Pipeline and project Tasks (DND, #1637)

- **Spec:** `docs/specs/board-drag-drop.spec.md` (Draft 2026-11-01; OQ-1..6 carry defaults this plan builds on).
- **Ruling:** OD-GRILL-20261101 "Reel differences (#1593)" (`docs/decisions.md:3618`); supersedes OD-W3-4
  (`docs/decisions.md:336-337`).
- **Grounds read at `origin/dev` 6440a961:** `components/{SalesKanbanBoard.tsx,salesPipeline.ts,ProjectStatusControl.tsx,ProjectStatusControl.test.tsx}`,
  `src/lib/db/projectTransitions.ts`, `src/hooks/{useProjectTransitions.ts,projectQueryKeys.ts,useTasks.ts}`,
  `src/lib/db/tasks.ts`, `src/components/ui/{Kanban.tsx,ConfirmDialog.tsx,EntityFormModal.tsx,Toast.tsx}`,
  `pages/SalesPipeline.tsx`, `pages/sales-pipeline/PipelineResults.tsx`, `pages/project-detail/tabs/TasksTab.tsx`,
  `src/auth/policy.ts`, `supabase/migrations/0394_action_eligibility.sql`, pgTAP `0027`/`0028`/`0029`/`0052`,
  `test/renderWithQueryClient.tsx`, `e2e/AC-010-billing-kinds.spec.ts`, `e2e/AC-TASK-001-tasks-crud.spec.ts`,
  `docs/e2e-parallel-conventions.md`, ADR-0010/0016/0019/0055/0056. Paths below are relative to `pmo-portal/` unless
  they start with `docs/`, `scripts/` or `supabase/`.
- **No migration, no RPC, no RLS change.** The drop calls the exact write the menu calls.
- **Executor:** UI lane, Orca worker(s) per `docs/orca-dispatch.md`. Not money path (no money write changes), so no
  slice is flagged "ships alone" for money. S2 touches the Mark-won gate UI (ADR-0019 SoD surface): the
  security-auditor reviews S2 at full depth and confirms the eligibility preflight and RPC payload are unchanged.

---

## 0. Open questions for the Director (each with the default this plan builds on)

| # | Question | Default built |
|---|---|---|
| OQ-1 | Library | `@dnd-kit/core@6.3.1`, exact pin, via `scripts/relock.sh` (§2.2) |
| OQ-2 | Drop on Lost (Loss Tender vs Declined) | one destructive confirm with a required radio choice, no preselection |
| OQ-3 | Menu on Sales board cards | none; keyboard path stays card → deal page → Change status |
| OQ-4 | Keyboard drag | not built (no `KeyboardSensor`) |
| OQ-5 | Moves inside the Won column | no-op on drop |
| OQ-6 | Touch drag on the phone Tasks board | on, press-and-hold 250 ms / 5 px |

## 1. Design

### 1.1 Shape

```
            ┌───────────────────────── one rule source per board ─────────────────────────┐
 Deals:     LEGAL_PROJECT_TRANSITIONS ∩ SALES_COLUMNS[k].statuses  →  resolveProjectDrop()
 Tasks:     canSetStatus(task) (may('edit','taskStatus'))         →  4 statuses, no confirm
            └──────────────────────────────────────────────────────────────────────────────┘
 menu (ProjectStatusControl / task SelectField) ─┐
                                                 ├─> shared copy + confirm + win fields ─> useProjectTransition / updateStatus
 drop (BoardDnd onMove) ─> useOptimisticMoves ───┘
```

- `src/components/kanban/BoardDnd.tsx` *(new)*: the only module importing `@dnd-kit/core`. A `BoardDnd` context
  (`DndContext` + `DragOverlay` + announcements), `DraggableCard`, `DroppableColumn`. It knows nothing about deals or
  tasks: it takes `canDrop(cardId, columnId)`, `onMove(cardId, columnId)`, `cardLabel`, `columnLabel`,
  `renderOverlay`.
- `src/components/kanban/useOptimisticMoves.ts` *(new)*: per-board overlay `{ [cardId]: { column, state } }` with
  `state ∈ 'held' | 'saving'`. Boards place cards by `columnOf(id, serverColumn)`; nothing touches the React Query cache,
  so the three pipeline queries (`sales-pipeline`, `won-deals`, `lost-deals`) and the tasks query need no cache surgery.
  Release happens after the board's queries have refetched (FR-DND-033) or immediately on cancel/error (rollback).
- `components/salesPipeline.ts`: `resolveProjectDrop(status, column)` *(new, pure)* next to `SALES_COLUMNS`.
- `components/project-status/` *(new folder)*: pieces extracted from `ProjectStatusControl.tsx` so menu and drop share
  them — `projectTransitionCopy.ts` (confirm copy + win-eligibility message), `ProjectTransitionConfirm.tsx`
  (the `ConfirmDialog` the menu shows, plus an optional choice slot), `WinDetailsFields.tsx` (the contract ref + date
  inputs). `ProjectStatusControl` is refactored onto them with byte-identical copy.
- `pages/sales-pipeline/DraggableSalesBoard.tsx` *(new)*: the pipeline drop controller. Rendered by
  `PipelineResults.tsx:127` in place of the bare `SalesKanbanBoard`; passes a `drag` prop into `SalesKanbanBoard`.
  `SalesKanbanBoard` without `drag` renders exactly as today, so its existing tests are unaffected.
- `pages/project-detail/tabs/TasksTab.tsx`: `TaskBoard` wraps its columns/cards in `BoardDnd`; `onStatusChange`
  returns `Promise<boolean>` so the board knows whether to keep or roll back.

### 1.2 Library decision (OQ-1)

| | Native HTML5 DnD | `@dnd-kit/core` 6.3.1 | `@hello-pangea/dnd` |
|---|---|---|---|
| Touch | No drag on iPhone Safari; partial on iPad | `TouchSensor` with press delay + tolerance | Yes |
| Pointer activation threshold (click vs drag) | Browser-fixed | `MouseSensor` `distance` | Fixed |
| Screen-reader announcements | None; build ourselves | Built-in live region, `announcements` hook | Built-in |
| Drag preview | Browser ghost image, clipped by `overflow` columns | `DragOverlay` (fixed layer, escapes column `overflow-y-auto`, `Kanban.tsx:62`) | Own |
| Fit | Fine for files, poor for boards | Primitive: we keep our `Kanban` layout | List-reorder model; wants to own lists; bundles Redux |
| Size (gzipped, approximate) | 0 | ~12 kB, no transitive runtime deps beyond `tslib`/`@dnd-kit/utilities`/`@dnd-kit/accessibility` | ~30 kB+ |

Recommendation: `@dnd-kit/core`. It is the only option that meets NFR-DND-002 (touch) and FR-DND-041
(announcements) without hand-building both, and it leaves our column layout and tokens alone. Pin `6.3.1` exactly
(the 6.x line has been stable for well over two weeks; do not use the pre-1.0 `@dnd-kit/react`). Confirm the weight in
the `npm run build` chunk report (NFR-DND-003); it lands only in the `/sales` and project-detail chunks because only
`BoardDnd.tsx` imports it.

### 1.3 Drop resolution (pipeline)

```ts
// components/salesPipeline.ts (new export)
export type ProjectDropResolution =
  | { kind: 'noop' }
  | { kind: 'refused' }
  | { kind: 'target'; to: ProjectStatus }
  | { kind: 'choice'; options: ProjectStatus[] };

export function resolveProjectDrop(status: ProjectStatus, column: SalesColumn): ProjectDropResolution {
  if (column.statuses.includes(status as string)) return { kind: 'noop' };
  const legal = (LEGAL_PROJECT_TRANSITIONS[status as string] ?? []).filter((s) => column.statuses.includes(s)) as ProjectStatus[];
  if (legal.length === 0) return { kind: 'refused' };
  if (legal.length === 1) return { kind: 'target', to: legal[0] };
  return { kind: 'choice', options: legal };
}
```

Outcomes this yields from the shipped map (`projectTransitions.ts:36-49`): Leads → Tender refused; Quotation →
Tender target; Negotiation → Won target `Won, Pending KoM`; any open stage → Lost choice `[Loss Tender, Declined]`;
Lost → Negotiation target; Lost → Won refused; Won-group → any other column refused; Won-group → Won noop (OQ-5).

### 1.4 Pipeline drop sequence (`DraggableSalesBoard`)

1. `resolveProjectDrop`. `noop` → return. `refused` → warning toast `boardDrag:refused` → return (card never left).
2. `moves.hold(id, column.testId)` (card shows in target, `data-drag-state="held"`).
3. `target` non-win → `<ProjectTransitionConfirm target={to}>` (same copy as the menu). `choice` →
   `<ProjectTransitionConfirm target="Loss Tender" choice={options}>` with `confirmDisabled` until a radio is picked.
4. `target === 'Won, Pending KoM'` → `queryClient.fetchQuery(winEligibilityQueryOptions(currentUser, id))`
   (same key builder the menu's `useProjectWinEligibility` uses, `staleTime: 0`). `allowed` → `EntityFormModal`
   "Win — enter contract details" with `<WinDetailsFields>`; else → release + warning toast with
   `winEligibilityMessage(t, decision)` (the menu's text).
5. Cancel anywhere → `moves.release(id)`.
6. Confirm/submit → `moves.save(id)`; `await mutation.mutateAsync({ id, to, opts })` (opts only for win, identical to
   `ProjectStatusControl.tsx:165-169`); success → success toast `Project updated` / `Moved to {to}` (menu copy,
   `ProjectStatusControl.tsx:153`), `await refreshBoard()`; error → toast `Status change failed` + server message
   (menu copy, `:156`). `finally moves.release(id)`.
   The menu's win path shows its error inline (`ProjectStatusControl.tsx:188-192`); the board has no inline slot,
   so a failed win from a drop uses the same toast as the menu's confirm path. The win path's ERP note
   (`erpSetupPending`, `:182-186`) is shown as an info toast on the board.

`refreshBoard = () => Promise.all(['sales-pipeline','won-deals','lost-deals'].map((root) => qc.invalidateQueries({ queryKey: [root, orgId] }, { cancelRefetch: false })))`
— awaits the refetch already started by `invalidateProjectProjections` without cancelling it.

### 1.5 Task drop sequence (`TaskBoard`)

`canDrop = canSetStatus(task) && column !== task.status`. On drop: `moves.hold` + `moves.save`;
`const ok = await onStatusChange(task, column)` (shipped toasts, shipped external routing and push badge);
`if (ok) await qc.invalidateQueries({ queryKey: ['tasks', orgId, projectId] }, { cancelRefetch: false })`;
`moves.release`. A refused or failed write returns `false` → release → card snaps back.

### 1.6 Accessibility

- Cards get dnd-kit `listeners` only, not `attributes`: no new `role`, `tabIndex` or `aria-roledescription`, so card
  focus order and semantics are unchanged (FR-DND-042). The menu stays the keyboard path; WCAG 2.5.7 is met by it.
- `DndContext accessibility.announcements` (i18n, `boardDrag` namespace): start / over allowed / over not allowed /
  dropped / cancelled. `screenReaderInstructions.draggable` = "To change status with the keyboard, use the card's status
  control."
- `KanbanColumn` gains `dropState?: 'allowed' | 'blocked'`: allowed = primary ring + "Drop to move here" text; blocked
  = reduced opacity + "Can't move here" text with a `block` icon (non-colour cue, FR-DND-040). Saving cards get
  `aria-busy="true"` and a "Saving…" caption.
- Esc cancels a mouse or touch drag (dnd-kit sensors handle it; FR-DND-044).

### 1.7 Risks

- `scroll-snap-type: x mandatory` on `.kanban-scroll` (`index.css:552`) can fight dnd-kit auto-scroll on desktop;
  S3-T6 disables snap while dragging via `[data-dragging] .kanban-scroll { scroll-snap-type: none }`.
- Twelve `pages/__tests__/SalesPipeline.*.test.tsx` files render the desktop board without a `QueryClientProvider`;
  `DraggableSalesBoard` needs one. S3-T5 moves only their render calls onto `test/renderWithQueryClient.tsx` (harness
  change; no assertion edited). If any assertion would need to change, stop and report.
- jsdom cannot drive dnd-kit sensors reliably, so unit tests drive drops through the `BoardDnd` seam (mocked module
  exposing `onMove`), and the real pointer path is proven in the two Playwright journeys.

## 2. File map

| File | Status | Slice |
|---|---|---|
| `package.json`, `package-lock.json` | edit (`@dnd-kit/core` 6.3.1) | S1 |
| `src/components/kanban/useOptimisticMoves.ts` (+ `__tests__/useOptimisticMoves.test.ts`) | new | S1 |
| `src/components/kanban/BoardDnd.tsx` (+ `__tests__/BoardDnd.test.tsx`) | new | S1 |
| `src/components/ui/Kanban.tsx` | edit (`dropState`) | S1 |
| `public/locales/{en,id}/boardDrag.json` | new | S1 |
| `components/salesPipeline.ts` (+ `salesPipeline.drop.test.ts`) | edit | S1 |
| `components/project-status/projectTransitionCopy.ts` (+ test) | new | S2 |
| `components/project-status/ProjectTransitionConfirm.tsx` | new | S2 |
| `components/project-status/WinDetailsFields.tsx` | new | S2 |
| `components/ProjectStatusControl.tsx` | refactor, behaviour unchanged | S2 |
| `src/hooks/useProjectTransitions.ts` | edit (export `winEligibilityQueryOptions`) | S2 |
| `components/SalesKanbanBoard.tsx` | edit (optional `drag` prop) | S3 |
| `pages/sales-pipeline/DraggableSalesBoard.tsx` (+ `__tests__/DraggableSalesBoard.test.tsx`) | new | S3 |
| `pages/sales-pipeline/PipelineResults.tsx` | edit (line 127) | S3 |
| `pages/__tests__/SalesPipeline.*.test.tsx` | harness only (S3-T5) | S3 |
| `index.css` | edit (snap off while dragging) | S3 |
| `pages/project-detail/tabs/TasksTab.tsx` (+ `pages/project-detail/__tests__/TasksTab.boardDnd.test.tsx`) | edit | S4 |
| `e2e/support/boardDrag.ts`, `e2e/AC-DND-014-pipeline-drag.spec.ts`, `e2e/AC-DND-015-tasks-drag.spec.ts` | new | S5 |

Order: S1 → S2 → (S3 ∥ S4) → S5. One PR per slice to `dev`, or S1+S2 together if the Director prefers fewer PRs.

## 3. Gate evidence (every slice, CLAUDE.md local final gate)

From `pmo-portal/`: `npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <touched files>`,
`npx vitest run <touched test files>`. UI slices also `scripts/ux-proof.sh` on `/sales` and
`/projects/40000000-0000-0000-0000-000000000001?tab=tasks&view=board` (S3/S4/S5), and S5 runs
`scripts/e2e-local.sh AC-DND-`. No DB reset (no migration or seed).

---

## S1 — Dependency, board shell, resolver

### S1-T1 Add the dependency (2 min)
From repo root: edit `pmo-portal/package.json` `dependencies` to add `"@dnd-kit/core": "6.3.1"`, then
`scripts/relock.sh` (never `npm install` on macOS), then `cd pmo-portal && npm ci`.
Verify: `grep -n '"@dnd-kit/core": "6.3.1"' pmo-portal/package.json && grep -c 'node_modules/@dnd-kit/core' pmo-portal/package-lock.json`
(≥ 1) and `grep -c '@emnapi/core' pmo-portal/package-lock.json` (≥ 1, canary survived).

### S1-T2 Failing test: resolver (AC-DND-001) (4 min)
`components/salesPipeline.drop.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { resolveProjectDrop, SALES_COLUMNS } from './salesPipeline';
import { LEGAL_PROJECT_TRANSITIONS, type ProjectStatus } from '@/src/lib/db/projectTransitions';

const col = (testId: string) => SALES_COLUMNS.find((c) => c.testId === testId)!;

describe('resolveProjectDrop', () => {
  it('AC-DND-001: every (status, column) resolves to LEGAL_PROJECT_TRANSITIONS ∩ column.statuses', () => {
    for (const status of Object.keys(LEGAL_PROJECT_TRANSITIONS) as ProjectStatus[]) {
      for (const column of SALES_COLUMNS) {
        const legal = LEGAL_PROJECT_TRANSITIONS[status].filter((s) => column.statuses.includes(s));
        const r = resolveProjectDrop(status, column);
        if (column.statuses.includes(status)) expect(r).toEqual({ kind: 'noop' });
        else if (legal.length === 0) expect(r).toEqual({ kind: 'refused' });
        else if (legal.length === 1) expect(r).toEqual({ kind: 'target', to: legal[0] });
        else expect(r).toEqual({ kind: 'choice', options: legal });
      }
    }
  });
  it('AC-DND-001: named cases from the shipped map', () => {
    expect(resolveProjectDrop('Leads', col('stage-Tender Submitted'))).toEqual({ kind: 'refused' });
    expect(resolveProjectDrop('Negotiation', col('stage-Won'))).toEqual({ kind: 'target', to: 'Won, Pending KoM' });
    expect(resolveProjectDrop('Tender Submitted', col('stage-Lost'))).toEqual({ kind: 'choice', options: ['Loss Tender', 'Declined'] });
    expect(resolveProjectDrop('Ongoing Project', col('stage-Won'))).toEqual({ kind: 'noop' });
    expect(resolveProjectDrop('Loss Tender', col('stage-Negotiation'))).toEqual({ kind: 'target', to: 'Negotiation' });
  });
});
```
Verify red: `npx vitest run components/salesPipeline.drop.test.ts` (fails: `resolveProjectDrop` not exported).

### S1-T3 Green: resolver (2 min)
Add to `components/salesPipeline.ts` the `ProjectDropResolution` type and `resolveProjectDrop` exactly as §1.3; extend
the existing import from `@/src/lib/db/projectTransitions` with `LEGAL_PROJECT_TRANSITIONS` and `type ProjectStatus`.
Verify green: same command.

### S1-T4 Failing test: optimistic moves (4 min)
`src/components/kanban/__tests__/useOptimisticMoves.test.ts`:
```ts
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useOptimisticMoves } from '../useOptimisticMoves';

describe('useOptimisticMoves', () => {
  it('holds a card in the target column, marks it saving, and releases it back (AC-DND-008 rollback seam)', () => {
    const { result } = renderHook(() => useOptimisticMoves());
    expect(result.current.columnOf('a', 'Leads')).toBe('Leads');
    act(() => result.current.hold('a', 'Tender'));
    expect(result.current.columnOf('a', 'Leads')).toBe('Tender');
    expect(result.current.stateOf('a')).toBe('held');
    act(() => result.current.save('a'));
    expect(result.current.stateOf('a')).toBe('saving');
    act(() => result.current.release('a'));
    expect(result.current.columnOf('a', 'Leads')).toBe('Leads');
    expect(result.current.stateOf('a')).toBeNull();
  });
});
```
Verify red: `npx vitest run src/components/kanban/__tests__/useOptimisticMoves.test.ts`.

### S1-T5 Green: `src/components/kanban/useOptimisticMoves.ts` (3 min)
```ts
import { useCallback, useState } from 'react';

export type MoveState = 'held' | 'saving';
type Moves = Record<string, { column: string; state: MoveState }>;

/** Board-local optimistic placement (FR-DND-030..033). Never touches the query cache. */
export function useOptimisticMoves() {
  const [moves, setMoves] = useState<Moves>({});
  const hold = useCallback((id: string, column: string) =>
    setMoves((m) => ({ ...m, [id]: { column, state: 'held' } })), []);
  const save = useCallback((id: string) =>
    setMoves((m) => (m[id] ? { ...m, [id]: { ...m[id], state: 'saving' } } : m)), []);
  const release = useCallback((id: string) =>
    setMoves((m) => { if (!(id in m)) return m; const next = { ...m }; delete next[id]; return next; }), []);
  const columnOf = useCallback((id: string, fallback: string) => moves[id]?.column ?? fallback, [moves]);
  const stateOf = useCallback((id: string): MoveState | null => moves[id]?.state ?? null, [moves]);
  return { hold, save, release, columnOf, stateOf };
}
```
Verify green: same command.

### S1-T6 Locale files (3 min)
`public/locales/en/boardDrag.json` (and `id/boardDrag.json` with the same key tree, Indonesian values):
```json
{
  "refused": "{{name}} can't move from {{from}} to {{to}}.",
  "refusedTitle": "Move not allowed",
  "dropHere": "Drop to move here",
  "cantMoveHere": "Can't move here",
  "saving": "Saving…",
  "lostChoice": { "legend": "Which outcome?", "loss": "Loss Tender", "declined": "Declined" },
  "instructions": "To change status with the keyboard, use the card's status control.",
  "announce": {
    "start": "Picked up {{name}}.",
    "overAllowed": "{{name}} is over {{column}}. Drop allowed.",
    "overBlocked": "{{name}} is over {{column}}. This move is not allowed.",
    "overNone": "{{name}} is not over a column.",
    "dropped": "Dropped {{name}} on {{column}}.",
    "cancelled": "Move cancelled. {{name}} stays where it was."
  }
}
```
Indonesian values (`id`): "{{name}} tidak dapat dipindahkan dari {{from}} ke {{to}}.", "Pemindahan tidak diizinkan",
"Lepas untuk memindahkan ke sini", "Tidak dapat dipindahkan ke sini", "Menyimpan…", legend "Hasil yang mana?", loss
"Loss Tender", declined "Declined" (enum values stay untranslated), instructions "Untuk mengubah status dengan keyboard,
gunakan kontrol status pada kartu.", announce: "{{name}} diambil.", "{{name}} berada di atas {{column}}. Boleh
dilepas.", "{{name}} berada di atas {{column}}. Pemindahan ini tidak diizinkan.", "{{name}} tidak berada di atas
kolom.", "{{name}} dilepas di {{column}}.", "Pemindahan dibatalkan. {{name}} tetap di tempatnya."
Verify: `npm run check:guards` (namespace key-tree parity guard passes).

### S1-T7 Failing test: `BoardDnd` (AC-DND-012, AC-DND-013) (5 min)
`src/components/kanban/__tests__/BoardDnd.test.tsx` — test the pure announcement builder and drop-state plumbing,
and that a plain click still reaches the card:
```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { BoardDnd, DraggableCard, DroppableColumn, buildAnnouncements } from '../BoardDnd';

const t = ((key: string, _d: string, o?: Record<string, string>) => `${key}|${o?.name ?? ''}|${o?.column ?? ''}`) as never;

describe('BoardDnd', () => {
  it('AC-DND-012: announces start, over allowed / not allowed, drop and cancel with card and column names', () => {
    const a = buildAnnouncements(t, { cardLabel: () => 'Deal A', columnLabel: () => 'Tender', canDrop: (_c, col) => col === 'ok' });
    expect(a.onDragStart({ active: { id: 'c1' } } as never)).toBe('boardDrag:announce.start|Deal A|');
    expect(a.onDragOver({ active: { id: 'c1' }, over: { id: 'ok' } } as never)).toBe('boardDrag:announce.overAllowed|Deal A|Tender');
    expect(a.onDragOver({ active: { id: 'c1' }, over: { id: 'no' } } as never)).toBe('boardDrag:announce.overBlocked|Deal A|Tender');
    expect(a.onDragEnd({ active: { id: 'c1' }, over: { id: 'ok' } } as never)).toBe('boardDrag:announce.dropped|Deal A|Tender');
    expect(a.onDragCancel({ active: { id: 'c1' } } as never)).toBe('boardDrag:announce.cancelled|Deal A|');
  });
  it('AC-DND-013: a click without movement reaches the card and starts no drag', () => {
    const onClick = vi.fn(); const onMove = vi.fn();
    render(<BoardDnd canDrop={() => true} onMove={onMove} cardLabel={() => 'A'} columnLabel={() => 'X'} renderOverlay={() => null}>
      <DroppableColumn id="X">{() => <DraggableCard id="c1"><button onClick={onClick}>Open A</button></DraggableCard>}</DroppableColumn>
    </BoardDnd>);
    fireEvent.click(screen.getByRole('button', { name: 'Open A' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onMove).not.toHaveBeenCalled();
  });
  it('AC-DND-012: a draggable card adds no role or tabindex of its own (menu stays the keyboard path)', () => {
    render(<BoardDnd canDrop={() => true} onMove={vi.fn()} cardLabel={() => 'A'} columnLabel={() => 'X'} renderOverlay={() => null}>
      <DroppableColumn id="X">{() => <DraggableCard id="c1"><span>A</span></DraggableCard>}</DroppableColumn>
    </BoardDnd>);
    const wrapper = screen.getByText('A').parentElement!;
    expect(wrapper.getAttribute('role')).toBeNull();
    expect(wrapper.getAttribute('tabindex')).toBeNull();
  });
});
```
Verify red: `npx vitest run src/components/kanban/__tests__/BoardDnd.test.tsx`.

### S1-T8 Green: `src/components/kanban/BoardDnd.tsx` (5 min)
```tsx
import React, { createContext, useContext, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  DndContext, DragOverlay, MouseSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors,
  type Announcements, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import type { MoveState } from './useOptimisticMoves';

interface Labels {
  cardLabel: (cardId: string) => string;
  columnLabel: (columnId: string) => string;
  canDrop: (cardId: string, columnId: string) => boolean;
}
export interface BoardDndProps extends Labels {
  onMove: (cardId: string, columnId: string) => void;
  renderOverlay: (cardId: string) => React.ReactNode;
  children: React.ReactNode;
}

const ActiveCard = createContext<{ activeId: string | null; canDrop: Labels['canDrop'] }>({ activeId: null, canDrop: () => false });

export function buildAnnouncements(t: TFunction, l: Labels): Announcements {
  const name = (id: unknown) => l.cardLabel(String(id));
  return {
    onDragStart: ({ active }) => t('boardDrag:announce.start', 'Picked up {{name}}.', { name: name(active.id) }),
    onDragOver: ({ active, over }) => over
      ? l.canDrop(String(active.id), String(over.id))
        ? t('boardDrag:announce.overAllowed', '{{name}} is over {{column}}. Drop allowed.', { name: name(active.id), column: l.columnLabel(String(over.id)) })
        : t('boardDrag:announce.overBlocked', '{{name}} is over {{column}}. This move is not allowed.', { name: name(active.id), column: l.columnLabel(String(over.id)) })
      : t('boardDrag:announce.overNone', '{{name}} is not over a column.', { name: name(active.id) }),
    onDragEnd: ({ active, over }) => over
      ? t('boardDrag:announce.dropped', 'Dropped {{name}} on {{column}}.', { name: name(active.id), column: l.columnLabel(String(over.id)) })
      : t('boardDrag:announce.cancelled', 'Move cancelled. {{name}} stays where it was.', { name: name(active.id) }),
    onDragCancel: ({ active }) => t('boardDrag:announce.cancelled', 'Move cancelled. {{name}} stays where it was.', { name: name(active.id) }),
  };
}

export const BoardDnd: React.FC<BoardDndProps> = ({ onMove, renderOverlay, children, ...labels }) => {
  const { t } = useTranslation('boardDrag');
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
  );
  const end = (e: DragEndEvent) => {
    setActiveId(null);
    if (e.over) onMove(String(e.active.id), String(e.over.id));
  };
  return (
    <ActiveCard.Provider value={{ activeId, canDrop: labels.canDrop }}>
      <div data-dragging={activeId ? 'true' : undefined}>
        <DndContext
          sensors={sensors}
          onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))}
          onDragEnd={end}
          onDragCancel={() => setActiveId(null)}
          accessibility={{
            announcements: buildAnnouncements(t, labels),
            screenReaderInstructions: { draggable: t('boardDrag:instructions', "To change status with the keyboard, use the card's status control.") },
          }}
        >
          {children}
          <DragOverlay>{activeId ? renderOverlay(activeId) : null}</DragOverlay>
        </DndContext>
      </div>
    </ActiveCard.Provider>
  );
};

/** Column drop target. Children is a render prop receiving the column's drop state while a card is dragged. */
export const DroppableColumn: React.FC<{ id: string; className?: string; children: (dropState: 'allowed' | 'blocked' | undefined) => React.ReactNode }> = ({ id, className, children }) => {
  const { setNodeRef } = useDroppable({ id });
  const { activeId, canDrop } = useContext(ActiveCard);
  const dropState = activeId ? (canDrop(activeId, id) ? 'allowed' : 'blocked') : undefined;
  return <div ref={setNodeRef} className={className}>{children(dropState)}</div>;
};

/** Pointer/touch drag wrapper. Spreads listeners only: no role/tabIndex, the menu stays the keyboard path. */
export const DraggableCard: React.FC<{ id: string; disabled?: boolean; moveState?: MoveState | null; children: React.ReactNode }> = ({ id, disabled = false, moveState = null, children }) => {
  const { setNodeRef, listeners, isDragging } = useDraggable({ id, disabled: disabled || moveState === 'saving' });
  return (
    <div
      ref={setNodeRef}
      {...(disabled ? {} : listeners)}
      data-drag-state={moveState ?? undefined}
      aria-busy={moveState === 'saving' ? true : undefined}
      className={isDragging ? 'opacity-40' : moveState ? 'rounded-lg ring-2 ring-primary/40' : undefined}
    >
      {children}
    </div>
  );
};
```
Note for the builder: the `DroppableColumn` ref must sit on the element that already carries the Sales board's
`colRefs` ref; S3 merges them with a callback ref. Verify green: same command as S1-T7.

### S1-T9 `KanbanColumn` drop state (4 min)
Failing test first, append to the existing Kanban test file if present (`grep -rl "KanbanColumn" src/components/ui/*.test.tsx`)
or create `src/components/ui/__tests__/Kanban.dropState.test.tsx`:
```tsx
it('AC-DND-012: shows a non-colour cue for allowed and blocked drop states', () => {
  const { rerender } = render(<KanbanColumn title="Tender" count={0} dropState="allowed" />);
  expect(screen.getByText('Drop to move here')).toBeInTheDocument();
  rerender(<KanbanColumn title="Tender" count={0} dropState="blocked" />);
  expect(screen.getByText("Can't move here")).toBeInTheDocument();
});
```
Then in `src/components/ui/Kanban.tsx`: add `dropState?: 'allowed' | 'blocked'` to `KanbanColumnProps`; set
`data-drop-state={dropState}`; extend the class list with
`dropState === 'allowed' && 'border-primary ring-2 ring-primary/40'`, `dropState === 'blocked' && 'opacity-60'`; and
under the header row render
`{dropState && <p className="mt-1 text-[11.5px] text-muted-foreground">{dropState === 'allowed' ? t('boardDrag:dropHere', 'Drop to move here') : t('boardDrag:cantMoveHere', "Can't move here")}</p>}`
(with `const { t } = useTranslation('boardDrag')`). Verify: `npx vitest run <that file>` red then green.

---

## S2 — Shared project transition pieces (menu unchanged)

### S2-T1 Failing test: copy + messages (4 min)
`components/project-status/projectTransitionCopy.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { projectConfirmCopy, winEligibilityMessage } from './projectTransitionCopy';
const t = ((_k: string, d: string) => d) as never;

describe('projectTransitionCopy', () => {
  it('AC-DND-003: forward/back targets use the menu confirm copy', () => {
    expect(projectConfirmCopy('Tender Submitted')).toEqual({ tone: 'default', title: 'Move project to Tender Submitted?',
      description: 'This moves the project forward to the Tender Submitted stage.', confirmLabel: 'Move to Tender Submitted' });
  });
  it('AC-DND-006: lost targets use the destructive menu copy', () => {
    for (const to of ['Loss Tender', 'Declined'] as const)
      expect(projectConfirmCopy(to)).toEqual({ tone: 'destructive', title: 'Mark project as lost',
        description: 'This moves the project to a terminal lost stage. You can still review it, but it leaves the active pipeline.', confirmLabel: 'Mark lost' });
  });
  it('AC-DND-005: maps each non-allowed decision to the menu message', () => {
    expect(winEligibilityMessage(t, 'unavailable')).toBe('Win eligibility is unavailable. Refresh this page and try again.');
    expect(winEligibilityMessage(t, null)).toBe('Win eligibility is unavailable. Refresh this page and try again.');
    expect(winEligibilityMessage(t, 'inactive_reviewer')).toBe('Ask an active supervisor or a more senior reviewer to confirm the value.');
    expect(winEligibilityMessage(t, 'reviewer_required')).toBe('Ask your supervisor or a more senior reviewer to confirm the value before winning this project.');
    expect(winEligibilityMessage(t, 'missing_witness')).toBe('Ask your supervisor or a more senior reviewer to confirm the value before winning this project.');
  });
});
```
Verify red: `npx vitest run components/project-status/projectTransitionCopy.test.ts`.

### S2-T2 Green: `components/project-status/projectTransitionCopy.ts` (3 min)
```ts
import type { TFunction } from 'i18next';
import { projectStatusGroup, type ProjectStatus } from '@/src/lib/db/projectTransitions';

export const isLostTarget = (to: ProjectStatus) => projectStatusGroup(to) === 'lost';

/** The status menu's confirm copy (moved verbatim from ProjectStatusControl.tsx:303-324). */
export function projectConfirmCopy(to: ProjectStatus) {
  return isLostTarget(to)
    ? { tone: 'destructive' as const, title: 'Mark project as lost',
        description: 'This moves the project to a terminal lost stage. You can still review it, but it leaves the active pipeline.',
        confirmLabel: 'Mark lost' }
    : { tone: 'default' as const, title: `Move project to ${to}?`,
        description: `This moves the project forward to the ${to} stage.`, confirmLabel: `Move to ${to}` };
}

/** The menu's message for a win-eligibility decision that is not 'allowed' (moved from ProjectStatusControl.tsx:30-37). */
export function winEligibilityMessage(t: TFunction, decision: string | null | undefined): string {
  if (!decision || decision === 'unavailable')
    return t('project:winEligibility.unavailable', 'Win eligibility is unavailable. Refresh this page and try again.');
  if (decision === 'inactive_reviewer')
    return t('project:winEligibility.inactive', 'Ask an active supervisor or a more senior reviewer to confirm the value.');
  return t('project:winEligibility.reviewer', 'Ask your supervisor or a more senior reviewer to confirm the value before winning this project.');
}
```
Verify green.

### S2-T3 `ProjectTransitionConfirm.tsx` and `WinDetailsFields.tsx` (5 min)
`components/project-status/ProjectTransitionConfirm.tsx`:
```tsx
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@/src/components/ui';
import type { ProjectStatus } from '@/src/lib/db/projectTransitions';
import { projectConfirmCopy } from './projectTransitionCopy';

export const ProjectTransitionConfirm: React.FC<{
  target: ProjectStatus;
  /** Several legal statuses for one drop (Lost column, OQ-2): a required choice, no preselection. */
  choice?: ProjectStatus[];
  loading: boolean;
  onCancel: () => void;
  onConfirm: (to: ProjectStatus) => void;
}> = ({ target, choice, loading, onCancel, onConfirm }) => {
  const { t } = useTranslation('boardDrag');
  const [picked, setPicked] = useState<ProjectStatus | null>(null);
  const copy = projectConfirmCopy(target);
  const description = choice ? (
    <>
      <p>{copy.description}</p>
      <fieldset className="mt-3">
        <legend className="text-xs font-semibold">{t('boardDrag:lostChoice.legend', 'Which outcome?')}</legend>
        {choice.map((s) => (
          <label key={s} className="mt-1 flex items-center gap-2 text-sm">
            <input type="radio" name="lost-outcome" value={s} checked={picked === s} onChange={() => setPicked(s)} />
            {s}
          </label>
        ))}
      </fieldset>
    </>
  ) : copy.description;
  return (
    <ConfirmDialog open tone={copy.tone} title={copy.title} description={description} confirmLabel={copy.confirmLabel}
      loading={loading} confirmDisabled={!!choice && !picked} onCancel={onCancel}
      onConfirm={() => onConfirm(choice ? (picked as ProjectStatus) : target)} />
  );
};
```
`components/project-status/WinDetailsFields.tsx`: move the two labelled inputs from `ProjectStatusControl.tsx:252-284`
verbatim (ids `contract-ref-${idPrefix}` / `contract-date-${idPrefix}`, labels "Customer contract ref" / "Contract date",
`required`, placeholder, classes) into
`export const WinDetailsFields: React.FC<{ idPrefix: string; contractRef: string; contractDate: string; onRef: (v: string) => void; onDate: (v: string) => void }>`,
plus `export const winDetailsComplete = (ref: string, date: string) => ref.trim() !== '' && date !== '';`.
Verify: `npm run typecheck`.

### S2-T4 Refactor `ProjectStatusControl.tsx` onto the shared pieces (5 min)
- Replace the `ConfirmDialog` block (`:305-324`) with
  `<ProjectTransitionConfirm target={confirmTarget} loading={mutation.isPending} onCancel={() => setConfirmTarget(null)} onConfirm={() => void commitConfirm()} />`.
- Replace the two input blocks inside the win `<form>` (`:252-284`) with
  `<WinDetailsFields idPrefix={project.id} contractRef={contractRef} contractDate={contractDate} onRef={setContractRef} onDate={setContractDate} />`;
  `handleWinSubmit` guard becomes `if (!canWin || !winDetailsComplete(contractRef, contractDate)) return;`.
- In `WinTarget` (`:29-37`), replace the inline message ternary with
  `<p role="status" …>{winEligibilityMessage(t, eligibility.isError ? null : eligibility.data)}</p>` (the checking
  state stays as is).
- Remove the now-unused `isDestructiveTarget` helper and the `ConfirmDialog` import.
Do **not** import anything new from `@/src/hooks/useProjectTransitions` here: its test mocks that module with two names only.
Verify (AC-DND-011): `npx vitest run components/ProjectStatusControl.test.tsx` — every existing test passes unchanged.

### S2-T5 Export the win-eligibility query options (3 min)
In `src/hooks/useProjectTransitions.ts`:
```ts
export const winEligibilityQueryOptions = (
  user: { org_id?: string; id?: string; role?: string | null; manager_id?: string | null } | null | undefined,
  projectId: string, revision?: string | null,
) => ({
  queryKey: ['project-win-eligibility', user?.org_id, user?.id, user?.role, user?.manager_id, projectId, revision] as const,
  queryFn: () => repositories.project.winEligibility(projectId),
  staleTime: 0,
});
```
and make `useProjectWinEligibility` use `useQuery({ ...winEligibilityQueryOptions(currentUser, projectId, revision), enabled: Boolean(enabled && currentUser?.id) })`
(same key, same fn, same `staleTime`). Verify: `npx vitest run components/ProjectStatusControl.test.tsx src/hooks/useProjectTransitions*.test.ts*`
(the second glob only if such a file exists: `ls src/hooks | grep -i projectTransitions`).

---

## S3 — Sales Pipeline board drag

### S3-T1 `SalesKanbanBoard` optional `drag` prop (4 min)
Add to `SalesKanbanBoardProps` (`components/SalesKanbanBoard.tsx:18-34`):
```ts
/** Drag controller (DND, #1637). Absent → the board renders exactly as before. */
drag?: {
  columnOf: (projectId: string, serverColumnId: string) => string;
  stateOf: (projectId: string) => import('@/src/components/kanban/useOptimisticMoves').MoveState | null;
  canDrag: (project: PipelineProject) => boolean;
  canDrop: (projectId: string, columnId: string) => boolean;
  onMove: (projectId: string, columnId: string) => void;
};
```
In `SalesKanbanBoardView`: compute `serverColumnId(p) = SALES_COLUMNS.find((c) => c.statuses.includes(p.status))?.testId`;
`byColumn(col)` filters by `(drag ? drag.columnOf(p.id, serverColumnId(p)) : serverColumnId(p)) === col.testId`.
When `drag` is set, wrap the `<Kanban>` in `<BoardDnd canDrop={drag.canDrop} onMove={drag.onMove} cardLabel={(id) => projectDisplayName(byId.get(id)!)} columnLabel={(id) => stageLabel(SALES_COLUMNS.find((c) => c.testId === id)!)} renderOverlay={(id) => <div className="rounded-lg border border-border bg-card p-3 text-[13px] font-semibold shadow-[0_10px_30px_hsl(240_10%_8%/0.16)]">{projectDisplayName(byId.get(id)!)}</div>}>`,
replace each column wrapper `<div ref=… data-testid={col.testId}>` with
`<DroppableColumn id={col.testId}>{(dropState) => <div ref=… data-testid={col.testId} …><KanbanColumn … dropState={dropState}>…</KanbanColumn></div>}</DroppableColumn>`
(keep the `colRefs` ref on the inner div), and wrap each `DealCard` in
`<DraggableCard id={p.id} disabled={!drag.canDrag(p)} moveState={drag.stateOf(p.id)}>`; a `saving` card renders the
caption `t('boardDrag:saving','Saving…')` under it. Without `drag`, the JSX path is the current one.
Verify: `npx vitest run components/SalesKanbanBoard.test.tsx components/SalesKanbanBoard.bahasa.test.tsx` (unchanged, green).

### S3-T2 Failing tests: drop controller (AC-DND-002..008) (5 min)
`pages/sales-pipeline/__tests__/DraggableSalesBoard.test.tsx`. Seam: mock `@/src/components/kanban/BoardDnd` so the
test can call the board's `onMove` and read `canDrop`:
```tsx
const dnd = vi.hoisted(() => ({ props: null as null | { onMove: (c: string, k: string) => void; canDrop: (c: string, k: string) => boolean } }));
vi.mock('@/src/components/kanban/BoardDnd', () => ({
  BoardDnd: (p: { children: React.ReactNode; onMove: never; canDrop: never }) => { dnd.props = p; return <>{p.children}</>; },
  DroppableColumn: ({ children }: { children: (s: undefined) => React.ReactNode }) => <>{children(undefined)}</>,
  DraggableCard: ({ children, moveState }: { children: React.ReactNode; moveState?: string | null }) => <div data-drag-state={moveState ?? undefined}>{children}</div>,
}));
const mutateAsync = vi.fn();
vi.mock('@/src/hooks/useProjectTransitions', () => ({
  useProjectTransition: () => ({ mutateAsync, isPending: false, erpSetupPending: false }),
  winEligibilityQueryOptions: (_u: unknown, id: string) => ({ queryKey: ['wel', id], queryFn: () => eligibility(id), staleTime: 0 }),
}));
const eligibility = vi.fn(async () => 'allowed');
```
Render `<DraggableSalesBoard projects={[leads, quotation, tender, negotiation]} onOpen={vi.fn()} />` inside
`QueryClientProvider` + `ToastProvider` with `useAuth` mocked to a PM in org `o1` and `usePermission` → `() => true`.
Helper `drop = (id, col) => act(() => dnd.props!.onMove(id, col))`. Tests (titles carry the AC):
1. `AC-DND-002: Leads → Tender is refused: no request, card stays in Leads, refusal message shown` —
   `drop('leads','stage-Tender Submitted')`; expect `mutateAsync` not called; `within(getByTestId('stage-Leads'))` has the
   card; `findByText("Leads deal can't move from Leads to Tender.")`.
2. `AC-DND-003: Quotation → Tender opens the menu confirm; Cancel snaps back with no write; Confirm writes once` —
   expect dialog title `Move project to Tender Submitted?`, card inside `stage-Tender Submitted` with
   `data-drag-state="held"`; click Cancel → card back in `stage-Quotation Submitted`, no call; drop again, click
   `Move to Tender Submitted` → `mutateAsync` called once with `{ id: 'quotation', to: 'Tender Submitted', opts: undefined }`.
3. `AC-DND-004: Negotiation → Won with eligibility allowed opens the win form; submit needs ref and date` — the
   submit button is disabled with empty fields; type `CPO-1` and `2026-11-01`, submit → called with
   `{ id: 'negotiation', to: 'Won, Pending KoM', opts: { customerContractRef: 'CPO-1', contractDate: '2026-11-01' } }`;
   a second run clicking Cancel → card back in `stage-Negotiation`, no call.
4. `AC-DND-005: a non-allowed or failed eligibility check snaps back with the menu message` — table over
   `reviewer_required`, `inactive_reviewer`, `unavailable`, rejected promise: no form, no call, message from
   `winEligibilityMessage`.
5. `AC-DND-006: Tender → Lost needs a choice between Loss Tender and Declined` — confirm `Mark lost` disabled until a
   radio is picked; pick `Declined`, confirm → `to: 'Declined'`.
6. `AC-DND-007: a server refusal rolls the card back and shows "Status change failed" with the server message` —
   `mutateAsync.mockRejectedValueOnce(new Error('Illegal transition'))`; after confirm, card in original column, toast
   text `Illegal transition`.
7. `AC-DND-008: on success the card stays in the target column (saving) until the pipeline queries refetch` — spy
   `queryClient.invalidateQueries` resolving on a deferred; before resolve the card is in Tender with
   `data-drag-state="saving"`; after resolve the mark is gone and `invalidateQueries` was called for
   `['sales-pipeline','o1']`, `['won-deals','o1']`, `['lost-deals','o1']` with `{ cancelRefetch: false }`.
8. `AC-DND-012: canDrop mirrors resolveProjectDrop` — `dnd.props.canDrop('leads','stage-Tender Submitted')` false,
   `('quotation','stage-Tender Submitted')` true, `('leads','stage-Leads')` false.
Verify red: `npx vitest run pages/sales-pipeline/__tests__/DraggableSalesBoard.test.tsx`.

### S3-T3 Green: `pages/sales-pipeline/DraggableSalesBoard.tsx` (5 min)
```tsx
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { EntityFormModal, useToast } from '@/src/components/ui';
import { useAuth } from '@/src/auth/useAuth';
import { usePermission } from '@/src/auth/usePermission';
import { useProjectTransition, winEligibilityQueryOptions } from '@/src/hooks/useProjectTransitions';
import { useOptimisticMoves } from '@/src/components/kanban/useOptimisticMoves';
import { projectDisplayName } from '@/src/lib/projectDisplayName';
import { useSalesStageLabel } from '@/src/hooks/useProjectStatusLabel';
import { LEGAL_PROJECT_TRANSITIONS, type ProjectStatus, type TransitionProjectOpts } from '@/src/lib/db/projectTransitions';
import type { PipelineProject } from '@/src/lib/db/dashboard';
import SalesKanbanBoard from '../../components/SalesKanbanBoard';
import { SALES_COLUMNS, resolveProjectDrop } from '../../components/salesPipeline';
import { ProjectTransitionConfirm } from '../../components/project-status/ProjectTransitionConfirm';
import { WinDetailsFields, winDetailsComplete } from '../../components/project-status/WinDetailsFields';
import { winEligibilityMessage } from '../../components/project-status/projectTransitionCopy';

type Pending =
  | { kind: 'confirm'; project: PipelineProject; target: ProjectStatus; choice?: ProjectStatus[] }
  | { kind: 'win'; project: PipelineProject };

const BOARD_ROOTS = ['sales-pipeline', 'won-deals', 'lost-deals'] as const;

export const DraggableSalesBoard: React.FC<{ projects: PipelineProject[]; onOpen: (p: PipelineProject) => void; selectedStageIndex?: number | null }> = ({ projects, onOpen, selectedStageIndex }) => {
  const { t } = useTranslation('boardDrag');
  const qc = useQueryClient();
  const { currentUser } = useAuth();
  const may = usePermission();
  const mutation = useProjectTransition();
  const { toast } = useToast();
  const moves = useOptimisticMoves();
  const stageLabel = useSalesStageLabel();
  const [pending, setPending] = useState<Pending | null>(null);
  const [ref, setRef] = useState(''); const [date, setDate] = useState('');
  const byId = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const colById = (id: string) => SALES_COLUMNS.find((c) => c.testId === id)!;
  const mayTransition = may('transition', 'project');

  const refreshBoard = () => Promise.all(BOARD_ROOTS.map((root) =>
    qc.invalidateQueries({ queryKey: [root, currentUser?.org_id] }, { cancelRefetch: false })));

  const cancel = () => { if (pending) moves.release(pending.project.id); setPending(null); setRef(''); setDate(''); };

  const commit = async (project: PipelineProject, to: ProjectStatus, opts?: TransitionProjectOpts) => {
    setPending(null); moves.save(project.id);
    try {
      await mutation.mutateAsync({ id: project.id, to, opts });
      toast('Project updated', `Moved to ${to}`, 'success');
      await refreshBoard();
    } catch (err) {
      toast('Status change failed', err instanceof Error ? err.message : undefined, 'warning');
    } finally {
      moves.release(project.id); setRef(''); setDate('');
    }
  };

  const onMove = async (projectId: string, columnId: string) => {
    const project = byId.get(projectId); if (!project || !mayTransition) return;
    const column = colById(columnId);
    const r = resolveProjectDrop(project.status as ProjectStatus, column);
    if (r.kind === 'noop') return;
    if (r.kind === 'refused') {
      toast(t('boardDrag:refusedTitle', 'Move not allowed'), t('boardDrag:refused', "{{name}} can't move from {{from}} to {{to}}.", {
        name: projectDisplayName(project), from: stageLabel(SALES_COLUMNS.find((c) => c.statuses.includes(project.status))!), to: stageLabel(column),
      }), 'warning');
      return;
    }
    moves.hold(projectId, columnId);
    if (r.kind === 'choice') { setPending({ kind: 'confirm', project, target: r.options[0], choice: r.options }); return; }
    if (r.to !== 'Won, Pending KoM') { setPending({ kind: 'confirm', project, target: r.to }); return; }
    let decision: string | null = null;
    try { decision = await qc.fetchQuery(winEligibilityQueryOptions(currentUser, project.id)); } catch { decision = null; }
    if (decision === 'allowed') { setPending({ kind: 'win', project }); return; }
    moves.release(projectId);
    toast(t('boardDrag:refusedTitle', 'Move not allowed'), winEligibilityMessage(t, decision), 'warning');
  };

  const canDrop = (projectId: string, columnId: string) => {
    const p = byId.get(projectId);
    if (!p) return false;
    const k = resolveProjectDrop(p.status as ProjectStatus, colById(columnId)).kind;
    return k === 'target' || k === 'choice';
  };

  return (
    <>
      <SalesKanbanBoard projects={projects} onOpen={onOpen} selectedStageIndex={selectedStageIndex}
        drag={{
          columnOf: moves.columnOf,
          stateOf: moves.stateOf,
          canDrag: (p) => mayTransition && (LEGAL_PROJECT_TRANSITIONS[p.status] ?? []).length > 0,
          canDrop,
          onMove: (id, col) => void onMove(id, col),
        }} />
      {pending?.kind === 'confirm' && (
        <ProjectTransitionConfirm target={pending.target} choice={pending.choice} loading={mutation.isPending}
          onCancel={cancel} onConfirm={(to) => void commit(pending.project, to)} />
      )}
      {pending?.kind === 'win' && (
        <EntityFormModal open title="Win — enter contract details" submitLabel="Confirm"
          submitDisabled={!winDetailsComplete(ref, date)} onClose={cancel}
          onSubmit={(e) => { e.preventDefault(); if (winDetailsComplete(ref, date)) void commit(pending.project, 'Won, Pending KoM', { customerContractRef: ref.trim(), contractDate: date }); }}>
          <WinDetailsFields idPrefix={`drop-${pending.project.id}`} contractRef={ref} contractDate={date} onRef={setRef} onDate={setDate} />
        </EntityFormModal>
      )}
    </>
  );
};

export default DraggableSalesBoard;
```
(`EntityFormModal` takes its fields as `children`; check its props at `src/components/ui/EntityFormModal.tsx:68` and
pass `dirty={ref !== '' || date !== ''}` so a dirty cancel asks before discarding, as every other form does. If the
ERP note matters, add `if (mutation.erpSetupPending) toast(...)` after success with the menu's copy
`projectDetail.erpLink.statusPending`.) Verify green: S3-T2 command.

### S3-T4 Mount it (2 min)
`pages/sales-pipeline/PipelineResults.tsx:127`: replace
`<SalesKanbanBoard projects={kanbanFiltered} onOpen={onOpen} selectedStageIndex={stageIndex} />` with
`<DraggableSalesBoard projects={kanbanFiltered} onOpen={onOpen} selectedStageIndex={stageIndex} />` and import it.
The phone list path (`:195`) keeps `SalesKanbanBoard presentation="list"` (no drag).
Verify: `npm run typecheck`.

### S3-T5 Provider harness for page tests (5 min)
Run `npx vitest run pages/SalesPipeline.test.tsx pages/__tests__/SalesPipeline.*.test.tsx pages/sales-pipeline/__tests__`.
For each file failing with "No QueryClient set", change only its `render(` calls to `renderWithQueryClient(` from
`@/test/renderWithQueryClient` (or wrap in an existing local `QueryClientProvider` helper). No `expect` line changes.
If a failure is anything else, stop and report it. Verify: the same command, all green.

### S3-T6 Scroll-snap off while dragging (2 min)
`index.css` after `.kanban > * {…}` (line ~560): `[data-dragging='true'] .kanban-scroll { scroll-snap-type: none; }`.
Verify: `scripts/ux-proof.sh /sales` and look at the mid-drag capture (S5-T2 produces it).

---

## S4 — Tasks board drag

### S4-T1 Failing tests (AC-DND-009, AC-DND-010) (5 min)
`pages/project-detail/__tests__/TasksTab.boardDnd.test.tsx`. Copy the provider/mocks scaffold of
`pages/project-detail/__tests__/TasksTab.pendingPush.test.tsx` (it already mocks `useTasks`/`useTaskMutations` and wraps
`QueryClientProvider`), add the same `BoardDnd` seam mock as S3-T2, and open the board with `?view=board`.
1. `AC-DND-009: an Engineer drops their own task To Do → In Progress: written with no confirm, "Status updated" shown` —
   `updateStatus.mutateAsync` called with `{ id, status: 'In Progress' }`; no `alertdialog`/`dialog` role present;
   toast text `Status updated`.
2. `AC-DND-009: a task assigned to someone else is not draggable for an Engineer` — its `DraggableCard` mock receives
   `disabled: true` (record the prop in the mock) and `dnd.props.canDrop(otherId, 'Done')` is false.
3. `AC-DND-010: a failed task drop rolls the card back to its column and shows the classified error` —
   `mutateAsync.mockRejectedValueOnce(Object.assign(new Error('denied'), { code: '42501' }))`; card back in `To Do`
   column; toast headline from `classifyMutationError`.
4. `AC-DND-008 (tasks): success keeps the card in the target column until ['tasks', org, project] refetches`.
Verify red: `npx vitest run pages/project-detail/__tests__/TasksTab.boardDnd.test.tsx`.

### S4-T2 `onStatusChange` returns success (3 min)
`pages/project-detail/tabs/TasksTab.tsx:458-475`: change to `async (task, status): Promise<boolean>`; `return false`
on the guard, `return true` after the success toast, `return false` in `catch`. Update `TaskBoardProps.onStatusChange`
(`:930`) and `EditableTaskStatusProps.onChange` (`:145`) types to `(t: TaskWithRefs, s: TaskStatus) => Promise<boolean> | void`.
Verify: `npm run typecheck`.

### S4-T3 Wire `TaskBoard` (5 min)
In `TaskBoard` (`:944-1008`): `const moves = useOptimisticMoves(); const qc = useQueryClient();` and new props
`orgId: string | undefined; projectId: string` passed from the call site (`:816-828`, `currentUser?.org_id`, `projectId`).
`byStatus(s)` filters by `moves.columnOf(task.id, task.status) === s`. Wrap the `<Kanban>` in
`<BoardDnd canDrop={(id, col) => { const tk = byId.get(id); return !!tk && canSetStatus(tk) && col !== tk.status; }} onMove={(id, col) => void dropTask(id, col as TaskStatus)} cardLabel={(id) => byId.get(id)?.name ?? ''} columnLabel={(id) => id} renderOverlay={(id) => <div className="rounded-md border border-border bg-card px-3 py-2.5 text-[13px] font-semibold shadow-[0_10px_30px_hsl(240_10%_8%/0.16)]">{byId.get(id)?.name}</div>}>`;
each `KanbanColumn` inside `<DroppableColumn id={s}>{(dropState) => <KanbanColumn … dropState={dropState}>}</DroppableColumn>`;
each card `div` inside `<DraggableCard id={task.id} disabled={!canSetStatus(task)} moveState={moves.stateOf(task.id)}>`.
```ts
const dropTask = async (id: string, to: TaskStatus) => {
  const task = byId.get(id);
  if (!task || !canSetStatus(task) || to === task.status) return;
  moves.hold(id, to); moves.save(id);
  try {
    const ok = await onStatusChange(task, to);
    if (ok) await qc.invalidateQueries({ queryKey: ['tasks', orgId, projectId] }, { cancelRefetch: false });
  } finally { moves.release(id); }
};
```
Verify green: S4-T1 command, plus the existing Tasks suites (AC-DND-011):
`npx vitest run pages/project-detail/__tests__/TasksTab.test.tsx pages/project-detail/__tests__/TasksTab.pendingPush.test.tsx pages/project-detail/__tests__/TasksTab.rowclick.test.tsx`.

---

## S5 — Journeys, a11y, rendered proof

### S5-T1 Drag helper (3 min)
`e2e/support/boardDrag.ts`:
```ts
import type { Locator, Page } from '@playwright/test';

/** Real pointer drag through dnd-kit's MouseSensor (6 px activation), then a stepped move onto the column. */
export async function dragCardTo(page: Page, card: Locator, column: Locator): Promise<void> {
  const from = await card.boundingBox(); const to = await column.boundingBox();
  if (!from || !to) throw new Error('dragCardTo: card or column not visible');
  const x = from.x + from.width / 2; const y = from.y + Math.min(16, from.height / 2);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 12, y, { steps: 3 });
  await page.mouse.move(to.x + to.width / 2, to.y + 60, { steps: 15 });
  await page.mouse.up();
}
```

### S5-T2 `e2e/AC-DND-014-pipeline-drag.spec.ts` (5 min)
Header: `// @e2e-isolation: self-isolated — creates its own uniquely named deal via service role and deletes it; no shared seed row is moved.`
Shape mirrors `e2e/AC-010-billing-kinds.spec.ts:19-73` (ORG_ID `00000000-0000-0000-0000-000000000001`, service-role
client via `requireServiceRoleKey()`, `beforeEach` insert, `afterEach` cleanup):
```ts
test.use({ viewport: { width: 2200, height: 1100 } }); // all seven columns visible: 7 × 258 px + gaps + rail
// beforeEach: insert { id: PROJECT_ID, org_id: ORG_ID, name: `DND 1637 ${runId}`, status: 'Quotation Submitted',
//   currency: 'USD', contract_value: 0, tax_treatment: 'exclusive', tax_amount: 0 }
//   (contract_value 0 → win eligibility 'allowed' for any write role, migration 0394:43)
// afterEach: delete record_changes for PROJECT_ID, then the project; if a delete returns 23503, add the
//   referencing table named in the error detail to this cleanup (do not skip the delete).
test('AC-DND-014 Exec drags a deal: illegal drop refused, Quotation→Tender confirmed, Tender→Won with contract details persist', async ({ page }) => {
  await signIn(page, 'exec@acme.test');
  await page.goto('/sales');
  const board = page.getByLabel('Sales pipeline board');
  const card = () => board.getByRole('button', { name: new RegExp(DEAL) }).first();
  // 1. refused
  await dragCardTo(page, card(), page.getByTestId('stage-Leads'));
  await expect(page.getByText(`${DEAL} can't move from Quotation to Leads.`)).toBeVisible();
  await expect(page.getByTestId('stage-Quotation Submitted').getByText(DEAL)).toBeVisible();
  // 2. confirm path
  await dragCardTo(page, card(), page.getByTestId('stage-Tender Submitted'));
  await page.getByRole('button', { name: 'Move to Tender Submitted' }).click();
  await page.reload();
  await expect(page.getByTestId('stage-Tender Submitted').getByText(DEAL)).toBeVisible();
  // 3. win path
  await dragCardTo(page, card(), page.getByTestId('stage-Won'));
  await page.getByRole('textbox', { name: /customer contract ref/i }).fill(`CPO-${runId}`);
  await page.getByLabel(/contract date/i).fill('2026-11-01');
  await page.getByRole('button', { name: /^confirm$/i }).click();
  await page.reload();
  await expect(page.getByTestId('stage-Won').getByText(DEAL)).toBeVisible();
  // AC-DND-016: axe on the board (default state) and with the confirm open, using @axe-core/playwright as in e2e/AC-MTG-023-meetings-axe.spec.ts
});
```
Place the two axe checks (board idle; confirm dialog open, before clicking Confirm in step 2) with
`new AxeBuilder({ page }).analyze()` and `expect(results.violations).toEqual([])`.
Verify: `scripts/e2e-local.sh AC-DND-014`.

### S5-T3 `e2e/AC-DND-015-tasks-drag.spec.ts` (4 min)
Header: `// @e2e-isolation: self-isolated — service-role inserts a uniquely named task on the seeded project and deletes it.`
`beforeEach` insert `{ id, org_id: ORG_ID, project_id: '40000000-0000-0000-0000-000000000001', name: `DND task ${runId}`, status: 'To Do' }`;
`afterEach` delete it. Journey: `signIn(page, 'pm@acme.test')`, open the project Tasks tab in Board view (use the same
navigation `e2e/AC-TASK-001-tasks-crud.spec.ts` uses, then pick the Board view control), `dragCardTo` the task card to
the `Done` column (locate the column by its heading `Done`) in a test titled `AC-DND-015 PM drags a task To Do → Done and it persists`, expect the toast `Status updated`, `page.reload()`, the
task is under `Done`; axe on the board (AC-DND-016).
Verify: `scripts/e2e-local.sh AC-DND-015`.

### S5-T4 Rendered proof (3 min)
`scripts/ux-proof.sh /sales` and on the project Tasks board, covering idle, mid-drag (allowed + blocked column cues),
confirm open, win form open, saving. Director does the one rendered review (UI lane).

---

## 4. Review routing

spec-reviewer, code-quality-reviewer, security-auditor on every slice (CLAUDE.md step 5). Security-auditor's S2/S3
focus: the drop sends exactly the menu's RPC arguments; the eligibility preflight is advisory and the RPC stays the
authority (ADR-0019); `can()` gating is on the real role (ADR-0016); no `org_id` from the client. Browser e2e runs in
CI on the release PR to `main` (owner rule 2026-10-30).

## 5. Traceability

| AC | Layer | File | Test title (leading token) |
|---|---|---|---|
| AC-DND-001 | Vitest | `components/salesPipeline.drop.test.ts` | `AC-DND-001: every (status, column) resolves…`, `AC-DND-001: named cases…` |
| AC-DND-002 | Vitest/RTL | `pages/sales-pipeline/__tests__/DraggableSalesBoard.test.tsx` | `AC-DND-002: Leads → Tender is refused…` |
| AC-DND-003 | Vitest/RTL | same | `AC-DND-003: Quotation → Tender opens the menu confirm…` (+ copy test in `projectTransitionCopy.test.ts`) |
| AC-DND-004 | Vitest/RTL | same | `AC-DND-004: Negotiation → Won with eligibility allowed…` |
| AC-DND-005 | Vitest/RTL | same | `AC-DND-005: a non-allowed or failed eligibility check…` |
| AC-DND-006 | Vitest/RTL | same | `AC-DND-006: Tender → Lost needs a choice…` |
| AC-DND-007 | Vitest/RTL | same | `AC-DND-007: a server refusal rolls the card back…` |
| AC-DND-008 | Vitest/RTL | same; tasks variant in `TasksTab.boardDnd.test.tsx` | `AC-DND-008: on success the card stays…` |
| AC-DND-009 | Vitest/RTL | `pages/project-detail/__tests__/TasksTab.boardDnd.test.tsx` | `AC-DND-009: …` (2 tests) |
| AC-DND-010 | Vitest/RTL | same | `AC-DND-010: a failed task drop rolls the card back…` |
| AC-DND-011 | Vitest/RTL (existing) | `components/ProjectStatusControl.test.tsx`, `pages/project-detail/__tests__/TasksTab.*.test.tsx` | existing titles, unchanged |
| AC-DND-012 | Vitest/RTL | `src/components/kanban/__tests__/BoardDnd.test.tsx`, Kanban drop-state test | `AC-DND-012: …` |
| AC-DND-013 | Vitest/RTL | `src/components/kanban/__tests__/BoardDnd.test.tsx` | `AC-DND-013: a click without movement…` |
| AC-DND-014 | Playwright | `e2e/AC-DND-014-pipeline-drag.spec.ts` | `AC-DND-014 Exec drags a deal…` |
| AC-DND-015 | Playwright | `e2e/AC-DND-015-tasks-drag.spec.ts` | `AC-DND-015 PM drags a task To Do → Done…` |
| AC-DND-016 | Playwright + axe | inside AC-DND-014 and AC-DND-015 | axe steps |
| server rules | pgTAP (existing) | `supabase/tests/0027_project_transition_authz.test.sql`, `0028_project_transition_legality.test.sql`, `0029_project_win_path.test.sql`, `0052_task_engineer_status.test.sql` | unchanged |
