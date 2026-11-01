import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ConnectProposal, ConnectStatus } from '@/src/lib/repositories/contracts/integrations';

const repo = vi.hoisted(() => ({
  getConnectStatus: vi.fn<() => Promise<ConnectStatus>>(),
  listConnectProposals: vi.fn<(tier: string, kind: string | null, outcome: string | null) => Promise<{ proposals: ConnectProposal[]; nextAfterId: string | null }>>(),
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { integrations: repo } }));

import { ErpSendStates } from './ErpSendStates';

const status = (waitingForSend: number): ConnectStatus => ({ run: null, census: [], waitingForSend });
const proposal = (over: Partial<ConnectProposal>): ConnectProposal => ({
  id: 'p', kind: 'item', outcome: 'review', pmo_ids: ['x'], external_ids: [], reason_text: null, snapshot: {}, state: 'open', ...over,
});

function answer(waiting: number, review: ConnectProposal[] = [], sends: ConnectProposal[] = []) {
  repo.getConnectStatus.mockResolvedValue(status(waiting));
  repo.listConnectProposals.mockImplementation(async (_t, _k, outcome) => ({ proposals: outcome === 'review' ? review : sends, nextAfterId: null }));
}
const renderIt = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ErpSendStates enabled /></QueryClientProvider>,
);
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('ECA3-T11 ErpSendStates', () => {
  it('NFR-ECA-004 an accepted send shows "Sending to the ERP" until the ERP confirms; a rejection returns as "Needs a decision" with the reason', async () => {
    answer(3, [proposal({ id: 'r1', snapshot: { name: 'Semen 50 kg' }, reason_text: 'The ERP refused this item: Value missing' })]);
    renderIt();
    expect(await screen.findByText('Sending to the ERP')).toBeTruthy();
    expect(screen.getByText(/3 waiting for the ERP to confirm/)).toBeTruthy();
    expect(await screen.findByText('Semen 50 kg')).toBeTruthy();
    expect(screen.getByText('Needs a decision')).toBeTruthy();
    expect(screen.getByText('The ERP refused this item: Value missing')).toBeTruthy();
    expect(screen.queryByText(/done|complete|sent/i)).toBeNull();   // a waiting row is never reported as finished
  });

  it('a send the ERP could not confirm is a decision with its plain reason, not a success', async () => {
    answer(0, [proposal({ id: 'r2', kind: 'project', snapshot: { name: 'Jembatan' }, reason_text: 'We could not confirm whether the ERP created this record' })]);
    renderIt();
    expect(await screen.findByText('We could not confirm whether the ERP created this record')).toBeTruthy();
    expect(screen.queryByText('Sending to the ERP')).toBeNull();
  });

  it('a matcher review row (it names ERP records) is not a send state', async () => {
    answer(0, [proposal({ id: 'r3', external_ids: ['Supplier:ACME'], reason_text: 'Two PMO companies share this name.' })]);
    const { container } = renderIt();
    await waitFor(() => expect(repo.listConnectProposals).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(container.textContent).toBe('');
  });

  it('PQ-ECA-1 people the ERP cannot take are listed to add by hand, never sent and never invented', async () => {
    answer(0, [], [proposal({ id: 'e1', kind: 'employee', outcome: 'send', snapshot: { name: 'Siti Rahma' } }), proposal({ id: 'e2', kind: 'employee', outcome: 'send', snapshot: { name: 'Budi Santoso' } })]);
    renderIt();
    expect(await screen.findByText(/Add these people in the ERP/)).toBeTruthy();
    expect(await screen.findByText('Siti Rahma')).toBeTruthy();
    expect(screen.getByText('Budi Santoso')).toBeTruthy();
    expect(repo.listConnectProposals).toHaveBeenCalledWith('erpnext', 'employee', 'send', null);
  });

  it('nothing waiting, nothing refused, nobody to add: the section is not shown', async () => {
    answer(0);
    const { container } = renderIt();
    await waitFor(() => expect(repo.getConnectStatus).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(container.textContent).toBe('');
  });

  it('is silent while disabled and when the status cannot be read', async () => {
    repo.getConnectStatus.mockRejectedValue(new Error('no'));
    repo.listConnectProposals.mockRejectedValue(new Error('no'));
    const { container } = render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ErpSendStates enabled /></QueryClientProvider>,
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(container.textContent).toBe('');
    cleanup();
    vi.clearAllMocks();
    render(<QueryClientProvider client={new QueryClient()}><ErpSendStates enabled={false} /></QueryClientProvider>);
    expect(repo.getConnectStatus).not.toHaveBeenCalled();
  });
});
