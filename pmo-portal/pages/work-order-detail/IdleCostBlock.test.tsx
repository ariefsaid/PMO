import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { formatTableMoney } from '@/src/lib/format';
import { setActiveLocale } from '@/src/lib/locale/activeLocale';
import userEvent from '@testing-library/user-event';

/** #2673 (AC-IHC-001, AC-IHC-010): idle block shows only with rows, apart from direct cost. */
const h = vi.hoisted(() => ({ rows: [] as unknown[], error: false, retry: vi.fn() }));
vi.mock('@/src/auth/AuthContext', async () => {
  const { createContext } = await import('react');
  return { AuthContext: createContext<unknown>({ currentUser: { org_id: 'o1' } }) };
});
vi.mock('@/src/hooks/useIdleCost', () => ({ useProjectIdleCost: () => ({ data: h.error ? undefined : h.rows, isError: h.error, refetch: h.retry }) }));
import { IdleCostBlock } from './IdleCostBlock';

const row = (o: object) => ({ workOrderId: 'A', reasonId: 'r1', reasonLabel: 'Rain', minutes: 60, hours: '1.00', hourlyCost: '62500.00', amount: '62500.00', currency: 'IDR', reason: 'counted', peopleAmount: null, equipmentAmount: null, headcountHours: null, ...o });
beforeEach(() => { setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'UTC' }); h.rows = []; });

describe('idle cost block', () => {
  it('offers retry for unavailable idle costs and keeps successful empty output', async () => {
    h.error = true;
    try {
      const view = render(<IdleCostBlock projectId="p1" workOrderId="A" testId="idle" />);
      await userEvent.click(screen.getByRole('button', { name: /retry|try again/i }));
      expect(h.retry).toHaveBeenCalled();
      h.error = false;
      view.rerender(<IdleCostBlock projectId="p1" workOrderId="A" testId="idle" />);
      expect(view.container).toBeEmptyDOMElement();
    } finally { h.error = false; }
  });
  it('AC-IHC-001 renders nothing when the read returns no row', () => {
    const { container } = render(<IdleCostBlock projectId="p1" workOrderId="A" testId="idle" />);
    expect(container).toBeEmptyDOMElement();
  });
  it('shows nothing without a project', () => {
    h.rows = [row({})];
    const { container } = render(<IdleCostBlock projectId={undefined} workOrderId="A" testId="idle" />);
    expect(container).toBeEmptyDOMElement();
  });
  it('AC-IHC-010 lists each reason with hours and cost and a total, and says it is not added again', () => {
    h.rows = [row({}), row({ reasonId: 'r2', reasonLabel: 'Waiting', hours: '0.50', amount: '31250.00' }), row({ workOrderId: 'B', reasonId: 'r3', reasonLabel: 'Other WO' })];
    render(<IdleCostBlock projectId="p1" workOrderId="A" testId="idle" />);
    const rain = screen.getByTestId('idle-r1');
    expect(within(rain).getByText('Rain')).toBeVisible();
    expect(rain.textContent).toContain(formatTableMoney('62500.00', 'IDR'));
    expect(screen.queryByText('Other WO')).toBeNull();
    expect(screen.getByTestId('idle-total').textContent).toContain(formatTableMoney('93750.00', 'IDR'));
    expect(screen.getByText(/not added again/)).toBeVisible();
  });
  it('AC-IHC-007 a reason with no rate shows hours and no money', () => {
    h.rows = [row({ amount: null, hourlyCost: null, reason: 'no-rate' })];
    render(<IdleCostBlock projectId="p1" workOrderId="A" testId="idle" />);
    expect(within(screen.getByTestId('idle-r1')).getByText('No rate')).toBeVisible();
  });
  it('AC-IWR-011 the default scope shows no People or Equipment column', () => {
    h.rows = [row({})];
    render(<IdleCostBlock projectId="p1" workOrderId="A" testId="idle" />);
    expect(screen.queryByRole('columnheader', { name: 'People' })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'Equipment' })).toBeNull();
  });
  it('AC-IWR-011 people and equipment show as columns beside one total, apart from direct cost', () => {
    h.rows = [
      row({ amount: '331250.00', peopleAmount: '281250.00', equipmentAmount: '50000.00', headcountHours: '4.50' }),
      row({ reasonId: 'r2', reasonLabel: 'Waiting', amount: '618750.00', peopleAmount: '468750.00', equipmentAmount: '150000.00', headcountHours: '7.50' }),
    ];
    render(<IdleCostBlock projectId="p1" workOrderId="A" testId="idle" />);
    expect(screen.getByRole('columnheader', { name: 'People' })).toBeVisible();
    expect(screen.getByRole('columnheader', { name: 'Equipment' })).toBeVisible();
    const rain = screen.getByTestId('idle-r1').textContent ?? '';
    expect(rain).toContain(formatTableMoney('281250.00', 'IDR'));
    expect(rain).toContain(formatTableMoney('50000.00', 'IDR'));
    expect(rain).toContain(formatTableMoney('331250.00', 'IDR'));
    const total = screen.getByTestId('idle-total').textContent ?? '';
    expect(total).toContain(formatTableMoney('950000.00', 'IDR'));
    expect(total).toContain(formatTableMoney('750000.00', 'IDR'));
    expect(total).toContain(formatTableMoney('200000.00', 'IDR'));
    expect(screen.getByText(/not added again/)).toBeVisible();
  });
  it('AC-IWR-011 a reason whose people have no rate says so and still shows its equipment', () => {
    h.rows = [row({ amount: '50000.00', reason: 'no-rate', hourlyCost: null, peopleAmount: null, equipmentAmount: '50000.00', headcountHours: '3.00' })];
    render(<IdleCostBlock projectId="p1" workOrderId="A" testId="idle" />);
    const r = screen.getByTestId('idle-r1');
    expect(within(r).getByText('No rate')).toBeVisible();
    expect(r.textContent).toContain(formatTableMoney('50000.00', 'IDR'));
  });
});
