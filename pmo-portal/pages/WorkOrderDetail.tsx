import React, { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog, ListState, RecordHeader, RecordStack, StatusPill, useToast } from '@/src/components/ui';
import { useAuth } from '@/src/auth/useAuth';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import type { WorkOrderAcceptanceWithLines } from '@/src/lib/db/workOrderAcceptances';
import { BackBar } from '@/src/components/shell';
import { usePermission } from '@/src/auth/usePermission';
import { useFeature } from '@/src/auth/useFeature';
import { useProject } from '@/src/hooks/useProjects';
import { useBoqItems } from '@/src/hooks/useProgressBilling';
import { useWorkOrderAcceptanceMutations, useWorkOrderAcceptances } from '@/src/hooks/useWorkOrderAcceptances';
import { useWorkOrderBilledMonths, useWorkOrderBilling } from '@/src/hooks/useWorkOrderBilling';
import { useDocuments } from '@/src/hooks/useDocuments';
import { useCostDisciplines, useWorkOrderCostLines, useWorkOrderCostMoney, useWorkOrderCostLinks, useWorkOrderTimesheetLabels } from '@/src/hooks/useWorkOrderCosts';
import { useProjectPlanVsActual } from '@/src/hooks/useWorkOrderPlanVsActual';
import { useWorkOrder, useWorkOrderAllocations, useWorkOrderClaimDocuments, useWorkOrderIssues, useWorkOrderOpenTasks } from '@/src/hooks/useWorkOrderRecord';
import { useOperationalWaitingRoute, operationalWaitingForText } from '@/src/hooks/useOperationalWaitingRoute';
import { useRoleOptions } from '@/src/hooks/useRoleOptions';
import { deriveScopeProgress } from '@/src/lib/workOrderProgress';
import { buildCostView } from '@/src/lib/workOrderCostView';
import { formatCurrency } from '@/src/lib/format';
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
import { PageGroup, PageIndex } from './work-order-detail/PageIndex';
import { WorkOrderCrewLink } from './work-order-detail/WorkOrderCrewLink';
import { WorkOrderChecksSection } from './work-order-detail/WorkOrderChecksSection';
import { useWorkOrderDecision } from './work-order-detail/WorkOrderDecision';

/** The page's groups in reading order (walk T-G1): the index names them and jumps between them. */
const PAGE_GROUPS = ['scope', 'cost', 'material', 'billing', 'inspections', 'closeout', 'documents', 'issues'] as const;
type PageGroupKey = typeof PAGE_GROUPS[number];

/**
 * `/work-orders/:id` (#2518): one page for a work order — scope and progress, costs, billing and
 * acceptances, the close-out checklist (#2593), documents, issues and tasks. Every read is the caller's own RLS (an absent, foreign or unreadable id
 * looks identical: not found). Its write surfaces are the sections block (#2576) and the close-out checklist (#2593), gated by `can()`.
 */
