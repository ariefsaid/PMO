import React, { useCallback, useContext, useMemo, useState, useEffect } from 'react';
import { QueryClientContext } from '@tanstack/react-query';
import { AuthContext } from '@/src/auth/AuthContext';
import { preloadProjectOrders } from '@/src/lib/routeData';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, ListState, MobileActionBar, SelectField, Tabs, Tooltip, tabId, tabPanelId, WhenNearViewport, type TabItem } from '@/src/components/ui';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { usePermission } from '@/src/auth/usePermission';
import { ProjectMoneyScopeContext, useMayViewProjectMoney } from '@/src/hooks/useProjectMoneyScope';
import { useProjectFinances } from '@/src/hooks/useProjectFinances';
import { useProjectBilling } from '@/src/hooks/useProgressBilling';
import {
  BudgetTab, BillingTab, ContractCascade, DocumentsTab, MaterialsTab, OrdersTab,
  ProcurementTab, ProjectSCurve, TasksTab, WorkOrdersTab, preloadProjectTab,
} from './lazyProjectChunks';
import { ProjectAttention } from './ProjectAttention';
import { useOverdueReceivables, useProjectAttention } from '@/src/hooks/useProjectPosition';
import { CostBlock, DeliveryBlock, MoneyBlock } from './ProjectBlocks';
import { BillingMilestonesBlock } from './BillingMilestonesBlock';
import { ProjectPerformance } from './ProjectPerformance';
import { ProjectFinancesSection } from './ProjectFinancesSection';
import { ActivityFooter, MyOpenTasks, ProjectActivity } from './ProjectActivity';

import { AREAS, type Area } from './projectDetailAreas';
import { useTerms } from '@/src/lib/i18n/terms';

import { afterPaintIdle } from '@/src/lib/afterPaintIdle';

type Lens = 'money' | 'delivery';

interface Props {
  project: ProjectWithRefs;
  area: Area;
  setArea: (area: Area) => void;
  isPipeline: boolean;
  header: React.ReactNode;
  /** The overview's shared read has not answered: the shell shows, the overview content loads. */
  overviewPending?: boolean;
}

type CountedArea = 'procurement' | 'tasks' | 'documents';
type ProjectTabCounts = Partial<Record<CountedArea, number>>;

function useLens(): Lens {
  const { realRole } = useEffectiveRole();
  // A Project Manager on a project not their own reads it like a role with no money (DD-R1125-14).
  if (!React.useContext(ProjectMoneyScopeContext)) return 'delivery';
  if (realRole === 'Admin' || realRole === 'Executive' || realRole === 'Finance') return 'money';
  if (realRole === 'Project Manager') return 'money';
  return 'delivery';
}

const Suspended: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <React.Suspense fallback={<ListState variant="loading" rows={4} className="min-h-80" testId="project-detail-panel-loading" />}>{children}</React.Suspense>
);

/** Below the first screen: the browser skips layout and paint until the block nears the viewport (find-in-page, anchors and print still reach it). */
const BELOW_FOLD = '[content-visibility:auto] [contain-intrinsic-size:auto_480px]';

/** A deal's Overview also carries its notes and activity and its documents, so the record fills the screen. */
const PipelineRecordBlocks: React.FC<{ project: ProjectWithRefs }> = ({ project }) => {
  const { t } = useTranslation('project');
  return (
    <div className="grid min-w-0 gap-[var(--space-section)] xl:grid-cols-2">
      <ProjectActivity projectId={project.id} compact title={t('projectDetail.activity.notesTitle', 'Notes and activity')} />
      {/* Its own boundary: the rest of the Overview must not wait on the Documents chunk. */}
      <div className="min-w-0"><React.Suspense fallback={<ListState variant="loading" rows={3} className="min-h-40" />}><DocumentsTab projectId={project.id} projectCode={project.code} /></React.Suspense></div>
    </div>
  );
};

