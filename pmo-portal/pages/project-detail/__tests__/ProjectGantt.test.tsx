import '@/test/stubGetAnimations';
/**
 * RTL component tests for ProjectGantt.
 * Owns: AC-GANTT-005, AC-GANTT-007, AC-GANTT-008, AC-GANTT-010.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import type { TaskWithRefs } from '@/src/lib/db/tasks';
import type { MilestoneWithProgress } from '@/src/lib/db/milestones';

// helpers
function makeTask(
  overrides: Partial<TaskWithRefs> & { id: string; name: string },
): TaskWithRefs {
  return {
    org_id: 'org-1',
    project_id: 'p1',
    status: 'To Do',
    assignee_id: null,
    milestone_id: null,
    created_at: '2026-01-01T00:00:00Z',
    completed_at: null,
    created_by: null,
    tombstoned_at: null,
    meeting_id: null,
    source_updated_at: null,
    description: null,
    priority: null,
    parent_task_id: null,
    archived_at: null,
    assignee: null,
    dependencies: [],
    start_date: null,
    end_date: null,
    ...overrides,
  };
}

function makeMilestone(
  overrides: Partial<MilestoneWithProgress> & { id: string; name: string },
): MilestoneWithProgress {
  return {
    project_id: 'p1',
    sort_order: 0,
    target_date: null,
    weight: 10,
    input_pct: null,
    task_count: 0,
    calculated_pct: null,
    effective_pct: 0,
    ...overrides,
  };
}

import ProjectGantt from '../ProjectGantt';

// ── AC-GANTT-007: empty state ─────────────────────────────────────────────────

describe('AC-GANTT-007: no dated work shows an honest empty state', () => {
  it('shows an empty state when no tasks and no milestones', () => {
    render(<ProjectGantt tasks={[]} milestones={[]} onSwitchView={vi.fn()} />);
    expect(screen.getByText(/no dated work yet/i)).toBeInTheDocument();
  });

  it('shows an empty state when all tasks have no dates', () => {
    const tasks = [
      makeTask({ id: 'a', name: 'Undated A' }),
      makeTask({ id: 'b', name: 'Undated B' }),
    ];
    render(<ProjectGantt tasks={tasks} milestones={[]} onSwitchView={vi.fn()} />);
    expect(screen.getByText(/no dated work yet/i)).toBeInTheDocument();
  });
});

// ── AC-GANTT-005: undated footer ──────────────────────────────────────────────

describe('AC-GANTT-005: a task with no dates is listed in the Undated footer', () => {
  it('shows undated task in the Undated footer but not as a bar when mixed', () => {
    const tasks = [
      makeTask({ id: 'a', name: 'Has dates', start_date: '2026-01-01', end_date: '2026-01-11' }),
      makeTask({ id: 'b', name: 'No dates task' }),
    ];
    render(<ProjectGantt tasks={tasks} milestones={[]} onSwitchView={vi.fn()} />);
    // The undated footer shows the task name
    expect(screen.getByText(/undated/i)).toBeInTheDocument();
    expect(screen.getByText(/no dates task/i)).toBeInTheDocument();
    // The figure (gantt) is present (not empty state)
    expect(screen.getByRole('figure')).toBeInTheDocument();
  });

  it('shows "Undated (1)" count label in the footer', () => {
    const tasks = [
      makeTask({ id: 'a', name: 'Has dates', start_date: '2026-01-01', end_date: '2026-01-11' }),
      makeTask({ id: 'b', name: 'No dates task' }),
    ];
    render(<ProjectGantt tasks={tasks} milestones={[]} onSwitchView={vi.fn()} />);
    expect(screen.getByText(/undated \(1\)/i)).toBeInTheDocument();
  });
});

// ── AC-GANTT-008: dependency relationship conveyed as text ────────────────────
//
// Gantt v2 (ADR-0031) replaces the inline "depends on N" text chip with a DRAWN
// connector (AC-GANTT-015). This is a deliberate UX change — so the goal-oracle of
// AC-GANTT-008 ("the dependency relationship is communicated, never SVG-only")
// migrates from the removed visible chip to the successor bar's aria-label, which
// is what screen readers receive. The drawn-connector half is owned by AC-GANTT-015.

describe('AC-GANTT-008: a task with dependencies conveys the relationship as accessible text', () => {
  it('AC-GANTT-008: the successor bar aria-label names the dependency when it has deps', () => {
    const tasks = [
      makeTask({ id: 'x', name: 'Upstream', start_date: '2026-01-01', end_date: '2026-01-06' }),
      makeTask({
        id: 'a',
        name: 'Task with deps',
        start_date: '2026-01-06',
        end_date: '2026-01-11',
        dependencies: [{ depends_on_id: 'x' }],
      }),
    ];
    render(<ProjectGantt tasks={tasks} milestones={[]} onActivateTask={vi.fn()} onSwitchView={vi.fn()} />);
    const bar = screen.getByRole('button', { name: /Task with deps/i });
    expect(bar.getAttribute('aria-label')).toMatch(/depends on/i);
  });

  it('AC-GANTT-008: a task with no dependencies does NOT mention "depends on"', () => {
    const tasks = [
      makeTask({
        id: 'a',
        name: 'No deps task',
        start_date: '2026-01-01',
        end_date: '2026-01-11',
        dependencies: [],
      }),
    ];
    render(<ProjectGantt tasks={tasks} milestones={[]} onActivateTask={vi.fn()} onSwitchView={vi.fn()} />);
    const bar = screen.getByRole('button', { name: /No deps task/i });
    expect(bar.getAttribute('aria-label') ?? '').not.toMatch(/depends on/i);
  });
});

// ── AC-GANTT-010: a11y — labelled figure + status text ───────────────────────

describe('AC-GANTT-010: the timeline is a labelled figure and bars label status as text', () => {
  it('the labelled Gantt figure leaves its interactive descendants independently reachable', () => {
    const tasks = [
      makeTask({ id: 'a', name: 'Accessible task', start_date: '2026-01-01', end_date: '2026-01-11' }),
    ];
    render(<ProjectGantt tasks={tasks} milestones={[]} onSwitchView={vi.fn()} />);
    const fig = screen.getByRole('figure');
    expect(fig).toBeInTheDocument();
    expect(fig).toHaveAttribute('aria-label');
    expect(fig.getAttribute('aria-label')).not.toBe('');
    expect(screen.getByRole('button', { name: /Accessible task/i })).toBeInTheDocument();
  });

  it('each bar shows the task status as text (not color-only)', () => {
    const tasks = [
      makeTask({
        id: 'a',
        name: 'In progress task',
        start_date: '2026-01-01',
        end_date: '2026-01-11',
        status: 'In Progress',
      }),
    ];
    render(<ProjectGantt tasks={tasks} milestones={[]} onSwitchView={vi.fn()} />);
    // Status text must appear in the rendered output
    expect(screen.getByText('In progress')).toBeInTheDocument();
  });

  it('bars show task names as text', () => {
    const tasks = [
      makeTask({ id: 'a', name: 'Survey the site', start_date: '2026-01-01', end_date: '2026-01-11' }),
    ];
    render(<ProjectGantt tasks={tasks} milestones={[]} onSwitchView={vi.fn()} />);
    // Gantt v2 MS-Project layout renders the name as text in both the table cell and
    // the timeline bar — the goal ("the task name is shown as text") still holds.
    expect(screen.getAllByText('Survey the site').length).toBeGreaterThan(0);
  });
});

// ── AC-GANTT-015: dependency connectors ───────────────────────────────────────

describe('AC-GANTT-015: a dependency between two dated tasks draws a connector and labels the relationship', () => {
  it('AC-GANTT-015: a connector path is drawn and the successor bar names the dependency', () => {
    const tasks = [
      makeTask({ id: 'a', name: 'Predecessor', start_date: '2026-01-01', end_date: '2026-01-06' }),
      makeTask({
        id: 'b',
        name: 'Successor',
        start_date: '2026-01-06',
        end_date: '2026-01-11',
        dependencies: [{ depends_on_id: 'a' }],
      }),
    ];
    const { container } = render(<ProjectGantt tasks={tasks} milestones={[]} onActivateTask={vi.fn()} onSwitchView={vi.fn()} />);

    // A connector <path> exists inside an <svg> in the figure.
    expect(container.querySelector('svg path')).not.toBeNull();

    // The successor bar's accessible name conveys the dependency as text.
    const succ = screen.getByRole('button', { name: /Successor/i });
    expect(succ.getAttribute('aria-label')).toMatch(/depends on/i);
  });
});

// ── AC-GANTT-016: zoom toggle ─────────────────────────────────────────────────

describe('AC-GANTT-016: selecting a scale rebuilds the timeline at that granularity', () => {
  it('AC-GANTT-016: selecting the Day scale sets data-scale="day"', async () => {
    const tasks = [
      makeTask({ id: 'a', name: 'Task A', start_date: '2026-01-01', end_date: '2026-03-31' }),
    ];
    const { container } = render(<ProjectGantt tasks={tasks} milestones={[]} onSwitchView={vi.fn()} />);

    const fig = container.querySelector('[data-scale]') as HTMLElement;
    expect(fig.getAttribute('data-scale')).toBe('month');

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /timeline zoom/i }));
    await user.click(await screen.findByRole('menuitem', { name: /^day$/i }));

    expect(fig.getAttribute('data-scale')).toBe('day');
  });
});

// ── AC-GANTT-017: keyboard activation ─────────────────────────────────────────

describe('AC-GANTT-017: a focused bar activates its task on Enter', () => {
  it('AC-GANTT-017: Enter on the second task bar fires onActivateTask with that task', async () => {
    const tasks = [
      makeTask({ id: 'a', name: 'First task', start_date: '2026-01-01', end_date: '2026-01-11' }),
      makeTask({ id: 'b', name: 'Second task', start_date: '2026-01-02', end_date: '2026-01-12' }),
    ];
    const spy = vi.fn();
    render(<ProjectGantt tasks={tasks} milestones={[]} onActivateTask={spy} onSwitchView={vi.fn()} />);

    const bar = screen.getByRole('button', { name: /Second task/i });
    bar.focus();
    await userEvent.setup().keyboard('{Enter}');

    expect(spy).toHaveBeenCalledOnce();
    expect(spy).toHaveBeenCalledWith(tasks[1]);
  });
});

// ── AC-GANTT-018: left task table content ─────────────────────────────────────

describe('AC-GANTT-018: the left table shows each task name, status, and date range aligned to its bar', () => {
  it('AC-GANTT-018: the task row shows name, status pill, and compact date range', () => {
    const tasks = [
      makeTask({
        id: 'a',
        name: 'Foundation',
        status: 'In Progress',
        start_date: '2026-01-01',
        end_date: '2026-01-11',
      }),
    ];
    const { container } = render(<ProjectGantt tasks={tasks} milestones={[]} onSwitchView={vi.fn()} />);

    const row = container.querySelector('[data-slot="gantt-row-group"][data-gantt-row-id="a"]') as HTMLElement;
    expect(within(row).getByText('Foundation')).toBeInTheDocument();
    expect(within(row).getByText('In progress')).toBeInTheDocument();
    expect(within(row).getByText(/Jan\s+\d+\s*–\s*Jan\s+\d+/i)).toBeInTheDocument();
    expect(within(row).queryByText(/2026-01-01/)).toBeNull();
  });
});

// ── A3 (fix): a wide bar keeps its label ─────────────────────────────────────

describe('A3 (fix): a wide bar still shows its task name', () => {
  it('A3: a wide bar at month scale still shows the in-bar label', () => {
    const tasks = [
      makeTask({
        id: 'a',
        name: 'Wide bar task',
        start_date: '2026-01-01',
        end_date: '2026-01-31',
      }),
    ];
    render(<ProjectGantt tasks={tasks} milestones={[]} onSwitchView={vi.fn()} />);

    // Once in the task tree, once in the bar.
    expect(screen.getAllByText('Wide bar task').length).toBeGreaterThanOrEqual(2);
  });
});

// ── Milestone lane headers ────────────────────────────────────────────────────

describe('milestone lane headers', () => {
  it('renders milestone names as lane headers', () => {
    const tasks = [
      makeTask({ id: 'a', name: 'Task A', start_date: '2026-01-01', end_date: '2026-01-11', milestone_id: 'ms1' }),
    ];
    const milestones = [
      makeMilestone({ id: 'ms1', name: 'Phase 1', sort_order: 0 }),
    ];
    render(<ProjectGantt tasks={tasks} milestones={milestones} onSwitchView={vi.fn()} />);
    expect(screen.getByText('Phase 1')).toBeInTheDocument();
  });
});

// ── AC-GANTT-D1: mobile (<640px) Timeline fallback ────────────────────────────
//
// Defect D1: the MS-Project split layout (260px task table + scroll timeline)
// is unusable at 390px — the table eats the width and leaves a sliver for the
// timeline. Below the `sm` (640px) breakpoint the Timeline swaps the cramped
// Gantt for a friendly notice that points the user at List/Board instead.
// Desktop (>=640px) is unchanged. (Owner decision, 2026-06-16.)

/**
 * A viewport-aware matchMedia mock: returns `matches` based on a chosen viewport
 * width so the responsive hooks the Gantt stack reads all agree.
 *   - useIsNarrow            → (max-width: 639px) → width ≤ 639
 *   - useIsDesktop (if used) → (min-width: 768px) → width ≥ 768
 *   - prefers-reduced-motion → not matched (false), matching the global default
 */
