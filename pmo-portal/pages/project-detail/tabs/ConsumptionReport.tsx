import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ListState, StatusPill } from '@/src/components/ui';
import { useProjectConsumption } from '@/src/hooks/useStock';
import { useOrgCurrency } from '@/src/hooks/useOrgCurrency';
import { useFxOrgDay } from '@/src/hooks/useFxOrgDay';
import { formatQuantity, formatStockValue } from '@/src/lib/stockFormat';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';
import type { ConsumptionMonthRow } from '@/src/lib/db/stockReports';

const pad = (n: number) => String(n).padStart(2, '0');
const ym = (y: number, m0: number) => `${y}-${pad(m0 + 1)}`;

/** The org's current month and the three before it, as `YYYY-MM` (the native month input's value). `orgDay` is the
 *  org-timezone today: stock dates are org dates (D9), so the browser's own date could pick the wrong month. */
export function defaultRange(orgDay: string): { fromMonth: string; toMonth: string } {
  const [y, m] = orgDay.split('-').map(Number);
  const from = new Date(Date.UTC(y, m - 1 - 3, 1));
  return { fromMonth: ym(from.getUTCFullYear(), from.getUTCMonth()), toMonth: ym(y, m - 1) };
}
/** Whole months: first day of `fromMonth` .. last day of `toMonth`. */
function toDates(fromMonth: string, toMonth: string): { from: string; to: string } {
  const [y, m] = toMonth.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${fromMonth}-01`, to: `${toMonth}-${pad(last)}` };
}

const th = 'px-3 py-2 text-left text-xs font-semibold text-muted-foreground';
const thNum = `${th} text-right`;
const td = 'px-3 py-2 align-top text-sm';
const tdNum = `${td} text-right tabular-nums whitespace-nowrap`;

const WorkItem: React.FC<{ code: string; description: string }> = ({ code, description }) => (
  <div className="min-w-0"><span className="block font-mono text-sm font-semibold">{code}</span><span className="block text-xs text-muted-foreground">{description}</span></div>
);
const Item: React.FC<{ code: string; name: string }> = ({ code, name }) => (
  <div className="min-w-0"><span className="block font-mono text-sm">{code}</span><span className="block text-xs text-muted-foreground">{name}</span></div>
);
const Section: React.FC<{ title: string; sub?: string; children: React.ReactNode }> = ({ title, sub, children }) => (
  <section className="flex min-w-0 flex-col gap-1.5">
    <h4 className="text-sm font-semibold">{title}</h4>
    {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    {/* Focusable so a keyboard user can scroll a wide table at phone width (axe scrollable-region-focusable). */}
    <div tabIndex={0} role="group" aria-label={title} className="overflow-x-auto rounded-lg border border-border bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{children}</div>
  </section>
);

/**
 * Consumption against allowance for one project (#1512 S5, FR-STK-042/043): "how much of X did this project use per month,
 * against its allowance, and who issued it". Aggregated by the server; value columns only when the server sent a value.
 */
const ConsumptionReport: React.FC<{ projectId: string }> = ({ projectId }) => {
  const { t } = useTranslation('stock');
  const loc = getNumberLocale();
  const currency = useOrgCurrency();
  const orgDay = useFxOrgDay(true).day;
  const [picked, setRange] = useState<{ fromMonth: string; toMonth: string } | null>(null);
  const range = picked ?? (orgDay ? defaultRange(orgDay) : null);
  const { from, to } = range ? toDates(range.fromMonth, range.toMonth) : { from: '', to: '' };
  const q = useProjectConsumption(range ? projectId : undefined, from, to);
  const qty = (v: string, unit: string) => <>{formatQuantity(v, loc)} <span className="text-muted-foreground">{unit}</span></>;
  const monthLabel = (iso: string) => new Intl.DateTimeFormat(loc, { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
  const signed = (v: string) => (v.startsWith('-') || /^0(\.0+)?$/.test(v) ? formatQuantity(v, loc) : `+${formatQuantity(v, loc)}`);

  const r = q.data;
  const showValue = (r?.months ?? []).some((m: ConsumptionMonthRow) => m.netValue !== undefined);
  const empty = r && r.months.length === 0 && r.allowances.length === 0 && r.unplanned.length === 0;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {range && <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          {t('consumption.from')}
          <input type="month" className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground" value={range.fromMonth} max={range.toMonth}
            onChange={(e) => e.target.value && setRange({ ...range, fromMonth: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          {t('consumption.to')}
          <input type="month" className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground" value={range.toMonth} min={range.fromMonth}
            onChange={(e) => e.target.value && setRange({ ...range, toMonth: e.target.value })} />
        </label>
      </div>}

      {(!range || q.isPending) && <div className="rounded-lg border border-border bg-card"><ListState variant="loading" rows={4} /></div>}
      {q.isError && (
        <ListState variant="error" title={t('consumption.errorTitle')} sub={t('consumption.errorSub')} retryLabel={t('actions.retry')} onRetry={() => void q.refetch()} />
      )}
      {empty && <ListState variant="empty" icon="folder" title={t('consumption.empty')} sub={t('consumption.emptySub')} />}

      {r && !empty && (
        <>
          {r.allowances.length > 0 && (
            <Section title={t('consumption.allowanceTitle')} sub={t('consumption.allowanceSub')}>
              <table className="w-full min-w-[40rem]" aria-label={t('consumption.allowanceTitle')}>
                <thead className="border-b border-border"><tr>
                  <th scope="col" className={th}>{t('consumption.columns.workItem')}</th>
                  <th scope="col" className={th}>{t('consumption.columns.item')}</th>
                  <th scope="col" className={thNum}>{t('consumption.columns.allowance')}</th>
                  <th scope="col" className={thNum}>{t('consumption.columns.usedToDate')}</th>
                  <th scope="col" className={thNum}>{t('consumption.columns.variance')}</th>
                  <th scope="col" className={th}><span className="sr-only">{t('consumption.columns.status')}</span></th>
                </tr></thead>
                <tbody className="divide-y divide-border">
                  {r.allowances.map((a) => (
                    <tr key={a.id}>
                      <td className={td}><WorkItem code={a.boqItemCode} description={a.boqDescription} /></td>
                      <td className={td}><Item code={a.itemCode} name={a.itemName} /></td>
                      <td className={tdNum}>{qty(a.plannedQuantity, a.unitCode)}</td>
                      <td className={tdNum}>{qty(a.netToDate, a.unitCode)}</td>
                      <td className={`${tdNum} ${a.overAllowance ? 'font-semibold text-destructive-text' : ''}`}>{signed(a.variance)}</td>
                      <td className={td}>{a.overAllowance && <StatusPill variant="overdue">{t('consumption.overAllowance')}</StatusPill>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}

          <Section title={t('consumption.monthTitle')} sub={t('consumption.monthSub')}>
            {r.months.length === 0 ? (
              <p className="px-3 py-4 text-sm text-muted-foreground">{t('consumption.noMonths')}</p>
            ) : (
              <table className="w-full min-w-[48rem]" aria-label={t('consumption.monthTitle')}>
                <thead className="border-b border-border"><tr>
                  <th scope="col" className={th}>{t('consumption.columns.month')}</th>
                  <th scope="col" className={th}>{t('consumption.columns.workItem')}</th>
                  <th scope="col" className={th}>{t('consumption.columns.item')}</th>
                  <th scope="col" className={thNum}>{t('consumption.columns.issued')}</th>
                  <th scope="col" className={thNum}>{t('consumption.columns.returned')}</th>
                  <th scope="col" className={thNum}>{t('consumption.columns.net')}</th>
                  {showValue && <th scope="col" className={thNum}>{t('consumption.columns.value')}</th>}
                  <th scope="col" className={th}>{t('consumption.columns.issuedBy')}</th>
                </tr></thead>
                <tbody className="divide-y divide-border">
                  {r.months.map((m) => (
                    <tr key={`${m.month}:${m.boqItemId}:${m.itemId}`}>
                      <td className={`${td} whitespace-nowrap`}>{monthLabel(m.month)}</td>
                      <td className={td}><WorkItem code={m.boqItemCode} description={m.boqDescription} /></td>
                      <td className={td}><Item code={m.itemCode} name={m.itemName} /></td>
                      <td className={tdNum}>{formatQuantity(m.issued, loc)}</td>
                      <td className={tdNum}>{formatQuantity(m.returned, loc)}</td>
                      <td className={`${tdNum} font-semibold`}>{qty(m.netConsumed, m.unitCode)}</td>
                      {showValue && <td className={tdNum}>{formatStockValue(m.netValue, currency, loc)}</td>}
                      <td className={td}>{m.issuedBy.join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          {r.unplanned.length > 0 && (
            <Section title={t('consumption.unplannedTitle')} sub={t('consumption.unplannedSub')}>
              <table className="w-full min-w-[32rem]" aria-label={t('consumption.unplannedTitle')}>
                <thead className="border-b border-border"><tr>
                  <th scope="col" className={th}>{t('consumption.columns.workItem')}</th>
                  <th scope="col" className={th}>{t('consumption.columns.item')}</th>
                  <th scope="col" className={thNum}>{t('consumption.columns.usedToDate')}</th>
                </tr></thead>
                <tbody className="divide-y divide-border">
                  {r.unplanned.map((u) => (
                    <tr key={`${u.boqItemId}:${u.itemId}`}>
                      <td className={td}><WorkItem code={u.boqItemCode} description={u.boqDescription} /></td>
                      <td className={td}><Item code={u.itemCode} name={u.itemName} /></td>
                      <td className={tdNum}>{qty(u.netToDate, u.unitCode)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}
        </>
      )}
    </div>
  );
};

export default ConsumptionReport;
