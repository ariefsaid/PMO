import React, { useState } from 'react';
import { AccessDenied, ListPage, ListState } from '@/src/components/ui';
import { formatCurrency } from '@/src/lib/format';
import type { PipelineProject } from '@/src/lib/db/dashboard';
import { PipelineFunnel } from './sales-pipeline/PipelineFunnel';
import {
  DealPreview, DealResults, Figure, NewProjectButton, PhoneControls, PhoneFigures, SalesClassification, SalesExport,
  SalesScope, SalesSearch, SalesViewToggle,
} from './sales/SalesParts';
import { useSalesModel } from './sales/useSalesModel';
import { attentionDeals, dash, openValueTotal } from './sales/salesLogic';

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
  const attention = attentionDeals(m).length;
  const ready = m.state === undefined;
  return (
    <ListPage
      title={t('shell.nav.sales', 'Sales Pipeline')}
      primaryAction={<NewProjectButton m={m} />}
      banner={m.state === 'loading' && m.isDesktop ? (
        <div className="panel-card mb-4 p-[var(--panel-inset)]"><ListState variant="loading" rows={2} /></div>
      ) : ready && m.isDesktop ? (
        <>
          <section aria-label={t('sales:options.figuresLabel', 'Pipeline figures')} className="panel-card mb-4 grid grid-cols-4 gap-6 p-[var(--panel-inset)]">
            <Figure lead label={t('sales:options.weightedForecast', 'Weighted forecast')} value={total === null ? dash : formatCurrency(m.funnel.totalWeighted, cur)}
              note={t('sales:options.weightedNote', 'Value × chance it proceeds × chance we win')} testId="sales-a-weighted" />
            <Figure label={t('sales:options.openValue', 'Open value')} value={total === null ? dash : formatCurrency(total, cur)}
              note={t('sales:options.openCount', '{{n}} open projects', { n: m.openProjects.length })} />
            <Figure label={t('sales:options.needsYou', 'Needs attention')} value={attention}
              note={t('sales:options.needsYouNote', 'Untouched 30+ days or 90+ days in one stage')} onClick={() => m.setScope('Needs attention')} />
            <Figure label={t('sales:options.outcomes', 'Won · Lost')} value={`${m.won.length} · ${m.lost.length}`}
              note={t('sales:options.outcomesNote', 'Decided projects on this board')} onClick={() => m.setScope('Won')} />
          </section>
          <PipelineFunnel projection={m.funnel} selectedIndex={m.stageIndex} stageLabel={m.stageLabel} onSelectStage={(s) => m.selectStage(s)} />
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
  );
};

export default SalesPipeline;
