import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import React from 'react';
import ProjectGantt from '../ProjectGantt';
import type { TaskWithRefs } from '@/src/lib/db/tasks';

function makeTask(overrides: Partial<TaskWithRefs>): TaskWithRefs {
  return {
    id: overrides.id ?? 'task-1',
    org_id: 'org1',
    project_id: 'p1',
    milestone_id: null,
    name: overrides.name ?? 'Task',
    status: (overrides.status ?? 'To Do') as TaskWithRefs['status'],
    assignee_id: null,
    start_date: overrides.start_date ?? '2026-01-01',
    end_date: overrides.end_date ?? '2026-01-15',
    completed_at: null,
    created_at: '2026-01-01T00:00:00Z',
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
  };
}

describe('ProjectGantt roving focus fallback when focused row is removed (PGB-020)', () => {
  it('falls back to the first existing task row with tabIndex=0 when the previously focused row is removed', () => {
    const taskA = makeTask({ id: 'task-a', name: 'Task A' });
    const taskB = makeTask({ id: 'task-b', name: 'Task B' });

    const onActivate = vi.fn();
    const { rerender } = render(
      <ProjectGantt tasks={[taskA, taskB]} milestones={[]} onActivateTask={onActivate} />,
    );

    const grid = screen.getByRole('grid');
    // Initial state: Task A has tabIndex=0, Task B has tabIndex=-1
    const rowA = within(grid).getByText('Task A').closest('[role="row"]') as HTMLElement;
    const rowB = within(grid).getByText('Task B').closest('[role="row"]') as HTMLElement;
    expect(rowA).toHaveAttribute('tabindex', '0');
    expect(rowB).toHaveAttribute('tabindex', '-1');

    // Simulate focus on Task B
    fireEvent.focus(rowB);
    expect(rowB).toHaveAttribute('tabindex', '0');
    expect(rowA).toHaveAttribute('tabindex', '-1');

    // Now Task B is removed (e.g. filtered or deleted)
    rerender(<ProjectGantt tasks={[taskA]} milestones={[]} onActivateTask={onActivate} />);

    // Task A must now have tabIndex=0 so keyboard users can still tab into the grid
    const updatedGrid = screen.getByRole('grid');
    const updatedRowA = within(updatedGrid).getByText('Task A').closest('[role="row"]') as HTMLElement;
    expect(updatedRowA).toHaveAttribute('tabindex', '0');
  });
});

describe('Gantt viewport ticks (LIB02-005)', () => {
  it('updates ticks when the single scrollport moves while retaining both dated bars', () => {
    const early = makeTask({ id: 'early', name: 'Early task', start_date: '2000-01-01', end_date: '2000-01-02' });
    const late = makeTask({ id: 'late', name: 'Late task', start_date: '2050-01-01', end_date: '2050-01-02' });
    const { container } = render(<ProjectGantt tasks={[early, late]} milestones={[]} onActivateTask={vi.fn()} />);
    const scroller = container.querySelector('[data-gantt-scroll]') as HTMLElement;
    Object.defineProperty(scroller, 'clientWidth', { configurable: true, writable: true, value: 900 });
    fireEvent.scroll(scroller, { target: { scrollLeft: 0 } });
    fireEvent.click(screen.getByRole('tab', { name: 'Day' }));
    const initialLines = container.querySelectorAll('svg line').length;
    expect(initialLines).toBeLessThan(100);
    Object.defineProperty(scroller, 'clientWidth', { configurable: true, writable: true, value: 1700 });
    fireEvent(window, new Event('resize'));
    expect(container.querySelectorAll('svg line').length).toBeGreaterThan(initialLines);
    expect(screen.getByRole('button', { name: /Early task/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Late task/ })).toBeInTheDocument();
    const initialLabels = Array.from(container.querySelectorAll('[aria-hidden="true"] span')).map((el) => el.textContent);
    fireEvent.scroll(scroller, { target: { scrollLeft: 28 * 10000 } });
    const laterLabels = Array.from(container.querySelectorAll('[aria-hidden="true"] span')).map((el) => el.textContent);
    expect(laterLabels).not.toEqual(initialLabels);
    expect(container.querySelectorAll('svg line').length).toBeLessThan(100);
    expect(screen.getByRole('button', { name: /Late task/ })).toBeInTheDocument();
  });
});
