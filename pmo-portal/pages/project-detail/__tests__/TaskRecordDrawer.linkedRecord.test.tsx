/**
 * AC-RLT-014 (detail) and AC-RLT-016: the drawer shows the followed record and its closing reason; the
 * "Stop following" control is offered only when the caller passes the can('link') gate (onUnlink present).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';

vi.mock('@/src/hooks/useTaskLinkedRecords', () => ({
  useTaskLinkedRecords: () => ({
    data: new Map([['t1', { taskId: 't1', linkType: 'material_request', recordId: 'm1', label: 'MR-0003', status: 'fulfilled', isEndState: true, readable: true }]]),
  }),
}));
vi.mock('@/src/components/comments/CommentsSection', () => ({ CommentsSection: () => null }));
vi.mock('@/src/components/history/RecordHistory', () => ({ RecordHistory: () => null }));
vi.mock('@/src/components/tasks/TaskProofPanel', () => ({ TaskProofPanel: () => null }));

import TaskRecordDrawer from '../tabs/TaskRecordDrawer';
import type { TaskWithRefs } from '@/src/lib/db/tasks';

const task = {
  id: 't1', name: 'Chase delivery', status: 'Done', description: null, end_date: null, priority: null, assignee: null, dependencies: [],
  parent_task_id: null, tombstoned_at: null, archived_at: null, proof_required: false,
  procurement_id: null, expense_claim_id: null, material_request_id: 'm1',
  closed_by_record_type: 'material_request', closed_by_record_status: 'fulfilled',
} as unknown as TaskWithRefs;

const base = {
  task, allTasks: [task], projectId: 'p1', canEdit: false, canArchive: false, canDelete: false, externallyOwned: false,
  pendingPush: { kind: 'idle' } as never, openEdit: vi.fn(), onArchive: vi.fn(), onDelete: vi.fn(), openTask: vi.fn(), onClose: vi.fn(), nestedOpen: false,
};

describe('AC-RLT-014 task drawer', () => {
  it('shows the followed record with its status and why the system closed the task', () => {
    render(<MemoryRouter><TaskRecordDrawer {...base} /></MemoryRouter>);
    expect(screen.getByRole('link', { name: /MR-0003/ })).toHaveAttribute('href', '/material-requests/m1');
    expect(screen.getByText(/Closed automatically: the material request is Delivered/)).toBeInTheDocument();
  });
});

describe('AC-RLT-016 the unlink control follows the gate', () => {
  it('is absent without a link permission and absent on a Done task', () => {
    render(<MemoryRouter><TaskRecordDrawer {...base} onUnlink={vi.fn()} /></MemoryRouter>);
    expect(screen.queryByRole('button', { name: /stop following/i })).toBeNull(); // Done: nothing left to follow
  });
  it('is offered on an open task and clears the link', async () => {
    const onUnlink = vi.fn();
    const open = { ...task, status: 'In Progress', closed_by_record_type: null, closed_by_record_status: null } as unknown as TaskWithRefs;
    render(<MemoryRouter><TaskRecordDrawer {...base} task={open} allTasks={[open]} onUnlink={onUnlink} /></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: /stop following/i }));
    expect(onUnlink).toHaveBeenCalledWith(open);
  });
  it('is not rendered when the caller may not link', () => {
    const open = { ...task, status: 'In Progress' } as unknown as TaskWithRefs;
    render(<MemoryRouter><TaskRecordDrawer {...base} task={open} allTasks={[open]} /></MemoryRouter>);
    expect(screen.queryByRole('button', { name: /stop following/i })).toBeNull();
  });
});
