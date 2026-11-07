/**
 * #1364 — the refusal copy added for a budget push refused before writing reads as Bahasa under the real `id`
 * catalogue, and a finalize that kept refusing offers no Retry.
 */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';
import { BahasaProvider } from '@/test/bahasa';
import type { BudgetPushStatusRow } from '@/src/lib/repositories/budgetProjection';
import type { BudgetVersionWithItems } from '@/src/lib/db/budgets';

const h = vi.hoisted(() => ({ pushStatus: vi.fn() }));
vi.mock('@/src/lib/repositories/budgetProjection', () => ({
  fetchBudgetPushStatus: h.pushStatus,
  retryActiveBudgetPush: vi.fn(),
  releaseActiveBudgetPushHold: vi.fn(),
}));
vi.mock('@/src/lib/repositories/budgetOccupant', () => ({
  listRefusedOccupantAccounts: vi.fn().mockResolvedValue([]),
  inspectBudgetOccupant: vi.fn(),
  createDraftFromErpBudget: vi.fn(),
  replaceErpBudget: vi.fn(),
}));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: 'Finance', realRole: 'Finance' }),
}));

import BudgetErpNotice from './BudgetErpNotice';

const row = (pushError: string): BudgetPushStatusRow => ({
  pushState: 'failed', pushError, unmappedCategories: null, erpBudgetName: null,
  fiscalYear: null, pushedAt: null, holdReleasable: false, staleAttribution: false,
});
const renderNotice = () => render(
  <BahasaProvider>
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <BudgetErpNotice projectId="p" activeVersion={{ id: 'v1', status: 'Active' } as unknown as BudgetVersionWithItems} />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>
  </BahasaProvider>,
);

describe('#1364 refusal copy in Bahasa', () => {
  it('names the project dates fix in Bahasa, with no Retry', async () => {
    h.pushStatus.mockResolvedValue([row('budget-project-start-date-missing')]);
    renderNotice();
    const notice = await screen.findByTestId('budget-erp-notice');
    expect(notice).toHaveTextContent('Isi tanggal mulai dan selesai proyek');
    expect(notice).not.toHaveTextContent('Set the project start');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('a finalize that kept refusing offers no Retry', async () => {
    h.pushStatus.mockResolvedValue([row('outbox-finalize-refused')]);
    renderNotice();
    const notice = await screen.findByTestId('budget-erp-notice');
    expect(notice).toHaveTextContent('Minta administrator');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
