import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ListState, RecordSection } from '@/src/components/ui';
import { formatDay, formatQuantityUnit, formatTableMoney } from '@/src/lib/format';
import { NO_DISCIPLINE, type CostMoney, type SourceGroup } from '@/src/lib/workOrderCostView';
import type { CostDiscipline } from '@/src/lib/db/workOrderCosts';

interface Props {
  links: Record<string, string>;
  /** `source:recordId` → the cost read's reason (absent when the caller cannot read it). */
  reasons?: Record<string, string>;
  labels: Record<string, { person: string; weekStart: string }>;
  groups: SourceGroup[] | null;
  disciplines: CostDiscipline[];
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
  /** The money read is still running: totals are not decided yet. */
  moneyPending: boolean;
}

const COMMITMENT_DEFAULTS: Record<string, string> = {
  purchase_request: 'Not counted as direct cost yet: a request counts once its supplier bill is recorded.',
  purchase_order: 'Not counted as direct cost yet: an order counts once its supplier bill is recorded.',
  goods_receipt: 'Received, but not counted as direct cost yet: a receipt counts once its supplier bill is recorded.',
};
const COMMITMENT_SOURCES: readonly string[] = ['purchase_request', 'purchase_order', 'goods_receipt'];
/** Sources whose money this section never reads: their lines carry hours or quantities only. */
const HOURS_ONLY: readonly string[] = ['timesheet_entry', 'attendance_day', 'stock_document', 'equipment_usage'];

/** A reference is "code · name"; a record whose name is its code reads once ("CR-1", not "CR-1 · CR-1"). */
const oneName = (reference: string | null): string | null => {
  if (!reference) return reference;
  const parts = reference.split(' · ');
  return parts.length === 2 && parts[0].trim() === parts[1].trim() ? parts[0].trim() : reference;
};