function mockViewport(width: number) {
  const matchesFor = (query: string): boolean =>
    /max-width:\s*639px/.test(query)
      ? width <= 639
      : /min-width:\s*768px/.test(query)
        ? width >= 768
        : false;
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string): MediaQueryList => ({
      matches: matchesFor(query),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })),
  );
}

describe('AC-GANTT-D1: mobile (<640px) Timeline fallback notice', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('AC-GANTT-D1-1: at <640px the Timeline shows the mobile notice instead of the Gantt grid', () => {
    mockViewport(390);
    const tasks = [
      makeTask({ id: 'a', name: 'Survey the site', start_date: '2026-01-01', end_date: '2026-01-11' }),
    ];
    render(<ProjectGantt tasks={tasks} milestones={[]} onSwitchView={vi.fn()} />);

    // The friendly mobile notice is rendered…
    expect(screen.getByTestId('gantt-mobile-notice')).toBeInTheDocument();
    expect(screen.getByText(/best viewed on a wider screen/i)).toBeInTheDocument();

    // …and the cramped Gantt split (the task bars + the figure) is NOT.
    expect(screen.queryByRole('figure')).toBeNull();
  });

  it('AC-GANTT-D1-2: the mobile notice switch buttons call onSwitchView with list/board', () => {
    mockViewport(390);
    const tasks = [
      makeTask({ id: 'a', name: 'Survey the site', start_date: '2026-01-01', end_date: '2026-01-11' }),
    ];
    const onSwitchView = vi.fn();
    render(<ProjectGantt tasks={tasks} milestones={[]} onSwitchView={onSwitchView} />);

    fireEvent.click(screen.getByRole('button', { name: /list view/i }));
    expect(onSwitchView).toHaveBeenCalledWith('list');

    fireEvent.click(screen.getByRole('button', { name: /board view/i }));
    expect(onSwitchView).toHaveBeenCalledWith('board');
  });

  it('AC-GANTT-D1-3: at >=640px the Gantt renders normally (no mobile notice)', () => {
    mockViewport(1280);
    const tasks = [
      makeTask({ id: 'a', name: 'Survey the site', start_date: '2026-01-01', end_date: '2026-01-11' }),
    ];
    render(<ProjectGantt tasks={tasks} milestones={[]} onSwitchView={vi.fn()} />);

    // Full Gantt renders (task bar + figure)…
    expect(screen.getByRole('button', { name: /Survey the site/i })).toBeInTheDocument();
    expect(screen.getByRole('figure')).toBeInTheDocument();
    // …and the mobile notice does not.
    expect(screen.queryByTestId('gantt-mobile-notice')).toBeNull();
  });

  it('AC-GANTT-D1-4: an empty project still shows the honest empty state, not the mobile notice (even at <640px)', () => {
    mockViewport(390);
    render(<ProjectGantt tasks={[]} milestones={[]} onSwitchView={vi.fn()} />);

    // The honest empty state wins over the narrow notice.
    expect(screen.getByText(/no dated work yet/i)).toBeInTheDocument();
    expect(screen.queryByTestId('gantt-mobile-notice')).toBeNull();
  });

  it('AC-GANTT-D1-5: the mobile notice exposes its title as a heading', () => {
    mockViewport(390);
    const tasks = [
      makeTask({ id: 'a', name: 'Survey the site', start_date: '2026-01-01', end_date: '2026-01-11' }),
    ];
    render(<ProjectGantt tasks={tasks} milestones={[]} onSwitchView={vi.fn()} />);

    // The styled title is a semantic heading so screen-reader users can jump to it.
    expect(screen.getByRole('heading', { name: /open on a larger screen/i })).toBeInTheDocument();
  });
});
