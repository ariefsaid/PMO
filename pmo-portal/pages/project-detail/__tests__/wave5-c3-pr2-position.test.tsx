/**
 * AC-IXD-PROJ-W5-C3 D15 — RENDERED POSITION tests (the defect surface).
 *
 * The original wave5-c3-pr2 tests render ProjectDetailHeader in ISOLATION and
 * assert that the financial-summary aside EXISTS. They passed even while the aside
 * was mis-placed ABOVE the tablist in the full ProjectDetail page, because they
 * never mounted the tab bar. These tests close that blind spot by rendering the
 * FULL ProjectDetail route and asserting DOM order.
 *
 * Assertions:
 *   (a) Engineer: NO finance StatTiles / SoD row appear ABOVE the [role="tablist"] in DOM order.
 *   (b) Engineer: the "Financial summary" section appears INSIDE the Overview tabpanel.
 *   (c) CW-7: Engineer's no-tab default is role-invariant Overview (was Tasks) — so the finance
 *       section is visible on the default landing, inside the Overview tabpanel.
 *   (d) PM (finance-forward): header keeps finance StatTiles ABOVE the tablist;
 *       Overview tab does NOT double-render the finance block.
 *
 * Owning layer: Vitest/RTL — pure FE, no DB.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import React from 'react';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';
import type { Role } from '@/src/auth/AuthContext';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

// ── Mutable data box — lets each test control the project list ────────────────
const { projectsBox } = vi.hoisted(() => ({
  projectsBox: { data: [] as ProjectWithRefs[], isPending: false },
}));

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('@/src/hooks/useProjects', () => ({
  useProjects: () => ({ data: projectsBox.data, isPending: projectsBox.isPending }),
  useClientCompanies: () => ({ data: [], isError: false }),
  useProjectManagers: () => ({ data: [], isError: false }),
  useProjectMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    updateHeader: { mutateAsync: vi.fn(), isPending: false },
    archive: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
    setContractValue: { mutateAsync: vi.fn(), isPending: false },
  }),
}));

vi.mock('@/src/lib/db/opportunity', () => ({
  useOpportunity: () => ({ data: undefined, isPending: false }),
}));
vi.mock('@/src/hooks/useProjectTransitions', () => ({
  useProjectTransition: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isError: false,
    error: null,
    isPending: false,
  }),
}));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-alice', org_id: 'org-1' }, role: 'Project Manager' }),
}));

vi.mock('@tanstack/react-query', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useQueryClient: () => ({ invalidateQueries: vi.fn() }) };
});

vi.mock('@/src/hooks/useBudget', () => ({
  useProjectBudget: () => ({ data: 0, isPending: false, isError: false, refetch: vi.fn() }),
  useBudgetVersions: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useBudgetMutations: () => ({
    createVersion: { mutateAsync: vi.fn() },
    activate: { mutateAsync: vi.fn() },
    archive: { mutateAsync: vi.fn() },
    cloneVersion: { mutateAsync: vi.fn() },
    deleteDraft: { mutateAsync: vi.fn() },
    createLineItem: { mutateAsync: vi.fn() },
    deleteLineItem: { mutateAsync: vi.fn() },
  }),
}));

vi.mock('@/src/hooks/useProcurements', () => ({
  useProcurements: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useProjectCommittedSpend: () => ({ data: 2_100_000, isPending: false, isError: false, refetch: vi.fn() }),
}));

vi.mock('@/src/hooks/useTasks', () => ({
  useTasks: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useAssignableProfiles: () => ({ data: [], isPending: false, isError: false }),
  useTaskMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
    updateStatus: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
    addDependency: { mutateAsync: vi.fn(), isPending: false },
    removeDependency: { mutateAsync: vi.fn(), isPending: false },
  }),
}));

vi.mock('@/src/hooks/useDocuments', () => ({
  useDocuments: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useDocumentMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
    transition: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
  }),
}));
vi.mock('@/src/hooks/useMilestones', () => ({
  useMilestones: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useMilestoneMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
    setTaskMilestone: { mutateAsync: vi.fn(), isPending: false },
  }),
}));

vi.mock('@/src/lib/db/projectTransitions', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, transitionProject: vi.fn().mockResolvedValue(undefined) };
});

vi.mock('@/src/hooks/useDashboard', () => ({
  useSalesPipeline: () => ({ data: { stages: [], projects: [] } }),
}));

const navigate = vi.fn();
vi.mock('react-router-dom', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useNavigate: () => navigate };
});

// ── Fixture ───────────────────────────────────────────────────────────────────

const onHandRow: ProjectWithRefs = {
  id: 'p1',
  name: 'Innovate Corp HQ Fit-Out',
  code: 'PRJ-001',
  status: 'Ongoing Project',
  client_id: 'c2',
  project_manager_id: 'u-alice',
  contract_value: 5_000_000,
  budget: 4_700_000,
  spent: 2_100_000,
  start_date: '2026-01-01',
  end_date: '2026-12-18',
  contract_date: '2026-01-10',
  customer_contract_ref: 'CPO-2026-001',
  client: { name: 'Innovate Corp' },
  pm: { full_name: 'Alice Manager' },
} as unknown as ProjectWithRefs;

// ── Render helper ─────────────────────────────────────────────────────────────

import ProjectDetail from '../ProjectDetail';

/**
 * Render the full ProjectDetail page on the overview tab for a given real role.
 * The overview tab is explicit so the tabpanel content (including the relocated
 * financial summary for Engineer) is immediately visible.
 */
