/**
 * RTL component tests for ProjectGantt.
 * Owns: AC-GANTT-005, AC-GANTT-007, AC-GANTT-008, AC-GANTT-010.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
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

// ── AC-GANTT-008: depends-on text chip ───────────────────────────────────────

describe('AC-GANTT-008: tasks with dependency edges show a "depends on N" chip', () => {
  it('renders "depends on 2" text chip for a task with 2 dependencies', () => {
    const tasks = [
      makeTask({
        id: 'a',
        name: 'Task with deps',
        start_date: '2026-01-01',
        end_date: '2026-01-11',
        dependencies: [{ depends_on_id: 'x' }, { depends_on_id: 'y' }],
      }),
    ];
    render(<ProjectGantt tasks={tasks} milestones={[]} />);
    expect(screen.getByText(/depends on 2/i)).toBeInTheDocument();
  });

  it('does NOT render a depends-on chip for tasks with no dependencies', () => {
    const tasks = [
      makeTask({
        id: 'a',
        name: 'No deps task',
        start_date: '2026-01-01',
        end_date: '2026-01-11',
        dependencies: [],
      }),
    ];
    render(<ProjectGantt tasks={tasks} milestones={[]} />);
    expect(screen.queryByText(/depends on/i)).not.toBeInTheDocument();
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
    expect(screen.getByText('Survey the site')).toBeInTheDocument();
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
