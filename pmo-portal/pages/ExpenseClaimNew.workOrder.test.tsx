import { fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import { toast as sonnerToast } from 'sonner';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import { ToastProvider } from '@/src/components/ui';

/**
 * AC-SCWO-011 (#2732) — the one-page claim form carries the work order and discipline pickers (once a project is chosen),
 * writes them through the one attribution path after the claim exists, and a refusal after save says "saved, but…" and
 * opens the saved claim instead of creating it again.
 */
const h = vi.hoisted(() => ({
  capture: vi.fn(), navigate: vi.fn(), attribute: vi.fn(),
}));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => true }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'user-1' } }) }));
vi.mock('./expenses/useOwnAdvanceOptions', () => ({ useOwnAdvanceOptions: () => ({ options: [], isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/hooks/useProjects', () => ({ useProjectPickerOptions: () => ({ data: [{ id: 'p1', name: 'Project one', short_name: 'North' }], isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/hooks/useExpenseClaims', () => ({ useExpenseClaims: () => ({ data: { rows: [] } }), useExpenseClaimMutations: () => ({ create: { mutateAsync: vi.fn() }, addLine: { mutateAsync: vi.fn() }, transition: { mutateAsync: vi.fn() } }) }));
vi.mock('@/src/hooks/useImprest', () => ({ useImprestFloatChoices: () => ({ data: [] }), useImprestProcurementLimit: () => ({ data: null }), useSetClaimFloat: () => ({ mutateAsync: vi.fn() }) }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrencyState: () => ({ currency: 'IDR', isResolved: true, isError: false }) }));
vi.mock('@/src/hooks/useExpensePostingReadiness', () => ({ useExpensePostingReadiness: () => ({ state: 'ready', retry: vi.fn() }) }));
vi.mock('@/src/hooks/useExpenseCapture', () => ({ useExpenseCapture: () => ({ capture: h.capture, cleanupUnlinkedAttachment: vi.fn(), recovery: null }) }));
vi.mock('react-router', async (importOriginal) => { const actual = await importOriginal<typeof import('react-router')>(); return { ...actual, useNavigate: () => h.navigate }; });
// The pickers read their own queries; here one button stands in for "a work order and a discipline were picked".
vi.mock('@/src/components/workOrders/CostAttributionFields', () => ({
  CostAttributionFields: ({ projectId, onChange }: { projectId: string | null; onChange: (v: { workOrderId: string; disciplineId: string }) => void }) => (
    <button type="button" data-project={projectId ?? ''} onClick={() => onChange({ workOrderId: 'wo-1', disciplineId: 'disc-1' })}>pick work order</button>
  ),
}));
vi.mock('@/src/lib/repositories/workOrderCosts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/lib/repositories/workOrderCosts')>();
  return { ...actual, workOrderCostRepository: { ...actual.workOrderCostRepository, attributeOrRefuse: h.attribute } };
});
import ExpenseClaimNew from './ExpenseClaimNew';
import { AttributionRefusedError } from '@/src/lib/repositories/workOrderCosts';

afterEach(() => { act(() => { sonnerToast.dismiss(); }); });
const renderPage = () => render(<MemoryRouter initialEntries={['/expenses/new']}><ToastProvider><Routes><Route path="/expenses/new" element={<ExpenseClaimNew />} /></Routes></ToastProvider></MemoryRouter>);

describe('AC-SCWO-011 claim form carries the work order and discipline', () => {
  beforeEach(() => { vi.clearAllMocks(); h.capture.mockResolvedValue('claim-1'); h.attribute.mockResolvedValue(undefined); });

  it('offers no work-order pickers until a project is chosen, then offers them for that project', () => {
    renderPage();
    expect(screen.queryByRole('button', { name: 'pick work order' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'p1' } });
    expect(screen.getByRole('button', { name: 'pick work order' })).toHaveAttribute('data-project', 'p1');
  });

  it('names the picked work order and discipline on the saved claim, through the one attribution path', async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'Cable ties' } });
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'p1' } });
    fireEvent.click(screen.getByRole('button', { name: 'pick work order' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(h.attribute).toHaveBeenCalledWith('expense_claim', 'claim-1', { workOrderId: 'wo-1', disciplineId: 'disc-1' }));
    await waitFor(() => expect(h.navigate).toHaveBeenCalledWith('/expenses/claim-1', { replace: true }));
    expect(h.capture).toHaveBeenCalledTimes(1);
  });

  it('after a refusal the claim stays saved, the reason is shown, and nothing is created again', async () => {
    h.attribute.mockRejectedValue(new AttributionRefusedError({ message: 'COST_WO_CANCELLED: the work order is cancelled' }, 'claim-1'));
    renderPage();
    fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'Cable ties' } });
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'p1' } });
    fireEvent.click(screen.getByRole('button', { name: 'pick work order' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText('Saved, but the work order or discipline was not set')).toBeInTheDocument();
    expect(screen.getByText('That work order is cancelled.')).toBeInTheDocument();
    await waitFor(() => expect(h.navigate).toHaveBeenCalledWith('/expenses/claim-1', { replace: true }));
    expect(h.capture).toHaveBeenCalledTimes(1);
  });
});
