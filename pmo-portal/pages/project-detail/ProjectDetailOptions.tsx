import React from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Icon, ListState, MobileActionBar, Tabs, tabId, tabPanelId, type TabItem } from '@/src/components/ui';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { usePermission } from '@/src/auth/usePermission';
import { useProjectBudget } from '@/src/hooks/useBudget';
import { useProjectFinances } from '@/src/hooks/useProjectFinances';
import { useProjectProcurements } from '@/src/hooks/useProcurements';
import { useTasks } from '@/src/hooks/useTasks';
import { useComments } from '@/src/hooks/useComments';
import { moneyUnits } from '@/src/lib/projectFinances';
import { formatNumberWhole } from '@/src/lib/format';
import { ProjectAttention } from './ProjectAttention';
import { useOverdueReceivables, useProjectAttention } from './useProjectPosition';
import { CostBlock, DeliveryBlock, MoneyBlock } from './ProjectBlocks';
import { LatestComments, MyOpenTasks, ProjectActivity } from './ProjectActivity';
import ProjectDrawdown from './ProjectDrawdown';
import { ContractCascade, type CascadeView } from './ContractCascade';

const BudgetTab = React.lazy(() => import('./tabs/BudgetTab'));
const ProcurementTab = React.lazy(() => import('./tabs/ProcurementTab'));
const TasksTab = React.lazy(() => import('./tabs/TasksTab'));
const DocumentsTab = React.lazy(() => import('./tabs/DocumentsTab'));
const WorkOrdersTab = React.lazy(() => import('./tabs/WorkOrdersTab'));
const BillingTab = React.lazy(() => import('./tabs/BillingTab'));
const ProjectSCurve = React.lazy(() => import('./ProjectSCurve'));

import { AREAS, type Area, type Layout } from './projectDetailAreas';

type Lens = 'money' | 'pm' | 'delivery';

interface Props {
  project: ProjectWithRefs;
  layout: Layout;
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
const OverviewContent: React.FC<{ project: ProjectWithRefs; isPipeline: boolean; onOpen: (a: Area) => void; withActivity?: boolean }> = ({ project, isPipeline, onOpen, withActivity = false }) => {
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
      {withActivity && <ProjectActivity projectId={project.id} compact />}
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
    if (a === 'contract') return !isPipeline && lens !== 'delivery' && may('view', 'workOrder');
    if (a === 'budget') return lens !== 'delivery';
    return true;
  });
}

/* ── Option A+C: tabs for this project's areas; activity on demand in a drawer ─────────────── */
const TabsLayout: React.FC<Props> = ({ project, area, setArea, isPipeline, header }) => {
  const { t } = useTranslation();
  const labels = useAreaLabels();
  const areas = useVisibleAreas(isPipeline).filter((a) => a !== 'activity');
  const panel: Area = area === 'activity' ? 'overview' : area;
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
    </>
  );
};

