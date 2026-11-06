/**
 * AC-PERF-001 — the VAT-editability read is ON DEMAND, not on mount (plan Step 1a).
 *
 * Only the contract-value editor needs `get_project_vat_editability`, so the header must not
 * read it until the editor OPENS. This suite drives the REAL `useProjectVatEditability` hook
 * against a recording supabase stub (the other suites stub the hook itself, which cannot see
 * a request-timing change), and asserts:
 *   · no VAT read fires while the header mounts;
 *   · opening the editor fires it EXACTLY ONCE (the enabled-flip and the begin-edit refetch
 *     must dedupe into one request);
 *   · the PPN flag stays locked (hint shows the checking state) until the read resolves.
 */
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

const stub = vi.hoisted(() => {
  /** Resolvers for each `get_project_vat_editability` call, in call order. The test releases them. */
  const vatResolvers: Array<(payload: { data: unknown; error: unknown }) => void> = [];

  function rpcBuilder(fn: string) {
    const builder: Record<string, unknown> = {
      select: () => builder,
      order: () => builder,
      range: () => builder,
      limit: () => builder,
      abortSignal: () => builder,
      throwOnError: () => builder,
      then: (
        onFulfilled?: ((value: { data: unknown; error: unknown }) => unknown) | null,
        onRejected?: ((reason: unknown) => unknown) | null,
      ) => {
        if (fn === 'get_project_vat_editability') {
          return new Promise<{ data: unknown; error: unknown }>((resolve: (payload: { data: unknown; error: unknown }) => void) => { vatResolvers.push(resolve); })
            .then(onFulfilled, onRejected);
        }
        return Promise.resolve({ data: [], error: null }).then(onFulfilled, onRejected);
      },
      catch: (onRejected?: ((reason: unknown) => unknown) | null) =>
        Promise.resolve({ data: [], error: null }).catch(onRejected),
      finally: (onFinally?: (() => void) | null) =>
        Promise.resolve({ data: [], error: null }).finally(onFinally),
    };
    return builder;
  }

  const client = {
    from: () => rpcBuilder('unused-table'),
    rpc: (fn: string) => rpcBuilder(fn),
    auth: { getSession: async () => ({ data: { session: null }, error: null }) },
    channel: () => ({ on: () => ({ subscribe: () => ({ unsubscribe: () => {} }) }) }),
    removeChannel: () => {},
  };
  return { vatResolvers, client };
});

vi.mock('@/src/lib/supabase/client', () => ({ supabase: stub.client }));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'user', org_id: 'org-A' }, role: 'Finance' }),
}));
vi.mock('@/src/auth/usePermission', () => ({
  usePermission: () => () => true,
  CanWrite: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({
    realRole: 'Finance',
    effectiveRole: 'Finance',
    canImpersonate: false,
    viewAs: vi.fn(),
  }),
}));
vi.mock('@/src/hooks/useProjects', () => ({
  useProjectMutations: () => ({
    archive: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
    setContractValue: { mutateAsync: vi.fn(), isPending: false },
    updateHeader: { mutateAsync: vi.fn(), isPending: false },
  }),
  useClientCompanies: () => ({ data: [] }),
  useProjectManagers: () => ({ data: [] }),
}));
// The compact header must not fetch money-strip data in this suite — its read behaviour is
// ProjectDetailHeader.financeDemand's concern; here only the VAT read's timing is under test.
vi.mock('@/src/hooks/useBudget', () => ({
  useProjectBudget: () => ({ data: 0, isPending: false, isError: false }),
}));
vi.mock('@/src/hooks/useProjectFinances', () => ({
  useProjectFinances: () => ({ data: undefined, isPending: false, isError: false }),
}));
vi.mock('@/src/components/ui/useIsDesktop', () => ({ useIsDesktop: () => true }));
vi.mock('@/src/components/fx/FxEquivalent', () => ({ default: () => null }));
vi.mock('@/components/ProjectStatusControl', () => ({ default: () => null }));
vi.mock('@/pages/project-detail/ProjectErpLink', () => ({ ProjectErpLink: () => null }));

