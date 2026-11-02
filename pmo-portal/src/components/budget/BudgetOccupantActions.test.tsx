/**
 * AC-ECA-031 (FR-ECA-041) — the two ways forward when ERPNext already holds a budget PMO did not create.
 * Only the repository seam is mocked; the role gate and the confirm dialog are the real ones.
 */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';

const h = vi.hoisted(() => ({
  role: 'Finance' as string,
  accounts: vi.fn(),
  inspect: vi.fn(),
  draft: vi.fn(),
  replace: vi.fn(),
}));

vi.mock('@/src/lib/repositories/budgetOccupant', () => ({
  listRefusedOccupantAccounts: h.accounts,
  inspectBudgetOccupant: h.inspect,
  createDraftFromErpBudget: h.draft,
  replaceErpBudget: h.replace,
}));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: h.role, realRole: h.role }),
}));

import BudgetOccupantActions from './BudgetOccupantActions';

const OCCUPANT = { erpBudgetName: 'DESK-BUDGET', erpAccount: '5100 - Labour', fiscalYear: '2026' };

const renderActions = (role = 'Finance', onOpenDraft = vi.fn()) => {
  h.role = role;
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <ToastProvider>
        <BudgetOccupantActions projectId="proj-1" versionId="v1" fiscalYear="2026" onOpenDraft={onOpenDraft} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return onOpenDraft;
};

beforeEach(() => {
  h.accounts.mockReset().mockResolvedValue(['5100 - Labour']);
  h.inspect.mockReset().mockResolvedValue(OCCUPANT);
  h.draft.mockReset().mockResolvedValue('draft-1');
  h.replace.mockReset().mockResolvedValue({ pushState: 'pushed' });
});

describe('AC-ECA-031 budget occupant actions', () => {
  it.each(['Engineer', 'Project Manager', 'Executive'])('%s sees neither button and nothing is read', async (role) => {
    renderActions(role);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole('button', { name: /ERP figures as a draft/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Replace the ERP budget/i })).not.toBeInTheDocument();
    expect(h.accounts).not.toHaveBeenCalled();
  });

  it.each(['Admin', 'Finance'])('%s sees both buttons', async (role) => {
    renderActions(role);
    expect(await screen.findByRole('button', { name: 'Use the ERP figures as a draft' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Replace the ERP budget with this version' })).toBeInTheDocument();
  });

  it('AC-ECA-031 use as draft opens the new draft version', async () => {
    const onOpenDraft = renderActions();
    await userEvent.click(await screen.findByRole('button', { name: 'Use the ERP figures as a draft' }));
    await waitFor(() => expect(onOpenDraft).toHaveBeenCalledWith('draft-1'));
    expect(h.draft).toHaveBeenCalledWith('proj-1', '2026', '5100 - Labour');
    expect(h.replace).not.toHaveBeenCalled();
  });

  it('AC-ECA-031 replace needs a confirm naming the ERP budget, and nothing is replaced before it', async () => {
    renderActions();
    await userEvent.click(await screen.findByRole('button', { name: 'Replace the ERP budget with this version' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Replace ERP budget DESK-BUDGET for 5100 - Labour, 2026, with PMO’s active version? The ERP copy will be amended.');
    expect(h.replace).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Replace ERP budget' }));
    await waitFor(() => expect(h.replace).toHaveBeenCalledWith('proj-1', OCCUPANT));
  });

  it('AC-ECA-031 cancelling the confirm replaces nothing', async () => {
    renderActions();
    await userEvent.click(await screen.findByRole('button', { name: 'Replace the ERP budget with this version' }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(h.replace).not.toHaveBeenCalled();
  });

  it('a per-year ERP budget (no account) names the year only', async () => {
    h.accounts.mockResolvedValue(['']);
    h.inspect.mockResolvedValue({ ...OCCUPANT, erpAccount: '' });
    renderActions();
    await userEvent.click(await screen.findByRole('button', { name: 'Replace the ERP budget with this version' }));
    expect(await screen.findByRole('alertdialog')).toHaveTextContent('Replace ERP budget DESK-BUDGET for 2026 with PMO’s active version?');
  });
});
