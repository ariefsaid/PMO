import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TaskStatusCell } from './TaskStatusCell';
import type { TaskWithRefs } from '@/src/lib/db/tasks';

const task = {
  id: 't1', name: 'Fix leak', status: 'To Do', due_date: null, assignee_id: 'u1',
} as unknown as TaskWithRefs;

describe('TaskStatusCell', () => {
  it('a11y(#2086): the status control announces the current status, not only the task name', () => {
    render(
      <TaskStatusCell
        task={task}
        editable
        disabled={false}
        pendingPush={{ status: 'idle', error: null }}
        onChange={() => {}}
      />,
    );
    const button = screen.getByRole('button');
    // The name carries the visible pill text (the status) as well as the task name.
    expect(button).toHaveAccessibleName('Status for Fix leak: To Do');
  });
});
