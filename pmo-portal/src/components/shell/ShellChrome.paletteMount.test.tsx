/**
 * #2096 review finding 5 — the lazy ⌘K palette-mount wiring had no test.
 *
 * `ShellChrome.coldMount` pins only the CLOSED case (which passes trivially now: the live bridge is
 * not rendered at all), and the two App-level palette journeys stub the live module out
 * (`vi.mock('@/src/hooks/useRecordSearchData', () => ({ default: () => null }))`). So deleting or
 * mistyping `{recordSearchMounted && <Suspense…>}` in App.tsx would leave the whole unit suite green
 * while ⌘K record search stayed dead until the release-PR e2e.
 *
 * This journey keeps the REAL bridge and the REAL shim: ⌘K → the lazily-mounted data module loads →
 * a project row reaches the palette.
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const { dal, contactDal } = vi.hoisted(() => ({
  dal: {
    list: vi.fn(async () => [{ id: 'p1', name: 'Harbour Expansion', code: 'PRJ-0142', status: 'active' }]),
    listProjects: vi.fn(async () => []),
    listProcurements: vi.fn(async () => []),
    getSalesPipeline: vi.fn(async () => ({ projects: [], stages: [] })),
  },
  // The contact index reads a different row shape; an empty directory keeps this journey on projects.
  contactDal: { list: vi.fn(async () => []) },
}));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1', full_name: 'U' }, role: 'Admin', signOut: vi.fn() }),
}));
vi.mock('@/src/lib/db/projects', async (orig) => ({
  ...((await orig()) as object),
  listProjects: dal.listProjects,
}));
vi.mock('@/src/lib/db/procurements', async (orig) => ({
  ...((await orig()) as object),
  listProcurements: dal.listProcurements,
}));
vi.mock('@/src/lib/db/dashboard', async (orig) => ({
  ...((await orig()) as object),
  getSalesPipeline: dal.getSalesPipeline,
}));
vi.mock('@/src/lib/repositories/companies', () => ({
  companyRepository: dal,
  contactRepository: contactDal,
}));
vi.mock('@/src/lib/repositories/incidents', () => ({ incidentRepository: dal }));
vi.mock('@/src/lib/repositories/meetings', () => ({ meetingRepository: dal }));
vi.mock('@/src/lib/repositories/notifications', () => ({
  notificationRepository: { unreadCount: async () => 0, listPage: async () => ({ rows: [], nextCursor: null }), markRead: async () => {} },
}));
vi.mock('@/src/lib/repositories/projects', () => ({ projectRepository: dal }));
// Query-specific invoice/receipt references are a separate read (UDS-40); not this journey's subject.
vi.mock('@/src/hooks/useReferenceRecordSearch', () => ({
  useReferenceRecordSearch: () => ({ data: undefined, isFetching: false, isError: false, refetch: vi.fn() }),
}));

import { ShellChrome } from '@/App';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';

describe('⌘K palette lazy mount (#2096)', () => {
  it('mounts the lazily-loaded record-search bridge on the first open and renders a project row', async () => {
    // Warm the lazy chunk so the cold jsdom import is not inside findBy's timeout.
    await import('@/src/hooks/useRecordSearchData');

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/projects/p1']}>
          <ImpersonationProvider realRole="Admin">
            <ToastProvider>
              <ShellChrome />
            </ToastProvider>
          </ImpersonationProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeTruthy();
    // The bridge mounted because the palette opened (not with the shell): its list read fires now.
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Harbour' } });

    expect(await screen.findByText('Harbour Expansion', undefined, { timeout: 5000 })).toBeTruthy();
    expect(dal.list).toHaveBeenCalled();

    // The /projects/p1 route lazy-loads page chunks; let them finish before the environment tears down.
    await vi.dynamicImportSettled();
  }, 30_000);
});
