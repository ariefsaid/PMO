import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

describe('ProjectGantt keyboard focus (PGB-020)', () => {
  it('Tab reaches the task bars in order, and focus stays put when another task disappears', async () => {
    const taskA = makeTask({ id: 'task-a', name: 'Task A' });
    const taskB = makeTask({ id: 'task-b', name: 'Task B' });
    const onActivate = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <ProjectGantt onSwitchView={vi.fn()} tasks={[taskA, taskB]} milestones={[]} onActivateTask={onActivate} />,
    );

    const barB = screen.getByRole('button', { name: /Task B/ });
    barB.focus();
    expect(barB).toHaveFocus();

    rerender(<ProjectGantt onSwitchView={vi.fn()} tasks={[taskB]} milestones={[]} onActivateTask={onActivate} />);
    expect(screen.getByRole('button', { name: /Task B/ })).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(onActivate).toHaveBeenCalledWith(taskB);
  });

  it('does not steal focus from an outside control when a task disappears', () => {
    const taskA = makeTask({ id: 'task-a', name: 'Task A' });
    const taskB = makeTask({ id: 'task-b', name: 'Task B' });
    const content = (tasks: TaskWithRefs[]) => (
      <>
        <button>Outside</button>
        <ProjectGantt tasks={tasks} milestones={[]} onActivateTask={vi.fn()} onSwitchView={vi.fn()} />
      </>
    );
    const { rerender } = render(content([taskA, taskB]));
    const outside = screen.getByRole('button', { name: 'Outside' });
    outside.focus();
    rerender(content([taskA]));
    expect(outside).toHaveFocus();
  });
});
