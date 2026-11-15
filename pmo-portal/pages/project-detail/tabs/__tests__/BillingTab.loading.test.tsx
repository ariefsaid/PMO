/** AC-NBR-008: "New claim" waits only for the reads that decide whether and how a claim can start. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';

vi.mock('@/src/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/components/ui')>();
  const ButtonWithVariant = (props: React.ComponentProps<typeof actual.Button>) => {
    const buttonProps = { ...props, 'data-variant': props.variant ?? 'primary' } as React.ComponentProps<typeof actual.Button>;
    return React.createElement(actual.Button, buttonProps);
  };
  return { ...actual, Button: ButtonWithVariant };
});

const h = vi.hoisted(() => ({
  role: 'Finance' as string,
  effectiveRole: null as string | null,
  userId: 'u-fin',
  connected: true,
  revenueMode: null as 'native' | 'erp' | null,
  tmInvoice: vi.fn(),
  loadItems: vi.fn(),
  routeReady: true,
  billing: { data: null as unknown, isPending: false, isError: false, refetch: vi.fn() },
  boq: [] as unknown[],
  claims: [] as unknown[],
  claimsState: { isPending: false, isError: false, refetch: vi.fn() },
  allocState: { isPending: false, isError: false, refetch: vi.fn() },
  docs: [] as unknown[],
  docsState: { isPending: false, isError: false, refetch: vi.fn() },
  ordersState: { isPending: false, isError: false, refetch: vi.fn() },
  tmClaims: { data: { rows: [] as unknown[], truncated: false }, isPending: false, isError: false, refetch: vi.fn() },
  tmMutation: vi.fn().mockResolvedValue(undefined),
  m: {} as Record<string, { mutateAsync: ReturnType<typeof vi.fn>; isPending: boolean }>,
}));
// #1457: the invoice-overdue figure is bounded by the org's business day (fixed here per test file).
vi.mock('@/src/hooks/useFxOrgDay', () => ({
  useFxOrgDay: () => ({ day: '2026-06-01', isPending: false, isError: false, retry: vi.fn() }),
}));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.role, effectiveRole: h.effectiveRole ?? h.role }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: h.userId, org_id: 'org-1' } }) }));
vi.mock('@/src/auth/usePermission', async () => {
  const { can } = await vi.importActual<typeof import('@/src/auth/policy')>('@/src/auth/policy');
  return { usePermission: () => (action: never, entity: never, ctx: Record<string, unknown> = {}) => can(action, entity, { realRole: h.role, ...ctx } as never) };
});
vi.mock('@/src/hooks/useErpItemOptions', () => ({ useErpItemOptions: () => ({ connected: h.connected, loadOptions: h.loadItems }) }));
// Who raises invoices follows the ERP connection unless a test pins it.
vi.mock('@/src/hooks/useRevenueMode', () => ({ useRevenueMode: () => h.revenueMode ?? (h.connected ? 'erp' : 'native') }));
vi.mock('@/src/hooks/useOwnershipCacheSync', () => ({ useRevenueRouteReady: () => h.routeReady }));
vi.mock('@/src/hooks/useProgressBilling', () => ({
  useProjectBilling: () => h.billing,
  useBoqItems: () => ({ data: h.boq, isPending: false, isError: false, refetch: vi.fn() }),
  useProjectClaims: () => ({ data: h.claimsState.isPending || h.claimsState.isError ? undefined : h.claims, ...h.claimsState }),
  useProgressBillingMutations: () => h.m,
}));
vi.mock('@/src/hooks/useWorkOrders', () => ({ useProjectWorkOrders: () => ({ data: h.ordersState.isPending || h.ordersState.isError ? undefined : [], ...h.ordersState }) }));
vi.mock('@/src/hooks/useWorkOrderAcceptances', () => ({
  useWorkOrderLines: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useProjectWorkOrderLines: () => ({ data: h.allocState.isPending || h.allocState.isError ? undefined : [], ...h.allocState }),
}));
vi.mock('@/src/hooks/useDocuments', () => ({ useDocuments: () => ({ data: h.docs, ...h.docsState }) }));
vi.mock('@/src/hooks/useTasks', () => ({ useAssignableProfiles: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/hooks/useEquipment', () => ({ useEquipmentAssetPages: () => ({ data: { pages: [{ rows: [] }] }, isPending: false, isError: false, hasNextPage: false, isFetchingNextPage: false, fetchNextPage: vi.fn(), refetch: vi.fn(), total: 0 }) }));
vi.mock('@/src/hooks/useTimeAndMaterials', () => ({
  useTmRateLines: () => ({ data: { rows: [], truncated: false }, isPending: false, isError: false, refetch: vi.fn() }),
  useTmRateAssignees: () => ({ data: { rows: [], truncated: false }, isPending: false, isError: false, refetch: vi.fn() }),
  useTmClaims: () => h.tmClaims,
  useTmClaimPreview: () => ({ data: { rows: [], truncated: false }, isPending: false, isError: false, refetch: vi.fn() }),
  useTmClaimSources: () => ({ data: { rows: [], truncated: false, totalCount: 0 }, isPending: false, isError: false, refetch: vi.fn() }),
  useDeselectTmSource: () => ({ mutateAsync: h.tmMutation, isPending: false }),
  useSaveTmRateLine: () => ({ mutateAsync: h.tmMutation, isPending: false }),
  useSetTmRateAssignee: () => ({ mutateAsync: h.tmMutation, isPending: false }),
  useEndTmRateAssignee: () => ({ mutateAsync: h.tmMutation, isPending: false }),
  useEndTmRateLine: () => ({ mutateAsync: h.tmMutation, isPending: false }),
  useAssembleTmClaim: () => ({ mutateAsync: h.tmMutation, isPending: false }),
  usePrepareTmSignoff: () => ({ mutateAsync: h.tmMutation, isPending: false }),
  useWithdrawTmSignoff: () => ({ mutateAsync: h.tmMutation, isPending: false }),
  useConfirmTmSignoff: () => ({ mutateAsync: h.tmMutation, isPending: false }),
  useInvoiceTmClaimNative: () => ({ mutateAsync: h.tmInvoice, isPending: false }),
}));
import BillingTab from '../BillingTab';

const FACTS = {
  currency: 'IDR', contractNet: 1_000_000, workBilled: 0, dpBilled: 0, dpRecovered: 0, notSubmitted: 0,
  assessment: null, claimedByBoqItem: {}, assessedByBoqItem: {}, earnedValue: 0, contractLines: [],
};
const BOQ = [{ id: 'b1', org_id: 'o', project_id: 'p1', earning_basis: 'unit_rate', line_no: null, import_key: null, item_code: 'SURVEY', description: 'Route survey', unit: 'km', quantity: 10, rate: 50000, created_at: '' }];

beforeEach(() => {
  vi.clearAllMocks();
  h.role = 'Finance'; h.effectiveRole = null; h.userId = 'u-fin'; h.connected = true; h.routeReady = false;
  h.billing = { data: FACTS, isPending: false, isError: false, refetch: vi.fn() };
  h.boq = BOQ; h.claims = []; h.docs = [];
  h.claimsState = { isPending: false, isError: false, refetch: vi.fn() };
  h.allocState = { isPending: false, isError: false, refetch: vi.fn() };
  h.ordersState = { isPending: false, isError: false, refetch: vi.fn() };
  h.docsState = { isPending: false, isError: false, refetch: vi.fn() };
  h.m = Object.fromEntries(['createBoq', 'updateBoq', 'deleteBoq', 'recordAssessment', 'createClaim', 'attachEvidence', 'withdrawClaim', 'raiseInvoice']
    .map((name) => [name, { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false }]));
});

const tree = () => <MemoryRouter><ToastProvider><BillingTab projectId="p1" currency="IDR" clientId="c1" projectManagerId="pm-1" /></ToastProvider></MemoryRouter>;

describe('AC-NBR-008 New claim settles per source', () => {
  it('(P) customer orders pending: the button is enabled and the dialog marks only that source', async () => {
    h.ordersState = { isPending: true, isError: false, refetch: vi.fn() };
    render(tree());
    const button = screen.getByRole('button', { name: 'New claim' });
    expect(button).toBeEnabled();
    await userEvent.click(button);
    const dialog = screen.getByRole('dialog', { name: 'New billing claim' });
    expect(within(dialog).getByText('Loading customer orders…')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Create claim' })).toBeDisabled();
  });

  it('(F) billing figures failed: the button is enabled, the dialog shows that source error and keeps submit off', async () => {
    h.billing = { data: undefined, isPending: false, isError: true, refetch: vi.fn() };
    render(tree());
    await userEvent.click(screen.getByRole('button', { name: 'New claim' }));
    const dialog = screen.getByRole('dialog', { name: 'New billing claim' });
    expect(within(dialog).getByText("Couldn't load billing figures")).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Create claim' })).toBeDisabled();
  });

  it('(F) customer orders failed: the button is enabled and the dialog offers that source retry', async () => {
    h.ordersState = { isPending: false, isError: true, refetch: vi.fn() };
    render(tree());
    await userEvent.click(screen.getByRole('button', { name: 'New claim' }));
    const dialog = screen.getByRole('dialog', { name: 'New billing claim' });
    expect(within(dialog).getByText("Couldn't load customer orders")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: /retry/i }));
    expect(h.ordersState.refetch).toHaveBeenCalled();
  });

  it('AC-NBR-008 order allocations decide scope: the button holds its slot disabled until they answer', () => {
    h.allocState = { isPending: true, isError: false, refetch: vi.fn() };
    const view = render(tree());
    expect(screen.getByRole('button', { name: 'New claim' })).toBeDisabled();
    h.allocState = { isPending: false, isError: false, refetch: vi.fn() };
    view.rerender(tree());
    expect(screen.getByRole('button', { name: 'New claim' })).toBeEnabled();
  });

  it('AC-NBR-008 existing claims decide the kinds offered: the button waits for them', () => {
    h.claimsState = { isPending: true, isError: false, refetch: vi.fn() };
    render(tree());
    expect(screen.getByRole('button', { name: 'New claim' })).toBeDisabled();
  });

  it('AC-NBR-090 a viewer who cannot bill sees no button, pending or not', () => {
    h.role = 'Engineer';
    h.allocState = { isPending: true, isError: false, refetch: vi.fn() };
    render(tree());
    expect(screen.queryByRole('button', { name: 'New claim' })).toBeNull();
  });

  it('AC-NBR-091 a failed allocations read keeps the button off (no guessed scope) and offers retry', () => {
    h.allocState = { isPending: false, isError: true, refetch: vi.fn() };
    render(tree());
    expect(screen.queryByRole('button', { name: 'New claim' })).toBeNull();
    expect(screen.getByText("Couldn't load order allocations")).toBeInTheDocument();
  });
});
