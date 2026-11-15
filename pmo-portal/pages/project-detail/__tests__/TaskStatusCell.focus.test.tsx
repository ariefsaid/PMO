/**
 * #2084 — after a keyboard user picks a status, focus returns to that task's status control
 * (the select unmounts; focus must not fall to <body>).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { IDLE_PENDING_PUSH } from '@/src/lib/adapterSeam/pendingPush';
import type { TaskWithRefs } from '@/src/lib/db/tasks';
import { TaskStatusCell } from '../tabs/TaskStatusCell';

const task = { id: 't1', name: 'Pour slab', status: 'To Do' } as unknown as TaskWithRefs;

describe('TaskStatusCell focus (#2084)', () => {
  it('returns focus to the status control after a status is picked by keyboard', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <TaskStatusCell task={task} editable disabled={false} pendingPush={IDLE_PENDING_PUSH} onChange={onChange} />,
    );
    await user.click(screen.getByRole('button', { name: /^Status for Pour slab/ }));
    const select = screen.getByRole('combobox', { name: /^Status for Pour slab/ });
    expect(select).toHaveFocus();
    await user.selectOptions(select, 'In Progress');
    expect(onChange).toHaveBeenCalledWith(task, 'In Progress');
    rerender(
      <TaskStatusCell task={{ ...task, status: 'In Progress' } as TaskWithRefs} editable disabled={false} pendingPush={IDLE_PENDING_PUSH} onChange={onChange} />,
    );
    expect(screen.getByRole('button', { name: /^Status for Pour slab/ })).toHaveFocus();
  });
});
