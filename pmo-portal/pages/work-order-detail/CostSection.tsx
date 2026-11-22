import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ListState, RecordSection } from '@/src/components/ui';
import { formatCurrency, formatDay, formatNumberExact } from '@/src/lib/format';
import { NO_DISCIPLINE, type CostMoney, type SourceGroup } from '@/src/lib/workOrderCostView';
import type { CostDiscipline } from '@/src/lib/db/workOrderCosts';

interface Props {
  links: Record<string, string>;
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
/** Sources whose money this section never reads: their lines carry hours or quantities only. */
const HOURS_ONLY: readonly string[] = ['timesheet_entry', 'attendance_day', 'stock_document', 'equipment_usage'];

/** Costs (FR-WORP-021/022): lines grouped by source then discipline; a total only where the money is readable. */
export const CostSection: React.FC<Props> = ({ labels, links, groups, disciplines, isPending, isError, onRetry, moneyPending }) => {
  const { t } = useTranslation('workOrders');
  const title = t('costs.title', 'Costs');
  if (isPending) return <RecordSection title={title}><ListState variant="loading" rows={3} /></RecordSection>;
  if (isError || !groups) {
    return <RecordSection title={title}><ListState variant="error" title={t('costs.error', "Couldn't load the costs")} onRetry={onRetry} /></RecordSection>;
  }
  if (groups.length === 0) {
    return <RecordSection title={title}><p className="text-control text-muted-foreground">{t('costs.empty', 'No costs are attributed to this work order yet.')}</p></RecordSection>;
  }
  const nameOf = (id: string) => (id === NO_DISCIPLINE ? t('costs.noDiscipline', 'No discipline') : disciplines.find((d) => d.id === id)?.name ?? t('costs.unknownDiscipline', 'Discipline'));
  const money = (m: CostMoney) => formatCurrency(m.amount, m.currency);
  return (
    <RecordSection title={title}>
      <div className="flex flex-col gap-5">
        {groups.map((g) => (
          <div key={g.source} data-testid={`cost-group-${g.source}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-medium">{t(`costs.source.${g.source}`, g.source)}</h3>
              {g.totals.length > 0 && <span className="tabular-nums font-medium" data-testid={`cost-total-${g.source}`}>{g.totals.map(money).join(" · ")}</span>}
              {g.totals.length === 0 && g.restricted && <span className="text-control text-muted-foreground" data-testid={`cost-restricted-${g.source}`}>{t('costs.restricted', 'Amount restricted for your role')}</span>}
              {g.totals.length === 0 && !g.restricted && moneyPending && <span className="text-control text-muted-foreground">{t('costs.loadingTotal', 'Total loading…')}</span>}
              {g.totals.length === 0 && !g.restricted && !moneyPending && ['purchase_request', 'purchase_order', 'goods_receipt'].includes(g.source) && <span className="text-control text-muted-foreground" data-testid={`cost-commitment-${g.source}`}>{t(`costs.commitment.${g.source}`, COMMITMENT_DEFAULTS[g.source] ?? '')}</span>}
              {g.totals.length === 0 && !g.restricted && !moneyPending && ![...HOURS_ONLY, 'purchase_request', 'purchase_order', 'goods_receipt'].includes(g.source) && <span className="text-control text-muted-foreground">{t('costs.unavailable', 'Amount unavailable')}</span>}
            </div>
            {g.disciplines.map((d) => (
              <div key={d.disciplineId} className="mt-2" data-testid={`cost-discipline-${g.source}-${d.disciplineId}`}>
                <div className="flex justify-between text-control text-muted-foreground">
                  <span>{nameOf(d.disciplineId)}</span>
                  {d.totals.length > 0 && <span className="tabular-nums">{d.totals.map(money).join(" · ")}</span>}
                </div>
                <ul className="divide-y divide-border">
                  {d.lines.map((l) => {
                    const href = links[`${l.source}:${l.recordId}`];
                    const sheet = labels[l.recordId];
                    const label = l.source === 'timesheet_entry'
                      ? sheet ? t('costs.timesheetLabel', '{{person}}, week of {{week}}', { person: sheet.person, week: formatDay(sheet.weekStart) }) : t('costs.timesheetFallback', 'Timesheet')
                      : l.source === 'attendance_day' ? t('costs.attendanceLabel', 'Attendance')
                      : l.reference ?? l.recordId.slice(0, 8);
                    return (
                      <li key={l.recordId} className="flex flex-wrap items-baseline justify-between gap-x-4 py-1.5" data-testid={`cost-line-${l.recordId}`}>
                        <span>{href ? <Link className="underline" to={href}>{label}</Link> : label}</span>
                        <span className="tabular-nums text-control text-muted-foreground">
                          {l.occurredOn ? formatDay(l.occurredOn) : '—'}
                          {l.quantity != null && ` · ${formatNumberExact(l.quantity)} ${l.quantityUnit ?? ''}`}
                          {(l.source === 'timesheet_entry' || l.source === 'attendance_day' || l.source === 'stock_document'
                            || (l.source === 'equipment_usage' && !g.restricted && !g.moneyByRecord?.[l.recordId]))
                            && <> · <span>{t('costs.notCosted', 'Not yet costed')}</span></>}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        ))}
      </div>
    </RecordSection>
  );
};
