/**
 * S05 — the expanded Purchases row mirrors the project header on Budget used: a project still in the pipeline
 * has no figure there, so the panel draws no tile and the page's hidden-figures line names nothing for it; a failed
 * read on a running project keeps a short unknown mark, never a sentence inside the tile.
 * OD-APPROVAL-LEFT (AC-RB-017): the same missing reading makes "Left after this purchase" not known, which the page's
 * one hidden-figures line reports (and the purchasing-only amount stays visible under its own label).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { FigureHiddenLine, FigureScope, ToastProvider } from '@/src/components/ui';

const detail = { data: undefined as unknown, isPending: false, isError: false, refetch: vi.fn() };
const positions = { data: undefined as unknown, isPending: false, isError: false };

vi.mock('@/src/hooks/useProcurementDetail', () => ({ useProcurementDetail: () => detail }));
vi.mock('@/src/hooks/useProjectBudgetPositions', () => ({ useProjectBudgetPositions: () => positions }));
vi.mock('@/src/hooks/useBudget', () => ({ useProjectBudget: () => ({ data: 1000, isPending: false, isError: false }) }));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProjectCommittedSpend: () => ({ data: 0, otherCurrencies: [], commitmentSource: 'pmo', ownershipPending: false, isPending: false, isError: false }),
  useProjectReservedSpend: () => ({ data: 0, projectCurrency: 'USD', budgetCurrency: 'USD', otherCurrencies: [], isPending: false, isError: false }),
}));

import { ProcurementListRow } from '../ProcurementListRow';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';

const row = {
  id: 'pr-1', code: 'PR-0001', title: 'Crane Hire', status: 'Requested', total_value: 25, currency: 'USD',
  created_at: '2026-06-01T00:00:00Z', project_id: 'p1', requested_by_id: 'u1',
  project: { name: 'Harbour Bridge', code: 'HB-01' }, requested_by: { full_name: 'Alice Engineer' }, vendor: null, vendor_id: null,
} as unknown as ProcurementWithRefs;

async function open(projectStatus: string) {
  detail.data = { ...row, items: [], project: { name: 'Harbour Bridge', code: 'HB-01', status: projectStatus } };
  render(
    <ImpersonationProvider realRole="Project Manager">
      <MemoryRouter>
        <ToastProvider>
          <FigureScope>
            <FigureHiddenLine />
            <ProcurementListRow row={row} />
          </FigureScope>
        </ToastProvider>
      </MemoryRouter>
    </ImpersonationProvider>,
  );
  await userEvent.click(screen.getByRole('button', { name: /Show preview for/i }));
  return screen.getByRole('region', { name: /Preview for/i });
}

beforeEach(() => { positions.data = undefined; positions.isPending = false; positions.isError = false; });

const knownReading = { projectId: 'p1', ledgerBasis: 'pmo', currency: 'USD', budgetCurrency: 'USD', activeBudgetAmount: '1000.00', spent: '0.00', openCommitment: '0.00', consumption: null, complete: true, usedRatio: '0', usedPercent: '0', consumptionVariance: null, riskEligible: true, atRisk: false };

describe('S05: Budget used in the Purchases preview', () => {
  it('a project still in the pipeline: no Budget used tile; the hidden-figures line reports only Left', async () => {
    const preview = await open('Tender Submitted');
    expect(await within(preview).findByText(/^project budget$/i)).toBeInTheDocument();
    expect(within(preview).queryByText(/^budget used$/i)).not.toBeInTheDocument();
    expect(screen.getByTestId('figures-hidden')).toHaveTextContent('Spending not known yet');
    expect(screen.getByTestId('figures-hidden')).not.toHaveTextContent('Budget used');
    expect(screen.queryByText(/unknown or unavailable/i)).not.toBeInTheDocument();
  });

  it('a running project whose read failed: a short mark in the tile, no sentence; the hidden-figures line reports only Left', async () => {
    positions.isError = true;
    const preview = await open('Active');
    const tile = (await within(preview).findByText(/^budget used$/i)).closest('[data-testid="stat-tile"]') as HTMLElement;
    expect(tile.textContent).toContain('—');
    expect(tile.querySelector('[role="status"]')).toBeNull();
    expect(screen.getByTestId('figures-hidden')).toHaveTextContent('Spending not known yet');
    expect(screen.getByTestId('figures-hidden')).not.toHaveTextContent('Budget used');
  });
});

describe('AC-RB-015/017: Left after this purchase in the Purchases preview', () => {
  it('known spending: $975 left (1,000 − 0 − 0 − 0 − 25) and nothing hidden', async () => {
    positions.data = { p1: knownReading };
    const preview = await open('Active');
    const tile = (await within(preview).findByText(/^left after this purchase$/i)).closest('[data-testid="stat-tile"]') as HTMLElement;
    expect(within(tile).getByText('$975')).toBeInTheDocument();
    expect(screen.queryByTestId('figures-hidden')).not.toBeInTheDocument();
  });

  it('spending not known: the page line carries the reason, and the amount without spending is shown under its own label (not in the Left tile)', async () => {
    const preview = await open('Active');
    expect(await within(preview).findByText('Without spending: $975 left after orders, reserved and this purchase.')).toBeInTheDocument();
    expect(screen.getByTestId('figures-hidden')).toHaveTextContent('Spending not known yet');
    expect(within(preview).queryByText(/^left after this purchase$/i)).not.toBeInTheDocument();
  });
});
