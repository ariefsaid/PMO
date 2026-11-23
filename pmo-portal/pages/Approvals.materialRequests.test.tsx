import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import ApprovalsPage from './Approvals';

// #2685: the material-request section of /approvals. The other kinds are held empty so this section is the surface under test.
const h = vi.hoisted(() => ({
  setting: { data: undefined as boolean | undefined },
  waiting: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  role: 'Engineer',
}));
const idle = { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() };

vi.mock('@/src/hooks/useMaterialRequests', () => ({
  useWaitingForMe: () => h.waiting,
  useMaterialRequest: (id: string | undefined) => ({ data: id ? { id, number: `MR-${id}`, workOrderId: 'wo1', projectId: 'p1', neededBy: '2026-12-01' } : undefined }),
}));
vi.mock('./materialRequests/shared', () => ({ RequestWorkOrder: () => <span>WO-1 · Foundations</span> }));
vi.mock('@/pages/approvals/SalesInvoiceApprovalSection', () => ({ SalesInvoiceApprovalSection: () => null }));
vi.mock('@/src/hooks/useInvoicesAwaitingViewer', () => ({ useInvoicesAwaitingViewer: () => ({ rows: [], isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/hooks/useRevenueMode', () => ({ useRevenueMode: () => 'native' }));
vi.mock('@/src/hooks/useExpenseClaims', () => ({ useExpenseClaimsAwaitingDecision: () => idle }));
vi.mock('@/src/hooks/useMedicalRelease', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/src/hooks/useMedicalRelease')>()), useMedicalReleases: () => ({ data: [], isPending: false, isError: false, refetch: () => undefined }) }));
vi.mock('@/src/hooks/useImprest', () => ({ useImprestAwaiting: () => ({ ...idle, data: { plans: [], replenishments: [] } }) }));
vi.mock('@/src/hooks/useTimesheetApproval', () => ({
  useReopenableApprovedTimesheets: () => idle,
  useTimesheetsAwaitingApproval: () => idle,
  useTimesheetMutations: () => ({ approve: { mutate: vi.fn(), isPending: false }, settleBatch: vi.fn(), reject: { mutate: vi.fn(), isPending: false }, submit: { mutate: vi.fn(), isPending: false } }),
  usePushesNeedingAttention: () => ({ ...idle, retry: { mutate: vi.fn(), isPending: false } }),
  useEmployeeLinkConfirm: () => ({ links: idle, profiles: [], confirm: { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false } }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => ({ ...idle, refetch: vi.fn() }) }));
vi.mock('@/src/hooks/useProcurementDetail', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/hooks/useProcurementDetail')>();
  return { ...actual, useProcurementBulkTransition: () => ({ mutateAsync: vi.fn() }) };
});
vi.mock('./approvals/ProcurementApprovalRow', () => ({ ProcurementApprovalPreview: () => null }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u-me', org_id: 'org-1' }, role: h.role }) }));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: h.role, realRole: h.role }),
  useOptionalRealRole: () => h.role,
}));

const step = (id: string, n: number, sent: string) => ({ requestId: id, stepPosition: n, role: 'Finance', label: 'Stock check', actingFor: null, submittedAt: sent });

const renderPage = (scope = 'all') => {
  vi.stubGlobal('matchMedia', vi.fn().mockImplementation(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  return render(
    <MemoryRouter initialEntries={[`/approvals?scope=${scope}`]}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider><ApprovalsPage /></ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
};

beforeEach(() => {
  h.setting.data = undefined;
  h.waiting.data = [];
  h.waiting.isPending = false;
  h.waiting.isError = false;
  h.role = 'Engineer';
});
afterEach(() => vi.unstubAllGlobals());

describe('AC-MRI-012 /approvals lists material-request steps awaiting the viewer', () => {
  it('shows the section with a count, oldest first, each row opening its request, and counts it in All pending', () => {
    h.role = 'Project Manager';
    h.setting.data = true;
    h.waiting.data = [step('r1', 1, '2026-11-18T08:00:00Z'), step('r2', 2, '2026-11-19T08:00:00Z')];
    renderPage('all');
    const section = screen.getByRole('region', { name: 'Material requests awaiting you' });
    expect(within(section).getByText('Material requests awaiting you (2)')).toBeInTheDocument();
    const links = within(section).getAllByRole('link');
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['/material-requests/r1', '/material-requests/r2']);
    expect(within(section).getByText('MR-r1')).toBeInTheDocument();
    expect(within(section).getAllByText('Step 1: Stock check').length).toBe(1);
    const scope = screen.getByLabelText('Approvals scope');
    expect(within(scope).getByText('All pending').closest('[role="tab"], button')).toHaveTextContent('2');
    expect(screen.queryByTestId('approvals-caught-up')).toBeNull();
  });

  it('its own scope shows the section alone', () => {
    h.role = 'Project Manager';
    h.setting.data = true;
    h.waiting.data = [step('r1', 1, '2026-11-18T08:00:00Z')];
    renderPage('material');
    expect(screen.getByRole('region', { name: 'Material requests awaiting you' })).toBeInTheDocument();
  });

  it('a failed read says so, with a retry, instead of a false "all caught up"', () => {
    h.role = 'Project Manager';
    h.setting.data = true;
    h.waiting.isError = true;
    renderPage('all');
    expect(screen.getByText("Couldn't load material requests awaiting you")).toBeInTheDocument();
    expect(screen.queryByTestId('approvals-caught-up')).toBeNull();
  });
});

describe('AC-MRI-013 (revised, fix-waiting item 1) a waiting step is listed whatever the setting says', () => {
  it.each([[false], [undefined], [true]])('setting %s: the step the viewer can decide is listed and counted; the setting only governs notifications', (value) => {
    h.role = 'Project Manager';
    h.setting.data = value;
    h.waiting.data = [step('r1', 1, '2026-11-18T08:00:00Z')];
    renderPage('all');
    expect(screen.getByRole('region', { name: 'Material requests awaiting you' })).toBeInTheDocument();
    expect(screen.queryByTestId('approvals-caught-up')).toBeNull();
  });

  it('nothing waiting reads "all caught up"', () => {
    h.role = 'Project Manager';
    renderPage('all');
    expect(screen.getByTestId('approvals-caught-up')).toBeInTheDocument();
  });
});

describe('AC-MRI-014 a viewer whose only waiting work is a material-request step', () => {
  it('gets the page, not "no access", whatever the setting says', () => {
    h.role = 'Engineer';
    h.setting.data = true;
    h.waiting.data = [step('r1', 1, '2026-11-18T08:00:00Z')];
    renderPage('all');
    expect(screen.queryByText(/don't have access to approvals/i)).toBeNull();
    expect(screen.getByRole('region', { name: 'Material requests awaiting you' })).toBeInTheDocument();
  });

  it('keeps the no-access page for a viewer with nothing to decide', () => {
    h.role = 'Engineer';
    renderPage('all');
    expect(screen.getByText(/don't have access to approvals/i)).toBeInTheDocument();
  });
});
