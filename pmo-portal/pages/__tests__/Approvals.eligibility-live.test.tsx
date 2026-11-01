import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { AuthContext, type AuthContextValue } from '@/src/auth/AuthContext';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';

const state = vi.hoisted(() => ({ approved: false, assigned: true }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'me', org_id: 'org' }, role: 'Engineer' }) }));
vi.mock('@/src/lib/repositories', async (original) => {
  const actual = await original<typeof import('@/src/lib/repositories')>();
  const row = { id: 'week', user_id: 'report', org_id: 'org', week_start_date: '2026-06-01', owner: { full_name: 'Report', manager_id: 'me' }, entries: [] };
  return { ...actual, repositories: { ...actual.repositories, timesheet: { ...actual.repositories.timesheet,
    listAwaitingApproval: async () => state.assigned && !state.approved ? [{ ...row, status: 'Submitted' }] : [],
    listReopenableApproved: async () => state.assigned && state.approved ? [{ ...row, status: 'Approved', mirror: null, pushCommandState: null }] : [],
    approve: async () => { state.approved = true; }, pushApproved: async () => {},
  } } };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: vi.fn() } }));
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/hooks/useExpenseClaims', () => ({ useExpenseClaimsAwaitingDecision: () => ({ data: [], isPending: false, isError: false }) }));
vi.mock('@/src/hooks/useInvoicesAwaitingViewer', () => ({ useInvoicesAwaitingViewer: () => ({ rows: [], isPending: false, isError: false }) }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/hooks/useRevenueMode', () => ({ useRevenueMode: () => 'native' }));
vi.mock('@/src/hooks/useUserViews', () => ({ useUserViews: () => ({ data: [] }) }));
vi.mock('@/src/hooks/useOrgFeatures', () => ({ useOrgFeatures: () => ({ data: {} }) }));
vi.mock('@/src/hooks/useFinancePosition', () => ({ useFinancePosition: () => ({ isPending: true }) }));
vi.mock('@/src/auth/useIsOperator', () => ({ useIsOperator: () => false }));
vi.mock('@/src/components/shell/ApprovalsNavCount', () => ({ ApprovalsNavCount: () => null }));

import ApprovalsPage from '../Approvals';
import { Rail } from '@/src/components/shell/Rail';

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnWindowFocus: false } } });
  const auth = { currentUser: { id: 'me', org_id: 'org' }, role: 'Engineer' } as AuthContextValue;
  render(<QueryClientProvider client={qc}><AuthContext.Provider value={auth}><MemoryRouter initialEntries={['/approvals']}><ImpersonationProvider realRole="Engineer"><ToastProvider><Rail /><ApprovalsPage /></ToastProvider></ImpersonationProvider></MemoryRouter></AuthContext.Provider></QueryClientProvider>);
  return qc;
}

describe('mounted manager eligibility', () => {
  it('keeps navigation and correction available when the only pending week is approved', async () => {
    state.approved = false; state.assigned = true;
    mount();
    await screen.findByRole('link', { name: /approvals/i });
    let lostPath = false;
    const observer = new MutationObserver(() => { if (!screen.queryByRole('link', { name: /approvals/i })) lostPath = true; });
    observer.observe(document.body, { childList: true, subtree: true });
    await userEvent.click(await screen.findByRole('button', { name: /^approve$/i }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^approve$/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /re-open for correction/i })).toBeVisible());
    expect(screen.getByRole('link', { name: /approvals/i })).toBeVisible();
    observer.disconnect();
    expect(lostPath).toBe(false);
  });

  it('refreshes a mounted assignment grant and revocation and withdraws selection', async () => {
    const original = globalThis.setInterval;
    const timer = vi.spyOn(globalThis, 'setInterval').mockImplementation((fn, delay, ...args) => original(fn, delay === 60_000 ? 50 : delay, ...args));
    try {
      state.approved = false; state.assigned = false;
      const qc = mount();
      await waitFor(() => expect(qc.getQueryState(['timesheets-awaiting', 'org', 'me', 'Engineer'])?.status).toBe('success'));
      await waitFor(() => expect(qc.getQueryState(['timesheets-reopenable-approved', 'org', 'me', 'Engineer'])?.status).toBe('success'));
      await screen.findByText(/you don't have access to approvals/i);
      state.assigned = true;
      await screen.findByRole('button', { name: /^approve$/i }, { timeout: 10000 });
      await userEvent.click(screen.getByRole('button', { name: /select items/i }));
      await userEvent.click(screen.getByRole('checkbox', { name: /select all approvable/i }));
      await userEvent.click(screen.getByRole('button', { name: /approve 1/i }));
      expect(screen.getByRole('dialog')).toBeVisible();
      state.assigned = false;
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument(), { timeout: 10000 });
      expect(screen.queryByRole('button', { name: /^approve$/i })).not.toBeInTheDocument();
      state.assigned = true;
      await screen.findByRole('button', { name: /^approve$/i }, { timeout: 10000 });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    } finally { timer.mockRestore(); }
  });


  it('refreshes the mounted correction path on assignment grant and revocation', async () => {
    const original = globalThis.setInterval;
    const timer = vi.spyOn(globalThis, 'setInterval').mockImplementation((fn, delay, ...args) => original(fn, delay === 60_000 ? 50 : delay, ...args));
    try {
      state.approved = true; state.assigned = false;
      const qc = mount();
      await waitFor(() => expect(qc.getQueryState(['timesheets-awaiting', 'org', 'me', 'Engineer'])?.status).toBe('success'));
      await waitFor(() => expect(qc.getQueryState(['timesheets-reopenable-approved', 'org', 'me', 'Engineer'])?.status).toBe('success'));
      await screen.findByText(/you don't have access to approvals/i);
      state.assigned = true;
      await screen.findByRole('button', { name: /re-open for correction/i }, { timeout: 10000 });
      state.assigned = false;
      await waitFor(() => expect(screen.queryByRole('button', { name: /re-open for correction/i })).not.toBeInTheDocument(), { timeout: 10000 });
    } finally { timer.mockRestore(); }
  });

});
