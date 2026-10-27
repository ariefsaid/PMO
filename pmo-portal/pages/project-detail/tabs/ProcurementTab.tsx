import React, { useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Icon, ListState } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useProject } from '@/src/hooks/useProjects';
import { useProjectProcurements } from '@/src/hooks/useProcurements';
import { useErpPurchases } from '@/src/hooks/useErpPurchases';
import { COMMITTED_STATUSES, RESERVED_STATUSES } from '@/src/lib/db/procurements';
import type { ProcurementStatus } from '@/src/lib/db/procurementLifecycle';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';
import { formatCurrency, formatNumberWhole } from '@/src/lib/format';
import {
  PROJECT_PROCUREMENT_GROUPS,
  PROJECT_PROCUREMENT_STAGE_COPY,
} from '@/src/lib/projectProcurementStages';
import { ErpPurchasesSection } from '../ErpPurchasesSection';
import ProcurementB from '../options/ProcurementB';
import ProcurementC from '../options/ProcurementC';

export interface ProcurementTabProps {
  projectId: string;
}

const ProcurementTab: React.FC<ProcurementTabProps> = ({ projectId }) => {
  const [searchParams] = useSearchParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const may = usePermission();
  const { data: project } = useProject(projectId);
  const { data, isPending, isError, refetch } = useProjectProcurements(projectId);
  const canCreate = may('create', 'procurement');
  const canSeeProjectTotals = may('view', 'procurement');
  const erp = useErpPurchases(projectId, { enabled: canSeeProjectTotals });
  const rows = useMemo(
    () => [...(data ?? [])].sort((a, b) =>
      new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime(),
    ),
    [data],
  );

  const projectCurrency = project?.currency ?? rows[0]?.currency ?? null;
  const stageLabel = (status: ProcurementStatus) => {
    const fallback = PROJECT_PROCUREMENT_STAGE_COPY[status].label;
    switch (status) {
      case 'Draft': return t('projectDetail.procurement.stage.draft', fallback);
      case 'Requested': return t('projectDetail.procurement.stage.awaitingApproval', fallback);
      case 'Approved': return t('projectDetail.procurement.stage.approved', fallback);
      case 'Vendor Quoted': return t('projectDetail.procurement.stage.gettingQuotes', fallback);
      case 'Quote Selected': return t('projectDetail.procurement.stage.quoteChosen', fallback);
      case 'Ordered': return t('projectDetail.procurement.stage.ordered', fallback);
      case 'Received': return t('projectDetail.procurement.stage.delivered', fallback);
      case 'Vendor Invoiced': return t('projectDetail.procurement.stage.supplierInvoiced', fallback);
      case 'Paid': return t('projectDetail.procurement.stage.paid', fallback);
      case 'Rejected': return t('projectDetail.procurement.stage.rejected', fallback);
      case 'Cancelled': return t('projectDetail.procurement.stage.cancelled', fallback);
    }
    return fallback;
  };
  const nextStepLabel = (status: ProcurementStatus) => {
    const fallback = PROJECT_PROCUREMENT_STAGE_COPY[status].nextStep;
    if (!fallback) return null;
    switch (status) {
      case 'Draft': return t('projectDetail.procurement.nextStep.draft', fallback);
      case 'Requested': return t('projectDetail.procurement.nextStep.awaitingApproval', fallback);
      case 'Approved': return t('projectDetail.procurement.nextStep.approved', fallback);
      case 'Vendor Quoted': return t('projectDetail.procurement.nextStep.gettingQuotes', fallback);
      case 'Quote Selected': return t('projectDetail.procurement.nextStep.quoteChosen', fallback);
      case 'Ordered': return t('projectDetail.procurement.nextStep.ordered', fallback);
      case 'Received': return t('projectDetail.procurement.nextStep.delivered', fallback);
      case 'Vendor Invoiced': return t('projectDetail.procurement.nextStep.supplierInvoiced', fallback);
      default: return null;
    }
  };
  const groupLabel = (key: string, fallback: string) => {
    switch (key) {
      case 'needs-action': return t('projectDetail.procurement.group.needsAction', fallback);
      case 'in-progress': return t('projectDetail.procurement.group.inProgress', fallback);
      case 'invoiced-or-paid': return t('projectDetail.procurement.group.invoicedOrPaid', fallback);
      case 'rejected-or-cancelled': return t('projectDetail.procurement.group.rejectedOrCancelled', fallback);
      default: return fallback;
    }
  };

  const totalsByCurrency = useMemo(() => {
    const totals = new Map<string, { awaitingApproval: number; reserved: number; committed: number; paid: number }>();
    for (const row of rows) {
      const currency = row.currency ?? projectCurrency ?? '—';
      const group = totals.get(currency) ?? { awaitingApproval: 0, reserved: 0, committed: 0, paid: 0 };
      const value = Number(row.approved_total_value ?? row.total_value ?? 0);
      if (row.status === 'Requested') group.awaitingApproval += value;
      if (RESERVED_STATUSES.includes(row.status)) group.reserved += value;
      if (COMMITTED_STATUSES.includes(row.status)) group.committed += value;
      if (row.status === 'Paid') group.paid += value;
      totals.set(currency, group);
    }
    if (totals.size === 0 && projectCurrency) {
      totals.set(projectCurrency, { awaitingApproval: 0, reserved: 0, committed: 0, paid: 0 });
    }
    return [...totals.entries()].sort(([a], [b]) => (
      a === projectCurrency ? -1 : b === projectCurrency ? 1 : a.localeCompare(b)
    ));
  }, [rows, projectCurrency]);

  const erpListedBelow = (erp.data ?? []).some((row) => row.procurementId === null);
  const showErpDisclosure = canSeeProjectTotals && (
    erp.isError || (erp.data ?? []).some((row) => row.procurementId === null || Number(row.outstanding ?? 0) > 0)
  );

  if (searchParams.get('layout') === 'b') return <ProcurementB projectId={projectId} />;
  if (searchParams.get('layout') === 'c') return <ProcurementC projectId={projectId} />;

  if (isPending) {
    return (
      <div className="rounded-lg border border-border bg-card">
        <ListState variant="loading" rows={5} />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <ListState
        variant="error"
        title={t('projectDetail.procurement.error.title', "Couldn't load procurement")}
        sub={t(
          'projectDetail.procurement.error.sub',
          "Something went wrong fetching this project's procurement.",
        )}
        onRetry={() => refetch()}
      />
    );
  }

  const stageGroups = PROJECT_PROCUREMENT_GROUPS.map((group) => ({
    group,
    rows: rows.filter((row) => group.statuses.includes(row.status)),
  })).filter(({ rows: groupRows }) => groupRows.length > 0);

  const valueColumnClass = canSeeProjectTotals ? 'sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto_minmax(10rem,1fr)]' : 'sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(10rem,1fr)]';
  const renderRows = (groupRows: ProcurementWithRefs[]) => (
    <ul className="divide-y divide-border border-y border-border">
      {groupRows.map((row) => {
        const status = row.status as ProcurementStatus;
        const nextStep = nextStepLabel(status);

        return (
          <li key={row.id}>
            <Link
              to={`/procurement/${row.id}`}
              aria-label={`${t('projectDetail.procurement.openRow', 'Open')} ${row.title}`}
              className={`grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 px-2 py-3 text-sm text-foreground hover:bg-muted/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring ${valueColumnClass} sm:items-center sm:gap-4 sm:px-3`}
            >
              <span className="col-span-full row-start-1 min-w-0 sm:col-auto sm:row-auto">
                <span className="block whitespace-normal break-words font-semibold" title={row.title}>{row.title}</span>
                <span className="block truncate font-mono text-xs text-muted-foreground">
                  {row.code ?? row.id.slice(0, 8)}
                </span>
              </span>
              <span className="col-start-1 row-start-2 truncate text-xs text-muted-foreground sm:col-auto sm:row-auto sm:text-sm">
                {row.vendor?.name ?? <span className="text-muted-foreground">—</span>}
              </span>
              {canSeeProjectTotals && (
                <span className="col-start-2 row-start-2 whitespace-nowrap text-right font-medium tabular-nums sm:col-auto sm:row-auto">
                  {/* Currency is in the heading once; a row in another currency keeps its code. */}
                  {row.currency && row.currency !== projectCurrency
                    ? formatCurrency(Number(row.approved_total_value ?? row.total_value ?? 0), row.currency)
                    : formatNumberWhole(Number(row.approved_total_value ?? row.total_value ?? 0))}
                </span>
              )}
              <span className="col-span-full row-start-3 min-w-0 sm:col-auto sm:row-auto sm:text-left">
                <span className="block font-medium">{stageLabel(status)}</span>
                {nextStep && <span className="block text-xs text-muted-foreground">{nextStep}</span>}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );

  const heading = t('projectDetail.procurement.title', 'Procurement');

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[16px] font-bold tracking-[-0.01em]">
            {canSeeProjectTotals && projectCurrency ? `${heading} · ${projectCurrency}` : heading}
          </h2>
          {canSeeProjectTotals && (
            <div className="mt-2 space-y-1">
              {totalsByCurrency.map(([currency, totals]) => (
                <div key={currency} role="group" aria-label={`${currency} totals`} className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm">
                  {(totalsByCurrency.length > 1 || currency !== projectCurrency) && (
                    <span className="font-medium text-muted-foreground">{currency}</span>
                  )}
                  <dl className="flex flex-wrap gap-x-5 gap-y-1">
                    {[
                      [t('projectDetail.procurement.summary.awaitingApproval', 'Awaiting approval'), totals.awaitingApproval],
                      [t('projectDetail.procurement.summary.reserved', 'Reserved'), totals.reserved],
                      [t('projectDetail.procurement.summary.committed', 'Committed'), totals.committed],
                      [t('projectDetail.procurement.summary.paid', 'Paid'), totals.paid],
                    ].map(([label, value]) => (
                      <div key={String(label)} className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
                        <dt className="text-muted-foreground">{label}</dt>
                        <dd className="font-medium tabular-nums">{formatNumberWhole(Number(value))}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </div>
          )}
        </div>
        {canCreate && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate(`/procurement/new?project=${encodeURIComponent(projectId)}`)}
          >
            <Icon name="plus" />
            {t('projectDetail.procurement.newRequest', 'New procurement')}
          </Button>
        )}
      </div>

      {rows.length === 0 ? (
        <ListState
          variant="empty"
          icon="inbox"
          title={t('projectDetail.procurement.empty.title', 'No procurement on this project yet.')}
          sub={erpListedBelow
            ? t('uxs19.projectEmptyScope', 'Purchases recorded in ERPNext appear below.')
            : undefined}
        />
      ) : (
        <div className="space-y-5">
          <div className={`hidden sm:grid ${valueColumnClass} gap-4 px-3 text-xs font-semibold text-muted-foreground`}>
            <span>{t('projectDetail.procurement.table.procurement', 'Procurement')}</span>
            <span>{t('projectDetail.procurement.table.supplier', 'Supplier')}</span>
            {canSeeProjectTotals && <span className="text-right">{t('projectDetail.procurement.table.value', 'Value')}</span>}
            <span>{t('projectDetail.procurement.table.stage', 'Stage')}</span>
          </div>
          {stageGroups.map(({ group, rows: groupRows }) => {
            const label = groupLabel(group.key, group.label);
            const content = renderRows(groupRows);

            if (group.folded) {
              return (
                <details key={group.key} className="rounded-lg border border-border px-3 py-2">
                  <summary className="touch-target cursor-pointer py-1 text-sm font-semibold text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
                    {label} {groupRows.length}
                  </summary>
                  <div className="mt-2">{content}</div>
                </details>
              );
            }

            return (
              <section key={group.key} aria-labelledby={`procurement-group-${group.key}`}>
                <h3 id={`procurement-group-${group.key}`} className="mb-2 text-sm font-semibold text-foreground">
                  {label} {groupRows.length}
                </h3>
                {content}
              </section>
            );
          })}
        </div>
      )}

      {showErpDisclosure && (
        <details className="mt-6 border-t border-border pt-4">
          <summary className="cursor-pointer text-sm font-semibold text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
            {t('projectDetail.procurement.erpDisclosure', 'Accounting-system documents')}
          </summary>
          <ErpPurchasesSection projectId={projectId} />
        </details>
      )}
    </div>
  );
};

export default ProcurementTab;
