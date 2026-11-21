/**
 * #2697 the purchase type on the new-purchase form. Goal oracle: with purchase types off nothing new appears and the
 * saved request carries no type; with them on, the person picks a type, a rental-flagged type asks for its period
 * (whatever the type is called), and the saved request carries exactly what was chosen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { AuthContext, type AuthContextValue } from '@/src/auth/AuthContext';
import ProcurementCreate from './ProcurementCreate';

const mocks = vi.hoisted(() => ({
  types: { enabled: false, list: [] as Array<{ id: string; name: string; nameId: string | null; isRental: boolean; position: number; active: boolean }> },
  createRequest: vi.fn(),
  createAtomic: vi.fn(),
  createItem: vi.fn(),
  toast: vi.fn(),
  canCreate: true,
  currency: 'USD',
  realRole: 'Admin' as string,
  projectQuery: { data: [{ value: 'p1', label: 'Project One' }], isPending: false, isError: false, refetch: vi.fn() },
  vendorQuery: { data: [{ value: 'v1', label: 'Supplier One', sub: 'Vendor' }], isPending: false, isError: false, refetch: vi.fn() },
}));

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
vi.mock('@/src/hooks/usePurchaseTypes', () => ({
  usePurchaseTypesEnabled: () => ({ data: mocks.types.enabled }),
  usePurchaseTypes: () => ({ data: mocks.types.list }),
}));
vi.mock('@/src/hooks/useOrgCurrency', () => ({
  useOrgCurrency: () => mocks.currency,
  useOrgCurrencyState: () => ({ currency: mocks.currency, isResolved: true, isError: false }),
}));
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

const ProcurementList = () => <div data-testid="procurement-list">Procurement</div>;
const StockPage = () => <div data-testid="stock-page">Stock</div>;
const ProjectProcurementTab = () => <div data-testid="project-tab">Project procurement</div>;

const authValue = {
  session: null,
  currentUser: null,
  role: null,
  loading: false,
  profileError: null,
  profileErrorKind: null,
  signInWithPassword: async () => ({ error: null }),
  signInWithMagicLink: async () => ({ error: null }),
  signInWithMicrosoft: async () => ({ error: null }),
  requestPasswordReset: async () => ({ error: null }),
  updatePassword: async () => ({ error: null }),
  resendEmailConfirmation: async () => ({ error: null }),
  signOut: async () => {},
  refreshCurrentUser: async () => ({ error: null }),
} satisfies AuthContextValue;

const renderAt = async (url: string) => {
  window.history.replaceState(null, '', '/somewhere');
  const router = createBrowserRouter([
    { path: '/somewhere', element: <div>start</div> },
    { path: '/procurement', element: <ProcurementList /> },
    { path: '/projects/:projectId/procurement', element: <ProjectProcurementTab /> },
    { path: '/stock/reorder', element: <StockPage /> },
    { path: '/procurement/new', element: <ProcurementCreate /> },
    { path: '/procurement/:id', element: <div data-testid="saved">saved</div> },
  ]);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AuthContext.Provider value={authValue}>
        <RouterProvider router={router} />
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
  await act(async () => { await router.navigate(url); });
};


const list = [
  { id: 'g', name: 'Goods', nameId: 'Barang', isRental: false, position: 1, active: true },
  { id: 'h', name: 'Hire', nameId: null, isRental: true, position: 2, active: true },
  { id: 'old', name: 'Old', nameId: null, isRental: false, position: 3, active: false },
];

describe('purchase type on the new purchase form (#2697)', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.realRole = 'Engineer'; mocks.types = { enabled: false, list: [] }; mocks.createAtomic.mockResolvedValue({ id: 'new1' }); });

  it('AC-PTR-013 with purchase types off the form shows no type field', async () => {
    await renderAt('/procurement/new?have=need');
    expect(screen.queryByLabelText('Purchase type')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Rental from/)).not.toBeInTheDocument();
  });

  it('AC-PTR-014 with them on, the active types are offered; a rental-flagged type asks for its period, a plain one does not', async () => {
    mocks.types = { enabled: true, list };
    await renderAt('/procurement/new?have=need');
    const select = screen.getByLabelText('Purchase type') as HTMLSelectElement;
    expect([...select.options].map((o) => o.text)).toEqual(['No type', 'Goods', 'Hire']);
    fireEvent.change(select, { target: { value: 'g' } });
    expect(screen.queryByLabelText(/Rental from/)).not.toBeInTheDocument();
    fireEvent.change(select, { target: { value: 'h' } });
    expect(screen.getByLabelText(/Rental from/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Rental to/)).toBeInTheDocument();
  });

  it('AC-PTR-014 a rental without its period is not sent; with it, the type and period go to the server', async () => {
    mocks.types = { enabled: true, list };
    await renderAt('/procurement/new?have=need');
    fireEvent.change(screen.getByLabelText(/^title/i), { target: { value: 'Crane' } });
    fireEvent.change(screen.getByLabelText('Purchase type'), { target: { value: 'h' } });
    fireEvent.click(screen.getByRole('button', { name: /^save draft$/i }));
    await waitFor(() => expect(screen.getAllByText('Enter the rental period.').length).toBeGreaterThan(0));
    expect(mocks.createAtomic).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/Rental from/), { target: { value: '2026-01-01' } });
    fireEvent.change(screen.getByLabelText(/Rental to/), { target: { value: '2026-01-31' } });
    fireEvent.click(screen.getByRole('button', { name: /^save draft$/i }));
    await waitFor(() => expect(mocks.createAtomic).toHaveBeenCalled());
    expect(mocks.createAtomic.mock.calls[0][0].header).toMatchObject({ purchaseTypeId: 'h', rentalFrom: '2026-01-01', rentalTo: '2026-01-31' });
  });

  it('AC-PTR-001 with no type chosen the request carries none of the new fields', async () => {
    mocks.types = { enabled: true, list };
    await renderAt('/procurement/new?have=need');
    fireEvent.change(screen.getByLabelText(/^title/i), { target: { value: 'Pipes' } });
    fireEvent.click(screen.getByRole('button', { name: /^save draft$/i }));
    await waitFor(() => expect(mocks.createAtomic).toHaveBeenCalled());
    const header = mocks.createAtomic.mock.calls[0][0].header;
    expect(header).not.toHaveProperty('purchaseTypeId');
    expect(header).not.toHaveProperty('rentalFrom');
  });
});

afterEach(() => { cleanup(); });
