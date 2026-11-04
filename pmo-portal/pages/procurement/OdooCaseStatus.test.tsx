/** AC-OPP-080 / AC-OPP-082 (FR-OPP-090/091/094/095): what Odoo has not settled on a case, the unreachable note, and the held-payment decision. */
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  commands: { data: [] as unknown[] | undefined, isError: false },
  revenueCommands: { data: [] as unknown[] | undefined, isError: false },
  conn: { unreachable: false, lastOkAt: null as string | null },
  roles: { realRole: 'Finance' as string | null, effectiveRole: 'Finance' as string | null },
  me: 'u-me' as string | null,
  resolve: vi.fn(),
  resolveRevenue: vi.fn(),
}));
vi.mock('@/src/hooks/useOdooPurchase', () => ({
  useOdooPurchaseCommands: () => h.commands,
  useOdooUnreachable: () => h.conn,
  useResolveHeldPayment: () => ({ mutateAsync: h.resolve, isPending: false }),
}));
vi.mock('@/src/hooks/useOdooRevenue', () => ({
  useOdooRevenueCommands: () => h.revenueCommands,
  useResolveHeldRevenueCommand: () => ({ mutateAsync: h.resolveRevenue, isPending: false }),
}));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => h.roles }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: h.me ? { id: h.me } : null }) }));
vi.mock('@/src/lib/format', async (orig) => ({ ...(await orig<typeof import('@/src/lib/format')>()), formatRelativeTime: (iso: string | null) => (iso ? '2 hours ago' : '—') }));

import { OdooCaseStatus } from './OdooCaseStatus';
import { clearOwnershipCache, setTaskOwnership } from '@/src/lib/adapterSeam/ownershipCache';

const cmd = (over: Record<string, unknown>) => ({ id: 'c1', kind: 'payment', state: 'pending', lastError: null, updatedAt: '2026-11-03T10:00:00Z', actorUserId: 'u-other', ...over });
const renderIt = () => render(<OdooCaseStatus procurementId="p1" />);

beforeEach(() => {
  setTaskOwnership([{ domain: 'procurement', externalTier: 'odoo' }]); h.commands = { data: [], isError: false }; h.conn = { unreachable: false, lastOkAt: null };
  h.revenueCommands = { data: [], isError: false };
  h.roles = { realRole: 'Finance', effectiveRole: 'Finance' }; h.me = 'u-me'; h.resolve.mockReset(); h.resolveRevenue.mockReset();
});
afterEach(() => { cleanup(); clearOwnershipCache(); });

