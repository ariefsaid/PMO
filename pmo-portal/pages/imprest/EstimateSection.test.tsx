import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createInstance } from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import idImprest from '../../public/locales/id/imprest.json';
import { formatCurrency } from '@/src/lib/format';

const h = vi.hoisted(() => ({ est: null as unknown, plans: null as unknown }));
vi.mock('@/src/hooks/useImprest', () => ({ useImprestEstimate: () => h.est, useImprestPlans: () => h.plans }));
vi.mock('@/src/hooks/useWorkOrders', () => ({
  useProjectWorkOrders: () => ({ data: [{ id: 'w1', wo_number: 'WO-1', title: 'Pump house', status: 'Issued' }], isPending: false }),
}));

import { EstimateSection } from './EstimateSection';

const ok = (data: unknown) => ({ data, isPending: false, isError: false, refetch: vi.fn() });
const row = (over: Record<string, unknown>) => ({ month: '2026-11-01', plan_status: 'Approved', budget_category: 'Materials', work_order_id: null, planned: 40000, drawn: 10000, still_to_spend: 30000, ...over });
const total = { planned: 200000, drawn: 33000, still_to_spend: 160000, cash_book: 87000, in_flight: 0, advance_needed: 73000 };
const money = (n: number) => formatCurrency(n, 'IDR');
const tree = (over: Partial<React.ComponentProps<typeof EstimateSection>> = {}) =>
  <EstimateSection floatId="f1" projectId="p1" currency="IDR" currentMonth="2026-11-01" canRequestTopUp onRequestTopUp={vi.fn()} {...over} />;

describe('AC-CAE-012 the cash estimate', () => {
  beforeEach(() => {
    h.plans = ok({ rows: [{ id: 'pl1', month: '2026-12-01', status: 'Draft' }], truncated: false });
    h.est = ok({
      rows: [
        row({ work_order_id: 'w1', planned: 60000, drawn: 20000, still_to_spend: 40000 }),
        row({}),
        row({ month: '2026-12-01', plan_status: 'Draft', budget_category: 'Vehicle', planned: 40000, drawn: 0, still_to_spend: 40000 }),
        row({ month: '2027-01-01', plan_status: 'none', budget_category: null, planned: 0, drawn: 0, still_to_spend: 0 }),
      ],
      total,
    });
  });
  it('AC-CAE-012 shows the advance needed with how it is made up, and the rows by work order and purpose', () => {
    render(tree());
    const adv = screen.getByTestId('estimate-advance');
    expect(within(adv).getByText('Advance needed')).toBeInTheDocument();
    expect(within(adv).getByText(money(73000))).toBeInTheDocument();
    expect(within(adv).getByText(new RegExp(`Still to spend ${money(160000).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))).toBeInTheDocument();
    expect(screen.getByText('WO-1 Pump house')).toBeInTheDocument();
    expect(screen.getByText('Not assigned to a work order')).toBeInTheDocument();
  });
  it('AC-CAE-011 a month with no plan says so and who adds one', () => {
    render(tree());
    const jan = screen.getByTestId('estimate-month-2027-01-01');
    expect(within(jan).getByText(/No plan for .*A project manager, Finance or an Admin adds one under Plans\./)).toBeInTheDocument();
  });
  it('AC-CAE-012 a Draft month is marked not yet approved', () => {
    render(tree());
    expect(within(screen.getByTestId('estimate-month-2026-12-01')).getByText('Not yet approved')).toBeInTheDocument();
    expect(within(screen.getByTestId('estimate-month-2026-11-01')).queryByText('Not yet approved')).toBeNull();
  });
  it('AC-CAE-012 Request this advance opens the existing request, nothing is sent by the estimate', async () => {
    const onRequestTopUp = vi.fn();
    render(tree({ onRequestTopUp }));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Request this advance' }));
    expect(onRequestTopUp).toHaveBeenCalledTimes(1);
  });
  it('AC-CAE-012 a viewer who cannot request a top-up is told who does, instead of a dead button', () => {
    render(tree({ canRequestTopUp: false }));
    expect(screen.queryByRole('button', { name: 'Request this advance' })).toBeNull();
    expect(screen.getByTestId('estimate-topup-note')).toHaveTextContent('requested by the custodian');
  });
  it('AC-CAE-012 an error is said and can be retried; nothing is invented', () => {
    h.est = { data: undefined, isPending: false, isError: true, refetch: vi.fn() };
    render(tree());
    expect(screen.getByText("Couldn't load the estimate")).toBeInTheDocument();
    expect(screen.queryByTestId('estimate-advance')).toBeNull();
  });
  it('AC-CAE-012 reads in Bahasa Indonesia', async () => {
    const id = createInstance();
    await id.use(initReactI18next).init({ lng: 'id', fallbackLng: 'en', resources: { id: { imprest: idImprest } }, ns: ['imprest'], defaultNS: 'imprest', interpolation: { escapeValue: false } });
    render(<I18nextProvider i18n={id}>{tree()}</I18nextProvider>);
    expect(screen.getByText('Perkiraan kas')).toBeInTheDocument();
    expect(screen.getByText('Uang muka dibutuhkan')).toBeInTheDocument();
    expect(within(screen.getByTestId('estimate-month-2027-01-01')).getByText(/Belum ada rencana untuk/)).toBeInTheDocument();
    expect(screen.getByText('Belum disetujui')).toBeInTheDocument();
  });
});
