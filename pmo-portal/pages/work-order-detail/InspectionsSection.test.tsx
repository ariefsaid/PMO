vi.mock("@/src/hooks/useOrderJobRoles", () => ({ useMayOrderPurchases: () => h.mayOrder }));
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { InspectionsSection } from './InspectionsSection';
import { resetActiveLocale, setActiveLocale, setActiveOrgTimezone } from '@/src/lib/locale/activeLocale';

/** #2580 — the work-order page's inspections panel: the money fence is the server's, the screen shows what it was given (FR-TPI-008, FR-TPI-017). */
const h = vi.hoisted(() => ({
  role: 'Project Manager' as string,
  mayOrder: false,
  list: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  costs: { data: [] as unknown[] },
  files: { data: [] as unknown[] },
  fileReads: vi.fn(),
  mutations: {} as Record<string, { mutate: ReturnType<typeof vi.fn>; mutateAsync: ReturnType<typeof vi.fn>; isPending: boolean }>,
}));
const render = (ui: React.ReactElement) => rtlRender(<MemoryRouter>{ui}</MemoryRouter>);
const mut = () => ({ mutate: vi.fn(), mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false });
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'me', org_id: 'org-1' } }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.role }) }));
vi.mock('@/src/hooks/useThirdPartyInspections', () => ({
  useWorkOrderInspections: () => h.list,
  useInspectionCosts: () => h.costs,
  useInspectionFilesBatch: (ids: string[]) => { h.fileReads(ids); return h.files; },
  useInspectionMutations: () => h.mutations,
}));

const insp = (extra: Record<string, unknown>) => ({
  id: 'i1', org_id: 'org-1', work_order_id: 'wo', title: 'Weld test', test_kind: null, planned_date: '2026-12-01', note: null,
  required_for: ['billing'], status: 'requested', result: 'pending', procurement_id: null, waived_at: null, waiver_reason: null,
  cancel_reason: null, created_by: 'someone', ...extra,
});

beforeEach(() => {
  h.mayOrder = false;
  h.role = 'Project Manager';
  h.list = { data: [], isPending: false, isError: false, refetch: vi.fn() };
  h.costs = { data: [] };
  h.files = { data: [] };
  h.fileReads.mockClear();
  h.mutations = Object.fromEntries(['create', 'raisePurchase', 'invite', 'execute', 'report', 'waive', 'cancel', 'addFile'].map((k) => [k, mut()]));
});