import ProjectDetailHeader from '../ProjectDetailHeader';

const project = {
  id: '6a2cf7e2-1c3b-4a5d-9e8f-0a1b2c3d4e5f',
  name: 'Sample project',
  status: 'Ongoing Project',
  currency: 'USD',
  contract_value: 100,
  tax_treatment: 'exclusive',
  subject_to_vat: true,
  client_id: null,
  project_manager_id: null,
} as unknown as ProjectWithRefs;

function renderCompactHeader() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ToastProvider>
          <ProjectDetailHeader project={project} compact />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Release the n-th (0-based) VAT read with the given payload. */
const resolveVat = (n: number, payload: unknown) => {
  const resolve = stub.vatResolvers[n];
  expect(resolve, `VAT read #${n + 1} has not fired`).toBeDefined();
  resolve({ data: payload, error: null });
};

/** Open the compact header's "More actions" menu and click "Change contract value". */
async function openValueEditor() {
  const header = screen.getByTestId('record-header');
  const menu = within(header).getByLabelText('More actions').closest('details');
  expect(menu).not.toBeNull();
  await userEvent.click(within(menu!).getByLabelText('More actions'));
  await userEvent.click(within(menu!).getByRole('button', { name: 'Change contract value' }));
}

beforeEach(() => {
  stub.vatResolvers.length = 0;
});

describe('VAT editability is read on demand (AC-PERF-001, plan Step 1a)', () => {
  it('does not read VAT editability while the header mounts', async () => {
    renderCompactHeader();
    await waitFor(() => expect(screen.getByTestId('record-header')).toBeInTheDocument());
    // Let every scheduled effect drain; still no VAT read.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(stub.vatResolvers).toHaveLength(0);
  });

  it('reads it exactly once when the contract-value editor opens, and keeps PPN locked until it resolves', async () => {
    renderCompactHeader();
    const header = screen.getByTestId('record-header');
    await openValueEditor();

    // The editor is open; the read is in flight and the flag is locked while it is pending.
    expect(screen.getByTestId('contract-vat-flag')).toBeInTheDocument();
    expect(screen.getByTestId('contract-vat-flag-hint')).toHaveTextContent(/Checking whether PPN can be changed/i);
    expect(screen.getByRole('checkbox', { name: /Subject to VAT/i })).toHaveAttribute('aria-disabled', 'true');

    // Exactly ONE request for the whole open — the enabled-flip and the begin-edit refetch dedupe.
    // (the repository module loads lazily, so the call lands a tick after the editor opens)
    await waitFor(() => expect(stub.vatResolvers).toHaveLength(1));

    // A live invoice resolves: the flag stays locked with the reason stated.
    resolveVat(0, { eligible: false, reason: 'vat-live-invoice', hasInvoices: true });
    await waitFor(() =>
      expect(screen.getByTestId('contract-vat-flag-hint')).toHaveTextContent(/invoice that is not cancelled/i),
    );
    expect(screen.getByRole('checkbox', { name: /Subject to VAT/i })).toHaveAttribute('aria-disabled', 'true');
    expect(stub.vatResolvers).toHaveLength(1);
    expect(header).toBeInTheDocument();
  });

  it('unlocks the PPN flag once an eligible read resolves', async () => {
    renderCompactHeader();
    await openValueEditor();
    resolveVat(0, { eligible: true, reason: null, hasInvoices: false });
    await waitFor(() =>
      expect(screen.getByTestId('contract-vat-flag-hint')).toHaveTextContent(/Editable until an invoice is raised/i),
    );
    // Unlocked: no aria-disabled at all.
    expect(screen.getByRole('checkbox', { name: /Subject to VAT/i })).not.toHaveAttribute('aria-disabled');
    expect(stub.vatResolvers).toHaveLength(1);
  });
});
