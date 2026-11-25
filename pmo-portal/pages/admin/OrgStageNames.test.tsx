import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';

const permissions = vi.hoisted(() => ({ manage: true }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => permissions.manage }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'o1' } }) }));
const save = vi.fn().mockResolvedValue(undefined);
vi.mock('@/src/lib/db/stageNames', async (orig) => ({
  ...(await orig<typeof import('@/src/lib/db/stageNames')>()),
  listStageNames: vi.fn().mockResolvedValue([
    'Leads', 'Quotation Submitted', 'PQ Submitted', 'Tender Submitted', 'Negotiation', 'Won, Pending KoM',
    'Ongoing Project', 'On Hold', 'Close Out', 'Loss Tender', 'Declined', 'Internal Project',
  ].map((status) => ({ status, label_en: status === 'Negotiation' ? 'Closing' : null, label_id: null }))),
  saveStageName: (...a: unknown[]) => save(...a),
}));

import OrgStageNames from './OrgStageNames';

const wrap = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider><OrgStageNames /></ToastProvider>
  </QueryClientProvider>,
);

describe('Administration › stage names (#2906)', () => {
  beforeEach(() => { permissions.manage = true; save.mockClear(); });

  it('AC-STG-009: an Admin sees the twelve stages under the four groups', async () => {
    wrap();
    for (const group of ['Pipeline', 'On hand', 'Lost', 'Internal']) {
      expect(await screen.findByRole('heading', { name: group })).toBeInTheDocument();
    }
    expect(screen.getAllByTestId(/^stage-name-row-/)).toHaveLength(12);
  });

  it('AC-STG-009: someone who may not manage stages sees no card', () => {
    permissions.manage = false;
    wrap();
    expect(screen.queryByTestId(/^stage-name-row-/)).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Sales and project stages' })).toBeNull();
  });

  it('AC-STG-006: saving sends both languages; a name another stage shows is refused on screen', async () => {
    wrap();
    const row = await screen.findByTestId('stage-name-row-Tender Submitted');
    await userEvent.type(within(row).getByLabelText('English'), 'Bid sent');
    await userEvent.click(within(row).getByRole('button', { name: 'Save' }));
    expect(save).toHaveBeenCalledWith('Tender Submitted', { en: 'Bid sent', id: '' });

    const leads = screen.getByTestId('stage-name-row-Leads');
    await userEvent.type(within(leads).getByLabelText('English'), 'closing');
    await userEvent.click(within(leads).getByRole('button', { name: 'Save' }));
    expect(await within(leads).findByText('Another stage already has this name')).toBeInTheDocument();
    expect(save).toHaveBeenCalledTimes(1);
  });
});
