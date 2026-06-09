import React, { useMemo, useState } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { Tabs, ListState, type TabItem } from '@/src/components/ui';
import { BackBar } from '@/src/components/shell';
import { useProjects } from '@/src/hooks/useProjects';
import { useOpportunity } from '@/src/lib/db/opportunity';
import { projectStatusGroup } from '@/src/lib/db/projectTransitions';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import ProjectDetailHeader from './ProjectDetailHeader';
import PipelineLens from './PipelineLens';
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
 * therefore opens regardless of stage. The header renders in both lenses; a pipeline | lost
 * record gets the PipelineLens, an on-hand | internal record gets the delivery Tabs (Overview /
 * Budget / Procurement / Tasks / Documents; `/budget` deep-link pre-selects Budget). A cold
 * deep-link shows ListState loading; a truly-absent record shows an error with a Back action.
 */
const ProjectDetail: React.FC = () => {
  const { projectId = '' } = useParams<{ projectId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { data, isPending } = useProjects();

  const cached = useMemo(
    () => (data ?? []).find((p) => p.id === projectId),
    [data, projectId],
  );

  // Fallback by-id fetch for a record NOT in the active projects cache (a pre-win / lost deal
  // lives in the Sales Pipeline partition). Only fired when the cache misses, so on-hand records
  // (the common path) cost no extra query.
  const { data: opp, isPending: oppPending } = useOpportunity(cached ? undefined : projectId);

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

  const isBudgetDeepLink = location.pathname.endsWith('/budget');
  const [tab, setTab] = useState<PTab>(isBudgetDeepLink ? 'budget' : 'overview');

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

  // Model B (ADR-0020): one canonical detail page, stage-adaptive lens. A pre-win (pipeline) or
  // terminal (lost) deal renders the PipelineLens (deal stepper + Advance/Mark won/Mark lost) and
  // NOT the delivery tabs — a deal has accrued no budget/PRs/tasks yet, so hiding is the honest
  // presentation (no empty-tab tease). An on-hand / internal project renders the delivery tabs.
  const group = projectStatusGroup(project.status as never);
  const isPipeline = group === 'pipeline' || group === 'lost';

  return (
    <div>
      {/* I7: no in-page BackBar / Breadcrumb on the success render — the top-bar
          breadcrumb (Projects/Sales Pipeline > record) is the single wayfinding surface.
          Both are kept on the loading / not-found branches above. The shared header renders
          in both lenses so a record's wayfinding is identical regardless of stage. */}
      <ProjectDetailHeader project={project} />

      {isPipeline ? (
        <PipelineLens project={project} />
      ) : (
        <>
          <Tabs<PTab> items={TABS} value={tab} onChange={setTab} ariaLabel="Project sections" />

          <div role="tabpanel">
            {tab === 'overview' && <OverviewTab project={project} setTab={setTab} />}
            {tab === 'budget' && <BudgetTab projectId={project.id} />}
            {tab === 'procurement' && <ProcurementTab projectId={project.id} />}
            {tab === 'tasks' && <TasksTab projectId={project.id} />}
            {tab === 'documents' && <DocumentsTab projectId={project.id} />}
          </div>
        </>
      )}
    </div>
  );
};

export default ProjectDetail;
