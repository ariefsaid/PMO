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
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';
import { axeViolations } from '@/src/components/__tests__/axe';

function pageAlertsMatching(message: RegExp) {
  return screen.getAllByRole('alert').filter(
    (alert) => alert.getAttribute('aria-atomic') !== 'true' && message.test(alert.textContent ?? ''),
  );
}

const { listState, mutations, isOperatorState, fxState, roleState } = vi.hoisted(() => ({
  roleState: { value: 'Admin' },
  fxState: { list: vi.fn(), context: vi.fn(), existing: vi.fn(), upsert: vi.fn() },
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
  useAuth: () => ({ currentUser: { id: 'self-admin', org_id: 'org-1', role: roleState.value }, role: roleState.value }),
}));
vi.mock('@/src/hooks/useFxOrgDay', () => ({ useFxOrgDay: () => ({ day: '2026-10-31', isPending: false, isError: false, retry: vi.fn() }) }));
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
    orgSettings: { getTaxDefault: vi.fn().mockResolvedValue('exclusive') },
    fxRates: {
      list: fxState.list,
      context: fxState.context,
      existing: fxState.existing,
      upsert: fxState.upsert,
    },
  },
}));
vi.mock('@/src/lib/repositories/budgetProjection', () => ({
  listBudgetCategoryAccountMap: vi.fn().mockResolvedValue([]),
  createBudgetCategoryAccountMapRow: vi.fn(),
  updateBudgetCategoryAccountMapRow: vi.fn(),
  deleteBudgetCategoryAccountMapRow: vi.fn(),
  setBudgetPushAccount: vi.fn(),
}));

import Administration from '../Administration';

const renderComposed = (path = '/administration/users') => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ImpersonationProvider realRole={roleState.value as 'Admin' | 'Finance'}>
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
  roleState.value = 'Admin';
  fxState.list.mockReset().mockResolvedValue({ rows: [{
    id: 'fx-1', org_id: 'org-1', rate_date: '2026-10-12', rate: 16300, base_currency: 'USD', quote_currency: 'IDR',
    source: 'JISDOR', created_by: null, updated_by: null, created_at: '2026-10-12T00:00:00Z', updated_at: '2026-10-12T00:00:00Z',
  }], nextCursor: null });
  fxState.context.mockReset().mockResolvedValue({ currency: 'IDR', timezone: 'Asia/Jakarta' });
  fxState.existing.mockReset().mockResolvedValue([]);
  fxState.upsert.mockReset().mockResolvedValue({ new: 1, changed: 0, unchanged: 0 });
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
  const settledPanel = async (section: string, container: HTMLElement) => {
    await waitFor(() => {
      switch (section) {
        case 'users':
          expect(screen.getByText('Engineer One')).toBeInTheDocument();
          break;
        case 'integrations':
          expect(screen.getByTestId('integrations-owner-scope')).toBeInTheDocument();
          expect(screen.getByTestId('integrations-connect-cards')).toBeInTheDocument();
          break;
        case 'accounting':
          expect(screen.getByTestId('org-tax-default-select')).toBeInTheDocument();
          expect(container.querySelector('#budget-account-map')).not.toBeNull();
          break;
        case 'credits':
          expect(screen.getByTestId('org-credit-balance')).toBeInTheDocument();
          break;
        case 'usage':
          expect(screen.getAllByRole('table').length).toBeGreaterThan(0);
          break;
        case 'features':
          expect(screen.getAllByRole('switch').length).toBeGreaterThan(0);
          break;
      }
    });
  };

  for (const [section, operator] of [
    ['users', false],
    ['integrations', false],
    ['accounting', false],
    ['credits', false],
    ['usage', true],
    ['features', true],
  ] as const) {
    for (const width of [1280, 390]) {
      it(`AC-A11Y-001: settled ${section} panel at ${width}px has no blocking violations`, async () => {
        isOperatorState.value = operator;
        Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: width });
        const { container } = renderComposed(`/administration/${section}`);
        await waitFor(() =>
          expect(container.querySelector(`[data-testid="administration-panel-${section}"]`)).not.toBeNull(),
        );
        await settledPanel(section, container);
        await expectNoBlockingViolations(container);
      });
    }
  }

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
    await waitFor(() => expect(pageAlertsMatching(/Operator-only/i)).toHaveLength(1));
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
    // Pending shows a status, not a denial message and not the panel.
    expect(pageAlertsMatching(/Operator-only/i)).toHaveLength(0);
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

  for (const role of ['Admin', 'Finance'] as const) {
    for (const width of [1280, 390]) {
      it(`AC-FX-013: ${role} sees the settled Exchange rates route at ${width}px without blocking violations`, async () => {
        roleState.value = role;
        Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: width });
        const { container } = renderComposed('/administration/exchange-rates');
        await waitFor(() => expect(container.querySelector('[data-testid="administration-panel-exchange-rates"]')).not.toBeNull());
        expect(await screen.findByRole('table')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Upload rates' })).toBeInTheDocument();
        if (role === 'Admin') expect(screen.getByRole('button', { name: 'New rate' })).toBeInTheDocument();
        else expect(screen.queryByRole('button', { name: 'New rate' })).not.toBeInTheDocument();
        await expectNoBlockingViolations(document.body);
      });
    }
  }

  it('AC-FX-013: list, manual form, upload preview, rejected rows and save failure are axe-clean', async () => {
    roleState.value = 'Admin';
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1280 });
    const { container } = renderComposed('/administration/exchange-rates');
    await waitFor(() => expect(container.querySelector('[data-testid="administration-panel-exchange-rates"]')).not.toBeNull());
    await screen.findByRole('table');
    await expectNoBlockingViolations(document.body);

    await userEvent.click(screen.getByRole('button', { name: 'New rate' }));
    await screen.findByRole('dialog', { name: 'New rate' });
    expect(screen.getByLabelText(/Publication date/)).toBeInTheDocument();
    expect(screen.getByLabelText(/IDR per USD/)).toBeInTheDocument();
    await expectNoBlockingViolations(document.body);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New rate' })).not.toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Upload rates' }));
    const fileInput = screen.getByLabelText('Choose BI Excel or date,rate CSV');
    fireEvent.change(fileInput, { target: { files: [new File(['date,rate\n2026-10-12,16300'], 'rates.csv', { type: 'text/csv' })] } });
    await screen.findByText('1 new');
    await expectNoBlockingViolations(document.body);

    fireEvent.change(fileInput, { target: { files: [new File(['date,rate\n2026-10-13,not-a-rate'], 'rejected.csv', { type: 'text/csv' })] } });
    await screen.findByText(/Row 2: Enter a rate/i);
    await expectNoBlockingViolations(document.body);

    fireEvent.change(fileInput, { target: { files: [new File(['date,rate\n2026-10-12,16300'], 'retry.csv', { type: 'text/csv' })] } });
    await screen.findByText('1 new');
    fxState.upsert.mockRejectedValueOnce(new Error('offline'));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Save rates' }));
    await screen.findByText(/Your rates were not saved/i);
    expect(screen.getAllByText('16,300').length).toBeGreaterThan(0);
    await expectNoBlockingViolations(document.body);
  });

  it('AC-FX-013: upload Cancel and Escape return focus to the Upload opener', async () => {
    roleState.value = 'Admin';
    renderComposed('/administration/exchange-rates');
    const opener = await screen.findByRole('button', { name: 'Upload rates' });
    await userEvent.click(opener);
    await screen.findByRole('dialog', { name: 'Upload rates' });
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(document.activeElement).toBe(opener));

    await userEvent.click(opener);
    await screen.findByRole('dialog', { name: 'Upload rates' });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });
});
