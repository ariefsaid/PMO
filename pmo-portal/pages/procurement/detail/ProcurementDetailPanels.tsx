import { Avatar } from '@/src/components/ui/Avatar';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardHead, CardPad, Icon, useFigureReport, type HiddenFigure } from '@/src/components/ui';
import { formatCurrency, formatDay } from '@/src/lib/format';
import type { ProcurementDetail } from '@/src/lib/db/procurementLifecycle';
import type { LedgerRow } from '@/src/lib/db/procurementLedger';
import type { ErpPurchaseRow } from '@/src/lib/repositories/erpPurchases';
import { useProjectBudget } from '@/src/hooks/useBudget';
import { useProjectCommittedSpend, useProjectReservedSpend } from '@/src/hooks/useProcurements';
import { usePermission } from '@/src/auth/usePermission';
import { procurementMoney, type ProcurementMoneyKind } from '@/src/lib/procurement/procurementMoney';
import { stageDates, stageForStatus, type StageKey } from '@/src/lib/procurement/stage';
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
  const day = formatDay(value);
  return day === '—' ? missing : day;
}

function totalAmount(values: readonly (number | string | null | undefined)[]): number | null {
  if (values.length === 0) return null;
  let total = 0;
  for (const value of values) {
    if (value == null || !Number.isFinite(Number(value))) return null;
    total += Number(value);
  }
  return total;
}

export interface ProcurementStageTrackerProps {
  procurement: ProcurementDetail;
  linkedDocuments: readonly ErpPurchaseRow[];
}

