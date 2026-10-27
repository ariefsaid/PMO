import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Drawer, ListState } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useAuth } from '@/src/auth/useAuth';
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

type FilterKey = 'to-approve' | 'mine' | 'in-progress' | 'all';
const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'to-approve', label: 'To approve' },
  { key: 'mine', label: 'Mine' },
  { key: 'in-progress', label: 'In progress' },
  { key: 'all', label: 'All' },
];
const IN_PROGRESS: ProcurementStatus[] = ['Approved', 'Vendor Quoted', 'Quote Selected', 'Ordered', 'Received'];

const stageLabel = (status: ProcurementStatus) => PROJECT_PROCUREMENT_STAGE_COPY[status].label;
const nextStep = (status: ProcurementStatus) => PROJECT_PROCUREMENT_STAGE_COPY[status].nextStep;
const nextStepFor = (status: ProcurementStatus, canApprove: boolean) =>
  status === 'Requested' && !canApprove ? 'Waiting on approver' : nextStep(status);
const currentStep = (status: ProcurementStatus) => {
  if (status === 'Draft' || status === 'Requested' || status === 'Rejected' || status === 'Cancelled') return 0;
  if (status === 'Approved' || status === 'Vendor Quoted' || status === 'Quote Selected') return 1;
  if (status === 'Ordered') return 2;
  return 3;
};

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

const ProcurementC: React.FC<ProcurementOptionProps> = ({ projectId }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
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
  const [chosenFilter, setChosenFilter] = useState<FilterKey | null>(null);
  const { data: detail, isPending: detailPending, isError: detailError } = useProcurementDetail(selected?.id);

  const toApproveCount = canApprove ? rows.filter((row) => row.status === 'Requested').length : 0;
  const counts: Record<FilterKey, number> = {
    'to-approve': toApproveCount,
    mine: rows.filter((row) => row.requested_by_id === currentUser?.id).length,
    'in-progress': rows.filter((row) => IN_PROGRESS.includes(row.status as ProcurementStatus)).length,
    all: rows.length,
  };
  const activeFilter = chosenFilter ?? (toApproveCount > 0 ? 'to-approve' : 'all');
  const visibleRows = rows.filter((row) => {
    if (activeFilter === 'to-approve') return canApprove && row.status === 'Requested';
    if (activeFilter === 'mine') return row.requested_by_id === currentUser?.id;
    if (activeFilter === 'in-progress') return IN_PROGRESS.includes(row.status as ProcurementStatus);
    return true;
  });

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

  const heading = t('projectDetail.procurement.title', 'Procurement');
  const amount = (row: ProcurementWithRefs) => {
    if (!canSeeMoney) return null;
    const value = formatNumberWhole(Number(row.approved_total_value ?? row.total_value ?? 0));
    return row.currency && row.currency !== projectCurrency ? `${row.currency} ${value}` : value;
  };
  const showErp = showErpDisclosure || erp.isError;
  const docs = detail ? documentsFor(detail) : [];
  const supplier = selected?.vendor?.name ?? 'Supplier not set';
  const selectedCurrency = selected?.currency ?? projectCurrency;
  const steps = ['Request', 'Order', 'Receive', 'Pay'];

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[16px] font-bold tracking-[-0.01em]">
            {canSeeMoney && projectCurrency ? `${heading} · ${projectCurrency}` : heading}
          </h2>
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
        <>
          <div role="group" aria-label="Filter procurement" className="mb-3 flex max-w-full flex-wrap gap-1 border-b border-border pb-2">
            {FILTERS.map((filter) => (
              <Button
                key={filter.key}
                variant="ghost"
                size="sm"
                aria-pressed={activeFilter === filter.key}
                onClick={() => setChosenFilter(filter.key)}
                className={activeFilter === filter.key ? 'bg-muted font-semibold' : 'text-muted-foreground'}
              >
                {filter.label} <span className="ml-1 tabular-nums">{counts[filter.key]}</span>
              </Button>
            ))}
          </div>

          {visibleRows.length === 0 ? (
            <ListState variant="empty" icon="inbox" title={activeFilter === 'to-approve' ? 'Nothing to approve.' : 'No procurement matches this filter.'} />
          ) : (
            <div className="relative overflow-x-auto">
              <table aria-label="Project procurement" className="w-full border-collapse text-sm">
                <thead className="hidden border-b border-border text-left text-xs text-muted-foreground md:table-header-group">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">Procurement</th>
                    <th scope="col" className="px-3 py-2 font-medium">Supplier</th>
                    {canSeeMoney && <th scope="col" className="px-3 py-2 text-right font-medium">Value</th>}
                    <th scope="col" className="px-3 py-2 font-medium">Progress</th>
                    <th scope="col" className="px-3 py-2 font-medium">Next step</th>
                  </tr>
                </thead>
                <tbody className="block divide-y divide-border md:table-row-group md:divide-y-0">
                  {visibleRows.map((row) => {
                    const status = row.status as ProcurementStatus;
                    const current = currentStep(status);
                    return (
                      <tr key={row.id} className="grid grid-cols-2 gap-x-3 gap-y-1.5 py-3 md:table-row md:border-b md:border-border md:py-0">
                        <td className="col-span-2 min-w-0 px-1 md:table-cell md:px-3 md:py-3">
                          <Button
                            variant="ghost"
                            onClick={() => setSelected(row)}
                            aria-label={`Open details for ${row.title}`}
                            className="h-auto min-h-10 w-full justify-start rounded-none px-1 text-left md:min-h-0"
                          >
                            <span className="min-w-0">
                              <span className="block whitespace-normal break-words font-semibold text-foreground">{row.title}</span>
                              <span className="mt-0.5 block truncate font-mono text-xs text-muted-foreground">{row.code ?? row.id.slice(0, 8)}</span>
                            </span>
                          </Button>
                        </td>
                        <td className="col-start-1 px-1 text-xs text-muted-foreground md:table-cell md:px-3 md:py-3 md:text-sm">{row.vendor?.name ?? 'Supplier not set'}</td>
                        {canSeeMoney && <td className="col-start-2 whitespace-nowrap px-1 text-right text-sm font-medium tabular-nums md:table-cell md:px-3 md:py-3">{amount(row)}</td>}
                        <td className="col-span-2 min-w-0 px-1 pt-1 md:table-cell md:px-3 md:py-3 md:pt-0">
                          <ol aria-label={`${stageLabel(status)} progress`} className="flex min-w-0 flex-wrap gap-x-1.5 gap-y-1 text-xs">
                            {steps.map((step, index) => (
                              <li key={step} aria-current={index === current ? 'step' : undefined} className={index === current ? 'font-semibold text-foreground' : 'text-muted-foreground'}>
                                {index > 0 && <span aria-hidden="true" className="mr-1.5 text-border">·</span>}{step}
                              </li>
                            ))}
                          </ol>
                          <span className="mt-1 block text-xs text-muted-foreground md:hidden">{stageLabel(status)}</span>
                        </td>
                        <td className="col-span-2 px-1 text-xs text-muted-foreground md:table-cell md:px-3 md:py-3 md:text-sm">{nextStepFor(status, canApprove) ?? 'No further action'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
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
              <p className="mt-1 text-sm text-muted-foreground">{nextStepFor(selected.status as ProcurementStatus, canApprove) ?? 'No further action'}</p>
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

export default ProcurementC;
