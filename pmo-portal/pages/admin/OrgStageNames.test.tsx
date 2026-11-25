import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';

const permissions = vi.hoisted(() => ({ manage: true }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => permissions.manage }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'o1' } }) }));
const saveMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@/src/lib/db/stageNames', async (orig) => ({
  ...(await orig<typeof import('@/src/lib/db/stageNames')>()),
  listStageNames: vi.fn().mockResolvedValue([
    'Leads', 'Quotation Submitted', 'PQ Submitted', 'Tender Submitted', 'Negotiation', 'Won, Pending KoM',
    'Ongoing Project', 'On Hold', 'Close Out', 'Loss Tender', 'Declined', 'Internal Project',
  ].map((status) => ({ status, label_en: status === 'Negotiation' ? 'Closing' : null, label_id: null }))),
  saveStageName: (...a: unknown[]) => saveMock(...a),
}));

import OrgStageNames from './OrgStageNames';

const wrap = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider><OrgStageNames /></ToastProvider>
  </QueryClientProvider>,
);

describe('Administration › stage names (#2906)', () => {
  beforeEach(() => { permissions.manage = true; saveMock.mockReset(); saveMock.mockResolvedValue(undefined); });

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

  it('AC-STG-006: one Save writes every changed name and leaves unchanged rows alone', async () => {
    wrap();
    const tender = await screen.findByTestId('stage-name-row-Tender Submitted');
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    await userEvent.type(within(tender).getByLabelText('Tender submitted, English name'), 'Bid sent');
    await userEvent.type(within(screen.getByTestId('stage-name-row-Leads')).getByLabelText('Leads, Bahasa Indonesia name'), 'Calon');
    expect(save).toBeEnabled();
    await userEvent.click(save);
    expect(saveMock).toHaveBeenCalledTimes(2);
    expect(saveMock).toHaveBeenCalledWith('Tender Submitted', { en: 'Bid sent', id: '' });
    expect(saveMock).toHaveBeenCalledWith('Leads', { en: '', id: 'Calon' });
  });

  it('AC-STG-006: a name another stage shows is refused on its row and nothing is saved', async () => {
    wrap();
    const leads = await screen.findByTestId('stage-name-row-Leads');
    await userEvent.type(within(leads).getByLabelText('Leads, English name'), 'closing');
    await userEvent.type(within(screen.getByTestId('stage-name-row-Tender Submitted')).getByLabelText('Tender submitted, English name'), 'Bid sent');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await within(leads).findByText('Another stage already has this name')).toBeInTheDocument();
    expect(saveMock).not.toHaveBeenCalled();
  });

  it('a row the database refuses shows its own refusal; the other rows still save', async () => {
    saveMock.mockImplementation(async (status: string) => { if (status === 'Leads') throw new Error('not authorized'); });
    wrap();
    await userEvent.type(await within(await screen.findByTestId('stage-name-row-Leads')).findByLabelText('Leads, English name'), 'Prospect');
    await userEvent.type(within(screen.getByTestId('stage-name-row-Tender Submitted')).getByLabelText('Tender submitted, English name'), 'Bid sent');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByTestId('stage-name-error-Leads')).toBeInTheDocument();
    expect(screen.queryByTestId('stage-name-error-Tender Submitted')).toBeNull();
  });

  it('one header row names the columns; inputs show the shipped name as placeholder', async () => {
    wrap();
    await screen.findByTestId('stage-name-row-Leads');
    expect(screen.getAllByText('English')).toHaveLength(1);
    expect(screen.getAllByText('Bahasa Indonesia')).toHaveLength(1);
    expect(screen.getByLabelText('Tender submitted, English name')).toHaveAttribute('placeholder', 'Tender submitted');
  });

  it('there is exactly one filled Save and no per-row Save or Reset', async () => {
    wrap();
    await screen.findByTestId('stage-name-row-Leads');
    expect(screen.getAllByRole('button', { name: 'Save' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Reset' })).toBeNull();
  });
});
