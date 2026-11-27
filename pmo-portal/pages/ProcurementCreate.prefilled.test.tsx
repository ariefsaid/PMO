/**
 * AC-STK-035: a form opened pre-filled (Stock -> Request purchase) is not dirty until the person
 * edits something. Goal oracle: Cancel and the back link land on Stock with no discard dialog when
 * nothing was typed; with a real edit (the entry row included) the dialog still guards the draft.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import userEvent from '@testing-library/user-event';
import { AuthContext, type AuthContextValue } from '@/src/auth/AuthContext';
import ProcurementCreate from './ProcurementCreate';

vi.unmock('@/src/components/workOrders/CostAttributionFields');

const mocks = vi.hoisted(() => ({
  planningOn: false,
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

vi.mock('@/src/hooks/usePurchaseLinePlanning', () => ({
  useLinePlanningEnabled: () => mocks.planningOn,
  useLineCategories: () => ({ data: [{ id: 'cat', name: 'Materials' }] }),
}));
vi.mock('@/src/hooks/useWorkOrders', () => ({ useProjectWorkOrders: () => ({ data: [{ id: 'wo-only', title: 'Only order', status: 'Issued' }], isLoading: false, isError: false }) }));
vi.mock('@/src/hooks/useWorkOrderCosts', () => ({ useCostDisciplines: () => ({ data: [{ id: 'disc', name: 'Civil', code: 'CIV' }], isLoading: false, isError: false }) }));

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


const FROM = 'from=%2Fstock%2Freorder&have=need&project=p1&title=Restock%20Pipes&lineName=Pipe&lineQty=4';
const cases = [
  { name: 'priced line (added to the table)', url: `/procurement/new?${FROM}&lineRate=25` },
  { name: 'unpriced line (pre-filled entry row)', url: `/procurement/new?${FROM}` },
];
const dialog = () => screen.queryByRole('alertdialog', { name: 'Discard your changes?' });

describe.each(cases)('AC-STK-035 pre-filled form, $name', ({ url }) => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.planningOn = false;
    mocks.realRole = 'Engineer';
  });
  afterEach(cleanup);

  it('Cancel untouched returns to Stock without the discard dialog', async () => {
    await renderAt(url);
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    await waitFor(() => expect(window.location.pathname).toBe('/stock/reorder'));
    expect(dialog()).toBeNull();
  });

  it('the back link untouched returns to Stock without the discard dialog', async () => {
    await renderAt(url);
    fireEvent.click(screen.getByRole('button', { name: /^back to stock$/i }));
    await waitFor(() => expect(window.location.pathname).toBe('/stock/reorder'));
    expect(dialog()).toBeNull();
  });

  if (url.includes('lineRate')) {
    it.each(['Line category', 'Needed by', 'Discipline for Pipe'])('Back protects a prefilled line after editing only %s', async (field) => {
      mocks.planningOn = true;
      await renderAt(url);
      const input = field === 'Needed by' ? screen.getByRole('textbox', { name: field }) : screen.getByLabelText(field);
      fireEvent.change(input, { target: { value: field === 'Line category' ? 'cat' : field === 'Needed by' ? '2026-12-31' : 'disc' } });
      fireEvent.blur(input);
      fireEvent.click(screen.getByRole('button', { name: /^back to stock$/i }));
      await waitFor(() => expect(dialog()).toBeInTheDocument());
      fireEvent.click(screen.getByRole('button', { name: /^keep editing$/i }));
      expect(input).toHaveValue(field === 'Line category' ? 'cat' : field === 'Needed by' ? '31 Dec 2026' : 'disc');
    });
  }

  it('Back after editing only attribution asks and Stay retains the choice', async () => {
    await renderAt(url);
    await userEvent.click(screen.getByRole('combobox', { name: 'Discipline' }));
    await userEvent.click(await screen.findByText('Civil', { selector: 'span[title="Civil"]' }));
    fireEvent.click(screen.getByRole('button', { name: /^back to stock$/i }));
    await waitFor(() => expect(dialog()).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /^keep editing$/i }));
    expect(screen.getByRole('combobox', { name: 'Discipline' })).toHaveTextContent('Civil');
  });

  it('Cancel after editing the title asks before discarding', async () => {
    await renderAt(url);
    fireEvent.change(screen.getByLabelText(/^title/i), { target: { value: 'Other title' } });
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    await waitFor(() => expect(dialog()).toBeInTheDocument());
    expect(window.location.pathname).toBe('/procurement/new');
  });

  it('Cancel after editing the entry row asks before discarding', async () => {
    await renderAt(url);
    fireEvent.change(screen.getByLabelText('New item description'), { target: { value: 'Pipe 2in' } });
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    await waitFor(() => expect(dialog()).toBeInTheDocument());
    expect(window.location.pathname).toBe('/procurement/new');
  });
});
