import React from 'react';
import { useTranslation } from 'react-i18next';
import { Funnel, type FunnelStage } from '@/src/components/ui';
import { formatCurrency } from '@/src/lib/format';
import { formatPercent, type OpenFunnelStage, type SalesColumn } from '../../components/salesPipeline';
import type { FunnelProjection } from './pipelineFunnelModel';

export interface PipelineFunnelProps {
  projection: FunnelProjection;
  selectedIndex?: number | null;
  onSelectStage: (status: OpenFunnelStage) => void;
  stageLabel: (col: SalesColumn) => string;
}

export const PipelineFunnel: React.FC<PipelineFunnelProps> = ({
  projection,
  selectedIndex,
  onSelectStage,
  stageLabel,
}) => {
  const { t } = useTranslation();
  const { mixedPipeline, totalWeighted, effectiveCurrency, stageProjections, openColumns } = projection;

  const mixedReason = t('sales:pipeline.mixedCurrency', 'Mixed currencies, so no single total');
  const unknownTotal = (
    <span title={mixedReason}>
      —<span className="sr-only"> {mixedReason}</span>
    </span>
  );

  const funnelStages: FunnelStage[] = stageProjections.map((p) => {
    return {
      name: stageLabel(p.col),
      dotColor: p.col.dotColor,
      prob: p.winProbability !== undefined ? formatPercent(p.winProbability) : undefined,
      value: p.mixedStage ? unknownTotal : formatCurrency(p.totalValue, p.stageCurrency),
      weighted: p.mixedStage
        ? undefined
        : t('sales.funnel.weighted', '{{value}} weighted', {
            value: formatCurrency(p.weightedValue, p.stageCurrency),
          }),
      barPct: p.barPct,
    };
  });

  return (
    <section aria-label={t('sales.summaryLabel', 'Pipeline summary')} className="panel-card mb-4 p-[var(--panel-inset)]">
      <Funnel
        stages={funnelStages}
        selectedIndex={selectedIndex ?? undefined}
        onSelect={(i) => {
          const col = openColumns[i];
          if (col) {
            onSelectStage(col.statuses[0] as OpenFunnelStage);
          }
        }}
      />
      <div className="mt-2 flex items-center gap-1.5 px-1 text-[12.5px] text-muted-foreground">
        <span>{t('sales.weightedForecast', 'Weighted pipeline forecast')}</span>
        <span data-testid="pipeline-weighted-total" className="font-bold tabular text-foreground">
          {mixedPipeline ? unknownTotal : formatCurrency(totalWeighted, effectiveCurrency)}
        </span>
      </div>
    </section>
  );
};
