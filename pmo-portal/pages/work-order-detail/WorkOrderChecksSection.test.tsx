import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const h = vi.hoisted(() => ({
  role: 'Project Manager' as string,
  rows: [] as unknown[],
  create: vi.fn(),
  update: vi.fn(),
}));
vi.mock('@/src/auth/usePermission', async () => {
  const { can } = await import('@/src/auth/policy');
  return { usePermission: () => (action: never, entity: never, ctx?: object) => can(action, entity, { ...ctx, realRole: h.role } as never) };
});
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'o1' } }) }));
vi.mock('@/src/hooks/useTasks', () => ({
  useAssignableProfiles: () => ({ data: [{ id: 'p1', full_name: 'Lead Engineer', role: 'Engineer' }] }),
  useTaskMutations: () => ({ create: { mutate: h.create, isPending: false }, update: { mutate: h.update, isPending: false } }),
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { task: { list: vi.fn(async () => h.rows) } } }));

import { WorkOrderChecksSection } from './WorkOrderChecksSection';

const task = (id: string, name: string, status: string, owner: string | null, due: string | null) =>
  ({ id, name, status, assignee_id: owner ? `id-${owner}` : null, assignee: owner ? { full_name: owner } : null, end_date: due, archived_at: null });

const renderSection = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <WorkOrderChecksSection workOrderId="wo-1" projectId="p-1" />
  </QueryClientProvider>,
);

describe('AC-WOC-003 a Draft work order shows its checks before issue', () => {
  beforeEach(() => { h.role = 'Project Manager'; h.rows = []; h.create.mockClear(); h.update.mockClear(); });

  it('lists each check with its owner, due date and state, and counts the ones still open', async () => {
    h.rows = [task('t1', 'Drawings checked', 'Done', 'Lead Engineer', '2026-12-01'), task('t2', 'Material checked', 'To Do', 'Material Coordinator', null)];
    renderSection();
    const list = await screen.findByRole('list', { name: 'Checks before issue' });
    const done = within(list).getByText('Drawings checked').closest('li') as HTMLElement;
    expect(within(done).getByText('Lead Engineer')).toBeInTheDocument();
    expect(within(done).getByText('Done')).toBeInTheDocument();
    expect(within(done).getByText(/1 Dec/)).toBeInTheDocument();
    expect(screen.getByTestId('wo-checks-open')).toHaveTextContent('1 of 2 open');
  });

  it('says all are done when none is open, with no open count', async () => {
    h.rows = [task('t1', 'Drawings checked', 'Done', 'Lead Engineer', null)];
    renderSection();
    expect(await screen.findByText('All 1 done')).toBeInTheDocument();
    expect(screen.queryByTestId('wo-checks-open')).not.toBeInTheDocument();
  });

  it('adds a check as a task on this work order', async () => {
    renderSection();
    expect(await screen.findByText('No checks yet.')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Check'), 'Permit checked');
    await userEvent.click(screen.getByRole('button', { name: 'Add check' }));
    expect(h.create).toHaveBeenCalledWith(
      { project_id: 'p-1', work_order_id: 'wo-1', name: 'Permit checked', status: 'To Do', assignee_id: null, end_date: null },
      expect.anything(),
    );
  });

  it('offers no add form to Finance, whom the database refuses a work order link', async () => {
    h.role = 'Finance';
    renderSection();
    expect(await screen.findByText('No checks yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add check' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Check')).not.toBeInTheDocument();
  });
});
