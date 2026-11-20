import React, { useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ListState, RecordHeader, RecordStack, StatusPill } from '@/src/components/ui';
import { BackBar } from '@/src/components/shell';
import { usePermission } from '@/src/auth/usePermission';
import { useFeature } from '@/src/auth/useFeature';
import { useProject } from '@/src/hooks/useProjects';
import { useBoqItems } from '@/src/hooks/useProgressBilling';
import { useWorkOrderAcceptances } from '@/src/hooks/useWorkOrderAcceptances';
import { useWorkOrderBilling } from '@/src/hooks/useWorkOrderBilling';
import { useDocuments } from '@/src/hooks/useDocuments';
import { useCostDisciplines, useWorkOrderCostLines, useWorkOrderCostMoney, useWorkOrderCostLinks, useWorkOrderTimesheetLabels } from '@/src/hooks/useWorkOrderCosts';
import { useProjectPlanVsActual } from '@/src/hooks/useWorkOrderPlanVsActual';
import { useWorkOrder, useWorkOrderAllocations, useWorkOrderClaimDocuments, useWorkOrderIssues, useWorkOrderOpenTasks } from '@/src/hooks/useWorkOrderRecord';
import { deriveScopeProgress } from '@/src/lib/workOrderProgress';
import { buildCostView } from '@/src/lib/workOrderCostView';
import { formatCurrency } from '@/src/lib/format';
import { ScopeSection } from './work-order-detail/ScopeSection';
import { CostSection } from './work-order-detail/CostSection';
import { BillingSection } from './work-order-detail/BillingSection';
import { PlanVsActualSection } from './work-order-detail/PlanVsActualSection';
import { DocumentsSection } from './work-order-detail/DocumentsSection';
import { ClientMaterialSection } from './work-order-detail/ClientMaterialSection';
import { IssuesSection } from './work-order-detail/IssuesSection';
import { OpenTasksSection } from './work-order-detail/OpenTasksSection';

/**
 * `/work-orders/:id` (#2518): one read-only page for a work order — scope and progress, costs, billing and
 * acceptances, documents, issues and tasks. Adds no write path; every read is the caller's own RLS (an absent,
 * foreign or unreadable id looks identical: not found).
 */
