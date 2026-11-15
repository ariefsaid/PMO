import React, { useState } from 'react';
import { AccessDenied, FigureHiddenLine, FigureScope, ListPage, ListState, useFigureReport, type HiddenFigure } from '@/src/components/ui';
import { FigureContent } from '@/src/components/ui/FigureContent';
import { formatTableMoney, formatTileMoney } from '@/src/lib/format';
import type { PipelineProject } from '@/src/lib/db/dashboard';
import { SalesKanbanBoardTaxBasisContext } from '../components/salesKanbanBoardTaxBasis';
import { PipelineFunnel } from './sales-pipeline/PipelineFunnel';
import { canSummarizeExclusiveTaxBasis } from '../components/salesPipeline';
import {
  DealPreview, DealResults, NeedsAttentionCard, NewProjectButton, PhoneControls, PhoneFigures, SalesClassification, SalesExport,
  SalesScope, SalesSearch, SalesViewToggle,
} from './sales/SalesParts';
import { useSalesModel } from './sales/useSalesModel';
import { figureReason, openValueLines, openValueTotal, weightedLines, weightedTotal, type CurrencyLinesFigure } from './sales/salesLogic';
import { CurrencyLines } from './sales-pipeline/currencyLines';

/** #2199: a per-currency figure: the lead currency is the figure, each other currency a second line; exact on hover. */
const LinesFigure: React.FC<{ figure: CurrencyLinesFigure }> = ({ figure }) => (
  <FigureContent value={<CurrencyLines lines={figure.tile} />} exactValue={figure.exact.join('; ')} />
);

const PipelineFigures: React.FC<{
  total: number | null; weighted: number | null; totalLines: CurrencyLinesFigure | null; weightedLinesFigure: CurrencyLinesFigure | null;
  currency: string; openCount: number; reason: string; t: ReturnType<typeof useSalesModel>['t'];
}> = ({ total, weighted, totalLines, weightedLinesFigure, currency, openCount, reason, t }) => {
  // A one-currency pipeline reads the stage aggregate; a mixed one its reconciled per-currency lines
  // (#2199). T5: short on the tile, exact on hover and for screen readers (the home "Contract on hand"
  // contract, AC-701) — one figure mechanism, not a second money formatter.
  const weightedFigure = weighted !== null
    ? <FigureContent value={formatTileMoney(weighted, currency)} exactValue={formatTableMoney(weighted, currency) ?? undefined} />
    : weightedLinesFigure && <LinesFigure figure={weightedLinesFigure} />;
  const totalFigure = total !== null ? formatTileMoney(total, currency) : totalLines && <LinesFigure figure={totalLines} />;
  const weightedLabel = t('sales:options.weightedForecast', 'Weighted forecast');
  const openLabel = t('sales:options.openValue', 'Open value');
  const hidden: HiddenFigure[] = [
    ...(!weightedFigure ? [{ label: weightedLabel, reason }] : []),
    ...(!totalFigure ? [{ label: openLabel, reason }] : []),
  ];
  const scoped = useFigureReport(hidden);
  if (!totalFigure && !weightedFigure && scoped) return null;
  return (
    <dl className="grid min-w-0 grid-cols-2 gap-x-3">
      {!(!weightedFigure && scoped) && (
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <dt className="text-control font-medium text-muted-foreground">{weightedLabel}</dt>
          <dd className="text-group font-semibold tabular">{weightedFigure
            ? <span data-testid="pipeline-weighted-total">{weightedFigure}</span>
            : reason}</dd>
        </div>
      )}
      {!(!totalFigure && scoped) && (
        <div data-testid="pipeline-open-value" className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <dt className="text-control font-medium text-muted-foreground">{openLabel}</dt>
          <dd data-testid="pipeline-open-value-figure" className="text-group font-semibold tabular">{totalFigure || reason}</dd>
          {/* Keep the population caption beside its open-value figure when the tile has room. */}
          {totalFigure && (
            <dd data-testid="pipeline-open-count" className="text-control text-muted-foreground">
              {t('sales:options.openCountShort', '{{n}} projects', { n: openCount })}
            </dd>
          )}
        </div>
      )}
    </dl>
  );
};

