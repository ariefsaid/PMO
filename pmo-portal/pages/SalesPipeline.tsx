import React, { useState } from 'react';
import { AccessDenied, FigureHiddenLine, FigureScope, ListPage, ListState, StatTiles } from '@/src/components/ui';
import { formatTileMoney } from '@/src/lib/format';
import type { PipelineProject } from '@/src/lib/db/dashboard';
import { PipelineFunnel } from './sales-pipeline/PipelineFunnel';
import {
  DealPreview, DealResults, NeedsAttentionCard, NewProjectButton, PhoneControls, PhoneFigures, SalesClassification, SalesExport,
  SalesScope, SalesSearch, SalesViewToggle,
} from './sales/SalesParts';
import { useSalesModel } from './sales/useSalesModel';
import { openValueTotal } from './sales/salesLogic';

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
  const figures = (
    <StatTiles
      variant="bare"
      columns={2}
      tiles={[
        {
          label: t('sales:options.weightedForecast', 'Weighted forecast'),
          value: total === null ? null : <span data-testid="pipeline-weighted-total">{formatTileMoney(m.funnel.totalWeighted, cur)}</span>,
          unavailableReason: mixed,
          sub: t('sales:options.weightedNote', 'Value × chance of winning'),
        },
        {
          label: t('sales:options.openValue', 'Open value'),
          value: total === null ? null : formatTileMoney(total, cur),
          unavailableReason: mixed,
          sub: t('sales:options.openCount', '{{n}} open projects', { n: m.openProjects.length }),
        },
      ]}
    />
  );
  return (
    <FigureScope>
    <ListPage
      title={t('shell.nav.sales', 'Sales Pipeline')}
      primaryAction={<NewProjectButton m={m} />}
      banner={m.state === 'loading' && m.isDesktop ? (
        <div className="panel-card mb-4 p-[var(--panel-inset)]"><ListState variant="loading" rows={2} /></div>
      ) : ready && m.isDesktop ? (
        <>
          <FigureHiddenLine className="mb-3 text-control text-muted-foreground" />
          <div className="mb-4 grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="min-w-0">
              <PipelineFunnel header={figures} projection={m.funnel} selectedIndex={m.stageIndex} stageLabel={m.stageLabel} onSelectStage={(s) => m.selectStage(s)} />
            </div>
            <NeedsAttentionCard m={m} onOpen={setPreview} />
          </div>
        </>
      ) : <PhoneFigures m={m} />}
      mobileToolbar={m.state !== 'loading' && <PhoneControls m={m} />}
      filters={m.state !== 'loading' && m.view === 'table' && <SalesScope m={m} />}
      secondaryFilter={m.state !== 'loading' && <SalesClassification m={m} />}
      search={m.state !== 'loading' && <SalesSearch m={m} />}
      exportAction={m.state !== 'loading' && <SalesExport m={m} />}
      view={m.state !== 'loading' && <SalesViewToggle m={m} />}
    >
      <DealResults m={m} onOpen={m.isDesktop ? setPreview : m.onOpen} />
      <DealPreview m={m} deal={preview} onClose={() => setPreview(null)} />
    </ListPage>
    </FigureScope>
  );
};

export default SalesPipeline;
