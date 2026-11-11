import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), canManage: true }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { orgSettings: { getProcurementGates: h.get, setProcurementGates: h.set } } }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => h.canManage }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'o' } }) }));

import OrgProcurementGates from './OrgProcurementGates';

const OFF = { request_before_order: false, approval_before_order: false, approval_before_payment: false, receipt_before_invoice: false };
const renderIt = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><OrgProcurementGates /></QueryClientProvider>,
);

describe('OrgProcurementGates', () => {
  beforeEach(() => { vi.clearAllMocks(); h.canManage = true; });

  it('AC-PFE-014: an Admin turns on approval before payment', async () => {
    h.get.mockResolvedValue(OFF);
    h.set.mockResolvedValue({ ...OFF, approval_before_payment: true });
    renderIt();
    const toggle = await screen.findByRole('switch', { name: 'Approval required before payment' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(toggle);
    expect(h.set).toHaveBeenCalledWith({ approval_before_payment: true });
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Approval required before payment' })).toHaveAttribute('aria-checked', 'true'));
  });

  it('turning an enabled rule off sends only that rule', async () => {
    h.get.mockResolvedValue({ ...OFF, receipt_before_invoice: true });
    h.set.mockResolvedValue(OFF);
    renderIt();
    await userEvent.click(await screen.findByRole('switch', { name: 'Receipt required before invoice' }));
    expect(h.set).toHaveBeenCalledWith({ receipt_before_invoice: false });
  });

  it('AC-PFE-014: a non-Admin sees the rules read-only', async () => {
    h.canManage = false;
    h.get.mockResolvedValue(OFF);
    renderIt();
    expect(await screen.findByRole('switch', { name: 'Approval required before payment' })).toBeDisabled();
    expect(screen.getByText('Only an Admin can change this.')).toBeInTheDocument();
  });

  it('says what each rule does when it is on', async () => {
    h.get.mockResolvedValue(OFF);
    renderIt();
    const toggle = await screen.findByRole('switch', { name: 'Receipt required before invoice' });
    expect(toggle).toHaveAccessibleDescription('When on, a supplier invoice needs a goods receipt first.');
    expect(screen.getByRole('switch', { name: 'Approval required before payment' }))
      .toHaveAccessibleDescription('When on, a payment needs an approved amount first.');
  });

  it('shows all four rules, each named', async () => {
    h.get.mockResolvedValue(OFF);
    renderIt();
    expect(await screen.findAllByRole('switch')).toHaveLength(4);
    for (const name of ['Request required before order', 'Approval required before order', 'Receipt required before invoice', 'Approval required before payment']) {
      expect(screen.getByRole('switch', { name })).toBeInTheDocument();
    }
  });

  it('a refused save shows the reason and leaves the rule as it was', async () => {
    h.get.mockResolvedValue(OFF);
    h.set.mockRejectedValue(new Error('Only an Admin can change purchase rules.'));
    renderIt();
    await userEvent.click(await screen.findByRole('switch', { name: 'Approval required before order' }));
    expect(await screen.findByText(/Only an Admin can change purchase rules/)).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Approval required before order' })).toHaveAttribute('aria-checked', 'false');
  });

  it('shows a loading state, then an error with retry when the rules cannot be read', async () => {
    h.get.mockRejectedValueOnce(new Error('boom')).mockResolvedValue(OFF);
    renderIt();
    expect(await screen.findByText('Couldn’t load purchase rules')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(await screen.findAllByRole('switch')).toHaveLength(4);
  });
});
