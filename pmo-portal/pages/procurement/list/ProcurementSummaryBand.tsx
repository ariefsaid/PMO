import React from 'react';
import { useTranslation } from 'react-i18next';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';
import type { NeedsYouResult } from '../blocks/needsYou';
import type { StageKey } from '../blocks/stage';
import { matchesStage, totalsByCurrency, type ProcurementListRole } from './model';
import { MoneyTotalLines } from './MoneyTotalLines';

export type ProcurementTab = 'needs-you' | 'all' | 'orphans';

interface ProcurementSummaryBandProps {
  rows: ProcurementWithRefs[];
  needsYouRows: Array<{ row: ProcurementWithRefs; result: NeedsYouResult }>;
  tab: ProcurementTab;
  stage: StageKey | null;
  role: ProcurementListRole;
  onSelectNeedsYou: () => void;
  onSelectStage: (stage: StageKey) => void;
}

const STAGES: Array<{ key: StageKey; labelKey: string; meaningKey: string; tooltipKey: string }> = [
  { key: 'request', labelKey: 'stage.request', meaningKey: 'meaning.request', tooltipKey: 'money.mostReal' },
  { key: 'order', labelKey: 'stage.order', meaningKey: 'meaning.order', tooltipKey: 'money.mostReal' },
  { key: 'receive', labelKey: 'stage.receive', meaningKey: 'meaning.receive', tooltipKey: 'money.mostReal' },
  { key: 'pay', labelKey: 'stage.pay', meaningKey: 'meaning.pay', tooltipKey: 'money.pay' },
];

export const ProcurementSummaryBand: React.FC<ProcurementSummaryBandProps> = ({
  rows,
  needsYouRows,
  tab,
  stage,
  role,
  onSelectNeedsYou,
  onSelectStage,
}) => {
  const { t } = useTranslation('procurementList');
  const currentRows = tab === 'needs-you' ? needsYouRows.map(({ row }) => row) : rows;
  const reasons = new Map(needsYouRows.map(({ row, result }) => [row.id, result.reason]));
  const needsTotals = totalsByCurrency(
    needsYouRows.map(({ row }) => row),
    role,
    'needs-you',
    reasons,
  );
  const engineerAmount = role === 'Engineer';

  const items = [
    {
      key: 'needs-you',
      label: t('tab.needsYou', 'Needs you'),
      count: needsYouRows.length,
      totals: needsTotals,
      meaning: t('meaning.needsYou', 'Waiting on your next step'),
      tooltip: t(engineerAmount ? 'money.engineer' : 'money.mostReal', engineerAmount
        ? 'Request amount only. Supplier invoice and payment amounts are not shown.'
        : 'Most real amount per procurement: paid, then supplier invoice, then purchase order, then request. Summed by currency.'),
      active: tab === 'needs-you',
      onClick: onSelectNeedsYou,
      testId: 'summary-cell-needs-you',
      labelForScreenReader: t('tab.needsYou', 'Needs you'),
    },
    ...STAGES.map(({ key, labelKey, meaningKey, tooltipKey }) => {
      const stageRows = currentRows.filter((row) => matchesStage(row, key));
      return {
        key,
        label: t(labelKey, key[0].toUpperCase() + key.slice(1)),
        count: stageRows.length,
        totals: totalsByCurrency(stageRows, role, key === 'pay' ? 'pay' : 'most-real'),
        meaning: t(meaningKey, {
          request: 'Raised, approved or quoting',
          order: 'Ordered, waiting for receipt',
          receive: 'Received, waiting for an invoice',
          pay: 'Invoiced, waiting for payment',
        }[key]),
        tooltip: t(engineerAmount ? 'money.engineer' : tooltipKey, engineerAmount
          ? 'Request amount only. Supplier invoice and payment amounts are not shown.'
          : key === 'pay'
            ? 'Supplier invoices use the unpaid balance; paid procurements contribute zero. Kept in each procurement currency.'
            : 'Most real amount per procurement: paid, then supplier invoice, then purchase order, then request. Summed by currency.'),
        active: stage === key,
        onClick: () => onSelectStage(key),
        testId: `summary-cell-${key}`,
        labelForScreenReader: `${t(labelKey, key[0].toUpperCase() + key.slice(1))} stage`,
      };
    }),
  ];

  return (
    <section aria-label={t('summary.label', 'Procurement summary')} className="overflow-hidden rounded-lg border border-border bg-border">
      <div className="grid grid-cols-2 gap-px bg-border md:grid-cols-5">
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            data-testid={item.testId}
            aria-label={`${item.labelForScreenReader}, ${item.count} ${t(item.count === 1 ? 'count.one' : 'count.many', item.count === 1 ? 'procurement' : 'procurements')}`}
            aria-pressed={item.active}
            onClick={item.onClick}
            className={`flex min-h-[112px] min-w-0 flex-col items-start bg-card px-3.5 py-3 text-left transition-colors hover:bg-accent focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-[126px] md:px-4 ${item.key === 'pay' ? 'col-span-2 md:col-span-1' : ''} ${item.active ? 'border-b-2 border-primary pb-[10px]' : 'border-b-2 border-transparent pb-[10px]'}`}
          >
            <span className="text-[13px] font-medium text-muted-foreground">{item.label}</span>
            <span className="mt-1 tabular text-[20px] font-semibold leading-tight text-foreground">{item.count}</span>
            <MoneyTotalLines
              totals={item.totals}
              tooltip={item.tooltip}
              testId={`summary-total-${item.key}`}
              className="mt-1"
            />
            <span className="mt-auto pt-2 text-[12px] leading-snug text-muted-foreground">{item.meaning}</span>
          </button>
        ))}
      </div>
    </section>
  );
};
