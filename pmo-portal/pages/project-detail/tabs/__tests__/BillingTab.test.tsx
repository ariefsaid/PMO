import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/src/components/ui';
import { formatCurrencyCents } from '@/src/lib/format';

const h = vi.hoisted(() => ({
  role: 'Finance' as string,
  userId: 'u-fin',
  connected: true,
  billing: { data: null as unknown, isPending: false, isError: false, refetch: vi.fn() },
  boq: [] as unknown[],
  claims: [] as unknown[],
  docs: [] as unknown[],
  m: {} as Record<string, { mutateAsync: ReturnType<typeof vi.fn>; isPending: boolean }>,
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: h.userId, org_id: 'org-1' } }) }));
vi.mock('@/src/auth/usePermission', async () => {
  const { can } = await vi.importActual<typeof import('@/src/auth/policy')>('@/src/auth/policy');
  return { usePermission: () => (action: never, entity: never, ctx: Record<string, unknown> = {}) => can(action, entity, { realRole: h.role, ...ctx } as never) };
});
vi.mock('@/src/hooks/useErpItemOptions', () => ({ useErpItemOptions: () => ({ connected: h.connected, loadOptions: vi.fn() }) }));
vi.mock('@/src/hooks/useProgressBilling', () => ({
  useProjectBilling: () => h.billing,
  useBoqItems: () => ({ data: h.boq, isPending: false, isError: false, refetch: vi.fn() }),
  useProjectClaims: () => ({ data: h.claims, isPending: false, isError: false, refetch: vi.fn() }),
  useProgressBillingMutations: () => h.m,
}));
vi.mock('@/src/hooks/useWorkOrders', () => ({ useProjectWorkOrders: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/hooks/useDocuments', () => ({ useDocuments: () => ({ data: h.docs, isPending: false, isError: false }) }));
import BillingTab from '../BillingTab';

const FACTS = {
  currency: 'IDR', contractNet: 1_000_000, workBilled: 250_000, dpBilled: 200_000, dpRecovered: 40_000, notSubmitted: 40_000,
  assessment: { month: '2026-10-01', pctComplete: 60 }, claimedByBoqItem: { b1: 5, b2: 6 }, assessedByBoqItem: { b1: 6 },
};
const BOQ = [
  { id: 'b1', org_id: 'o', project_id: 'p1', work_order_id: null, item_code: 'SURVEY', description: 'Route survey', unit: 'km', quantity: 10, rate: 50000, created_at: '' },
  { id: 'b2', org_id: 'o', project_id: 'p1', work_order_id: null, item_code: 'STATION', description: 'Station build', unit: 'unit', quantity: 5, rate: 100000, created_at: '' },
];
const claim = (id: string, extra: Record<string, unknown> = {}) => ({
  id, org_id: 'o', project_id: 'p1', work_order_id: null, kind: 'progress', currency: 'IDR', gross_amount: 200000,
  down_payment_amount: null, recovery_pct: null, dp_recovery_amount: 40000, dp_item_code: 'DP-ITEM', created_by: 'u-fin',
  created_at: '2026-10-01T00:00:00Z', withdrawn_by: null, withdrawn_at: null, lines: [], evidence: [], invoice: null, ...extra,
});
const CLAIMS = [
  claim('k1'),
  claim('k2', { evidence: [{ id: 'ev-1', document_id: 'doc-1', document_status: 'Issued', document_revision: 'A' }] }),
  claim('k3', { invoice: { si_number: 'ACC-SINV-1', status: 'Unpaid', amount: 160000 } }),
];
const DOCS = [{ id: 'doc-1', org_id: 'o', project_id: 'p1', code: null, category: 'Report', title: 'Progress report', revision: 'A', status: 'Issued', doc_date: null, author_id: null, file_path: 'docs/report.pdf', created_at: '' }];
// jest-dom collapses whitespace (incl. the currency's no-break space) in the element text, so normalise the expectation the same way.
const money = (value: number) => formatCurrencyCents(value, 'IDR').replace(/\s+/g, ' ');

beforeEach(() => {
  vi.clearAllMocks();
  h.role = 'Finance'; h.userId = 'u-fin'; h.connected = true;
  h.billing = { data: FACTS, isPending: false, isError: false, refetch: vi.fn() };
  h.boq = BOQ; h.claims = CLAIMS; h.docs = DOCS;
  h.m = Object.fromEntries(['createBoq', 'updateBoq', 'deleteBoq', 'recordAssessment', 'createClaim', 'attachEvidence', 'withdrawClaim', 'raiseInvoice']
    .map((name) => [name, { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false }]));
});

function renderTab(clientId: string | null = 'c1') {
  render(<ToastProvider><BillingTab projectId="p1" currency="IDR" clientId={clientId} projectManagerId="pm-1" /></ToastProvider>);
  return userEvent.setup();
}

describe('BillingTab', () => {
  it('AC-PB-008 the summary shows contract, billed, assessed, the gap, DP held, not yet billed and not submitted, net of tax', () => {
    renderTab();
    expect(screen.getByTestId('billing-contract')).toHaveTextContent(money(1_000_000));
    expect(screen.getByTestId('billing-billed')).toHaveTextContent(money(250_000));
    expect(screen.getByTestId('billing-assessed')).toHaveTextContent(money(600_000));
    expect(screen.getByTestId('billing-gap')).toHaveTextContent(money(350_000));
    expect(screen.getByTestId('billing-dp-held')).toHaveTextContent(money(160_000));
    expect(screen.getByTestId('billing-remaining')).toHaveTextContent(money(750_000));
    expect(screen.getByTestId('billing-not-submitted')).toHaveTextContent(money(40_000));
    expect(screen.getByTestId('billing-billed')).toHaveTextContent('excl. PPN');
  });

  it("AC-PB-008 the not-submitted figure says it counts claims only — never mistaken for the Work orders tab's not yet submitted, which also counts draft invoices (#785 Discover)", () => {
    renderTab();
    expect(screen.getByTestId('billing-not-submitted').closest('div')).toHaveTextContent('Claims raised, not yet submitted');
  });

  it('AC-PB-008 with no assessment it says so instead of a figure, and shows no gap', () => {
    h.billing = { ...h.billing, data: { ...FACTS, assessment: null, assessedByBoqItem: {} } };
    renderTab();
    expect(screen.getByTestId('billing-assessed')).toHaveTextContent('No assessment yet');
    expect(screen.queryByTestId('billing-gap')).toBeNull();
  });

  it('AC-PB-008 a failed read shows the error, never zeros', () => {
    h.billing = { data: undefined, isPending: false, isError: true, refetch: vi.fn() };
    renderTab();
    expect(screen.getByText("Couldn't load billing")).toBeInTheDocument();
    expect(screen.queryByTestId('billing-billed')).toBeNull();
  });

  it('AC-PB-008 the BoQ shows assessed, claimed and left-to-claim quantities and flags over-claiming', () => {
    renderTab();
    expect(screen.getByTestId('boq-assessed-b1')).toHaveTextContent('6');
    expect(screen.getByTestId('boq-claimed-b1')).toHaveTextContent('5');
    expect(screen.getByTestId('boq-remaining-b1')).toHaveTextContent('5');
    expect(screen.getByTestId('boq-assessed-b2')).toHaveTextContent('—');
    expect(screen.getByTestId('boq-remaining-b2')).toHaveTextContent('Over-claimed');
  });

  it('AC-PB-008 a claim without evidence can be evidenced but not raised', () => {
    renderTab();
    const actions = within(screen.getByTestId('claim-actions-k1'));
    expect(actions.getByRole('button', { name: 'Attach evidence' })).toBeInTheDocument();
    expect(actions.getByText('Attach evidence before raising')).toBeInTheDocument();
    expect(actions.queryByRole('button', { name: 'Raise invoice' })).toBeNull();
    expect(screen.getByTestId('claim-evidence-k1')).toHaveTextContent('0');
    expect(screen.getByTestId('claim-evidence-k2')).toHaveTextContent('1');
  });

  it("AC-PB-009 raising confirms the server's figures and dispatches for the project's client", async () => {
    const user = renderTab();
    await user.click(within(screen.getByTestId('claim-actions-k2')).getByRole('button', { name: 'Raise invoice' }));
    expect(screen.getByTestId('raise-figures')).toHaveTextContent(money(200_000));
    expect(screen.getByTestId('raise-figures')).toHaveTextContent(money(40_000));
    expect(screen.getByTestId('raise-figures')).toHaveTextContent(money(160_000));
    await user.click(screen.getByRole('button', { name: 'Create ERP invoice' }));
    expect(h.m.raiseInvoice.mutateAsync).toHaveBeenCalledWith({ claimId: 'k2', customerId: 'c1', intent: { id: 'k2', idempotencyKey: expect.any(String) } });
  });

  it('AC-PB-009 a refused raise leaves the claim not raised', async () => {
    h.m.raiseInvoice.mutateAsync.mockRejectedValue(new Error('ERP unreachable'));
    const user = renderTab();
    await user.click(within(screen.getByTestId('claim-actions-k2')).getByRole('button', { name: 'Raise invoice' }));
    await user.click(screen.getByRole('button', { name: 'Create ERP invoice' }));
    expect(await screen.findAllByText('Not raised')).toHaveLength(2);
    expect(screen.getByText(/ACC-SINV-1/)).toBeInTheDocument();
  });

  it('AC-PB-008 attaching evidence sends the claim and the chosen document', async () => {
    const user = renderTab();
    await user.click(within(screen.getByTestId('claim-actions-k1')).getByRole('button', { name: 'Attach evidence' }));
    await user.selectOptions(screen.getByLabelText('Evidence document'), 'doc-1');
    await user.click(screen.getByRole('button', { name: 'Attach' }));
    expect(h.m.attachEvidence.mutateAsync).toHaveBeenCalledWith({ claimId: 'k1', documentId: 'doc-1' });
  });

  it("AC-PB-008 the project's PM records progress and edits the BoQ but has no billing buttons", () => {
    h.role = 'Project Manager'; h.userId = 'pm-1';
    renderTab();
    expect(screen.getByRole('button', { name: 'Record progress' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add line' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New claim' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Attach evidence' })).toBeNull();
  });

  it('AC-PB-008 another PM does not record progress on this project', () => {
    h.role = 'Project Manager'; h.userId = 'pm-2';
    renderTab();
    expect(screen.queryByRole('button', { name: 'Record progress' })).toBeNull();
  });

  it('AC-PB-008 Finance gets no billing buttons without an ERP connection', () => {
    h.connected = false;
    renderTab();
    expect(screen.queryByRole('button', { name: 'New claim' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Raise invoice' })).toBeNull();
  });

  it('AC-PB-008 Finance gets no billing buttons when the project has no client', () => {
    renderTab(null);
    expect(screen.queryByRole('button', { name: 'New claim' })).toBeNull();
  });
});
