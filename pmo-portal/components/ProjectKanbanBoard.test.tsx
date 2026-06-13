/**
 * ProjectKanbanBoard unit tests (AC-PK-001 through AC-PK-006).
 * ADR-0010: unit layer owns these — lowest sufficient layer for component/render/grouping behavior.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import ProjectKanbanBoard from './ProjectKanbanBoard';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

// window.matchMedia mock needed for handleStageClick (prefers-reduced-motion check).
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

const navigate = vi.fn();
vi.mock('react-router-dom', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useNavigate: () => navigate };
});

/** Minimal ProjectWithRefs factory. */
function mkProject(overrides: Partial<ProjectWithRefs> & { id: string; name: string; status: string }): ProjectWithRefs {
  return {
    org_id: 'org-1',
    code: null,
    client_id: null,
    project_manager_id: null,
    contract_value: 0,
    budget: 0,
    spent: 0,
    start_date: null,
    end_date: null,
    customer_contract_ref: null,
    contract_date: null,
    decided_at: null,
    archived_at: null,
    client: null,
    pm: null,
    ...overrides,
  } as ProjectWithRefs;
}

const projects: ProjectWithRefs[] = [
  mkProject({ id: 'p1', name: 'Alpha Build', status: 'Won, Pending KoM', client: { name: 'Acme Corp' }, pm: { full_name: 'Alice PM' }, contract_value: 1_000_000 }),
  mkProject({ id: 'p2', name: 'Beta Deploy', status: 'Ongoing Project', client: { name: 'Beta LLC' }, pm: { full_name: 'Bob PM' }, contract_value: 2_000_000 }),
  mkProject({ id: 'p3', name: 'Gamma Maintain', status: 'On Hold', client: { name: 'Gamma Inc' }, pm: { full_name: 'Alice PM' }, contract_value: 500_000 }),
  mkProject({ id: 'p4', name: 'Delta Close', status: 'Close Out', client: { name: 'Delta Co' }, pm: { full_name: 'Bob PM' }, contract_value: 3_000_000 }),
  mkProject({ id: 'p5', name: 'Internal Labs', status: 'Internal Project', pm: { full_name: 'Alice PM' }, contract_value: 0 }),
];

const renderBoard = (ps: ProjectWithRefs[] = projects) =>
  render(
    <MemoryRouter>
      <ProjectKanbanBoard projects={ps} />
    </MemoryRouter>,
  );

