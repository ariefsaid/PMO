/** AC-PLP-009 — the create form shows a category and a needed-by date per line only when line planning is on, and sets them after the draft exists. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import ProcurementCreate from './ProcurementCreate';
import { financeTestI18n } from '@/test/financeI18nTestInstance';

const mocks = vi.hoisted(() => ({
  createAtomic: vi.fn(), navigate: vi.fn(), toast: vi.fn(), setLine: vi.fn(), planningOn: false,
}));
vi.mock('react-router', async (importOriginal) => ({ ...await importOriginal<typeof import('react-router')>(), useNavigate: () => mocks.navigate }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => true }));
vi.mock('@/src/auth/impersonation', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/src/auth/impersonation')>(),
  useOptionalRealRole: () => 'Admin',
}));
vi.mock('@/src/hooks/useOrgFxContext', () => ({ useOrgFxContext: () => ({ data: { currency: 'USD' }, isPlaceholderData: false, isError: false, isPending: false, refetch: vi.fn() }) }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrencyState: () => ({ currency: 'USD', isResolved: true, isError: false }) }));
vi.mock('@/src/hooks/useFkOptions', () => ({
  useProjectOptions: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useVendorOptions: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useProcurementCrud', () => ({
  useCreateProcurement: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCreateProcurementWithItems: () => ({ mutateAsync: mocks.createAtomic, isPending: false }),
  useCreateProcurementItem: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/src/hooks/usePurchaseLinePlanning', () => ({
  useLinePlanningEnabled: () => mocks.planningOn,
  useLineCategories: () => ({ data: [{ id: 'c1', name: 'Alpha', archived_at: null, org_id: 'o', position: 1, created_at: '' }] }),
}));
vi.mock('@/src/lib/db/procurementLinePlanning', () => ({ setProcurementLinePlanning: mocks.setLine }));
vi.mock('@/src/components/ui', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/src/components/ui')>(),
  useToast: () => ({ toast: mocks.toast }),
}));

const renderCreate = () => render(
  <MemoryRouter initialEntries={['/procurement/new?have=need']}>
    <Routes><Route path="/procurement/new" element={<ProcurementCreate />} /></Routes>
  </MemoryRouter>,
);
const addLine = async () => {
  fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Office supplies' } });
  fireEvent.change(screen.getByLabelText('New item description'), { target: { value: 'Envelopes' } });
  fireEvent.change(screen.getByLabelText('New item quantity'), { target: { value: '2' } });
  fireEvent.change(screen.getByLabelText('New item unit price'), { target: { value: '5' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add line item' }));
  await waitFor(() => expect(screen.getByLabelText('New item description')).toHaveValue(''));
};

describe('AC-PLP-009 create form line planning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.planningOn = false;
    mocks.createAtomic.mockResolvedValue({ id: 'new-id' });
    mocks.setLine.mockResolvedValue(undefined);
  });
  afterEach(async () => { cleanup(); await financeTestI18n.changeLanguage('en'); });

  it('shows no Category or Needed by field while the setting is off', async () => {
    renderCreate();
    await addLine();
    expect(screen.queryByText('Needed by')).toBeNull();
    expect(screen.queryByTestId('line-planning-section')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(mocks.createAtomic).toHaveBeenCalledOnce());
    expect(mocks.setLine).not.toHaveBeenCalled();
  });

  it('when on, sets the filled line after the draft is created and leaves the create payload unchanged', async () => {
    mocks.planningOn = true;
    renderCreate();
    await addLine();
    await userEvent.selectOptions(screen.getByLabelText('Line category'), 'c1');
    fireEvent.change(screen.getByLabelText('Needed by'), { target: { value: '2026-12-31' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(mocks.setLine).toHaveBeenCalledTimes(1));
    const submitted = mocks.createAtomic.mock.calls[0][0] as { lines: Array<Record<string, unknown>> };
    expect(Object.keys(submitted.lines[0]).sort()).toEqual(['description', 'id', 'name', 'quantity', 'rate']);
    expect(mocks.setLine).toHaveBeenCalledWith(submitted.lines[0].id, 'c1', '2026-12-31');
    expect(mocks.createAtomic.mock.invocationCallOrder[0]).toBeLessThan(mocks.setLine.mock.invocationCallOrder[0]);
  });

  it('when on, a line left empty makes no extra call', async () => {
    mocks.planningOn = true;
    renderCreate();
    await addLine();
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(mocks.createAtomic).toHaveBeenCalledOnce());
    expect(mocks.setLine).not.toHaveBeenCalled();
  });
});
