import React from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, ListState, MobileActionBar, Tabs, tabId, tabPanelId, type TabItem } from '@/src/components/ui';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { usePermission } from '@/src/auth/usePermission';
import { useProjectFinances } from '@/src/hooks/useProjectFinances';
import { ProjectAttention } from './ProjectAttention';
import { useOverdueReceivables, useProjectAttention } from './useProjectPosition';
import { CostBlock, DeliveryBlock, MoneyBlock } from './ProjectBlocks';
import { ActivityFooter, MyOpenTasks, ProjectActivity } from './ProjectActivity';
import ProjectDrawdown from './ProjectDrawdown';
import { ContractCascade, type CascadeView } from './ContractCascade';

const BudgetTab = React.lazy(() => import('./tabs/BudgetTab'));
const ProcurementTab = React.lazy(() => import('./tabs/ProcurementTab'));
const TasksTab = React.lazy(() => import('./tabs/TasksTab'));
const DocumentsTab = React.lazy(() => import('./tabs/DocumentsTab'));
const WorkOrdersTab = React.lazy(() => import('./tabs/WorkOrdersTab'));
const BillingTab = React.lazy(() => import('./tabs/BillingTab'));
const ProjectSCurve = React.lazy(() => import('./ProjectSCurve'));

import { AREAS, type Area } from './projectDetailAreas';

type Lens = 'money' | 'pm' | 'delivery';

interface Props {
  project: ProjectWithRefs;
  area: Area;
  setArea: (area: Area) => void;
  isPipeline: boolean;
  header: React.ReactNode;
}

function useLens(): Lens {
  const { realRole } = useEffectiveRole();
  if (realRole === 'Admin' || realRole === 'Executive' || realRole === 'Finance') return 'money';
  if (realRole === 'Project Manager') return 'pm';
  return 'delivery';
}

const Suspended: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <React.Suspense fallback={<ListState variant="loading" rows={4} className="min-h-80" />}>{children}</React.Suspense>
);

/** The overview, led by what this role came for (brief: exec/admin/finance money, PM budget, engineer tasks). */
const OverviewContent: React.FC<{ project: ProjectWithRefs; isPipeline: boolean; onOpen: (a: Area) => void }> = ({ project, isPipeline, onOpen }) => {
  const lens = useLens();
  const may = usePermission();
  const attention = useProjectAttention(project, lens);
  const curve = !isPipeline && lens !== 'delivery'
    // Phone is for checking health and acting; the curve is for the weekly review at a desk.
    ? <div className="hidden md:block"><React.Suspense fallback={<div className="h-72" />}><ProjectSCurve projectId={project.id} /></React.Suspense></div>
    : null;
  return (
    <div className="flex min-w-0 flex-col gap-12">
      {lens !== 'delivery' && <ProjectAttention items={attention.items} isPending={attention.isPending} />}
      {lens === 'delivery' ? (
        <div className="grid min-w-0 gap-12 xl:grid-cols-2">
          <MyOpenTasks projectId={project.id} />
          <DeliveryBlock projectId={project.id} isPipeline={isPipeline} />
        </div>
      ) : (
        // Grouped by question: money (billing, then cost) on the left; schedule (phases, then curve) on the right.
        <div className="grid min-w-0 gap-12 xl:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-12">
            {lens === 'money' && may('view', 'salesInvoice') && !isPipeline && <MoneyBlock project={project} />}
            <CostBlock project={project} onOpenBudget={() => onOpen('budget')} />
          </div>
          <DeliveryBlock projectId={project.id} isPipeline={isPipeline}>{curve}</DeliveryBlock>
        </div>
      )}
    </div>
  );
};

/** One area's working surface, identical in every layout. */
const AreaContent: React.FC<{ project: ProjectWithRefs; area: Exclude<Area, 'overview'> }> = ({ project, area }) => {
  const { t } = useTranslation();
  const may = usePermission();
  const canSeeBilling = may('view', 'progressClaim');
  switch (area) {
    case 'budget': return <BudgetTab projectId={project.id} />;
    case 'procurement': return <ProcurementTab projectId={project.id} />;
    case 'tasks': return <TasksTab projectId={project.id} projectName={project.name} />;
    case 'documents': return <DocumentsTab projectId={project.id} projectCode={project.code} />;
    case 'activity': return <ProjectActivity projectId={project.id} />;
    case 'contract': {
      // Prototype switch for the owner's pick (#1402): ?billing=orders|lines; today's screens fold below.
      const view = new URLSearchParams(window.location.search).get('billing') as CascadeView | null;
      if (view === 'orders' || view === 'lines') {
        return (
          <div className="flex min-w-0 flex-col gap-12">
            <ContractCascade project={project} view={view} />
            <details className="border-t border-border/70 pt-4">
              <summary className="cursor-pointer text-xs text-muted-foreground">Today’s order and billing screens (for comparison)</summary>
              <div className="mt-6 flex flex-col gap-12">
                <WorkOrdersTab projectId={project.id} currency={project.currency} clientId={project.client_id ?? null} focusWorkOrderId={null} projectManagerId={project.project_manager_id ?? null} />
                {canSeeBilling && <BillingTab projectId={project.id} currency={project.currency} clientId={project.client_id ?? null} projectManagerId={project.project_manager_id ?? null} />}
              </div>
            </details>
          </div>
        );
      }
      return (
      <div className="flex min-w-0 flex-col gap-12">
        <ProjectDrawdown projectId={project.id} />
        <section aria-labelledby="pd-customer-orders" className="min-w-0">
          <h2 id="pd-customer-orders" className="mb-3 text-sm font-semibold text-foreground">{t('projectDetail.contract.orders', 'Customer orders')}</h2>
          <WorkOrdersTab projectId={project.id} currency={project.currency} clientId={project.client_id ?? null}
            focusWorkOrderId={new URLSearchParams(window.location.search).get('wo')} projectManagerId={project.project_manager_id ?? null} />
        </section>
        {canSeeBilling && (
          <section aria-labelledby="pd-billing" className="min-w-0">
            <h2 id="pd-billing" className="mb-3 text-sm font-semibold text-foreground">{t('projectDetail.contract.billing', 'Progress billing')}</h2>
            <BillingTab projectId={project.id} currency={project.currency} clientId={project.client_id ?? null} projectManagerId={project.project_manager_id ?? null} />
          </section>
        )}
      </div>
      );
    }
  }
};

