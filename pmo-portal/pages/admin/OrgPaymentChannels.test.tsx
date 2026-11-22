import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  enabled: vi.fn(), list: vi.fn(), setEnabled: vi.fn(), save: vi.fn(), archive: vi.fn(), canManage: true,
}));
vi.mock('@/src/lib/repositories/paymentChannels', () => ({ paymentChannelRepository: h }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => h.canManage }));
vi.mock('@/src/auth/AuthContext', async () => {
  const { createContext } = await import('react');
  return { AuthContext: createContext({ currentUser: { org_id: 'o' } }) };
});

import OrgPaymentChannels from './OrgPaymentChannels';

const CHANNELS = [{ id: 'c1', name: 'Bank transfer', archived: false }, { id: 'c2', name: 'Cash', archived: true }];
const renderIt = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><OrgPaymentChannels /></QueryClientProvider>,
);

describe('OrgPaymentChannels (#2698)', () => {
  beforeEach(() => {
    vi.clearAllMocks(); h.canManage = true;
    h.enabled.mockResolvedValue(true); h.list.mockResolvedValue(CHANNELS);
    h.setEnabled.mockResolvedValue(undefined); h.save.mockResolvedValue(undefined); h.archive.mockResolvedValue(undefined);
  });

  it('AC-PCH-011 off: only the switch shows, and an Admin turns it on', async () => {
    h.enabled.mockResolvedValue(false);
    renderIt();
    const toggle = await screen.findByRole('switch', { name: 'Record a payment channel on purchase requests' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByRole('list', { name: 'Channels' })).not.toBeInTheDocument();
    await userEvent.click(toggle);
    expect(h.setEnabled).toHaveBeenCalledWith(true);
  });

  it('AC-PCH-011 on: lists the channels, adds, renames and archives one, restores another', async () => {
    renderIt();
    expect(await screen.findByText('Bank transfer')).toBeInTheDocument();
    expect(screen.getByText('Archived')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Channel name'), 'Wire');
    await userEvent.click(screen.getByRole('button', { name: 'Add channel' }));
    expect(h.save).toHaveBeenCalledWith(null, 'Wire');
    await userEvent.click(screen.getByRole('button', { name: 'Rename Bank transfer' }));
    const box = screen.getAllByLabelText('Channel name')[0];
    await userEvent.clear(box); await userEvent.type(box, 'Transfer');
    await userEvent.click(screen.getByRole('button', { name: 'Save name' }));
    expect(h.save).toHaveBeenCalledWith('c1', 'Transfer');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save name' })).not.toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Restore Cash' }));
    expect(h.archive).toHaveBeenCalledWith('c2', false);
    await userEvent.click(screen.getByRole('button', { name: 'Archive Bank transfer' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Archive channel' }));
    expect(h.archive).toHaveBeenCalledWith('c1', true);
  });

  it('AC-PCH-011 a non-Admin sees the state but no control', async () => {
    h.canManage = false;
    renderIt();
    expect(await screen.findByText('Bank transfer')).toBeInTheDocument();
    expect(screen.getByRole('switch')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Add channel' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Archive / })).not.toBeInTheDocument();
    expect(screen.getByText('Only an Admin can change this.')).toBeInTheDocument();
  });
});
