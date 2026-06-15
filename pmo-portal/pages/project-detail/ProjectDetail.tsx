import React, { useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Tabs, tabId, tabPanelId, ListState, type TabItem } from '@/src/components/ui';
import { BackBar } from '@/src/components/shell';
import { useIsDesktop } from '@/src/components/ui/useIsDesktop';
import { useProjects } from '@/src/hooks/useProjects';
import { useProjectCommittedSpend } from '@/src/hooks/useProcurements';
import { useOpportunity } from '@/src/lib/db/opportunity';
import { projectStatusGroup } from '@/src/lib/db/projectTransitions';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import { useEffectiveRole } from '@/src/auth/impersonation';
import ProjectDetailHeader, { hasFinanceView } from './ProjectDetailHeader';
import PipelineLens from './PipelineLens';
import MilestoneStrip from './MilestoneStrip';
import ProjectSCurve from './ProjectSCurve';
import OverviewTab from './tabs/OverviewTab';
import BudgetTab from './tabs/BudgetTab';
import ProcurementTab from './tabs/ProcurementTab';
import TasksTab from './tabs/TasksTab';
import DocumentsTab from './tabs/DocumentsTab';

type PTab = 'overview' | 'budget' | 'procurement' | 'tasks' | 'documents';

const TABS: TabItem<PTab>[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'budget', label: 'Budget' },
  { value: 'procurement', label: 'Procurement' },
  { value: 'tasks', label: 'Tasks' },
  { value: 'documents', label: 'Documents' },
];

/**
 * Route shell for `/projects/:projectId` — the ONE canonical detail route for a project at EVERY
 * stage (Model B, ADR-0020). It resolves the record from the `useProjects()` cache (the active
 * on-hand ∪ internal partition); a PRE-WIN / LOST record is not in that cache (it lives in the
 * Sales Pipeline), so it falls back to a by-id fetch (`useOpportunity`) — the canonical route
 * therefore opens regardless of stage. ADR-0021 (supersedes ADR-0020 §1): the page is UNIFIED —
 * the shared header + the five delivery Tabs (Overview/Budget/Procurement/Tasks/Documents) render
 * at every stage; a pipeline | lost record additionally gets the PipelineLens deal-progression
 * banner above the tabs. A cold deep-link shows ListState loading; a truly-absent record shows an
 * error with a Back action.
 */
/** Resolve the active tab from the URL :tab param (B-9, AC-W2-IA-004). All five
 *  tabs are now deep-linkable symmetrically; an absent/unknown value defaults to Overview.
 *
 *  CW-7 (coherence wave §3): `/projects/:id` ALWAYS defaults to Overview for EVERY role — the URL
 *  is role-invariant (a role-variant default was a wayfinding bug: the same link landed PM/Admin on
 *  Overview but Engineer on Tasks). Engineer task entry points deep-link to `/projects/:id/tasks`
 *  explicitly (e.g. the My Tasks project headers) rather than mutating the default. An explicit
 *  :tab param always wins (every tab stays deep-linkable). */
const TAB_VALUES: PTab[] = ['overview', 'budget', 'procurement', 'tasks', 'documents'];
function tabFromParam(param: string | undefined): PTab {
  if (param && (TAB_VALUES as string[]).includes(param)) return param as PTab;
  return 'overview';
}

