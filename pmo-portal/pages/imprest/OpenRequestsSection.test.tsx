import { setPricesHidden } from '@/src/lib/priceReadPath';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { MemoryRouter } from 'react-router';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createInstance } from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import idImprest from '../../public/locales/id/imprest.json';

const h = vi.hoisted(() => ({ q: null as unknown, can: true }));
vi.mock('@/src/hooks/useImprest', () => ({ useImprestOpenRequests: () => h.q }));
vi.mock('@/src/auth/usePermission', () => ({ CanWrite: ({ children }: { children: React.ReactNode }) => (h.can ? <>{children}</> : null) }));

import { OpenRequestsSection } from './OpenRequestsSection';

const base = { currency: 'IDR', work_order_id: null, wo_number: null, wo_title: null, line_id: null, line_name: null, line_quantity: null, line_amount: null };
const rows = [
  { ...base, procurement_id: 'p1', pr_number: 'PR-1', title: 'Site cement', status: 'Requested', budget_category: 'Materials', request_total: 500000,
    work_order_id: 'w1', wo_number: 'WO-A', wo_title: 'Pump house', line_id: 'i1', line_name: 'Cement', line_quantity: 10, line_amount: 300000 },
  { ...base, procurement_id: 'p1', pr_number: 'PR-1', title: 'Site cement', status: 'Requested', budget_category: 'Materials', request_total: 500000,
    work_order_id: 'w1', wo_number: 'WO-A', wo_title: 'Pump house', line_id: 'i2', line_name: 'Sand', line_quantity: 5, line_amount: 200000 },
  { ...base, procurement_id: 'p2', pr_number: 'PR-2', title: 'Scaffold hire', status: 'Approved', budget_category: 'Equipment', request_total: 300000 },
  { ...base, procurement_id: 'p3', pr_number: 'PR-3', title: 'Second cement', status: 'Quote Selected', budget_category: 'Materials', request_total: 100000 },
];
const ok = (data: unknown) => ({ data, isPending: false, isError: false, refetch: vi.fn() });
const tree = (onStartPlan = vi.fn()) => <MemoryRouter><OpenRequestsSection floatId="f1" currency="IDR" onStartPlan={onStartPlan} /></MemoryRouter>;

describe('AC-CAE-002 open purchase requests beside the plan', () => {
  beforeEach(() => {
    setPricesHidden(false);
    h.can = true;
    h.q = ok({ rows, truncated: false });
  });
  it('AC-CAE-002 lists the requests by purpose and work order, with their lines and totals', () => {
    render(tree());
    const materials = screen.getByTestId('open-purpose-Materials');
    expect(within(materials).getByText('WO-A Pump house')).toBeInTheDocument();
    expect(within(materials).getByText('No work order')).toBeInTheDocument();
    expect(within(materials).getByText('PR-1')).toHaveAttribute('href', '/procurement/p1');
    expect(within(materials).getByText(/Cement × 10/)).toBeInTheDocument();
    expect(within(materials).getByText(/Sand × 5/)).toBeInTheDocument();
    expect(screen.getByTestId('open-purpose-Equipment')).toHaveTextContent('Scaffold hire');
  });
  it('AC-CAE-008 the empty state says what is missing and who raises a request', () => {
    h.q = ok({ rows: [], truncated: false });
    render(tree());
    expect(screen.getByTestId('open-requests-empty')).toHaveTextContent(/No open purchase requests.*Project members raise one under Procurement/);
    expect(screen.queryByRole('button', { name: 'Start the plan from these' })).toBeNull();
  });
  it('AC-CAE-003 Start the plan from these hands the editor one line per purpose, summed', async () => {
    const onStartPlan = vi.fn();
    render(tree(onStartPlan));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Start the plan from these' }));
    expect(onStartPlan).toHaveBeenCalledWith([{ category: 'Equipment', amount: 300000 }, { category: 'Materials', amount: 600000 }]);
  });
  it('AC-CAE-003 a person who cannot create plans sees the list and no action', () => {
    h.can = false;
    render(tree());
    expect(screen.getByTestId('open-purpose-Materials')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start the plan from these' })).toBeNull();
  });
  it('AC-CAE-003 with hidden prices the action is disabled and says why', () => {
    setPricesHidden(true);
    h.q = ok({ rows: rows.map((r) => ({ ...r, request_total: null, line_amount: null })), truncated: false });
    render(tree());
    expect(screen.getByRole('button', { name: 'Start the plan from these' })).toBeDisabled();
    expect(screen.getByTestId('open-requests-reason')).toHaveTextContent('— Prices are hidden from requesters.');
    expect(screen.getByTestId('open-requests-reason')).toHaveTextContent('Add the lines yourself in the plan.');
  });
  it('AC-CAE-003 a request in another currency or with no purpose is left out of the plan and counted', async () => {
    const onStartPlan = vi.fn();
    h.q = ok({ rows: [...rows, { ...base, procurement_id: 'p4', pr_number: 'PR-4', title: 'Imported', status: 'Requested', budget_category: 'Materials', request_total: 5, currency: 'USD' },
      { ...base, procurement_id: 'p5', pr_number: 'PR-5', title: 'No purpose', status: 'Requested', budget_category: null, request_total: 7 }], truncated: false });
    render(tree(onStartPlan));
    expect(screen.getByTestId('open-requests-skipped')).toHaveTextContent('2 request(s)');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Start the plan from these' }));
    expect(onStartPlan).toHaveBeenCalledWith([{ category: 'Equipment', amount: 300000 }, { category: 'Materials', amount: 600000 }]);
  });
  it('AC-CAE-002 an error is said and retried; a truncated read says so', () => {
    h.q = { data: undefined, isPending: false, isError: true, refetch: vi.fn() };
    const { unmount } = render(tree());
    expect(screen.getByText("Couldn't load the open purchase requests")).toBeInTheDocument();
    unmount();
    h.q = ok({ rows, truncated: true });
    render(tree());
    expect(screen.getByRole('status')).toHaveTextContent('Showing the first 500 lines only.');
  });
  it('AC-CAE-009 reads in Bahasa Indonesia', async () => {
    const id = createInstance();
    await id.use(initReactI18next).init({ lng: 'id', fallbackLng: 'en', resources: { id: { imprest: idImprest } }, ns: ['imprest'], defaultNS: 'imprest', interpolation: { escapeValue: false } });
    render(<I18nextProvider i18n={id}>{tree()}</I18nextProvider>);
    expect(screen.getByText('Permintaan pembelian terbuka')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mulai rencana dari daftar ini' })).toBeInTheDocument();
    expect(screen.getAllByText('Tanpa work order').length).toBeGreaterThan(0);
  });
});