export const ProcurementStageTracker: React.FC<ProcurementStageTrackerProps> = ({ procurement, linkedDocuments }) => {
  const { t } = useTranslation('procurementRecord');
  const dates = stageDates(procurement, linkedDocuments.map((doc) => ({ doctype: doc.doctype, docDate: doc.docDate })));
  const current = STAGES.findIndex((stage) => stage.label === stageForStatus(procurement.status));
  const requests = procurement.purchase_requests.map((row) => row.amount);
  const orders = [
    ...procurement.purchase_orders.map((row) => row.amount),
    ...linkedDocuments.filter((doc) => doc.doctype === 'Purchase Order').map((doc) => doc.grandTotal),
  ];
  const receipts = procurement.receipts.length + linkedDocuments.filter((doc) => doc.doctype === 'Purchase Receipt').length;
  const invoices = [
    ...procurement.invoices.map((row) => row.amount),
    ...linkedDocuments.filter((doc) => doc.doctype === 'Purchase Invoice').map((doc) => doc.grandTotal),
  ];
  const payments = [
    ...procurement.payments.map((row) => row.amount),
    ...linkedDocuments.filter((doc) => doc.doctype === 'Payment Entry').map((doc) => doc.grandTotal),
  ];
  const rowsByStage: Record<StageKey, number> = {
    request: requests.length,
    order: orders.length,
    receive: receipts,
    pay: invoices.length + payments.length,
  };
  const amountByStage: Record<StageKey, number | null> = {
    request: totalAmount(requests),
    order: totalAmount(orders),
    receive: null,
    pay: totalAmount(invoices.length > 0 ? invoices : payments),
  };
  const orderCount = orders.length;
  const receivedCount = receipts;
  const partialReceive = procurement.receipts.some((receipt) => receipt.status === 'Partial');

  return (
    <Card aria-label="Procurement stages" data-testid="procurement-stage-tracker">
      <CardPad>
        <ol className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
          {STAGES.map((stage, index) => {
            const count = rowsByStage[stage.key];
            const done = count > 0 && (index < current || (index === current && procurement.status === 'Paid'));
            const isCurrent = index === current && procurement.status !== 'Paid';
            const partial = stage.key === 'receive' && partialReceive;
            const date = dates[stage.key];
            const stageLabel = t(`stage.${stage.key}`, stage.label);
            const state = partial
              ? t('stage.partialReceipt', { defaultValue: '{{received}} of {{orders}} orders received', received: receivedCount, orders: Math.max(orderCount, receivedCount) })
              : count > 0
                ? (() => {
                    const document = stage.key === 'request'
                      ? count === 1 ? t('stage.purchaseRequest', 'purchase request') : t('stage.purchaseRequests', 'purchase requests')
                      : stage.key === 'order'
                        ? count === 1 ? t('stage.purchaseOrder', 'order') : t('stage.purchaseOrders', 'orders')
                        : stage.key === 'receive'
                          ? count === 1 ? t('stage.receipt', 'receipt') : t('stage.receipts', 'receipts')
                          : invoices.length > 0
                            ? invoices.length === 1 ? t('stage.invoice', 'invoice') : t('stage.invoices', 'invoices')
                            : count === 1 ? t('stage.payment', 'payment') : t('stage.payments', 'payments');
                    const amount = amountByStage[stage.key];
                    const countLabel = `${count} ${document}`;
                    return amount == null
                      ? countLabel
                      : t('stage.countAndAmount', { defaultValue: '{{count}} {{document}} · {{amount}}', count, document, amount: formatCurrency(amount, procurement.currency) });
                  })()
                : index < current
                  ? stage.key === 'request'
                    ? t('money.noPurchaseRequest', 'No purchase request: started at the order')
                    : t('stage.notRecorded', 'Not recorded')
                  : '';
            const meta = [date ? showDate(date, t('timeline.dateMissing', 'Date not recorded')) : null, state].filter(Boolean).join(' · ');
            return (
              <li key={stage.key} aria-current={isCurrent ? 'step' : undefined} className="min-w-0">
                <div>
                  <span className={`mb-1 block text-sm font-semibold ${isCurrent ? 'text-foreground' : done ? 'text-success-text' : 'text-muted-foreground'}`}>{stageLabel}</span>
                  {/* O14: the current stage reads in neutral ink; blue stays reserved for the one main action. */}
                  <span aria-hidden="true" className={`block h-1.5 rounded-full ${partial ? 'bg-secondary' : done ? 'bg-success' : isCurrent ? 'bg-muted-foreground' : 'bg-secondary'}`}>
                    {partial && <span className="block h-full w-1/2 rounded-full bg-success" />}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{meta}</p>
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
    return <span className="text-sm font-normal text-muted-foreground">{t('money.budgetLoading', 'Budget signal loading')}</span>;
  }
  if (budget.isError || committed.isError || reserved.isError) {
    return <span className="text-sm font-normal text-muted-foreground">{t('money.budgetUnavailable', "Couldn't load the project budget")}</span>;
  }
  if (!budget.data) return <span className="text-sm font-normal text-muted-foreground">{t('money.noBudget', 'No active project budget')}</span>;

  if (!currency || !reserved.projectCurrency || !reserved.budgetCurrency ||
      currency !== reserved.projectCurrency || reserved.budgetCurrency !== reserved.projectCurrency) {
    return <span className="text-sm font-normal text-muted-foreground">{t('money.currencyUnavailable', 'Budget comparison unavailable for these currencies')}</span>;
  }

  let signal;
  try {
    signal = computeBudgetSignal({ budget: budget.data, committed: committed.data ?? 0, reserved: reserved.data ?? 0, totalValue, status, projectCurrency: reserved.projectCurrency, budgetCurrency: reserved.budgetCurrency, requestCurrency: currency });
  } catch {
    return <span className="text-sm font-normal text-muted-foreground">{t('money.amountUnavailable', 'Budget comparison unavailable for these amounts')}</span>;
  }
  const { available, afterRequest } = signal;
  // "Available" read as a cash balance; it is the budget less commitments, before actual spend, and says so.
  const label = t('money.budgetSignal', 'Budget not yet committed {{available}} · {{after}} after this procurement', {
    available: formatCurrency(available, currency),
    after: formatCurrency(afterRequest, currency),
  });
  const otherPositions = [...(reserved.otherCurrencies ?? []), ...(committed.otherCurrencies ?? [])];
  const otherCurrencyNotice = otherPositions.length ? t('money.otherCurrenciesExcluded', ' · Other currencies excluded from comparison') : '';
  return <span className="text-control font-normal text-muted-foreground">{label}{otherCurrencyNotice}</span>;
};

const moneyLabels: Record<ProcurementMoneyKind, string> = {
  requested: 'Requested', ordered: 'Ordered', invoiced: 'Invoiced', paid: 'Paid', unpaid: 'Unpaid',
};

/** The document a missing figure comes from, so the hidden-figures line cannot be read as the procurement total. */
const moneySources: Record<ProcurementMoneyKind, string> = {
  requested: 'purchase request', ordered: 'purchase order', invoiced: 'supplier invoice', paid: 'payment', unpaid: 'invoice balance',
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
  const requestedStartedLater = procurement.purchase_requests.length === 0 && (
    procurement.purchase_orders.length + procurement.invoices.length + procurement.payments.length + linkedDocuments.length > 0
  );
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

  // A figure with no value is not drawn (never "—" or 0): a source amount that is missing is reported once, in the
  // page's hidden-figures line; one that simply does not exist yet (nothing ordered, nothing paid) says nothing.
  const shown = kinds.flatMap<{ kind: ProcurementMoneyKind; hidden: boolean }>((kind) => {
    const figure = money[kind];
    const absent = figure.amount == null && !figure.unknown;
    if (figure.unknown) return [{ kind, hidden: true }];
    if (absent) return [];
    // Nothing owed is not a figure either: "Unpaid 0" on a request says nothing.
    if (kind === 'unpaid' && (figure.amount ?? 0) <= 0) return [];
    if (kind === 'requested' && requestedStartedLater) return [];
    return [{ kind, hidden: false }];
  });
  useFigureReport(shown.filter((entry) => entry.hidden).map<HiddenFigure>((entry) => ({
    label: t(`money.${entry.kind}`, moneyLabels[entry.kind]),
    reason: t('money.sourceMissing', '{{figure}} amount not recorded', { figure: t(`money.source.${entry.kind}`, moneySources[entry.kind]) }),
  })));
  const visible = shown.filter((entry) => !entry.hidden);
  // No figure and no budget line: no empty card.
  if (visible.length === 0 && !budgetSignal && !isEngineer) return null;

  return (
    <Card data-testid="procurement-money-summary">
      <CardHead className="flex flex-wrap items-center gap-x-4 gap-y-1" subline={budgetSignal}>
        <span>{t('money.title', { defaultValue: 'Money · {{currency}}, before tax', currency: procurement.currency })}</span>
      </CardHead>
      {visible.length > 0 && (
        <CardPad>
          <div className="grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-5">
            {visible.map(({ kind }) => {
              const figure = money[kind];
              const lead = kind === 'unpaid';
              return (
                <div key={kind}>
                  <p className="mb-1 text-control font-medium text-foreground">{t(`money.${kind}`, moneyLabels[kind])}</p>
                  <p className={`${lead ? 'text-section font-semibold' : 'text-group font-medium'} text-foreground tabular-nums`}>
                    {formatCurrency(figure.amount ?? 0, procurement.currency)}
                  </p>
                  {lead && nextDueDate && <p className={`mt-0.5 text-control ${overdueDays > 0 ? 'font-medium text-destructive' : 'text-muted-foreground'}`}>
                    {overdueDays > 0
                      ? t('money.overdue', { defaultValue: 'Overdue {{days}} days · due {{date}}', days: overdueDays, date: showDate(nextDueDate) })
                      : t('money.due', { defaultValue: 'Due {{date}}', date: showDate(nextDueDate) })}
                  </p>}
                </div>
              );
            })}
          </div>
        </CardPad>
      )}
      {isEngineer && <p className="px-[var(--panel-inset)] pb-[var(--panel-inset)] text-sm text-muted-foreground">{t('money.financeOnly', 'Invoices and payments are handled by Finance.')}</p>}
    </Card>
  );
};

type TimelineIcon = 'plus' | 'up' | 'check' | 'x' | 'dollar' | 'doc' | 'cart' | 'inbox' | 'invoices' | 'payments';

type TimelineEntry = {
  id: string;
  date: string | null;
  label: string;
  number?: string | null;
  facts?: string[];
  amount?: number | null;
  currency?: string | null;
  note?: string | null;
  actor?: string | null;
  source: 'raised' | 'status' | 'procurement' | 'accounting-system';
  icon: TimelineIcon;
  approval?: boolean;
  overdueDays?: number;
  ledger?: LedgerRow;
  erp?: ErpPurchaseRow;
};

function overdueDays(value: string | null | undefined): number {
  if (!value) return 0;
  const due = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(due.getTime())) return 0;
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const dueDay = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
  return dueDay < today ? Math.floor((today - dueDay) / 86_400_000) : 0;
}

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
    const raisedEntry: TimelineEntry = {
      id: `raised-${procurement.id}`,
      date: procurement.created_at,
      label: t('timeline.procurementRaised', 'Procurement raised'),
      actor: procurement.requested_by?.full_name ?? null,
      source: 'raised',
      icon: 'plus',
    };
    const statusEntries: TimelineEntry[] = procurement.statusEvents.map((event) => {
      const joined = event as typeof event & { actor?: { full_name?: string | null } | null };
      const destination = event.to_status === 'Approved' ? t('timeline.approved', 'Approved')
        : event.to_status === 'Rejected' ? t('timeline.returnedRejected', 'Returned or rejected')
          : event.to_status === 'Cancelled' ? t('timeline.cancelled', 'Cancelled')
            : event.to_status === 'Requested' ? t('timeline.submitted', 'Submitted for approval')
              : event.to_status === 'Paid' ? t('timeline.paid', 'Paid')
                : String(event.to_status);
      const icon: TimelineIcon = event.to_status === 'Approved' ? 'check'
        : event.to_status === 'Requested' ? 'up'
          : event.to_status === 'Paid' ? 'dollar'
            : event.to_status === 'Rejected' || event.to_status === 'Cancelled' ? 'x'
              : 'doc';
      return {
        id: `status-${event.id}`, date: event.created_at, label: destination, note: event.notes,
        actor: joined.actor?.full_name ?? null, source: 'status', icon,
        approval: event.to_status === 'Approved',
      };
    });
    const recordEntries: TimelineEntry[] = ledgerRows
      .map((row) => ({
        id: row.id, date: row.date, label: t(`timeline.record.${row.type}`, typeLabel[row.type]), number: row.systemNumber,
        facts: [row.status, row.externalRef, row.groupRef, row.fileCount ? `${row.fileCount} ${t('timeline.files', 'files')}` : null].filter((fact): fact is string => Boolean(fact)),
        amount: isEngineer && (row.type === 'Invoice' || row.type === 'Payment') ? null : row.amount,
        currency: row.currency, source: 'procurement', ledger: row,
        icon: row.type === 'PO' ? 'cart' : row.type === 'GR' ? 'inbox' : row.type === 'Invoice' ? 'invoices' : row.type === 'Payment' ? 'payments' : 'doc',
      }));
    const erpEntries: TimelineEntry[] = linkedDocuments
      .filter((doc) => !(isEngineer && (doc.doctype === 'Purchase Invoice' || doc.doctype === 'Payment Entry')))
      .map((doc) => ({
        id: `erp-${doc.id}`, date: doc.docDate, label: doc.doctype === 'Purchase Invoice' ? t('timeline.supplierInvoice', 'Supplier invoice') : doc.doctype === 'Purchase Receipt' ? t('timeline.receipt', 'Receipt') : doc.doctype === 'Purchase Order' ? t('timeline.order', 'Order') : t('timeline.payment', 'Payment'), number: doc.name,
        facts: [doc.supplier, /^overdue$/i.test(doc.erpStatus ?? '') ? null : doc.erpStatus, doc.billNo ? `${t('timeline.supplierReference', 'Supplier reference')} ${doc.billNo}` : null].filter((fact): fact is string => Boolean(fact)),
        amount: isEngineer ? null : doc.grandTotal,
        currency: doc.currency, source: 'accounting-system', erp: doc, overdueDays: (doc.outstanding ?? 0) > 0 ? overdueDays(doc.dueDate) : 0,
        icon: doc.doctype === 'Purchase Order' ? 'cart' : doc.doctype === 'Purchase Receipt' ? 'inbox' : doc.doctype === 'Purchase Invoice' ? 'invoices' : 'payments',
      }));
    return [raisedEntry, ...statusEntries, ...recordEntries, ...erpEntries]
      .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || a.id.localeCompare(b.id));
  }, [procurement.created_at, procurement.id, procurement.requested_by?.full_name, procurement.statusEvents, ledgerRows, linkedDocuments, isEngineer, t]);
  const visible = entries.filter((entry) => filter === 'all'
    || (filter === 'financial' ? Boolean(entry.ledger?.financial || entry.erp) : (entry.ledger?.fileCount ?? 0) > 0));

  return (
    <Card data-testid="procurement-timeline">
      <CardHead
        className="flex-wrap"
        actions={<button type="button" onClick={onFullHistory} className="shrink-0 text-sm font-medium text-primary-text underline underline-offset-2">{t('timeline.fullHistory', 'Full history')}</button>}
      >
        {t('timeline.title', 'Timeline')}
      </CardHead>
      <CardPad>
        <div role="group" aria-label="Timeline filter" className="mb-3 flex flex-wrap gap-2">
          {(['all', 'financial', 'has-file'] as const).map((value) => (
            <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)} className={`rounded-md px-2.5 py-1 text-sm ${filter === value ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
              {value === 'all' ? t('timeline.all', 'All') : value === 'financial' ? t('timeline.financial', 'Financial') : t('timeline.hasFile', 'Has file')}
            </button>
          ))}
        </div>
        {visible.length === 0 ? <p className="py-4 text-sm text-muted-foreground">{t('timeline.empty', 'No activity recorded yet.')}</p> : (
          <ol className="divide-y divide-border/70">
            {visible.map((entry) => (
              <li key={entry.id} data-testid="procurement-timeline-row" className="py-2.5 first:pt-0 last:pb-0">
                <details>
                  <summary className="grid cursor-pointer list-none grid-cols-[20px_92px_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring max-[640px]:grid-cols-[20px_minmax(0,1fr)_auto]">
                    <span aria-hidden="true" className={`grid size-5 place-items-center rounded-full ${entry.source === 'accounting-system' ? 'bg-violet/10 text-status-violet-text' : entry.approval ? 'bg-success/10 text-success-text' : 'bg-secondary text-secondary-foreground'}`}>
                      <Icon name={entry.icon} className="size-3.5" />
                    </span>
                    <span className="whitespace-nowrap text-sm text-muted-foreground max-[640px]:col-start-2 max-[640px]:row-start-1">{showDate(entry.date, t('timeline.dateMissing', 'Date not recorded'))}</span>
                    <span className="min-w-0 max-[640px]:col-start-2">
                      <span className="block text-sm font-medium">{entry.label}{entry.number ? <span className="ml-1 font-mono text-sm">{entry.number}</span> : null}</span>
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                        {entry.actor && <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                          <Avatar name={entry.actor} size="xs" decorative fallback="" />
                          <span>{entry.actor}</span>
                        </span>}
                        {entry.facts?.map((fact) => <span key={fact}>{fact}</span>)}
                        {entry.note && <span>{entry.note}</span>}
                        {entry.source === 'accounting-system' && <span>{t('timeline.fromAccounting', 'from accounting system')}</span>}
                      </span>
                    </span>
                    {entry.amount != null && entry.currency && !isEngineer && (
                      <span className="text-right max-[640px]:col-start-3 max-[640px]:row-start-1">
                        <span className="whitespace-nowrap text-sm font-medium tabular-nums">{formatCurrency(Number(entry.amount), entry.currency)}</span>
                      </span>
                    )}
                  </summary>
                  <div className="ml-[128px] mt-2 border-l border-border pl-3 text-sm text-muted-foreground max-[640px]:ml-8">
                    {entry.erp && <dl className="mb-2 grid grid-cols-2 gap-x-4 gap-y-1"><dt>{t('details.supplier', 'Supplier')}</dt><dd>{entry.erp.supplier ?? '—'}</dd><dt>{t('timeline.status', 'Status')}</dt><dd>{entry.erp.erpStatus ?? '—'}</dd><dt>{t('timeline.dueDate', 'Due date')}</dt><dd>{showDate(entry.erp.dueDate, t('timeline.dateMissing', 'Date not recorded'))}{entry.overdueDays ? ` · ${t('timeline.overdue', { defaultValue: 'Overdue {{days}} days', days: entry.overdueDays })}` : ''}</dd></dl>}
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
