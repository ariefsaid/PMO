import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** #2634 (AC-TWM-022): the Admin's three-way match setting in Accounting setup, over 1018's writer. */
const h = vi.hoisted(() => ({ settings: vi.fn(), save: vi.fn(), held: vi.fn(), canManage: true }));
vi.mock('@/src/lib/repositories/threeWayMatch', () => ({
  threeWayMatchRepository: { settings: h.settings, saveSettings: h.save, heldCount: h.held },
}));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => (action: string, entity: string) => h.canManage && action === 'manage' && entity === 'threeWayMatchSettings' }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'o' } }) }));

import OrgThreeWayMatch from './OrgThreeWayMatch';

const renderIt = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><OrgThreeWayMatch /></QueryClientProvider>,
);
const SWITCH = 'Check vendor bills against the order and receipts before payment';

describe('OrgThreeWayMatch (AC-TWM-022)', () => {
  beforeEach(() => { vi.clearAllMocks(); h.canManage = true; h.held.mockResolvedValue(0); });

  it('shows the match off, with zero tolerances, when it was never saved', async () => {
    h.settings.mockResolvedValue(null);
    renderIt();
    expect(await screen.findByRole('switch', { name: SWITCH })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByLabelText('Quantity tolerance (%)')).toHaveValue('0');
    expect(screen.getByLabelText('Amount tolerance (%)')).toHaveValue('0');
    expect(screen.getByText('Bills recorded before you switch this on are not matched.')).toBeInTheDocument();
    expect(h.held).not.toHaveBeenCalled();
  });

  it('an Admin switches it on with tolerances and the screen sends on/off and both tolerances, nothing else', async () => {
    h.settings.mockResolvedValue(null);
    h.save.mockResolvedValue({ enabled: true, quantityTolerancePct: '5.00', amountTolerancePct: '2.50' });
    renderIt();
    await userEvent.click(await screen.findByRole('switch', { name: SWITCH }));
    const qty = screen.getByLabelText('Quantity tolerance (%)');
    await userEvent.clear(qty); await userEvent.type(qty, '5');
    const amt = screen.getByLabelText('Amount tolerance (%)');
    await userEvent.clear(amt); await userEvent.type(amt, '2.5');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(h.save).toHaveBeenCalledWith({ enabled: true, quantityTolerancePct: 5, amountTolerancePct: 2.5 });
    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });

  it('refuses a tolerance outside 0 to 100 before sending', async () => {
    h.settings.mockResolvedValue(null);
    renderIt();
    await userEvent.click(await screen.findByRole('switch', { name: SWITCH }));
    const qty = screen.getByLabelText('Quantity tolerance (%)');
    await userEvent.clear(qty); await userEvent.type(qty, '101');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Enter a percentage from 0 to 100 with at most 2 decimal places.')).toBeInTheDocument();
    expect(h.save).not.toHaveBeenCalled();
  });

  it('switching an enabled match off names how many bills are held now, then sends the off', async () => {
    h.settings.mockResolvedValue({ enabled: true, quantityTolerancePct: '5.00', amountTolerancePct: '2.00' });
    h.held.mockResolvedValue(3);
    h.save.mockResolvedValue({ enabled: false, quantityTolerancePct: '5.00', amountTolerancePct: '2.00' });
    renderIt();
    const toggle = await screen.findByRole('switch', { name: SWITCH });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByTestId('three-way-match-held-notice')).not.toBeInTheDocument();
    await userEvent.click(toggle);
    expect(await screen.findByTestId('three-way-match-held-notice')).toHaveTextContent('3 bills are held now. Switching the match off releases their holds.');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(h.save).toHaveBeenCalledWith({ enabled: false, quantityTolerancePct: 5, amountTolerancePct: 2 });
  });

  it('a non-Admin sees the saved values read-only, with no Save and no held-count read', async () => {
    h.canManage = false;
    h.settings.mockResolvedValue({ enabled: true, quantityTolerancePct: '5.00', amountTolerancePct: '2.00' });
    renderIt();
    expect(await screen.findByRole('switch', { name: SWITCH })).toBeDisabled();
    expect(screen.getByLabelText('Quantity tolerance (%)')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(screen.getByText('Only an Admin can change this.')).toBeInTheDocument();
    expect(h.held).not.toHaveBeenCalled();
  });

  it('a refused save explains itself and keeps the form', async () => {
    h.settings.mockResolvedValue(null);
    h.save.mockRejectedValue(Object.assign(new Error('only an Admin sets the three-way match'), { code: '42501' }));
    renderIt();
    await userEvent.click(await screen.findByRole('switch', { name: SWITCH }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByText(/Only an Admin can change the three-way match|only an Admin sets/i)).toBeInTheDocument());
    expect(screen.getByRole('switch', { name: SWITCH })).toHaveAttribute('aria-checked', 'true');
  });
});

it.each(['pending', 'failed'])('keeps switching off unsavable while the held count is %s', async (state) => {
  h.settings.mockResolvedValue({ enabled: true, quantityTolerancePct: '5.00', amountTolerancePct: '2.00' });
  h.held.mockImplementation(() => state === 'pending' ? new Promise(() => {}) : Promise.reject(new Error('offline')));
  renderIt();
  await userEvent.click(await screen.findByRole('switch', { name: SWITCH }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled());
  expect(h.save).not.toHaveBeenCalled();
});
