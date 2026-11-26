import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import i18n from '@/src/lib/i18n';
import { ToastProvider } from '@/src/components/ui';

const q = (data: unknown, over: Record<string, unknown> = {}) => ({ data, isPending: false, isError: false, refetch: vi.fn(), ...over });
const issueWaiting = vi.hoisted(() => ({ data: undefined as unknown, isPending: false, isError: false, refetch: vi.fn(), calls: [] as unknown[][] }));
vi.mock('@/src/hooks/useOperationalWaitingRoute', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    useOperationalWaitingRoute: (kind: string, recordId: string | undefined, enabled: boolean) => {
      issueWaiting.calls.push([kind, recordId, enabled]);
      return issueWaiting;
    },
  };
});
const viewerOpen = vi.hoisted(() => vi.fn());
vi.mock('@/src/components/documents/viewerContext', () => ({ useViewerOnDemand: () => ({ open: viewerOpen }) }));
const h = vi.hoisted(() => ({ wo: null as unknown, alloc: null as unknown, boq: null as unknown, basts: null as unknown, billing: null as unknown,
  docs: null as unknown, issues: null as unknown, tasks: null as unknown, issuesOn: true, claimDocs: null as unknown, lines: null as unknown, money: null as unknown, links: null as unknown, discs: null as unknown, labels: null as unknown, project: null as unknown, canBilling: true, stock: false, pva: { data: undefined, isPending: true, isError: false, refetch: () => undefined } as unknown,
  reads: { alloc: [] as unknown[], claimDocs: [] as unknown[], issues: [] as unknown[], tasks: [] as unknown[], steps: [] as unknown[], costLines: [] as unknown[], billedMonths: [] as unknown[], disciplines: [] as unknown[] } }));