function useAreaLabels(): Record<Area, string> {
  const { t } = useTranslation();
  return {
    overview: t('projectDetail.tabs.overview', 'Overview'),
    budget: t('projectDetail.tabs.budget', 'Budget'),
    procurement: t('projectDetail.tabs.procurement', 'Procurement'),
    tasks: t('projectDetail.tabs.tasks', 'Tasks'),
    contract: t('projectDetail.tabs.contract', 'Contract & billing'),
    documents: t('projectDetail.tabs.documents', 'Documents'),
    activity: t('projectDetail.tabs.activity', 'Activity'),
  };
}

function useVisibleAreas(isPipeline: boolean): Area[] {
  const may = usePermission();
  const lens = useLens();
  return AREAS.filter((a) => {
    // A deal not yet won has no orders, billing or purchases (brief addendum, #1402).
    if (a === 'contract') return !isPipeline && lens !== 'delivery' && may('view', 'workOrder');
    if (a === 'procurement') return !isPipeline;
    if (a === 'budget') return lens !== 'delivery';
    return true;
  });
}

/** The project's areas as tabs under one header (owner pick A+C, #1402); activity opens from the Overview foot. */
const ProjectSections: React.FC<Props> = ({ project, area, setArea, isPipeline, header }) => {
  const { t } = useTranslation();
  const labels = useAreaLabels();
  const areas = useVisibleAreas(isPipeline).filter((a) => a !== 'activity');
  // A deep link to an area this role or stage doesn't have lands on the Overview (AC-PB-008, SUB-A).
  const panel: Area = (areas as Area[]).includes(area) ? area : 'overview';
  const items: TabItem<Area>[] = areas.map((a) => ({ value: a, label: labels[a] }));
  return (
    <>
      {header}
      <Tabs<Area> items={items} value={panel} onChange={setArea} ariaLabel={t('projectDetail.tabs.ariaLabel', 'Project sections')} idBase="project-detail" className="mb-0! max-md:[mask-image:linear-gradient(to_right,black_80%,transparent)]" />
      <div role="tabpanel" id={tabPanelId('project-detail', panel)} aria-labelledby={tabId('project-detail', panel)} className="pt-8">
        <Suspended>
          {panel === 'overview'
            ? <OverviewContent project={project} isPipeline={isPipeline} onOpen={setArea} />
            : <AreaContent project={project} area={panel} />}
        </Suspended>
      </div>
      {/* Activity is about the project as a whole, so it lives on Overview only (owner, 2026-10-27). */}
      {panel === 'overview' && <ActivityFooter projectId={project.id} initialOpen={area === 'activity'} />}
    </>
  );
};

/**
 * The one filled action for this project's state (brief Q4). Money already owed outranks billing more:
 * an overdue customer invoice makes it "Chase payment"; otherwise "Raise invoice" while a meaningful
 * share (≥5%) of the contract is still to invoice; otherwise none.
 */
export const PrimaryProjectAction: React.FC<{ project: ProjectWithRefs; isPipeline: boolean; mobileBar?: boolean }> = ({ project, isPipeline, mobileBar = false }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const may = usePermission();
  const canInvoice = may('create', 'salesInvoice') && !isPipeline;
  const finances = useProjectFinances(project.id, { enabled: canInvoice });
  const receivables = useOverdueReceivables(project);
  const remaining = Number(finances.data?.remaining_to_invoice ?? 0);
  const contract = project.contract_value ?? 0;
  const action = !canInvoice ? null
    : receivables ? { label: t('projectDetail.action.chasePayment', 'Chase payment'), to: receivables.to }
    : contract > 0 && remaining / contract >= 0.05 ? { label: t('projectDetail.action.raiseInvoice', 'Raise invoice'), to: `/projects/${project.id}/contract` }
    : null;
  if (!action) return null;
  const button = (
    <Button variant="primary" size={mobileBar ? 'default' : 'sm'} className={mobileBar ? 'touch-target w-full' : undefined} onClick={() => navigate(action.to)}>
      {action.label}
    </Button>
  );
  // UX AC2: on phone the primary lives in the bottom action bar; the spacer keeps page content clear of it.
  return mobileBar
    ? (
      <>
        <div aria-hidden="true" className="h-20 md:hidden" />
        <MobileActionBar className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 md:hidden">{button}</MobileActionBar>
      </>
    )
    : button;
};

export default ProjectSections;
