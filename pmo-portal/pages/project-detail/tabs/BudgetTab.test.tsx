/**
 * BudgetTab — ⚑ LOW-2(a) (money-safety audit round 7): the ERP projection panel is mounted ONLY for an
 * org that actually employs the `budget` domain externally.
 *
 * `<BudgetProjection>` is a view onto an EXTERNAL system's enforcement state. For an org that is not on
 * the ERPNext tier there is never a mirror row, never an actuals snapshot and never an ETC control (it
 * renders inside `rows.map`), so the panel is permanently its own empty state — whose remedy copy tells
 * the user to "push it to the ERP", a route they do not have. An instruction the reader cannot follow is
 * worse than an absent panel: it implies their data is incomplete when nothing is wrong.
 *
 * PMO's own budget grid (`<ProjectBudget>`) is unconditional — it is PMO-SoT and every org gets it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

const { ownershipMock } = vi.hoisted(() => ({ ownershipMock: vi.fn() }));

vi.mock('@/src/hooks/useExternalDomainOwnership', () => ({
  useExternalDomainOwnership: ownershipMock,
}));

vi.mock('../../ProjectBudget', () => ({
  default: () => <div data-testid="pmo-budget-grid">PMO budget grid</div>,
}));
vi.mock('../../BudgetProjection', () => ({
  default: () => <div data-testid="erp-projection-panel">ERP projection</div>,
}));

import BudgetTab from './BudgetTab';

const row = (domain: string, externalTier = 'erpnext') => ({ id: `${externalTier}:${domain}`, orgId: 'org-1', externalTier, domain });

beforeEach(() => {
  ownershipMock.mockReset();
});

describe('BudgetTab mounts the ERP projection only where it can mean something', () => {
  it('LOW-2 an org that employs the `budget` domain gets the ERP projection panel', async () => {
    ownershipMock.mockReturnValue({ data: [row('budget')], isSuccess: true });

    render(<BudgetTab projectId="proj-1" />);

    expect(await screen.findByTestId('erp-projection-panel')).toBeInTheDocument();
    expect(screen.getByTestId('pmo-budget-grid')).toBeInTheDocument();
  });

  it('LOW-2 an org that employs NO external budget domain never sees the panel — its remedy copy would be unfollowable', async () => {
    // A real non-ERP org: it may still employ some OTHER domain on some OTHER tier.
    ownershipMock.mockReturnValue({ data: [row('tasks', 'clickup')], isSuccess: true });

    render(<BudgetTab projectId="proj-1" />);

    // PMO's own budget is never gated — it is PMO-SoT and has nothing to do with any external system.
    expect(await screen.findByTestId('pmo-budget-grid')).toBeInTheDocument();
    expect(screen.queryByTestId('erp-projection-panel'), 'no permanently-empty ERP panel').not.toBeInTheDocument();
  });

  it('LOW-2 while ownership is still unknown the panel stays unmounted — never a flash of an empty ERP panel', async () => {
    ownershipMock.mockReturnValue({ data: undefined, isSuccess: false });

    render(<BudgetTab projectId="proj-1" />);

    expect(await screen.findByTestId('pmo-budget-grid')).toBeInTheDocument();
    expect(screen.queryByTestId('erp-projection-panel')).not.toBeInTheDocument();
  });

  it('LOW-2 an ownership read that FAILS does not mount the panel either — fail closed, no unfollowable advice', async () => {
    ownershipMock.mockReturnValue({ data: undefined, isSuccess: false, isError: true });

    render(<BudgetTab projectId="proj-1" />);

    await waitFor(() => expect(screen.getByTestId('pmo-budget-grid')).toBeInTheDocument());
    expect(screen.queryByTestId('erp-projection-panel')).not.toBeInTheDocument();
  });
});
