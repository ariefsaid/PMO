import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import type { WorkOrderRow } from '@/src/lib/db/workOrders';
import type { WorkOrderBillingRow } from '@/src/lib/db/workOrderBilling';

// Same harness as BillingMilestonesBlock.test.tsx — the real block; its reads are faked.
type Q = { data: unknown[] | undefined; isPending: boolean; isError: boolean; refetch: ReturnType<typeof vi.fn> };
const q = (data: unknown[] | undefined = []): Q => ({ data, isPending: false, isError: false, refetch: vi.fn() });
const h = vi.hoisted(() => ({
  list: {} as Q, billing: {} as Q, age: {} as Q, role: 'Finance' as string,
}));
vi.mock('@/src/hooks/useWorkOrders', () => ({ useProjectWorkOrders: () => h.list }));
vi.mock('@/src/hooks/useWorkOrderBilling', () => ({
  useWorkOrderBilling: () => h.billing,
  useWorkOrderAcceptanceAge: () => h.age,
}));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.role, effectiveRole: h.role }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u-1', org_id: 'org-1' }, role: h.role }) }));

import { BillingMilestonesBlock } from '../BillingMilestonesBlock';
import { FinanceI18nTestProvider } from '@/test/financeI18nTestProvider';

const wo = (over: Partial<WorkOrderRow> = {}): WorkOrderRow => ({
  id: 'wo-1', org_id: 'org-1', project_id: 'p1', wo_number: 'WO-1', client_po_number: null, title: 'Phase 1 fabrication',
  description: null, status: 'Issued', order_value: 1000, currency: 'USD', tax_treatment: 'exclusive', tax_amount: 0,
  tax_rate: null, tax_template: null, tax_base_numerator: 1, tax_base_denominator: 1, order_date: null,
  start_date: null, end_date: null, order_value_set_by: null, order_value_set_at: null,
  issued_by: null, issued_at: null, over_commit_ack_by: null, over_commit_ack_at: null,
  closed_at: null, cancelled_at: null, created_at: '2026-08-01T00:00:00Z', ...over,
}) as WorkOrderRow;
const bill = (over: Partial<WorkOrderBillingRow> = {}): WorkOrderBillingRow => ({
  workOrderId: 'wo-1', projectId: 'p1', status: 'Issued', currency: 'USD', orderNet: 1000, invoiced: 0, pending: 0,
  paid: 0, remaining: 1000, figuresComplete: true, lineCount: 0, unpaidCount: 0, ...over,
});

const RouteProbe = () => <output data-testid="route-probe">{useLocation().pathname + useLocation().search}</output>;

const renderBlock = (role = 'Finance') => {
  h.role = role;
  return render(
    <MemoryRouter initialEntries={['/projects/p1/overview']}>
      <FinanceI18nTestProvider>
        <Routes>
          <Route path="/projects/p1/overview" element={<BillingMilestonesBlock projectId="p1" />} />
          <Route path="/projects/p1/contract" element={<RouteProbe />} />
        </Routes>
      </FinanceI18nTestProvider>
    </MemoryRouter>,
  );
};

beforeEach(() => {
  h.list = q([wo()]);
  h.billing = q([bill()]);
  h.age = q([]);
});

describe('BillingMilestonesBlock floor', () => {
  it('floor: Invoice this opens the matching work order in the invoice flow on Contract & billing', async () => {
    renderBlock();
    expect(screen.getByRole('link', { name: 'Invoice WO-1' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('link', { name: 'Invoice WO-1' }));
    expect(screen.getByTestId('route-probe')).toHaveTextContent('/projects/p1/contract?wo=wo-1&invoice=1');
  });
});
