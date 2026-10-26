/**
 * ProjectKanbanBoard unit tests.
 * ADR-0010: the unit layer owns these — lowest sufficient layer for
 * component/render/grouping/keyboard behavior.
 *
 * Owning ACs (traceability — see PR #96 table):
 *   AC-PK-001  five lifecycle columns render in DOM order (Won → Ongoing → On Hold → Close Out → Internal)
 *   AC-PK-002  a project lands ONLY in its status column (present here, absent from the others)
 *   AC-PK-003  clicking a card calls onOpen → navigates to /projects/:id
 *   AC-PK-004  a zero-project column still renders (empty header + empty message)
 *   AC-PK-006  keyboard: focus a card + press Enter → onOpen → navigates to /projects/:id
 *   AC-PK-009  each card shows the project name, customer, and PM
 * (AC-PK-005 is the e2e journey; AC-PK-007 useProjectView round-trip; AC-PK-008 ViewToggle.)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

/** Minimal ProjectWithRefs factory. */
function mkProject(overrides: Partial<ProjectWithRefs> & { id: string; name: string; status: string }): ProjectWithRefs {
  return {
    org_id: 'org-1',
    code: null,
    client_id: null,
    project_manager_id: null,
    contract_value: 0, currency: 'USD',
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
  mkProject({ id: 'p1', name: 'Alpha Build', status: 'Won, Pending KoM', client: { name: 'Acme Corp' }, project_manager_id: 'pm-alice', pm: { full_name: 'Alice PM' }, contract_value: 1_000_000, currency: 'USD', tax_treatment: 'exclusive' }),
  mkProject({ id: 'p2', name: 'Beta Deploy', status: 'Ongoing Project', client: { name: 'Beta LLC' }, project_manager_id: 'pm-bob', pm: { full_name: 'Bob PM' }, contract_value: 2_000_000, currency: 'USD' }),
  mkProject({ id: 'p3', name: 'Gamma Maintain', status: 'On Hold', client: { name: 'Gamma Inc' }, project_manager_id: 'pm-alice', pm: { full_name: 'Alice PM' }, contract_value: 500_000, currency: 'USD' }),
  mkProject({ id: 'p4', name: 'Delta Close', status: 'Close Out', client: { name: 'Delta Co' }, project_manager_id: 'pm-bob', pm: { full_name: 'Bob PM' }, contract_value: 3_000_000, currency: 'USD' }),
  mkProject({ id: 'p5', name: 'Internal Labs', status: 'Internal Project', project_manager_id: 'pm-alice', pm: { full_name: 'Alice PM' }, contract_value: 0, currency: 'USD' }),
];

/** Lifecycle column order + the project that belongs in each. */
const COLUMN_ORDER = ['kanban-col-won', 'kanban-col-ongoing', 'kanban-col-onhold', 'kanban-col-closeout', 'kanban-col-internal'];
const PROJECT_BY_COLUMN: Record<string, string> = {
  'kanban-col-won': 'Alpha Build',
  'kanban-col-ongoing': 'Beta Deploy',
  'kanban-col-onhold': 'Gamma Maintain',
  'kanban-col-closeout': 'Delta Close',
  'kanban-col-internal': 'Internal Labs',
};

const renderBoard = (
  ps: ProjectWithRefs[] = projects,
  onOpen: (project: ProjectWithRefs) => void = vi.fn(),
) => {
  render(<ProjectKanbanBoard projects={ps} onOpen={onOpen} />);
  return onOpen;
};

describe('ProjectKanbanBoard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('H-09: kanban opening control visibly shows the full contractual project identity', () => {
    renderBoard([mkProject({ id: 'alias', name: 'Contractual delivery project', short_name: 'North Terminal', status: 'Ongoing Project' })]);
    const card = screen.getByRole('button', { name: /Open project Contractual delivery project/ });
    expect(within(card).getByText('Contractual delivery project')).toBeVisible();
  });

  it('AC-CODE-003: Kanban card keeps both project identifiers visibly labelled', async () => {
    renderBoard([mkProject({ id: 'pn', name: 'Numbered', status: 'Ongoing Project', pmo_project_number: 'PMO-26-0071', code: 'CLIENT-71' })]);
    const card = screen.getByRole('article');
    await userEvent.click(within(card).getByText('Project IDs (2)'));
    expect(within(card).getByText(/PMO Project Number:/)).toBeVisible();
    expect(within(card).getByText('PMO-26-0071')).toBeVisible();
    expect(within(card).getByText(/Client Project Code:/)).toBeVisible();
    expect(within(card).getByText('CLIENT-71')).toBeVisible();
  });

  it('AC-PK-001: renders the five lifecycle columns in DOM order (Won → Ongoing → On Hold → Close Out → Internal)', () => {
    renderBoard();
    // Query ALL column wrappers and assert the DOM order matches the lifecycle order —
    // presence alone is a tautology; order is the real requirement.
    const renderedOrder = screen
      .getAllByTestId(/^kanban-col-/)
      .map((el) => el.getAttribute('data-testid'));
    expect(renderedOrder).toEqual(COLUMN_ORDER);
    expect(screen.getByTestId('project-kanban-board')).toBeInTheDocument();
  });

  it('AC-PK-002: a project lands ONLY in its status column (present in its column, absent from every other)', () => {
    renderBoard();
    for (const colId of COLUMN_ORDER) {
      const projectName = PROJECT_BY_COLUMN[colId];
      // Present in its own column…
      const col = screen.getByTestId(colId);
      expect(within(col).getByText(projectName)).toBeInTheDocument();
      // …and absent from every OTHER column (exclusivity).
      for (const otherId of COLUMN_ORDER) {
        if (otherId === colId) continue;
        const other = screen.getByTestId(otherId);
        expect(within(other).queryByText(projectName)).not.toBeInTheDocument();
      }
    }
  });

  it('AC-PK-003: clicking a card calls onOpen → navigates to /projects/:id', async () => {
    const navigate = vi.fn();
    renderBoard(projects, (p) => navigate(`/projects/${p.id}`));
    // The KanbanCard outer div (role=button, aria-label) is the single activation target.
    const card = screen.getByRole('button', { name: /Alpha Build/i });
    await userEvent.click(card);
    expect(navigate).toHaveBeenCalledWith('/projects/p1');
  });

  it('AC-PK-004: a column with zero projects still renders (empty header + empty message)', () => {
    // Pass projects that leave "On Hold" empty.
    const noHold = projects.filter((p) => p.status !== 'On Hold');
    renderBoard(noHold);
    const holdCol = screen.getByTestId('kanban-col-onhold');
    expect(holdCol).toBeInTheDocument();
    expect(within(holdCol).getByText('On Hold')).toBeInTheDocument();
    expect(within(holdCol).getByText('No projects in On Hold')).toBeInTheDocument();
    expect(within(holdCol).queryByText('Gamma Maintain')).not.toBeInTheDocument();
  });

  it('AC-PK-006: focusing a card and pressing Enter activates onOpen → navigates to /projects/:id', async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    renderBoard(projects, (p) => navigate(`/projects/${p.id}`));
    const card = screen.getByRole('button', { name: /Alpha Build/i });
    // Keyboard journey: focus the card, then activate with Enter (NFR-PK-003 a11y).
    card.focus();
    expect(card).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(navigate).toHaveBeenCalledWith('/projects/p1');
  });

  it('AC-PK-006: pressing Space on a focused card also activates onOpen', async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    renderBoard(projects, (p) => navigate(`/projects/${p.id}`));
    const card = screen.getByRole('button', { name: /Beta Deploy/i });
    card.focus();
    await user.keyboard(' ');
    expect(navigate).toHaveBeenCalledWith('/projects/p2');
  });

  it('AC-PK-009: each card shows the project name and customer, with the PM available in its disclosure', async () => {
    renderBoard();
    const ongoingCol = screen.getByTestId('kanban-col-ongoing');
    expect(within(ongoingCol).getByText('Beta Deploy')).toBeInTheDocument();
    expect(within(ongoingCol).getByText('Beta LLC')).toBeInTheDocument();
    expect(within(ongoingCol).getByText('PM: Bob PM')).toBeVisible();
  });

  it('FR-PRJUX-004/005: Kanban keeps the unnamed-assigned vs unassigned polarity distinct', async () => {
    const polarity = [
      mkProject({ id: 'pa', name: 'Blank PM Card', status: 'Won, Pending KoM', project_manager_id: 'aaaaaaaa-bbbb', pm: { full_name: '   ' } }),
      mkProject({ id: 'pb', name: 'No PM Card', status: 'Ongoing Project', project_manager_id: null }),
    ];
    renderBoard(polarity);
    const won = screen.getByTestId('kanban-col-won');
    expect(within(won).getByText(/PM: Unnamed user · aaaaaaaa/)).toBeVisible();
    const ongoing = screen.getByTestId('kanban-col-ongoing');
    expect(within(ongoing).getByText(/PM: Unassigned/)).toBeVisible();
    // The assigned-blank card must NOT read as unassigned.
    expect(within(won).queryByText('Unassigned')).not.toBeInTheDocument();
  });

  it('AC-PK-004: empty list renders all five columns with no cards', () => {
    renderBoard([]);
    for (const colId of COLUMN_ORDER) {
      expect(screen.getByTestId(colId)).toBeInTheDocument();
    }
    expect(screen.queryByText('Alpha Build')).not.toBeInTheDocument();
  });

  it('shows per-column empty message when a column has no projects', () => {
    renderBoard([]);
    expect(screen.getByText('No projects in Won')).toBeInTheDocument();
    expect(screen.getByText('No projects in Ongoing')).toBeInTheDocument();
  });

  it('the project name opens the record and secondary references stay in a separate disclosure', () => {
    const alpha = { ...projects[0], pmo_project_number: 'PMO-26-7711', code: 'CLIENT-71' } as ProjectWithRefs;
    renderBoard([alpha, ...projects.slice(1)]);
    const open = screen.getByRole('button', { name: 'Open project Alpha Build' });
    expect(open).toHaveTextContent('Alpha Build');
    const card = open.closest('article')!;
    const disclosure = within(card).getByText('Project IDs (2)').closest('summary');
    expect(disclosure).toBeInTheDocument();
    expect(open).not.toContainElement(disclosure);
    fireEvent.click(disclosure!);
    expect(within(card).getByText('PMO-26-7711')).toBeVisible();
    expect(within(card).getByText('CLIENT-71')).toBeVisible();
  });

  it('fires the onScroll handler without throwing (scroll tracking path)', () => {
    renderBoard();
    const scrollEl = document.querySelector('.kanban-scroll');
    if (scrollEl) {
      expect(() => fireEvent.scroll(scrollEl, { target: { scrollLeft: 0 } })).not.toThrow();
    }
    expect(screen.getByTestId('project-kanban-board')).toBeInTheDocument();
  });

  it('stage indicator renders stage names for mobile navigation', () => {
    renderBoard();
    const stageNav = screen.getByRole('navigation', { name: 'Project stages' });
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
    const stageNav = screen.getByRole('navigation', { name: 'Project stages' });
    const ongoingBtn = within(stageNav).getByRole('button', { name: 'Ongoing' });
    await userEvent.click(ongoingBtn);
    expect(screen.getByTestId('project-kanban-board')).toBeInTheDocument();

    Element.prototype.scrollTo = origScrollTo;
  });

  it('contract value appears on each card', () => {
    renderBoard();
    const wonCol = screen.getByTestId('kanban-col-won');
    expect(within(wonCol).getByText('USD 1,000,000')).toBeInTheDocument();
  });

  it('AC-PK-COLOR-001: "Close Out" column dot color is distinct from "Won" — no shared green (DESIGN.md token differentiation)', () => {
    // Won uses hsl(var(--success)) — success-green.
    // Close Out must use a DIFFERENT DESIGN.md token so the two terminal columns are
    // visually distinguishable by color (label also differentiates, but color-redundancy
    // is the required enhancement per backlog debt).
    const { container } = render(<ProjectKanbanBoard projects={projects} onOpen={vi.fn()} />);
    const wonCol = container.querySelector('[data-testid="kanban-col-won"]');
    const closeOutCol = container.querySelector('[data-testid="kanban-col-closeout"]');
    // Each column header contains a span[aria-hidden] that carries the dot color as
    // an inline style background. Grab the first aria-hidden span in each column header.
    const wonDot = wonCol?.querySelector('.kcol-head-sticky span[aria-hidden]') as HTMLElement | null;
    const closeOutDot = closeOutCol?.querySelector('.kcol-head-sticky span[aria-hidden]') as HTMLElement | null;
    expect(wonDot).not.toBeNull();
    expect(closeOutDot).not.toBeNull();
    // They must have DIFFERENT background values — the whole point of this fix.
    expect(wonDot!.style.background).not.toBe(closeOutDot!.style.background);
    // Won must be the success-green token.
    expect(wonDot!.style.background).toBe('hsl(var(--success))');
    // Close Out must NOT be the success-green token (any other DESIGN.md token is acceptable).
    expect(closeOutDot!.style.background).not.toBe('hsl(var(--success))');
  });

});

// ⚑ Bound at the spec review's insistence — removing this label left the whole suite green.
describe('OD-TAX-1 §2: the kanban card value states its basis', () => {
  it("renders the card's own treatment", () => {
    render(<ProjectKanbanBoard projects={projects} onOpen={vi.fn()} />);
    expect(screen.getAllByTestId('tax-basis')[0]).toHaveAttribute('data-tax-basis', 'exclusive');
  });
});
