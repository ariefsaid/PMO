import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import i18n from '@/src/lib/i18n';

const q = (data: unknown, over: Record<string, unknown> = {}) => ({ data, isPending: false, isError: false, refetch: vi.fn(), ...over });
const viewerOpen = vi.hoisted(() => vi.fn());
vi.mock('@/src/components/documents/viewerContext', () => ({ useViewerOnDemand: () => ({ open: viewerOpen }) }));
const h = vi.hoisted(() => ({ wo: null as unknown, alloc: null as unknown, boq: null as unknown, basts: null as unknown, billing: null as unknown,
  docs: null as unknown, claimDocs: null as unknown, lines: null as unknown, money: null as unknown, links: null as unknown, discs: null as unknown, labels: null as unknown, project: null as unknown, canBilling: true, pva: { data: undefined, isPending: true, isError: false, refetch: () => undefined } as unknown }));
vi.mock('@/src/hooks/useWorkOrderRecord', () => ({ useWorkOrder: () => h.wo, useWorkOrderAllocations: () => h.alloc, useWorkOrderClaimDocuments: () => h.claimDocs }));
vi.mock('@/src/hooks/useProjects', () => ({ useProject: () => h.project }));
vi.mock('@/src/hooks/useProgressBilling', () => ({ useBoqItems: () => h.boq }));
vi.mock('@/src/hooks/useWorkOrderAcceptances', () => ({ useWorkOrderAcceptances: () => h.basts }));
vi.mock('@/src/hooks/useWorkOrderBilling', () => ({ useWorkOrderBilling: () => h.billing }));
vi.mock('@/src/hooks/useDocuments', () => ({ useDocuments: () => h.docs }));
vi.mock('@/src/hooks/useWorkOrderCosts', () => ({
  useWorkOrderCostLines: () => h.lines, useWorkOrderCostMoney: () => h.money, useWorkOrderCostLinks: () => h.links, useCostDisciplines: () => h.discs, useWorkOrderTimesheetLabels: () => h.labels,
}));
vi.mock('@/src/hooks/useWorkOrderPlanVsActual', () => ({ useProjectPlanVsActual: () => h.pva }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => h.canBilling }));
// The sections block (#2576) has its own tests (SectionsSection.test.tsx); this page test only places it.
vi.mock('./work-order-detail/SectionsSection', () => ({ SectionsSection: (p: { workOrder: { id: string } }) => <div data-testid="sections-stub">{p.workOrder.id}</div> }));

import WorkOrderDetail from './WorkOrderDetail';

const WO = { id: 'w1', project_id: 'p1', wo_number: 'WO-0007', title: 'Pump install', status: 'Issued', currency: 'IDR', order_value: 1500000, client_po_number: 'PO-9' };
const ln = (source: string, id: string, disciplineId: string | null) => ({ source, recordId: id, projectId: 'p1', workOrderId: 'w1', disciplineId, occurredOn: '2026-02-01', reference: id, quantity: null, quantityUnit: null });
const renderPage = () => render(<MemoryRouter initialEntries={['/work-orders/w1']}><Routes><Route path="/work-orders/:id" element={<WorkOrderDetail />} /></Routes></MemoryRouter>);

beforeEach(async () => {
  await i18n.changeLanguage('en');
  h.canBilling = true;
  h.pva = { data: undefined, isPending: true, isError: false, refetch: () => undefined };
  h.wo = q(WO); h.project = q({ name: 'Plant A', client: { name: 'Acme' } });
  h.alloc = q([{ id: 'l1', boq_item_id: 'b1', quantity: 10 }]);
  h.boq = q([{ id: 'b1', rate: 100, item_code: 'A1', unit: 'm', earning_basis: 'measured', description: 'Pipe' }]);
  h.basts = q([{ id: 'a1', work_order_id: 'w1', status: 'Confirmed', is_final: false, acceptance_date: '2026-03-01', document_id: 'd1', lines: [{ boq_item_id: 'b1', quantity: 5 }] },
    { id: 'a2', work_order_id: 'other', status: 'Confirmed', is_final: false, acceptance_date: '2026-03-02', document_id: null, lines: [{ boq_item_id: 'b1', quantity: 9 }] }]);
  h.billing = q([{ workOrderId: 'w1', currency: 'IDR', invoiced: 10, pending: 20, paid: 30, remaining: 40, figuresComplete: true }]);
  h.claimDocs = q([]);
  h.docs = q([{ id: 'd1', title: 'BAST scan' }, { id: 'd2', title: 'Unrelated' }]);
  h.lines = q({ purchase_order: [ln('purchase_order', 'po1', 'd1'), ln('purchase_order', 'po2', null)], vendor_bill: [], timesheet_entry: [] });
  h.money = q({ purchase_order: { po1: { amount: 100, currency: 'IDR' }, po2: { amount: 50, currency: 'IDR' } } });
  h.links = q({});
  h.labels = q({});
  h.discs = q([{ id: 'd1', code: 'MECH', name: 'Mechanical' }]);
});

