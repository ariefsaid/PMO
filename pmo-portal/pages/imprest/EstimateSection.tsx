import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, DataTable, ListState, RecordSection, SelectField, StatusPill, type Column } from '@/src/components/ui';
import { useImprestEstimate, useImprestPlans } from '@/src/hooks/useImprest';
import { useProjectWorkOrders } from '@/src/hooks/useWorkOrders';
import type { ImprestEstimateRow } from '@/src/lib/db/imprest';
import { budgetCategoryLabel } from '@/src/lib/i18n/budgetCategoryLabel';
import { formatCurrency, formatMonthYearShort } from '@/src/lib/format';

/** `YYYY-MM-01` plus `n` whole months (string math: no timezone shift on a calendar month). */
export const addMonths = (month: string, n: number): string => {
  const [y, m] = month.split('-').map(Number);
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}-01`;
};
const MAX_MONTHS = 12;

/**
 * Site cash estimate (cash-advance-estimate, FR-CAE-007/008): what is planned, drawn and still to spend per month, purpose and
 * work order, and the advance needed for the period. Reads only; the top-up request is the existing one.
 */
export const EstimateSection: React.FC<{
  floatId: string; projectId: string; currency: string; currentMonth: string;
  /** The viewer may request a top-up (the existing request dialog opens; nothing is prefilled). */
  canRequestTopUp: boolean; onRequestTopUp: () => void;
}> = ({ floatId, projectId, currency, currentMonth, canRequestTopUp, onRequestTopUp }) => {
  const { t } = useTranslation();
  const plans = useImprestPlans(floatId);
  const workOrders = useProjectWorkOrders(projectId);
  const [from, setFrom] = useState(currentMonth);
  const [toPicked, setToPicked] = useState<string | null>(null);
  // Default end: the last month that has a plan that can still count, else this month.
  const lastPlanned = useMemo(() => {
    const months = (plans.data?.rows ?? []).filter((p) => p.status !== 'Cancelled' && p.status !== 'Rejected' && p.month >= from).map((p) => p.month).sort();
    return months.length > 0 ? months[months.length - 1] : from;
  }, [plans.data, from]);
  const maxTo = addMonths(from, MAX_MONTHS - 1);
  const to = toPicked && toPicked >= from && toPicked <= maxTo ? toPicked : (lastPlanned > maxTo ? maxTo : lastPlanned);
  const est = useImprestEstimate(floatId, from, to);
  const money = (v: number | string) => formatCurrency(Number(v), currency);
  const monthLabel = (m: string) => formatMonthYearShort(m);
  const fromOptions = Array.from({ length: MAX_MONTHS + 1 }, (_, i) => addMonths(currentMonth, i - 1));
  const toOptions = Array.from({ length: MAX_MONTHS }, (_, i) => addMonths(from, i));
  const woName = (id: string | null): string => {
    if (!id) return t('imprest:estimate.unassigned', 'Not assigned to a work order');
    const wo = (workOrders.data ?? []).find((w) => w.id === id);
    return wo ? `${wo.wo_number} ${wo.title}` : t('imprest:estimate.workOrder', 'Work order');
  };

  const byMonth = useMemo(() => {
    const groups = new Map<string, ImprestEstimateRow[]>();
    for (const r of est.data?.rows ?? []) groups.set(r.month, [...(groups.get(r.month) ?? []), r]);
    return [...groups.entries()];
  }, [est.data]);
  const columns: Column<ImprestEstimateRow>[] = [
    { key: 'purpose', header: t('imprest:estimate.purpose', 'Purpose'), rowHeader: true,
      cell: (r) => <span className="font-semibold">{r.budget_category ? budgetCategoryLabel(r.budget_category, t) : '—'}</span> },
    { key: 'wo', header: t('imprest:estimate.workOrder', 'Work order'), cell: (r) => <span className={r.work_order_id ? undefined : 'text-muted-foreground'}>{woName(r.work_order_id)}</span> },
    { key: 'planned', header: t('imprest:plan.planned', 'Planned'), align: 'num', cell: (r) => <span className="tabular-nums">{money(r.planned)}</span> },
    { key: 'drawn', header: t('imprest:plan.drawn', 'Drawn'), align: 'num', cell: (r) => <span className="tabular-nums">{money(r.drawn)}</span> },
    { key: 'still', header: t('imprest:estimate.still', 'Still to spend'), align: 'num', cell: (r) => <span className="tabular-nums">{money(r.still_to_spend)}</span> },
  ];
  const total = est.data?.total ?? null;

  return (
    <RecordSection
      title={t('imprest:estimate.title', 'Cash estimate')}
      actions={
        <div data-actions-wide="" className="flex flex-wrap items-center justify-end gap-2 max-sm:w-full">
          <SelectField hideLabel compact wrapperClassName="max-sm:basis-1/2" label={t('imprest:estimate.from', 'From')} value={from}
            onChange={(v) => { setFrom(v); setToPicked(null); }}
            options={fromOptions.map((m) => ({ value: m, label: t('imprest:estimate.fromMonth', 'From {{month}}', { month: monthLabel(m) }) }))} />
          <SelectField hideLabel compact wrapperClassName="max-sm:basis-1/2" label={t('imprest:estimate.to', 'To')} value={to} onChange={setToPicked}
            options={toOptions.map((m) => ({ value: m, label: t('imprest:estimate.toMonth', 'To {{month}}', { month: monthLabel(m) }) }))} />
        </div>
      }
    >
      {est.isPending && <ListState variant="loading" rows={3} />}
      {est.isError && <ListState variant="error" title={t('imprest:estimate.error', "Couldn't load the estimate")} onRetry={() => void est.refetch()} />}
      {!est.isPending && !est.isError && total && (
        <div className="space-y-4" data-testid="cash-estimate">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div data-testid="estimate-advance" className="col-span-full">
              <dt className="text-control font-medium text-foreground">{t('imprest:estimate.advanceNeeded', 'Advance needed')}</dt>
              <dd className="text-metric font-semibold tabular-nums">{money(total.advance_needed)}</dd>
              <dd className="text-control text-muted-foreground">
                {t('imprest:estimate.advanceNote', 'Still to spend {{still}}, less cash in hand {{cash}}, less top-up on its way {{flight}}.',
                  { still: money(total.still_to_spend), cash: money(total.cash_book), flight: money(total.in_flight) })}
              </dd>
            </div>
            <div><dt className="text-control text-muted-foreground">{t('imprest:plan.planned', 'Planned')}</dt><dd className="tabular-nums">{money(total.planned)}</dd></div>
            <div><dt className="text-control text-muted-foreground">{t('imprest:plan.drawn', 'Drawn')}</dt><dd className="tabular-nums">{money(total.drawn)}</dd></div>
            <div><dt className="text-control text-muted-foreground">{t('imprest:estimate.still', 'Still to spend')}</dt><dd className="tabular-nums">{money(total.still_to_spend)}</dd></div>
          </dl>
          {canRequestTopUp
            ? <Button variant="outline" size="sm" onClick={onRequestTopUp}>{t('imprest:estimate.requestAdvance', 'Request this advance')}</Button>
            : Number(total.advance_needed) > 0 && <p className="text-control text-muted-foreground" data-testid="estimate-topup-note">
              {t('imprest:estimate.topUpNote', 'A top-up is requested by the custodian of this site cash, from the receipts waiting.')}</p>}
          <div className="space-y-4">
            {byMonth.map(([month, rows]) => {
              const status = rows[0]?.plan_status ?? 'none';
              return (
                <div key={month} data-testid={`estimate-month-${month}`}>
                  <h3 className="flex flex-wrap items-center gap-x-3 pb-2 text-sm font-semibold text-foreground">
                    {monthLabel(month)}
                    {(status === 'Draft' || status === 'Submitted') && <StatusPill variant="warn">{t('imprest:estimate.notApproved', 'Not yet approved')}</StatusPill>}
                  </h3>
                  {status === 'none'
                    ? <p className="text-sm text-muted-foreground">{t('imprest:estimate.noPlan', 'No plan for {{month}}. A project manager, Finance or an Admin adds one under Plans.', { month: monthLabel(month) })}</p>
                    : <DataTable<ImprestEstimateRow> embedded rows={rows} columns={columns}
                      rowKey={(r) => `${r.month}|${r.budget_category}|${r.work_order_id ?? ''}`} tableId="imprest-estimate" />}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </RecordSection>
  );
};