describe('InspectionsSection', () => {
  it('reads files once for 30 executed inspections, excluding other states', () => {
    h.list.data = Array.from({ length: 30 }, (_, n) => insp({ id: `i${n}`, status: 'executed' }));
    h.list.data.push(insp({ id: 'draft', status: 'requested' }));
    h.files.data = [{ id: 'f0', inspection_id: 'i0', title: 'First report' }, { id: 'f1', inspection_id: 'i1', title: 'Second report' }];
    render(<InspectionsSection workOrderId="wo" />);
    expect(h.fileReads).toHaveBeenCalledTimes(1);
    expect(h.fileReads).toHaveBeenCalledWith(Array.from({ length: 30 }, (_, n) => `i${n}`));
    expect(within(screen.getByTestId('inspection-i0')).getByRole('button', { name: 'First report' })).toBeInTheDocument();
    expect(within(screen.getByTestId('inspection-i0')).queryByRole('button', { name: 'Second report' })).not.toBeInTheDocument();
    expect(within(screen.getByTestId('inspection-i1')).getByRole('button', { name: 'Second report' })).toBeInTheDocument();
  });
  it('#1126 an inspection planned for the organisation\'s yesterday is overdue, whatever the browser\'s day', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-25T18:00:00Z'));
    setActiveLocale({ locale: 'id', numberLocale: 'id-ID', timezone: 'Asia/Jakarta' });
    setActiveOrgTimezone('Asia/Jakarta');
    try {
      h.list = { data: [insp({ planned_date: '2026-11-25' })], isPending: false, isError: false, refetch: vi.fn() };
      render(<InspectionsSection workOrderId="wo" />);
      expect(screen.getByText('Overdue')).toBeInTheDocument();
    } finally { resetActiveLocale(); vi.useRealTimers(); }
  });

  it('shows the empty state and the request action to a role that may create', () => {
    render(<InspectionsSection workOrderId="wo" />);
    expect(screen.getByText('No third-party inspections on this work order yet.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Request inspection' })).toBeTruthy();
  });

  it('FR-TPI-019 an Executive reads but is offered no request action', () => {
    h.role = 'Executive';
    render(<InspectionsSection workOrderId="wo" />);
    expect(screen.queryByRole('button', { name: 'Request inspection' })).toBeNull();
  });

  it('AC-TPI-001 shows committed and billed from the server read, and no amounts when the server sent none (an Engineer)', () => {
    h.list.data = [insp({ id: 'i1', status: 'purchase_raised', procurement_id: 'p1' })];
    h.costs.data = [{ inspection_id: 'i1', currency: 'USD', committed: 2500, billed: 2400, estimate: null, estimate_currency: null }];
    const { unmount } = render(<InspectionsSection workOrderId="wo" />);
    expect(screen.getByTestId('inspection-cost').textContent).toMatch(/2,500.*committed.*2,400.*billed/);
    unmount();
    h.role = 'Engineer';
    h.costs.data = [{ inspection_id: 'i1', currency: null, committed: null, billed: null, estimate: null, estimate_currency: null }];
    render(<InspectionsSection workOrderId="wo" />);
    expect(screen.getByTestId('inspection-cost').textContent).toBe('Purchase raised, no cost yet');
  });

  it('FR-TPI-008 labels the estimate as a planning figure, apart from the cost', () => {
    h.list.data = [insp({ id: 'i3' })];
    h.costs.data = [{ inspection_id: 'i3', currency: null, committed: null, billed: null, estimate: 500, estimate_currency: 'EUR' }];
    render(<InspectionsSection workOrderId="wo" />);
    expect(screen.getByText(/a planning figure, not a cost/)).toBeTruthy();
    expect(screen.getByText('No purchase')).toBeTruthy();
  });

  it('FR-TPI-017 shows billing as waiting while a required inspection is incomplete', () => {
    h.list.data = [insp({ id: 'b', status: 'executed' }), insp({ id: 'a', title: 'A', status: 'reported', result: 'pass' })];
    render(<InspectionsSection workOrderId="wo" />);
    expect(screen.getByTestId('inspections-billing-open').textContent).toContain('1 required inspection');
  });

  it('FR-TPI-006 a manager raises the purchase of a requested inspection; an Engineer is not offered it', async () => {
    h.list.data = [insp({ id: 'i1' })];
    render(<InspectionsSection workOrderId="wo" />);
    await userEvent.click(screen.getByRole('button', { name: 'Raise purchase' }));
    // BQ9: raising creates a purchase, so it is confirmed first; nothing is raised until then.
    expect(h.mutations.raisePurchase.mutateAsync).not.toHaveBeenCalled();
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Raise purchase' }));
    expect(h.mutations.raisePurchase.mutateAsync).toHaveBeenCalledWith({ id: 'i1' });
  });
  it('BQ9 the raised purchase opens from the inspection', () => {
    h.list.data = [insp({ id: 'i1', status: 'purchase_raised', procurement_id: 'p1' })];
    render(<InspectionsSection workOrderId="wo" />);
    expect(within(screen.getByTestId('inspection-cost')).getByRole('link').getAttribute('href')).toBe('/procurement/p1');
  });
  it('FR-TPI-006 an Engineer is not offered Raise purchase or Waive', () => {
    h.role = 'Engineer';
    h.list.data = [insp({ id: 'i1' })];
    render(<InspectionsSection workOrderId="wo" />);
    expect(screen.queryByRole('button', { name: 'Raise purchase' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Waive' })).toBeNull();
  });

  it('AC-TPI-005 Mark reported stays disabled without a report file and a result', () => {
    h.list.data = [insp({ id: 'i1', status: 'executed' })];
    render(<InspectionsSection workOrderId="wo" />);
    expect((screen.getByRole('button', { name: 'Mark reported' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('OD-TPI-8 offers no Cancel on a required inspection, and Cancel on a tracked-only one', () => {
    h.list.data = [insp({ id: 'req' }), insp({ id: 'trk', title: 'Tracked', required_for: [] })];
    render(<InspectionsSection workOrderId="wo" />);
    const req = screen.getByTestId('inspection-req');
    const trk = screen.getByTestId('inspection-trk');
    expect(within(req).queryByRole('button', { name: 'Cancel inspection' })).toBeNull();
    expect(within(trk).getByRole('button', { name: 'Cancel inspection' })).toBeTruthy();
  });

  it('shows the error state with a retry', () => {
    h.list = { data: [], isPending: false, isError: true, refetch: vi.fn() };
    render(<InspectionsSection workOrderId="wo" />);
    expect(screen.getByText("Couldn't load the inspections")).toBeTruthy();
  });
});

it("JOB-BQ9 Buyer opens the linked quality purchase", () => {
 h.role = "Engineer"; h.mayOrder = true;
 h.list.data = [insp({ id: "buyer-inspection", status: "purchase_raised", procurement_id: "purchase" })];
 render(<InspectionsSection workOrderId="wo" />);
 expect(screen.getByRole("link", { name: "Purchase raised, no cost yet" })).toHaveAttribute("href", "/procurement/purchase");
});