const WorkOrderDetail: React.FC = () => {
  const { t } = useTranslation('workOrders');
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const may = usePermission();
  const wo = useWorkOrder(id);
  const projectId = wo.data?.project_id ?? '';
  const project = useProject(projectId || undefined);
  const issuesOn = useFeature('incidents');
  const issues = useWorkOrderIssues(wo.data ? id : undefined, issuesOn);
  const openTasks = useWorkOrderOpenTasks(wo.data ? id : undefined);
  const allocations = useWorkOrderAllocations(wo.data ? id : undefined);
  const claimDocs = useWorkOrderClaimDocuments(wo.data ? id : undefined);
  const boq = useBoqItems(projectId);
  const bastList = useWorkOrderAcceptances(projectId);
  const canBilling = may('view', 'salesInvoice');
  const billing = useWorkOrderBilling(projectId, canBilling && Boolean(wo.data));
  const docs = useDocuments(projectId);
  const costLines = useWorkOrderCostLines(wo.data ? id ?? null : null);
  const flatLines = useMemo(() => Object.values(costLines.data ?? {}).flat(), [costLines.data]);
  const labels = useWorkOrderTimesheetLabels(wo.data ? id ?? null : null, flatLines);
  const links = useWorkOrderCostLinks(wo.data ? id ?? null : null, flatLines);
  const money = useWorkOrderCostMoney(wo.data ? id ?? null : null, flatLines);
  const disciplines = useCostDisciplines(Boolean(wo.data));
  const canPlanView = may('view', 'workOrderPlan');
  const pva = useProjectPlanVsActual(projectId, canPlanView && Boolean(wo.data));

  const allocationOptions = useMemo(
    () => (allocations.data ?? []).map((a) => {
      const item = (boq.data ?? []).find((b) => b.id === a.boq_item_id);
      return { value: a.id, label: item ? `${item.item_code} · ${item.description}` : a.boq_item_id };
    }),
    [allocations.data, boq.data],
  );

  const backLabel = t('back', 'Work orders');
  const goBack = () => navigate(projectId ? `/projects/${projectId}/work-orders` : '/projects');

  const acceptances = useMemo(() => (bastList.data ?? []).filter((a) => a.work_order_id === id), [bastList.data, id]);
  const progress = useMemo(
    () => (allocations.data && boq.data ? deriveScopeProgress(allocations.data, boq.data, acceptances) : null),
    [allocations.data, boq.data, acceptances],
  );
  const groups = useMemo(() => (costLines.data ? buildCostView(flatLines, money.data ?? {}) : null), [costLines.data, flatLines, money.data]);
  const documents = useMemo(() => {
    const ids = new Set([...acceptances.map((a) => a.document_id).filter((d): d is string => Boolean(d)), ...(claimDocs.data ?? [])]);
    return (docs.data ?? []).filter((d) => ids.has(d.id));
  }, [docs.data, acceptances, claimDocs.data]);

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
  return (
    <>
      <BackBar label={backLabel} phoneOnly onBack={goBack} />
      <RecordHeader panelInset name={row.wo_number ?? t('notNumbered', 'Not yet numbered')}
        status={<StatusPill record="workOrder" state={row.status} />}
        meta={<span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>{row.title}</span>
          {row.client_po_number && <span>{t('clientPo', 'Client PO {{po}}', { po: row.client_po_number })}</span>}
        </span>}
        stats={[
          { label: t('project', 'Project'), value: <Link className="underline" to={`/projects/${row.project_id}`}>{project.data?.name ?? '—'}</Link> },
          { label: t('client', 'Client'), value: project.data?.client?.name ?? '—' },
          { label: t('orderValue', 'Order value'), value: <span className="tabular-nums" data-testid="wo-order-value">{formatCurrency(Number(row.order_value), row.currency)}</span> },
        ]} />
      <RecordStack>
        <ScopeSection projectId={row.project_id} progress={progress} isPending={allocations.isPending || boq.isPending || bastList.isPending} isError={allocations.isError || boq.isError || bastList.isError}
          onRetry={() => { void allocations.refetch(); void boq.refetch(); void bastList.refetch(); }} />
        <CostSection labels={labels.data ?? {}} links={links.data ?? {}} groups={groups} disciplines={disciplines.data ?? []} isPending={costLines.isPending} isError={costLines.isError || money.isError || disciplines.isError || links.isError || labels.isError}
          onRetry={() => { void costLines.refetch(); void money.refetch(); void disciplines.refetch(); void links.refetch(); void labels.refetch(); }} moneyPending={money.isPending && flatLines.length > 0} />
        {may('view', 'clientRequisition') && <ClientMaterialSection workOrderId={row.id} projectId={row.project_id} workOrderStatus={row.status} allocationOptions={allocationOptions} />}
        {canPlanView && <PlanVsActualSection workOrderId={row.id} query={pva} disciplines={disciplines.data ?? []} />}
        <BillingSection billing={canBilling ? { row: billingRow, isPending: billing.isPending, isError: billing.isError, onRetry: () => void billing.refetch() } : null}
          acceptances={acceptances} acceptancesPending={bastList.isPending} acceptancesError={bastList.isError} onRetryAcceptances={() => void bastList.refetch()} />
        <DocumentsSection documents={documents} isPending={docs.isPending || bastList.isPending || claimDocs.isPending} isError={docs.isError || bastList.isError || claimDocs.isError} onRetry={() => { void docs.refetch(); void bastList.refetch(); void claimDocs.refetch(); }} />
        {issuesOn && <IssuesSection issues={issues.data ?? []} isPending={issues.isPending} isError={issues.isError} onRetry={() => void issues.refetch()} />}
        <OpenTasksSection tasks={openTasks.data ?? []} isPending={openTasks.isPending} isError={openTasks.isError} onRetry={() => void openTasks.refetch()} />
      </RecordStack>
    </>
  );
};

export default WorkOrderDetail;