/** The overview, led by the approved role-specific composition: money cockpit for finance roles, task lead for engineers. */
const OverviewContent: React.FC<{ project: ProjectWithRefs; isPipeline: boolean; onOpen: (a: Area) => void; /** The Activity panel (delivery projects only). */ activity?: React.ReactNode }> = ({ project, isPipeline, onOpen, activity }) => {
  const { t } = useTranslation('project');
  const lens = useLens();
  const attention = useProjectAttention(project, lens);
  const attentionProps = { items: attention.items, isPending: attention.isPending, pendingSources: attention.pendingSources, error: attention.error, excludeKeys: lens === 'delivery' ? attention.myVisibleTaskKeys : undefined };
  const visibleDeliveryAttention = lens === 'delivery'
    ? attention.items.filter((item) => !attention.myVisibleTaskKeys.has(item.key))
    : [];
  const showDeliveryAttention = lens === 'delivery'
    && (attention.isPending || Boolean(attention.error) || visibleDeliveryAttention.length > 0);
  // F8: the curve is gated on data only (ProjectSCurve draws nothing without dated phases), never on role.
  const curve = useMemo(() => !isPipeline
    ? <React.Suspense fallback={<div className="h-72" />}><ProjectSCurve projectId={project.id} /></React.Suspense>
    : null, [isPipeline, project.id]);
  const openBudget = useCallback(() => onOpen('budget'), [onOpen]);
  const canSeeMoney = useMayViewProjectMoney();
  if (isPipeline) {
    if (lens === 'delivery') {
      return (
        <div className="flex min-w-0 flex-col gap-[var(--space-section)]">
          <div className={`grid min-w-0 gap-[var(--space-section)] ${showDeliveryAttention ? 'xl:grid-cols-2' : 'xl:grid-cols-1'}`}>
            <MyOpenTasks projectId={project.id} />
            {showDeliveryAttention && <ProjectAttention {...attentionProps} className="min-w-0" />}
          </div>
          <DeliveryBlock projectId={project.id} isPipeline />
          <PipelineRecordBlocks project={project} />
        </div>
      );
    }
    return (
      <div className="grid min-w-0 gap-[var(--space-section)] xl:grid-cols-2">
        <details className="min-w-0 xl:col-span-2">
          <summary className="cursor-pointer py-2 text-control font-semibold">{t('executionPlan', 'Execution plan')}</summary>
          <div className="mt-3 grid min-w-0 gap-4 xl:grid-cols-2">
            <CostBlock project={project} isPipeline onOpenBudget={openBudget} />
            <DeliveryBlock projectId={project.id} isPipeline={isPipeline} />
          </div>
        </details>
        {/* AC-PMP-006: invoices and spending already recorded against a deal stay visible before it is won. */}
        {/* One surface language: the finances sit in a panel like their neighbours, never bare on the page. */}
        {canSeeMoney && <div className="panel-card min-w-0 p-[var(--panel-inset)] xl:col-span-2 [&>section]:border-y-0 [&>section]:py-0"><ProjectFinancesSection project={project} /></div>}
        <div className="min-w-0 xl:col-span-2"><PipelineRecordBlocks project={project} /></div>
      </div>
    );
  }
  return (
    lens === 'delivery' ? (
      // Nothing assigned and no phases yet: the two one-line panels share a row instead of stacking as near-empty cards.
      <div className={`grid min-w-0 gap-[var(--space-section)] ${showDeliveryAttention ? '' : 'xl:[&:has(>:nth-child(1)_[data-empty]):has(>:nth-child(2)_[data-empty])]:grid-cols-2 [&>:nth-child(n+3)]:col-[1/-1]'}`}>
        <div className={`grid min-w-0 gap-[var(--space-section)] ${showDeliveryAttention ? 'xl:grid-cols-2' : 'xl:grid-cols-1'}`}>
          <MyOpenTasks projectId={project.id} />
          {showDeliveryAttention && <ProjectAttention {...attentionProps} className="min-w-0" />}
        </div>
        {/* AC-PERF-003 (plan 1c): the work-order billing block sits below the fold — its three reads
            wait until the block nears the viewport (WhenNearViewport renders children immediately
            where IntersectionObserver is absent, so unit tests and old browsers are unchanged).
            A short list takes a third beside the wide timeline, not a full-width card. */}
        {/* A role that cannot see the milestones leaves the slot empty: it takes no gap, and the timeline spans the row like its neighbours. */}
        <div className="grid min-w-0 items-start gap-[var(--space-section)] xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] xl:has-[>[data-near-viewport=seen]:empty]:grid-cols-1 [&>[data-near-viewport=seen]:empty]:hidden">
          <div className={BELOW_FOLD}><DeliveryBlock projectId={project.id}>{curve}</DeliveryBlock><ProjectPerformance projectId={project.id} /></div>
          <WhenNearViewport>
            <BillingMilestonesBlock projectId={project.id} />
          </WhenNearViewport>
        </div>
        {activity}
      </div>
    ) : (
      // One question: is this project OK, and what needs me now? Needs attention leads; the money figures answer
      // contracted, billed, paid and spent; then Budget and the Phase timeline. A panel whose data does not exist yet
      // (no active budget, no phases) is one line: two of those share a row rather than stacking as near-empty cards.
      <div className="grid min-w-0 gap-[var(--space-section)] xl:[&:has(>:nth-child(2)_[data-empty]):has(>:nth-child(3)_[data-empty])]:grid-cols-2 [&>:not(:nth-child(2)):not(:nth-child(3))]:col-[1/-1] [&>[data-near-viewport=seen]:empty]:hidden">
        {/* Needs attention leads as a full-width band, its rows two abreast on a wide screen; Money position spans the row
            under it. Neither panel is ever stretched to the other's height, in either language (Bahasa rows wrap taller). */}
        <div className="grid min-w-0 gap-[var(--space-section)]">
          <ProjectAttention items={attention.items} isPending={attention.isPending} pendingSources={attention.pendingSources} error={attention.error} band className="min-w-0" />
          {canSeeMoney && <div className="min-w-0"><MoneyBlock project={project} footer={<BillingMilestonesBlock projectId={project.id} empty="line" />} /></div>}
        </div>
        <CostBlock project={project} onOpenBudget={openBudget} showUnit={!canSeeMoney} />
        <div className={BELOW_FOLD}><DeliveryBlock projectId={project.id}>{curve}</DeliveryBlock><ProjectPerformance projectId={project.id} /></div>
        {/* An empty milestones slot (its line lives in Money position) takes no gap. */}
        <WhenNearViewport>
          <BillingMilestonesBlock projectId={project.id} empty={canSeeMoney ? 'none' : 'panel'} />
        </WhenNearViewport>
        {/* Activity closes the overview: present, but never competing with the work above (Lessons). */}
        {activity}
      </div>
    )
  );
};

