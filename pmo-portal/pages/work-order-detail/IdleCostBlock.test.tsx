import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { formatExactMoney } from '@/src/lib/format';
import { setActiveLocale } from '@/src/lib/locale/activeLocale';

/** #2673 (AC-IHC-001, AC-IHC-010): idle block shows only with rows, apart from direct cost. */
const h = vi.hoisted(() => ({ rows: [] as unknown[] }));
vi.mock('@/src/auth/AuthContext', async () => {
  const { createContext } = await import('react');
  return { AuthContext: createContext<unknown>({ currentUser: { org_id: 'o1' } }) };
});
vi.mock('@/src/hooks/useIdleCost', () => ({ useProjectIdleCost: () => ({ data: h.rows }) }));
import { IdleCostBlock } from './IdleCostBlock';

const row = (o: object) => ({ workOrderId: 'A', reasonId: 'r1', reasonLabel: 'Rain', minutes: 60, hours: '1.00', hourlyCost: '62500.00', amount: '62500.00', currency: 'IDR', reason: 'counted', ...o });
beforeEach(() => { setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'UTC' }); h.rows = []; });

describe('idle cost block', () => {
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
    expect(rain.textContent).toContain(formatExactMoney('62500.00', 'IDR', 'en-US'));
    expect(screen.queryByText('Other WO')).toBeNull();
    expect(screen.getByTestId('idle-total').textContent).toContain(formatExactMoney('93750.00', 'IDR', 'en-US'));
    expect(screen.getByText(/not added again/)).toBeVisible();
  });
  it('AC-IHC-007 a reason with no rate shows hours and no money', () => {
    h.rows = [row({ amount: null, hourlyCost: null, reason: 'no-rate' })];
    render(<IdleCostBlock projectId="p1" workOrderId="A" testId="idle" />);
    expect(within(screen.getByTestId('idle-r1')).getByText('No rate')).toBeVisible();
  });
});