const ProjectDetail: React.FC = () => {
  const { projectId = '', tab: tabParam } = useParams<{ projectId: string; tab?: string }>();
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const { realRole } = useEffectiveRole();
  const { data, isPending } = useProjects();

  const cached = useMemo(
    () => (data ?? []).find((p) => p.id === projectId),
    [data, projectId],
  );

  // Fallback by-id fetch for a record NOT in the active projects cache (a pre-win / lost deal
  // lives in the Sales Pipeline partition). Only fired when the cache misses, so on-hand records
  // (the common path) cost no extra query.
  const { data: opp, isPending: oppPending } = useOpportunity(cached ? undefined : projectId);
  const { data: committedSpend = 0 } = useProjectCommittedSpend(projectId || null);

  // A pre-win/lost record's full row comes from the opportunity fetch; map it onto the
  // ProjectWithRefs shape the header + lens consume (delivery-only fields the pipeline lens never
  // reads — budget/spent/archived_at/created_at/last_update/org_id — default safely).
  const project = useMemo<ProjectWithRefs | undefined>(() => {
    if (cached) return cached;
    if (!opp) return undefined;
    return {
      ...opp,
      budget: 0,
      spent: 0,
      archived_at: null,
      created_at: '',
      last_update: '',
      org_id: '',
    } as ProjectWithRefs;
  }, [cached, opp]);

  // B-9 (AC-W2-IA-004): tab derived from URL param. CW-7: an absent/unknown :tab defaults to
  // Overview for EVERY role — the URL is role-invariant. An explicit :tab param always wins.
  const tab = tabFromParam(tabParam);
  // OD-W5-C3-A: delivery-forward roles (Engineer, !hasFinanceView) relocate the finance strip into
  // the Overview tab's "Financial summary" aside (header stays delivery-meta). This still keys on
  // role — but only the finance-summary PLACEMENT, never the default tab (CW-7).
  const isDeliveryForward = !hasFinanceView(realRole);
  const setTab = (next: PTab) => navigate(`/projects/${projectId}/${next}`, { replace: true });

  // Back to the Projects index — a plain navigate, no tab (AC-NAV-007). The
  // breadcrumb resolves the record name from the cached list in App.tsx, so no
  // per-page label hydration is needed once the tab layer is gone.
  const goBack = () => navigate('/projects');

  if (!project) {
    if (isPending || oppPending) {
      return (
        <>
          <BackBar label="Projects" onBack={goBack} />
          <ListState variant="loading" rows={6} />
        </>
      );
    }
    return (
      <>
        <BackBar label="Projects" onBack={goBack} />
        <ListState
          variant="error"
          icon="inbox"
          title="Project not found"
          sub="This project does not exist or you don't have access to it. Use Back to Projects to return."
        />
      </>
    );
  }

  // ADR-0021 (supersedes ADR-0020 §1): ONE unified detail page at every stage. The full delivery
  // layout (header + the five tabs) always renders, so a PM can plan budget/tasks/procurement while
  // a deal is still in the pipeline (the backend gates those writes on org/role, not project
  // status). A pre-win (pipeline) or terminal (lost) record additionally gets the PipelineLens
  // deal-progression BANNER above the tabs (stage stepper + Advance/Mark won/Mark lost + deal
  // figures); on win the banner disappears and the delivery tiles appear — one continuous page.
  const group = projectStatusGroup(project.status as never);
  const isPipeline = group === 'pipeline' || group === 'lost';

  return (
    <div>
      {/* C-IMP-1: on mobile (< 768px) the top-bar breadcrumb is not visible, so
          we surface the BackBar in-content so mobile users have an up/back escape.
          Desktop keeps the breadcrumb-only pattern (I7). Single-render: one DOM
          branch per breakpoint via useIsDesktop(), never dual-tree. */}
      {!isDesktop && <BackBar label="Projects" onBack={goBack} />}
      {/* I7: no in-page BackBar / Breadcrumb on the success render — the top-bar
          breadcrumb (Projects/Sales Pipeline > record) is the single wayfinding surface.
          Both are kept on the loading / not-found branches above. The shared header renders
          at every stage so a record's wayfinding is identical regardless of stage. */}
      <ProjectDetailHeader project={project} committedSpend={committedSpend} />

      {/* AC-IFW-RECORD-01 (Lens-D): pre-win layout — sales levers first so the deal
          actions are above the fold; delivery planner is demoted below; S-curve is hidden
          (buildSCurve([]) shows an empty chart for a pre-win record — cut the noise).
          AC-IFW-RECORD-02 (Lens-D): delivery layout — stepper → tabs → S-curve, so the
          actionable tab bar surfaces above the fold rather than buried beneath the S-curve. */}
      {isPipeline ? (
        <>
          {/* Pre-win: deal-progression banner FIRST (the sales levers). */}
          <div className="mb-4">
            <PipelineLens project={project} />
          </div>

          {/* Pre-win: delivery planner demoted (PM may pre-fill phases while pursuing the deal).
              M2: when empty, collapse to a single-line affordance so the sales levers stay above
              the fold — the full planning prompt is only surfaced on a won (delivery) record. */}
          <div className="mb-4">
            <MilestoneStrip projectId={project.id} compactWhenEmpty />
          </div>

          {/* Pre-win: S-curve is hidden — no real progress data exists yet for an opportunity.
              Guard: {!isPipeline && <ProjectSCurve …/>} per the design plan. */}

          {/* Delivery tabs rendered for pre-win so budget/tasks/procurement are reachable (ADR-0021). */}
          <Tabs<PTab> items={TABS} value={tab} onChange={setTab} ariaLabel="Project sections" idBase="project-detail" />
        </>
      ) : (
        <>
          {/* Delivery: milestone stepper first, then the tab bar immediately below the stepper
              so the actionable surface is above the fold (AC-IFW-RECORD-02). */}
          <div className="mb-4">
            <MilestoneStrip projectId={project.id} />
          </div>

          {/* Delivery tabs directly after the stepper — above the S-curve (AC-IFW-RECORD-02). */}
          <Tabs<PTab> items={TABS} value={tab} onChange={setTab} ariaLabel="Project sections" idBase="project-detail" />
        </>
      )}

      <div
        role="tabpanel"
        id={tabPanelId('project-detail', tab)}
        aria-labelledby={tabId('project-detail', tab)}
      >
        {tab === 'overview' && (
          <>
            <OverviewTab
              project={project}
              committedSpend={committedSpend}
              setTab={setTab}
              // D15 (OD-W5-C3-A): pass the finance summary to delivery-forward roles only.
              // The finance StatTiles + SoD row render INSIDE this tabpanel (below the tab bar)
              // rather than in the header above the tabs. Finance-forward roles (Admin·Exec·Finance·PM)
              // keep the finance block in the header; isDelivery gates to delivery-lens only.
              showFinanceSummary={isDeliveryForward && !isPipeline}
            />
            {/* AC-IFW-RECORD-02: S-curve is an Overview-panel widget — it renders only when
                the Overview tab is active, and is hidden for pre-win records (no real progress
                data). Scoping it here (not at shell level) prevents it bleeding into
                Budget / Procurement / Tasks / Documents. */}
            {!isPipeline && (
              <div className="mt-4">
                <ProjectSCurve projectId={project.id} />
              </div>
            )}
          </>
        )}
        {tab === 'budget' && <BudgetTab projectId={project.id} />}
        {tab === 'procurement' && <ProcurementTab projectId={project.id} />}
        {tab === 'tasks' && <TasksTab projectId={project.id} />}
        {tab === 'documents' && <DocumentsTab projectId={project.id} />}
      </div>
    </div>
  );
};

export default ProjectDetail;
