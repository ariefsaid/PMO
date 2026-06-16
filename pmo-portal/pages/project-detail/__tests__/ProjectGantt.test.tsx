/**
 * RTL component tests for ProjectGantt.
 * Owns: AC-GANTT-005, AC-GANTT-007, AC-GANTT-008, AC-GANTT-010.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
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
    render(<ProjectGantt tasks={[]} milestones={[]} />);
    expect(screen.getByText(/no dated work yet/i)).toBeInTheDocument();
  });

  it('shows an empty state when all tasks have no dates', () => {
    const tasks = [
      makeTask({ id: 'a', name: 'Undated A' }),
      makeTask({ id: 'b', name: 'Undated B' }),
    ];
    render(<ProjectGantt tasks={tasks} milestones={[]} />);
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
    render(<ProjectGantt tasks={tasks} milestones={[]} />);
    // The undated footer shows the task name
    expect(screen.getByText(/undated/i)).toBeInTheDocument();
    expect(screen.getByText(/no dates task/i)).toBeInTheDocument();
    // The figure (gantt) is present (not empty state)
    expect(screen.getByRole('img')).toBeInTheDocument();
  });

  it('shows "Undated (1)" count label in the footer', () => {
    const tasks = [
      makeTask({ id: 'a', name: 'Has dates', start_date: '2026-01-01', end_date: '2026-01-11' }),
      makeTask({ id: 'b', name: 'No dates task' }),
    ];
    render(<ProjectGantt tasks={tasks} milestones={[]} />);
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
    render(<ProjectGantt tasks={tasks} milestones={[]} onActivateTask={vi.fn()} />);
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
    render(<ProjectGantt tasks={tasks} milestones={[]} onActivateTask={vi.fn()} />);
    const bar = screen.getByRole('button', { name: /No deps task/i });
    expect(bar.getAttribute('aria-label') ?? '').not.toMatch(/depends on/i);
  });
});

// ── AC-GANTT-010: a11y — labelled figure + status text ───────────────────────

describe('AC-GANTT-010: the timeline is a labelled figure and bars label status as text', () => {
  it('the Gantt figure has role="img" and an aria-label', () => {
    const tasks = [
      makeTask({ id: 'a', name: 'Accessible task', start_date: '2026-01-01', end_date: '2026-01-11' }),
    ];
    render(<ProjectGantt tasks={tasks} milestones={[]} />);
    const fig = screen.getByRole('img');
    expect(fig).toBeInTheDocument();
    expect(fig).toHaveAttribute('aria-label');
    expect(fig.getAttribute('aria-label')).not.toBe('');
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
    render(<ProjectGantt tasks={tasks} milestones={[]} />);
    // Status text must appear in the rendered output
    expect(screen.getByText('In Progress')).toBeInTheDocument();
  });

  it('bars show task names as text', () => {
    const tasks = [
      makeTask({ id: 'a', name: 'Survey the site', start_date: '2026-01-01', end_date: '2026-01-11' }),
    ];
    render(<ProjectGantt tasks={tasks} milestones={[]} />);
    // Gantt v2 MS-Project layout renders the name as text in both the table cell and
    // the timeline bar — the goal ("the task name is shown as text") still holds.
    expect(screen.getAllByText('Survey the site').length).toBeGreaterThan(0);
  });
});

// ── AC-GANTT-014: on-axis milestone diamond (the bug fix) ─────────────────────

describe('AC-GANTT-014: milestone renders as an on-axis diamond at its target-date position (not a header badge)', () => {
  it('AC-GANTT-014: a dated milestone renders a diamond positioned at its target-date fraction', () => {
    // Task spans 2026-01-01..2026-01-11 (10 days); milestone target 2026-01-06 → mid-span (~50%).
    const tasks = [
      makeTask({ id: 'a', name: 'Task A', start_date: '2026-01-01', end_date: '2026-01-11', milestone_id: 'ms1' }),
    ];
    const milestones = [
      makeMilestone({ id: 'ms1', name: 'Phase 1', target_date: '2026-01-06', sort_order: 0 }),
    ];
    render(<ProjectGantt tasks={tasks} milestones={milestones} />);

    // The diamond is labelled and positioned ON the axis (not a right-aligned header badge).
    const diamond = screen.getByLabelText(/phase 1 milestone — target 2026-01-06/i);
    expect(diamond).toBeInTheDocument();
    // Its absolute x reflects ~mid-span. With month scale (6px/day), span is extended to
    // include today; assert it is positioned (a non-zero left/x) rather than pinned right.
    const left = diamond.style.left;
    expect(left).toBeTruthy();
    const px = parseFloat(left);
    expect(px).toBeGreaterThan(0);

    // The OLD right-aligned header badge (⬥ {targetIso}) is gone.
    expect(screen.queryByText(/⬥\s*2026-01-06/)).toBeNull();
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
    const { container } = render(<ProjectGantt tasks={tasks} milestones={[]} onActivateTask={vi.fn()} />);

    // A connector <path> exists inside an <svg> in the figure.
    expect(container.querySelector('svg path')).not.toBeNull();

    // The successor bar's accessible name conveys the dependency as text.
    const succ = screen.getByRole('button', { name: /Successor/i });
    expect(succ.getAttribute('aria-label')).toMatch(/depends on/i);
  });
});

// ── AC-GANTT-016: zoom toggle ─────────────────────────────────────────────────

describe('AC-GANTT-016: selecting a scale rebuilds the timeline at that granularity', () => {
  it('AC-GANTT-016: selecting the Day scale sets data-scale="day" and deselects Month', () => {
    const tasks = [
      makeTask({ id: 'a', name: 'Task A', start_date: '2026-01-01', end_date: '2026-03-31' }),
    ];
    const { container } = render(<ProjectGantt tasks={tasks} milestones={[]} />);

    // Default scale is Month.
    const fig = container.querySelector('[data-scale]') as HTMLElement;
    expect(fig.getAttribute('data-scale')).toBe('month');

    fireEvent.click(screen.getByRole('tab', { name: /day/i }));

    expect(fig.getAttribute('data-scale')).toBe('day');
    expect(screen.getByRole('tab', { name: /month/i })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tab', { name: /day/i })).toHaveAttribute('aria-selected', 'true');
  });
});

// ── AC-GANTT-017: keyboard grid + Enter activation ────────────────────────────

describe('AC-GANTT-017: the task table is a keyboard grid and Enter fires onActivateTask', () => {
  it('AC-GANTT-017: ArrowDown moves the focused row and Enter fires onActivateTask', () => {
    const tasks = [
      makeTask({ id: 'a', name: 'First task', start_date: '2026-01-01', end_date: '2026-01-11' }),
      makeTask({ id: 'b', name: 'Second task', start_date: '2026-01-02', end_date: '2026-01-12' }),
    ];
    const spy = vi.fn();
    render(<ProjectGantt tasks={tasks} milestones={[]} onActivateTask={spy} />);

    const grid = screen.getByRole('grid');
    expect(grid).toBeInTheDocument();
    // The figure remains a labelled image.
    expect(screen.getByRole('img')).toBeInTheDocument();

    // Focus the first task row, ArrowDown to the second, Enter activates it.
    const rows = within(grid).getAllByRole('row');
    const taskRows = rows.filter((r) => r.getAttribute('data-row-kind') === 'task');
    expect(taskRows.length).toBe(2);

    taskRows[0].focus();
    fireEvent.keyDown(taskRows[0], { key: 'ArrowDown' });
    fireEvent.keyDown(taskRows[1], { key: 'Enter' });

    expect(spy).toHaveBeenCalledOnce();
    expect(spy).toHaveBeenCalledWith(tasks[1]);
  });
});

// ── AC-GANTT-018: left task table content ─────────────────────────────────────

describe('AC-GANTT-018: the left table shows each task name, status, and date range aligned to its bar', () => {
  it('AC-GANTT-018: the table row shows name, status pill, and compact date range', () => {
    const tasks = [
      makeTask({
        id: 'a',
        name: 'Foundation',
        status: 'In Progress',
        start_date: '2026-01-01',
        end_date: '2026-01-11',
      }),
    ];
    render(<ProjectGantt tasks={tasks} milestones={[]} />);

    const grid = screen.getByRole('grid');
    // Name and status appear within the table grid.
    expect(within(grid).getByText('Foundation')).toBeInTheDocument();
    expect(within(grid).getByText('In Progress')).toBeInTheDocument();
    // B1 fix: date is now compact human format ("Jan 1 – Jan 11"), not ISO.
    // We match the human-readable month abbreviation.
    expect(within(grid).getByText(/Jan\s+\d+\s*–\s*Jan\s+\d+/i)).toBeInTheDocument();
    // ISO dates must NOT appear as-is (that was the starving format).
    expect(within(grid).queryByText(/2026-01-01/)).toBeNull();
  });
});

// ── A3 (fix): narrow bar suppresses in-bar label ─────────────────────────────

describe('A3 (fix): in-bar label is hidden when the bar is narrower than 40px', () => {
  it('A3: a 1-day task at quarter scale (2px/day → 2px bar) does not render an in-bar label', () => {
    // Quarter scale → 2px/day. A 1-day bar is 2px wide — below the 40px threshold.
    // The task name should only appear in the table, not duplicated inside the bar.
    const tasks = [
      makeTask({
        id: 'a',
        name: 'Thin bar task',
        start_date: '2026-06-01',
        end_date: '2026-06-02',
      }),
    ];
    const { container } = render(<ProjectGantt tasks={tasks} milestones={[]} />);

    // Switch to Quarter scale to get 2px/day bars.
    const quarterTab = screen.getByRole('tab', { name: /quarter/i });
    fireEvent.click(quarterTab);

    // The task name appears in the table gridcell (as text).
    const grid = screen.getByRole('grid');
    expect(within(grid).getByText('Thin bar task')).toBeInTheDocument();

    // The bar element(s) inside the timeline (not the grid) should not carry the label text.
    // The timeline bars are absolutely positioned divs outside role="grid".
    // We find the bar div by its class (flex items-center overflow-hidden rounded).
    // A narrow bar should have no inner text span visible.
    const timelinePane = container.querySelector('[style*="overflow-x"]') ??
      container.querySelector('.min-w-0.flex-1');
    // There should be no in-bar text span for narrow bars (the span is not rendered or hidden).
    // We can check that the bar container does not contain the task name text.
    if (timelinePane) {
      const inBarTexts = [...timelinePane.querySelectorAll('.truncate')];
      // If any in-bar text spans are present, they must not contain the task name.
      for (const el of inBarTexts) {
        expect(el.textContent).not.toBe('Thin bar task');
      }
    }
  });

  it('A3: a wide bar (>40px width) at month scale still shows the in-bar label', () => {
    // Month scale → 6px/day. A 30-day bar = 180px → well above threshold.
    const tasks = [
      makeTask({
        id: 'a',
        name: 'Wide bar task',
        start_date: '2026-01-01',
        end_date: '2026-01-31',
      }),
    ];
    render(<ProjectGantt tasks={tasks} milestones={[]} />);

    // The name should appear at least twice: once in the table, once in the bar.
    const allNames = screen.getAllByText('Wide bar task');
    expect(allNames.length).toBeGreaterThanOrEqual(2);
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
    render(<ProjectGantt tasks={tasks} milestones={milestones} />);
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
    render(<ProjectGantt tasks={tasks} milestones={[]} />);

    // The friendly mobile notice is rendered…
    expect(screen.getByTestId('gantt-mobile-notice')).toBeInTheDocument();
    expect(screen.getByText(/best viewed on a wider screen/i)).toBeInTheDocument();

    // …and the cramped Gantt split (the role=grid task table + the role=img figure) is NOT.
    expect(screen.queryByRole('grid')).toBeNull();
    expect(screen.queryByRole('img')).toBeNull();
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
    render(<ProjectGantt tasks={tasks} milestones={[]} />);

    // Full Gantt renders (table grid + figure)…
    expect(screen.getByRole('grid')).toBeInTheDocument();
    expect(screen.getByRole('img')).toBeInTheDocument();
    // …and the mobile notice does not.
    expect(screen.queryByTestId('gantt-mobile-notice')).toBeNull();
  });

  it('AC-GANTT-D1-4: an empty project still shows the honest empty state, not the mobile notice (even at <640px)', () => {
    mockViewport(390);
    render(<ProjectGantt tasks={[]} milestones={[]} />);

    // The honest empty state wins over the narrow notice.
    expect(screen.getByText(/no dated work yet/i)).toBeInTheDocument();
    expect(screen.queryByTestId('gantt-mobile-notice')).toBeNull();
  });

  it('AC-GANTT-D1-5: the mobile notice exposes its title as a heading', () => {
    mockViewport(390);
    const tasks = [
      makeTask({ id: 'a', name: 'Survey the site', start_date: '2026-01-01', end_date: '2026-01-11' }),
    ];
    render(<ProjectGantt tasks={tasks} milestones={[]} />);

    // The styled title is a semantic heading so screen-reader users can jump to it.
    expect(screen.getByRole('heading', { name: /open on a larger screen/i })).toBeInTheDocument();
  });
});
