import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import ProcurementCreate from './ProcurementCreate';

const mocks = vi.hoisted(() => ({
  createRequest: vi.fn(),
  createItem: vi.fn(),
  navigate: vi.fn(),
  toast: vi.fn(),
  canCreate: true,
  currency: 'USD',
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
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => mocks.currency }));
vi.mock('@/src/hooks/useFkOptions', () => ({
  useProjectOptions: () => mocks.projectQuery,
  useVendorOptions: () => mocks.vendorQuery,
}));
vi.mock('@/src/hooks/useProcurementCrud', () => ({
  useCreateProcurementWithItems: () => ({ mutateAsync: mocks.createRequest, isPending: false }),
  useCreateProcurement: () => ({ mutateAsync: mocks.createRequest, isPending: false }),
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

describe('Procurement create readiness transition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.canCreate = true;
    mocks.currency = 'USD';
    mocks.realRole = 'Admin';
    mocks.projectQuery.isPending = false; mocks.projectQuery.isError = false;
    mocks.vendorQuery.isPending = false; mocks.vendorQuery.isError = false;
    mocks.vendorQuery.data = [{ value: 'v1', label: 'Supplier One', sub: 'Vendor' }];
    mocks.createRequest.mockResolvedValue({ id: 'new-id' });
    mocks.createItem.mockResolvedValue({});
  });

  it('closes an open supplier picker on a cached query error and allows retry without losing the title', async () => {
    const view = renderCreate();
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Office supplies' } });
    fireEvent.click(screen.getByRole('combobox', { name: 'Supplier' }));
    const cached = await screen.findByRole('option', { name: /Supplier One/ });
    mocks.vendorQuery.isError = true;
    view.rerender(<MemoryRouter initialEntries={['/procurement/new?have=need']}><Routes><Route path="/procurement/new" element={<ProcurementCreate />} /></Routes></MemoryRouter>);
    expect(screen.getByRole('combobox', { name: 'Supplier' })).toBeDisabled();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    fireEvent.click(cached);
    expect(screen.getByRole('combobox', { name: 'Supplier' })).not.toHaveTextContent('Supplier One');
    expect(screen.getByLabelText(/title/i)).toHaveValue('Office supplies');
    fireEvent.click(screen.getByRole('button', { name: /retry suppliers/i }));
    expect(mocks.vendorQuery.refetch).toHaveBeenCalled();
    mocks.vendorQuery.isError = false;
    mocks.vendorQuery.data = [{ value: 'v2', label: 'New Supplier', sub: 'Vendor' }];
    view.rerender(<MemoryRouter initialEntries={['/procurement/new?have=need']}><Routes><Route path="/procurement/new" element={<ProcurementCreate />} /></Routes></MemoryRouter>);
    fireEvent.click(screen.getByRole('combobox', { name: 'Supplier' }));
    fireEvent.click(await screen.findByRole('option', { name: /New Supplier/ }));
    expect(screen.getByRole('combobox', { name: 'Supplier' })).toHaveTextContent('New Supplier');
    expect(screen.getByLabelText(/title/i)).toHaveValue('Office supplies');
  });

});
