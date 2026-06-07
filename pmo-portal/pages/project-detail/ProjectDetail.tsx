import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { Tabs, ListState, type TabItem } from '@/src/components/ui';
import { BackBar, useWorkspaceTabs } from '@/src/components/shell';
import { useProjects } from '@/src/hooks/useProjects';
import ProjectDetailHeader from './ProjectDetailHeader';
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
 * Route shell for `/projects/:projectId` — loads the project from the
 * `useProjects()` cache (no new project-by-id DAL; the row already carries
 * client/pm/contract/spent/customer_contract_ref). Renders the header and the
 * in-page Tabs (`ptabs`, local UI state — they
 * do NOT create global workspace tabs). Default tab = Overview (OQ-4); the
 * `/budget` deep-link pre-selects Budget. A cold deep-link shows ListState
 * loading, a truly-absent project shows an error with a Back-to-Projects action.
 */
const ProjectDetail: React.FC = () => {
  const { projectId = '' } = useParams<{ projectId: string }>();
  const location = useLocation();
  const ws = useWorkspaceTabs();
  const { data, isPending } = useProjects();

  const project = useMemo(
    () => (data ?? []).find((p) => p.id === projectId),
    [data, projectId],
  );

  const isBudgetDeepLink = location.pathname.endsWith('/budget');
  const [tab, setTab] = useState<PTab>(isBudgetDeepLink ? 'budget' : 'overview');

  const goBack = () => ws.openModule('projects');

  // Hydrate the workspace record tab's label to the human name once resolved.
  useEffect(() => {
    if (project) {
      ws.openRecord({
        id: `projects:${project.id}`,
        kind: 'record',
        path: `/projects/${project.id}`,
        icon: 'folder',
        label: project.name,
        code: project.code ?? project.id.slice(0, 8),
        module: 'projects',
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, project?.name, project?.code]);

  if (!project) {
    if (isPending) {
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

  return (
    <div>
      {/* I7: no in-page BackBar / Breadcrumb on the success render — the top-bar
          breadcrumb (Projects > record) is the single wayfinding surface. Both
          are kept on the loading / not-found branches above, where there is no
          in-page header to orient from and the crumb shows only the raw id. */}
      <ProjectDetailHeader project={project} />

      <Tabs<PTab> items={TABS} value={tab} onChange={setTab} ariaLabel="Project sections" />

      <div role="tabpanel">
        {tab === 'overview' && <OverviewTab project={project} />}
        {tab === 'budget' && <BudgetTab projectId={project.id} />}
        {tab === 'procurement' && <ProcurementTab projectId={project.id} />}
        {tab === 'tasks' && <TasksTab />}
        {tab === 'documents' && <DocumentsTab />}
      </div>
    </div>
  );
};

export default ProjectDetail;
