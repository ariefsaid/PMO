import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/src/components/ui';

const h = vi.hoisted(() => ({ may: true, transition: vi.fn(), cancel: vi.fn(), checks: [] as { name: string; status: string }[] }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => h.may }));
vi.mock('@/src/hooks/useWorkOrderChecks', () => ({ useWorkOrderChecks: () => ({ data: h.checks }) }));
vi.mock('@/src/hooks/useWorkOrders', () => ({
  useWorkOrderMutations: () => ({ transition: { mutate: h.transition, isPending: false }, cancel: { mutate: h.cancel, isPending: false } }),
}));

import { useWorkOrderDecision } from './WorkOrderDecision';

type Row = Parameters<typeof useWorkOrderDecision>[0];
const Harness: React.FC<{ row: Row }> = ({ row }) => {
  const d = useWorkOrderDecision(row);
  return <>{d.primaryAction}{d.menuItems.map((m) => <button key={m.key} onClick={m.onSelect}>{m.label}</button>)}{d.dialogs}</>;
};
const draft = { id: 'wo-1', project_id: 'p-1', status: 'Draft' as const, title: 'Site works', issue_eligibility: 'allowed' };
const renderWith = (row: Row) => render(<ToastProvider><Harness row={row} /></ToastProvider>);

describe('AC-WOC-002 issue or cancel a work order on its own page', () => {
  beforeEach(() => { h.may = true; h.checks = []; h.transition.mockClear(); h.cancel.mockClear(); });

  it('issues a Draft the reader may issue, after a confirm', async () => {
    renderWith(draft);
    await userEvent.click(screen.getByRole('button', { name: 'Issue' }));
    await userEvent.click(screen.getByRole('button', { name: 'Issue work order' }));
    expect(h.transition).toHaveBeenCalledWith({ id: 'wo-1', to: 'Issued' }, expect.anything());
  });

  it('AC-WOC-003 names the checks still open in the Issue confirm, and still lets it issue', async () => {
    h.checks = [{ name: 'Drawings checked', status: 'Done' }, { name: 'Permit checked', status: 'To Do' }];
    renderWith(draft);
    await userEvent.click(screen.getByRole('button', { name: 'Issue' }));
    expect(screen.getByTestId('wo-issue-open-checks')).toHaveTextContent('Still open: Permit checked');
    expect(screen.getByRole('button', { name: 'Issue work order' })).toBeEnabled();
  });

  it('offers no Issue while the value still needs someone else, nor to a role that cannot move work orders', () => {
    const { unmount } = renderWith({ ...draft, issue_eligibility: 'self' });
    expect(screen.queryByRole('button', { name: 'Issue' })).toBeNull();
    unmount();
    h.may = false;
    renderWith(draft);
    expect(screen.queryByRole('button', { name: 'Issue' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel work order' })).toBeNull();
  });

  it('cancels with the reason typed', async () => {
    renderWith(draft);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel work order' }));
    await userEvent.type(screen.getByLabelText(/Reason for cancelling/), 'Client withdrew the order');
    const confirms = screen.getAllByRole('button', { name: 'Cancel work order' });
    await userEvent.click(confirms[confirms.length - 1]);
    expect(h.cancel).toHaveBeenCalledWith({ id: 'wo-1', reason: 'Client withdrew the order' }, expect.anything());
  });

  it('offers nothing on a closed or cancelled work order', () => {
    renderWith({ ...draft, status: 'Cancelled', issue_eligibility: 'unavailable' });
    expect(screen.queryByRole('button', { name: 'Issue' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel work order' })).toBeNull();
  });
});
