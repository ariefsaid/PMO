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
import { openValueTotal } from './sales/salesLogic';

const PipelineFigures: React.FC<{ total: number | null; weighted: number; currency: string; openCount: number; mixed: string; t: ReturnType<typeof useSalesModel>['t'] }> = ({ total, weighted, currency, openCount, mixed, t }) => {
  const hidden: HiddenFigure[] = total === null ? [
    { label: t('sales:options.weightedForecast', 'Weighted forecast'), reason: mixed },
    { label: t('sales:options.openValue', 'Open value'), reason: mixed },
  ] : [];
  const scoped = useFigureReport(hidden);
  if (total === null && scoped) return null;
  const value = total === null ? mixed : '';
  return (
    <dl className="grid min-w-0 grid-cols-2 gap-x-3">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <dt className="text-control font-medium text-muted-foreground">{t('sales:options.weightedForecast', 'Weighted forecast')}</dt>
        <dd className="text-group font-semibold tabular">{total === null ? value : (
          // T5: short on the tile, exact on hover and for screen readers (the home "Contract on
          // hand" contract, AC-701) — one figure mechanism, not a second money formatter.
          <span data-testid="pipeline-weighted-total">
            <FigureContent value={formatTileMoney(weighted, currency)} exactValue={formatTableMoney(weighted, currency) ?? undefined} />
          </span>
        )}</dd>
      </div>
      <div data-testid="pipeline-open-value" className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <dt className="text-control font-medium text-muted-foreground">{t('sales:options.openValue', 'Open value')}</dt>
        <dd data-testid="pipeline-open-value-figure" className="text-group font-semibold tabular">{total === null ? value : formatTileMoney(total, currency)}</dd>
        {/* The deal count is this figure's caption on its own line (w-full breaks it below the
            amount): a count never sits in a row of money figures (screen rule "Numbers"). */}
        {total !== null && (
          <dd data-testid="pipeline-open-count" className="w-full text-control text-muted-foreground">
            {t('sales:options.openCountShort', '{{n}} projects', { n: openCount })}
          </dd>
        )}
      </div>
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
  const mixed = t('sales:pipeline.mixedCurrency', 'Mixed currencies');
  // The band sums open projects, so its summary condition also governs desktop card labels.
  const summarizesOpenExclusiveTaxBasis = canSummarizeExclusiveTaxBasis(m.openProjects);
  const taxBasis = summarizesOpenExclusiveTaxBasis
    ? t('sales:exclusiveTaxSummary', 'excl. PPN')
    : undefined;
  const figures = <PipelineFigures total={total} weighted={m.funnel.totalWeighted} currency={cur} openCount={m.openProjects.length} mixed={mixed} t={t} />;
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
          <div className="mb-2 grid items-start gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
            <div className="min-w-0">
              <PipelineFunnel header={figures} projection={m.funnel} selectedIndex={m.stageIndex} stageLabel={m.stageLabel} taxBasis={taxBasis} onSelectStage={(s) => m.selectStage(s)} />
            </div>
            <NeedsAttentionCard m={m} onOpen={setPreview} />
          </div>
        </>
      ) : null}
      mobileToolbar={m.state !== 'loading' && <PhoneControls m={m} />}
      filters={m.state !== 'loading' && m.view === 'table' && <SalesScope m={m} />}
      secondaryFilter={m.state !== 'loading' && <SalesClassification m={m} />}
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
