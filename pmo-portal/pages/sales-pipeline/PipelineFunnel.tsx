import React from 'react';
import { useTranslation } from 'react-i18next';
import { Funnel, type FunnelStage } from '@/src/components/ui';
import { formatTableMoney } from '@/src/lib/format';
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
  const missingReason = t('sales:pipeline.stageMissing', 'Stage figure missing');
  const unknown = (reason: string) => (
    <span title={reason}>
      —<span className="sr-only"> {reason}</span>
    </span>
  );
  // Whole units, but never a non-zero amount as 0, and never an unknown one as 0 (#2199).
  const money = (value: number | null, currency: string) =>
    (value === null ? null : formatTableMoney(value, currency)) ?? unknown(missingReason);

  const funnelStages: FunnelStage[] = stageProjections.map((p) => {
    // An empty stage is a money row too: it reads its zero in the band's own currency, never the
    // bare count "0" that read like a deal count among the amounts beside it.
    // A stage the aggregate lacks while it holds deals is unknown, not empty (its total is null).
    const empty = (p.stage?.count === 0 || !p.stage) && p.totalValue !== null;
    return {
      name: stageLabel(p.col),
      dotColor: p.col.dotColor,
      value: empty
        ? money(0, p.stageCurrency)
        : p.mixedStage
          ? unknown(mixedReason)
          : money(p.totalValue, p.stageCurrency),
      weighted: empty || p.mixedStage || p.totalValue === null
        ? undefined
        : p.weightedValue === null
          ? unknown(missingReason)
          : t('sales.funnel.weighted', '{{value}} weighted', {
              value: formatTableMoney(p.weightedValue, p.stageCurrency) ?? '—',
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
