import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { formatCurrencyCents } from '@/src/lib/format';
// The DOM matchers collapse NBSP to a space; Intl emits NBSP between code and digits.
const money = (v: number, c: string) => formatCurrencyCents(v, c).replace(/\u00a0/g, ' ');

const mockNavigate = vi.fn();
vi.mock('react-router', async (importOriginal) => {
  const real = await importOriginal<typeof import('react-router')>();
  return { ...real, useNavigate: () => mockNavigate };
});
const h = vi.hoisted(() => ({
  listSpy: vi.fn(),
  list: { data: { rows: [] as unknown[], truncated: false }, isPending: false, isError: false, refetch: vi.fn() },
  aging: { data: { rows: [] as unknown[], truncated: false }, isPending: false, isError: false, refetch: vi.fn() },
  create: { mutateAsync: vi.fn(), isPending: false },
  capture: { capture: vi.fn(), cleanupUnlinkedAttachment: vi.fn(), recovery: null as null | Record<string, unknown>, progress: null as number | null },
}));
vi.mock('@/src/hooks/useExpenseClaims', () => ({
  useExpenseClaims: (filters: unknown) => { h.listSpy(filters); return h.list; },
  useExpenseAdvanceAging: () => h.aging,
  useExpenseClaimMutations: () => ({ create: h.create }),
}));
vi.mock('@/src/hooks/useExpenseCapture', async () => {
  const ReactModule = await import('react');
  return {
    useExpenseCapture: () => {
      const [recovery, setRecovery] = ReactModule.useState(h.capture.recovery);
      const capture = async (input: unknown) => {
        try { return await h.capture.capture(input); }
        catch (error) { setRecovery(h.capture.recovery); throw error; }
      };
      return { ...h.capture, recovery, capture };
    },
  };
});
vi.mock('@/src/hooks/useProjects', () => ({ useProjects: () => ({ data: [{ id: 'p1', name: 'Harbour Upgrade' }] }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' } }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: 'Engineer', effectiveRole: 'Engineer' }) }));

const readiness = vi.hoisted(() => ({ state: 'ready' as string }));
vi.mock('@/src/hooks/useExpensePostingReadiness', () => ({
  useExpensePostingReadiness: () => ({ state: readiness.state, retry: vi.fn() }),
}));

import ExpenseClaims from './ExpenseClaims';

const ROW = {
  id: 'c1', claim_number: 'EXP-2610060001', kind: 'claim', title: 'Site visit', claimant: { full_name: 'Budi Field' },
  project: { name: 'Harbour Upgrade' }, budget_category: 'Special expenses', amount: 750000, currency: 'IDR', status: 'Submitted',
};
const renderPage = () => render(<MemoryRouter><ToastProvider><ExpenseClaims /></ToastProvider></MemoryRouter>);

beforeEach(() => {
  mockNavigate.mockClear();
  h.listSpy.mockClear();
  h.create.mutateAsync.mockReset();
  h.capture.capture.mockReset();
  h.capture.cleanupUnlinkedAttachment.mockReset();
  h.capture.recovery = null;
  readiness.state = 'ready';
  h.list.data = { rows: [ROW], truncated: false };
});

describe('ExpenseClaims page', () => {
  it('AC-EXP-060 lists records with number, claimant, project, amount and status', () => {
    renderPage();
    const row = screen.getByRole('row', { name: /Site visit/ });
    expect(within(row).getByText('EXP-2610060001')).toBeInTheDocument();
    expect(within(row).getByText('Budi Field')).toBeInTheDocument();
    expect(within(row).getByText('Harbour Upgrade')).toBeInTheDocument();
    expect(within(row).getByText(money(750000, 'IDR'))).toBeInTheDocument();
    expect(within(row).getByText('Submitted')).toBeInTheDocument();
  });

  it('AC-EXP-060 the Special expenses filter queries by that category', async () => {
    renderPage();
    await userEvent.selectOptions(screen.getByLabelText('Budget category'), 'Special expenses');
    expect(h.listSpy).toHaveBeenLastCalledWith({ budgetCategory: 'Special expenses' });
  });

  it('AC-EXP-060 New claim creates a claim and opens it', async () => {
    h.capture.capture.mockResolvedValue('new-1');
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'New claim' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/Title/), 'Site visit');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(h.capture.capture).toHaveBeenCalledWith({
      header: { kind: 'claim', title: 'Site visit', purpose: null, projectId: null, budgetCategory: null, advanceId: null },
      firstLine: null,
      receiptFile: null,
    });
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/expenses/new-1'));
  });

  it('AC-S29-004 keeps the same inputs and draft after receipt failure, then retries without a second claim', async () => {
    h.capture.capture
      .mockImplementationOnce(async () => {
        h.capture.recovery = {
          claimId: 'draft-29', draftSaved: true, phase: 'receipt-upload-failed',
          attachment: { fileId: 'file-29', path: 'org-29/draft-29/file-29/taxi.pdf', state: 'prepared' },
          error: 'Receipt upload failed. Retry this saved draft.',
        };
        throw new Error('Receipt upload failed. Retry this saved draft.');
      })
      .mockResolvedValueOnce('draft-29');
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'New claim' }));
    const dialog = await screen.findByRole('dialog');
    const file = new File(['receipt'], 'taxi.pdf', { type: 'application/pdf' });
    fireEvent.change(within(dialog).getByLabelText('Choose a receipt file'), { target: { files: [file] } });
    await userEvent.type(within(dialog).getByLabelText('Description'), 'Taxi to project site');
    await userEvent.selectOptions(within(dialog).getByLabelText(/^Type/), 'Travel');
    await userEvent.type(within(dialog).getByLabelText(/^Amount/), '150000');
    fireEvent.change(within(dialog).getByLabelText(/^Date/), { target: { value: '2026-10-07' } });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));

    expect(await within(dialog).findByRole('status')).toHaveTextContent('Your draft is saved');
    expect(within(dialog).queryByText('draft-29')).toBeNull();
    expect(within(dialog).getByLabelText(/Title/)).toHaveValue('Taxi to project site');
    expect(within(dialog).getByText('taxi.pdf')).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(h.create.mutateAsync).not.toHaveBeenCalled();
    const firstInput = h.capture.capture.mock.calls[0][0];

    await userEvent.click(within(dialog).getByRole('button', { name: 'Retry receipt' }));
    expect(h.capture.capture).toHaveBeenCalledTimes(2);
    expect(h.capture.capture.mock.calls[1][0]).toEqual(firstInput);
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/expenses/draft-29'));
    expect(h.create.mutateAsync).not.toHaveBeenCalled();
  });

  it('AC-S29-001 suggests only the current claimant’s newest saved category for the selected project', async () => {
    h.list.data = {
      rows: [
        { ...ROW, id: 'own-new', claimant_id: 'u1', project_id: 'p1', budget_category: 'Labor', title: 'Latest own visit', created_at: '2026-10-12T00:00:00Z' },
        { ...ROW, id: 'other-newer', claimant_id: 'u2', project_id: 'p1', budget_category: 'Materials', title: 'Another claimant visit', created_at: '2026-10-17T00:00:00Z' },
        { ...ROW, id: 'own-older', claimant_id: 'u1', project_id: 'p1', budget_category: 'Equipment', title: 'Older own visit', created_at: '2026-10-02T00:00:00Z' },
      ],
      truncated: false,
    };
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'New claim' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.selectOptions(within(dialog).getByLabelText('Project'), 'p1');

    expect(within(dialog).getByLabelText('Budget category')).toHaveValue('Labor');
    expect(within(dialog).getByText(/Latest own visit/)).toBeInTheDocument();
    expect(within(dialog).queryByText(/Another claimant visit/)).toBeNull();
  });

  it('AC-EXP-060 an advance cannot be created without an amount', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Request advance' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/Title/), 'Trip float');
    expect(within(dialog).getByRole('button', { name: 'Create' })).toBeDisabled();
    expect(h.create.mutateAsync).not.toHaveBeenCalled();
  });

  it('AC-EXP-060 says when the list is truncated instead of trimming silently', () => {
    h.list.data = { rows: [ROW], truncated: true };
    renderPage();
    expect(screen.getByText(/Showing the latest 200/)).toBeInTheDocument();
  });

  describe('S-12 posting readiness before draft creation (RF-060)', () => {
    it.each([
      ['notConnected', /Expense posting to accounting isn't active/],
      ['inactive', /ERPNext is connected, but expense posting isn't switched on/],
      ['unavailable', /Couldn't check whether expense posting is active/],
    ])('%s: a persistent plain warning shows in the new-claim form and PMO-only creation still works', async (state, text) => {
      readiness.state = state;
      h.capture.capture.mockResolvedValue('new-2');
      renderPage();
      await userEvent.click(screen.getByRole('button', { name: 'New claim' }));
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText(text)).toBeInTheDocument();
      await userEvent.type(within(dialog).getByLabelText(/Title/), 'Site visit');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
      expect(h.capture.capture).toHaveBeenCalled();
    });

    it.each(['ready', 'checking'])('%s: no warning', async (state) => {
      readiness.state = state;
      renderPage();
      await userEvent.click(screen.getByRole('button', { name: 'New claim' }));
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).queryByText(/expense posting/i)).toBeNull();
    });
  });
});
