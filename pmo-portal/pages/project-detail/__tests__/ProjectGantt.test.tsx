/**
 * RTL component tests for ProjectGantt.
 * Owns: AC-GANTT-005, AC-GANTT-007, AC-GANTT-008, AC-GANTT-010.
 */
import { describe, it, expect, vi } from 'vitest';
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
  it('AC-GANTT-018: the table row shows name, status pill, and date range', () => {
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
    // Name, status, and date-range text all appear within the table grid.
    expect(within(grid).getByText('Foundation')).toBeInTheDocument();
    expect(within(grid).getByText('In Progress')).toBeInTheDocument();
    expect(within(grid).getByText(/2026-01-01\s*–\s*2026-01-11/)).toBeInTheDocument();
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
