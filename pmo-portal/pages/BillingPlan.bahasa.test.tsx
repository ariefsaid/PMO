import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BahasaProvider } from '@/test/bahasa';
import type { PlanCandidate } from '@/src/lib/billingPlan';

const rows: PlanCandidate[] = [{
  key: 'a', kind: 'line', projectId: 'p1', projectName: 'Proyek Utara', currency: 'IDR', workOrderId: 'w1', woNumber: 'WO-7', boqItemId: 'b1', itemCode: 'I-1',
  description: 'Pekerjaan', unit: 'm', earningBasis: 'unit_rate', contractQuantity: 10, acceptedQuantity: 12, claimedQuantity: 5, unclaimedQuantity: 7,
  value: 7000, acceptedOn: '2026-05-04', today: '2026-11-21',
}];

vi.mock('@/src/hooks/useBillingPlan', () => ({ useBillingUnacceptedProgress: () => ({ isPending: true, isError: false, isSuccess: false }),
  useBillingPlanCandidates: () => ({ isPending: false, isError: false, isSuccess: true, data: { rows, truncated: false }, refetch: vi.fn() }),
  useBillingPlanSettings: () => ({ data: { monthlyTarget: null, targetCurrency: null, reminderOn: false, monthTargets: [] } }),
  useSaveBillingPlanSettings: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => false }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'IDR' }));

import BillingPlan from './BillingPlan';

describe('BillingPlan in Bahasa Indonesia', () => {
  afterEach(() => cleanup());

  it('AC-MBP-016 title, statement, summary and warning read as Bahasa', () => {
    render(<BahasaProvider><MemoryRouter><BillingPlan /></MemoryRouter></BahasaProvider>);
    expect(screen.getByRole('heading', { name: 'Rencana penagihan' })).toBeTruthy();
    expect(screen.getByTestId('billing-plan-statement').textContent).toContain('Hanya kandidat.');
    expect(screen.getByTestId('billing-plan-target').textContent).toBe('Target belum ditetapkan');
    fireEvent.click(screen.getByRole('checkbox', { name: /Pilih I-1/ }));
    expect(screen.getByTestId('billing-plan-overclaim').textContent).toContain('Klaim berlebih');
    expect(screen.getByText(/Dipilih \(1\)/)).toBeTruthy();
    expect(screen.queryByText(/Candidates only|Picked|Over-claimed|No target set/)).toBeNull();
  });
});

vi.mock('@/src/hooks/useOrgSwitch', async (original) => ({ ...(await original<typeof import('@/src/hooks/useOrgSwitch')>()), useOrgSwitch: () => ({ data: false }) }));
