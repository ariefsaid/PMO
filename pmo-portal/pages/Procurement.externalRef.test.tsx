import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
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
    currency: 'USD',
    project_id: 'pr1',
    requested_by_id: 'u-alice',
    vendor_id: null,
    created_at: '2026-02-05T00:00:00Z',
    project: { name: 'Innovate Corp HQ Fit-Out', code: 'PRJ-001' },
    vendor: null,
    requested_by: { full_name: 'Alice Manager' },
    pr_refs: [{ external_ref: 'PRQ-0026100001' }],
    po_refs: [],
    vi_refs: [],
  },
  {
    id: 'pc2',
    code: 'PROC-2026-005',
    title: 'Crane hire — 6 weeks',
    status: 'Paid',
    total_value: 518000,
    currency: 'USD',
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
const useProcurementsMock = vi.fn((_opts?: { withRefs?: boolean }) => procState);
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: (o?: { withRefs?: boolean }) => useProcurementsMock(o) }));
// FK pickers in the New-PR modal read cached option hooks; stub them so the index
// test needs no QueryClient (the loaders just hand back the static list).
vi.mock('@/src/hooks/useFkOptions', () => ({
  useProjectOptions: () => ({ data: [] }),
  useVendorOptions: () => ({ data: [] }),
}));
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
// list-working-set-return (#682): the list-return seam captures context only from the list's own
// canonical index path (`/procurement`), so the default entry must be `/procurement`, not `/`.
const renderPage = (initialPath = '/procurement') =>
  render(
    <ToastProvider>
      <MemoryRouter initialEntries={[initialPath]}>
        <Procurement />
      </MemoryRouter>
    </ToastProvider>,
  );


describe('Procurement index — external reference search (#769)', () => {
  beforeEach(() => {
    procState.data = seed;
    sessionStorage.clear();
  });

  it("AC-EXT-001: the list search matches a record's external reference (case-insensitive)", async () => {
    renderPage();
    await userEvent.type(screen.getByPlaceholderText(/Filter requests/i), 'prq-0026100001');
    expect(screen.getByText('Workstations & AV')).toBeInTheDocument();
    expect(screen.queryByText('Crane hire — 6 weeks')).not.toBeInTheDocument();
  });

  it('AC-EXT-001: the index asks for the reference embeds (and only the index does)', () => {
    renderPage();
    expect(useProcurementsMock).toHaveBeenCalledWith({ withRefs: true });
  });
});
