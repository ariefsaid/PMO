import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardHead, CardPad, Icon, Tooltip } from '@/src/components/ui';
import { formatCurrency, formatDateUtc } from '@/src/lib/format';
import type { ProcurementDetail } from '@/src/lib/db/procurementLifecycle';
import type { LedgerRow } from '@/src/lib/db/procurementLedger';
import type { ErpPurchaseRow } from '@/src/lib/repositories/erpPurchases';
import { useProjectBudget } from '@/src/hooks/useBudget';
import { useProjectCommittedSpend, useProjectReservedSpend } from '@/src/hooks/useProcurements';
import { usePermission } from '@/src/auth/usePermission';
import { procurementMoney, type ProcurementMoneyKind } from '../blocks/procurementMoney';
import { stageDates, stageForStatus, type StageKey } from '../blocks/stage';
import { computeBudgetSignal } from '../computeBudgetSignal';
import { ProcurementFilesSubsection } from '../ProcurementFilesSubsection';

const STAGES: { key: StageKey; label: string; ordinal: number }[] = [
  { key: 'request', label: 'Request', ordinal: 0 },
  { key: 'order', label: 'Order', ordinal: 1 },
  { key: 'receive', label: 'Receive', ordinal: 2 },
  { key: 'pay', label: 'Pay', ordinal: 3 },
];

const phaseByType: Record<LedgerRow['type'], 'purchase_request' | 'rfq' | 'quotation' | 'purchase_order' | 'receipt' | 'invoice' | 'payment'> = {
  PR: 'purchase_request', RFQ: 'rfq', Quote: 'quotation', PO: 'purchase_order', GR: 'receipt', Invoice: 'invoice', Payment: 'payment',
};

const typeLabel: Record<LedgerRow['type'], string> = {
  PR: 'Purchase request', RFQ: 'Quote request', Quote: 'Quotation', PO: 'Purchase order', GR: 'Receipt', Invoice: 'Supplier invoice', Payment: 'Payment',
};

function showDate(value: string | null | undefined, missing = 'Date not recorded'): string {
  if (!value) return missing;
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return missing;
  return formatDateUtc(date);
}

export interface ProcurementStageTrackerProps {
  procurement: ProcurementDetail;
  linkedDocuments: readonly ErpPurchaseRow[];
}

export const ProcurementStageTracker: React.FC<ProcurementStageTrackerProps> = ({ procurement, linkedDocuments }) => {
  const { t } = useTranslation('procurementRecord');
  const dates = stageDates(procurement, linkedDocuments.map((doc) => ({ doctype: doc.doctype, docDate: doc.docDate })));
  const current = STAGES.findIndex((stage) => stage.label === stageForStatus(procurement.status));
  const rowsByStage: Record<StageKey, number> = {
    request: procurement.purchase_requests.length,
    order: procurement.purchase_orders.length + linkedDocuments.filter((doc) => doc.doctype === 'Purchase Order').length,
    receive: procurement.receipts.length + linkedDocuments.filter((doc) => doc.doctype === 'Purchase Receipt').length,
    pay: procurement.invoices.length + procurement.payments.length + linkedDocuments.filter((doc) => doc.doctype === 'Purchase Invoice' || doc.doctype === 'Payment Entry').length,
  };
  const partialReceive = procurement.receipts.some((receipt) => receipt.status === 'Partial');

  return (
    <Card aria-label="Procurement stages" data-testid="procurement-stage-tracker">
      <CardPad>
        <ol className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
          {STAGES.map((stage, index) => {
            const done = index < current || (index === current && procurement.status === 'Paid');
            const isCurrent = index === current && procurement.status !== 'Paid';
            const partial = stage.key === 'receive' && partialReceive;
            const count = rowsByStage[stage.key];
            const date = dates[stage.key];
            const stageLabel = t(`stage.${stage.key}`, stage.label);
            const state = partial
              ? t('stage.partialReceipt', { defaultValue: '{{received}} of {{orders}} orders received', received: procurement.receipts.length, orders: Math.max(procurement.purchase_orders.length, procurement.receipts.length) })
              : count > 0
                ? `${count} ${count === 1 ? t('stage.record', 'record') : t('stage.records', 'records')}`
                : index === current
                  ? t('stage.startedAt', { defaultValue: 'Started at the {{stage}}', stage: stageLabel.toLowerCase() })
                  : t('stage.notRecorded', 'Not recorded');
            return (
              <li key={stage.key} aria-current={isCurrent ? 'step' : undefined} className="min-w-0">
                <div className="flex items-center gap-2">
                  <span aria-hidden="true" className={`h-1.5 flex-1 rounded-full ${done ? 'bg-success' : isCurrent ? 'bg-primary' : 'bg-border/50'} ${partial ? 'relative after:block after:h-full after:w-1/2 after:rounded-full after:bg-primary' : ''}`} />
                  <span className={`text-[12.5px] font-semibold ${isCurrent ? 'text-primary-text' : done ? 'text-success' : 'text-muted-foreground'}`}>{stageLabel}</span>
                </div>
                <p className="mt-1 text-[12px] text-muted-foreground">{showDate(date, t('timeline.dateMissing', 'Date not recorded'))}</p>
                <p className="text-[12px] text-muted-foreground">{state}</p>
              </li>
            );
          })}
        </ol>
      </CardPad>
    </Card>
  );
};

