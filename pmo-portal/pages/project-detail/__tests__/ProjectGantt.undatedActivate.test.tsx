/**
 * C-PD-1 — Gantt undated task chips must be activatable when onActivateTask is provided.
 * AC-C-PD-1: undated chips gain role=button/keyboard/focus-ring and fire onActivateTask(task).
 * AC-C-PD-1-inert: when onActivateTask is omitted, chips remain inert (no role=button).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import type { TaskWithRefs } from '@/src/lib/db/tasks';
import type { MilestoneWithProgress } from '@/src/lib/db/milestones';
import ProjectGantt from '../ProjectGantt';

function makeTask(overrides: Partial<TaskWithRefs> & { id: string; name: string }): TaskWithRefs {
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

// Undated task: no start_date, no end_date → lands in the UndatedFooter
const undatedTask = makeTask({ id: 'task-u1', name: 'Undated Design Work' });

// Dated task: has start+end → lands in a lane bar (needed so Gantt is not isEmpty)
const datedTask = makeTask({
  id: 'task-d1',
  name: 'Foundation Work',
  start_date: '2026-01-01',
  end_date: '2026-01-15',
});

const tasks = [datedTask, undatedTask];
const milestones: MilestoneWithProgress[] = [];

describe('AC-C-PD-1: Gantt undated chips are activatable when onActivateTask provided', () => {
  it('AC-C-PD-1: undated chip has role=button when onActivateTask is provided', () => {
    const spy = vi.fn();
    render(<ProjectGantt tasks={tasks} milestones={milestones} onActivateTask={spy} />);

    // The undated chip should be a button
    const chip = screen.getByRole('button', { name: /Open Undated Design Work/i });
    expect(chip).toBeInTheDocument();
  });

  it('AC-C-PD-1: click on undated chip fires onActivateTask with the resolved task', () => {
    const spy = vi.fn();
    render(<ProjectGantt tasks={tasks} milestones={milestones} onActivateTask={spy} />);

    const chip = screen.getByRole('button', { name: /Open Undated Design Work/i });
    fireEvent.click(chip);

    expect(spy).toHaveBeenCalledOnce();
    expect(spy).toHaveBeenCalledWith(undatedTask);
  });

  it('AC-C-PD-1: keyboard Enter on undated chip fires onActivateTask', () => {
    const spy = vi.fn();
    render(<ProjectGantt tasks={tasks} milestones={milestones} onActivateTask={spy} />);

    const chip = screen.getByRole('button', { name: /Open Undated Design Work/i });
    fireEvent.keyDown(chip, { key: 'Enter' });

    expect(spy).toHaveBeenCalledOnce();
    expect(spy).toHaveBeenCalledWith(undatedTask);
  });

  it('AC-C-PD-1: keyboard Space on undated chip fires onActivateTask', () => {
    const spy = vi.fn();
    render(<ProjectGantt tasks={tasks} milestones={milestones} onActivateTask={spy} />);

    const chip = screen.getByRole('button', { name: /Open Undated Design Work/i });
    fireEvent.keyDown(chip, { key: ' ' });

    expect(spy).toHaveBeenCalledOnce();
  });
});

describe('AC-C-PD-1-inert: undated chips are inert when onActivateTask is omitted', () => {
  it('AC-C-PD-1-inert: no role=button on undated chip when callback is omitted', () => {
    render(<ProjectGantt tasks={tasks} milestones={milestones} />);

    // The chip text must be present but NOT a button
    expect(screen.getByText('Undated Design Work')).toBeInTheDocument();
    // Must NOT have role=button
    const buttons = screen.queryAllByRole('button');
    const chipBtn = buttons.find((b) => b.textContent?.includes('Undated Design Work'));
    expect(chipBtn).toBeUndefined();
  });
});