vi.mock('@/src/hooks/useWorkOrderRecord', () => ({ useWorkOrder: () => h.wo, useWorkOrderAllocations: (id: string | undefined) => { h.reads.alloc.push(id); return h.alloc; }, useWorkOrderClaimDocuments: (id: string | undefined) => { h.reads.claimDocs.push(id); return h.claimDocs; }, useWorkOrderIssues: (id: string | undefined, enabled: boolean) => { h.reads.issues.push([id, enabled]); return h.issues; }, useWorkOrderOpenTasks: (id: string | undefined) => { h.reads.tasks.push(id); return h.tasks; } }));
vi.mock('@/src/auth/useFeature', () => ({ useFeature: (f: string) => f === 'stock' ? h.stock : f === 'incidents' ? h.issuesOn : false }));
vi.mock('@/src/hooks/useProjects', () => ({ useProject: () => h.project }));
vi.mock('@/src/hooks/useProgressBilling', () => ({ useBoqItems: () => h.boq }));
vi.mock('@/src/hooks/useWorkOrderAcceptances', () => ({ useWorkOrderAcceptances: () => h.basts, useWorkOrderAcceptanceMutations: () => ({ confirm: { isPending: false, mutateAsync: vi.fn().mockResolvedValue({ closingValue: null, dpHeld: 0 }) } }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u-finance' } }) }));
vi.mock('@/src/hooks/useWorkOrderBilling', () => ({ useWorkOrderBilling: () => h.billing, useWorkOrderBilledMonths: (id: string | undefined, enabled: boolean) => { h.reads.billedMonths.push([id, enabled]); return { data: undefined, isPending: false, isError: false, refetch: vi.fn() }; } }));
vi.mock('@/src/hooks/useDocuments', () => ({ useDocuments: () => h.docs }));
vi.mock('@/src/hooks/useWorkOrderCosts', () => ({
  useWorkOrderCostLines: (id: string | null) => { h.reads.costLines.push(id); return h.lines; }, useWorkOrderCostMoney: () => h.money, useWorkOrderCostLinks: () => h.links, useCostDisciplines: (enabled: boolean = true) => { h.reads.disciplines.push(enabled); return h.discs; }, useWorkOrderTimesheetLabels: () => h.labels,
}));
vi.mock('@/src/hooks/useWorkOrderPlanVsActual', () => ({ useProjectPlanVsActual: () => h.pva }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => h.canBilling }));
// #2578: the quantity-changes section has its own test (QuantityChangesSection.test.tsx); this file pins the existing sections.
vi.mock('./work-order-detail/QuantityChangesSection', () => ({ QuantityChangesSection: () => null }));
vi.mock('./work-order-detail/WorkOrderChecksSection', () => ({ WorkOrderChecksSection: (p: { workOrderId: string }) => <div data-testid="wo-checks-stub">{p.workOrderId}</div> }));
vi.mock('./work-order-detail/WorkOrderDecision', () => ({ useWorkOrderDecision: () => ({ primaryAction: undefined, menuItems: [], dialogs: null }) }));
vi.mock('./work-order-detail/MissingSection', () => ({ MissingSection: () => null }));
vi.mock('./work-order-detail/SiteReportsSection', () => ({ SiteReportsSection: () => null }));
vi.mock('@/src/hooks/useBillingSteps', () => ({ useWorkOrderSteps: (workOrderId: string | undefined) => { h.reads.steps.push(workOrderId); return { data: [], isLoading: false, isError: false, refetch: vi.fn() }; } }));
vi.mock('@/src/hooks/useOrgRoleNames', () => ({ useBuiltInRoleName: () => (k: string) => k }));
// The sections block (#2576) has its own tests (SectionsSection.test.tsx); this page test only places it.
vi.mock('./work-order-detail/SectionsSection', () => ({ SectionsSection: (p: { workOrder: { id: string } }) => <div data-testid="sections-stub">{p.workOrder.id}</div> }));
vi.mock('./work-order-detail/ConsumablePlanSection', () => ({
  ConsumablePlanSection: (p: { workOrderId: string; workOrderStatus: string; project: { project_manager_id: string | null } | null }) =>
    <section data-testid="consumable-plan-stub">{`${p.workOrderId}|${p.workOrderStatus}|${p.project?.project_manager_id ?? 'none'}`}</section>,
}));
// the inspections panel is proven by its own test (InspectionsSection.test.tsx); here only that the page carries it for THIS work order
// #2885: the stock panel has its own test (WorkOrderStockBalance.test.tsx); here only that the page carries it for THIS work order
vi.mock('./stock/WorkOrderStockBalance', () => ({ WorkOrderStockBalance: (p: { workOrderId: string; currency: string }) => <div data-testid="wo-stock-stub">{`${p.workOrderId}|${p.currency}`}</div> }));
vi.mock('./work-order-detail/InspectionsSection', () => ({ InspectionsSection: ({ workOrderId }: { workOrderId: string }) => <div data-testid="inspections-section">{workOrderId}</div> }));

vi.mock('./work-order-detail/ClientMaterialSection', () => ({
  ClientMaterialSection: (p: { workOrderId: string; allocationOptions: Array<{ value: string; label: string }> }) =>
    <div data-testid="client-material-stub" data-wo={p.workOrderId}>{p.allocationOptions.map((o) => o.label).join('|')}</div>,
}));
vi.mock('./work-order-detail/WorkOrderDocumentActions', () => ({
  WorkOrderDocumentActions: (p: {
    folderDoc: { id: string } | null;
    children: (s: { headerActions: null; folderTree: React.ReactNode; renderRowAction: () => null; hiddenInput: null }) => React.ReactNode;
  }) => p.children({
    headerActions: null,
    folderTree: p.folderDoc ? <div data-testid="wo-folder-stub">{p.folderDoc.id}</div> : null,
    renderRowAction: () => null,
    hiddenInput: null,
  }),
}));

import WorkOrderDetail from './WorkOrderDetail';

const CurrentLocation: React.FC = () => {
  const { pathname, search, hash } = useLocation();
  return <output data-testid="current-location">{pathname}{search}{hash}</output>;
};

const WO = { id: 'w1', project_id: 'p1', wo_number: 'WO-0007', title: 'Pump install', status: 'Issued', currency: 'IDR', order_value: 1500000, client_po_number: 'PO-9' };
const ln = (source: string, id: string, disciplineId: string | null) => ({ source, recordId: id, projectId: 'p1', workOrderId: 'w1', disciplineId, occurredOn: '2026-02-01', reference: id, quantity: null, quantityUnit: null });
/** Opens the page, or one of its areas by its address (`#wo-cost`), as a shared link or Back does. */
const renderPage = (area?: string) => render(<ToastProvider><MemoryRouter initialEntries={[`/work-orders/w1${area ? `#wo-${area}` : ''}`]}><Routes><Route path="/work-orders/:id" element={<><WorkOrderDetail /><CurrentLocation /></>} /></Routes></MemoryRouter></ToastProvider>);
/** A person opens an area by its tab. */
const openArea = (name: RegExp) => userEvent.click(screen.getByRole('tab', { name }));

beforeEach(async () => {
  await i18n.changeLanguage('en');
  issueWaiting.data = undefined; issueWaiting.isPending = false; issueWaiting.isError = false; issueWaiting.refetch.mockReset(); issueWaiting.calls.length = 0;
  h.canBilling = true;
  h.stock = false;
  h.pva = { data: undefined, isPending: true, isError: false, refetch: () => undefined };
  h.wo = q(WO); h.project = q({ name: 'Plant A', client: { name: 'Acme' } });
  h.alloc = q([{ id: 'l1', boq_item_id: 'b1', quantity: 10 }]);
  h.boq = q([{ id: 'b1', rate: 100, item_code: 'A1', unit: 'm', earning_basis: 'measured', description: 'Pipe' }]);
  h.basts = q([{ id: 'a1', work_order_id: 'w1', status: 'Confirmed', is_final: false, acceptance_date: '2026-03-01', document_id: 'd1', lines: [{ boq_item_id: 'b1', quantity: 5 }] },
    { id: 'a2', work_order_id: 'other', status: 'Confirmed', is_final: false, acceptance_date: '2026-03-02', document_id: null, lines: [{ boq_item_id: 'b1', quantity: 9 }] }]);
  h.billing = q([{ workOrderId: 'w1', currency: 'IDR', invoiced: 10, pending: 20, paid: 30, remaining: 40, figuresComplete: true }]);
  h.claimDocs = q([]);
  h.issues = q([]); h.tasks = q([]); h.issuesOn = true;
  h.docs = q([{ id: 'd1', title: 'BAST scan' }, { id: 'd2', title: 'Unrelated' }]);
  h.lines = q({ purchase_order: [ln('purchase_order', 'po1', 'd1'), ln('purchase_order', 'po2', null)], vendor_bill: [], timesheet_entry: [] });
  h.money = q({ purchase_order: { po1: { amount: 100, currency: 'IDR' }, po2: { amount: 50, currency: 'IDR' } } });
  h.links = q({});
  h.labels = q({});
  h.discs = q([{ id: 'd1', code: 'MECH', name: 'Mechanical' }]);
  for (const key of Object.keys(h.reads) as Array<keyof typeof h.reads>) h.reads[key].length = 0;
});

describe('WorkOrderDetail', () => {
  it('#2895 the reads that need only the route id start together with the record read, not after it', () => {
    h.wo = { data: undefined, isPending: true, isError: false, refetch: vi.fn() };
    renderPage();
    // the record is still loading — the page shows its loading shell and no header yet
    expect(screen.queryByTestId('wo-order-value')).toBeNull();
    // every read keyed by the work-order id is already in flight with that id
    expect(h.reads.steps).toEqual(['w1']);
    expect(h.reads.alloc).toEqual(['w1']);
    expect(h.reads.claimDocs).toEqual(['w1']);
    expect(h.reads.tasks).toEqual(['w1']);
    expect(h.reads.issues).toEqual([['w1', true]]);
    expect(h.reads.costLines).toEqual(['w1']);
    expect(h.reads.billedMonths).toEqual([['w1', true]]);
    // the org-wide discipline list does not wait for the record either
    expect(h.reads.disciplines).toEqual([true]);
  });

  it('#1126 one area shows at a time; a tab opens another and the address keeps it for Back and sharing', async () => {
    renderPage();
    expect(screen.getByRole('tab', { name: /Site and scope/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('scope-pct-b1')).toBeTruthy();
    expect(screen.queryByTestId('billing-invoiced')).toBeNull();
    await openArea(/^Billing/);
    expect(screen.getByTestId('billing-invoiced')).toBeTruthy();
    expect(screen.queryByTestId('scope-pct-b1')).toBeNull();
    expect(screen.getByTestId('current-location').textContent).toBe('/work-orders/w1#wo-billing');
  });
  it('#1126 an earlier link to inspections or close-out lands on the area that now holds both', () => {
    renderPage('closeout');
    expect(screen.getByRole('tab', { name: /Inspections and close-out/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('inspections-section')).toBeTruthy();
  });
  it('#1126 the issues and tasks tab says how many are open before it is opened', () => {
    h.tasks = q([{ id: 't1', name: 'Torque the bolts', assignee: null, end_date: null }]);
    h.issues = q([{ id: 'i1', type: 'Leak', status: 'Open', severity: 'Low', due_at: null }]);
    renderPage();
    expect(screen.getByRole('tab', { name: /Issues and tasks 2/ })).toBeTruthy();
  });
  it('AC-WOS-001 places the sections block for this work order', () => {
    renderPage();
    expect(screen.getByTestId('sections-stub').textContent).toBe('w1');
  });
  it('FR-CUS-014 the consumable plan section is mounted for a stock-enabled organisation, with the work order\'s PROJECT as the permission record', () => {
    h.stock = true;
    h.project = q({ name: 'Plant A', client: { name: 'Acme' }, project_manager_id: 'pm-1' });
    renderPage('material');
    expect(screen.getByTestId('consumable-plan-stub').textContent).toBe('w1|Issued|pm-1');
  });
  it('#2885 the work order page shows the stock held for this work order when the stock module is on, so stock roles need no Contract area', () => {
    h.stock = true;
    renderPage('material');
    expect(screen.getByTestId('wo-stock-stub').textContent).toMatch(/^w1\|/);
  });
  it('#2885 and no stock panel when the stock module is off', () => {
    renderPage('material');
    expect(screen.queryByTestId('wo-stock-stub')).toBeNull();
  });
  it('FR-CUS-014 and is absent when the stock module is off', () => {
    renderPage('material');
    expect(screen.queryByTestId('consumable-plan-stub')).toBeNull();
  });
  it('FR-TPI-017 carries the third-party inspections section for this work order', () => {
    renderPage('checks');
    expect(screen.getByTestId('inspections-section').textContent).toBe('w1');
  });
  it('PU16 a posted stock issue says it is not part of project cost, and a transfer that it is still on hand, never "Not yet costed"', async () => {
    const { rollupProject } = await import('@/src/lib/workOrderPlanVsActual');
    h.lines = q({ stock_document: [ln('stock_document', 'iss1', null), ln('stock_document', 'trf1', null), ln('stock_document', 'drf1', null)] });
    const stockLine = (recordId: string, reason: string) => ({ source: 'stock_document', recordId, projectId: 'p1', workOrderId: 'w1', disciplineId: null, occurredOn: null, reference: null, currency: null, amount: null, reason, quantity: null, quantityUnit: null, personId: null });
    h.pva = { isPending: false, isError: false, refetch: () => undefined,
      data: { workOrders: [], plans: [], split: null, rollup: rollupProject({ workOrders: [], lines: [], plans: [], split: null, restricted: false } as never), costLines: [stockLine('iss1', 'outside-basis'), stockLine('trf1', 'transfer'), stockLine('drf1', 'not-posted')] } };
    renderPage('cost');
    expect(screen.getByTestId('cost-line-iss1')).toHaveTextContent('Not part of project actuals');
    expect(screen.getByTestId('cost-line-trf1')).toHaveTextContent('Moved to site, still on hand');
    expect(screen.getByTestId('cost-line-drf1')).toHaveTextContent('Not posted or approved yet');
    expect(screen.queryByText('Not yet costed')).toBeNull();
  });
  it('AC-WPVA-016 shows the plan-vs-actual panel for this work order, and hides it from a role that may not view plans', async () => {
    const { rollupProject } = await import('@/src/lib/workOrderPlanVsActual');
    const workOrders = [{ id: 'w1', woNumber: 'WO-0007', title: 'Pump install', status: 'Issued', currency: 'IDR', revenue: '1000.00', revenueComplete: true }];
    const line = { source: 'vendor_bill', recordId: 'r1', projectId: 'p1', workOrderId: 'w1', disciplineId: null, occurredOn: null, reference: null, currency: 'IDR', amount: '300.00', reason: 'counted', quantity: null, quantityUnit: null, personId: null };
    h.pva = { isPending: false, isError: false, refetch: () => undefined,
      data: { workOrders, plans: [], split: null, rollup: rollupProject({ workOrders, lines: [line], plans: [], split: null, restricted: false } as never) } };
    const { unmount } = renderPage('cost');
    expect(screen.getByTestId('wo-page-pva-direct').textContent).toMatch(/300/);
    unmount();
    h.canBilling = false;
    renderPage('cost');
    expect(screen.queryByTestId('wo-page-pva')).toBeNull();
  });
  it('AC-WORP-001 shows number, title, status, project and order value', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('WO-0007');
    expect(screen.getByText('Pump install')).toBeTruthy();
    expect(screen.getByText('Plant A').closest('a')?.getAttribute('href')).toBe('/projects/p1');
    expect(screen.getByTestId('wo-order-value').textContent).toMatch(/1\.500\.000|1,500,000/);
  });
  it('FR-CSR-018 mounts the Client material section for this work order, with its allocation rows as options, only for a role that may view it', () => {
    const { unmount } = renderPage('material');
    expect(screen.getByTestId('client-material-stub').getAttribute('data-wo')).toBe('w1');
    expect(screen.getByTestId('client-material-stub').textContent).toBe('A1 · Pipe');
    unmount();
    h.canBilling = false;
    renderPage('material');
    expect(screen.queryByTestId('client-material-stub')).toBeNull();
  });
  it('AC-WOC-003 a Draft shows its checks before issue; an issued work order does not', () => {
    const { unmount } = renderPage();
    expect(screen.queryByTestId('wo-checks-stub')).toBeNull();
    unmount();
    h.wo = q({ ...WO, wo_number: null, status: 'Draft' });
    renderPage();
    expect(screen.getByTestId('wo-checks-stub').textContent).toBe('w1');
  });
  it('AC-WOC-002 a cancelled work order stays readable with the reason it was cancelled', () => {
    h.wo = q({ ...WO, status: 'Cancelled', cancel_reason: 'Client withdrew the order' });
    renderPage();
    expect(screen.getByTestId('wo-cancel-reason').textContent).toBe('Cancelled because: Client withdrew the order');
    expect(screen.getByText('Pump install')).toBeTruthy();
  });
  it('AC-WORP-001 a Draft shows "not yet numbered"', () => {
    h.wo = q({ ...WO, wo_number: null, status: 'Draft' });
    renderPage();
    expect(screen.getByText('Not yet numbered')).toBeTruthy();
  });
  it('AC-WORP-002 an unreadable id shows not-found, same as a random id', () => {
    h.wo = q(null);
    renderPage();
    expect(screen.getByText('Work order not found')).toBeTruthy();
  });
  it('AC-WORP-005 scope shows accepted quantity and percent from confirmed acceptances of THIS work order', () => {
    renderPage();
    expect(screen.getByTestId('scope-pct-b1').textContent).toBe('50%');
  });
  it('#1126 the header says how far the work order has got, value-weighted over its contract lines', () => {
    renderPage();
    expect(within(screen.getByTestId('record-header')).getByTestId('wo-complete').textContent).toBe('50%');
  });
  it('AC-WORP-006 costs group by source and discipline with No discipline for the unlabelled record', () => {
    renderPage('cost');
    const po = screen.getByTestId('cost-group-purchase_order');
    expect(within(po).getByText('Mechanical')).toBeTruthy();
    expect(within(po).getByText('No discipline')).toBeTruthy();
    expect(within(po).getByTestId('cost-total-purchase_order')).toBeTruthy();
    expect(screen.queryByTestId('cost-group-vendor_bill')).toBeNull();
  });
  it('links a purchase cost to its resolved source record', () => {
    h.links = q({ 'purchase_order:po1': '/procurement/purchase-1/timeline#cost-po1' });
    renderPage('cost');
    expect(screen.getByRole('link', { name: 'po1' }).getAttribute('href')).toBe('/procurement/purchase-1/timeline#cost-po1');
  });
  it('does not link stock costs until the work-order cost build is ready', () => {
    h.lines = q({ stock_document: [ln('stock_document', 'stock1', null)] });
    renderPage('cost');
    expect(screen.queryByRole('link', { name: 'stock1' })).toBeNull();
    expect(screen.getByText('Line amount not shown')).toBeTruthy();
  });
  it('M6 a costed stock issue and timesheet line show their amount, never "Not yet costed"', () => {
    h.lines = q({ stock_document: [ln('stock_document', 'stock1', null)], timesheet_entry: [ln('timesheet_entry', 'hour1', null)] });
    h.money = q({ stock_document: { stock1: { amount: 1200, currency: 'USD' } }, timesheet_entry: { hour1: { amount: 495, currency: 'USD' } } });
    renderPage('cost');
    expect(within(screen.getByTestId('cost-line-stock1')).getByText('$1,200')).toBeTruthy();
    expect(within(screen.getByTestId('cost-line-hour1')).getByText('$495')).toBeTruthy();
    expect(screen.queryByText('Not yet costed')).toBeNull();
    expect(screen.queryByText('Line amount not shown')).toBeNull();

  });
  it('identifies a timesheet by person and week, and uses the standard whole-unit money display', () => {
    h.lines = q({ timesheet_entry: [{ ...ln('timesheet_entry', 'hour1', null), reference: null }], purchase_order: [ln('purchase_order', 'po1', 'd1')] });
    h.labels = q({ hour1: { person: 'Morgan Lee', weekStart: '2026-10-26' } });
    h.money = q({ purchase_order: { po1: { amount: 45000, currency: 'USD' } } });
    renderPage('cost');
    expect(screen.getByTestId('cost-line-hour1').textContent).toMatch(/Morgan Lee.*26 Oct/);
    expect(within(screen.getByTestId('cost-line-hour1')).queryByRole('link')).toBeNull();
    expect(screen.getByTestId('cost-total-purchase_order').textContent).toBe('$45,000');
  });
  it('uses a readable fallback when the timesheet identity is unavailable', () => {
    h.lines = q({ timesheet_entry: [{ ...ln('timesheet_entry', 'hour1', null), reference: null }] });
    renderPage('cost');
    expect(screen.getByTestId('cost-line-hour1').textContent).toContain('Timesheet');
    expect(screen.getByTestId('cost-line-hour1').textContent).not.toContain('hour1');
  });
  it('names an approved no-login attendance day as attendance, never by its id, and does not call its amount unavailable', () => {
    h.lines = q({ attendance_day: [{ ...ln('attendance_day', 'att1', null), reference: null, quantity: 8, quantityUnit: 'hours' }] });
    h.money = q({});
    renderPage('cost');
    const line = screen.getByTestId('cost-line-att1');
    expect(line.textContent).toContain('Attendance');
    expect(line.textContent).not.toContain('att1');
    expect(within(screen.getByTestId('cost-group-attendance_day')).queryByText('Amount unavailable')).toBeNull();
  });
  it('explains when costs have no available amount', () => {
    h.lines = q({ timesheet_entry: [ln('timesheet_entry', 'hour1', null)] });
    h.money = q({});
    renderPage('cost');
    expect(screen.getByText('Line amount not shown')).toBeTruthy();
  });
  it('#1126 a cost record whose name is its code reads once, and its hours read in the reader\'s language', async () => {
    h.lines = q({ equipment_usage: [{ ...ln('equipment_usage', 'eq1', null), reference: 'CR-1 · CR-1', quantity: 7.5, quantityUnit: 'hours' }] });
    h.money = q({ equipment_usage: { eq1: { amount: 100, currency: 'IDR' } } });
    renderPage('cost');
    const line = screen.getByTestId('cost-line-eq1');
    expect(line.textContent).toContain('CR-1');
    expect(line.textContent).not.toContain('CR-1 · CR-1');
    expect(within(line).getByText('7.5 hours')).toBeTruthy();
  });
  it('AC-WORP-007 a caller who cannot read purchase money sees records with no total and a restricted note', () => {
    h.money = q({ purchase_order: null });
    renderPage('cost');
    expect(screen.getByTestId('cost-restricted-purchase_order')).toBeTruthy();
    expect(screen.queryByTestId('cost-total-purchase_order')).toBeNull();
    expect(screen.getByTestId('cost-line-po1')).toBeTruthy();
  });
  it('AC-WORP-008 billing figures are the shipped work_order_billing row, and the acceptance list is this work order only', () => {
    renderPage('billing');
    expect(screen.getByTestId('billing-invoiced').textContent).toMatch(/10/);
    expect(screen.getByTestId('billing-remaining').textContent).toMatch(/40/);
    expect(screen.getByTestId('acceptance-a1')).toBeTruthy();
    expect(screen.queryByTestId('acceptance-a2')).toBeNull();
  });
  it('does not claim that pending issue and task integrations are empty', () => {
    renderPage('issues');
    expect(screen.queryByTestId('wo-issues-empty')).toBeNull();
    expect(screen.queryByTestId('wo-tasks-empty')).toBeNull();
  });
  it('opens a linked file in the document viewer', async () => {
    h.docs = q([{ id: 'd1', title: 'BAST scan', file_path: 'file.pdf', status: 'Draft' }]);
    renderPage('documents');
    await userEvent.click(screen.getByRole('button', { name: 'BAST scan' }));
    expect(viewerOpen).toHaveBeenCalledWith(expect.objectContaining({ name: 'BAST scan' }));
  });
  it('includes documents attached to the work order through time and materials sign-off', () => {
    h.claimDocs = q(['d2']);
    renderPage('documents');
    expect(within(screen.getByTestId('wo-documents')).getByText('Unrelated')).toBeTruthy();
  });
  it('lists only the documents this work order points to', () => {
    renderPage('documents');
    const docs = screen.getByTestId('wo-documents');
    expect(within(docs).getByText('BAST scan')).toBeTruthy();
    expect(within(docs).queryByText('Unrelated')).toBeNull();
  });
  it('does not report zero progress or no documents when acceptances fail, and retries the failed read', async () => {
    const refetch = vi.fn();
    h.basts = q(undefined, { isError: true, refetch });
    renderPage();
    expect(screen.queryByTestId('scope-pct-b1')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /retry|try again/i }));
    expect(refetch).toHaveBeenCalled();
    await openArea(/Documents and safety/);
    expect(screen.queryByText('No visible documents are linked to this work order yet.')).toBeNull();
    for (const button of screen.getAllByRole('button', { name: /retry|try again/i })) await userEvent.click(button);
  });
  it('reports and retries a failed cost money read instead of silently omitting totals', async () => {
    const refetch = vi.fn();
    h.money = q(undefined, { isError: true, refetch });
    renderPage('cost');
    expect(screen.getByText("Couldn't load the costs")).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /retry|try again/i }));
    expect(refetch).toHaveBeenCalled();
  });
  it('AC-WORP-009 one failing section shows its own error with retry; the rest render', async () => {
    const refetch = vi.fn();
    h.lines = q(undefined, { isError: true, refetch });
    renderPage('cost');
    await userEvent.click(screen.getByRole('button', { name: /retry|try again/i }));
    expect(refetch).toHaveBeenCalled();
    await openArea(/Site and scope/);
    expect(screen.getByTestId('scope-pct-b1')).toBeTruthy();
    await openArea(/^Billing/);
    expect(screen.getByTestId('billing-invoiced')).toBeTruthy();
  });
  it('hides billing figures for a caller who may not see billing, still listing acceptances', () => {
    h.canBilling = false;
    renderPage('billing');
    expect(screen.queryByTestId('billing-invoiced')).toBeNull();
    expect(screen.getByTestId('acceptance-a1')).toBeTruthy();
  });
  it('links an empty scope to the project work orders area', () => {
    h.alloc = q([]);
    renderPage();
    expect(screen.getByRole('link', { name: 'Allocate lines on the project' }).getAttribute('href')).toBe('/projects/p1/work-orders');
  });
  it('FR-WORP-027 empty sections say so, never blank', async () => {
    h.alloc = q([]); h.lines = q({}); h.basts = q([]);
    renderPage();
    expect(screen.getByText(/No contract lines are allocated/)).toBeTruthy();
    await openArea(/Cost and plan/);
    expect(screen.getByText(/No costs are attributed/)).toBeTruthy();
    await openArea(/^Billing/);
    expect(screen.getByText('No acceptances yet.')).toBeTruthy();
    await openArea(/Documents and safety/);
    expect(screen.getByText(/No visible documents are linked/)).toBeTruthy();
  });
  it('AC-WORP-011 the Bahasa Indonesia catalogue has every English key, translated', () => {
    const read = (l: string) => JSON.parse(readFileSync(join(process.cwd(), `public/locales/${l}/workOrders.json`), 'utf8'));
    const flat = (o: Record<string, unknown>, pre = ''): Record<string, string> =>
      Object.entries(o).reduce((acc, [k, v]) => (typeof v === 'object' && v ? { ...acc, ...flat(v as Record<string, unknown>, `${pre}${k}.`) } : { ...acc, [`${pre}${k}`]: String(v) }), {});
    const en = flat(read('en')); const id = flat(read('id'));
    expect(Object.keys(id).sort()).toEqual(Object.keys(en).sort());
    expect(Object.entries(id).filter(([, v]) => v.trim() === '')).toEqual([]);
    // Every page string is translated: no key whose Bahasa text is still the English sentence (placeholders-only strings excepted).
    expect(Object.keys(en).filter((k) => /[a-z]{4,}/i.test(en[k].replace(/\{\{.*?\}\}/g, '')) && en[k] === id[k])).toEqual([]);
  });
  // #2615 FR-WORP-025: issues and open tasks that name the work order.
  it('lists the issues naming the work order with status and due time, each linking to the issue', () => {
    h.issues = q([{ id: 'i1', type: 'Leaking flange', status: 'Open', due_at: '2999-01-01T00:00:00Z' }]);
    renderPage('issues');
    const list = within(screen.getByTestId('wo-issues'));
    expect(list.getByRole('link', { name: 'Leaking flange' })).toHaveAttribute('href', '/incidents/i1');
    expect(list.getByText(/Fix by/)).toBeInTheDocument();
  });

  it('lists the open tasks with assignee and due date', () => {
    h.tasks = q([{ id: 't1', name: 'Torque the bolts', assignee: { full_name: 'Sari Dewi' }, end_date: '2999-01-01' }, { id: 't2', name: 'Paint', assignee: null, end_date: null }]);
    renderPage('issues');
    const list = within(screen.getByTestId('wo-open-tasks'));
    expect(list.getByText('Torque the bolts')).toBeInTheDocument();
    expect(list.getByText('Sari Dewi')).toBeInTheDocument();
    expect(list.getByText('Unassigned')).toBeInTheDocument();
    expect(list.getByText('No due date')).toBeInTheDocument();
  });

  it('FR-WORP-025 lets the user open a task from the work order', async () => {
    h.tasks = q([{ id: 't1', project_id: 'p1', name: 'Torque the bolts', assignee: null, end_date: null }]);
    render(<ToastProvider><MemoryRouter initialEntries={['/work-orders/w1']}><Routes>
      <Route path="/work-orders/:id" element={<WorkOrderDetail />} />
      <Route path="/projects/:projectId/tasks" element={<><p>Project tasks route</p><CurrentLocation /></>} />
    </Routes></MemoryRouter></ToastProvider>);

    await openArea(/Issues and tasks/);
    await userEvent.setup().click(screen.getByRole('link', { name: 'Torque the bolts' }));

    expect(await screen.findByText('Project tasks route')).toBeInTheDocument();
    expect(screen.getByTestId('current-location')).toHaveTextContent('/projects/p1/tasks?open=t1');
  });

  it('shows an empty state for each section', () => {
    renderPage('issues');
    expect(screen.getByText('No issues name this work order.')).toBeInTheDocument();
    expect(screen.getByText('No open tasks name this work order.')).toBeInTheDocument();
  });

  it('a failing issues read shows its own error with retry; the tasks section still renders', async () => {
    const refetch = vi.fn();
    h.issues = q(undefined, { isError: true, refetch });
    h.tasks = q([{ id: 't1', name: 'Torque the bolts', assignee: null, end_date: null }]);
    renderPage('issues');
    await userEvent.setup().click(within(screen.getByText("Couldn't load the issues").closest('section') as HTMLElement).getByRole('button', { name: /retry/i }));
    expect(refetch).toHaveBeenCalled();
    expect(screen.getByText('Torque the bolts')).toBeInTheDocument();
  });

  it('a failing open-tasks read shows its own error with retry', async () => {
    const refetch = vi.fn();
    h.tasks = q(undefined, { isError: true, refetch });
    renderPage('issues');
    await userEvent.setup().click(within(screen.getByText("Couldn't load the open tasks").closest('section') as HTMLElement).getByRole('button', { name: /retry/i }));
    expect(refetch).toHaveBeenCalled();
  });

  it('both sections show loading, and the issues section is absent while the incidents module is off', () => {
    h.issues = q(undefined, { isPending: true }); h.tasks = q(undefined, { isPending: true });
    const { unmount } = renderPage('issues');
    expect(screen.queryByTestId('wo-issues')).toBeNull();
    unmount();
    h.issuesOn = false;
    renderPage('issues');
    expect(screen.queryByText('Issues')).toBeNull();
  });

  // #1122 Waiting 3: a Draft work order names the people it is assigned to for the issue step, not a static role list.
  describe('who a Draft is assigned to (AC-WAIT-070/073)', () => {
    it('reads the issue route only while the work order is a priced Draft with a recorded author', () => {
      renderPage();
      expect(issueWaiting.calls.at(-1)).toEqual(['work_order_issue', 'w1', false]);
      h.wo = q({ ...WO, status: 'Draft', order_value_set_by: 'u-price' });
      renderPage();
      expect(issueWaiting.calls.at(-1)).toEqual(['work_order_issue', 'w1', true]);
      h.wo = q({ ...WO, status: 'Draft', order_value: 0, order_value_set_by: 'u-price' });
      renderPage();
      expect(issueWaiting.calls.at(-1)).toEqual(['work_order_issue', 'w1', false]);
      h.wo = q({ ...WO, status: 'Draft', order_value_set_by: null });
      renderPage();
      expect(issueWaiting.calls.at(-1)).toEqual(['work_order_issue', 'w1', false]);
    });

    it('names the actual people and their actual roles', () => {
      h.wo = q({ ...WO, status: 'Draft', order_value_set_by: 'u-price' });
      issueWaiting.data = {
        approvers: [{ id: 'u-fin', name: 'Ani Finance', role: 'Finance' }, { id: 'u-pm', name: 'Budi PM', role: 'Project Manager' }],
        routeKind: 'work_order_issue',
      };
      renderPage();
      expect(screen.getByTestId('wo-issue-waiting').textContent).toBe('Waiting for Ani Finance or Budi PM, Finance or Project Manager');
    });

    it('says nothing rather than inventing a name when the database names nobody', () => {
      h.wo = q({ ...WO, status: 'Draft', order_value_set_by: 'u-price' });
      issueWaiting.data = { approvers: [], routeKind: 'work_order_issue' };
      renderPage();
      expect(screen.queryByTestId('wo-issue-waiting')).toBeNull();
    });

    it('offers a retry when the route could not be read, and adds nothing while it is pending', async () => {
      h.wo = q({ ...WO, status: 'Draft', order_value_set_by: 'u-price' });
      issueWaiting.isPending = true;
      const view = renderPage();
      expect(screen.queryByTestId('wo-issue-waiting')).toBeNull();
      view.unmount();
      issueWaiting.isPending = false; issueWaiting.isError = true;
      renderPage();
      await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
      expect(issueWaiting.refetch).toHaveBeenCalled();
    });
  });

  it('TC-PA-13 shows direct work-order documents and isolates the work-order folder root from the list', () => {
    h.docs = q([
      { id: 'd-folder', title: 'WO-0007 Pump install', work_order_id: 'w1', source: 'onedrive', ms_item_kind: 'folder', ms_drive_id: 'drv', ms_item_id: 'it', ms_web_url: 'https://contoso.sharepoint.com/wo' },
      { id: 'd-direct', title: 'Site inspection', work_order_id: 'w1', source: null, file_path: null, status: 'Draft' },
      { id: 'd-other', title: 'Other work order doc', work_order_id: 'w-other', source: null, file_path: null, status: 'Draft' },
    ]);
    renderPage('documents');
    expect(screen.getByTestId('wo-folder-stub').textContent).toBe('d-folder');
    const docs = screen.getByTestId('wo-documents');
    expect(within(docs).getByText('Site inspection')).toBeTruthy();
    expect(within(docs).queryByText('WO-0007 Pump install')).toBeNull();
    expect(within(docs).queryByText('Other work order doc')).toBeNull();
  });
});
