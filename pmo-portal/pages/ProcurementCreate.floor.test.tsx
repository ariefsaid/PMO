import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import ProcurementCreate from './ProcurementCreate';
import { ProcurementError } from '@/src/lib/db/procurementLifecycle';

const mocks = vi.hoisted(() => ({
  createRequest: vi.fn(),
  createAtomic: vi.fn(),
  createItem: vi.fn(),
  navigate: vi.fn(),
  toast: vi.fn(),
  canCreate: true,
  currency: 'USD',
  orgFxContext: { data: { currency: 'USD' } as { currency: string } | undefined, isPlaceholderData: false, isError: false, isPending: false, refetch: vi.fn() },
  realRole: 'Admin' as string,
  projectQuery: { data: [{ value: 'p1', label: 'Project One' }], isPending: false, isError: false, refetch: vi.fn() },
  vendorQuery: { data: [{ value: 'v1', label: 'Supplier One', sub: 'Vendor' }], isPending: false, isError: false, refetch: vi.fn() },
}));
vi.mock('react-router', async (importOriginal) => ({ ...await importOriginal<typeof import('react-router')>(), useNavigate: () => mocks.navigate }));
vi.mock('@/src/auth/usePermission', async () => {
  const { can } = await vi.importActual<typeof import('@/src/auth/policy')>('@/src/auth/policy');
  return {
    usePermission: () => (action: never, entity: string) => entity === 'procurement'
      ? mocks.canCreate
      : can(action, entity as never, { realRole: mocks.realRole } as never),
  };
});
vi.mock('@/src/auth/impersonation', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/src/auth/impersonation')>(),
  useOptionalRealRole: () => mocks.realRole,
}));
vi.mock('@/src/hooks/useOrgFxContext', () => ({ useOrgFxContext: () => mocks.orgFxContext }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrencyState: () => ({
  currency: mocks.orgFxContext.data?.currency ?? 'USD',
  isResolved: mocks.orgFxContext.data !== undefined && !mocks.orgFxContext.isPlaceholderData,
  isError: mocks.orgFxContext.isError,
}) }));
vi.mock('@/src/hooks/useFkOptions', () => ({
  useProjectOptions: () => mocks.projectQuery,
  useVendorOptions: () => mocks.vendorQuery,
}));
vi.mock('@/src/hooks/useProcurementCrud', () => ({
  useCreateProcurement: () => ({ mutateAsync: mocks.createRequest, isPending: false }),
  useCreateProcurementWithItems: () => ({ mutateAsync: mocks.createAtomic, isPending: false }),
  useCreateProcurementItem: () => ({ mutateAsync: mocks.createItem, isPending: false }),
}));
vi.mock('@/src/components/ui', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/src/components/ui')>(),
  useToast: () => ({ toast: mocks.toast }),
}));

function renderCreate(path = '/procurement/new?have=need') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path="/procurement/new" element={<ProcurementCreate />} /></Routes>
    </MemoryRouter>,
  );
}

describe('ProcurementCreate floor controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.canCreate = true;
    mocks.currency = 'USD';
    mocks.orgFxContext = { data: { currency: 'USD' }, isPlaceholderData: false, isError: false, isPending: false, refetch: vi.fn() };
    mocks.realRole = 'Admin';
    mocks.projectQuery.isPending = false;
    mocks.projectQuery.isError = false;
    mocks.projectQuery.data = [{ value: 'p1', label: 'Project One' }];
    mocks.vendorQuery.isPending = false;
    mocks.vendorQuery.isError = false;
    mocks.vendorQuery.data = [{ value: 'v1', label: 'Supplier One', sub: 'Vendor' }];
    mocks.createRequest.mockResolvedValue({ id: 'new-id' });
    mocks.createAtomic.mockResolvedValue({ id: 'new-id' });
    mocks.createItem.mockResolvedValue({});
  });

  it('floor: Budget category choice reaches the atomic save payload', async () => {
    renderCreate();
    fireEvent.change(screen.getByLabelText('Budget category'), { target: { value: 'Materials' } });
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Material order' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(mocks.createAtomic).toHaveBeenCalledOnce());
    expect(mocks.createAtomic.mock.calls[0][0].header).toHaveProperty('budgetCategory', 'Materials');
  });

  it('floor: No category omits budget category from the atomic payload', async () => {
    renderCreate();
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Uncategorized request' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(mocks.createAtomic).toHaveBeenCalledOnce());
    expect(mocks.createAtomic.mock.calls[0][0].header).not.toHaveProperty('budgetCategory');
  });

  it('floor: Open saved request confirms leaving and opens the saved request', async () => {
    mocks.createAtomic.mockRejectedValueOnce(new ProcurementError('Open the saved request to reconcile it before retrying.', '23505'));
    renderCreate();
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Office supplies' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: /open saved request/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    const requestId = mocks.createAtomic.mock.calls[0][0].id;
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith(`/procurement/${requestId}`));
  });

});
