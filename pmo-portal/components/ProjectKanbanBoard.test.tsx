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

  it('CW-3b: each project renders the shared canonical ProjectCardShell (one project-card vocabulary)', () => {
    renderBoard();
    // The shared shell stamps every card with the canonical `project-card` testid — the SAME
    // molecule the Projects cards-view and Sales pipeline board use.
    const cards = screen.getAllByTestId('project-card');
    expect(cards).toHaveLength(projects.length);
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

  it('AC-PK-009: each card shows the project name, customer name, and PM name', () => {
    renderBoard();
    const ongoingCol = screen.getByTestId('kanban-col-ongoing');
    expect(within(ongoingCol).getByText('Beta Deploy')).toBeInTheDocument();
    expect(within(ongoingCol).getByText('Beta LLC')).toBeInTheDocument();
    expect(within(ongoingCol).getByText('Bob PM')).toBeInTheDocument();
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

  it('the card is the single activation target — no nested inner button (a11y)', () => {
    renderBoard();
    // Exactly one role=button per project card (the KanbanCard). The project name is
    // plain text, NOT a nested <button> (which would be a button-in-role=button).
    const card = screen.getByRole('button', { name: /Alpha Build/i });
    expect(within(card).queryByRole('button')).toBeNull();
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
    await userEvent.click(ongoingBtn);
    expect(screen.getByTestId('project-kanban-board')).toBeInTheDocument();

    Element.prototype.scrollTo = origScrollTo;
  });

  it('each card renders a StatusPill with the project status text', () => {
    renderBoard();
    const wonCol = screen.getByTestId('kanban-col-won');
    expect(within(wonCol).getAllByText('Won, Pending KoM').length).toBeGreaterThanOrEqual(1);
    const holdCol = screen.getByTestId('kanban-col-onhold');
    expect(within(holdCol).getAllByText('On Hold').length).toBeGreaterThanOrEqual(2);
  });

  it('contract value appears on each card', () => {
    renderBoard();
    const wonCol = screen.getByTestId('kanban-col-won');
    expect(within(wonCol).getByText('$1,000,000')).toBeInTheDocument();
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

  // ─── A-MIN-2: first-scroll affordance ────────────────────────────────────
  // The swipe-hint chip must:
  //   - render (in DOM) at initial state so CSS md:hidden can hide it on desktop
  //   - be aria-hidden (decorative, never part of the AT navigation)
  //   - disappear (CSS class or hidden state) after the board has been scrolled
  // jsdom has no layout engine, so "overflowing" is simulated by patching
  // scrollLeft tracking via the onScroll handler the hook already wires up.

  describe('A-MIN-2: swipe-hint affordance', () => {
    it('renders the swipe-hint element on initial mount (before any scroll)', () => {
      renderBoard();
      // The hint must exist in the DOM so it is visible on mobile before first scroll.
      const hint = screen.getByTestId('swipe-hint');
      expect(hint).toBeInTheDocument();
      expect(hint.className).toMatch(/shadow-\[0_1px_2px_hsl\(var\(--foreground\)\/0\.06\)\]/);
      expect(hint.className).not.toMatch(/240_6%_10%/);
    });

    it('swipe-hint is aria-hidden (decorative — real navigation is the scroll container)', () => {
      renderBoard();
      const hint = screen.getByTestId('swipe-hint');
      expect(hint).toHaveAttribute('aria-hidden', 'true');
    });

    it('swipe-hint disappears after the user scrolls (hasScrolled → hidden)', () => {
      renderBoard();
      // The hint starts visible — no opacity-0 class.
      const hintBefore = screen.getByTestId('swipe-hint');
      expect(hintBefore).toBeInTheDocument();
      expect(hintBefore.className).not.toMatch(/opacity-0/);

      // Simulate the user swiping: fire a synthetic scroll on the .kanban-scroll
      // element.  jsdom has no layout so scrollLeft on the element is always 0;
      // patch currentTarget.scrollLeft so the hook's onScroll sees a non-zero value.
      const scrollEl = document.querySelector('.kanban-scroll')!;
      // Define scrollLeft as a getter that returns 100 for this element.
      Object.defineProperty(scrollEl, 'scrollLeft', { configurable: true, get: () => 100 });
      fireEvent.scroll(scrollEl);

      // After scrolling, hasScrolled becomes true and the hint must carry opacity-0
      // (the CSS class that makes it invisible; it remains in the DOM for transition).
      const hintAfter = screen.getByTestId('swipe-hint');
      expect(hintAfter.className).toMatch(/opacity-0/);
    });

    it('swipe-hint contains meaningful text for sighted users', () => {
      renderBoard();
      const hint = screen.getByTestId('swipe-hint');
      // Must surface a directional cue — some form of "swipe" or arrow/→.
      expect(hint.textContent).toMatch(/swipe|→|more/i);
    });
  });
});
