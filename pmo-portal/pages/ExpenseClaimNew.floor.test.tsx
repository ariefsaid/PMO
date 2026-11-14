import { fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import { toast as sonnerToast } from 'sonner';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/src/components/ui';

const h = vi.hoisted(() => ({
  create: vi.fn(), addLine: vi.fn(), capture: vi.fn(), cleanup: vi.fn(), may: vi.fn(() => true), navigate: vi.fn(),
  claims: [] as unknown[], readiness: 'ready' as string, choices: [] as unknown[], choicesArgs: [] as unknown[][],
  limit: null as number | null, orgCurrency: { currency: 'IDR', isResolved: true, isError: false }, setFloat: vi.fn(),
  adv: { pending: false, error: false, refetch: vi.fn() }, proj: { pending: false, error: false, refetch: vi.fn() },
}));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => h.may }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'user-1' } }) }));
vi.mock('./expenses/useOwnAdvanceOptions', () => ({ useOwnAdvanceOptions: () => ({ options: [{ value: 'adv-1', label: 'EXP-1 · Rp 1' }], isPending: h.adv.pending, isError: h.adv.error, refetch: h.adv.refetch }) }));
vi.mock('@/src/hooks/useProjects', () => ({ useProjects: () => ({ data: h.proj.error || h.proj.pending ? undefined : [{ id: 'p1', name: 'Contractual Project one', short_name: 'North Terminal' }, { id: 'p2', name: 'Project two', short_name: null }], isPending: h.proj.pending, isError: h.proj.error, refetch: h.proj.refetch }) }));
vi.mock('@/src/hooks/useExpenseClaims', () => ({ useExpenseClaims: () => ({ data: { rows: h.claims } }), useExpenseClaimMutations: () => ({ create: { mutateAsync: h.create }, addLine: { mutateAsync: h.addLine } }) }));
vi.mock('@/src/hooks/useImprest', () => ({
  useImprestFloatChoices: (...a: unknown[]) => { h.choicesArgs.push(a); return { data: h.choices }; },
  useImprestProcurementLimit: () => ({ data: h.limit }),
  useSetClaimFloat: () => ({ mutateAsync: h.setFloat }),
}));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrencyState: () => h.orgCurrency }));
vi.mock('@/src/hooks/useExpensePostingReadiness', () => ({ useExpensePostingReadiness: () => ({ state: h.readiness, retry: vi.fn() }) }));
vi.mock('@/src/hooks/useExpenseCapture', () => ({ useExpenseCapture: () => ({ capture: h.capture, cleanupUnlinkedAttachment: h.cleanup, recovery: null }) }));
vi.mock('react-router', async (importOriginal) => { const actual = await importOriginal<typeof import('react-router')>(); return { ...actual, useNavigate: () => h.navigate }; });

import ExpenseClaimNew from './ExpenseClaimNew';

afterEach(() => { act(() => { sonnerToast.dismiss(); }); });

const renderPage = () => render(
  <MemoryRouter initialEntries={['/expenses/new']}>
    <ToastProvider>
      <Routes><Route path="/expenses/new" element={<ExpenseClaimNew />} /></Routes>
    </ToastProvider>
  </MemoryRouter>,
);

describe('Expense claim floor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.cleanup.mockResolvedValue(undefined);
    h.may.mockReturnValue(true);
    h.claims = [];
    h.readiness = 'ready';
    h.choices = [];
    h.choicesArgs = [];
    h.limit = null;
    h.orgCurrency = { currency: 'IDR', isResolved: true, isError: false };
    h.adv.pending = false;
    h.adv.error = false;
    h.proj.pending = false;
    h.proj.error = false;
    h.setFloat.mockResolvedValue(undefined);
    h.create.mockResolvedValue({ id: 'claim-1' });
    h.addLine.mockResolvedValue({});
    h.capture.mockResolvedValue('claim-1');
  });

  it('floor: Remove on line two keeps only line one in the capture payload', async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'Travel expenses' } });
    fireEvent.change(screen.getByLabelText(/^Date/), { target: { value: '2026-10-20' } });
    fireEvent.change(screen.getByLabelText(/^Type/), { target: { value: 'Travel' } });
    fireEvent.change(screen.getByLabelText(/^Description/), { target: { value: 'Train fare' } });
    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: '42.50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add line' }));
    fireEvent.change(screen.getAllByLabelText(/^Date/)[1], { target: { value: '2026-10-21' } });
    fireEvent.change(screen.getAllByLabelText(/^Type/)[1], { target: { value: 'Meals' } });
    fireEvent.change(screen.getAllByLabelText(/^Description/)[1], { target: { value: 'Lunch' } });
    fireEvent.change(screen.getAllByLabelText(/^Amount/)[1], { target: { value: '18.25' } });

    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[1]);

    expect(screen.getAllByLabelText(/^Amount/)).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(h.capture).toHaveBeenCalled());
    expect(h.capture.mock.calls[0][0].firstLine).toMatchObject({ description: 'Train fare', amount: 42.5 });
    expect(h.capture.mock.calls[0][0].additionalLines).toEqual([]);
  });
});
