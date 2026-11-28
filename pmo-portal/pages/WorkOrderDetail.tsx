import React, { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog, ListState, RecordHeader, RecordSection, RecordStack, SelectField, StatusPill, Tabs, tabId, tabPanelId, useToast } from '@/src/components/ui';
import { withTabSwitchNavState } from '@/src/lib/tabSwitchNav';
import { useAuth } from '@/src/auth/useAuth';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import type { WorkOrderAcceptanceWithLines } from '@/src/lib/db/workOrderAcceptances';
import { BackBar } from '@/src/components/shell';
import { usePermission } from '@/src/auth/usePermission';
import { useFeature } from '@/src/auth/useFeature';
import { useProject } from '@/src/hooks/useProjects';
import { useBoqItems } from '@/src/hooks/useProgressBilling';
import { useWorkOrderAcceptanceMutations, useWorkOrderAcceptancesFor } from '@/src/hooks/useWorkOrderAcceptances';
import { useWorkOrderBilledMonths, useWorkOrderBilling } from '@/src/hooks/useWorkOrderBilling';
import { useWorkOrderDocuments } from '@/src/hooks/useDocuments';
import { useCostDisciplines, useWorkOrderCostLines, useWorkOrderCostMoney, useWorkOrderCostLinks, useWorkOrderTimesheetLabels } from '@/src/hooks/useWorkOrderCosts';
import { useProjectPlanVsActual } from '@/src/hooks/useWorkOrderPlanVsActual';
import { useWorkOrder, useWorkOrderAllocations, useWorkOrderClaimDocuments, useWorkOrderIssues, useWorkOrderOpenTasks } from '@/src/hooks/useWorkOrderRecord';
import { useOperationalWaitingRoute, operationalWaitingForText } from '@/src/hooks/useOperationalWaitingRoute';
import { useRoleOptions } from '@/src/hooks/useRoleOptions';
import { deriveScopeProgress } from '@/src/lib/workOrderProgress';
import { buildCostView } from '@/src/lib/workOrderCostView';
import { formatNumberExact, formatTableMoney } from '@/src/lib/format';
import { WorkOrderSupplyWarning } from '@/src/components/SupplyRiskWarning';
import { ScopeSection } from './work-order-detail/ScopeSection';
import { CostSection } from './work-order-detail/CostSection';
import { BillingSection } from './work-order-detail/BillingSection';
import { PlanVsActualSection } from './work-order-detail/PlanVsActualSection';
import { RevenuePlanGate } from './work-order-detail/RevenuePlanGate';
import { PerformanceIndices } from './work-order-detail/PerformanceIndices';
import { DailyTargetGate } from './work-order-detail/DailyTargetGate';
import { DocumentsSection } from './work-order-detail/DocumentsSection';
import { CloseoutSection } from './work-order-detail/CloseoutSection';
import { MaterialCompletionLink } from './work-order-detail/MaterialCompletionLink';
import { SiteReportsSection } from './work-order-detail/SiteReportsSection';
import { MissingSection } from './work-order-detail/MissingSection';
import { missingStepsFromSource } from '@/src/lib/workOrderMissing';
import { useWorkOrderSteps } from '@/src/hooks/useBillingSteps';
import { workOrderStepsQuery } from '@/src/lib/routeQueries/useBillingSteps';
import { costDisciplinesQuery, workOrderCostLinesQuery } from '@/src/lib/routeQueries/useWorkOrderCosts';
import { projectPlanVsActualQuery } from '@/src/lib/routeQueries/useWorkOrderPlanVsActual';
import { workOrderBilledMonthsQuery, workOrderBillingQuery } from '@/src/lib/routeQueries/useWorkOrderBilling';
import { useBuiltInRoleName } from '@/src/hooks/useOrgRoleNames';
import { BillingStepsSection } from './work-order-detail/BillingStepsSection';
import { SurveySection } from './work-order-detail/SurveySection';
import { QuantityChangesSection } from './work-order-detail/QuantityChangesSection';
import { SectionsSection } from './work-order-detail/SectionsSection';
import { ConsumablePlanSection } from './work-order-detail/ConsumablePlanSection';
import { InspectionsSection } from './work-order-detail/InspectionsSection';
import { ClientMaterialSection } from './work-order-detail/ClientMaterialSection';
import { IssuesSection } from './work-order-detail/IssuesSection';
import { SiteCheckpointFlag } from './work-order-detail/SiteCheckpointFlag';
import { WorkOrderCheckpoints } from './work-order-detail/WorkOrderCheckpoints';
import { SafetySection, SafetyTodayLink } from './work-order-detail/SafetySection';
import { OpenTasksSection } from './work-order-detail/OpenTasksSection';
import { SiteLocationSection } from './work-order-detail/SiteLocationSection';
import { ResponsiblePersonSection } from './work-order-detail/ResponsiblePersonSection';
import { WorkOrderAheadBadge } from './project-detail/tabs/WorkOrderAheadBadge';
import { isMicrosoftFolder } from './project-detail/tabs/documentUtils';
import { WorkOrderStockBalance } from './stock/WorkOrderStockBalance';
import { WorkOrderCrewLink } from './work-order-detail/WorkOrderCrewLink';
import { WorkOrderChecksSection } from './work-order-detail/WorkOrderChecksSection';
import { AreaHelpButton, AreaHelpProvider, AreaNotes } from './work-order-detail/AreaHelp';
import { useWorkOrderDecision } from './work-order-detail/WorkOrderDecision';