/* ── Option B: one long page, jump menu on the left ────────────────────────────────────── */
const LongPageLayout: React.FC<Props> = ({ project, isPipeline, header }) => {
  const labels = useAreaLabels();
  const areas = useVisibleAreas(isPipeline);
  const jump = (a: Area) => document.getElementById(`pd-area-${a}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const [active, setActive] = React.useState<Area>('overview');
  const areaKey = areas.join(',');
  React.useEffect(() => {
    const io = new IntersectionObserver((entries) => {
      const hit = entries.filter((e) => e.isIntersecting).sort((x, y) => x.boundingClientRect.top - y.boundingClientRect.top)[0];
      if (hit) setActive(hit.target.id.replace('pd-area-', '') as Area);
    }, { rootMargin: '0px 0px -70% 0px' });
    areaKey.split(',').forEach((a) => { const el = document.getElementById(`pd-area-${a}`); if (el) io.observe(el); });
    return () => io.disconnect();
  }, [areaKey]);
  return (
    <>
      {header}
      <div className="lg:grid lg:grid-cols-[176px_minmax(0,1fr)] lg:gap-10">
        <nav aria-label={labels.overview} className="sticky top-0 z-10 -mx-4 mb-6 overflow-x-auto border-b border-border bg-background px-4 lg:top-6 lg:mx-0 lg:mb-0 lg:self-start lg:border-0 lg:px-0">
          <ul className="flex gap-1 lg:flex-col">
            {areas.map((a) => (
              <li key={a}>
                <button type="button" onClick={() => jump(a)} aria-current={active === a ? 'location' : undefined}
                  className={`touch-target whitespace-nowrap rounded-md px-3 py-2 text-left text-sm hover:bg-accent hover:text-foreground lg:w-full ${active === a ? 'bg-accent font-semibold text-foreground' : 'text-muted-foreground'}`}>
                  {labels[a]}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <div className="flex min-w-0 flex-col gap-16">
          {areas.map((a) => (
            <section key={a} id={`pd-area-${a}`} aria-labelledby={`pd-area-h-${a}`} className="min-w-0 scroll-mt-6">
              <h2 id={`pd-area-h-${a}`} className="mb-4 border-b border-border pb-2 text-base font-semibold text-foreground">{labels[a]}</h2>
              <Suspended>
                {a === 'overview' ? <OverviewContent project={project} isPipeline={isPipeline} onOpen={jump} /> : <AreaContent project={project} area={a} />}
              </Suspended>
            </section>
          ))}
        </div>
      </div>
    </>
  );
};

/* ── Option C: overview hub, areas open as their own pages, activity beside ─────────────── */
/** One work area as a list row: name, its live cue, and a way in. Rows, not a card grid. */
const AreaRow: React.FC<{ to: string; title: string; line: React.ReactNode; className?: string }> = ({ to, title, line, className }) => (
  <li className={className}>
    <Link to={to} className="touch-target flex items-baseline gap-4 py-3 hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <span className="w-40 shrink-0 text-sm font-semibold text-foreground">{title}</span>
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{line}</span>
      <Icon name="chev" className="size-4 shrink-0 self-center text-muted-foreground" />
    </Link>
  </li>
);

const AreaCards: React.FC<{ project: ProjectWithRefs; areas: Area[]; base: string }> = ({ project, areas, base }) => {
  const { t } = useTranslation();
  const labels = useAreaLabels();
  const may = usePermission();
  const tasks = useTasks(project.id);
  const procs = useProjectProcurements(may('view', 'procurement') ? project.id : null);
  const finances = useProjectFinances(project.id, { enabled: may('view', 'salesInvoice') });
  const budget = useProjectBudget(project.id);
  const comments = useComments('project', project.id);
  const open = (tasks.data ?? []).filter((x) => x.status !== 'Done').length;
  const blocked = (tasks.data ?? []).filter((x) => x.status === 'Blocked').length;
  const openProcs = (procs.data ?? []).filter((p) => !['Paid', 'Cancelled', 'Rejected'].includes(p.status as string)).length;
  const blockedPart = blocked > 0 ? t('projectDetail.hub.blocked', ' · {{count}} blocked', { count: blocked }) : '';
  const left = moneyUnits(finances.data?.remaining_to_invoice ?? null);
  const lines: Record<Area, React.ReactNode> = {
    overview: null,
    budget: budget.data ? t('projectDetail.hub.budgetLines', 'Lines, versions and forecast') : t('projectDetail.hub.noBudget', 'No active budget yet'),
    procurement: procs.data ? t('projectDetail.hub.procurement', '{{count}} open requests', { count: openProcs }) : null,
    tasks: t('projectDetail.hub.tasks', '{{open}} open on this project', { open }) + blockedPart,
    contract: left !== null && left > 0n ? t('projectDetail.hub.contractLeft', '{{amount}} {{currency}} left to invoice', { amount: formatNumberWhole(Number(finances.data?.remaining_to_invoice)), currency: project.currency }) : null,
    documents: null,
    activity: t('projectDetail.hub.activity', '{{count}} comments', { count: comments.data?.length ?? 0 }),
  };

  return (
    <section aria-labelledby="pd-areas">
      <h2 id="pd-areas" className="mb-3 text-sm font-semibold text-foreground">{t('projectDetail.hub.title', 'Work areas')}</h2>
      <ul className="divide-y divide-border/70 border-y border-border/70">
        {areas.filter((a) => a !== 'overview').map((a) => (
          // Activity lives in the side panel at xl; below that it is a row like the others.
          <AreaRow key={a} to={`${base}/${a}`} title={labels[a]} line={lines[a]} className={a === 'activity' ? 'xl:hidden' : undefined} />
        ))}
      </ul>
    </section>
  );
};

const HubLayout: React.FC<Props> = ({ project, area, setArea, isPipeline, header }) => {
  const { t } = useTranslation();
  const labels = useAreaLabels();
  const areas = useVisibleAreas(isPipeline);
  const base = `/projects/${project.id}`;
  if (area !== 'overview') {
    return (
      <>
        <Link to={base} className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-primary-text hover:underline">
          <Icon name="chev" className="size-4 rotate-180" />
          {t('projectDetail.hub.back', '{{name}} overview', { name: project.short_name || project.name })}
        </Link>
        <h1 className="mb-6 text-xl font-semibold text-foreground">{labels[area]}</h1>
        <Suspended><AreaContent project={project} area={area} /></Suspended>
      </>
    );
  }
  return (
    <>
      {header}
      <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_340px] xl:gap-10">
        <div className="flex min-w-0 flex-col gap-10">
          <Suspended><OverviewContent project={project} isPipeline={isPipeline} onOpen={setArea} /></Suspended>
          <div className="xl:hidden"><LatestComments projectId={project.id} to={`${base}/activity`} /></div>
          <AreaCards project={project} areas={areas} base={base} />
        </div>
        <aside aria-label={labels.activity} className="hidden min-w-0 border-l border-border pl-6 xl:block">
          <h2 className="mb-3 text-sm font-semibold text-foreground">{labels.activity}</h2>
          <ProjectActivity projectId={project.id} compact />
        </aside>
      </div>
    </>
  );
};

const ProjectDetailOptions: React.FC<Props> = (props) => {
  if (props.layout === 'b') return <LongPageLayout {...props} />;
  if (props.layout === 'c') return <HubLayout {...props} />;
  return <TabsLayout {...props} />;
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

export default ProjectDetailOptions;
