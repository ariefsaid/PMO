/**
 * S05 — the expanded Purchases row mirrors the project header on Budget used: a project still in the pipeline
 * has no figure there, so the panel draws no tile and the page's hidden-figures line names nothing; a failed
 * read on a running project keeps a short unknown mark, never a sentence inside the tile.
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
  useProjectCommittedSpend: () => ({ data: 0, otherCurrencies: [], isPending: false, isError: false }),
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

describe('S05: Budget used in the Purchases preview', () => {
  it('a project still in the pipeline: no Budget used tile and no hidden-figures line', async () => {
    const preview = await open('Tender Submitted');
    expect(await within(preview).findByText(/^project budget$/i)).toBeInTheDocument();
    expect(within(preview).queryByText(/^budget used$/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('figures-hidden')).not.toBeInTheDocument();
    expect(screen.queryByText(/unknown or unavailable/i)).not.toBeInTheDocument();
  });

  it('a running project whose read failed: a short mark in the tile, no sentence, no hidden-figures line', async () => {
    positions.isError = true;
    const preview = await open('Active');
    const tile = (await within(preview).findByText(/^budget used$/i)).closest('[data-testid="stat-tile"]') as HTMLElement;
    expect(tile.textContent).toContain('—');
    expect(tile.querySelector('[role="status"]')).toBeNull();
    expect(screen.queryByTestId('figures-hidden')).not.toBeInTheDocument();
  });
});