export interface ProcurementMoneySummaryProps {
  procurement: ProcurementDetail;
  linkedDocuments: readonly ErpPurchaseRow[];
  isEngineer: boolean;
  budgetSignal?: React.ReactNode;
}

interface ProcurementBudgetSignalProps {
  projectId: string | null;
  totalValue: number;
  status: ProcurementDetail['status'];
  currency: string;
}

export const ProcurementBudgetSignal: React.FC<ProcurementBudgetSignalProps> = ({ projectId, totalValue, status, currency }) => {
  const { t } = useTranslation('procurementRecord');
  const may = usePermission();
  const scopedProjectId = may('view', 'procurement') ? projectId : null;
  const budget = useProjectBudget(scopedProjectId ?? '');
  const committed = useProjectCommittedSpend(scopedProjectId);
  const reserved = useProjectReservedSpend(scopedProjectId);

  if (!scopedProjectId) return null;
  if (budget.isPending || committed.isPending || reserved.isPending) {
    return <span className="text-[12px] font-normal text-muted-foreground">{t('money.budgetLoading', 'Budget signal loading')}</span>;
  }
  if (budget.isError || committed.isError || reserved.isError) {
    return <span className="text-[12px] font-normal text-muted-foreground">{t('money.budgetUnavailable', 'Budget signal unavailable')}</span>;
  }
  if (!budget.data) return <span className="text-[12px] font-normal text-muted-foreground">{t('money.noBudget', 'No active project budget')}</span>;

  const { available, afterRequest } = computeBudgetSignal({
    budget: budget.data,
    committed: committed.data ?? 0,
    reserved: reserved.data ?? 0,
    totalValue,
    status,
  });
  const label = t('money.budgetSignal', 'Available {{available}} · after this request {{after}}', {
    available: formatCurrency(available, currency),
    after: formatCurrency(afterRequest, currency),
  });
  return <Tooltip content={t('money.budgetSignalTooltip', 'Available = project budget less committed and reserved spend. “After this request” includes this procurement at its current stage. Source: project budget, committed procurement spend, and reserved procurement spend.')} title={t('money.projectBudget', 'Project budget signal')}>
    <span tabIndex={0} className="text-[12px] font-normal text-muted-foreground underline decoration-dotted underline-offset-2">{label}</span>
  </Tooltip>;
};

const moneyLabels: Record<ProcurementMoneyKind, string> = {
  requested: 'Requested', ordered: 'Ordered', invoiced: 'Invoiced', paid: 'Paid', unpaid: 'Unpaid',
};

