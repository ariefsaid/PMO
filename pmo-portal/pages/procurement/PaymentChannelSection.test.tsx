import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  enabled: vi.fn(), list: vi.fn(), onRequest: vi.fn(), setOnRequest: vi.fn(),
}));
vi.mock('@/src/lib/repositories/paymentChannels', () => ({ paymentChannelRepository: h }));
vi.mock('@/src/auth/AuthContext', async () => {
  const { createContext } = await import('react');
  return { AuthContext: createContext({ currentUser: { org_id: 'o' } }) };
});

import { PaymentChannelSection } from './PaymentChannelSection';

const CHANNELS = [{ id: 'c1', name: 'Bank transfer', archived: false }, { id: 'c2', name: 'Cash', archived: false }, { id: 'c3', name: 'Cheque', archived: true }];
const renderIt = (canSet: boolean) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <PaymentChannelSection procurementId="p1" canSet={canSet} />
  </QueryClientProvider>,
);

describe('PaymentChannelSection (#2698)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.enabled.mockResolvedValue(true);
    h.list.mockResolvedValue(CHANNELS);
    h.onRequest.mockResolvedValue({ channelId: 'c1', name: 'Bank transfer' });
    h.setOnRequest.mockResolvedValue(undefined);
  });

  it('AC-PCH-009 off: renders nothing and reads no channel', async () => {
    h.enabled.mockResolvedValue(false);
    const { container } = renderIt(true);
    await waitFor(() => expect(h.enabled).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    expect(h.onRequest).not.toHaveBeenCalled();
  });

  it('AC-PCH-009 on, a viewer who cannot set it sees the channel name, or Not set', async () => {
    renderIt(false);
    expect(await screen.findByTestId('payment-channel-value')).toHaveTextContent('Bank transfer');
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('AC-PCH-009 on, with no channel set it says Not set', async () => {
    h.onRequest.mockResolvedValue({ channelId: null, name: null });
    renderIt(false);
    expect(await screen.findByTestId('payment-channel-value')).toHaveTextContent('Not set');
  });

  it('AC-PCH-009 on, with no live channel yet it says so and who adds them, never an empty picker', async () => {
    h.list.mockResolvedValue([{ id: 'c3', name: 'Cheque', archived: true }]);
    h.onRequest.mockResolvedValue({ channelId: null, name: null });
    renderIt(true);
    expect(await screen.findByTestId('payment-channel-none')).toHaveTextContent('No payment channels yet. An Admin adds them under Payment channels in Accounting setup.');
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('AC-PCH-010 a user who may set it picks a live channel and saves through the RPC', async () => {
    renderIt(true);
    const select = await screen.findByRole('combobox', { name: 'Payment channel' });
    expect(screen.queryByRole('option', { name: /Cheque/ })).not.toBeInTheDocument();
    await userEvent.selectOptions(select, 'c2');
    await userEvent.click(screen.getByRole('button', { name: 'Save channel' }));
    expect(h.setOnRequest).toHaveBeenCalledWith('p1', 'c2');
  });

  it('AC-PCH-010 choosing Not set clears the channel', async () => {
    renderIt(true);
    const select = await screen.findByRole('combobox', { name: 'Payment channel' });
    await userEvent.selectOptions(select, '');
    await userEvent.click(screen.getByRole('button', { name: 'Save channel' }));
    expect(h.setOnRequest).toHaveBeenCalledWith('p1', null);
  });

  it('AC-PCH-007 a refusal from the database is shown, not swallowed', async () => {
    h.setOnRequest.mockRejectedValue(Object.assign(new Error('Payment channel edit is not permitted'), { code: '42501' }));
    renderIt(true);
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Payment channel' }), 'c2');
    await userEvent.click(screen.getByRole('button', { name: 'Save channel' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
