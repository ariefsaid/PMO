/**
 * AC-JR-W1-06 — DecisionSupportPanel heading project name links
 *
 * The "Budget impact · {projectName}" heading in the DSP must render the
 * project name as a link to /projects/:id (not inert text). Also asserts
 * an explicit "Open project budget" affordance (link to /projects/:id).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';

// ---------------------------------------------------------------------------
// Stubs for the hooks used inside DecisionSupportPanel
// ---------------------------------------------------------------------------
const budgetState = { data: 500000 as number | undefined, isPending: false, isError: false };
const committedState = { data: 100000 as number | undefined, isPending: false, isError: false };
const reservedState = { data: 0 as number | undefined, isPending: false, isError: false };

vi.mock('@/src/hooks/useBudget', () => ({
  useProjectBudget: () => budgetState,
}));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProjectCommittedSpend: () => committedState,
  useProjectReservedSpend: () => reservedState,
}));

import { DecisionSupportPanel } from '../DecisionSupportPanel';

// Wrapper renders at status 'Requested' (a panel-visible status) so these heading /
// link tests stay visible after the ADR-0034 visibility boundary was added.
const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

beforeEach(() => {
  budgetState.data = 500000;
  budgetState.isPending = false;
  budgetState.isError = false;
  committedState.data = 100000;
  committedState.isPending = false;
  committedState.isError = false;
  reservedState.data = 0;
  reservedState.isPending = false;
  reservedState.isError = false;
});

// ---------------------------------------------------------------------------
// AC-JR-W1-06: heading project name is a link to /projects/:id
// ---------------------------------------------------------------------------
describe('AC-JR-W1-06: DecisionSupportPanel heading project name links', () => {
  it('AC-JR-W1-06: renders the project name as a link to /projects/:id in the heading', () => {
    wrap(
      <DecisionSupportPanel
        projectId="p1"
        totalValue={25000}
        projectName="Bridge Alpha"
        status="Requested"
      />,
    );
    const link = screen.getByRole('link', { name: /Open Bridge Alpha/i });
    expect(link).toBeDefined();
    expect(link.getAttribute('href')).toBe('/projects/p1');
  });

  it('AC-JR-W1-06: renders an "Open project budget" affordance linking to /projects/:id', () => {
    wrap(
      <DecisionSupportPanel
        projectId="p1"
        totalValue={25000}
        projectName="Bridge Alpha"
        status="Requested"
      />,
    );
    const openBudgetLink = screen.getByRole('link', { name: /open project/i });
    expect(openBudgetLink).toBeDefined();
    expect(openBudgetLink.getAttribute('href')).toBe('/projects/p1');
  });

  it('AC-JR-W1-06: heading and budget link both present when data loaded', () => {
    wrap(
      <DecisionSupportPanel
        projectId="proj-42"
        totalValue={10000}
        projectName="Solar Farm"
        status="Requested"
      />,
    );
    // Heading link
    const nameLink = screen.getByRole('link', { name: /Open Solar Farm/i });
    expect(nameLink.getAttribute('href')).toBe('/projects/proj-42');
    // Budget link
    const budgetLink = screen.getByRole('link', { name: /open project/i });
    expect(budgetLink.getAttribute('href')).toBe('/projects/proj-42');
  });

  it('AC-JR-W1-06: suppresses (returns null) when projectId is null', () => {
    const { container } = wrap(
      <DecisionSupportPanel
        projectId={null}
        totalValue={25000}
        projectName="Bridge Alpha"
        status="Requested"
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('AC-JR-W1-06: loading state shows skeleton without links', () => {
    budgetState.isPending = true;
    wrap(
      <DecisionSupportPanel
        projectId="p1"
        totalValue={25000}
        projectName="Bridge Alpha"
        status="Requested"
      />,
    );
    // Loading skeleton is rendered; no "Open project budget" link yet
    expect(screen.getByLabelText('Loading budget impact')).toBeDefined();
    expect(screen.queryByRole('link', { name: /open project/i })).toBeNull();
  });

  it('AC-JR-W1-06: error state shows budget unavailable without links', () => {
    budgetState.isError = true;
    budgetState.isPending = false;
    wrap(
      <DecisionSupportPanel
        projectId="p1"
        totalValue={25000}
        projectName="Bridge Alpha"
        status="Requested"
      />,
    );
    expect(screen.getByText(/budget unavailable/i)).toBeDefined();
    expect(screen.queryByRole('link', { name: /open project/i })).toBeNull();
  });

  it('AC-JR-W1-06: no active budget shows advisory without "Open project budget" link', () => {
    budgetState.data = 0;
    wrap(
      <DecisionSupportPanel
        projectId="p1"
        totalValue={25000}
        projectName="Bridge Alpha"
        status="Requested"
      />,
    );
    expect(screen.getByText(/No active budget/i)).toBeDefined();
    expect(screen.queryByRole('link', { name: /open project/i })).toBeNull();
  });
});