describe('WorkOrderDetail', () => {
  it('AC-WOS-001 places the sections block for this work order', () => {
    renderPage();
    expect(screen.getByTestId('sections-stub').textContent).toBe('w1');
  });
  it('AC-WPVA-016 shows the plan-vs-actual panel for this work order, and hides it from a role that may not view plans', async () => {
    const { rollupProject } = await import('@/src/lib/workOrderPlanVsActual');
    const workOrders = [{ id: 'w1', woNumber: 'WO-0007', title: 'Pump install', status: 'Issued', currency: 'IDR', revenue: '1000.00', revenueComplete: true }];
    const line = { source: 'vendor_bill', recordId: 'r1', projectId: 'p1', workOrderId: 'w1', disciplineId: null, occurredOn: null, reference: null, currency: 'IDR', amount: '300.00', reason: 'counted', quantity: null, quantityUnit: null, personId: null };
    h.pva = { isPending: false, isError: false, refetch: () => undefined,
      data: { workOrders, plans: [], split: null, rollup: rollupProject({ workOrders, lines: [line], plans: [], split: null, restricted: false } as never) } };
    const { unmount } = renderPage();
    expect(screen.getByTestId('wo-page-pva-direct').textContent).toMatch(/300/);
    unmount();
    h.canBilling = false;
    renderPage();
    expect(screen.queryByTestId('wo-page-pva')).toBeNull();
  });
  it('AC-WORP-001 shows number, title, status, project and order value', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('WO-0007');
    expect(screen.getByText('Pump install')).toBeTruthy();
    expect(screen.getByText('Plant A').closest('a')?.getAttribute('href')).toBe('/projects/p1');
    expect(screen.getByTestId('wo-order-value').textContent).toMatch(/1\.500\.000|1,500,000/);
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
  it('AC-WORP-006 costs group by source and discipline with No discipline for the unlabelled record', () => {
    renderPage();
    const po = screen.getByTestId('cost-group-purchase_order');
    expect(within(po).getByText('Mechanical')).toBeTruthy();
    expect(within(po).getByText('No discipline')).toBeTruthy();
    expect(within(po).getByTestId('cost-total-purchase_order')).toBeTruthy();
    expect(screen.queryByTestId('cost-group-vendor_bill')).toBeNull();
  });
  it('links a purchase cost to its resolved source record', () => {
    h.links = q({ 'purchase_order:po1': '/procurement/purchase-1/timeline#cost-po1' });
    renderPage();
    expect(screen.getByRole('link', { name: 'po1' }).getAttribute('href')).toBe('/procurement/purchase-1/timeline#cost-po1');
  });
  it('does not link stock costs until the work-order cost build is ready', () => {
    h.lines = q({ stock_document: [ln('stock_document', 'stock1', null)] });
    renderPage();
    expect(screen.queryByRole('link', { name: 'stock1' })).toBeNull();
    expect(screen.getByText('Not yet costed')).toBeTruthy();
  });
  it('identifies a timesheet by person and week, and uses the standard whole-unit money display', () => {
    h.lines = q({ timesheet_entry: [{ ...ln('timesheet_entry', 'hour1', null), reference: null }], purchase_order: [ln('purchase_order', 'po1', 'd1')] });
    h.labels = q({ hour1: { person: 'Morgan Lee', weekStart: '2026-10-26' } });
    h.money = q({ purchase_order: { po1: { amount: 45000, currency: 'USD' } } });
    renderPage();
    expect(screen.getByTestId('cost-line-hour1').textContent).toMatch(/Morgan Lee.*26 Oct/);
    expect(within(screen.getByTestId('cost-line-hour1')).queryByRole('link')).toBeNull();
    expect(screen.getByTestId('cost-total-purchase_order').textContent).toBe('$45,000');
  });
  it('uses a readable fallback when the timesheet identity is unavailable', () => {
    h.lines = q({ timesheet_entry: [{ ...ln('timesheet_entry', 'hour1', null), reference: null }] });
    renderPage();
    expect(screen.getByTestId('cost-line-hour1').textContent).toContain('Timesheet');
    expect(screen.getByTestId('cost-line-hour1').textContent).not.toContain('hour1');
  });
  it('explains when costs have no available amount', () => {
    h.lines = q({ timesheet_entry: [ln('timesheet_entry', 'hour1', null)] });
    h.money = q({});
    renderPage();
    expect(screen.getByText('Not yet costed')).toBeTruthy();
  });
  it('AC-WORP-007 a caller who cannot read purchase money sees records with no total and a restricted note', () => {
    h.money = q({ purchase_order: null });
    renderPage();
    expect(screen.getByTestId('cost-restricted-purchase_order')).toBeTruthy();
    expect(screen.queryByTestId('cost-total-purchase_order')).toBeNull();
    expect(screen.getByTestId('cost-line-po1')).toBeTruthy();
  });
  it('AC-WORP-008 billing figures are the shipped work_order_billing row, and the acceptance list is this work order only', () => {
    renderPage();
    expect(screen.getByTestId('billing-invoiced').textContent).toMatch(/10/);
    expect(screen.getByTestId('billing-remaining').textContent).toMatch(/40/);
    expect(screen.getByTestId('acceptance-a1')).toBeTruthy();
    expect(screen.queryByTestId('acceptance-a2')).toBeNull();
  });
  it('does not claim that pending issue and task integrations are empty', () => {
    renderPage();
    expect(screen.queryByTestId('wo-issues-empty')).toBeNull();
    expect(screen.queryByTestId('wo-tasks-empty')).toBeNull();
  });
  it('opens a linked file in the document viewer', async () => {
    h.docs = q([{ id: 'd1', title: 'BAST scan', file_path: 'file.pdf', status: 'Draft' }]);
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'BAST scan' }));
    expect(viewerOpen).toHaveBeenCalledWith(expect.objectContaining({ name: 'BAST scan' }));
  });
  it('includes documents attached to the work order through time and materials sign-off', () => {
    h.claimDocs = q(['d2']);
    renderPage();
    expect(within(screen.getByTestId('wo-documents')).getByText('Unrelated')).toBeTruthy();
  });
  it('lists only the documents this work order points to', () => {
    renderPage();
    const docs = screen.getByTestId('wo-documents');
    expect(within(docs).getByText('BAST scan')).toBeTruthy();
    expect(within(docs).queryByText('Unrelated')).toBeNull();
  });
  it('does not report zero progress or no documents when acceptances fail, and retries the failed read', async () => {
    const refetch = vi.fn();
    h.basts = q(undefined, { isError: true, refetch });
    renderPage();
    expect(screen.queryByTestId('scope-pct-b1')).toBeNull();
    expect(screen.queryByText('No visible documents are linked to this work order yet.')).toBeNull();
    const buttons = screen.getAllByRole('button', { name: /retry|try again/i });
    for (const button of buttons) await userEvent.click(button);
    expect(refetch).toHaveBeenCalled();
  });
  it('reports and retries a failed cost money read instead of silently omitting totals', async () => {
    const refetch = vi.fn();
    h.money = q(undefined, { isError: true, refetch });
    renderPage();
    expect(screen.getByText("Couldn't load the costs")).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /retry|try again/i }));
    expect(refetch).toHaveBeenCalled();
  });
  it('AC-WORP-009 one failing section shows its own error with retry; the rest render', async () => {
    const refetch = vi.fn();
    h.lines = q(undefined, { isError: true, refetch });
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /retry|try again/i }));
    expect(refetch).toHaveBeenCalled();
    expect(screen.getByTestId('scope-pct-b1')).toBeTruthy();
    expect(screen.getByTestId('billing-invoiced')).toBeTruthy();
  });
  it('hides billing figures for a caller who may not see billing, still listing acceptances', () => {
    h.canBilling = false;
    renderPage();
    expect(screen.queryByTestId('billing-invoiced')).toBeNull();
    expect(screen.getByTestId('acceptance-a1')).toBeTruthy();
  });
  it('links an empty scope to the project work orders area', () => {
    h.alloc = q([]);
    renderPage();
    expect(screen.getByRole('link', { name: 'Allocate lines on the project' }).getAttribute('href')).toBe('/projects/p1/work-orders');
  });
  it('FR-WORP-027 empty sections say so, never blank', () => {
    h.alloc = q([]); h.lines = q({}); h.basts = q([]);
    renderPage();
    expect(screen.getByText(/No contract lines are allocated/)).toBeTruthy();
    expect(screen.getByText(/No costs are attributed/)).toBeTruthy();
    expect(screen.getByText('No acceptances yet.')).toBeTruthy();
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
});
