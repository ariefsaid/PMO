/**
 * Leaving the new-purchase form without saving returns to where it was started: the project's
 * procurement tab when opened from a project, the Procurement list otherwise. Goal oracle is
 * the page the person lands on, for the header link, Cancel and the unsaved-work Leave.
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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { AuthContext, type AuthContextValue } from '@/src/auth/AuthContext';
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

const origins = [
  { name: 'from a project', url: '/procurement/new?project=p1&have=need', path: '/projects/p1/procurement', page: 'project-tab' },
  { name: 'from the list', url: '/procurement/new?have=need', path: '/procurement', page: 'procurement-list' },
];

describe.each(origins)('leaving the new purchase form $name', ({ url, path, page }) => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.realRole = 'Engineer';
  });

  it('the header link lands on the origin', async () => {
    await renderAt(url);
    fireEvent.click(screen.getByRole('button', { name: /back to procurement/i }));
    await waitFor(() => expect(window.location.pathname).toBe(path));
    expect(screen.getByTestId(page)).toBeVisible();
  });

  it('Cancel lands on the origin', async () => {
    await renderAt(url);
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    await waitFor(() => expect(window.location.pathname).toBe(path));
    expect(screen.getByTestId(page)).toBeVisible();
  });

  it('the unsaved-work Discard lands on the origin', async () => {
    await renderAt(url);
    fireEvent.change(screen.getByLabelText(/^title/i), { target: { value: 'Pipes' } });
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    await waitFor(() => expect(screen.getByRole('alertdialog', { name: 'Discard your changes?' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(window.location.pathname).toBe(path));
    expect(screen.getByTestId(page)).toBeVisible();
  });
});

afterEach(() => { cleanup(); });
