import React from 'react';
import { useTranslation } from 'react-i18next';
import { Funnel, type FunnelStage } from '@/src/components/ui';
import { formatMoneyLines, formatTileMoney, formatTableMoney } from '@/src/lib/format';
import { type OpenFunnelStage, type SalesColumn } from '../../components/salesPipeline';
import type { FunnelProjection } from './pipelineFunnelModel';

export interface PipelineFunnelProps {
  projection: FunnelProjection;
  selectedIndex?: number | null;
  onSelectStage: (status: OpenFunnelStage) => void;
  stageLabel: (col: SalesColumn) => string;
  /** The page's money figures, drawn above the funnel inside the same card. */
  header?: React.ReactNode;
  /**
   * The org's tax-basis word ("excl. PPN"), stated ONCE for the band's amounts when every priced
   * deal shares it. Omitted when the deals mix bases: then each row states its own basis instead.
   */
  taxBasis?: string;
}

// Whole units, but never a non-zero amount drawn as zero (screen-rules "Numbers").
const money = (amount: number, currency: string) => formatTileMoney(amount, currency) ?? '';

export const PipelineFunnel: React.FC<PipelineFunnelProps> = ({
  projection,
  selectedIndex,
  onSelectStage,
  stageLabel,
  header,
  taxBasis,
}) => {
  const { t } = useTranslation();
  const { stageProjections, openColumns } = projection;

  const unavailableReason = t('sales:funnel.unavailable', 'Not available');
  const unavailableTotal = (
    <span title={unavailableReason}>
      —<span className="sr-only"> {unavailableReason}</span>
    </span>
  );

  const funnelStages: FunnelStage[] = stageProjections.map((p) => {
    // An empty stage is a money row too: it reads its zero in the band's own currency, never the
    // bare count "0" that read like a deal count among the amounts beside it. A stage the aggregate
    // does not report is the opposite case: unknown, never a zero.
    const empty = p.stage?.count === 0;
    // A stage holding two currencies reads one line per currency (the organisation's first), never a sum.
    const perCurrency = formatMoneyLines(
      p.byCurrency.map((c) => ({ currency: c.currency, amount: c.total })), p.stageCurrency, 'tile',
    ).lines;
    const exactCurrency = formatMoneyLines(p.byCurrency.map((c) => ({ currency: c.currency, amount: c.total })), p.stageCurrency, 'table').lines;
    const value = p.unavailable
      ? unavailableTotal
      : empty
        ? money(0, p.stageCurrency)
        : p.mixedStage
          ? <>{perCurrency.map((line) => <div key={line} title={exactCurrency[perCurrency.indexOf(line)]}>{line}</div>)}</>
          : <span title={formatTableMoney(p.totalValue, p.stageCurrency) ?? undefined}>{money(p.totalValue, p.stageCurrency)}</span>;
    return {
      name: stageLabel(p.col),
      dotColor: p.col.dotColor,
      value,
      weighted: p.unavailable || empty || p.mixedStage
        ? undefined
        : <span title={t('sales.funnel.weighted', '{{value}} weighted', { value: formatTableMoney(p.weightedValue, p.stageCurrency) })}>{t('sales.funnel.weighted', '{{value}} weighted', {
            value: money(p.weightedValue, p.stageCurrency),
          })}</span>,
      barPct: p.barPct ?? (!p.unavailable && p.totalValue === 0 ? 0 : undefined),
    };
  });

  return (
    <section aria-label={t('sales.summaryLabel', 'Pipeline summary')} className="panel-card h-full p-[var(--panel-inset)]">
      {header && <div className="mb-2">{header}</div>}
      <Funnel
        stages={funnelStages}
        presentation="flat"
        compact
        fit
        selectedIndex={selectedIndex ?? undefined}
        onSelect={(i) => {
          const col = openColumns[i];
          if (col) {
            onSelectStage(col.statuses[0] as OpenFunnelStage);
          }
        }}
      />
      {/* The band's one caption: the tax basis for these amounts, stated once instead of a key
          floating over the board that named a column the board does not have. The bars themselves
          need no caption — each stage's amount sits directly above its own bar, and every bar is
          drawn on the same scale (the largest stage is the full bar). */}
      {taxBasis && (
        <p data-testid="pipeline-funnel-caption" className="mt-2 text-control text-muted-foreground">
          {taxBasis}
        </p>
      )}
    </section>
  );
};