/** One area's working surface, identical in every layout. */
const AreaContent: React.FC<{ project: ProjectWithRefs; area: Exclude<Area, 'overview'>; onCountChange?: (count: number | null) => void }> = ({ project, area, onCountChange }) => {
  switch (area) {
    case 'orders': return <OrdersTab projectId={project.id} />;
    case 'budget': return <BudgetTab projectId={project.id} />;
    case 'procurement': return <ProcurementTab projectId={project.id} onCountChange={onCountChange} />;
    case 'tasks': return <TasksTab projectId={project.id} projectName={project.name} onCountChange={onCountChange} />;
    case 'materials': return <MaterialsTab projectId={project.id} />;
    case 'documents': return <DocumentsTab projectId={project.id} projectCode={project.code} onCountChange={onCountChange} />;
    case 'activity': return <ProjectActivity projectId={project.id} />;
    case 'contract': {
      return (
        <ContractCascade project={project} contractTools={<BillingTab projectId={project.id} currency={project.currency} clientId={project.client_id ?? null}
          projectManagerId={project.project_manager_id ?? null} mode="contract-tools" />}
          timeAndMaterials={<BillingTab projectId={project.id} currency={project.currency} clientId={project.client_id ?? null}
            projectManagerId={project.project_manager_id ?? null} mode="contract-time-materials" />}>
          <div className="flex min-w-0 flex-col gap-[var(--space-panel-gap)]">
            <WorkOrdersTab projectId={project.id} currency={project.currency} clientId={project.client_id ?? null}
              focusWorkOrderId={new URLSearchParams(window.location.search).get('wo')}
              autoInvoiceWorkOrderId={new URLSearchParams(window.location.search).get('invoice') === '1' ? new URLSearchParams(window.location.search).get('wo') : null}
              projectManagerId={project.project_manager_id ?? null} showSettlementNote={false}
              projectName={project.name} projectStatus={project.status} />
          </div>
        </ContractCascade>
      );
    }
  }
};