export const ProcurementMoneySummary: React.FC<ProcurementMoneySummaryProps> = ({ procurement, linkedDocuments, isEngineer, budgetSignal }) => {
  const { t } = useTranslation('procurementRecord');
  const money = procurementMoney({
    total_value: procurement.total_value,
    purchase_requests: procurement.purchase_requests.map((row) => ({ amount: row.amount })),
    purchase_orders: procurement.purchase_orders.map((row) => ({ amount: row.amount })),
    procurement_invoices: procurement.invoices.map((row) => ({ amount: row.amount, erp_outstanding_amount: row.erp_outstanding_amount })),
    payments: procurement.payments.map((row) => ({ amount: row.amount, status: row.status })),
    erpDocuments: linkedDocuments.map((doc) => ({ doctype: doc.doctype, grand_total: doc.grandTotal, outstanding_amount: doc.outstanding })),
  });
  const kinds: ProcurementMoneyKind[] = isEngineer
    ? ['requested', 'ordered']
    : ['unpaid', 'requested', 'ordered', 'invoiced', 'paid'];
  const outstandingInvoices = linkedDocuments
    .filter((doc) => doc.doctype === 'Purchase Invoice' && (doc.outstanding ?? 0) > 0 && doc.dueDate)
    .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
  const nextDueDate = outstandingInvoices[0]?.dueDate;
  const dueDay = nextDueDate ? Date.UTC(Number(nextDueDate.slice(0, 4)), Number(nextDueDate.slice(5, 7)) - 1, Number(nextDueDate.slice(8, 10))) : null;
  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const overdueDays = dueDay != null && dueDay < todayUtc ? Math.floor((todayUtc - dueDay) / 86_400_000) : 0;

  const help = (kind: ProcurementMoneyKind, unknown: boolean) => {
    const label = t(`money.${kind}`, moneyLabels[kind]);
    if (unknown) return t('money.unknown', { defaultValue: '{{figure}} could not be calculated because a source amount is missing. Source: procurement records and linked accounting-system documents.', figure: label });
    if (kind === 'unpaid') return t('money.unpaidHelp', 'Calculated from invoiced less paid amounts, or from linked accounting-system invoice balances. Source: supplier invoices, payments, and linked accounting-system documents.');
    return t('money.calculation', { defaultValue: 'Sum of recorded {{figure}} amounts. Source: procurement records and linked accounting-system documents.', figure: label.toLowerCase() });
  };

  return (
    <Card data-testid="procurement-money-summary">
      <CardHead className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span>{t('money.title', { defaultValue: 'Money · {{currency}}, before tax', currency: procurement.currency })}</span>
        {budgetSignal}
      </CardHead>
      <CardPad>
        <div className="grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-5">
          {kinds.map((kind) => {
            const figure = money[kind];
            const unknown = figure.unknown || figure.amount == null;
            const lead = kind === 'unpaid' && !unknown && (figure.amount ?? 0) > 0;
            return (
              <div key={kind} className={lead ? 'sm:col-span-1' : ''}>
                <Tooltip content={help(kind, unknown)} title={`${t(`money.${kind}`, moneyLabels[kind])} calculation`}>
                  <button type="button" aria-label={`${t(`money.${kind}`, moneyLabels[kind])} calculation`} className="mb-1 inline-flex items-center gap-1 text-left text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground underline decoration-dotted underline-offset-2">
                    {t(`money.${kind}`, moneyLabels[kind])} <Icon name="info" className="size-3" />
                  </button>
                </Tooltip>
                <p className={`${lead ? 'text-[20px] font-semibold text-foreground' : 'text-[16px] font-medium text-foreground'} tabular-nums`}>
                  {unknown ? '—' : formatCurrency(figure.amount ?? 0, procurement.currency)}
                </p>
                {unknown && <p className="mt-0.5 text-[11px] text-muted-foreground">{t('money.amountMissing', 'Amount not recorded')}</p>}
                {lead && <p className="mt-0.5 text-[11px] text-muted-foreground">{t('money.outstanding', 'Outstanding balance')}</p>}
                {lead && nextDueDate && <p className={`mt-0.5 text-[11px] ${overdueDays > 0 ? 'font-medium text-destructive' : 'text-muted-foreground'}`}>
                  {overdueDays > 0
                    ? t('money.overdue', { defaultValue: 'Overdue {{days}} days · due {{date}}', days: overdueDays, date: showDate(nextDueDate) })
                    : t('money.due', { defaultValue: 'Due {{date}}', date: showDate(nextDueDate) })}
                </p>}
              </div>
            );
          })}
        </div>
        {isEngineer && <p className="mt-4 text-[12.5px] text-muted-foreground">{t('money.financeOnly', 'Invoices and payments are handled by Finance.')}</p>}
      </CardPad>
    </Card>
  );
};

