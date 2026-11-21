/** AC-TGM-010 (#2679): the task-group manager is manager-only and invisible while a non-manager has nothing to see. */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

const h = vi.hoisted(() => ({
  may: vi.fn(),
  groups: [] as Array<{ id: string; name: string; milestone_id: string | null; archived_at: string | null }>,
  create: vi.fn(async () => undefined),
  update: vi.fn(async () => undefined),
}));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => h.may }));
vi.mock('@/src/hooks/useTaskGroups', () => ({
  useTaskGroups: () => ({ data: h.groups }),
  useTaskGroupMutations: () => ({
    create: { mutateAsync: h.create, isPending: false },
    update: { mutateAsync: h.update, isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
  }),
}));
vi.mock('@/src/components/ui', async (orig) => ({ ...(await orig<typeof import('@/src/components/ui')>()), useToast: () => ({ toast: vi.fn() }) }));

import TaskGroupsPanel from './TaskGroupsPanel';
import type { TaskWithRefs } from '@/src/lib/db/tasks';
import type { MilestoneWithProgress } from '@/src/lib/db/milestones';

const task = (id: string, status: string, group: string | null): TaskWithRefs =>
  ({ id, status, milestone_id: null, parent_task_id: null, archived_at: null, task_group_id: group } as unknown as TaskWithRefs);
const phases = [{ id: 'M1', name: 'Phase one' }] as unknown as MilestoneWithProgress[];
const tasks = [task('a', 'Done', 'G1'), task('b', 'To Do', 'G1')];

beforeEach(() => {
  h.groups = [];
  h.may.mockReset();
  h.create.mockClear();
  h.update.mockClear();
});

describe('TaskGroupsPanel', () => {
  it('AC-TGM-010: renders nothing for a non-manager while the project has no group', () => {
    h.may.mockReturnValue(false);
    const { container } = render(<TaskGroupsPanel projectId="p" tasks={tasks} milestones={phases} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('AC-TGM-010: a non-manager sees groups and their progress but no write control', async () => {
    h.may.mockReturnValue(false);
    h.groups = [{ id: 'G1', name: 'Foundations', milestone_id: 'M1', archived_at: null }];
    render(<TaskGroupsPanel projectId="p" tasks={tasks} milestones={phases} />);
    await userEvent.click(screen.getByRole('button', { name: /task groups/i }));
    expect(screen.getByText('Foundations')).toBeInTheDocument();
    expect(screen.getByText(/1 of 2 done/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add group/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /archive/i })).not.toBeInTheDocument();
  });

  it('AC-TGM-010: a manager creates a group and links it to a phase', async () => {
    h.may.mockImplementation((action: string, entity: string) => action === 'edit' && entity === 'milestone');
    h.groups = [{ id: 'G1', name: 'Foundations', milestone_id: null, archived_at: null }];
    render(<TaskGroupsPanel projectId="p" tasks={tasks} milestones={phases} />);
    await userEvent.click(screen.getByRole('button', { name: /task groups/i }));
    await userEvent.type(screen.getByLabelText(/new group name/i), 'Roofing');
    await userEvent.click(screen.getByRole('button', { name: /add group/i }));
    await waitFor(() => expect(h.create).toHaveBeenCalledWith({ name: 'Roofing' }));
    await userEvent.selectOptions(screen.getByLabelText('Phase'), 'M1');
    await waitFor(() => expect(h.update).toHaveBeenCalledWith({ id: 'G1', patch: { milestone_id: 'M1' } }));
  });
});
