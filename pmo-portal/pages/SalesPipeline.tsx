import React, { useState } from 'react';
import { AccessDenied, FigureHiddenLine, FigureScope, ListPage, ListState, useFigureReport, type HiddenFigure } from '@/src/components/ui';
import { FigureContent } from '@/src/components/ui/FigureContent';
import type { PipelineProject } from '@/src/lib/db/dashboard';
import { SalesKanbanBoardTaxBasisContext } from '../components/salesKanbanBoardTaxBasis';
import { PipelineFunnel } from './sales-pipeline/PipelineFunnel';
import { canSummarizeExclusiveTaxBasis } from '../components/salesPipeline';
import {
  DealPreview, DealResults, NeedsAttentionCard, NewProjectButton, PhoneControls, PhoneFigures, SalesClassification, SalesExport,
  SalesScope, SalesSearch, SalesViewToggle,
} from './sales/SalesParts';
import { useSalesModel } from './sales/useSalesModel';
import { pipelineFigures, type FigureLines } from './sales/salesLogic';

/** One headline figure: the first line is the figure (short, exact on hover); other currencies sit under it. */
export const FigureLinesView: React.FC<{ figures: FigureLines; testId?: string }> = ({ figures, testId }) => (
  <span data-testid={testId} className="inline-flex flex-col">
    {figures.lines.map((line, i) => (
      <span key={line} className={i === 0 ? undefined : 'text-control font-normal text-muted-foreground'}>
        <FigureContent value={line} exactValue={figures.exact[i] ?? undefined} />
      </span>
    ))}
  </span>
);

const PipelineFigures: React.FC<{ figures: ReturnType<typeof pipelineFigures>; openCount: number; unavailable: string; t: ReturnType<typeof useSalesModel>['t'] }> = ({ figures, openCount, unavailable, t }) => {
  const hidden: HiddenFigure[] = figures.weighted === null
    ? [{ label: t('sales:options.weightedForecast', 'Weighted forecast'), reason: unavailable }]
    : [];
  useFigureReport(hidden);
  return (
    <dl className="grid min-w-0 grid-cols-2 gap-4">
      {figures.weighted !== null && (
        <div className="flex min-w-0 flex-col gap-1">
          <dt className="text-control font-medium text-muted-foreground">{t('sales:options.weightedForecast', 'Weighted forecast')}</dt>
          {/* T5: short on the tile, exact on hover and for screen readers (the home "Contract on hand"
              contract, AC-701) — one figure mechanism, not a second money formatter. */}
          <dd className="text-metric font-semibold tabular"><FigureLinesView figures={figures.weighted} testId="pipeline-weighted-total" /></dd>
        </div>
      )}
      <div data-testid="pipeline-open-value" className="flex min-w-0 flex-col gap-1">
        <dt className="text-control font-medium text-muted-foreground">{t('sales:options.openValue', 'Open value')}</dt>
        <dd data-testid="pipeline-open-value-figure" className="text-metric font-semibold tabular"><FigureLinesView figures={figures.open} /></dd>
        {/* Keep the population caption beside its open-value figure when the tile has room. */}
        <dd data-testid="pipeline-open-count" className="text-control text-muted-foreground">
          {t('sales:options.openCountShort', '{{n}} projects', { n: openCount })}
        </dd>
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
  const pf = pipelineFigures(m);
  const ready = m.state === undefined;
  const unavailable = t('sales:funnel.unavailable', 'Not available');
  // The band sums open projects, so its summary condition also governs desktop card labels.
  const summarizesOpenExclusiveTaxBasis = canSummarizeExclusiveTaxBasis(m.openProjects);
  const boardCaption = summarizesOpenExclusiveTaxBasis
    ? t('sales:boardBasisAndChanceCaption', 'Amounts excl. PPN · % = chance to win')
    : t('sales:boardChanceCaption', '% = chance to win');
  const figures = <PipelineFigures figures={pf} openCount={m.openProjects.length} unavailable={unavailable} t={t} />;
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
          <div className="mb-2 grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <NeedsAttentionCard m={m} onOpen={setPreview} compact />
            <div className="min-w-0">
              <PipelineFunnel header={figures} projection={m.funnel} selectedIndex={m.stageIndex} stageLabel={m.stageLabel} onSelectStage={(s) => m.selectStage(s)} />
            </div>
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
          <summary className="min-h-11 cursor-pointer py-2 text-control font-semibold">
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
