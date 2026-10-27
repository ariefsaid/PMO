import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Drawer, ListState } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useProject } from '@/src/hooks/useProjects';
import { useProjectProcurements } from '@/src/hooks/useProcurements';
import { useProcurementDetail } from '@/src/hooks/useProcurementDetail';
import { useErpPurchases } from '@/src/hooks/useErpPurchases';
import { PROJECT_PROCUREMENT_STAGE_COPY } from '@/src/lib/projectProcurementStages';
import type { ProcurementStatus } from '@/src/lib/db/procurementLifecycle';
import type { ProcurementDetail } from '@/src/lib/db/procurementLifecycle';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';
import { formatNumberWhole } from '@/src/lib/format';
import { ErpPurchasesSection } from '../ErpPurchasesSection';

interface ProcurementOptionProps {
  projectId: string;
}

type BoardGroup = 'needs-action' | 'in-progress' | 'invoiced-or-paid' | 'closed';

const GROUPS: { key: BoardGroup; label: string; statuses: ProcurementStatus[] }[] = [
  { key: 'needs-action', label: 'Needs action', statuses: ['Draft', 'Requested', 'Quote Selected'] },
  { key: 'in-progress', label: 'In progress', statuses: ['Approved', 'Vendor Quoted', 'Ordered', 'Received'] },
  { key: 'invoiced-or-paid', label: 'Invoiced or paid', statuses: ['Vendor Invoiced', 'Paid'] },
  { key: 'closed', label: 'Closed', statuses: ['Rejected', 'Cancelled'] },
];

const stageLabel = (status: ProcurementStatus) => PROJECT_PROCUREMENT_STAGE_COPY[status].label;
const nextStep = (status: ProcurementStatus) => PROJECT_PROCUREMENT_STAGE_COPY[status].nextStep;

function documentsFor(detail: ProcurementDetail) {
  return [
    { label: 'Purchase request', references: detail.purchase_requests.map((row) => row.pr_number ?? row.reference_number ?? row.external_ref) },
    { label: 'Quotation', references: detail.quotations.map((row) => row.vq_number ?? row.reference) },
    { label: 'Purchase order', references: detail.purchase_orders.map((row) => row.po_number ?? row.reference_number ?? row.external_ref) },
    { label: 'Receipt', references: detail.receipts.map((row) => row.gr_number ?? row.reference_number) },
    { label: 'Supplier invoice', references: detail.invoices.map((row) => row.vi_number ?? row.reference_number ?? row.external_ref) },
    { label: 'Payment', references: detail.payments.map((row) => row.pay_number ?? row.reference_number) },
  ].filter((document) => document.references.length > 0);
}

