import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';
import { formatCurrencyCents } from '@/src/lib/format';
import type { ContractLineFacts } from '@/src/lib/progressBilling';

/**
 * AC-CQ-015 — Billing and Work orders tabs under contract quantities (ADR-0090). Synthetic data only:
 * a 1,900 km line, a 1,000 km order, a 997 km final BAST.
 */
const h = vi.hoisted(() => ({
  role: 'Finance' as string,
  userId: 'u-fin',
  billing: { data: null as unknown, isPending: false, isError: false, refetch: vi.fn() },
  boq: [] as unknown[],
  claims: [] as unknown[],
  m: {} as Record<string, { mutateAsync: ReturnType<typeof vi.fn>; isPending: boolean }>,
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
vi.mock('@/src/hooks/useWorkOrders', () => ({ useProjectWorkOrders: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/hooks/useWorkOrderAcceptances', () => ({
  useWorkOrderLines: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useDocuments', () => ({ useDocuments: () => ({ data: [], isPending: false, isError: false }) }));
import BillingTab from '../tabs/BillingTab';

const money = (value: number) => formatCurrencyCents(value, 'IDR').replace(/\s+/g, ' ');
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
  h.claims = [];
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
