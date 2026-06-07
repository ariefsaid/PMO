import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import Procurement from './Procurement';

const seed = [
  {
    id: 'pc1',
    code: 'PROC-2026-004',
    title: 'Workstations & AV',
    status: 'Vendor Quoted',
    total_value: 150000,
    project_id: 'pr1',
    requested_by_id: 'u-alice',
    vendor_id: null,
    created_at: '2026-02-05T00:00:00Z',
    project: { name: 'Innovate Corp HQ Fit-Out', code: 'PRJ-001' },
    vendor: null,
    requested_by: { full_name: 'Alice Manager' },
  },
  {
    id: 'pc2',
    code: 'PROC-2026-005',
    title: 'Crane hire — 6 weeks',
    status: 'Paid',
    total_value: 518000,
    project_id: 'pr2',
    requested_by_id: 'u-bob',
    vendor_id: null,
    created_at: '2026-01-20T00:00:00Z',
    project: { name: 'Skyline Bridge', code: 'PRJ-002' },
    vendor: null,
    requested_by: { full_name: 'Bob Engineer' },
  },
];

const procState = { data: seed as unknown[], isPending: false, isError: false, refetch: vi.fn() };
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => procState }));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-alice', org_id: 'org-1' }, role: 'Project Manager' }),
}));
const effRole = { value: 'Project Manager' as string | null };
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: effRole.value, realRole: effRole.value }),
}));
// The New-PR create hook (modal is launched from the header) — stubbed so the
// index test stays focused on the gating + launch affordance.
const createMutate = vi.fn().mockResolvedValue({ id: 'pc-new' });
vi.mock('@/src/hooks/useProcurementCrud', () => ({
  useCreateProcurement: () => ({ mutateAsync: createMutate, isPending: false }),
}));
const navigate = vi.fn();
// Tabs are gone — row drill is a plain react-router navigate (AC-NAV-006).
vi.mock('react-router-dom', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useNavigate: () => navigate };
});

const renderPage = () =>
  render(
    <ToastProvider>
      <MemoryRouter>
        <Procurement />
      </MemoryRouter>
    </ToastProvider>,
  );

describe('Procurement index — IA-3 (real data)', () => {
  beforeEach(() => {
    procState.data = seed;
    procState.isPending = false;
    procState.isError = false;
    sessionStorage.clear();
    navigate.mockClear();
  });

  it('renders seeded requests with joined project name (AC-501)', () => {
    renderPage();
    expect(screen.getByText('Workstations & AV')).toBeInTheDocument();
    expect(screen.getByText('Innovate Corp HQ Fit-Out')).toBeInTheDocument();
  });

  it('defaults to the Table view with the lifecycle column header', () => {
    renderPage();
    expect(screen.getByRole('columnheader', { name: /Lifecycle/i })).toBeInTheDocument();
  });

  it('search filters real rows by title/code (AC-504)', async () => {
    renderPage();
    await userEvent.type(screen.getByPlaceholderText(/Filter requests/i), 'zzz');
    expect(screen.queryByText('Workstations & AV')).not.toBeInTheDocument();
    expect(screen.getByText(/No requests match/i)).toBeInTheDocument();
  });

  it('status filter narrows the list (Paid only)', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: /^Paid$/ }));
    expect(screen.queryByText('Workstations & AV')).not.toBeInTheDocument();
    expect(screen.getByText('Crane hire — 6 weeks')).toBeInTheDocument();
  });

  it('switching to the by-stage Board groups requests into stage columns', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: /Board/i }));
    // Vendor Quoted request lands in the VQ column
    expect(within(screen.getByTestId('prstage-vq')).getByText('Workstations & AV')).toBeInTheDocument();
  });

  it('AC-NAV-006: activating a row navigates to the procurement detail route (no tab)', async () => {
    renderPage();
    await userEvent.click(screen.getByText('Workstations & AV'));
    expect(navigate).toHaveBeenCalledWith('/procurement/pc1');
  });
});

describe('Procurement index — states', () => {
  beforeEach(() => {
    procState.data = seed;
    procState.isPending = false;
    procState.isError = false;
  });

  it('loading skeleton while pending (AC-505)', () => {
    procState.isPending = true;
    renderPage();
    expect(screen.getByTestId('liststate-loading')).toBeInTheDocument();
  });

  it('error state with retry (AC-507)', () => {
    procState.isError = true;
    renderPage();
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
  });

  it('empty state when zero rows teaches + offers a real Raise request action (AC-PROC-006)', () => {
    procState.data = [];
    renderPage();
    expect(screen.getByText(/No purchase requests yet/i)).toBeInTheDocument();
    // The dead disabled CTA was removed in the cleanup round; the CRUD slice
    // restores a REAL, working create affordance (header CTA + empty-state action).
    expect(screen.getAllByRole('button', { name: /raise request/i }).length).toBeGreaterThanOrEqual(1);
  });
});

describe('Procurement index — Raise request gating (AC-PROC-006)', () => {
  beforeEach(() => {
    procState.data = seed;
    procState.isPending = false;
    procState.isError = false;
    effRole.value = 'Project Manager';
    createMutate.mockClear();
    navigate.mockClear();
  });

  it('AC-PROC-006: a write-role sees the header Raise request CTA', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /raise request/i })).toBeInTheDocument();
  });

  it('AC-PROC-006: an Engineer ALSO sees Raise request (any member may raise)', () => {
    effRole.value = 'Engineer';
    renderPage();
    expect(screen.getByRole('button', { name: /raise request/i })).toBeInTheDocument();
  });

  it('AC-PROC-006: clicking Raise request opens the New PR dialog', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /raise request/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText(/title/i)).toBeInTheDocument();
  });
});
