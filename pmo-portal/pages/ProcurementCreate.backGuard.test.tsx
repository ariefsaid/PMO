/**
 * #1525 — the shared unsaved-changes guard must hold the browser's own Back button the same way
 * it holds a link. This suite mounts the REAL purchase draft page in a REAL data router (the
 * shape App.tsx uses), types an unsaved request title, then presses browser Back.
 *
 * The oracle is where the user ends up and whether the draft survived — never the guard's
 * internals: Back asks before discarding; Stay keeps the editor and the typed title; leave
 * discards and lands on the list.
 *
 * Back and Forward are the same POP path in the guard (`historyAction === 'POP'`); the symmetric
 * Forward case is proven in `src/hooks/useUnsavedChangesGuard.test.tsx`, where the guarded
 * component stays mounted across the history move.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import React from 'react';
import ProcurementCreate from './ProcurementCreate';

const mocks = vi.hoisted(() => ({
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
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => mocks.currency }));
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

const renderApp = () => {
  window.history.replaceState(null, '', '/procurement');
  const router = createBrowserRouter([
    { path: '/procurement', element: <ProcurementList /> },
    { path: '/procurement/new', element: <ProcurementCreate /> },
  ]);
  render(<RouterProvider router={router} />);
  return router;
};

const unsavedDialog = () => screen.queryByRole('alertdialog', { name: 'Discard your changes?' });

describe('#1525 browser Back holds an unsaved purchase draft', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.realRole = 'Admin';
    mocks.createRequest.mockResolvedValue({ id: 'new-id' });
    mocks.createAtomic.mockResolvedValue({ id: 'new-id' });
    mocks.createItem.mockResolvedValue({});
  });

  it('asks before discarding: Keep editing retains the draft and Discard returns to the list', async () => {
    const router = renderApp();
    await act(async () => { await router.navigate('/procurement/new?have=need'); });
    const title = screen.getByLabelText(/^title/i);
    fireEvent.change(title, { target: { value: 'Aluminium sheets for Kiln 2' } });

    // Back while the draft is dirty: the app stays put and asks.
    await act(async () => { window.history.back(); });
    await waitFor(() => expect(unsavedDialog()).toBeInTheDocument());
    expect(window.location.pathname).toBe('/procurement/new');

    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(unsavedDialog()).not.toBeInTheDocument());
    expect(window.location.pathname).toBe('/procurement/new');
    expect(screen.getByLabelText(/^title/i)).toHaveValue('Aluminium sheets for Kiln 2');

    // A second Back still asks, and Discard honours the exit the user asked for.
    await act(async () => { window.history.back(); });
    await waitFor(() => expect(unsavedDialog()).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));

    await waitFor(() => expect(window.location.pathname).toBe('/procurement'));
    expect(screen.getByTestId('procurement-list')).toBeVisible();
    expect(mocks.createAtomic).not.toHaveBeenCalled();
    expect(mocks.createRequest).not.toHaveBeenCalled();
  });

  it('a pristine draft leaves on Back with no prompt', async () => {
    const router = renderApp();
    await act(async () => { await router.navigate('/procurement/new?have=need'); });

    await act(async () => { window.history.back(); });
    await waitFor(() => expect(window.location.pathname).toBe('/procurement'));
    expect(screen.getByTestId('procurement-list')).toBeVisible();
    expect(unsavedDialog()).not.toBeInTheDocument();
  });

  it('N01: a typed add-row alone is unsaved work — Back asks before discarding it', async () => {
    const router = renderApp();
    await act(async () => { await router.navigate('/procurement/new?have=need'); });
    fireEvent.change(screen.getByLabelText('New item description'), { target: { value: 'Typed but never added' } });
    fireEvent.change(screen.getByLabelText('New item quantity'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('New item unit price'), { target: { value: '12' } });

    // Back while ONLY the add-row holds typed work: the app stays put and asks.
    await act(async () => { window.history.back(); });
    await waitFor(() => expect(unsavedDialog()).toBeInTheDocument());
    expect(window.location.pathname).toBe('/procurement/new');

    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(unsavedDialog()).not.toBeInTheDocument());
    expect(screen.getByLabelText('New item description')).toHaveValue('Typed but never added');
    expect(mocks.createAtomic).not.toHaveBeenCalled();
  });
});

afterEach(() => {
  // Keep each router's history listeners out of the next case.
  cleanup();
});
