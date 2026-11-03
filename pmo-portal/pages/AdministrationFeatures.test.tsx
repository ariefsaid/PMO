/**
 * AC-PLN-012 [Vitest] — the Operator console (FR-PLN-013).
 *
 * The console is the only place an Operator sees the registry. This suite binds each control to the
 * RPC it must call, and to the data it must show:
 *   - every key's EFFECTIVE state and its SOURCE (global / override / plan / core);
 *   - the per-org override (set + clear) and the all-orgs switch, which outranks every org and
 *     therefore asks for confirmation before turning OFF;
 *   - the plan picker, the plan-defaults matrix and the limits editor;
 *   - loading and failure states hold the controls (a toggle over an unknown state is how the wrong
 *     thing gets flipped).
 *
 * The RPCs are mocked at the REPOSITORY seam (`repositories.orgFeature.*`), which is also the
 * contract the DAL is proven against elsewhere — no component test re-implements an RPC.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';

const { api } = vi.hoisted(() => ({
  api: {
    listForOrg: vi.fn(),
    getPlanCatalogue: vi.fn(),
    getOrgPlan: vi.fn(),
    listOverrides: vi.fn(),
    listOperatorOrgs: vi.fn(),
    toggle: vi.fn(),
    clearOverride: vi.fn(),
    setOrgPlan: vi.fn(),
    setGlobal: vi.fn(),
    setPlanFeature: vi.fn(),
    setPlanLimits: vi.fn(),
  },
}));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Admin' }),
}));

vi.mock('@/src/lib/repositories', () => ({
  repositories: {
    orgFeature: {
      listForOrg: (...a: unknown[]) => api.listForOrg(...a),
      getPlanCatalogue: () => api.getPlanCatalogue(),
      getOrgPlan: (...a: unknown[]) => api.getOrgPlan(...a),
      listOverrides: (...a: unknown[]) => api.listOverrides(...a),
      toggle: (...a: unknown[]) => api.toggle(...a),
      clearOverride: (...a: unknown[]) => api.clearOverride(...a),
      setOrgPlan: (...a: unknown[]) => api.setOrgPlan(...a),
      setGlobal: (...a: unknown[]) => api.setGlobal(...a),
      setPlanFeature: (...a: unknown[]) => api.setPlanFeature(...a),
      setPlanLimits: (...a: unknown[]) => api.setPlanLimits(...a),
    },
    usage: {
      listOperatorOrgs: () => api.listOperatorOrgs(),
    },
  },
}));

import AdministrationFeatures from './AdministrationFeatures';

const resolved = () => ({
  display: { incidents: true, crm: true, stock: false, feedback_surveys: true, projects: true },
  states: {
    incidents: { enabled: true, displayEnabled: true, source: 'override' },
    crm: { enabled: true, displayEnabled: true, source: 'plan' },
    stock: { enabled: false, displayEnabled: false, source: 'global' },
    feedback_surveys: { enabled: true, displayEnabled: true, source: 'plan' },
    projects: { enabled: true, displayEnabled: true, source: 'core' },
  },
});

const catalogue = () => ({
  plans: [
    { planId: 'starter', name: 'Starter', seatLimit: 10, projectLimit: 25, aiMonthlyMessages: 300 },
    { planId: 'enterprise', name: 'Enterprise', seatLimit: null, projectLimit: null, aiMonthlyMessages: null },
  ],
  defaults: {
    starter: { incidents: true, crm: true, stock: false, feedback_surveys: true },
    enterprise: { incidents: true, crm: true, stock: true, feedback_surveys: true },
  },
  global: { incidents: true, crm: true, stock: false, feedback_surveys: null },
});

const makeQc = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

const renderConsole = () =>
  render(
    <QueryClientProvider client={makeQc()}>
      <ToastProvider>
        <AdministrationFeatures isOperator orgId="org-1" />
      </ToastProvider>
    </QueryClientProvider>,
  );

beforeEach(() => {
  api.listForOrg.mockResolvedValue(resolved());
  api.getPlanCatalogue.mockResolvedValue(catalogue());
  api.getOrgPlan.mockResolvedValue('starter');
  api.listOverrides.mockResolvedValue(['incidents']);
  api.listOperatorOrgs.mockResolvedValue([
    { id: 'org-1', name: 'Acme' },
    { id: 'org-2', name: 'Beta' },
  ]);
  api.toggle.mockResolvedValue(undefined);
  api.clearOverride.mockResolvedValue(undefined);
  api.setOrgPlan.mockResolvedValue(undefined);
  api.setGlobal.mockResolvedValue(undefined);
  api.setPlanFeature.mockResolvedValue(undefined);
  api.setPlanLimits.mockResolvedValue(undefined);
});

describe('AC-PLN-012 — Operator console', () => {
  it('AC-PLN-012: each key shows its effective state AND its source', async () => {
    renderConsole();
    await screen.findByTestId('feature-row-incidents');
    expect(screen.getByTestId('effective-incidents')).toHaveTextContent('On');
    expect(screen.getByTestId('source-incidents')).toHaveTextContent('Override');

    expect(screen.getByTestId('effective-stock')).toHaveTextContent('Off');
    expect(screen.getByTestId('source-stock')).toHaveTextContent('All organisations');

    expect(screen.getByTestId('source-crm')).toHaveTextContent('Plan');
  });

  it('AC-PLN-012: the override toggle calls the override RPC with the flipped state', async () => {
    renderConsole();
    const incidents = await screen.findByTestId('feature-row-incidents');
    fireEvent.click(within(incidents).getByRole('switch', { name: /override for this organisation/i }));
    await waitFor(() =>
      expect(api.toggle).toHaveBeenCalledWith({ orgId: 'org-1', key: 'incidents', enabled: false }),
    );
  });

  it('AC-PLN-012: an override can be cleared, and the control only appears when one exists', async () => {
    renderConsole();
    const incidents = await screen.findByTestId('feature-row-incidents');
    fireEvent.click(within(incidents).getByRole('button', { name: /clear/i }));
    await waitFor(() => expect(api.clearOverride).toHaveBeenCalledWith({ orgId: 'org-1', key: 'incidents' }));
    // A plan-sourced key has no override to clear.
    const crm = screen.getByTestId('feature-row-crm');
    expect(within(crm).queryByRole('button', { name: /clear/i })).toBeNull();
  });

  it('AC-PLN-012: the plan picker assigns the selected plan', async () => {
    renderConsole();
    const planSelect = await screen.findByLabelText('Plan');
    fireEvent.change(planSelect, { target: { value: 'enterprise' } });
    await waitFor(() => expect(api.setOrgPlan).toHaveBeenCalledWith({ orgId: 'org-1', planId: 'enterprise' }));
  });

  it('AC-PLN-012: the all-orgs column reflects the global switch and turning it ON writes immediately', async () => {
    renderConsole();
    const stock = await screen.findByTestId('feature-row-stock');
    const globalSwitch = within(stock).getByRole('switch', { name: /switch for all organisations/i });
    expect(globalSwitch).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(globalSwitch);
    await waitFor(() => expect(api.setGlobal).toHaveBeenCalledWith({ key: 'stock', enabled: true }));
  });

  it('AC-PLN-012: turning an all-orgs switch OFF asks first, then writes on confirmation', async () => {
    renderConsole();
    const crm = await screen.findByTestId('feature-row-crm');
    fireEvent.click(within(crm).getByRole('switch', { name: /switch for all organisations/i }));
    // Nothing written until the Operator confirms a platform-wide off.
    expect(api.setGlobal).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: /switch off for all/i }));
    await waitFor(() => expect(api.setGlobal).toHaveBeenCalledWith({ key: 'crm', enabled: false }));
  });

  it('AC-PLN-012: the console shows plan defaults and writes a plan-default change', async () => {
    renderConsole();
    await screen.findByTestId('feature-row-crm');
    // 'crm' is enabled in the starter matrix; flipping it writes the plan default (plan editor = starter).
    const planDefaultSwitch = within(screen.getByTestId('plan-default-crm')).getByRole('switch');
    fireEvent.click(planDefaultSwitch);
    await waitFor(() =>
      expect(api.setPlanFeature).toHaveBeenCalledWith({ planId: 'starter', key: 'crm', enabled: false }),
    );
  });

  it('AC-PLN-012: the limits editor writes numbers, and blank means "per contract"', async () => {
    renderConsole();
    const seats = await screen.findByLabelText('Included seats');
    fireEvent.change(seats, { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: /save limits/i }));
    await waitFor(() =>
      expect(api.setPlanLimits).toHaveBeenCalledWith({
        planId: 'starter',
        seatLimit: 12,
        projectLimit: 25,
        aiMonthlyMessages: 300,
      }),
    );
  });

  it('AC-PLN-012: the table plan default follows the inspected organisation, not the plan editor', async () => {
    renderConsole();
    await screen.findByTestId('feature-row-stock');
    // 'stock' is off in the Starter matrix the inspected org is on; Enterprise enables it.
    expect(screen.getByTestId('plan-default-cell-stock')).toHaveTextContent('Off');
    fireEvent.change(screen.getByLabelText('Plan to edit'), { target: { value: 'enterprise' } });
    // The editor moves, but every org-scoped number in the table still describes THIS organisation.
    expect(screen.getByTestId('plan-default-cell-stock')).toHaveTextContent('Off');
    await waitFor(() =>
      expect(within(screen.getByTestId('plan-default-stock')).getByRole('switch')).toHaveAttribute(
        'aria-checked',
        'true',
      ),
    );
  });

  it('AC-PLN-012: an unassigned organisation shows the Enterprise defaults the resolver applies', async () => {
    api.getOrgPlan.mockResolvedValue(null);
    renderConsole();
    await screen.findByTestId('feature-row-stock');
    // No org_plans row means Enterprise, the same fallback the resolver uses (0532:150).
    await waitFor(() => expect(screen.getByTestId('plan-default-cell-stock')).toHaveTextContent('On'));
  });

  it('AC-PLN-012: a limit draft never saves to a different plan after the organisation changes', async () => {
    api.getOrgPlan.mockImplementation((orgId: unknown) =>
      Promise.resolve(orgId === 'org-2' ? 'enterprise' : 'starter'),
    );
    renderConsole();
    const seats = await screen.findByLabelText('Included seats');
    // An unsaved draft typed against Starter.
    fireEvent.change(seats, { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText('Organisation'), { target: { value: 'org-2' } });
    // Org-2 is on Enterprise: the editor follows it and the Starter draft must not come along.
    await waitFor(() => expect(screen.getByLabelText('Organisation')).toHaveValue('org-2'));
    const enterpriseSeats = await screen.findByLabelText('Included seats');
    expect((enterpriseSeats as HTMLInputElement).value).toBe('');
    fireEvent.click(screen.getByRole('button', { name: /save limits/i }));
    await waitFor(() =>
      expect(api.setPlanLimits).toHaveBeenCalledWith({
        planId: 'enterprise',
        seatLimit: null,
        projectLimit: null,
        aiMonthlyMessages: null,
      }),
    );
  });

  it('AC-PLN-012: an override stays clearable while the all-orgs off switch outranks it', async () => {
    api.listOverrides.mockResolvedValue(['stock']);
    renderConsole();
    const stock = await screen.findByTestId('feature-row-stock');
    // The effective state comes from the global kill switch, but the override row still exists.
    expect(within(stock).getByTestId('source-stock')).toHaveTextContent('All organisations');
    fireEvent.click(within(stock).getByRole('button', { name: /clear/i }));
    await waitFor(() => expect(api.clearOverride).toHaveBeenCalledWith({ orgId: 'org-1', key: 'stock' }));
  });

  it('AC-PLN-012: the Admin-owned feedback switch is read-only here (no override or global control)', async () => {
    renderConsole();
    const feedback = await screen.findByTestId('feature-row-feedback_surveys');
    expect(within(feedback).queryByRole('switch')).toBeNull();
    expect(within(feedback).getAllByText('Admin-owned').length).toBeGreaterThan(0);
  });

  it('AC-PLN-012: a failed catalogue read holds the console — no toggle is offered over an unknown state', async () => {
    api.getPlanCatalogue.mockRejectedValue(Object.assign(new Error('boom'), { code: 'PGRST301' }));
    renderConsole();
    expect(await screen.findByText(/plan registry could not be loaded/i)).toBeInTheDocument();
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('AC-PLN-012: a non-Operator gets the read-only own-org list and no controls', async () => {
    render(
      <QueryClientProvider client={makeQc()}>
        <ToastProvider>
          <AdministrationFeatures isOperator={false} orgId="org-1" />
        </ToastProvider>
      </QueryClientProvider>,
    );
    expect(screen.queryByRole('switch')).toBeNull();
  });
});
