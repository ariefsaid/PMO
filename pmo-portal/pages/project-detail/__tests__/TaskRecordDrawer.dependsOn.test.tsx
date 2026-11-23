/** T6: the drawer says who a dependency waits on and by when, not only its name. */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';

vi.mock('@/src/hooks/useTaskLinkedRecords', () => ({ useTaskLinkedRecords: () => ({ data: new Map() }) }));
vi.mock('@/src/components/comments/CommentsSection', () => ({ CommentsSection: () => null }));
vi.mock('@/src/components/history/RecordHistory', () => ({ RecordHistory: () => null }));
vi.mock('@/src/components/tasks/TaskProofPanel', () => ({ TaskProofPanel: () => null }));

import TaskRecordDrawer from '../tabs/TaskRecordDrawer';
import type { TaskWithRefs } from '@/src/lib/db/tasks';

const mk = (over: Record<string, unknown>) => ({
  id: 't', name: 'Task', status: 'In Progress', description: null, end_date: null, priority: null, assignee: null, dependencies: [],
  parent_task_id: null, tombstoned_at: null, archived_at: null, proof_required: false, ...over,
}) as unknown as TaskWithRefs;

const base = {
  projectId: 'p1', canEdit: false, canArchive: false, canDelete: false, externallyOwned: false,
  pendingPush: { kind: 'idle' } as never, openEdit: vi.fn(), onArchive: vi.fn(), onDelete: vi.fn(), openTask: vi.fn(), onClose: vi.fn(), nestedOpen: false,
};

describe('T6 task drawer: waiting on whom', () => {
  it('lists each dependency with its assignee and due date, and says when one has neither', () => {
    const a = mk({ id: 'a', name: 'Pour slab', assignee: { full_name: 'Sari Dewi' }, end_date: '2026-12-03' });
    const b = mk({ id: 'b', name: 'Cure' });
    const task = mk({ id: 't', name: 'Tile floor', dependencies: [{ depends_on_id: 'a' }, { depends_on_id: 'b' }] });
    render(<MemoryRouter><TaskRecordDrawer {...base} task={task} allTasks={[task, a, b]} /></MemoryRouter>);
    const first = screen.getByText('Pour slab').closest('li')!;
    expect(first).toHaveTextContent('Sari Dewi');
    expect(first).toHaveTextContent('3 Dec');
    const second = screen.getByText('Cure').closest('li')!;
    expect(second).toHaveTextContent('Unassigned · No due date');
  });
});
