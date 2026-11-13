import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';

/**
 * Ruling 1 (expenses fix round): the empty state keeps its New claim, but as the quiet OUTLINE
 * variant, so the view shows exactly one filled action — the header's. The variant is read the
 * same way the shared ListState tests read it: the Button primitive records the variant it is
 * handed, and the assertion is about the variant a person receives, never a class string.
 */
const recorded = vi.hoisted(() => ({ buttons: [] as Array<{ variant: string; label: string }> }));

vi.mock('@/src/components/ui/Button', async () => {
  const ReactModule = await import('react');
  const labelOf = (node: React.ReactNode): string => {
    if (node == null || node === false) return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(labelOf).join('');
    if (ReactModule.isValidElement(node)) return labelOf((node.props as { children?: React.ReactNode }).children);
    return '';
  };
  return {
    Button: ({
      variant = 'primary',
      loading,
      size,
      iconOnly,
      children,
      ...rest
    }: {
      variant?: string;
      loading?: boolean;
      size?: string;
      iconOnly?: boolean;
      children?: React.ReactNode;
    } & React.ButtonHTMLAttributes<HTMLButtonElement>) => {
      recorded.buttons.push({ variant, label: labelOf(children).trim() });
      return ReactModule.createElement(
        'button',
        { type: 'button', ...rest, disabled: Boolean(rest.disabled) || Boolean(loading) },
        children,
      );
    },
  };
});

const mockNavigate = vi.fn();
vi.mock('react-router', async (importOriginal) => {
  const real = await importOriginal<typeof import('react-router')>();
  return { ...real, useNavigate: () => mockNavigate };
});
const h = vi.hoisted(() => ({
  list: { data: { rows: [] as unknown[], truncated: false }, isPending: false, isError: false, refetch: vi.fn() },
  aging: { data: { rows: [] as unknown[], truncated: false }, isPending: false, isError: false, refetch: vi.fn() },
  totals: { data: {} as Record<string, unknown>, isPending: false, isError: false, refetch: vi.fn() },
  own: { data: { rows: [] as unknown[] } as unknown, isPending: false, isError: false, refetch: vi.fn() },
  create: { mutateAsync: vi.fn(), isPending: false },
  capture: { capture: vi.fn(), cleanupUnlinkedAttachment: vi.fn(), recovery: null as null | Record<string, unknown>, progress: null as number | null },
}));
vi.mock('@/src/hooks/useExpenseClaims', () => ({
  useExpenseClaims: () => h.list,
  useExpenseAdvanceAging: () => h.aging,
  useExpenseAdvanceAgingTotals: () => h.totals,
  useOwnExpenseAdvances: () => h.own,
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
vi.mock('@/src/hooks/useProjects', () => ({ useProjects: () => ({ data: [] }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' } }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: 'Engineer', effectiveRole: 'Engineer' }) }));
vi.mock('@/src/hooks/useImprest', () => ({ useImprestFloatChoices: () => ({ data: [] }) }));
vi.mock('@/src/hooks/useExpensePostingReadiness', () => ({ useExpensePostingReadiness: () => ({ state: 'ready', retry: vi.fn() }) }));

import ExpenseClaims from '../ExpenseClaims';

const renderPage = () => render(<MemoryRouter><ToastProvider><ExpenseClaims /></ToastProvider></MemoryRouter>);

beforeEach(() => {
  recorded.buttons.length = 0;
  mockNavigate.mockClear();
  h.list.data = { rows: [], truncated: false };
  h.list.isError = false;
});

describe('ExpenseClaims empty state (ruling 1)', () => {
  it('ruling 1: the view keeps one filled action and the empty-state New claim is the quiet outline', async () => {
    renderPage();

    const secondary = recorded.buttons.filter((button) => button.variant === 'outline');
    const filled = recorded.buttons.filter((button) => button.variant === 'primary');
    expect(filled).toHaveLength(1);
    expect(filled[0].label).toBe('New claim');
    expect(secondary.map((button) => button.label)).toEqual(['Request advance', 'New claim']);

    const [headerAction, emptyAction] = screen.getAllByRole('button', { name: 'New claim' });
    await userEvent.click(headerAction);
    await userEvent.click(emptyAction);
    expect(mockNavigate).toHaveBeenNthCalledWith(1, '/expenses/new');
    expect(mockNavigate).toHaveBeenNthCalledWith(2, '/expenses/new');
  });
});
