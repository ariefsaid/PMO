import React from 'react';
import { useTranslation } from 'react-i18next';
import { Funnel, type FunnelStage } from '@/src/components/ui';
import { formatCurrency } from '@/src/lib/format';
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

  const mixedReason = t('sales:pipeline.mixedCurrency', 'Mixed currencies');
  const unknownTotal = (
    <span title={mixedReason}>
      —<span className="sr-only"> {mixedReason}</span>
    </span>
  );

  const funnelStages: FunnelStage[] = stageProjections.map((p) => {
    // An empty stage is a money row too: it reads its zero in the band's own currency, never the
    // bare count "0" that read like a deal count among the amounts beside it.
    const empty = p.stage?.count === 0 || !p.stage;
    return {
      name: stageLabel(p.col),
      dotColor: p.col.dotColor,
      value: empty
        ? formatCurrency(0, p.stageCurrency)
        : p.mixedStage
          ? unknownTotal
          : formatCurrency(p.totalValue, p.stageCurrency),
      weighted: empty || p.mixedStage
        ? undefined
        : t('sales.funnel.weighted', '{{value}} weighted', {
            value: formatCurrency(p.weightedValue, p.stageCurrency),
          }),
      barPct: p.barPct,
    };
  });

  return (
    <section aria-label={t('sales.summaryLabel', 'Pipeline summary')} className="panel-card p-[var(--panel-inset)]">
      {header && <div className="mb-2">{header}</div>}
      <Funnel
        stages={funnelStages}
        presentation="flat"
        compact
        selectedIndex={selectedIndex ?? undefined}
        onSelect={(i) => {
          const col = openColumns[i];
          if (col) {
            onSelectStage(col.statuses[0] as OpenFunnelStage);
          }
        }}
      />
      {/* One stated measure for the bars: the same open value as the amount above each bar, on one
          scale (the largest stage is the full bar). Stage order is the pipeline's own. The tax
          basis rides in the same line, once for the whole band, instead of a key floating over the
          board that named a column the board does not have. */}
      <p data-testid="pipeline-funnel-scale" className="mt-2 text-control text-muted-foreground">
        {t('sales:pipeline.funnelScale', 'Open value, one scale')}
        {taxBasis && <>{' · '}{taxBasis}</>}
      </p>
    </section>
  );
};
