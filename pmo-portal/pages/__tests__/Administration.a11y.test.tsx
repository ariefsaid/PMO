/**
 * AC-A11Y-001 — axe-clean administration surface (ops-admin-surface S6 capstone).
 *
 * Renders the route-backed Administration shell at its selected canonical destination for an
 * Operator AND a non-Operator org-Admin, at desktop width and at 390px (mobile), and asserts
 * axe-core reports NO `critical`/`serious` WCAG-AA violations on either persona/viewport.
 *
 * This is the Layer-1 a11y gate for the entire ops-admin surface: the toggle controls are real
 * `role="switch"` (WCAG 4.1.2 name/role/value), the destructive confirm is a labelled
 * `alertdialog`, and toasts are `aria-live`. Any blocking finding here fails CI before it ships.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';
import { axeViolations } from '@/src/components/__tests__/axe';

const { listState, mutations, isOperatorState } = vi.hoisted(() => ({
  listState: {
    data: [
      { id: 'self-admin', full_name: 'Org Admin', email: 'admin@example.com', role: 'Admin', manager_id: null, org_id: 'org-1', status: 'active' },
      { id: 'eng-1', full_name: 'Engineer One', email: 'eng@example.com', role: 'Engineer', manager_id: null, org_id: 'org-1', status: 'active' },
    ] as unknown[],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  mutations: {
    updateRole: { mutateAsync: vi.fn(), isPending: false },
    assignManager: { mutateAsync: vi.fn(), isPending: false },
    invite: { mutateAsync: vi.fn(), isPending: false },
    setStatus: { mutateAsync: vi.fn(), isPending: false },
  },
  isOperatorState: { value: false, pending: false },
}));

vi.mock('@/src/hooks/useUsers', () => ({
  useUsers: () => listState,
  useUserMutations: () => mutations,
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'self-admin', org_id: 'org-1' }, role: 'Admin' }),
}));
vi.mock('@/src/auth/useIsOperator', () => ({
  useIsOperator: () => isOperatorState.value,
  useOperatorMembership: () => ({
    isOperator: isOperatorState.value,
    isPending: isOperatorState.pending,
    isError: false,
  }),
}));
vi.mock('@/src/hooks/useUsage', () => ({
  useUsage: () => ({
    data: [
      { month: '2026-06', action: 'chat', run_count: 4, prompt_tokens: 100, completion_tokens: 50, provider_cost_usd: 0.02, cost: 5, margin_usd: null, owner_id: null },
    ],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useAgentRunStats: () => ({
    data: [
      { action: 'chat', month: '2026-06', runs: 4, avg_rounds: 2, p50_cost: 0.1, p95_cost: 0.2, max_cost: 0.3, cache_hit_pct: 50, p50_ms: 500, p95_ms: 900 },
    ],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));
vi.mock('@/src/hooks/useOrgFeatures', () => ({
  // A mixed map so both enabled + disabled feature rows render.
  useOrgFeatures: () => ({ data: { incidents: true, crm: false, procurement: true } }),
}));
vi.mock('@/src/lib/repositories', () => ({
  repositories: {
    credits: { getOrgBalance: vi.fn().mockResolvedValue(1250), grant: vi.fn().mockResolvedValue(undefined) },
    orgFeature: { listOwn: vi.fn().mockResolvedValue({}), toggle: vi.fn().mockResolvedValue(undefined) },
  },
}));

import Administration from '../Administration';

const renderComposed = (path = '/administration/users') => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ImpersonationProvider realRole="Admin">
        <MemoryRouter initialEntries={[path]}>
          <ToastProvider>
            <Administration />
          </ToastProvider>
        </MemoryRouter>
      </ImpersonationProvider>
    </QueryClientProvider>,
  );
};

const originalWidth = window.innerWidth;

afterEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: originalWidth });
});

beforeEach(() => {
  isOperatorState.value = false;
  isOperatorState.pending = false;
});

async function expectNoBlockingViolations(container: HTMLElement) {
  // Let the route-backed shell settle so axe audits the selected panel's final DOM (avoids a
  // post-test act warning without requiring an unrelated Credits query to mount).
  await waitFor(() => expect(container.querySelector('h1')).not.toBeNull());
  const { blocking, advisory } = await axeViolations(container);
  if (advisory.length) {
    // Visibility only — advisories don't fail the gate yet.
    console.info('[a11y advisory]', advisory.map((a) => `${a.id} (${a.impact}, ${a.nodes})`).join(', '));
  }
  expect(blocking).toEqual([]);
}

describe('AC-A11Y-001 — axe-clean composed /administration surface', () => {
  it('AC-A11Y-001: Operator view at desktop width has no critical/serious violations', async () => {
    isOperatorState.value = true;
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1280 });
    const { container } = renderComposed('/administration/users');
    await expectNoBlockingViolations(container);
  });

  it('AC-A11Y-001: Operator view at 390px (mobile) has no critical/serious violations', async () => {
    isOperatorState.value = true;
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 390 });
    const { container } = renderComposed('/administration/users');
    await expectNoBlockingViolations(container);
  });

  it('AC-A11Y-001: org-Admin (non-Operator) view at desktop width has no critical/serious violations', async () => {
    isOperatorState.value = false;
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1280 });
    const { container } = renderComposed('/administration/users');
    await expectNoBlockingViolations(container);
  });

  it('AC-A11Y-001: org-Admin (non-Operator) view at 390px (mobile) has no critical/serious violations', async () => {
    isOperatorState.value = false;
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 390 });
    const { container } = renderComposed('/administration/users');
    await expectNoBlockingViolations(container);
  });

  it('AC-A11Y-001: the org-Admin (non-Operator) direct Usage denial is axe-clean and mounts no panel', async () => {
    isOperatorState.value = false;
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1280 });
    const { container } = renderComposed('/administration/usage');
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/Operator-only/i),
    );
    await expectNoBlockingViolations(container);
    // The denial never mounts the Operator panel/query.
    expect(container.querySelector('[data-testid="administration-panel-usage"]')).toBeNull();
  });

  it('AC-A11Y-001: the Operator-membership pending state is axe-clean with no premature denial', async () => {
    isOperatorState.value = false;
    isOperatorState.pending = true;
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1280 });
    const { container } = renderComposed('/administration/usage');
    await waitFor(() => expect(screen.getByText(/checking your Administration access/i)).toBeInTheDocument());
    await expectNoBlockingViolations(container);
    // Pending shows a status, not a denial alert and not the panel.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(container.querySelector('[data-testid="administration-panel-usage"]')).toBeNull();
  });

  it('AC-A11Y-001: the Feature toggles are real role="switch" controls (Operator)', () => {
    isOperatorState.value = true;
    const { container } = renderComposed('/administration/features');
    const switches = container.querySelectorAll('[role="switch"]');
    expect(switches.length).toBeGreaterThan(0);
    switches.forEach((s) => {
      expect(s).toHaveAttribute('aria-checked');
      expect(s.getAttribute('aria-label')).toBeTruthy();
    });
  });
});
