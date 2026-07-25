/**
 * BudgetTab — ⚑ LOW-2(a) (money-safety audit round 7): the ERP projection panel is mounted ONLY for an
 * org that actually employs ERPNext.
 *
 * `<BudgetProjection>` is a view onto an EXTERNAL system's enforcement state. For an org that is not on
 * the ERPNext tier there is never a mirror row, never an actuals snapshot and never an ETC control (it
 * renders inside `rows.map`), so the panel is permanently its own empty state — whose remedy copy tells
 * the user to "push it to the ERP", a route they do not have. An instruction the reader cannot follow is
 * worse than an absent panel: it implies their data is incomplete when nothing is wrong.
 *
 * ⚑ THE EMPLOY SIGNAL (FR-BUD-006(a)/FR-BUD-010): employment is the ACTIVE ERPNext BINDING, never a
 * `domain_externally_owned('budget')` flip (the spec forbids that row ever existing). So the gate is
 * `useErpnextBinding()` — an active erpnext binding — mirroring the server-side `orgEmploysErpnext`
 * predicate, not the ownership table.
 *
 * PMO's own budget grid (`<ProjectBudget>`) is unconditional — it is PMO-SoT and every org gets it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

const { bindingMock } = vi.hoisted(() => ({ bindingMock: vi.fn() }));

vi.mock('@/src/hooks/useErpnextBinding', () => ({
  useErpnextBinding: bindingMock,
}));

vi.mock('../../ProjectBudget', () => ({
  default: () => <div data-testid="pmo-budget-grid">PMO budget grid</div>,
}));
vi.mock('../../BudgetProjection', () => ({
  default: () => <div data-testid="erp-projection-panel">ERP projection</div>,
}));

import BudgetTab from './BudgetTab';

const binding = (status: 'active' | 'disconnected') => ({
  org_id: 'org-1',
  external_tier: 'erpnext',
  site_url: 'https://erp.example.test',
  secret_ref: 'ref',
  status,
  connected_by: null,
  connected_at: null,
  disconnected_at: null,
  config: {},
});

beforeEach(() => {
  bindingMock.mockReset();
});

describe('BudgetTab mounts the ERP projection only where it can mean something', () => {
  it('LOW-2 an org with an ACTIVE erpnext binding gets the ERP projection panel', async () => {
    bindingMock.mockReturnValue({ data: binding('active'), isSuccess: true });

    render(<BudgetTab projectId="proj-1" />);

    expect(await screen.findByTestId('erp-projection-panel')).toBeInTheDocument();
    expect(screen.getByTestId('pmo-budget-grid')).toBeInTheDocument();
  });

  it('LOW-2 an org with NO erpnext binding never sees the panel — its remedy copy would be unfollowable', async () => {
    // A real non-ERP org: no erpnext binding at all (it may still employ some OTHER tier for OTHER domains).
    bindingMock.mockReturnValue({ data: null, isSuccess: true });

    render(<BudgetTab projectId="proj-1" />);

    // PMO's own budget is never gated — it is PMO-SoT and has nothing to do with any external system.
    expect(await screen.findByTestId('pmo-budget-grid')).toBeInTheDocument();
    expect(screen.queryByTestId('erp-projection-panel'), 'no permanently-empty ERP panel').not.toBeInTheDocument();
  });

  it('LOW-2 a DISCONNECTED erpnext binding is not an active employ — the panel stays unmounted', async () => {
    bindingMock.mockReturnValue({ data: binding('disconnected'), isSuccess: true });

    render(<BudgetTab projectId="proj-1" />);

    expect(await screen.findByTestId('pmo-budget-grid')).toBeInTheDocument();
    expect(screen.queryByTestId('erp-projection-panel')).not.toBeInTheDocument();
  });

  it('LOW-2 while the binding is still unknown the panel stays unmounted — never a flash of an empty ERP panel', async () => {
    bindingMock.mockReturnValue({ data: undefined, isSuccess: false });

    render(<BudgetTab projectId="proj-1" />);

    expect(await screen.findByTestId('pmo-budget-grid')).toBeInTheDocument();
    expect(screen.queryByTestId('erp-projection-panel')).not.toBeInTheDocument();
  });

  it('LOW-2 a binding read that FAILS does not mount the panel either — fail closed, no unfollowable advice', async () => {
    bindingMock.mockReturnValue({ data: undefined, isSuccess: false, isError: true });

    render(<BudgetTab projectId="proj-1" />);

    await waitFor(() => expect(screen.getByTestId('pmo-budget-grid')).toBeInTheDocument());
    expect(screen.queryByTestId('erp-projection-panel')).not.toBeInTheDocument();
  });
});
