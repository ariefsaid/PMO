import React, { useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ListState, RecordHeader, RecordStack, StatusPill } from '@/src/components/ui';
import { BackBar } from '@/src/components/shell';
import { usePermission } from '@/src/auth/usePermission';
import { useProject } from '@/src/hooks/useProjects';
import { useBoqItems } from '@/src/hooks/useProgressBilling';
import { useWorkOrderAcceptances } from '@/src/hooks/useWorkOrderAcceptances';
import { useWorkOrderBilling } from '@/src/hooks/useWorkOrderBilling';
import { useDocuments } from '@/src/hooks/useDocuments';
import { useCostDisciplines, useWorkOrderCostLines, useWorkOrderCostMoney } from '@/src/hooks/useWorkOrderCosts';
import { useWorkOrder, useWorkOrderAllocations } from '@/src/hooks/useWorkOrderRecord';
import { deriveScopeProgress } from '@/src/lib/workOrderProgress';
import { buildCostView } from '@/src/lib/workOrderCostView';
import { formatCurrency } from '@/src/lib/format';
import { ScopeSection } from './work-order-detail/ScopeSection';
import { CostSection } from './work-order-detail/CostSection';
import { BillingSection } from './work-order-detail/BillingSection';
import { DocumentsSection } from './work-order-detail/DocumentsSection';
import { IssuesTasksSection } from './work-order-detail/IssuesTasksSection';

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
  const allocations = useWorkOrderAllocations(wo.data ? id : undefined);
  const boq = useBoqItems(projectId);
  const bastList = useWorkOrderAcceptances(projectId);
  const canBilling = may('view', 'salesInvoice');
  const billing = useWorkOrderBilling(projectId, canBilling && Boolean(wo.data));
  const docs = useDocuments(projectId);
  const costLines = useWorkOrderCostLines(wo.data ? id ?? null : null);
  const flatLines = useMemo(() => Object.values(costLines.data ?? {}).flat(), [costLines.data]);
  const money = useWorkOrderCostMoney(wo.data ? id ?? null : null, flatLines);
  const disciplines = useCostDisciplines(Boolean(wo.data));

  const backLabel = t('back', 'Work orders');
  const goBack = () => navigate(projectId ? `/projects/${projectId}?tab=work-orders` : '/projects');

  const acceptances = useMemo(() => (bastList.data ?? []).filter((a) => a.work_order_id === id), [bastList.data, id]);
  const progress = useMemo(
    () => (allocations.data && boq.data ? deriveScopeProgress(allocations.data, boq.data, acceptances) : null),
    [allocations.data, boq.data, acceptances],
  );
  const groups = useMemo(() => (costLines.data ? buildCostView(flatLines, money.data ?? {}) : null), [costLines.data, flatLines, money.data]);
  const documents = useMemo(() => {
    const ids = new Set(acceptances.map((a) => a.document_id).filter((d): d is string => Boolean(d)));
    return (docs.data ?? []).filter((d) => ids.has(d.id));
  }, [docs.data, acceptances]);

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
        <ScopeSection projectId={row.project_id} progress={progress} isPending={allocations.isPending || boq.isPending} isError={allocations.isError || boq.isError}
          onRetry={() => { void allocations.refetch(); void boq.refetch(); }} />
        <CostSection groups={groups} disciplines={disciplines.data ?? []} isPending={costLines.isPending} isError={costLines.isError}
          onRetry={() => void costLines.refetch()} moneyPending={money.isPending && flatLines.length > 0} />
        <BillingSection billing={canBilling ? { row: billingRow, isPending: billing.isPending, isError: billing.isError, onRetry: () => void billing.refetch() } : null}
          acceptances={acceptances} acceptancesPending={bastList.isPending} acceptancesError={bastList.isError} onRetryAcceptances={() => void bastList.refetch()} />
        <DocumentsSection projectId={row.project_id} documents={documents} isPending={docs.isPending || bastList.isPending} isError={docs.isError} onRetry={() => void docs.refetch()} />
        <IssuesTasksSection />
      </RecordStack>
    </>
  );
};

export default WorkOrderDetail;