const renderPage = (realRole: Role, path = '/projects/p1/overview') =>
  render(
    <ImpersonationProvider realRole={realRole}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/projects/:projectId/:tab" element={<ProjectDetail />} />
            <Route path="/projects/:projectId" element={<ProjectDetail />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </ImpersonationProvider>,
  );

beforeEach(() => {
  projectsBox.data = [onHandRow];
  projectsBox.isPending = false;
  navigate.mockClear();
});

// ═════════════════════════════════════════════════════════════════════════════
// AC-IXD-PROJ-W5-C3 D15 — Rendered DOM position (full-page render)
// ═════════════════════════════════════════════════════════════════════════════

describe('AC-IXD-PROJ-W5-C3 D15: rendered DOM position in full ProjectDetail page', () => {
  // ── (a) Engineer: no finance block above the tablist ─────────────────────

  it('AC-IXD-PROJ-W5-C3-D15-POS-01: Engineer — no finance StatTile labels appear in the DOM before the tablist', () => {
    const { container } = renderPage('Engineer');

    const tablist = container.querySelector('[role="tablist"]');
    expect(tablist).not.toBeNull();

    // The financial-summary aside must NOT precede the tablist in DOM order.
    // compareDocumentPosition bit 0x02 (DOCUMENT_POSITION_PRECEDING) means
    // the argument is BEFORE the reference node — i.e. aside precedes tablist.
    const aside = container.querySelector('[data-testid="financial-summary"]');
    if (aside) {
      // If the aside exists, it must come AFTER (or inside) the tablist, not before.
      const position = tablist!.compareDocumentPosition(aside);
      // DOCUMENT_POSITION_FOLLOWING = 4, DOCUMENT_POSITION_CONTAINED_BY = 16
      // We want aside to be AFTER or INSIDE the tablist, never PRECEDING (bit 2).
      const isPreceding = Boolean(position & Node.DOCUMENT_POSITION_PRECEDING);
      expect(isPreceding).toBe(false);
    } else {
      // If there is no aside above the tabs at all, the fix is correctly applied.
      // The aside should exist inside the overview tabpanel — checked in POS-02.
      expect(
        container.querySelector('[data-testid="financial-summary"]'),
      ).toBeNull(); // not above tabs — ✓
    }
  });

  it('AC-IXD-PROJ-W5-C3-D15-POS-02: Engineer — "Financial summary" section appears INSIDE the Overview tabpanel', () => {
    const { container } = renderPage('Engineer');

    // The tabpanel (role="tabpanel") wraps the active tab content.
    const tabpanel = container.querySelector('[role="tabpanel"]');
    expect(tabpanel).not.toBeNull();

    // The financial-summary section must be a descendant of the tabpanel.
    const summary = container.querySelector('[data-testid="financial-summary"]');
    expect(summary).not.toBeNull();
    expect(tabpanel!.contains(summary!)).toBe(true);
  });

  it('AC-IXD-PROJ-W5-C3-D15-POS-03: Engineer — finance StatTile labels appear INSIDE the tabpanel, not above it', () => {
    const { container } = renderPage('Engineer');

    const tabpanel = container.querySelector('[role="tabpanel"]');
    expect(tabpanel).not.toBeNull();

    // "On-hand margin" is a tile label unique to the finance StatTiles strip.
    const marginLabels = screen.getAllByText('On-hand margin');
    for (const el of marginLabels) {
      expect(tabpanel!.contains(el)).toBe(true);
    }

    // "Contract" tile label likewise must be inside the tabpanel.
    const contractLabels = screen.getAllByText('Contract');
    for (const el of contractLabels) {
      expect(tabpanel!.contains(el)).toBe(true);
    }

    // The SoD row must also be inside the tabpanel.
    const sodRow = container.querySelector('[data-testid="contract-value-sod"]');
    expect(sodRow).not.toBeNull();
    expect(tabpanel!.contains(sodRow!)).toBe(true);
  });

  it('AC-IXD-PROJ-W5-C3-D15-POS-04: Engineer — the tablist comes BEFORE the tabpanel in DOM order', () => {
    const { container } = renderPage('Engineer');

    const tablist = container.querySelector('[role="tablist"]');
    const tabpanel = container.querySelector('[role="tabpanel"]');
    expect(tablist).not.toBeNull();
    expect(tabpanel).not.toBeNull();

    // tabpanel must follow the tablist in document order.
    const position = tablist!.compareDocumentPosition(tabpanel!);
    const isFollowing = Boolean(position & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(isFollowing).toBe(true);
  });

  // ── (b) CW-7: Engineer now defaults to Overview (role-invariant URL) ───────

  it('CW-7 (was AC-IXD-PROJ-W5-C3-D15-POS-05): Engineer opening /projects/:id (no tab) lands on Overview, not Tasks', () => {
    const { container } = renderPage('Engineer', '/projects/p1');

    // CW-7: the no-tab default is role-invariant Overview for every role.
    const tablist = container.querySelector('[role="tablist"]');
    expect(tablist).not.toBeNull();
    const overviewTab = Array.from(tablist!.querySelectorAll('[role="tab"]')).find(
      (t) => t.textContent === 'Overview',
    );
    expect(overviewTab).not.toBeUndefined();
    expect(overviewTab!.getAttribute('aria-selected')).toBe('true');

    // The Overview tab is active, so the Engineer's relocated finance summary is now visible
    // INSIDE the tabpanel (the header stays delivery-meta; finance lives in the Overview aside).
    const tabpanel = container.querySelector('[role="tabpanel"]');
    const summary = container.querySelector('[data-testid="financial-summary"]');
    expect(summary).not.toBeNull();
    expect(tabpanel!.contains(summary!)).toBe(true);
  });

  it('AC-IXD-PROJ-W5-C3-D15-POS-06: Engineer switching to Overview tab reveals the "Financial summary" inside the tabpanel', () => {
    // Note: navigate is a vi.fn() no-op so the URL doesn't change on tab click.
    // We navigate directly to the overview deep-link to verify the financial-summary appears.
    const { container: overviewContainer } = renderPage('Engineer', '/projects/p1/overview');

    const tabpanel = overviewContainer.querySelector('[role="tabpanel"]');
    expect(tabpanel).not.toBeNull();

    const summary = overviewContainer.querySelector('[data-testid="financial-summary"]');
    expect(summary).not.toBeNull();
    expect(tabpanel!.contains(summary!)).toBe(true);
    expect(within(summary as HTMLElement).getByText(/financial summary/i)).toBeInTheDocument();
  });

  // ── (c) PM (finance-forward): finance stays above tabs, no double in Overview ──

  it('AC-IXD-PROJ-W5-C3-D15-POS-07: PM (finance-forward) — finance StatTiles appear ABOVE the tablist in DOM order', () => {
    const { container } = renderPage('Project Manager');

    const tablist = container.querySelector('[role="tablist"]');
    expect(tablist).not.toBeNull();

    // For PM the StatTile labels come from the header, which renders BEFORE the tabs.
    // At least one "On-hand margin" label must precede the tablist.
    const marginLabels = screen.getAllByText('On-hand margin');
    const anyPrecedesTablist = marginLabels.some((el) => {
      const position = tablist!.compareDocumentPosition(el);
      return Boolean(position & Node.DOCUMENT_POSITION_PRECEDING);
    });
    expect(anyPrecedesTablist).toBe(true);
  });

  it('AC-IXD-PROJ-W5-C3-D15-POS-08: PM (finance-forward) — the Overview tabpanel does NOT contain a second "Financial summary" aside', () => {
    const { container } = renderPage('Project Manager');

    const tabpanel = container.querySelector('[role="tabpanel"]');
    expect(tabpanel).not.toBeNull();

    // The financial-summary aside must NOT appear inside the tabpanel for PM
    // (PM already has the finance block in the header — no duplication).
    const summaryInsidePanel = tabpanel!.querySelector('[data-testid="financial-summary"]');
    expect(summaryInsidePanel).toBeNull();
  });

  it('AC-IXD-PROJ-W5-C3-D15-POS-09: PM (finance-forward) — contract-value SoD row is in the header (above tabpanel)', () => {
    const { container } = renderPage('Project Manager');

    const tabpanel = container.querySelector('[role="tabpanel"]');
    const sodRow = container.querySelector('[data-testid="contract-value-sod"]');
    expect(sodRow).not.toBeNull();

    // The SoD row must NOT be inside the tabpanel.
    expect(tabpanel!.contains(sodRow!)).toBe(false);
  });

  // ── (d) Engineer: the financial-summary aside has correct a11y label ──────

  it('AC-IXD-PROJ-W5-C3-D15-POS-10: Engineer — the "Financial summary" aside has aria-label and is inside the tabpanel', () => {
    const { container } = renderPage('Engineer', '/projects/p1/overview');

    const tabpanel = container.querySelector('[role="tabpanel"]');
    const summary = tabpanel?.querySelector('[data-testid="financial-summary"]');

    expect(summary).not.toBeNull();
    expect(summary!.getAttribute('aria-label')).toMatch(/financial summary/i);
    // It is an aside element (complementary landmark inside the tabpanel).
    expect(summary!.tagName.toLowerCase()).toBe('aside');
  });
});