type TimelineEntry = {
  id: string;
  date: string | null;
  label: string;
  number?: string | null;
  meta?: string;
  amount?: number | null;
  currency?: string | null;
  note?: string | null;
  actor?: string | null;
  source?: string;
  ledger?: LedgerRow;
  erp?: ErpPurchaseRow;
};

export interface ProcurementTimelineProps {
  procurement: ProcurementDetail;
  ledgerRows: readonly LedgerRow[];
  linkedDocuments: readonly ErpPurchaseRow[];
  isEngineer: boolean;
  canWriteFiles: boolean;
  uploadedById: string | null;
  onFullHistory: () => void;
}

export const ProcurementTimeline: React.FC<ProcurementTimelineProps> = ({ procurement, ledgerRows, linkedDocuments, isEngineer, canWriteFiles, uploadedById, onFullHistory }) => {
  const { t } = useTranslation('procurementRecord');
  const [filter, setFilter] = useState<'all' | 'financial' | 'has-file'>('all');
  const entries = useMemo(() => {
    const statusEntries: TimelineEntry[] = procurement.statusEvents.map((event) => {
      const joined = event as typeof event & { actor?: { full_name?: string | null } | null };
      const destination = event.to_status === 'Approved' ? t('timeline.approved', 'Approved') : event.to_status === 'Rejected' ? t('timeline.returnedRejected', 'Returned or rejected') : event.to_status === 'Cancelled' ? t('timeline.cancelled', 'Cancelled') : event.to_status === 'Requested' ? t('timeline.submitted', 'Submitted for approval') : String(event.to_status);
      return { id: `status-${event.id}`, date: event.created_at, label: destination, note: event.notes, actor: joined.actor?.full_name ?? null, source: 'status' };
    });
    const recordEntries: TimelineEntry[] = ledgerRows
      .map((row) => ({
        id: row.id, date: row.date, label: t(`timeline.record.${row.type}`, typeLabel[row.type]), number: row.systemNumber, meta: row.status,
        amount: isEngineer && (row.type === 'Invoice' || row.type === 'Payment') ? null : row.amount,
        currency: row.currency, source: 'procurement', ledger: row,
      }));
    const erpEntries: TimelineEntry[] = linkedDocuments
      .filter((doc) => !(isEngineer && (doc.doctype === 'Purchase Invoice' || doc.doctype === 'Payment Entry')))
      .map((doc) => ({
        id: `erp-${doc.id}`, date: doc.docDate, label: doc.doctype === 'Purchase Invoice' ? t('timeline.supplierInvoice', 'Supplier invoice') : doc.doctype === 'Purchase Receipt' ? t('timeline.receipt', 'Receipt') : doc.doctype === 'Purchase Order' ? t('timeline.order', 'Order') : t('timeline.payment', 'Payment'), number: doc.name,
        meta: [doc.supplier, doc.erpStatus].filter(Boolean).join(' · '), amount: isEngineer ? null : doc.grandTotal,
        currency: doc.currency, source: 'accounting-system', erp: doc,
      }));
    return [...statusEntries, ...recordEntries, ...erpEntries].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || a.id.localeCompare(b.id));
  }, [procurement.statusEvents, ledgerRows, linkedDocuments, isEngineer, t]);
  const visible = entries.filter((entry) => filter === 'all'
    || (filter === 'financial' ? Boolean(entry.ledger?.financial || entry.erp) : (entry.ledger?.fileCount ?? 0) > 0));

  return (
    <Card data-testid="procurement-timeline">
      <CardHead className="flex flex-wrap items-center gap-3">
        <span className="flex-1">{t('timeline.title', 'Timeline')}</span>
        <span className="text-[12px] font-normal text-muted-foreground">{t('timeline.inDateOrder', 'in date order · missing steps aren’t required by your company')}</span>
        <button type="button" onClick={onFullHistory} className="text-[12.5px] font-medium text-primary-text underline underline-offset-2">{t('timeline.fullHistory', 'Full history')}</button>
      </CardHead>
      <CardPad>
        <div role="group" aria-label="Timeline filter" className="mb-3 flex flex-wrap gap-2">
          {(['all', 'financial', 'has-file'] as const).map((value) => (
            <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)} className={`rounded-md px-2.5 py-1 text-[12px] ${filter === value ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
              {value === 'all' ? t('timeline.all', 'All') : value === 'financial' ? t('timeline.financial', 'Financial') : t('timeline.hasFile', 'Has file')}
            </button>
          ))}
        </div>
        {visible.length === 0 ? <p className="py-4 text-[13px] text-muted-foreground">{t('timeline.empty', 'No activity recorded yet.')}</p> : (
          <ol className="divide-y divide-border/70">
            {visible.map((entry) => (
              <li key={entry.id} data-testid="procurement-timeline-row" className="py-2.5 first:pt-0 last:pb-0">
                <details>
                  <summary className="grid cursor-pointer list-none grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
                    <span aria-hidden="true" className="mt-1.5 size-2 rounded-full bg-primary" />
                    <span className="min-w-0">
                      <span className="block text-[13.5px] font-medium">{entry.label}{entry.number ? <span className="ml-1 font-mono text-[12px]">{entry.number}</span> : null}</span>
                      <span className="block text-[12px] text-muted-foreground">{entry.actor ? `${entry.actor} · ` : ''}{entry.note ?? entry.meta ?? ''}{entry.source === 'accounting-system' ? `${entry.meta ? ' · ' : ''}${t('timeline.fromAccounting', 'from accounting system')}` : ''}{entry.ledger?.fileCount ? ` · ${entry.ledger.fileCount} ${t('timeline.files', 'files')}` : ''}</span>
                    </span>
                    <span className="whitespace-nowrap text-[12px] text-muted-foreground">{showDate(entry.date, t('timeline.dateMissing', 'Date not recorded'))}</span>
                    {entry.amount != null && entry.currency && !isEngineer && (
                      <Tooltip content={`Amount on this ${entry.label.toLowerCase()}. Source: ${entry.source === 'accounting-system' ? 'linked accounting-system document' : 'procurement record'}.`}>
                        <span tabIndex={0} className="col-start-2 text-[12.5px] font-medium tabular-nums">{formatCurrency(Number(entry.amount), entry.currency)}</span>
                      </Tooltip>
                    )}
                  </summary>
                  <div className="ml-5 mt-2 border-l border-border pl-3 text-[12.5px] text-muted-foreground">
                    {entry.note && <p className="mb-2 text-foreground">{entry.note}</p>}
                    {entry.erp && <dl className="mb-2 grid grid-cols-2 gap-x-4 gap-y-1"><dt>{t('details.supplier', 'Supplier')}</dt><dd>{entry.erp.supplier ?? '—'}</dd><dt>{t('timeline.status', 'Status')}</dt><dd>{entry.erp.erpStatus ?? '—'}</dd><dt>{t('timeline.dueDate', 'Due date')}</dt><dd>{showDate(entry.erp.dueDate, t('timeline.dateMissing', 'Date not recorded'))}</dd></dl>}
                    {entry.ledger && <>
                      {entry.ledger.groupRef && <p>Group ref · {entry.ledger.groupRef}</p>}
                      <ProcurementFilesSubsection phase={phaseByType[entry.ledger.type]} parentId={entry.ledger.recordId} procurementId={procurement.id} canWrite={canWriteFiles} uploadedById={uploadedById} />
                    </>}
                  </div>
                </details>
              </li>
            ))}
          </ol>
        )}
      </CardPad>
    </Card>
  );
};
