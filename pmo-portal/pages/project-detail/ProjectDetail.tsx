import React, { useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Tabs, tabId, tabPanelId, ListState, type TabItem } from '@/src/components/ui';
import { BackBar } from '@/src/components/shell';
import { useProjects } from '@/src/hooks/useProjects';
import { useProjectCommittedSpend } from '@/src/hooks/useProcurements';
import { useOpportunity } from '@/src/lib/db/opportunity';
import { projectStatusGroup } from '@/src/lib/db/projectTransitions';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import { useEffectiveRole } from '@/src/auth/impersonation';
import ProjectDetailHeader, { hasFinanceView } from './ProjectDetailHeader';
import PipelineLens from './PipelineLens';
import MilestoneStrip from './MilestoneStrip';
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
 *  tabs are now deep-linkable symmetrically; unknown values default to the role-aware default.
 *
 *  OD-W5-C3-A: when no explicit :tab param is present, delivery-forward roles (Engineer,
 *  i.e. !hasFinanceView) default to 'tasks' — the surface they primarily use. Finance-forward
 *  roles (Admin·Exec·Finance·PM) keep the 'overview' default. An explicit :tab always wins. */
const TAB_VALUES: PTab[] = ['overview', 'budget', 'procurement', 'tasks', 'documents'];
function tabFromParam(param: string | undefined, isDeliveryForward: boolean): PTab {
  if (param && (TAB_VALUES as string[]).includes(param)) return param as PTab;
  return isDeliveryForward ? 'tasks' : 'overview';
}

const ProjectDetail: React.FC = () => {
  const { projectId = '', tab: tabParam } = useParams<{ projectId: string; tab?: string }>();
  const navigate = useNavigate();
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

  // B-9 (AC-W2-IA-004): tab derived from URL param; defaults to the role-aware default for
  // unknown/absent values. OD-W5-C3-A: delivery-forward roles (Engineer) default to 'tasks';
  // finance-forward roles keep 'overview'. An explicit :tab param always wins (deep-link).
  const isDeliveryForward = !hasFinanceView(realRole);
  const tab = tabFromParam(tabParam, isDeliveryForward);
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
      {/* I7: no in-page BackBar / Breadcrumb on the success render — the top-bar
          breadcrumb (Projects/Sales Pipeline > record) is the single wayfinding surface.
          Both are kept on the loading / not-found branches above. The shared header renders
          at every stage so a record's wayfinding is identical regardless of stage. */}
      <ProjectDetailHeader project={project} committedSpend={committedSpend} />

      {/* Milestone strip — renders at every lifecycle stage (FR-DEL-012, ADR-0021). */}
      <div className="mb-4">
        <MilestoneStrip projectId={project.id} />
      </div>

      {/* Deal-progression banner — pre-win/lost only, ABOVE the tabs (ADR-0021 owner placement). */}
      {isPipeline && (
        <div className="mb-4">
          <PipelineLens project={project} />
        </div>
      )}

      {/* Delivery tabs — rendered at EVERY stage (Overview/Budget/Procurement/Tasks/Documents). */}
      <Tabs<PTab> items={TABS} value={tab} onChange={setTab} ariaLabel="Project sections" idBase="project-detail" />

      <div
        role="tabpanel"
        id={tabPanelId('project-detail', tab)}
        aria-labelledby={tabId('project-detail', tab)}
      >
        {tab === 'overview' && (
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