function useAreaLabels(): Record<Area, string> {
  const { t } = useTranslation('project');
  const terms = useTerms();
  return {
    overview: t('projectDetail.tabs.overview', 'Overview'),
    orders: terms.clientWorkOrder,
    budget: t('projectDetail.tabs.budget', 'Budget'),
    procurement: t('projectDetail.tabs.procurement', 'Procurement'),
    tasks: t('projectDetail.tabs.tasks', 'Tasks'),
    contract: t('projectDetail.tabs.contract', 'Contract'),
    materials: t('projectDetail.tabs.materials', 'Materials'),
    documents: t('projectDetail.tabs.documents', 'Documents'),
    activity: t('projectDetail.tabs.activity', 'Activity'),
  };
}

function useVisibleAreas(isPipeline: boolean): Area[] {
  const may = usePermission();
  const lens = useLens();
  const moneyInScope = React.useContext(ProjectMoneyScopeContext);
  return AREAS.filter((a) => {
    // Another project's contract and purchases are money; its delivery areas stay (DD-R1125-14).
    if ((a === 'contract' || a === 'procurement') && !moneyInScope) return false;
    // A deal not yet won has no orders, billing or purchases (brief addendum, #1402).
    if (a === 'contract') return !isPipeline && (lens !== 'delivery' || may('view', 'progressClaim')) && may('view', 'workOrder');
    if (a === 'orders') return !isPipeline && may('view', 'workOrder');
    if (a === 'procurement' || a === 'materials') return !isPipeline;
    if (a === 'budget') return lens !== 'delivery';
    return true;
  });
}

