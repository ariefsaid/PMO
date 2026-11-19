import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ListState, RecordSection } from '@/src/components/ui';
import { formatCurrency, formatDay, formatNumberExact } from '@/src/lib/format';
import { NO_DISCIPLINE, type CostMoney, type SourceGroup } from '@/src/lib/workOrderCostView';
import type { CostDiscipline, CostSource, WorkOrderCostLine } from '@/src/lib/db/workOrderCosts';

const HREF: Record<CostSource, (l: WorkOrderCostLine) => string | null> = {
  purchase_request: (l) => (l.projectId ? `/projects/${l.projectId}?tab=procurement` : null),
  purchase_order: (l) => (l.projectId ? `/projects/${l.projectId}?tab=procurement` : null),
  goods_receipt: (l) => (l.projectId ? `/projects/${l.projectId}?tab=procurement` : null),
  vendor_bill: (l) => (l.projectId ? `/projects/${l.projectId}?tab=procurement` : null),
  timesheet_entry: () => '/timesheets',
  stock_document: () => '/stock',
  equipment_usage: () => '/equipment',
};

interface Props {
  groups: SourceGroup[] | null;
  disciplines: CostDiscipline[];
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
  /** The money read is still running: totals are not decided yet. */
  moneyPending: boolean;
}

/** Costs (FR-WORP-021/022): lines grouped by source then discipline; a total only where the money is readable. */
export const CostSection: React.FC<Props> = ({ groups, disciplines, isPending, isError, onRetry, moneyPending }) => {
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
  const money = (m: CostMoney) => formatCurrency(m.amount, m.currency, { precision: 'minor' });
  return (
    <RecordSection title={title}>
      <div className="flex flex-col gap-5">
        {groups.map((g) => (
          <div key={g.source} data-testid={`cost-group-${g.source}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-medium">{t(`costs.source.${g.source}`, g.source)}</h3>
              {g.total && <span className="tabular-nums font-medium" data-testid={`cost-total-${g.source}`}>{money(g.total)}</span>}
              {!g.total && g.restricted && <span className="text-control text-muted-foreground" data-testid={`cost-restricted-${g.source}`}>{t('costs.restricted', 'Amount restricted for your role')}</span>}
              {!g.total && !g.restricted && moneyPending && <span className="text-control text-muted-foreground">{t('costs.loadingTotal', 'Total loading…')}</span>}
            </div>
            {g.disciplines.map((d) => (
              <div key={d.disciplineId} className="mt-2" data-testid={`cost-discipline-${g.source}-${d.disciplineId}`}>
                <div className="flex justify-between text-control text-muted-foreground">
                  <span>{nameOf(d.disciplineId)}</span>
                  {d.total && <span className="tabular-nums">{money(d.total)}</span>}
                </div>
                <ul className="divide-y divide-border">
                  {d.lines.map((l) => {
                    const href = HREF[l.source](l);
                    const label = l.reference ?? l.recordId.slice(0, 8);
                    return (
                      <li key={l.recordId} className="flex flex-wrap items-baseline justify-between gap-x-4 py-1.5" data-testid={`cost-line-${l.recordId}`}>
                        <span>{href ? <Link className="underline" to={href}>{label}</Link> : label}</span>
                        <span className="tabular-nums text-control text-muted-foreground">
                          {l.occurredOn ? formatDay(l.occurredOn) : '—'}
                          {l.quantity != null && ` · ${formatNumberExact(l.quantity)} ${l.quantityUnit ?? ''}`}
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