describe('AC-OPP-080 OdooCaseStatus', () => {
  it('renders nothing for an org PMO owns, and nothing when Odoo has nothing outstanding', () => {
    clearOwnershipCache(); h.commands = { data: [cmd({})], isError: false };
    const { container, rerender } = renderIt();
    expect(container).toBeEmptyDOMElement();
    setTaskOwnership([{ domain: 'procurement', externalTier: 'odoo' }]); h.commands = { data: [], isError: false };
    rerender(<OdooCaseStatus procurementId="p1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('lists each unsettled command with what it is, its plain state and the next step', () => {
    h.commands = { data: [cmd({ id: 'a', kind: 'purchase-invoice', state: 'committing' }), cmd({ id: 'b', kind: 'goods-receipt', state: 'failed', lastError: 'commit-rejected' })], isError: false };
    renderIt();
    const items = screen.getAllByRole('listitem');
    expect(within(items[0]).getByText('Supplier invoice')).toBeInTheDocument();
    expect(within(items[0]).getByText('Sent, waiting for Odoo')).toBeInTheDocument();
    expect(within(items[1]).getByText('Goods receipt')).toBeInTheDocument();
    expect(within(items[1]).getByText('Odoo did not accept it')).toBeInTheDocument();
    expect(within(items[1]).getByTestId('odoo-outcome-next')).toHaveTextContent('Check what you entered, then record it again.');
  });

  it('FR-OPP-091 while Odoo cannot be reached it says so, keeps showing the last read, and states that nothing is sent', () => {
    h.conn = { unreachable: true, lastOkAt: '2026-11-03T08:00:00Z' };
    renderIt();
    expect(screen.getByTestId('odoo-unreachable')).toHaveTextContent('Odoo cannot be reached. Showing what PMO last read, 2 hours ago.');
  });

  it('a failed read of the list is said once, not shown as an empty one', () => {
    h.commands = { data: undefined, isError: true };
    renderIt();
    expect(screen.getByRole('status')).toHaveTextContent(/could not be read/i);
  });

  it('has no axe violations with a held payment showing', async () => {
    h.commands = { data: [cmd({ state: 'held' })], isError: false };
    const { container } = renderIt();
    expect((await axe(container)).violations).toEqual([]);
  });
});

describe('AC-OPP-082 held payment resolution (FR-OPP-063/094)', () => {
  const held = () => { h.commands = { data: [cmd({ state: 'held' })], isError: false }; };

  it.each(['Admin', 'Finance'])('%s who did not send it sees both decisions', (role) => {
    held(); h.roles = { realRole: role, effectiveRole: role };
    renderIt();
    expect(screen.getByRole('button', { name: 'It exists in Odoo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'It does not exist in Odoo' })).toBeInTheDocument();
  });

  it.each(['Project Manager', 'Executive', 'Engineer'])('%s sees the state but no decision control', (role) => {
    held(); h.roles = { realRole: role, effectiveRole: role };
    renderIt();
    expect(screen.getByText('Needs a decision')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('an Admin viewing as another role is view-only', () => {
    held(); h.roles = { realRole: 'Admin', effectiveRole: 'Engineer' };
    renderIt();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('the person who sent the payment is told someone else must decide, and gets no control', () => {
    held(); h.me = 'u-other';
    renderIt();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('You sent this payment, so someone else must decide.')).toBeInTheDocument();
  });

  it('only a payment can be resolved here: a held receipt shows no controls', () => {
    h.commands = { data: [cmd({ kind: 'goods-receipt', state: 'held' })], isError: false };
    renderIt();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('"does not exist" asks first, then records the decision and confirms it', async () => {
    held(); h.resolve.mockResolvedValue(undefined);
    renderIt();
    await userEvent.click(screen.getByRole('button', { name: 'It does not exist in Odoo' }));
    expect(h.resolve).not.toHaveBeenCalled();
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('Confirm no payment exists in Odoo?');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    expect(h.resolve).toHaveBeenCalledWith({ outboxId: 'c1', resolution: 'absent' });
    expect(await screen.findByText('Decision recorded.')).toBeInTheDocument();
  });

  it('"it exists" needs the Odoo payment number before it can be confirmed', async () => {
    held(); h.resolve.mockResolvedValue(undefined);
    renderIt();
    await userEvent.click(screen.getByRole('button', { name: 'It exists in Odoo' }));
    const dialog = screen.getByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Confirm' });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText('Odoo payment number'), '42');
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    expect(h.resolve).toHaveBeenCalledWith({ outboxId: 'c1', resolution: 'adopt', paymentNumber: '42' });
  });

  it('a refusal from the database is shown plainly and the dialog stays open for another try', async () => {
    held(); h.resolve.mockRejectedValue(new Error('not authorized'));
    renderIt();
    await userEvent.click(screen.getByRole('button', { name: 'It does not exist in Odoo' }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText('The decision could not be recorded.')).toBeInTheDocument();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });
});

describe('AC-OCI-090 held Odoo revenue rows', () => {
  it('shows a held invoice row to Finance and resolves it against an Odoo invoice number', async () => {
    setTaskOwnership([{ domain: 'revenue', externalTier: 'odoo' }]);
    h.revenueCommands = { data: [{ id: 'c-si', recordId: 'si-1', kind: 'sales-invoice', state: 'held', lastError: null, updatedAt: '2026-11-03T10:00:00Z', actorUserId: 'u-other' }], isError: false };
    h.resolveRevenue.mockResolvedValue(undefined);
    render(<OdooCaseStatus invoiceId="si-1" />);
    expect(screen.getByText('Customer invoice')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'It exists in Odoo' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Odoo document number'), '42');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    expect(h.resolveRevenue).toHaveBeenCalledWith({ outboxId: 'c-si', kind: 'sales-invoice', resolution: 'adopt', documentNumber: '42' });
  });

  it('lists held customer receipts against their invoice and keeps an impersonating Admin view-only', () => {
    setTaskOwnership([{ domain: 'revenue', externalTier: 'odoo' }]);
    h.revenueCommands = { data: [{ id: 'c-ip', recordId: 'ip-1', kind: 'incoming-payment', state: 'held', lastError: null, updatedAt: '2026-11-03T10:00:00Z', actorUserId: 'u-other' }], isError: false };
    h.roles = { realRole: 'Admin', effectiveRole: 'Engineer' };
    render(<OdooCaseStatus invoiceId="si-1" />);
    expect(screen.getByText('Customer receipt')).toBeInTheDocument();
    expect(screen.getByText('Needs a decision')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
