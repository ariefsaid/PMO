/** FR-WORP-011 / #2615 — a task that names a work order links to its page where the reader may open it. */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import TaskRecordDrawer from './TaskRecordDrawer';

vi.mock('@/src/components/comments/CommentsSection', () => ({ CommentsSection: () => null }));
vi.mock('@/src/components/history/RecordHistory', () => ({ RecordHistory: () => null }));
vi.mock('@/src/components/tasks/TaskProofPanel', () => ({ TaskProofPanel: () => null }));

const task = { id: 't1', name: 'Torque the bolts', status: 'In Progress', assignee: null, assignee_id: null, end_date: null, priority: null,
  dependencies: [], description: null, parent_task_id: null, tombstoned_at: null, archived_at: null, work_order_id: 'w1', proof_required: false };
const base = {
  task: task as never, allTasks: [task as never], projectId: 'p1', canEdit: false, canArchive: false, canDelete: false, externallyOwned: false,
  pendingPush: { state: 'idle' } as never, openEdit: vi.fn(), onArchive: vi.fn(), onDelete: vi.fn(), openTask: vi.fn(), onClose: vi.fn(), nestedOpen: false,
};
const renderDrawer = (workOrders: { id: string; wo_number: string | null; title: string }[]) =>
  render(<MemoryRouter><TaskRecordDrawer {...base} workOrders={workOrders} /></MemoryRouter>);

describe('TaskRecordDrawer work-order link', () => {
  it('links to the work-order page when the caller can read that work order', () => {
    renderDrawer([{ id: 'w1', wo_number: 'WO-0007', title: 'Pump install' }]);
    expect(screen.getByRole('link', { name: 'WO-0007' })).toHaveAttribute('href', '/work-orders/w1');
  });
  it('shows no link when the work order is not readable', () => {
    renderDrawer([]);
    expect(screen.queryByRole('link', { name: /WO-/ })).toBeNull();
    expect(screen.queryByText('Work order')).toBeNull();
  });
});
