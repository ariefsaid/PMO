import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/src/components/ui';

/** AC-SCWO-013 (#2732) — the claim detail shows the work order and discipline and lets a permitted person correct them. */
const h = vi.hoisted(() => ({ set: vi.fn() }));
vi.mock('@/src/hooks/useWorkOrders', () => ({ useProjectWorkOrders: () => ({ data: [{ id: 'wo-1', wo_number: 'WO-001', title: 'Pipe rack', status: 'Issued' }] }) }));
vi.mock('@/src/hooks/useWorkOrderCosts', () => ({ useCostDisciplines: () => ({ data: [{ id: 'disc-1', code: 'CIV', name: 'Civil' }] }) }));
vi.mock('@/src/components/workOrders/CostAttributionFields', () => ({
  CostAttributionFields: ({ onChange }: { onChange: (v: { workOrderId: string | null; disciplineId: string | null }) => void }) => (
    <button type="button" onClick={() => onChange({ workOrderId: null, disciplineId: 'disc-1' })}>pick</button>
  ),
}));
vi.mock('@/src/lib/repositories/workOrderCosts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/lib/repositories/workOrderCosts')>();
  return { ...actual, workOrderCostRepository: { ...actual.workOrderCostRepository, setAttribution: h.set } };
});
vi.unmock('@/pages/expenses/ExpenseAttributionCard'); // test/setup.ts stubs it for the detail-page suites
import { ExpenseAttributionCard } from './ExpenseAttributionCard';
import { canAttributeExpenseClaim } from './canAttributeExpenseClaim';

const claim = { id: 'c1', kind: 'claim', project_id: 'p1', work_order_id: 'wo-1', discipline_id: null as string | null };
const renderCard = (canEdit: boolean, c = claim) => render(<QueryClientProvider client={new QueryClient()}><ToastProvider><ExpenseAttributionCard claim={c} canEdit={canEdit} /></ToastProvider></QueryClientProvider>);

describe('AC-SCWO-013 claim detail work order and discipline', () => {
  beforeEach(() => { vi.clearAllMocks(); h.set.mockResolvedValue(1); });

  it('shows the work order and says "No discipline" when none is set', () => {
    renderCard(false);
    expect(screen.getByTestId('expense-work-order')).toHaveTextContent('WO-001');
    expect(screen.getByTestId('expense-discipline')).toHaveTextContent('No discipline');
    expect(screen.queryByRole('button', { name: 'Change' })).toBeNull();
  });

  it('a permitted person changes it through the one attribution path', async () => {
    renderCard(true);
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    fireEvent.click(screen.getByRole('button', { name: 'pick' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.set).toHaveBeenCalledWith('expense_claim', ['c1'], { workOrderId: null, disciplineId: 'disc-1' }));
  });

  it('renders nothing for a cash advance or a claim with no project', () => {
    renderCard(true, { ...claim, kind: 'advance' });
    expect(screen.queryByTestId('expense-work-order')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Change' })).toBeNull();
  });

  it('finance-capable roles may correct any claim; the claimant only while Draft or Rejected', () => {
    expect(canAttributeExpenseClaim('Finance', 'u2', { claimant_id: 'u1', status: 'Paid' })).toBe(true);
    expect(canAttributeExpenseClaim('Project Manager', 'u2', { claimant_id: 'u1', status: 'Approved' })).toBe(true);
    expect(canAttributeExpenseClaim('Engineer', 'u1', { claimant_id: 'u1', status: 'Draft' })).toBe(true);
    expect(canAttributeExpenseClaim('Engineer', 'u1', { claimant_id: 'u1', status: 'Approved' })).toBe(false);
    expect(canAttributeExpenseClaim('Engineer', 'u2', { claimant_id: 'u1', status: 'Draft' })).toBe(false);
  });
});
