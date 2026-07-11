/**
 * AC-JR-W5-01 (part 1) — ProjectGantt `onActivateTask` / GanttBarRow `onActivate`.
 *
 * Spec override (owner directive): the prior spec marked the Gantt read-only by
 * design. The owner explicitly directs making Gantt bars activate a task. This
 * test covers the SHARED SEAM only (T22) — wiring TasksTab to pass `onActivateTask`
 * is consumer task T23 and is NOT covered here.
 *
 * Reference: docs/plans/2026-06-15-jtbd-remediation.md W5-T22.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import type { TaskWithRefs } from '@/src/lib/db/tasks';
import type { MilestoneWithProgress } from '@/src/lib/db/milestones';
import ProjectGantt from '../ProjectGantt';

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
    tombstoned_at: null,
    source_updated_at: null,
    assignee: null,
    dependencies: [],
    start_date: null,
    end_date: null,
    ...overrides,
  };
}

const datatedTask = makeTask({
  id: 'task-1',
  name: 'Foundation Work',
  start_date: '2026-01-01',
  end_date: '2026-01-15',
});

const tasks = [datatedTask];
const milestones: MilestoneWithProgress[] = [];

describe('AC-JR-W5-01: ProjectGantt onActivateTask / GanttBarRow onActivate', () => {
  it('AC-JR-W5-01: bar has role=button and calls onActivateTask with the task when clicked', () => {
    const spy = vi.fn();
    render(<ProjectGantt tasks={tasks} milestones={milestones} onActivateTask={spy} />);

    // The bar should be a button (role=button)
    const btn = screen.getByRole('button', { name: /Foundation Work/i });
    expect(btn).toBeInTheDocument();

    fireEvent.click(btn);
    expect(spy).toHaveBeenCalledOnce();
    expect(spy).toHaveBeenCalledWith(datatedTask);
  });

  it('AC-JR-W5-01: bar activates via keyboard Enter', async () => {
    const spy = vi.fn();
    render(<ProjectGantt tasks={tasks} milestones={milestones} onActivateTask={spy} />);

    const btn = screen.getByRole('button', { name: /Foundation Work/i });
    btn.focus();
    fireEvent.keyDown(btn, { key: 'Enter' });
    expect(spy).toHaveBeenCalledOnce();
    expect(spy).toHaveBeenCalledWith(datatedTask);
  });

  it('AC-JR-W5-01: bar activates via keyboard Space', () => {
    const spy = vi.fn();
    render(<ProjectGantt tasks={tasks} milestones={milestones} onActivateTask={spy} />);

    const btn = screen.getByRole('button', { name: /Foundation Work/i });
    btn.focus();
    fireEvent.keyDown(btn, { key: ' ' });
    expect(spy).toHaveBeenCalledOnce();
  });

  it('AC-JR-W5-01: without onActivateTask the bar has NO button role (inert display)', () => {
    render(<ProjectGantt tasks={tasks} milestones={milestones} />);
    // Bar text is still visible but not a button.
    // (Gantt v2 MS-Project layout shows the name in both the table cell and the bar.)
    expect(screen.queryByRole('button', { name: /Foundation Work/i })).toBeNull();
    expect(screen.getAllByText('Foundation Work').length).toBeGreaterThan(0);
  });

  it('AC-JR-W5-01: bar has cursor-pointer class when onActivateTask is provided', () => {
    const spy = vi.fn();
    render(<ProjectGantt tasks={tasks} milestones={milestones} onActivateTask={spy} />);
    const btn = screen.getByRole('button', { name: /Foundation Work/i });
    expect(btn.className).toContain('cursor-pointer');
  });

  it('AC-JR-W5-01: bar has focus-visible ring class when onActivateTask is provided', () => {
    const spy = vi.fn();
    render(<ProjectGantt tasks={tasks} milestones={milestones} onActivateTask={spy} />);
    const btn = screen.getByRole('button', { name: /Foundation Work/i });
    expect(btn.className).toContain('focus-visible:');
  });
});