/** The project's areas as tabs under one header (owner pick A+C, #1402); activity opens from the Overview foot. */
const ProjectSections: React.FC<Props> = ({ project, area, setArea, isPipeline, header, overviewPending = false }) => {
  const { t } = useTranslation('project');
  const labels = useAreaLabels();
  const client = useContext(QueryClientContext);
  const viewer = useContext(AuthContext)?.currentUser;
  const may = usePermission();
  const sectionsLabel = t('projectDetail.tabs.ariaLabel', 'Project sections');
  const areas = useVisibleAreas(isPipeline).filter((a) => a !== 'activity');
  const [loadedCounts, setLoadedCounts] = useState<{ projectId: string; values: ProjectTabCounts }>(() => ({ projectId: project.id, values: {} }));
  const updateCount = useCallback((key: CountedArea, count: number | null) => {
    setLoadedCounts((current) => {
      const values = current.projectId === project.id ? current.values : {};
      const nextCount = count ?? undefined;
      if (values[key] === nextCount) return current;
      const next = { ...values };
      if (nextCount === undefined) delete next[key];
      else next[key] = nextCount;
      return { projectId: project.id, values: next };
    });
  }, [project.id]);
  const reportProcurementCount = useCallback((count: number | null) => updateCount('procurement', count), [updateCount]);
  const reportTaskCount = useCallback((count: number | null) => updateCount('tasks', count), [updateCount]);
  const reportDocumentCount = useCallback((count: number | null) => updateCount('documents', count), [updateCount]);
  const currentCounts = loadedCounts.projectId === project.id ? loadedCounts.values : {};
  // A deep link to an area this role or stage doesn't have lands on the Overview (AC-PB-008, SUB-A).
  const panel: Area = (areas as Area[]).includes(area) ? area : 'overview';
  useEffect(() => {
    if (overviewPending || panel !== 'overview') return;
    return afterPaintIdle(() => {
      for (const next of AREAS) preloadProjectTab(next);
    });
  }, [project.id, overviewPending, panel]);
  const items: TabItem<Area>[] = areas.map((a) => {
    if (a === 'procurement' || a === 'tasks' || a === 'documents') {
      return { value: a, label: labels[a], count: currentCounts[a] ?? null, countPresentation: 'inline' };
    }
    return { value: a, label: labels[a] };
  });
  const onCountChange = panel === 'procurement' ? reportProcurementCount
    : panel === 'tasks' ? reportTaskCount
      : panel === 'documents' ? reportDocumentCount : undefined;
  // #1834: a tab's chunk downloads on hover, focus and pointerdown — the same
  // intent-driven preload the rail nav links use — instead of only after the
  // click, where it lands behind the Suspense boundary as one more serial
  // step. preloadProjectTab is memoized per chunk, so repeats are free.
  const preloadTab = (event: React.PointerEvent<HTMLElement> | React.FocusEvent<HTMLElement>) => {
    const prefix = `${tabId('project-detail', '')}`;
    const tab = (event.target as HTMLElement).closest('[role="tab"]');
    if (!tab || !tab.id.startsWith(prefix)) return;
    const next = tab.id.slice(prefix.length) as Area;
    preloadProjectTab(next);
    if (next === 'orders' && client && viewer?.org_id) {
      preloadProjectOrders(client, viewer.org_id, project.id, may('view', 'workOrderPlan'), viewer);
    }
  };
  return (
    <>
      {header}
      <div data-testid="mobile-project-area-select" className="sticky top-0 z-10 mb-4 bg-background py-2 md:hidden">
        <SelectField
          label={sectionsLabel}
          hideLabel
          value={panel}
          onChange={(next) => setArea(next as Area)}
          options={areas.map((a) => ({ value: a, label: labels[a] }))}
          className="touch-target w-full"
        />
      </div>
      <div
        data-testid="project-section-tabs"
        className="hidden md:block"
        onPointerOver={preloadTab}
        onPointerDown={preloadTab}
        onFocusCapture={preloadTab}
      >
        <Tabs<Area>
          items={items}
          value={panel}
          onChange={setArea}
          ariaLabel={t('projectDetail.tabs.ariaLabel', 'Project sections')}
          idBase="project-detail"
          insetFirstTab="panel"
          // Tabs scrolls the active item with inline:nearest; this margin keeps its label clear of the right fade.
          // The end padding lets the last tab scroll fully clear of the right fade, so no label is ever clipped (P5).
          // P5: tighter phone padding lets the next tab peek into the fade, so the row reads as scrollable.
          className="mb-0! pr-8 max-md:[&_[role=tab]]:px-2.5 max-md:[&_[role=tab][aria-selected=true]]:scroll-mr-7"
        />
      </div>
      <div role="tabpanel" id={tabPanelId('project-detail', panel)} aria-labelledby={tabId('project-detail', panel)} className="pt-4 md:pt-6">
        <Suspended>
          {panel === 'overview' && overviewPending
            ? <ListState variant="loading" shape="detail" rows={6} className="min-h-80" testId="project-detail-panel-loading" />
            : panel === 'overview'
            ? <OverviewContent project={project} isPipeline={isPipeline} onOpen={setArea}
                activity={isPipeline ? null : <ActivityFooter projectId={project.id} initialOpen={area === 'activity'} />} />
            : <AreaContent project={project} area={panel} onCountChange={onCountChange} />}
        </Suspended>
      </div>
      {/* Activity is about the project as a whole, so it lives on Overview only (owner, 2026-10-27), placed inside it. */}
    </>
  );
};

/**
 * The one filled action for this project's state (brief Q4). Money already owed outranks billing more:
 * an overdue customer invoice makes it "Chase payment"; otherwise "Raise invoice" while a meaningful
 * share (≥5%) of the contract is still to invoice; otherwise none.
 */
export const PrimaryProjectAction: React.FC<{ project: ProjectWithRefs; isPipeline: boolean; mobileBar?: boolean; chaseOnly?: boolean }> = ({ project, isPipeline, mobileBar = false, chaseOnly = false }) => {
  const { t } = useTranslation('project');
  const may = usePermission();
  const canInvoice = may('create', 'salesInvoice') && !isPipeline;
  const receivables = useOverdueReceivables(project);
  if (!canInvoice) return null;
  if (receivables.data) {
    return <ProjectActionButton mobileBar={mobileBar} to={receivables.data.to}>{t('projectDetail.action.chasePayment', 'Chase payment')}</ProjectActionButton>;
  }
  // Pending reads show the slot's loading state (no label that could change); a failed read holds a disabled button. Permission still returns null above.
  if (receivables.isPending) return <ActionSlotLoading mobileBar={mobileBar} />;
  if (receivables.isError) {
    return <HeldActionButton mobileBar={mobileBar} unavailable>{chaseOnly ? t('projectDetail.action.chasePayment', 'Chase payment') : t('projectDetail.action.raiseInvoice', 'Raise invoice')}</HeldActionButton>;
  }
  if (chaseOnly) return null;
  return <RaiseInvoiceAction project={project} mobileBar={mobileBar} />;
};

