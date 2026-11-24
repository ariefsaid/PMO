import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/** AC-SRC-007: a foreman's new report defaults to the crew they lead; any crew or none can be chosen (docs/specs/site-report-crew-link.spec.md). */
const h = vi.hoisted(() => ({
  userId: 'u1', save: vi.fn(),
  crews: [{ id: 'c1', code: 'CR-1', name: 'Other crew', field_controller_id: 'u9' }, { id: 'c2', code: 'CR-2', name: 'Own crew', field_controller_id: 'u1' }] as unknown[],
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: h.userId, org_id: 'o1' } }) }));
vi.mock('@/src/hooks/useCrews', () => ({ useCrews: () => ({ data: h.crews }) }));
vi.mock('@/src/hooks/useProjects', () => ({ useProjects: () => ({ data: [{ id: 'p1', name: 'Pipeline', short_name: null, project_code: null }] }) }));
vi.mock('@/src/hooks/useDailySiteReports', () => ({ useDailySiteReportMutations: () => ({ save: { mutateAsync: h.save, isPending: false } }) }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { workOrder: { list: async () => [{ id: 'w1', wo_number: 'WO-1', title: 'Pipe run', status: 'Issued' }] } } }));

import { NewSiteReportDialog } from './NewSiteReportDialog';

const open = async () => {
  const user = userEvent.setup();
  const onCreated = vi.fn();
  render(<QueryClientProvider client={new QueryClient()}><NewSiteReportDialog onClose={vi.fn()} onCreated={onCreated} /></QueryClientProvider>);
  await user.selectOptions(screen.getByRole('combobox', { name: /Project/ }), 'p1');
  await waitFor(() => expect(screen.getByRole('option', { name: /WO-1/ })).toBeInTheDocument());
  await user.selectOptions(screen.getByRole('combobox', { name: /Work order/ }), 'w1');
  return { user, onCreated };
};

beforeEach(() => { h.userId = 'u1'; h.save = vi.fn().mockResolvedValue('r1'); });

describe('NewSiteReportDialog crew', () => {
  it('AC-SRC-007 a foreman\'s report defaults to the crew they lead', async () => {
    const { user } = await open();
    expect(screen.getByRole('combobox', { name: /Crew/ })).toHaveValue('c2');
    await user.click(screen.getByRole('button', { name: 'Start report' }));
    await waitFor(() => expect(h.save).toHaveBeenCalledWith(expect.objectContaining({ workOrderId: 'w1', crewId: 'c2' })));
  });

  it('AC-SRC-007 the foreman may pick another crew, or none', async () => {
    const { user } = await open();
    await user.selectOptions(screen.getByRole('combobox', { name: /Crew/ }), '');
    await user.click(screen.getByRole('button', { name: 'Start report' }));
    await waitFor(() => expect(h.save).toHaveBeenCalled());
    expect(h.save.mock.calls[0][0]).not.toHaveProperty('crewId');
  });

  it('AC-SRC-007 someone who leads no crew starts with no crew', async () => {
    h.userId = 'u2';
    await open();
    expect(screen.getByRole('combobox', { name: /Crew/ })).toHaveValue('');
  });
});
