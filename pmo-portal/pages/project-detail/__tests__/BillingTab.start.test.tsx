import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { ToastProvider } from '@/src/components/ui';

const h = vi.hoisted(() => ({
  role: 'Finance' as string,
  routeReady: true,
  billing: { data: null as unknown, isPending: false, isError: false, refetch: vi.fn() },
  boq: [] as unknown[],
  claims: [] as unknown[],
  workOrders: [] as unknown[],
  docs: [] as unknown[],
  mutations: {} as Record<string, { mutateAsync: ReturnType<typeof vi.fn>; isPending: boolean }>,
}));

vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'finance-1', org_id: 'org-synthetic' } }) }));
vi.mock('@/src/auth/usePermission', async () => {
  const { can } = await vi.importActual<typeof import('@/src/auth/policy')>('@/src/auth/policy');
  return {
    usePermission: () => (action: never, entity: never, ctx: Record<string, unknown> = {}) =>
      can(action, entity, { realRole: h.role, ...ctx } as never),
  };
});
vi.mock('@/src/hooks/useErpItemOptions', () => ({ useErpItemOptions: () => ({ connected: true, loadOptions: vi.fn() }) }));
vi.mock('@/src/hooks/useRevenueMode', () => ({ useRevenueMode: () => 'erp' }));
vi.mock('@/src/hooks/useOwnershipCacheSync', () => ({ useRevenueRouteReady: () => h.routeReady }));
vi.mock('@/src/hooks/useProgressBilling', () => ({
  useProjectBilling: () => h.billing,
  useBoqItems: () => ({ data: h.boq, isPending: false, isError: false, refetch: vi.fn() }),
  useProjectClaims: () => ({ data: h.claims, isPending: false, isError: false, refetch: vi.fn() }),
  useProgressBillingMutations: () => h.mutations,
}));
vi.mock('@/src/hooks/useWorkOrders', () => ({ useProjectWorkOrders: () => ({ data: h.workOrders, isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/hooks/useDocuments', () => ({ useDocuments: () => ({ data: h.docs, isPending: false, isError: false }) }));

import BillingTab from '../tabs/BillingTab';
import { FinanceI18nTestProvider } from '../../__tests__/financeI18nTestProvider';
import { financeTestI18n } from '../../__tests__/financeI18nTestInstance';

beforeEach(() => {
  h.role = 'Finance';
  h.routeReady = true;
  h.billing = { data: null, isPending: false, isError: false, refetch: vi.fn() };
  h.boq = [];
  h.claims = [];
  h.workOrders = [];
  h.docs = [];
  h.mutations = Object.fromEntries(
    ['createBoq', 'updateBoq', 'deleteBoq', 'recordAssessment', 'createClaim', 'attachEvidence', 'withdrawClaim', 'raiseInvoice']
      .map((name) => [name, { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false }]),
  );
});

const renderTab = (role: string = 'Finance', clientId: string | null = 'client-synthetic') => {
  h.role = role;
  return render(
    <MemoryRouter initialEntries={['/projects/project-synthetic/billing']}>
      <ToastProvider>
        <BillingTab projectId="project-synthetic" currency="IDR" clientId={clientId} projectManagerId="pm-synthetic" />
        <RouteProbe />
      </ToastProvider>
    </MemoryRouter>,
  );
};

const RouteProbe: React.FC = () => {
  const location = useLocation();
  return <output data-testid="route">{`${location.pathname}${location.search}`}</output>;
};

describe('AC-S15-001 project billing start', () => {
  it('lets Finance choose a billing method from the known project', async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(screen.getByRole('button', { name: 'Start invoice' }));

    expect(screen.getByRole('dialog', { name: 'Start invoice' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Contract invoice/ })).toHaveAttribute(
      'href',
      '/sales-invoices?create=1&project=project-synthetic',
    );
    expect(screen.getByRole('button', { name: /Customer work order/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Quantity or progress claim/ })).toBeInTheDocument();
  });

  it('opens the existing contract draft route with the same project and closes the method selector', async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(screen.getByRole('button', { name: 'Start invoice' }));
    await user.click(screen.getByRole('link', { name: /Contract invoice/ }));

    expect(screen.getByTestId('route')).toHaveTextContent('/sales-invoices?create=1&project=project-synthetic');
    expect(screen.queryByRole('dialog', { name: 'Start invoice' })).not.toBeInTheDocument();
  });

  it('opens the existing work-order and quantity-claim workflows from the selected methods', async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(screen.getByRole('button', { name: 'Start invoice' }));
    await user.click(screen.getByRole('button', { name: /Customer work order/ }));
    expect(screen.getByTestId('route')).toHaveTextContent('/projects/project-synthetic/work-orders');
    expect(screen.queryByRole('dialog', { name: 'Start invoice' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Start invoice' }));
    await user.click(screen.getByRole('button', { name: /Quantity or progress claim/ }));
    expect(await screen.findByRole('dialog', { name: 'New billing claim' })).toBeInTheDocument();
  });

  it('does not offer invoice creation to an Engineer', () => {
    renderTab('Engineer');

    expect(screen.queryByRole('button', { name: 'Start invoice' })).not.toBeInTheDocument();
  });

  it('does not start billing without a resolved revenue route or an authorized project customer', () => {
    h.routeReady = false;
    const first = renderTab();
    expect(screen.queryByRole('button', { name: 'Start invoice' })).not.toBeInTheDocument();
    first.unmount();

    h.routeReady = true;
    renderTab('Finance', null);
    expect(screen.queryByRole('button', { name: 'Start invoice' })).not.toBeInTheDocument();
  });

  it('AC-L10N-B01 renders the project billing methods in Bahasa', async () => {
    await financeTestI18n.changeLanguage('id');
    try {
      const user = userEvent.setup();
      render(
        <FinanceI18nTestProvider>
          <MemoryRouter initialEntries={['/projects/project-synthetic/billing']}>
            <ToastProvider>
              <BillingTab projectId="project-synthetic" currency="IDR" clientId="client-synthetic" projectManagerId="pm-synthetic" />
            </ToastProvider>
          </MemoryRouter>
        </FinanceI18nTestProvider>,
      );

      await user.click(screen.getByRole('button', { name: 'Mulai membuat faktur' }));
      expect(screen.getByRole('dialog', { name: 'Mulai membuat faktur' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /Faktur kontrak/ })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Work Order pelanggan/ })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Klaim kuantitas atau progres/ })).toBeInTheDocument();
    } finally {
      await financeTestI18n.changeLanguage('en');
    }
  });
});
