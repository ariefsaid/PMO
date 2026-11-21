import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FinanceI18nTestProvider } from '@/test/financeI18nTestProvider';
import { financeTestI18n } from '@/test/financeI18nTestInstance';
import type { BillMatch } from '@/src/lib/repositories/threeWayMatch';

/** #2622 (OQ-TWM-3): a bill's three-way match panel and its exception approval, over 1018's RPCs. */
const h = vi.hoisted(() => ({
  role: 'Finance' as string,
  match: null as unknown,
  isError: false,
  refetch: vi.fn(),
  approve: vi.fn(),
  approvePending: false,
}));
vi.mock('@/src/hooks/useThreeWayMatch', () => ({
  useBillMatches: () => [{ data: h.isError ? undefined : h.match, isError: h.isError, isPending: !h.isError && !h.match, refetch: h.refetch }],
  useApproveBillMatchException: () => ({ mutateAsync: h.approve, isPending: h.approvePending }),
}));
vi.mock('@/src/auth/usePermission', async () => {
  const { can } = await vi.importActual<typeof import('@/src/auth/policy')>('@/src/auth/policy');
  return { usePermission: () => (action: never, entity: never) => can(action, entity, { realRole: h.role } as never) };
});
import { BillMatchDrawer } from './BillMatchDrawer';

const HELD: BillMatch = {
  status: 'held', reasons: ['amount_mismatch'], quantityTolerancePct: '5', amountTolerancePct: '2', exception: null,
  lines: [{ itemId: 'i1', itemName: 'Cable', ordered: '100', orderRate: '10', received: '60', billedToDate: '80', billQuantity: '80', billRate: '10.5', billAmount: '840', reasons: ['over_received', 'price_variance'] }],
};

const setup = () => {
  render(<FinanceI18nTestProvider><BillMatchDrawer invoiceId="inv-1" billLabel="VI-7" onClose={vi.fn()} /></FinanceI18nTestProvider>);
  return userEvent.setup();
};

beforeEach(async () => {
  h.role = 'Finance'; h.match = HELD; h.isError = false; h.approvePending = false;
  h.approve.mockReset().mockResolvedValue({ ...HELD, status: 'exception_approved' });
  await financeTestI18n.changeLanguage('en');
});

describe('BillMatchDrawer (#2622)', () => {
  it('AC-TWM-014 a held bill shows its status, the hold, and per line what was ordered, received and billed with the reasons', () => {
    setup();
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByText('Held')).toBeVisible();
    expect(within(drawer).getByText(/Payments on this purchase are held/)).toBeVisible();
    expect(within(drawer).getByText('Bill amount differs from its lines')).toBeVisible();
    const line = screen.getByTestId('bill-match-line-i1');
    expect(within(line).getByText('Cable')).toBeVisible();
    expect(line).toHaveTextContent(/100.*60.*80.*10.*10\.5/);
    expect(within(drawer).getByText('Billed more than received · Rate above the order rate')).toBeVisible();
    expect(within(drawer).getByText('Tolerance: quantity 5% · amount 2%')).toBeVisible();
  });

  it('AC-TWM-015 Finance approves the exception with a trimmed reason; the confirm needs a reason first', async () => {
    const user = setup();
    await user.click(screen.getByRole('button', { name: 'Approve exception' }));
    const confirm = screen.getByRole('dialog', { name: /Approve an exception for VI-7/ });
    expect(confirm).toHaveTextContent(/cannot approve a bill you recorded/);
    const go = within(confirm).getByRole('button', { name: 'Approve exception' });
    expect(go).toBeDisabled();
    await user.type(within(confirm).getByLabelText(/Reason/), '  Price agreed by phone ');
    await user.click(go);
    await waitFor(() => expect(h.approve).toHaveBeenCalledWith({ invoiceId: 'inv-1', reason: 'Price agreed by phone' }));
  });

  it('AC-TWM-015 the separation-of-duties refusal is explained in the dialog', async () => {
    const { AppError } = await import('@/src/lib/appError');
    h.approve.mockRejectedValue(new AppError('separation of duties', 'three-way-match-own-bill'));
    const user = setup();
    await user.click(screen.getByRole('button', { name: 'Approve exception' }));
    const confirm = screen.getByRole('dialog', { name: /Approve an exception/ });
    await user.type(within(confirm).getByLabelText(/Reason/), 'ok');
    await user.click(within(confirm).getByRole('button', { name: 'Approve exception' }));
    expect(await within(confirm).findByText(/A different Admin or Finance user approves its exception/)).toBeVisible();
  });

  it('AC-TWM-015 a Project Manager or an Executive reads the match but is offered no approval', () => {
    for (const role of ['Project Manager', 'Executive']) {
      h.role = role;
      const { unmount } = render(<FinanceI18nTestProvider><BillMatchDrawer invoiceId="inv-1" billLabel="VI-7" onClose={vi.fn()} /></FinanceI18nTestProvider>);
      expect(screen.getByText('Held')).toBeVisible();
      expect(screen.queryByRole('button', { name: 'Approve exception' })).toBeNull();
      unmount();
    }
  });

  it('AC-TWM-015 a matched bill, or one with an approved exception, offers no approval and shows the record', () => {
    h.match = { ...HELD, status: 'exception_approved', reasons: [], exception: { approvedBy: 'u2', approvedAt: '2026-11-20T02:00:00Z', reason: 'Agreed price' } };
    setup();
    expect(screen.getByText('Exception approved')).toBeVisible();
    expect(screen.getByTestId('bill-match-exception')).toHaveTextContent(/Agreed price/);
    expect(screen.queryByRole('button', { name: 'Approve exception' })).toBeNull();
  });

  it('a failed read offers a retry, never a status', async () => {
    h.isError = true;
    const user = setup();
    expect(screen.queryByText('Held')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(h.refetch).toHaveBeenCalled();
  });

  it('is translated — Bahasa Indonesia', async () => {
    await financeTestI18n.changeLanguage('id');
    setup();
    expect(screen.getByText('Ditahan')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Setujui pengecualian' })).toBeVisible();
    expect(screen.getByText('Ditagih melebihi yang diterima · Tarif di atas tarif pesanan')).toBeVisible();
  });
});