/**
 * The page's areas, ordered by the question asked most (#1126): how far has it got, is it costing what we planned,
 * what was billed, what was received, what is left to close, its papers, what is open. One area shows at a time;
 * the address keeps it (`#wo-billing`) so Back and a shared link return to it.
 */
const AREAS = ['scope', 'cost', 'billing', 'material', 'checks', 'documents', 'issues'] as const;
type Area = typeof AREAS[number];
/** Earlier addresses named two areas that are now one (`#wo-inspections`, `#wo-closeout`). */
const AREA_ALIASES: Record<string, Area> = { inspections: 'checks', closeout: 'checks' };
const areaFromHash = (hash: string): Area | null => {
  const key = decodeURIComponent(hash.replace(/^#/, '')).replace(/^wo-/, '');
  return (AREAS as readonly string[]).includes(key) ? key as Area : AREA_ALIASES[key] ?? null;
};

/**
 * `/work-orders/:id` (#2518): one page for a work order — scope and progress, costs, billing and
 * acceptances, the close-out checklist (#2593), documents, issues and tasks. Every read is the caller's own RLS (an absent, foreign or unreadable id
 * looks identical: not found). Its write surfaces are the sections block (#2576) and the close-out checklist (#2593), gated by `can()`.
 */
const WorkOrderDetail: React.FC = () => {
  const { t } = useTranslation(['workOrders', 'waitingList']);
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const may = usePermission();
  const stockOn = useFeature('stock');
  const qc = useQueryClient();
  // #3079: the page starts only the first tab's reads; each other tab's reads start when it is shown (or hovered/focused).
  const hasMaterial = stockOn || may('view', 'clientRequisition');
  const areas = AREAS.filter((key) => key !== 'material' || hasMaterial);
  const requested = areaFromHash(location.hash);
  const area: Area = requested && areas.includes(requested) ? requested : 'scope';
  const wo = useWorkOrder(id);
  // #2895: every read keyed by the route id starts WITH the record read, not one render round behind it.
  // Reads that genuinely need the record (the project-scoped ones below) still wait for `project_id`.
  const woSteps = useWorkOrderSteps(id, area === 'checks');
  const roleName = useBuiltInRoleName();
  // A Draft is ASSIGNED to the people 1560 puts on the waiting list for the issue step — never everyone the issue gate
  // would admit. 1560 only assigns a Draft while it carries priced money with a recorded author, so the read is gated
  // on those same projected facts (a priced Draft with no author is assigned to nobody).
  const issueWaitingApplies = wo.data?.status === 'Draft'
    && Number(wo.data?.order_value ?? 0) > 0
    && Boolean(wo.data?.order_value_set_by);
  const issueWaiting = useOperationalWaitingRoute('work_order_issue', id, issueWaitingApplies);
  const { label: roleLabel } = useRoleOptions();
  const projectId = wo.data?.project_id ?? '';
  const project = useProject(projectId || undefined);
  const issuesOn = useFeature('incidents');
  const issues = useWorkOrderIssues(id, issuesOn);
  const openTasks = useWorkOrderOpenTasks(id);
  const allocations = useWorkOrderAllocations(id);
  const claimDocs = useWorkOrderClaimDocuments(id, area === 'documents');
  const boq = useBoqItems(projectId);
  const bastList = useWorkOrderAcceptancesFor(projectId, id);
  const bastMutations = useWorkOrderAcceptanceMutations(projectId);
  const { currentUser } = useAuth();
  const { toast } = useToast();
  const [confirmFor, setConfirmFor] = useState<{ acceptance: WorkOrderAcceptanceWithLines; error: string | null } | null>(null);
  const canBilling = may('view', 'salesInvoice');
  const billing = useWorkOrderBilling(projectId, canBilling && Boolean(wo.data) && area === 'billing');
  const billedMonths = useWorkOrderBilledMonths(id, canBilling && area === 'billing');
  const costLines = useWorkOrderCostLines(id ?? null, area === 'cost');
  const flatLines = useMemo(() => Object.values(costLines.data ?? {}).flat(), [costLines.data]);
  const labels = useWorkOrderTimesheetLabels(id ?? null, flatLines);
  const links = useWorkOrderCostLinks(id ?? null, flatLines);
  const money = useWorkOrderCostMoney(id ?? null, flatLines);
  const disciplines = useCostDisciplines(area === 'cost');
  const canPlanView = may('view', 'workOrderPlan');
  const pva = useProjectPlanVsActual(projectId, canPlanView && Boolean(wo.data) && area === 'cost');
  const decision = useWorkOrderDecision(wo.data ?? null);

  const allocationOptions = useMemo(
    () => (allocations.data ?? []).map((a) => {
      const item = (boq.data ?? []).find((b) => b.id === a.boq_item_id);
      return { value: a.id, label: item ? `${item.item_code} · ${item.description}` : a.boq_item_id };
    }),
    [allocations.data, boq.data],
  );

  const surveyLines = useMemo(
    () => (allocations.data ?? []).flatMap((a) => {
      const item = (boq.data ?? []).find((b) => b.id === a.boq_item_id);
      return item && item.earning_basis !== 'lump_sum' ? [{ id: item.id, label: `${item.item_code} · ${item.description}`, unit: item.unit }] : [];
    }),
    [allocations.data, boq.data],
  );

  const areaLabels: Record<Area, string> = {
    scope: t('pageIndex.scope', 'Site and scope'),
    cost: t('pageIndex.cost', 'Cost and plan'),
    material: t('pageIndex.material', 'Materials'),
    billing: t('pageIndex.billing', 'Billing'),
    checks: t('pageIndex.checks', 'Inspections and close-out'),
    documents: t('pageIndex.documents', 'Documents and safety'),
    issues: t('pageIndex.issues', 'Issues and tasks'),
  };
  const backLabel = t('back', 'Work orders');
  const goBack = () => navigate(projectId ? `/projects/${projectId}/work-orders` : '/work-orders');

  const acceptances = useMemo(() => (bastList.data ?? []).filter((a) => a.work_order_id === id), [bastList.data, id]);
  // The register slice waits for the two reads that name its linked documents (settled, success or error), then reads only
  // this order's rows plus those documents — never the project's whole register.
  const linkedDocIds = useMemo(
    () => [...acceptances.map((a) => a.document_id).filter((d): d is string => Boolean(d)), ...(claimDocs.data ?? [])],
    [acceptances, claimDocs.data],
  );
  const docs = useWorkOrderDocuments(projectId, id, linkedDocIds, area === 'documents' && !bastList.isPending && !claimDocs.isPending);
  const progress = useMemo(
    () => (allocations.data && boq.data ? deriveScopeProgress(allocations.data, boq.data, acceptances) : null),
    [allocations.data, boq.data, acceptances],
  );
  const groups = useMemo(() => (costLines.data ? buildCostView(flatLines, money.data ?? {}) : null), [costLines.data, flatLines, money.data]);
  // The cost read's reason per record, so a line says why it carries no amount (PU16), from the one read that decides it.
  const costReasons = useMemo(() => Object.fromEntries((pva.data?.costLines ?? []).flatMap((l) => l.recordId ? [[`${l.source}:${l.recordId}`, l.reason]] : [])), [pva.data]);
  const woFolderDoc = useMemo(
    () => (docs.data ?? []).find((d) => d.work_order_id === id && isMicrosoftFolder(d)) ?? null,
    [docs.data, id],
  );
  const documents = useMemo(() => {
    const ids = new Set([...acceptances.map((a) => a.document_id).filter((d): d is string => Boolean(d)), ...(claimDocs.data ?? [])]);
    return (docs.data ?? []).filter((d) => (d.work_order_id === id && !isMicrosoftFolder(d)) || ids.has(d.id));
  }, [docs.data, acceptances, claimDocs.data, id]);

  if (wo.isPending) return <><BackBar label={backLabel} phoneOnly onBack={goBack} /><ListState variant="loading" shape="detail" rows={5} /></>;
  if (wo.isError) {
    return <><BackBar label={backLabel} phoneOnly onBack={goBack} />
      <ListState variant="error" title={t('errorTitle', "Couldn't load this work order")} onRetry={() => void wo.refetch()} /></>;
  }
  const row = wo.data;
  if (!row) {
    return <><BackBar label={backLabel} onBack={() => navigate('/work-orders')} />
      <ListState variant="empty" icon="doc" title={t('notFound', 'Work order not found')}
        sub={t('notFoundSub', "It doesn't exist, or you don't have access to it.")} /></>;
  }
  const billingRow = (billing.data ?? []).find((b) => b.workOrderId === row.id) ?? null;
  const issueWaitingText = operationalWaitingForText(issueWaiting.data, t, { roleLabel, empty: 'none' });
  const orgId = currentUser?.org_id;
  // Pointer over or focus on a tab starts that tab's reads, so opening it is instant (read from the tab's id; the Tabs component stays shared and untouched).
  const prefetchFromTab = (e: React.SyntheticEvent) => {
    const tab = (e.target as HTMLElement).closest?.('[role="tab"]');
    const next = AREAS.find((key) => tab?.id === tabId('wo', key));
    if (next) prefetchArea(next);
  };
  const prefetchArea = (next: Area) => {
    if (next === area) return;
    if (next === 'cost') {
      void qc.prefetchQuery(workOrderCostLinesQuery(orgId, row.id));
      void qc.prefetchQuery(costDisciplinesQuery(orgId));
      if (canPlanView) void qc.prefetchQuery(projectPlanVsActualQuery(orgId, projectId));
    } else if (next === 'billing' && canBilling) {
      void qc.prefetchQuery(workOrderBillingQuery(orgId, projectId));
      void qc.prefetchQuery(workOrderBilledMonthsQuery(orgId, row.id));
    } else if (next === 'checks') void qc.prefetchQuery(workOrderStepsQuery(orgId, row.id));
  };
  const setArea = (next: Area) => navigate({ hash: `wo-${next}` }, { replace: true, state: withTabSwitchNavState(location.state) });
  // What is open on it, counted where both reads have landed: the tab says how many before it is opened.
  const openCount = openTasks.data && (!issuesOn || issues.data) ? openTasks.data.length + (issuesOn ? issues.data?.length ?? 0 : 0) : null;
  const tabItems = areas.map((key) => ({ value: key, label: areaLabels[key], count: key === 'issues' && openCount ? openCount : null, countPresentation: 'inline' as const }));
  const areasLabel = t('pageIndex.label', 'Sections of this work order');
  return (
    <>
      <BackBar label={backLabel} phoneOnly onBack={goBack} />
      <RecordHeader panelInset actionsOnTitleRow statusBelowMetaOnMobile compactStatsOnMobile name={row.wo_number ?? t('notNumbered', 'Not yet numbered')}
        status={<StatusPill record="workOrder" state={row.status} />}
        meta={<span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>{row.title}</span>
          <WorkOrderAheadBadge workOrderId={row.id} href={`/projects/${row.project_id}/work-orders`} />
          {row.client_po_number && <span>{t('clientPo', 'Client PO {{po}}', { po: row.client_po_number })}</span>}
        </span>}
        primaryAction={decision.primaryAction}
        menuItems={decision.menuItems.length > 0 ? decision.menuItems : undefined}
        stats={[
          { label: t('project', 'Project'), title: project.data?.name, secondaryOnMobile: true, value: <Link className="underline" to={`/projects/${row.project_id}`}>{project.data?.name ?? '—'}</Link> },
          { label: t('client', 'Client'), secondaryOnMobile: true, value: project.data?.client?.name ?? '—' },
          { label: t('orderValue', 'Order value'), value: <span className="tabular-nums" data-testid="wo-order-value">{formatTableMoney(row.order_value ?? 0, row.currency ?? '') ?? '—'}</span> },
          // How far it has got, value-weighted over its contract lines (the scope area lists each line).
          ...(progress?.overallPercent != null ? [{ label: t('complete', 'Complete'), value: <span className="tabular-nums" data-testid="wo-complete">{`${formatNumberExact(Math.round(progress.overallPercent * 10) / 10)}%`}</span> }] : []),
        ]} />
      {issueWaitingApplies && issueWaiting.isPending && (
        <span role="status" className="sr-only">{t('common:ui.listState.loading', 'Loading…')}</span>
      )}
      {issueWaitingApplies && issueWaiting.isError && (
        <p data-testid="wo-issue-waiting" className="text-sm text-muted-foreground">
          <button type="button" onClick={() => void issueWaiting.refetch()} className="font-medium text-primary-text hover:underline">
            {t('common:ui.listState.retry', 'Retry')}
          </button>
        </p>
      )}
      {issueWaitingApplies && issueWaiting.data && issueWaitingText && (
        <p data-testid="wo-issue-waiting" className="text-sm text-muted-foreground">
          {issueWaitingText}
        </p>
      )}
      {row.status === 'Cancelled' && row.cancel_reason && (
        <p data-testid="wo-cancel-reason" className="text-control text-foreground">{t('decision.cancelledBecause', 'Cancelled because: {{reason}}', { reason: row.cancel_reason })}</p>
      )}
      {decision.dialogs}
      {area !== 'documents' && <SafetyTodayLink workOrderId={row.id} projectId={row.project_id} status={row.status} />}
      <WorkOrderSupplyWarning workOrderId={row.id} projectId={row.project_id} />
      {row.status === 'Draft' && <WorkOrderChecksSection workOrderId={row.id} projectId={row.project_id} />}
      <AreaHelpProvider>{(help, notes) => (<>
      <div data-testid="wo-area-select" className="mt-4 mb-3 flex items-center gap-2 md:hidden">
        <div className="min-w-0 flex-1">
          <SelectField label={areasLabel} hideLabel value={area} onChange={(next) => setArea(next as Area)}
            options={areas.map((a) => ({ value: a, label: a === 'issues' && openCount ? `${areaLabels[a]} (${openCount})` : areaLabels[a] }))} className="touch-target w-full" />
        </div>
        <AreaHelpButton subject={areaLabels[area]} entries={help} />
      </div>
      <div data-testid="wo-area-tabs" onPointerOver={prefetchFromTab} onFocus={prefetchFromTab} className="mt-6 hidden items-center border-b border-border md:flex">
        <div className="min-w-0 flex-1">
          <Tabs<Area> items={tabItems} value={area} onChange={setArea} ariaLabel={areasLabel} idBase="wo" insetFirstTab="panel" className="mb-0! border-b-0! pr-8" />
        </div>
        <AreaHelpButton subject={areaLabels[area]} entries={help} />
      </div>
      <div role="tabpanel" id={tabPanelId('wo', area)} aria-labelledby={tabId('wo', area)} data-testid={`wo-area-${area}`} className="pt-4 md:pt-6">
        <AreaNotes notes={notes} />
        <RecordStack>
          {area === 'scope' && <>
            <SiteCheckpointFlag workOrderId={row.id} />
            <WorkOrderCheckpoints workOrderId={row.id} projectManagerId={project.data?.project_manager_id ?? null} status={row.status} />
            <SiteLocationSection workOrderId={row.id} projectId={row.project_id} />
            <ScopeSection projectId={row.project_id} progress={progress} isPending={allocations.isPending || boq.isPending || bastList.isPending} isError={allocations.isError || boq.isError || bastList.isError}
              onRetry={() => { void allocations.refetch(); void boq.refetch(); void bastList.refetch(); }} />
            <SectionsSection workOrder={{ id: row.id, project_id: row.project_id, status: row.status, currency: row.currency }} />
            <WorkOrderCrewLink workOrderId={row.id} />
            <SiteReportsSection workOrderId={row.id} />
          </>}
          {area === 'cost' && <>
            {/* Is it costing what we planned? first; the records behind the actual follow. */}
            {canPlanView && <PlanVsActualSection workOrderId={row.id} projectId={projectId} query={pva} disciplines={disciplines.data ?? []} canPlan={may('manage', 'workOrderPlan')} />}
            <CostSection reasons={costReasons} labels={labels.data ?? {}} links={links.data ?? {}} groups={groups} disciplines={disciplines.data ?? []} isPending={costLines.isPending} isError={costLines.isError || money.isError || disciplines.isError || links.isError || labels.isError}
              onRetry={() => { void costLines.refetch(); void money.refetch(); void disciplines.refetch(); void links.refetch(); void labels.refetch(); }} moneyPending={money.isPending && flatLines.length > 0} />
            {/* #2671: the dated revenue plan; renders nothing unless the organisation switched it on. */}
            <RevenuePlanGate workOrderId={row.id} woLabel={row.wo_number ?? row.title} frozen={row.status === 'Cancelled' || row.status === 'Closed'} />
            <PerformanceIndices projectId={row.project_id} workOrderId={row.id} recordedProgress={progress?.overallPercent} />
            {/* #2672: the daily target view; same switch and role gate as the plan above. */}
            <DailyTargetGate workOrderId={row.id} woLabel={row.wo_number ?? row.title} frozen={row.status === 'Cancelled' || row.status === 'Closed'} costGroups={groups} />
          </>}
          {area === 'billing' && <>
            <BillingSection contractHref={canBilling ? `/projects/${row.project_id}/contract?wo=${row.id}` : null} billing={canBilling ? { row: billingRow, isPending: billing.isPending, isError: billing.isError, onRetry: () => void billing.refetch() } : null}
              perMonth={canBilling ? { months: billedMonths.data, isPending: billedMonths.isPending, isError: billedMonths.isError, onRetry: () => void billedMonths.refetch() } : null}
              acceptances={acceptances} acceptancesPending={bastList.isPending} acceptancesError={bastList.isError} onRetryAcceptances={() => void bastList.refetch()}
              confirm={{
                canConfirm: (a) => row.status === 'Issued' && may('confirm', 'workOrderAcceptance', { currentUserId: currentUser?.id ?? null, record: { status: a.status, prepared_by: a.prepared_by } }),
                onConfirm: (a) => setConfirmFor({ acceptance: a, error: null }),
              }} />
            {confirmFor && (
              <ConfirmDialog
                open
                title={confirmFor.acceptance.is_final ? t('billing.confirmFinalTitle', 'Confirm the final BAST?') : t('billing.confirmTitle', 'Confirm this BAST?')}
                description={<div className="flex flex-col gap-2">
                  <p>{confirmFor.acceptance.is_final
                    ? t('billing.confirmFinalBody', 'Confirming a final BAST closes the work order at the accepted quantities. This cannot be undone.')
                    : t('billing.confirmBody', 'The accepted quantities are recorded as of this BAST. The work order stays open and nothing is invoiced.')}</p>
                  {confirmFor.error && <p role="alert" className="font-medium text-destructive-text">{confirmFor.error}</p>}
                </div>}
                confirmLabel={t('billing.confirmAction', 'Confirm BAST')}
                loading={bastMutations.confirm.isPending}
                onConfirm={() => {
                  void bastMutations.confirm.mutateAsync(confirmFor.acceptance.id).then(
                    () => { toast(t('billing.confirmedToast', 'BAST confirmed'), undefined, 'success'); setConfirmFor(null); },
                    (err: unknown) => {
                      const { headline, detail } = classifyMutationError(err, undefined, { suppressCapture: true });
                      setConfirmFor({ acceptance: confirmFor.acceptance, error: detail ? `${headline} ${detail}` : headline });
                    },
                  );
                }}
                onCancel={() => setConfirmFor(null)}
              />
            )}
            <BillingStepsSection workOrderId={row.id} projectId={row.project_id} status={row.status} />
            {may('view', 'surveyRecord') && <SurveySection workOrderId={row.id} projectId={row.project_id} status={row.status}
              projectManagerId={project.data?.project_manager_id ?? null} lines={surveyLines} />}
            {may('view', 'quantityChange') && <QuantityChangesSection workOrderId={row.id} projectId={row.project_id} status={row.status} />}
          </>}
          {area === 'material' && <>
            {/* #2885: quantities for the stock roles, who have no Contract area; value shows only where the server sends it. */}
            {/* What is on site for it, framed like its siblings: the table flush to the panel, a message or link on the inset. */}
            {stockOn && (
              <RecordSection title={t('stock:siteWork.balance.open', 'Stock for this work order')} actions={<Link to="/stock" className="text-control text-primary-text hover:underline">{t('stockOpen', 'Open stock')}</Link>} flush data-testid="wo-stock"
                bodyClassName="pb-[var(--panel-inset)] [&>section>p]:px-[var(--panel-inset)]">
                <WorkOrderStockBalance workOrderId={row.id} currency={row.currency} />
              </RecordSection>
            )}
            {stockOn && <ConsumablePlanSection workOrderId={row.id} workOrderStatus={row.status} project={project.data} />}
            {may('view', 'clientRequisition') && <ClientMaterialSection workOrderId={row.id} projectId={row.project_id} workOrderStatus={row.status} allocationOptions={allocationOptions} />}
          </>}
          {area === 'checks' && <>
            <InspectionsSection workOrderId={row.id} />
            <CloseoutSection workOrderId={row.id} projectId={row.project_id} status={row.status} />
            <MissingSection actions={<MaterialCompletionLink workOrderId={row.id} />} workOrderId={row.id} projectId={row.project_id} status={row.status} canBilling={canBilling}
              steps={woSteps.data ? missingStepsFromSource(woSteps.data, roleName) : undefined} stepsLoading={woSteps.isLoading} stepsError={woSteps.isError} onRetrySteps={() => void woSteps.refetch()}
              scopeLines={progress ? progress.lines.map((l) => ({ id: l.id, boqItemId: l.boqItemId, itemCode: l.itemCode, description: l.description, unit: l.unit, accepted: l.accepted })) : null}
              scopeError={allocations.isError || boq.isError || bastList.isError} />
          </>}
          {area === 'documents' && <>
            <DocumentsSection
              workOrderId={row.id}
              projectId={row.project_id}
              folderDoc={woFolderDoc}
              documents={documents}
              isPending={docs.isPending || bastList.isPending || claimDocs.isPending}
              isError={docs.isError || bastList.isError || claimDocs.isError}
              onRetry={() => { void docs.refetch(); void bastList.refetch(); void claimDocs.refetch(); }}
            />
            <SafetySection workOrderId={row.id} projectId={row.project_id} status={row.status} />
          </>}
          {area === 'issues' && <>
            {issuesOn && <IssuesSection issues={issues.data ?? []} isPending={issues.isPending} isError={issues.isError} onRetry={() => void issues.refetch()} />}
            <OpenTasksSection projectId={row.project_id} tasks={openTasks.data ?? []} isPending={openTasks.isPending} isError={openTasks.isError} onRetry={() => void openTasks.refetch()} />
            <ResponsiblePersonSection workOrderId={row.id} />
          </>}
        </RecordStack>
      </div>
      </>)}</AreaHelpProvider>
    </>
  );
};

export default WorkOrderDetail;