/** The CRM pipeline: figures on top, the funnel as stage filter, a board or table, and a quick-view drawer. */
const SalesPipeline: React.FC = () => {
  const m = useSalesModel();
  const { t } = m;
  const [preview, setPreview] = useState<PipelineProject | null>(null);
  if (!m.canViewSales) {
    return (
      <AccessDenied
        title={t('sales.accessDenied.title', "You don't have access to the Sales Pipeline")}
        sub={t('sales.accessDenied.sub', 'The Sales Pipeline is available to managers and finance. Your work lives on your dashboard, projects, and tasks.')}
        onBack={() => m.navigate('/')}
      />
    );
  }
  const total = openValueTotal(m);
  const cur = m.funnel.effectiveCurrency;
  const ready = m.state === undefined;
  // The band sums open projects, so its summary condition also governs desktop card labels.
  const summarizesOpenExclusiveTaxBasis = canSummarizeExclusiveTaxBasis(m.openProjects);
  const boardCaption = summarizesOpenExclusiveTaxBasis
    ? t('sales:boardBasisAndChanceCaption', 'Amounts excl. PPN · % = chance to win')
    : t('sales:boardChanceCaption', '% = chance to win');
  const figures = <PipelineFigures total={total} weighted={weightedTotal(m)} totalLines={openValueLines(m)} weightedLinesFigure={weightedLines(m)} currency={cur} openCount={m.openProjects.length} reason={figureReason(m)} t={t} />;
  return (
    <FigureScope>
    <ListPage
      title={t('shell.nav.sales', 'Sales Pipeline')}
      help={t('sales:options.weightedNote', 'Value × chance of winning')}
      primaryAction={<NewProjectButton m={m} />}
      banner={m.state === 'loading' && m.isDesktop ? (
        <div className="panel-card mb-4 p-[var(--panel-inset)]"><ListState variant="loading" rows={2} /></div>
      ) : ready && m.isDesktop ? (
        <>
          <FigureHiddenLine className="mb-3 text-control text-muted-foreground" />
          <div className="mb-2 grid items-stretch gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
            <div className="min-w-0">
              <PipelineFunnel header={figures} projection={m.funnel} selectedIndex={m.stageIndex} stageLabel={m.stageLabel} onSelectStage={(s) => m.selectStage(s)} />
            </div>
            <NeedsAttentionCard m={m} onOpen={setPreview} />
          </div>
        </>
      ) : null}
      mobileToolbar={m.state !== 'loading' && <PhoneControls m={m} />}
      filters={m.state !== 'loading' && (m.view === 'table'
        ? <SalesScope m={m} />
        : <p className="min-w-0 text-control text-muted-foreground">{boardCaption}</p>)}
      secondaryFilter={m.state !== 'loading' && m.hasClassification ? <SalesClassification m={m} /> : undefined}
      search={m.state !== 'loading' && <SalesSearch m={m} />}
      exportAction={m.state !== 'loading' && <SalesExport m={m} />}
      view={m.state !== 'loading' && <SalesViewToggle m={m} />}
    >
      <SalesKanbanBoardTaxBasisContext.Provider value={summarizesOpenExclusiveTaxBasis}>
        <DealResults m={m} onOpen={m.isDesktop ? setPreview : m.onOpen} />
      </SalesKanbanBoardTaxBasisContext.Provider>
      {!m.isDesktop && ready && (
        <details data-testid="sales-phone-summary-details" className="mt-4 rounded-lg border border-border bg-card px-4 py-3">
          <summary className="cursor-pointer text-control font-semibold">
            {t('sales:options.figuresLabel', 'Pipeline figures')}
          </summary>
          <div className="mt-3 space-y-3">
            <PhoneFigures m={m} />
            <NeedsAttentionCard m={m} onOpen={setPreview} compact />
          </div>
        </details>
      )}
      <DealPreview m={m} deal={preview} onClose={() => setPreview(null)} />
    </ListPage>
    </FigureScope>
  );
};

export default SalesPipeline;