const ProcurementB: React.FC<ProcurementOptionProps> = ({ projectId }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const may = usePermission();
  const canSeeMoney = may('view', 'procurement');
  const canApprove = may('transition', 'procurement');
  const canCreate = may('create', 'procurement');
  const { data: project } = useProject(projectId);
  const { data, isPending, isError, refetch } = useProjectProcurements(projectId);
  const rows = useMemo(
    () => [...(data ?? [])].sort((a, b) =>
      new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime(),
    ),
    [data],
  );
  const projectCurrency = project?.currency ?? rows[0]?.currency ?? null;
  const erp = useErpPurchases(projectId, { enabled: canSeeMoney });
  const showErpDisclosure = canSeeMoney && (
    erp.isError || (erp.data ?? []).some((row) => row.procurementId === null || Number(row.outstanding ?? 0) > 0)
  );
  const [selected, setSelected] = useState<ProcurementWithRefs | null>(null);
  const { data: detail, isPending: detailPending, isError: detailError } = useProcurementDetail(selected?.id);

  if (isPending) return <div className="rounded-lg border border-border bg-card"><ListState variant="loading" rows={5} /></div>;
  if (isError || !data) {
    return (
      <ListState
        variant="error"
        title={t('projectDetail.procurement.error.title', "Couldn't load procurement")}
        sub={t('projectDetail.procurement.error.sub', "Something went wrong fetching this project's procurement.")}
        onRetry={() => refetch()}
      />
    );
  }

  const groups = GROUPS.map((group) => ({
    ...group,
    rows: rows.filter((row) => group.statuses.includes(row.status as ProcurementStatus)),
  }));
  const activeGroups = groups.filter((group) => group.key !== 'closed' && group.rows.length > 0);
  const closed = groups.find((group) => group.key === 'closed')?.rows ?? [];
  const heading = t('projectDetail.procurement.title', 'Procurement');
  const amount = (row: ProcurementWithRefs) => {
    if (!canSeeMoney) return null;
    const value = formatNumberWhole(Number(row.approved_total_value ?? row.total_value ?? 0));
    return row.currency && row.currency !== projectCurrency ? `${row.currency} ${value}` : value;
  };
  const nextStepFor = (status: ProcurementStatus) =>
    status === 'Requested' && !canApprove ? 'Waiting on approver' : nextStep(status);
  const showErp = showErpDisclosure || erp.isError;
  const docs = detail ? documentsFor(detail) : [];
  const supplier = selected?.vendor?.name ?? 'Supplier not set';
  const selectedCurrency = selected?.currency ?? projectCurrency;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[16px] font-bold tracking-[-0.01em]">
            {canSeeMoney && projectCurrency ? `${heading} · ${projectCurrency}` : heading}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {canApprove ? 'What is waiting on you, moving, or already invoiced?' : 'What is awaiting a decision, in flight, or committed?'}
          </p>
        </div>
        {canCreate && (
          <Button variant="outline" size="sm" onClick={() => navigate(`/procurement/new?project=${encodeURIComponent(projectId)}`)}>
            {t('projectDetail.procurement.newRequest', 'New procurement')}
          </Button>
        )}
      </div>

      {rows.length === 0 ? (
        <ListState variant="empty" icon="inbox" title={t('projectDetail.procurement.empty.title', 'No procurement on this project yet.')} />
      ) : (
        <div className="grid grid-cols-1 gap-x-6 gap-y-7 lg:grid-cols-3">
          {activeGroups.map((group) => (
            <section key={group.key} aria-labelledby={`procurement-board-${group.key}`} className="min-w-0">
              <div className="mb-2 flex items-baseline justify-between gap-3 border-b border-border pb-2">
                <h3 id={`procurement-board-${group.key}`} className="text-sm font-semibold text-foreground">{group.label}</h3>
                <span className="text-xs tabular-nums text-muted-foreground">{group.rows.length}</span>
              </div>
              <ul className="divide-y divide-border border-b border-border">
                {group.rows.map((row) => {
                  const status = row.status as ProcurementStatus;
                  return (
                    <li key={row.id}>
                      <Button
                        variant="ghost"
                        onClick={() => setSelected(row)}
                        aria-label={`Open details for ${row.title}`}
                        className="grid h-auto min-h-[68px] w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 rounded-none px-2 py-3 text-left hover:bg-muted/50 focus-visible:z-10"
                        style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', alignItems: 'start', justifyContent: 'stretch' }}
                      >
                        <span className="min-w-0 truncate font-semibold text-foreground">{row.title}</span>
                        {amount(row) !== null && <span className="whitespace-nowrap text-right font-medium tabular-nums">{amount(row)}</span>}
                        <span className="col-span-full min-w-0 truncate text-xs text-muted-foreground">{row.vendor?.name ?? 'Supplier not set'}</span>
                        <span className="col-span-full min-w-0 text-xs text-muted-foreground">
                          <span className="font-medium text-foreground">{stageLabel(status)}</span>
                          {nextStepFor(status) && <span> · {nextStepFor(status)}</span>}
                        </span>
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      {closed.length > 0 && (
        <details className="mt-6 border-t border-border pt-3">
          <summary className="touch-target cursor-pointer py-1 text-sm font-semibold text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
            Closed <span className="ml-1 font-normal tabular-nums text-muted-foreground">{closed.length}</span>
          </summary>
          <ul className="mt-2 divide-y divide-border border-y border-border">
            {closed.map((row) => (
              <li key={row.id}>
                <Button variant="ghost" onClick={() => setSelected(row)} className="flex h-auto min-h-12 w-full justify-between gap-3 rounded-none px-2 py-3 text-left">
                  <span className="min-w-0 truncate font-medium">{row.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{stageLabel(row.status as ProcurementStatus)}</span>
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {showErp && (
        <details className="mt-6 border-t border-border pt-4">
          <summary className="cursor-pointer text-sm font-semibold text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
            {t('projectDetail.procurement.erpDisclosure', 'Accounting-system documents')}
          </summary>
          <ErpPurchasesSection projectId={projectId} />
        </details>
      )}

      <Drawer
        open={selected !== null}
        title={selected?.title ?? 'Procurement details'}
        subtitle={selected ? `${stageLabel(selected.status as ProcurementStatus)} · ${supplier}` : undefined}
        width="lg"
        onClose={() => setSelected(null)}
      >
        {selected && (
          <div className="space-y-6">
            <section>
              <h3 className="text-sm font-semibold">Next step</h3>
              <p className="mt-1 text-sm text-muted-foreground">{nextStepFor(selected.status as ProcurementStatus) ?? 'No further action'}</p>
            </section>
            {canSeeMoney && (
              <section>
                <h3 className="text-sm font-semibold">{selectedCurrency ? `Value · ${selectedCurrency}` : 'Value'}</h3>
                <p className="mt-1 text-sm tabular-nums">{formatNumberWhole(Number(selected.approved_total_value ?? selected.total_value ?? 0))}</p>
              </section>
            )}
            <section>
              <h3 className="text-sm font-semibold">Documents</h3>
              {detailPending ? (
                <p className="mt-2 text-sm text-muted-foreground">Loading linked records…</p>
              ) : detailError ? (
                <p className="mt-2 text-sm text-muted-foreground">Linked records could not be loaded. Open procurement to review them.</p>
              ) : docs.length > 0 ? (
                <ul className="mt-2 divide-y divide-border border-y border-border">
                  {docs.map((document) => (
                    <li key={document.label} className="flex justify-between gap-4 py-2 text-sm">
                      <span>{document.label}</span>
                      <span className="text-right text-muted-foreground">{document.references.filter(Boolean).join(', ') || `${document.references.length} recorded`}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">No linked documents yet. Open procurement to add records.</p>
              )}
            </section>
            <Link to={`/procurement/${selected.id}`} className="inline-flex min-h-11 items-center text-sm font-medium text-foreground underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
              Open procurement
            </Link>
          </div>
        )}
      </Drawer>
    </div>
  );
};

export default ProcurementB;