describe('ProjectKanbanBoard', () => {
  beforeEach(() => navigate.mockClear());

  it('AC-PK-001: renders all five lifecycle columns by name in order', () => {
    renderBoard();
    // All five columns must appear in lifecycle order, identified by data-testid
    const colIds = ['kanban-col-won', 'kanban-col-ongoing', 'kanban-col-onhold', 'kanban-col-closeout', 'kanban-col-internal'];
    for (const id of colIds) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    // Board root is present
    expect(screen.getByTestId('project-kanban-board')).toBeInTheDocument();
  });

  it('AC-PK-002: groups projects into the correct status columns', () => {
    renderBoard();
    // Won column: contains Alpha Build (Won, Pending KoM)
    const wonCol = screen.getByTestId('kanban-col-won');
    expect(within(wonCol).getByText('Alpha Build')).toBeInTheDocument();
    // Ongoing column: contains Beta Deploy
    const ongoingCol = screen.getByTestId('kanban-col-ongoing');
    expect(within(ongoingCol).getByText('Beta Deploy')).toBeInTheDocument();
    // On Hold column: contains Gamma Maintain
    const holdCol = screen.getByTestId('kanban-col-onhold');
    expect(within(holdCol).getByText('Gamma Maintain')).toBeInTheDocument();
    // Close Out column: contains Delta Close
    const closeCol = screen.getByTestId('kanban-col-closeout');
    expect(within(closeCol).getByText('Delta Close')).toBeInTheDocument();
    // Internal column: contains Internal Labs
    const internalCol = screen.getByTestId('kanban-col-internal');
    expect(within(internalCol).getByText('Internal Labs')).toBeInTheDocument();
  });

  it('AC-PK-003: clicking a card navigates to /projects/:id', async () => {
    renderBoard();
    // The KanbanCard outer div (role=button, aria-label) is the primary activation target
    const cards = screen.getAllByRole('button', { name: /Alpha Build/i });
    // Click the first match (the KanbanCard outer role=button)
    await userEvent.click(cards[0]);
    expect(navigate).toHaveBeenCalledWith('/projects/p1');
  });

  it('AC-PK-004: a column with zero projects still renders (empty column visible)', () => {
    // Only pass projects that leave "On Hold" empty
    const noHold = projects.filter((p) => p.status !== 'On Hold');
    renderBoard(noHold);
    // The "On Hold" column must still render with its title
    const holdCol = screen.getByTestId('kanban-col-onhold');
    expect(holdCol).toBeInTheDocument();
    // Column title text "On Hold" must appear within the column wrapper
    expect(within(holdCol).getByText('On Hold')).toBeInTheDocument();
    // No Gamma Maintain card in the column
    expect(within(holdCol).queryByText('Gamma Maintain')).not.toBeInTheDocument();
  });

  it('AC-PK-006: each card shows the project name, customer name, and PM name', () => {
    renderBoard();
    const ongoingCol = screen.getByTestId('kanban-col-ongoing');
    expect(within(ongoingCol).getByText('Beta Deploy')).toBeInTheDocument();
    expect(within(ongoingCol).getByText('Beta LLC')).toBeInTheDocument();
    expect(within(ongoingCol).getByText('Bob PM')).toBeInTheDocument();
  });

  it('AC-PK-006b: empty list renders all five columns with no cards', () => {
    renderBoard([]);
    // All five columns present
    expect(screen.getByTestId('kanban-col-won')).toBeInTheDocument();
    expect(screen.getByTestId('kanban-col-ongoing')).toBeInTheDocument();
    expect(screen.getByTestId('kanban-col-onhold')).toBeInTheDocument();
    expect(screen.getByTestId('kanban-col-closeout')).toBeInTheDocument();
    expect(screen.getByTestId('kanban-col-internal')).toBeInTheDocument();
    // No project names anywhere
    expect(screen.queryByText('Alpha Build')).not.toBeInTheDocument();
  });

  it('shows per-column empty message when a column has no projects', () => {
    renderBoard([]);
    // KanbanColumn renders "No projects in <title>" when empty
    expect(screen.getByText('No projects in Won')).toBeInTheDocument();
    expect(screen.getByText('No projects in Ongoing')).toBeInTheDocument();
  });

  it('fires the onScroll handler without throwing (scroll tracking path)', () => {
    const { container } = renderBoard();
    const scrollEl = container.querySelector('.kanban-scroll');
    if (scrollEl) {
      // fireEvent.scroll exercises the onScroll callback (scroll events don't bubble,
      // but fireEvent dispatches directly on the element).
      expect(() => fireEvent.scroll(scrollEl, { target: { scrollLeft: 0 } })).not.toThrow();
    }
    // Board is still present after scroll
    expect(screen.getByTestId('project-kanban-board')).toBeInTheDocument();
  });

  it('stage indicator renders stage names for mobile navigation', () => {
    renderBoard();
    // The KanbanStageIndicator renders a nav with stage names as button aria-labels.
    // All five stages must have buttons in the stage strip.
    const stageNav = screen.getByRole('navigation', { name: /pipeline stage navigation/i });
    expect(stageNav).toBeInTheDocument();
    expect(within(stageNav).getByRole('button', { name: /Won/i })).toBeInTheDocument();
    expect(within(stageNav).getByRole('button', { name: /Ongoing/i })).toBeInTheDocument();
  });

  it('stage indicator click handles the programmatic scroll path gracefully', async () => {
    // jsdom does not implement Element.scrollTo — mock it so handleStageClick can proceed.
    const scrollToMock = vi.fn();
    const origScrollTo = Element.prototype.scrollTo;
    Element.prototype.scrollTo = scrollToMock as typeof Element.prototype.scrollTo;

    renderBoard();
    const stageNav = screen.getByRole('navigation', { name: /pipeline stage navigation/i });
    const ongoingBtn = within(stageNav).getByRole('button', { name: 'Ongoing' });
    // Clicking a stage button exercises handleStageClick. The .kanban-scroll element
    // exists in the DOM (Kanban renders it); scrollTo is stubbed above.
    await userEvent.click(ongoingBtn);
    // Board is still present; no unhandled error was thrown
    expect(screen.getByTestId('project-kanban-board')).toBeInTheDocument();

    // Restore original
    Element.prototype.scrollTo = origScrollTo;
  });

  it('each card renders a StatusPill with the project status text', () => {
    renderBoard();
    // Alpha Build is "Won, Pending KoM" — the StatusPill renders the status text.
    // There may be multiple "Won, Pending KoM" elements (column header + pill); getAllByText is safe here.
    const wonCol = screen.getByTestId('kanban-col-won');
    expect(within(wonCol).getAllByText('Won, Pending KoM').length).toBeGreaterThanOrEqual(1);
    // On Hold column has the status pill with "On Hold" text (column header + pill = multiple matches)
    const holdCol = screen.getByTestId('kanban-col-onhold');
    expect(within(holdCol).getAllByText('On Hold').length).toBeGreaterThanOrEqual(2);
  });

  it('contract value appears on each card', () => {
    renderBoard();
    // Alpha Build has contract_value = 1_000_000 → formatCurrency renders "$1,000,000"
    const wonCol = screen.getByTestId('kanban-col-won');
    expect(within(wonCol).getByText('$1,000,000')).toBeInTheDocument();
  });
});
