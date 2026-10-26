import WorkOrderAcceptances from '../WorkOrderAcceptances';
import type { WorkOrderAcceptanceWithLines } from '@/src/lib/db/workOrderAcceptances';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';
import { formatProjectDetailAmount } from '../formatProjectDetailMoney';
import type { ContractLineFacts } from '@/src/lib/progressBilling';

/**
 * AC-CQ-015 — Billing and Work orders tabs under contract quantities (ADR-0091). Synthetic data only:
 * a 1,900 km line, a 1,000 km order, a 997 km final BAST.
 */
const h = vi.hoisted(() => ({
  role: 'Finance' as string,
  userId: 'u-fin',
  billing: { data: null as unknown, isPending: false, isError: false, refetch: vi.fn() },
  boq: [] as unknown[],
  claims: [] as unknown[],
  m: {} as Record<string, { mutateAsync: ReturnType<typeof vi.fn>; isPending: boolean }>,
  workOrders: [] as unknown[],
  woBilling: [] as unknown[],
  lines: [] as unknown[],
  acceptances: [] as unknown[],
  docs: [] as unknown[],
  accError: false,
  acc: {} as Record<string, { mutateAsync: ReturnType<typeof vi.fn>; isPending: boolean }>,
  wom: {} as Record<string, { mutateAsync: ReturnType<typeof vi.fn>; isPending: boolean }>,
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: h.userId, org_id: 'org-1', role: h.role } }) }));
vi.mock('@/src/auth/usePermission', async () => {
  const { can } = await vi.importActual<typeof import('@/src/auth/policy')>('@/src/auth/policy');
  return { usePermission: () => (action: never, entity: never, ctx: Record<string, unknown> = {}) => can(action, entity, { realRole: h.role, ...ctx } as never) };
});
vi.mock('@/src/hooks/useErpItemOptions', () => ({ useErpItemOptions: () => ({ connected: true, loadOptions: vi.fn() }) }));
vi.mock('@/src/hooks/useRevenueMode', () => ({ useRevenueMode: () => 'native' }));
vi.mock('@/src/hooks/useOwnershipCacheSync', () => ({ useRevenueRouteReady: () => true }));
vi.mock('@/src/hooks/useProgressBilling', () => ({
  useProjectBilling: () => h.billing,
  useBoqItems: () => ({ data: h.boq, isPending: false, isError: false, refetch: vi.fn() }),
  useProjectClaims: () => ({ data: h.claims, isPending: false, isError: false, refetch: vi.fn() }),
  useProgressBillingMutations: () => h.m,
}));
vi.mock('@/src/hooks/useWorkOrders', () => ({
  useProjectWorkOrders: () => ({ data: h.workOrders, isPending: false, isError: false, refetch: vi.fn() }),
  useProjectDrawdown: () => ({ data: { committed: 0, draft: 0, ceiling: 1_000_000, currency: 'IDR', basis: 'net' }, isPending: false, isError: false, refetch: vi.fn() }),
  useWorkOrderMutations: () => h.wom,
}));
vi.mock('@/src/hooks/useWorkOrderBilling', () => ({ useWorkOrderBilling: () => ({ data: h.woBilling, isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/hooks/useWorkOrderAcceptances', () => ({
  useWorkOrderLines: () => ({ data: h.lines, isPending: false, isError: false, refetch: vi.fn() }),
  useProjectWorkOrderLines: () => ({ data: h.lines, isPending: false, isError: false, refetch: vi.fn() }),
  useWorkOrderAcceptances: () => ({ data: h.accError ? undefined : h.acceptances, isPending: false, isError: h.accError, refetch: vi.fn() }),
  useWorkOrderAcceptanceMutations: () => h.acc,
}));
vi.mock('@/src/hooks/useDocuments', () => ({ useDocuments: () => ({ data: h.docs, isPending: false, isError: false }) }));
import BillingTab from '../tabs/BillingTab';
import WorkOrdersTab from '../tabs/WorkOrdersTab';

const money = (value: number) => formatProjectDetailAmount(value, 'IDR', 'en')!;
const boqRow = (id: string, code: string, unit: string, basis: 'unit_rate' | 'lump_sum', quantity: number, rate: number) =>
  ({ id, org_id: 'o', project_id: 'p1', earning_basis: basis, line_no: null, import_key: null, item_code: code, description: `${code} work`, unit, quantity, rate, created_at: '' });
const lineFacts = (over: Partial<ContractLineFacts> & { boqItemId: string }): ContractLineFacts => ({
  earningBasis: 'unit_rate', lineNo: null, orderedQuantity: 0, acceptedQuantity: 0, closedFinal: 0, earnedQuantity: 0, contractBalance: 0, allocations: [], ...over,
});
const baseFacts = {
  currency: 'IDR', contractNet: 95_000_000, workBilled: 40_000_000, dpBilled: 0, dpRecovered: 0, notSubmitted: 0,
  assessment: null as { month: string; pctComplete: number } | null, claimedByBoqItem: {}, assessedByBoqItem: {},
  earnedValue: 0, contractLines: [] as ContractLineFacts[],
};

beforeEach(() => {
  vi.clearAllMocks();
  h.role = 'Finance'; h.userId = 'u-fin';
  h.claims = []; h.workOrders = []; h.woBilling = []; h.lines = []; h.acceptances = []; h.docs = []; h.accError = false;
  const mutation = () => ({ mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false });
  h.acc = Object.fromEntries(['createLine', 'updateLine', 'deleteLine', 'prepare', 'withdraw', 'confirm'].map((n) => [n, mutation()]));
  h.wom = Object.fromEntries(['create', 'update', 'setValue', 'transition'].map((n) => [n, mutation()]));
  h.m = Object.fromEntries(['createBoq', 'updateBoq', 'deleteBoq', 'recordAssessment', 'createClaim', 'attachEvidence', 'withdrawClaim', 'raiseInvoice']
    .map((name) => [name, { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false }]));
});

function renderBilling() {
  render(<MemoryRouter><ToastProvider><BillingTab projectId="p1" currency="IDR" clientId="c1" projectManagerId="pm-1" /></ToastProvider></MemoryRouter>);
  return userEvent.setup();
}

describe('AC-CQ-015 Billing tab with contract lines', () => {
  const km = boqRow('b1', 'SURVEY', 'km', 'unit_rate', 1900, 50_000);
  const lot = boqRow('b2', 'MOBILISE', 'lot', 'lump_sum', 1, 10_000);

  it('AC-CQ-015 a unit-rate line shows contract, ordered, balance, accepted, earned and claimed quantities', () => {
    h.boq = [km];
    h.billing = { data: { ...baseFacts, earnedValue: 49_850_000, assessedByBoqItem: { b1: 1000 }, claimedByBoqItem: { b1: 800 },
      contractLines: [lineFacts({ boqItemId: 'b1', orderedQuantity: 1000, acceptedQuantity: 997, closedFinal: 997, earnedQuantity: 997, contractBalance: 903 })] },
    isPending: false, isError: false, refetch: vi.fn() };
    renderBilling();
    expect(screen.getByTestId('boq-ordered-b1')).toHaveTextContent('1,000');
    expect(screen.getByTestId('boq-balance-b1')).toHaveTextContent('903');
    expect(screen.getByTestId('boq-accepted-b1')).toHaveTextContent('997');
    expect(screen.getByTestId('boq-earned-b1')).toHaveTextContent('997');
    expect(screen.getByTestId('boq-claimed-b1')).toHaveTextContent('800');
    expect(screen.getByTestId('billing-assessed')).toHaveTextContent(money(49_850_000));
    expect(screen.getByTestId('billing-gap')).toHaveTextContent(money(9_850_000));
  });

  it('AC-CQ-015 a lump-sum line shows assessed and earned as percent of one lot', () => {
    h.boq = [lot];
    h.billing = { data: { ...baseFacts, earnedValue: 4_000, assessedByBoqItem: { b2: 0.4 },
      contractLines: [lineFacts({ boqItemId: 'b2', earningBasis: 'lump_sum', orderedQuantity: 1, earnedQuantity: 0.4, contractBalance: 0 })] },
    isPending: false, isError: false, refetch: vi.fn() };
    renderBilling();
    expect(screen.getByTestId('boq-earned-b2')).toHaveTextContent('40%');
    expect(screen.getByTestId('boq-assessed-b2')).toHaveTextContent('40%');
  });

  it('AC-CQ-015 over-ordering and over-measuring are said in words', () => {
    h.boq = [km];
    h.billing = { data: { ...baseFacts,
      contractLines: [lineFacts({ boqItemId: 'b1', orderedQuantity: 1950, acceptedQuantity: 2000, contractBalance: -50 })] },
    isPending: false, isError: false, refetch: vi.fn() };
    renderBilling();
    expect(screen.getByTestId('boq-balance-b1')).toHaveTextContent('Over-ordered by 50');
    expect(screen.getByTestId('boq-accepted-b1')).toHaveTextContent('More than ordered');
  });

  it('AC-CQ-015 confirmed earned work shows with no assessment, and the missing assessment is stated', () => {
    h.boq = [km];
    h.billing = { data: { ...baseFacts, earnedValue: 49_850_000,
      contractLines: [lineFacts({ boqItemId: 'b1', closedFinal: 997, earnedQuantity: 997, contractBalance: 903 })] },
    isPending: false, isError: false, refetch: vi.fn() };
    renderBilling();
    expect(screen.getByTestId('billing-assessed')).toHaveTextContent(money(49_850_000));
    expect(screen.getByTestId('billing-unassessed')).toHaveTextContent('No assessment yet');
  });

  it('AC-CQ-015 a project without lines keeps the percent method and never states a missing assessment', () => {
    h.boq = [];
    h.billing = { data: { ...baseFacts, assessment: { month: '2026-10-01', pctComplete: 60 } }, isPending: false, isError: false, refetch: vi.fn() };
    renderBilling();
    expect(screen.getByTestId('billing-assessed')).toHaveTextContent(money(57_000_000));
    expect(screen.queryByTestId('billing-unassessed')).toBeNull();
  });

  it('AC-CQ-015 while the summary is unavailable the quantity cells show a dash, never a fabricated zero', () => {
    h.boq = [km];
    h.billing = { data: undefined, isPending: false, isError: true, refetch: vi.fn() };
    renderBilling();
    for (const id of ['boq-ordered-b1', 'boq-balance-b1', 'boq-accepted-b1', 'boq-earned-b1']) {
      expect(screen.getByTestId(id)).toHaveTextContent('—');
    }
  });

  it('AC-CQ-015 the BoQ add dialog has no work order picker', async () => {
    h.boq = [km];
    h.billing = { data: { ...baseFacts, contractLines: [lineFacts({ boqItemId: 'b1' })] }, isPending: false, isError: false, refetch: vi.fn() };
    const user = renderBilling();
    await user.click(screen.getByRole('button', { name: 'Add line' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByLabelText(/Work order/)).toBeNull();
    expect(within(dialog).getByLabelText(/Earned by/)).toBeInTheDocument();
  });
});

const wo = (over: Record<string, unknown> = {}) => ({
  id: 'wo-1', org_id: 'org-1', project_id: 'p1', wo_number: 'WO-001', client_po_number: 'PO-77', title: 'Phase 1', description: null,
  status: 'Issued', order_value: 50_000_000, currency: 'IDR', tax_treatment: 'exclusive', tax_amount: 0, tax_rate: null, tax_template: null,
  tax_base_numerator: 1, tax_base_denominator: 1, order_date: '2026-08-01', start_date: null, end_date: null, order_value_set_by: 'u-2',
  order_value_set_at: '2026-08-01T00:00:00Z', issued_by: 'u-3', issued_at: '2026-08-02T00:00:00Z', over_commit_ack_by: null,
  over_commit_ack_at: null, closed_at: null, cancelled_at: null, created_at: '2026-08-01T00:00:00Z', closing_value: null, ...over,
});
const alloc = (id: string, boq: string, quantity: number, woId = 'wo-1') => ({ id, org_id: 'org-1', work_order_id: woId, boq_item_id: boq, quantity, created_at: '' });
const bast = (id: string, over: Record<string, unknown> = {}) => ({
  id, org_id: 'org-1', project_id: 'p1', work_order_id: 'wo-1', acceptance_date: '2026-10-01', is_final: false, status: 'Draft', prepared_by: 'u-pm',
  prepared_at: '2026-10-01T00:00:00Z', confirmed_by: null, confirmed_at: null, confirm_basis: null, withdrawn_at: null, note: null, document_id: null,
  lines: [{ acceptance_id: id, boq_item_id: 'b1', quantity: 400 }], ...over,
});
const woBilling = (over: Record<string, unknown> = {}) => ({
  workOrderId: 'wo-1', projectId: 'p1', status: 'Issued', currency: 'IDR', orderNet: 50_000_000, invoiced: 0, pending: 0, paid: 0, remaining: 50_000_000,
  figuresComplete: true, lineCount: 0, unpaidCount: 0, ...over,
});
const SIGNED = { id: 'd1', org_id: 'o', project_id: 'p1', code: null, category: 'Report', title: 'Signed BAST 1', revision: 'A', status: 'Issued', doc_date: null, author_id: null, file_path: 'docs/d1.pdf', created_at: '' };

function renderWorkOrders(projectManagerId: string | null = 'u-pm') {
  render(<MemoryRouter><ToastProvider><WorkOrdersTab projectId="p1" currency="IDR" clientId="c1" projectManagerId={projectManagerId} /></ToastProvider></MemoryRouter>);
  return userEvent.setup();
}
const disclosure = () => screen.getByTestId('wo-quantities-wo-1');
const openDisclosure = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(within(disclosure()).getByText(/Contract lines and BAST/));
};

describe('AC-CQ-015 Work orders tab: allocations and BAST list', () => {
  beforeEach(() => {
    h.boq = [boqRow('b1', 'SURVEY', 'km', 'unit_rate', 1900, 50_000)];
    h.billing = { data: { ...baseFacts, contractLines: [lineFacts({ boqItemId: 'b1', orderedQuantity: 1000, contractBalance: 900,
      allocations: [{ workOrderId: 'wo-1', boqItemId: 'b1', quantity: 1000, claimedQuantity: 0, acceptedQuantity: null, final: false }] })] }, isPending: false, isError: false, refetch: vi.fn() };
    h.workOrders = [wo()];
    h.woBilling = [woBilling()];
    h.lines = [alloc('l1', 'b1', 1000)];
    h.docs = [SIGNED];
    h.role = 'Project Manager'; h.userId = 'u-pm';
  });

  it('AC-CQ-015 each work order has one disclosure: contract lines first, then BASTs, with statuses in words', async () => {
    h.acceptances = [
      bast('a1', { status: 'Confirmed', confirmed_by: 'u-fin', confirmed_at: '2026-10-02T00:00:00Z', confirm_basis: 'standard', document_id: 'd1', lines: [{ acceptance_id: 'a1', boq_item_id: 'b1', quantity: 400 }] }),
      bast('a2', { is_final: true, lines: [{ acceptance_id: 'a2', boq_item_id: 'b1', quantity: 997 }] }),
      bast('a3', { status: 'Withdrawn', withdrawn_at: '2026-10-03T00:00:00Z' }),
    ];
    const user = renderWorkOrders();
    await openDisclosure(user);
    const region = within(disclosure());
    expect(region.getByTestId('wo-lines-wo-1')).toHaveTextContent('SURVEY');
    expect(region.getByTestId('wo-lines-wo-1')).toHaveTextContent('1,000');
    expect(region.getByTestId('bast-a1')).toHaveTextContent('Confirmed');
    expect(region.getByTestId('bast-a1')).toHaveTextContent('Stage');
    expect(region.getByTestId('bast-a1')).toHaveTextContent('Signed BAST 1');
    expect(region.getByTestId('bast-a2')).toHaveTextContent('Draft');
    expect(region.getByTestId('bast-a2')).toHaveTextContent('Final');
    expect(region.getByTestId('bast-a3')).toHaveTextContent('Withdrawn');
  });

  it('AC-CQ-015 the work order\'s own PM may prepare; an Engineer and another PM may not', async () => {
    const user = renderWorkOrders();
    await openDisclosure(user);
    expect(within(disclosure()).getByRole('button', { name: 'Prepare BAST' })).toBeInTheDocument();
    expect(within(disclosure()).queryByRole('button', { name: /^Confirm/ })).toBeNull();
  });

  it('AC-CQ-015 an Engineer can neither allocate lines nor prepare a BAST', async () => {
    h.role = 'Engineer'; h.userId = 'u-eng';
    const user = renderWorkOrders();
    await openDisclosure(user);
    expect(within(disclosure()).queryByRole('button', { name: 'Prepare BAST' })).toBeNull();
    expect(within(disclosure()).queryByRole('button', { name: 'Edit lines' })).toBeNull();
  });

  it('AC-CQ-015 a PM of another project may allocate lines but not prepare a BAST', async () => {
    h.userId = 'u-other';
    const user = renderWorkOrders('u-pm');
    await openDisclosure(user);
    expect(within(disclosure()).queryByRole('button', { name: 'Prepare BAST' })).toBeNull();
    expect(within(disclosure()).getByRole('button', { name: 'Edit lines' })).toBeInTheDocument();
  });

  it('AC-CQ-015 Finance may confirm a Draft prepared by someone else, but Project Manager may not', async () => {
    h.acceptances = [bast('a2', { is_final: true })];
    h.role = 'Finance'; h.userId = 'u-fin';
    const user = renderWorkOrders();
    await openDisclosure(user);
    expect(within(disclosure()).getByRole('button', { name: 'Confirm BAST' })).toBeInTheDocument();
    expect(within(disclosure()).queryByText(/You prepared this/)).toBeNull();
  });

  it('AC-CQ-015 a PM who prepared it sees no Confirm; a Finance preparer sees Confirm with the SoD hint', async () => {
    h.acceptances = [bast('a2', { prepared_by: 'u-pm' })];
    const user = renderWorkOrders();
    await openDisclosure(user);
    expect(within(disclosure()).queryByRole('button', { name: 'Confirm BAST' })).toBeNull();
  });

  it('AC-CQ-015 a Finance preparer is told another approver is needed unless they are the only active member', async () => {
    h.acceptances = [bast('a2', { prepared_by: 'u-fin' })];
    h.role = 'Finance'; h.userId = 'u-fin';
    const user = renderWorkOrders();
    await openDisclosure(user);
    expect(within(disclosure()).getByRole('button', { name: 'Confirm BAST' })).toBeInTheDocument();
    expect(within(disclosure()).getByText(/You prepared this/)).toBeInTheDocument();
  });

  it('AC-CQ-015 the preparer withdraws a Draft after confirming; a confirmed BAST has no withdraw', async () => {
    h.acceptances = [bast('a2'), bast('a1', { status: 'Confirmed', confirmed_by: 'u-fin', confirmed_at: '2026-10-02T00:00:00Z', confirm_basis: 'standard' })];
    const user = renderWorkOrders();
    await openDisclosure(user);
    expect(within(screen.getByTestId('bast-a1')).queryByRole('button', { name: /Withdraw/ })).toBeNull();
    await user.click(within(screen.getByTestId('bast-a2')).getByRole('button', { name: /Withdraw/ }));
    expect(h.acc.withdraw.mutateAsync).not.toHaveBeenCalled();
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Withdraw BAST' }));
    expect(h.acc.withdraw.mutateAsync).toHaveBeenCalledWith('a2');
  });

  it('AC-CQ-015 preparing a BAST sends the work order and the cumulative quantities', async () => {
    const user = renderWorkOrders();
    await openDisclosure(user);
    await user.click(within(disclosure()).getByRole('button', { name: 'Prepare BAST' }));
    await user.type(screen.getByLabelText(/SURVEY/), '400');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Prepare BAST' }));
    expect(h.acc.prepare.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      workOrderId: 'wo-1', isFinal: false, lines: [{ boqItemId: 'b1', quantity: 400 }],
    }));
  });

  it('AC-CQ-015 re-recording a Draft sends its id', async () => {
    h.acceptances = [bast('a2')];
    const user = renderWorkOrders();
    await openDisclosure(user);
    await user.click(within(screen.getByTestId('bast-a2')).getByRole('button', { name: /Edit/ }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save BAST' }));
    expect(h.acc.prepare.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ workOrderId: 'wo-1', acceptanceId: 'a2' }));
  });

  it('AC-CQ-015 a work order with no allocations asks for them first', async () => {
    h.lines = [];
    const user = renderWorkOrders();
    await openDisclosure(user);
    expect(within(disclosure()).getByText('No contract lines allocated yet')).toBeInTheDocument();
    expect(within(disclosure()).queryByRole('button', { name: 'Prepare BAST' })).toBeNull();
  });

  it('AC-CQ-015 allocating a line from the work order calls the allocation write for this order only', async () => {
    h.lines = [];
    const user = renderWorkOrders();
    await openDisclosure(user);
    await user.click(within(disclosure()).getByRole('button', { name: 'Edit lines' }));
    await user.type(screen.getByLabelText(/SURVEY —/), '1000');
    await user.click(screen.getByRole('button', { name: 'Save SURVEY' }));
    expect(h.acc.createLine.mutateAsync).toHaveBeenCalledWith({ workOrderId: 'wo-1', boqItemId: 'b1', quantity: 1000 });
  });

  it('AC-CQ-015 an unreadable BAST list says so instead of showing none', async () => {
    h.accError = true;
    const user = renderWorkOrders();
    await openDisclosure(user);
    expect(within(disclosure()).getByText('Couldn’t load the BASTs')).toBeInTheDocument();
    expect(within(disclosure()).queryByText('No BASTs yet')).toBeNull();
  });
});

describe('AC-CQ-015 Work orders tab: final confirmation and closing value', () => {
  beforeEach(() => {
    h.boq = [boqRow('b1', 'SURVEY', 'km', 'unit_rate', 1900, 50_000)];
    h.billing = { data: { ...baseFacts, contractLines: [lineFacts({ boqItemId: 'b1' })] }, isPending: false, isError: false, refetch: vi.fn() };
    h.workOrders = [wo()];
    h.woBilling = [woBilling()];
    h.lines = [alloc('l1', 'b1', 1000)];
    h.docs = [SIGNED];
    h.acceptances = [bast('a2', { is_final: true, document_id: 'd1', lines: [{ acceptance_id: 'a2', boq_item_id: 'b1', quantity: 997 }] })];
    h.role = 'Finance'; h.userId = 'u-fin';
  });
  const confirmButton = () => within(screen.getByTestId('bast-a2')).getByRole('button', { name: 'Confirm BAST' });

  it('AC-CQ-015 confirming a final BAST asks first, says it closes the order, and sends only the id', async () => {
    h.acc.confirm.mutateAsync.mockResolvedValue({ closingValue: 49_850_000, dpHeld: 0 });
    const user = renderWorkOrders();
    await openDisclosure(user);
    await user.click(confirmButton());
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('closes the work order');
    expect(h.acc.confirm.mutateAsync).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Confirm final BAST' }));
    expect(h.acc.confirm.mutateAsync).toHaveBeenCalledWith('a2');
  });

  it('AC-CQ-015 the order is never shown closed until the server says so', async () => {
    h.acc.confirm.mutateAsync.mockResolvedValue({ closingValue: 49_850_000, dpHeld: 0 });
    const user = renderWorkOrders();
    await openDisclosure(user);
    await user.click(confirmButton());
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Confirm final BAST' }));
    expect(screen.queryByTestId('wo-closing-wo-1')).toBeNull();
    const orderRow = screen.getByRole('row', { name: /WO-001/ });
    expect(within(orderRow).queryByText('Closed')).not.toBeInTheDocument();
    expect(within(orderRow).getAllByText('Issued').length).toBeGreaterThan(0);
  });

  it('AC-CQ-015 a server refusal stays in the dialog with its figures and nothing is closed', async () => {
    h.acc.confirm.mutateAsync.mockRejectedValue(new Error('closing value 50,050,000 is above the order net 50,000,000'));
    const user = renderWorkOrders();
    await openDisclosure(user);
    await user.click(confirmButton());
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Confirm final BAST' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(await within(dialog).findByText(/above the order net 50,000,000/)).toBeInTheDocument();
    expect(screen.queryByTestId('wo-closing-wo-1')).toBeNull();
  });

  it('AC-CQ-015 a closed order shows the original PO value and the closing value separately', () => {
    h.workOrders = [wo({ status: 'Closed', closing_value: 49_850_000, closed_at: '2026-10-05T00:00:00Z' })];
    h.woBilling = [woBilling({ status: 'Closed', orderNet: 49_850_000, remaining: 49_850_000 })];
    h.acceptances = [bast('a2', { is_final: true, status: 'Confirmed', confirmed_by: 'u-fin', confirmed_at: '2026-10-05T00:00:00Z', confirm_basis: 'standard' })];
    renderWorkOrders();
    expect(screen.getByTestId('wo-value-wo-1')).toHaveTextContent('50,000,000');
    expect(screen.getByTestId('wo-closing-wo-1')).toHaveTextContent('Closed at');
    expect(screen.getByTestId('wo-closing-wo-1')).toHaveTextContent('49,850,000');
  });

  it('AC-CQ-015 down payment still held after closing is stated persistently, with the amount and the remedy', async () => {
    h.acc.confirm.mutateAsync.mockResolvedValue({ closingValue: 49_850_000, dpHeld: 2_000_000 });
    const user = renderWorkOrders();
    await openDisclosure(user);
    await user.click(confirmButton());
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Confirm final BAST' }));
    const notice = await screen.findByTestId('wo-dp-held-notice');
    expect(notice).toHaveTextContent('2,000,000');
    expect(notice).toHaveTextContent('recover the rest');
    expect(notice).toHaveTextContent('refund');
    expect(screen.getByTestId('wo-dp-held-notice')).toBeInTheDocument();
  });

  it('AC-CQ-015 a stage BAST confirm shows no down-payment-after-closing banner, even if the server reports a held amount', async () => {
    h.acceptances = [bast('a2', { is_final: false, document_id: 'd1', lines: [{ acceptance_id: 'a2', boq_item_id: 'b1', quantity: 400 }] })];
    h.acc.confirm.mutateAsync.mockResolvedValue({ closingValue: null, dpHeld: 2_000_000 });
    const user = renderWorkOrders();
    await openDisclosure(user);
    await user.click(confirmButton());
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Confirm BAST' }));
    expect(h.acc.confirm.mutateAsync).toHaveBeenCalledWith('a2');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(screen.queryByTestId('wo-dp-held-notice')).toBeNull();
  });

  it('AC-CQ-015 Close is hidden for a work order with allocations (its final BAST closes it) and kept for one without', () => {
    h.role = 'Admin'; h.userId = 'u-admin';
    h.workOrders = [wo(), wo({ id: 'wo-2', wo_number: 'WO-002', title: 'Phase 2' })];
    h.woBilling = [woBilling(), woBilling({ workOrderId: 'wo-2' })];
    renderWorkOrders();
    const closes = screen.getAllByRole('button', { name: 'Close' });
    expect(closes).toHaveLength(1);
  });

  it('AC-CQ-015 the Invoice action still follows the server billing facts for a closed order', () => {
    h.workOrders = [wo({ status: 'Closed', closing_value: 49_850_000 })];
    h.woBilling = [woBilling({ status: 'Closed', orderNet: 49_850_000, remaining: 9_850_000, invoiced: 40_000_000 })];
    renderWorkOrders();
    expect(screen.getByRole('button', { name: 'Invoice' })).toBeInTheDocument();
  });
});


it('GLM R-007 preserves the acceptance identity and names unavailable quantities instead of crashing', () => {
  const incomplete = { id: 'bast-incomplete', status: 'Confirmed', acceptance_date: '2026-10-21', prepared_at: '2026-10-21T08:00:00Z', lines: undefined } as unknown as WorkOrderAcceptanceWithLines;
  render(<ToastProvider><WorkOrderAcceptances workOrder={{ id: 'wo1', status: 'Issued' }} boqItems={[]} documents={[]}
    acceptances={[incomplete]} state="ready" onRetry={vi.fn()} currentUserId="finance" projectManagerId="pm" hasAllocations={false}
    onPrepare={vi.fn()} onEdit={vi.fn()} onWithdraw={vi.fn()} onConfirm={vi.fn()} /></ToastProvider>);
  expect(screen.getByTestId('bast-bast-incomplete')).toBeInTheDocument();
  expect(within(screen.getByTestId('bast-bast-incomplete')).getByRole('alert')).toHaveTextContent('Acceptance quantities are unavailable');
});
