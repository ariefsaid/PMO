import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardHead, CardPad, Icon, Tooltip } from '@/src/components/ui';
import { formatCalendarDayInTimeZone, formatCurrency, formatWeekdayMonthDay } from '@/src/lib/format';
import { getActiveLocale } from '@/src/lib/locale/activeLocale';
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
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const instant = new Date(dateOnly ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(instant.getTime())) return missing;
  const calendarDate = dateOnly ? value : formatCalendarDayInTimeZone(instant, getActiveLocale().timezone);
  const [year, month, day] = calendarDate.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const parts = formatWeekdayMonthDay(date).replace(',', '').split(' ');
  const [weekday, second, third] = parts;
  const dayMonth = /^\d+$/.test(second) ? [second, third] : [third, second];
  return [weekday, ...dayMonth].filter(Boolean).join(' ');
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
                : index === current
                  ? t('stage.startedAt', { defaultValue: 'Started at the {{stage}}', stage: stageLabel.toLowerCase() })
                  : t('stage.notRecorded', 'Not recorded');
            const meta = [date ? showDate(date, t('timeline.dateMissing', 'Date not recorded')) : null, state].filter(Boolean).join(' · ');
            return (
              <li key={stage.key} aria-current={isCurrent ? 'step' : undefined} className="min-w-0">
                <div>
                  <span className={`mb-1 block text-[12.5px] font-semibold ${isCurrent ? 'text-primary-text' : done ? 'text-success-text' : 'text-muted-foreground'}`}>{stageLabel}</span>
                  <span aria-hidden="true" className={`block h-1.5 rounded-full ${partial ? 'bg-secondary' : done ? 'bg-success' : isCurrent ? 'bg-primary' : 'bg-secondary'}`}>
                    {partial && <span className="block h-full w-1/2 rounded-full bg-success" />}
                  </span>
                </div>
                <p className="mt-1 text-[12px] text-muted-foreground">{meta}</p>
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

  const help = (kind: ProcurementMoneyKind, unknown: boolean, absent: boolean) => {
    const label = t(`money.${kind}`, moneyLabels[kind]);
    if (kind === 'requested' && requestedStartedLater) return t('money.noPurchaseRequest', 'No purchase request: started at the order');
    if (absent) return t('money.noneRecorded', 'None recorded');
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
            const unknown = figure.unknown;
            const absent = figure.amount == null && !unknown;
            const lead = kind === 'unpaid' && !unknown && (figure.amount ?? 0) > 0;
            const explanation = kind === 'requested' && requestedStartedLater
              ? t('money.noPurchaseRequest', 'No purchase request: started at the order')
              : unknown
                ? t('money.amountMissing', 'Amount not recorded')
                : absent
                  ? t('money.noneRecorded', 'None recorded')
                  : null;
            return (
              <div key={kind} className={lead ? 'sm:col-span-1' : ''}>
                <Tooltip content={help(kind, unknown, absent)} title={`${t(`money.${kind}`, moneyLabels[kind])} calculation`}>
                  <button type="button" aria-label={`${t(`money.${kind}`, moneyLabels[kind])} calculation`} className="mb-1 inline-flex items-center gap-1 text-left text-[12px] font-semibold text-muted-foreground underline decoration-dotted underline-offset-2">
                    {t(`money.${kind}`, moneyLabels[kind])} <Icon name="info" className="size-3" />
                  </button>
                </Tooltip>
                <p className={`${lead ? 'text-[20px] font-semibold text-foreground' : 'text-[16px] font-medium text-foreground'} tabular-nums`}>
                  {unknown || absent ? '—' : formatCurrency(figure.amount ?? 0, procurement.currency)}
                </p>
                {explanation && <p className="mt-0.5 text-[12px] text-muted-foreground">{explanation}</p>}
                {lead && <p className="mt-0.5 text-[12px] text-muted-foreground">{t('money.outstanding', 'Outstanding balance')}</p>}
                {lead && nextDueDate && <p className={`mt-0.5 text-[12px] ${overdueDays > 0 ? 'font-medium text-destructive' : 'text-muted-foreground'}`}>
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

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
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
        facts: [doc.supplier, doc.erpStatus, doc.billNo ? `${t('timeline.supplierReference', 'Supplier reference')} ${doc.billNo}` : null, doc.dueDate ? `${t('timeline.dueDate', 'Due')} ${showDate(doc.dueDate, t('timeline.dateMissing', 'Date not recorded'))}` : null].filter((fact): fact is string => Boolean(fact)),
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
                  <summary className="grid cursor-pointer list-none grid-cols-[20px_92px_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring max-[640px]:grid-cols-[20px_minmax(0,1fr)_auto]">
                    <span aria-hidden="true" className={`grid size-5 place-items-center rounded-full ${entry.source === 'accounting-system' ? 'bg-violet/10 text-status-violet-text' : entry.approval ? 'bg-success/10 text-success-text' : 'bg-secondary text-secondary-foreground'}`}>
                      <Icon name={entry.icon} className="size-3.5" />
                    </span>
                    <span className="whitespace-nowrap text-[12px] text-muted-foreground max-[640px]:col-start-2 max-[640px]:row-start-1">{showDate(entry.date, t('timeline.dateMissing', 'Date not recorded'))}</span>
                    <span className="min-w-0 max-[640px]:col-start-2">
                      <span className="block text-[13.5px] font-medium">{entry.label}{entry.number ? <span className="ml-1 font-mono text-[12px]">{entry.number}</span> : null}</span>
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
                        {entry.actor && <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                          <span aria-hidden="true" className="grid size-5 place-items-center rounded-full bg-secondary text-[12px] font-semibold text-secondary-foreground">{initials(entry.actor)}</span>
                          <span>{entry.actor}</span>
                        </span>}
                        {entry.facts?.map((fact) => <span key={fact}>{fact}</span>)}
                        {entry.note && <span>{entry.note}</span>}
                        {entry.source === 'accounting-system' && <span>{t('timeline.fromAccounting', 'from accounting system')}</span>}
                        {entry.overdueDays ? <span className="rounded-full bg-destructive/10 px-2 py-0.5 font-medium text-destructive-text">{t('timeline.overdue', { defaultValue: 'Overdue {{days}} days', days: entry.overdueDays })}</span> : null}
                      </span>
                    </span>
                    {entry.amount != null && entry.currency && !isEngineer && (
                      <span className="text-right max-[640px]:col-start-3 max-[640px]:row-start-1">
                        <Tooltip content={`Amount on this ${entry.label.toLowerCase()}. Source: ${entry.source === 'accounting-system' ? 'linked accounting-system document' : 'procurement record'}.`}>
                          <span tabIndex={0} className="whitespace-nowrap text-[12.5px] font-medium tabular-nums">{formatCurrency(Number(entry.amount), entry.currency)}</span>
                        </Tooltip>
                      </span>
                    )}
                  </summary>
                  <div className="ml-[128px] mt-2 border-l border-border pl-3 text-[12.5px] text-muted-foreground max-[640px]:ml-8">
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