const WorkOrderDetail: React.FC = () => {
  const { t } = useTranslation(['workOrders', 'waitingList']);
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const may = usePermission();
  const stockOn = useFeature('stock');
  const wo = useWorkOrder(id);
  const woSteps = useWorkOrderSteps(wo.data ? id : undefined);
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
  const issues = useWorkOrderIssues(wo.data ? id : undefined, issuesOn);
  const openTasks = useWorkOrderOpenTasks(wo.data ? id : undefined);
  const allocations = useWorkOrderAllocations(wo.data ? id : undefined);
  const claimDocs = useWorkOrderClaimDocuments(wo.data ? id : undefined);
  const boq = useBoqItems(projectId);
  const bastList = useWorkOrderAcceptances(projectId);
  const bastMutations = useWorkOrderAcceptanceMutations(projectId);
  const { currentUser } = useAuth();
  const { toast } = useToast();
  const [confirmFor, setConfirmFor] = useState<{ acceptance: WorkOrderAcceptanceWithLines; error: string | null } | null>(null);
  const canBilling = may('view', 'salesInvoice');
  const billing = useWorkOrderBilling(projectId, canBilling && Boolean(wo.data));
  const billedMonths = useWorkOrderBilledMonths(id, canBilling && Boolean(wo.data));
  const docs = useDocuments(projectId);
  const costLines = useWorkOrderCostLines(wo.data ? id ?? null : null);
  const flatLines = useMemo(() => Object.values(costLines.data ?? {}).flat(), [costLines.data]);
  const labels = useWorkOrderTimesheetLabels(wo.data ? id ?? null : null, flatLines);
  const links = useWorkOrderCostLinks(wo.data ? id ?? null : null, flatLines);
  const money = useWorkOrderCostMoney(wo.data ? id ?? null : null, flatLines);
  const disciplines = useCostDisciplines(Boolean(wo.data));
  const canPlanView = may('view', 'workOrderPlan');
  const pva = useProjectPlanVsActual(projectId, canPlanView && Boolean(wo.data));
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

  const groupLabels: Record<PageGroupKey, string> = {
    scope: t('pageIndex.scope', 'Site and scope'),
    cost: t('pageIndex.cost', 'Cost and plan'),
    material: t('pageIndex.material', 'Materials'),
    billing: t('pageIndex.billing', 'Billing'),
    inspections: t('pageIndex.inspections', 'Inspections'),
    closeout: t('pageIndex.closeout', 'Close-out'),
    documents: t('pageIndex.documents', 'Documents and safety'),
    issues: t('pageIndex.issues', 'Issues and tasks'),
  };
  const backLabel = t('back', 'Work orders');
  const goBack = () => navigate(projectId ? `/projects/${projectId}/work-orders` : '/projects');

  const acceptances = useMemo(() => (bastList.data ?? []).filter((a) => a.work_order_id === id), [bastList.data, id]);
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
    return <><BackBar label={backLabel} phoneOnly onBack={goBack} />
      <ListState variant="empty" icon="doc" title={t('notFound', 'Work order not found')}
        sub={t('notFoundSub', "It doesn't exist, or you don't have access to it.")} /></>;
  }
  const billingRow = (billing.data ?? []).find((b) => b.workOrderId === row.id) ?? null;
  const issueWaitingText = operationalWaitingForText(issueWaiting.data, t, { roleLabel, empty: 'none' });
  const hasMaterial = stockOn || may('view', 'clientRequisition');
  const indexEntries = PAGE_GROUPS.filter((key) => key !== 'material' || hasMaterial).map((key) => ({ id: `wo-${key}`, label: groupLabels[key] }));
  return (
    <>
      <BackBar label={backLabel} phoneOnly onBack={goBack} />
      <RecordHeader panelInset name={row.wo_number ?? t('notNumbered', 'Not yet numbered')}
        status={<StatusPill record="workOrder" state={row.status} />}
        meta={<span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>{row.title}</span>
          <WorkOrderAheadBadge workOrderId={row.id} href={`/projects/${row.project_id}/work-orders`} />
          {row.client_po_number && <span>{t('clientPo', 'Client PO {{po}}', { po: row.client_po_number })}</span>}
        </span>}
        primaryAction={decision.primaryAction}
        menuItems={decision.menuItems.length > 0 ? decision.menuItems : undefined}
        stats={[
          { label: t('project', 'Project'), value: <Link className="underline" to={`/projects/${row.project_id}`}>{project.data?.name ?? '—'}</Link> },
          { label: t('client', 'Client'), value: project.data?.client?.name ?? '—' },
          { label: t('orderValue', 'Order value'), value: <span className="tabular-nums" data-testid="wo-order-value">{formatCurrency(Number(row.order_value), row.currency)}</span> },
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
      <SafetyTodayLink workOrderId={row.id} projectId={row.project_id} status={row.status} />
      <WorkOrderSupplyWarning workOrderId={row.id} projectId={row.project_id} />
      <PageIndex entries={indexEntries} />
      <RecordStack>
        {row.status === 'Draft' && <WorkOrderChecksSection workOrderId={row.id} projectId={row.project_id} />}
        <PageGroup id="wo-scope" label={groupLabels.scope}>
          <SiteCheckpointFlag workOrderId={row.id} />
          <WorkOrderCheckpoints workOrderId={row.id} projectManagerId={project.data?.project_manager_id ?? null} status={row.status} />
          <SiteLocationSection workOrderId={row.id} projectId={row.project_id} />
          <ScopeSection projectId={row.project_id} progress={progress} isPending={allocations.isPending || boq.isPending || bastList.isPending} isError={allocations.isError || boq.isError || bastList.isError}
            onRetry={() => { void allocations.refetch(); void boq.refetch(); void bastList.refetch(); }} />
          <SectionsSection workOrder={{ id: row.id, project_id: row.project_id, status: row.status, currency: row.currency }} />
          <WorkOrderCrewLink workOrderId={row.id} />
          <SiteReportsSection workOrderId={row.id} />
        </PageGroup>
        <PageGroup id="wo-cost" label={groupLabels.cost}>
          <CostSection reasons={costReasons} labels={labels.data ?? {}} links={links.data ?? {}} groups={groups} disciplines={disciplines.data ?? []} isPending={costLines.isPending} isError={costLines.isError || money.isError || disciplines.isError || links.isError || labels.isError}
            onRetry={() => { void costLines.refetch(); void money.refetch(); void disciplines.refetch(); void links.refetch(); void labels.refetch(); }} moneyPending={money.isPending && flatLines.length > 0} />
          {canPlanView && <PlanVsActualSection workOrderId={row.id} projectId={projectId} query={pva} disciplines={disciplines.data ?? []} canPlan={may('manage', 'workOrderPlan')} />}
          {/* #2671: the dated revenue plan; renders nothing unless the organisation switched it on. */}
          <RevenuePlanGate workOrderId={row.id} woLabel={row.wo_number ?? row.title} frozen={row.status === 'Cancelled' || row.status === 'Closed'} />
          <PerformanceIndices projectId={row.project_id} workOrderId={row.id} />
          {/* #2672: the daily target view; same switch and role gate as the plan above. */}
          <DailyTargetGate workOrderId={row.id} />
        </PageGroup>
        {hasMaterial && (
          <PageGroup id="wo-material" label={groupLabels.material}>
            {/* #2885: quantities for the stock roles, who have no Contract area; value shows only where the server sends it. */}
            {stockOn && <div className="space-y-2"><h3 className="text-control font-medium">{t('stock:siteWork.balance.open', 'Stock for this work order')}</h3><WorkOrderStockBalance workOrderId={row.id} currency={row.currency} /></div>}
            {stockOn && <ConsumablePlanSection workOrderId={row.id} workOrderStatus={row.status} project={project.data} />}
            {may('view', 'clientRequisition') && <ClientMaterialSection workOrderId={row.id} projectId={row.project_id} workOrderStatus={row.status} allocationOptions={allocationOptions} />}
          </PageGroup>
        )}
        <PageGroup id="wo-billing" label={groupLabels.billing}>
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
        </PageGroup>
        <PageGroup id="wo-inspections" label={groupLabels.inspections}>
          <InspectionsSection workOrderId={row.id} />
        </PageGroup>
        <PageGroup id="wo-closeout" label={groupLabels.closeout}>
          <CloseoutSection workOrderId={row.id} projectId={row.project_id} status={row.status} />
          <MaterialCompletionLink workOrderId={row.id} />
          <MissingSection workOrderId={row.id} projectId={row.project_id} status={row.status} canBilling={canBilling}
            steps={woSteps.data ? missingStepsFromSource(woSteps.data, roleName) : undefined} stepsLoading={woSteps.isLoading} stepsError={woSteps.isError} onRetrySteps={() => void woSteps.refetch()}
            scopeLines={progress ? progress.lines.map((l) => ({ id: l.id, boqItemId: l.boqItemId, itemCode: l.itemCode, description: l.description, unit: l.unit, accepted: l.accepted })) : null}
            scopeError={allocations.isError || boq.isError || bastList.isError} />
        </PageGroup>
        <PageGroup id="wo-documents" label={groupLabels.documents}>
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
        </PageGroup>
        <PageGroup id="wo-issues" label={groupLabels.issues}>
          {issuesOn && <IssuesSection issues={issues.data ?? []} isPending={issues.isPending} isError={issues.isError} onRetry={() => void issues.refetch()} />}
          <ResponsiblePersonSection workOrderId={row.id} />
          <OpenTasksSection tasks={openTasks.data ?? []} isPending={openTasks.isPending} isError={openTasks.isError} onRetry={() => void openTasks.refetch()} />
        </PageGroup>
      </RecordStack>
    </>
  );
};

export default WorkOrderDetail;
