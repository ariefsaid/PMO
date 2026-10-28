import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';

// The ERP orphan workspace moved into Procurement ("Not in a procurement" tab, Finance/Admin).
// `/erp-purchases` is a legacy link that must land there; the workspace goals (list with project
// and linking, honest empty / error / no-access states) are proven on the Procurement page.
const { orphansMock, projectsMock, mayMock, roleState } = vi.hoisted(() => ({
  orphansMock: vi.fn(),
  projectsMock: vi.fn(),
  mayMock: vi.fn(),
  roleState: { role: 'Finance' as string },
}));
vi.mock('@/src/hooks/useErpPurchases', () => ({
  useErpOrphans: orphansMock,
  useErpPurchases: () => ({ data: [], isPending: false, isError: false }),
  useHasErpPurchases: () => ({ data: false }),
}));
vi.mock('@/src/hooks/useProjects', () => ({ useProjects: projectsMock, useProject: () => ({ data: null }) }));
vi.mock('@/src/hooks/useFkOptions', () => ({ useProjectOptions: () => ({ data: [] }), useVendorOptions: () => ({ data: [] }) }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => mayMock }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u-fin', org_id: 'org-1' }, role: roleState.role }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ effectiveRole: roleState.role, realRole: roleState.role }) }));
vi.mock('@/src/hooks/useErpPurchaseLinks', () => ({ useLinkErpDocuments: () => ({ mutateAsync: vi.fn(), isPending: false }) }));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProcurements: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useProjectProcurements: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));

import Procurement from './Procurement';
import ErpPurchasesPage from './ErpPurchases';

const row = { id: 'r1', doctype: 'Purchase Order', name: 'PUR-ORD-9', supplier: 'Acme', docDate: '2026-01-05', dueDate: null, billNo: null,
  currency: 'IDR', grandTotal: 900, netTotal: 800, outstanding: null, erpStatus: 'To Bill', isReturn: false, projectIds: ['p1'],
  procurementId: null as string | null, linkId: null as string | null };

const Probe = () => {
  const location = useLocation();
  return <output data-testid="route-path">{location.pathname + location.search}</output>;
};

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

const renderOrphans = () => render(
  <QueryClientProvider client={client()}>
    <ToastProvider>
      <MemoryRouter initialEntries={['/procurement?tab=orphans']}>
        <Procurement />
      </MemoryRouter>
    </ToastProvider>
  </QueryClientProvider>,
);

beforeEach(() => {
  roleState.role = 'Finance';
  mayMock.mockReset().mockReturnValue(true);
  projectsMock.mockReset().mockReturnValue({ data: [{ id: 'p1', name: 'Tower Retrofit' }] });
  orphansMock.mockReset();
  sessionStorage.clear();
});

describe('ErpPurchases legacy link', () => {
  it('FR-PFE-041 /erp-purchases lands on the Procurement "Not in a procurement" tab', () => {
    render(
      <MemoryRouter initialEntries={['/erp-purchases']}>
        <Routes>
          <Route path="/erp-purchases" element={<ErpPurchasesPage />} />
          <Route path="/procurement" element={<Probe />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId('route-path')).toHaveTextContent('/procurement?tab=orphans');
  });
});

describe('Procurement "Not in a procurement" tab', () => {
  it('FR-PFE-041 lists the org\'s accounting-system documents not in a procurement, with their project, and offers linking', () => {
    orphansMock.mockReturnValue({ data: [row, { ...row, id: 'r2', name: 'PUR-ORD-10', projectIds: [] }], isPending: false, isError: false });
    renderOrphans();
    expect(screen.getByRole('tab', { name: /Not in a procurement/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByText('Tower Retrofit').length).toBeGreaterThan(0);
    expect(screen.getAllByText('No project').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /^Link PUR-ORD-/ })).toHaveLength(2);
  });

  it('reads the default orphan list (set-aside documents are not in it), so the tab count matches the rows shown', () => {
    orphansMock.mockReturnValue({ data: [row, { ...row, id: 'r2', name: 'PUR-ORD-10' }], isPending: false, isError: false });
    renderOrphans();
    expect(orphansMock).toHaveBeenCalledWith(undefined, { enabled: true });
    expect(screen.getAllByRole('button', { name: /^Link PUR-ORD-/ })).toHaveLength(2);
    expect(screen.getByRole('tab', { name: /Not in a procurement/ })).toHaveTextContent('2');
  });

  it('when nothing is waiting, says so instead of an empty table', () => {
    orphansMock.mockReturnValue({ data: [], isPending: false, isError: false });
    renderOrphans();
    expect(screen.getByText('Every accounting-system document is in a procurement')).toBeInTheDocument();
  });

  it('shows an error state instead of a table', () => {
    orphansMock.mockReturnValue({ data: undefined, isPending: false, isError: true, refetch: vi.fn() });
    renderOrphans();
    expect(screen.getByText("Couldn't load documents not in a procurement")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Link PUR-ORD-/ })).toBeNull();
  });

  it('a role without access gets no orphans tab and the org-wide list is never requested', () => {
    roleState.role = 'Project Manager';
    orphansMock.mockReturnValue({ data: undefined, isPending: false, isError: false });
    renderOrphans();
    expect(screen.queryByRole('tab', { name: /Not in a procurement/ })).toBeNull();
    expect(orphansMock).toHaveBeenLastCalledWith(undefined, { enabled: false });
  });
});