const RaiseInvoiceAction: React.FC<{ project: ProjectWithRefs; mobileBar: boolean }> = ({ project, mobileBar }) => {
  const { t } = useTranslation('project');
  const finances = useProjectFinances(project.id);
  const billing = useProjectBilling(project.id);
  if (finances.isError || billing.isError) {
    return <HeldActionButton mobileBar={mobileBar} unavailable>{t('projectDetail.action.raiseInvoice', 'Raise invoice')}</HeldActionButton>;
  }
  if (finances.isPending || billing.isPending) return <ActionSlotLoading mobileBar={mobileBar} />;
  const lines = billing.data?.contractLines ?? [];
  const billableQuantity = lines.reduce((sum, line) => sum + line.allocations.reduce(
    (allocationSum, allocation) => allocationSum + (allocation.acceptedQuantity ?? 0) - allocation.claimedQuantity,
    0,
  ), 0);
  const contract = project.contract_value ?? 0;
  const remaining = Number(finances.data?.remaining_to_invoice ?? 0);
  const canRaise = lines.length > 0 ? billableQuantity > 0 : contract > 0 && remaining / contract >= 0.05;
  if (!canRaise) return null;
  return <ProjectActionButton mobileBar={mobileBar} to={`/projects/${project.id}/contract`}>{t('projectDetail.action.raiseInvoice', 'Raise invoice')}</ProjectActionButton>;
};

/** The action's slot while the reads that decide it are loading: the button's space, no label. */
const ActionSlotLoading: React.FC<{ mobileBar: boolean }> = ({ mobileBar }) => {
  const block = <span aria-busy="true" data-testid="primary-action" className={`block animate-pulse rounded-md bg-muted ${mobileBar ? 'h-11 w-full' : 'h-8 w-32'}`} />;
  return mobileBar
    ? (
      <>
        <div aria-hidden="true" className="h-20 md:hidden" />
        <MobileActionBar className="fixed inset-x-0 bottom-[var(--phone-nav-height)] z-20 border-t border-border bg-background px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 md:hidden">{block}</MobileActionBar>
      </>
    )
    : block;
};

/** The action's slot when a read it depends on failed: same label and size, disabled. */
const HeldActionButton: React.FC<{ mobileBar: boolean; unavailable: boolean; children: React.ReactNode }> = ({ mobileBar, unavailable, children }) => {
  const { t } = useTranslation('project');
  const button = (
    <Button variant="primary" size={mobileBar ? 'default' : 'sm'} className={mobileBar ? 'touch-target w-full' : undefined} disabled data-testid={unavailable ? 'primary-action' : undefined}>
      {children}
    </Button>
  );
  const held = unavailable
    ? <Tooltip content={t('projectDetail.billing.summary.unavailable', 'Billing summary is unavailable.')}>{button}</Tooltip>
    : <span aria-busy="true" data-testid="primary-action" className="inline-flex">{button}</span>;
  return mobileBar
    ? (
      <>
        <div aria-hidden="true" className="h-20 md:hidden" />
        <MobileActionBar className="fixed inset-x-0 bottom-[var(--phone-nav-height)] z-20 border-t border-border bg-background px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 md:hidden">{held}</MobileActionBar>
      </>
    )
    : held;
};

const ProjectActionButton: React.FC<{ mobileBar: boolean; to: string; children: React.ReactNode }> = ({ mobileBar, to, children }) => {
  const navigate = useNavigate();
  const button = (
    <Button variant="primary" size={mobileBar ? 'default' : 'sm'} className={mobileBar ? 'touch-target w-full' : undefined} onClick={() => navigate(to)} data-testid="primary-action">
      {children}
    </Button>
  );
  // UX AC2: on phone the primary lives in the bottom action bar; the shell's inset (which reads the
  // bar's published height) keeps page content clear of it, so no spacer here.
  return mobileBar
    ? <MobileActionBar className="fixed inset-x-0 bottom-[var(--phone-nav-height)] z-20 border-t border-border bg-background px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 md:hidden">{button}</MobileActionBar>
    : button;
};

export default ProjectSections;
