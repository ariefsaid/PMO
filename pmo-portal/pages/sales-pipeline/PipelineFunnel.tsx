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
  /** The page's money figures, drawn above the funnel inside the same card. */
  header?: React.ReactNode;
}

export const PipelineFunnel: React.FC<PipelineFunnelProps> = ({
  projection,
  selectedIndex,
  onSelectStage,
  stageLabel,
  header,
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
    <section aria-label={t('sales.summaryLabel', 'Pipeline summary')} className="panel-card p-[var(--panel-inset)]">
      {header && <div className="mb-4">{header}</div>}
      <Funnel
        stages={funnelStages}
        presentation="flat"
        selectedIndex={selectedIndex ?? undefined}
        onSelect={(i) => {
          const col = openColumns[i];
          if (col) {
            onSelectStage(col.statuses[0] as OpenFunnelStage);
          }
        }}
      />
    </section>
  );
};