/** Costs (FR-WORP-021/022): lines grouped by source then discipline; a total only where the money is readable. */
export const CostSection: React.FC<Props> = ({ reasons = {}, labels, links, groups, disciplines, isPending, isError, onRetry, moneyPending }) => {
  const { t } = useTranslation(['workOrders', 'workOrderPva']);
  // A stock document is not costed on the work order by design (its bill carries the cost): say which state it is in.
  const stockState = (recordId: string) => {
    const reason = reasons[`stock_document:${recordId}`];
    return reason === 'outside-basis' ? t('workOrderPva:reason.outsideBasis', 'Not part of project actuals')
      : reason === 'transfer' ? t('workOrderPva:reason.transfer', 'Moved to site, still on hand')
      : reason === 'not-posted' ? t('workOrderPva:reason.notPosted', 'Not posted or approved yet') : null;
  };
  const title = t('costs.title', 'Costs');
  if (isPending) return <RecordSection title={title}><ListState variant="loading" rows={3} /></RecordSection>;
  if (isError || !groups) {
    return <RecordSection title={title}><ListState variant="error" title={t('costs.error', "Couldn't load the costs")} onRetry={onRetry} /></RecordSection>;
  }
  if (groups.length === 0) {
    return <RecordSection title={title} actions={<Link to="/expenses" className="text-control text-primary-text hover:underline">{t('costs.open', 'Open expenses')}</Link>}><p className="text-control text-muted-foreground">{t('costs.empty', 'No costs are visible to you for this work order.')}</p></RecordSection>;
  }
  const nameOf = (id: string) => (id === NO_DISCIPLINE ? t('costs.noDiscipline', 'No discipline') : disciplines.find((d) => d.id === id)?.name ?? t('costs.unknownDiscipline', 'Discipline'));
  const money = (m: CostMoney) => formatTableMoney(m.amount, m.currency) ?? '—';
  // One table for every cost: a source row carries its total on the amount column, a discipline row its subtotal,
  // and each record is one row (what, when, how much of it, what it cost). A note that replaces a total sits on its own row.
  const groupNote = (g: SourceGroup) => {
    if (g.totals.length > 0) return null;
    if (g.restricted) return <span data-testid={`cost-restricted-${g.source}`}>{t('costs.restricted', 'Amount restricted for your role')}</span>;
    if (moneyPending) return <span>{t('costs.loadingTotal', 'Total loading…')}</span>;
    if (COMMITMENT_SOURCES.includes(g.source)) return <span data-testid={`cost-commitment-${g.source}`}>{t(`costs.commitment.${g.source}`, COMMITMENT_DEFAULTS[g.source] ?? '')}</span>;
    if (!HOURS_ONLY.includes(g.source)) return <span>{t('costs.unavailable', 'Amount unavailable')}</span>;
    return null;
  };
  const cell = 'py-2.5 pr-4 align-baseline';
  const num = 'py-2.5 text-right align-baseline tabular-nums';
  return (
    <RecordSection title={title}>
      <div>
        <table className="w-full text-control max-sm:block">
          <thead className="max-sm:sr-only"><tr className="text-muted-foreground">
            <th scope="col" className="pb-2 pr-4 text-left font-normal">{t('costs.col.record', 'Record')}</th>
            <th scope="col" className="pb-2 pr-4 text-right font-normal">{t('costs.col.date', 'Date')}</th>
            <th scope="col" className="pb-2 pr-4 text-right font-normal">{t('costs.col.quantity', 'Quantity')}</th>
            <th scope="col" className="pb-2 text-right font-normal">{t('costs.col.amount', 'Amount')}</th>
          </tr></thead>
          {groups.map((g) => {
            const note = groupNote(g);
            return (
              <tbody key={g.source} data-testid={`cost-group-${g.source}`} className="max-sm:block">
                <tr className="border-t border-border max-sm:flex">
                  <th scope="rowgroup" colSpan={3} className={`${cell} text-left font-medium max-sm:flex-1`}>{t(`costs.source.${g.source}`, g.source)}</th>
                  <td className={`${num} font-medium`}>{g.totals.length > 0 && <span data-testid={`cost-total-${g.source}`}>{g.totals.map(money).join(' · ')}</span>}</td>
                </tr>
                {note && <tr className="max-sm:block"><td colSpan={4} className="pb-2.5 text-muted-foreground max-sm:block">{note}</td></tr>}
                {g.disciplines.map((d) => (
                  <React.Fragment key={d.disciplineId}>
                    <tr className="text-muted-foreground max-sm:flex" data-testid={`cost-discipline-${g.source}-${d.disciplineId}`}>
                      <th scope="row" colSpan={3} className={`${cell} pl-4 text-left font-normal max-sm:flex-1`}>{nameOf(d.disciplineId)}</th>
                      <td className={num}>{d.totals.length > 0 && d.totals.map(money).join(' · ')}</td>
                    </tr>
                    {d.lines.map((l) => {
                      const href = links[`${l.source}:${l.recordId}`];
                      const sheet = labels[l.recordId];
                      const label = l.source === 'timesheet_entry'
                        ? sheet ? t('costs.timesheetLabel', '{{person}}, week of {{week}}', { person: sheet.person, week: formatDay(sheet.weekStart) }) : t('costs.timesheetFallback', 'Timesheet')
                        : l.source === 'attendance_day' ? t('costs.attendanceLabel', 'Attendance')
                        : oneName(l.reference) ?? l.recordId.slice(0, 8);
                      const lineMoney = g.moneyByRecord?.[l.recordId];
                      const notShown = !lineMoney && (l.source === 'timesheet_entry' || l.source === 'attendance_day' || l.source === 'stock_document'
                        || (l.source === 'equipment_usage' && !g.restricted));
                      const state = l.source === 'stock_document' ? stockState(l.recordId) : null;
                      return (
                        <tr key={l.recordId} className="border-t border-border-subtle max-sm:flex max-sm:flex-wrap max-sm:py-1.5" data-testid={`cost-line-${l.recordId}`}>
                          <td className={`${cell} pl-8 max-sm:w-full max-sm:py-0.5`}>
                            {href ? <Link className="underline" to={href}>{label}</Link> : label}
                            {state && <div className="text-muted-foreground">{state}</div>}
                          </td>
                          <td className={`${num} pr-4 whitespace-nowrap max-sm:py-0.5 max-sm:pl-8 max-sm:text-muted-foreground`}>{l.occurredOn ? formatDay(l.occurredOn) : '—'}</td>
                          <td className={`${num} pr-4 whitespace-nowrap max-sm:py-0.5 max-sm:text-muted-foreground`}>{l.quantity != null ? formatQuantityUnit(l.quantity, l.quantityUnit) : '—'}</td>
                          <td className={`${num} whitespace-nowrap max-sm:ml-auto max-sm:py-0.5`}>
                            {lineMoney ? <span>{money(lineMoney)}</span> : notShown ? <span className="text-muted-foreground">{t('costs.amountNotShown', 'Line amount not shown')}</span> : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </React.Fragment>
                ))}
              </tbody>
            );
          })}
        </table>
      </div>
    </RecordSection>
  );
};
