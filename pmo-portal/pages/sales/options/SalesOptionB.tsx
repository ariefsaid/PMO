import React, { useState } from 'react';
import { AccessDenied, Button, ListState, StatusPill } from '@/src/components/ui';
import { formatCurrency } from '@/src/lib/format';
import { cn } from '@/src/components/ui/cn';
import type { PipelineProject } from '@/src/lib/db/dashboard';
import { pillVariantForStatus } from '../../../components/salesPipeline';
import {
  DealPreview, DealResults, NewProjectButton, PhoneControls, SalesClassification, SalesExport,
  SalesSearch, SalesViewToggle,
} from './SalesParts';
import type { SalesModel } from './useSalesModel';
import { attentionDeals, attentionReason, dash } from './salesLogic';
import type { DealScope } from '../../sales-pipeline/pipelineListModel';

/**
 * Option B, the worklist: a stage rail on the left is the only navigation (it replaces the scope
 * toggle and the funnel), "Needs you" leads the work area, the deals follow.
 */
const SalesOptionB: React.FC<{ m: SalesModel }> = ({ m }) => {
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
  const attention = attentionDeals(m);
  const { stageProjections, mixedPipeline, effectiveCurrency } = m.funnel;
  type RailItem = { key: string; label: string; count: number; value?: string; active: boolean; onClick: () => void };
  const pick = (scope: DealScope, status = '') => () =>
    m.setWorkingSet((ws) => ({ ...ws, scope, status: status as typeof ws.status }));
  const rail: RailItem[] = [
    { key: 'all', label: t('sales:scope.all', 'All'), count: m.allDeals.length, active: m.scope === 'All' && !m.selectedStatus, onClick: pick('All') },
    ...stageProjections.map((p): RailItem => ({
      key: p.status,
      label: m.stageLabel(p.col),
      count: p.stage?.count ?? 0,
      value: p.mixedStage ? dash : formatCurrency(p.totalValue, p.stageCurrency),
      active: m.selectedStatus === p.status,
      onClick: pick('Open', p.status),
    })),
    { key: 'won', label: t('sales:scope.won', 'Won'), count: m.won.length, active: m.scope === 'Won', onClick: pick('Won') },
    { key: 'lost', label: m.scopeLabels.Lost, count: m.lost.length, active: m.scope === 'Lost', onClick: pick('Lost') },
  ];
  const ready = m.state === undefined;
  return (
    <div className="min-w-0">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-xl font-semibold text-foreground">{t('shell.nav.sales', 'Sales Pipeline')}</h1>
        {m.state !== 'loading' && <SalesSearch m={m} className="w-64 max-sm:w-full" />}
        {m.state !== 'loading' && m.isDesktop && <SalesClassification m={m} />}
        {m.state !== 'loading' && m.isDesktop && <SalesExport m={m} />}
        {m.state !== 'loading' && m.isDesktop && <SalesViewToggle m={m} />}
        <NewProjectButton m={m} />
      </div>
      {!m.isDesktop && m.state !== 'loading' && <div className="mb-4"><PhoneControls m={m} /></div>}
      <div className="flex min-w-0 gap-6">
        {m.isDesktop && ready && (
          <nav aria-label={t('sales:options.stageNav', 'Pipeline stages')} className="w-56 shrink-0">
            <ul className="space-y-0.5">
              {rail.map((r) => (
                <li key={r.key}>
                  <button
                    type="button"
                    onClick={r.onClick}
                    aria-current={r.active ? 'true' : undefined}
                    className={cn(
                      'flex w-full items-baseline justify-between gap-2 rounded-md px-3 py-2 text-left text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring',
                      r.active ? 'bg-secondary font-semibold text-foreground' : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
                    )}
                  >
                    <span className="truncate">{r.label}</span>
                    <span className="tabular text-xs">{r.count}</span>
                  </button>
                  {r.value && <p className="px-3 pb-1 text-xs tabular text-muted-foreground">{r.value}</p>}
                </li>
              ))}
              <li>
                <button
                  type="button"
                  onClick={() => m.setScope('Needs attention')}
                  aria-current={m.scope === 'Needs attention' ? 'true' : undefined}
                  className={cn('mt-2 flex w-full items-baseline justify-between gap-2 rounded-md px-3 py-2 text-left text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring',
                    m.scope === 'Needs attention' ? 'bg-secondary font-semibold text-foreground' : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground')}
                >
                  <span>{t('sales.scope.needsAttention', 'Needs attention')}</span>
                  <span className="tabular text-xs">{attention.length}</span>
                </button>
              </li>
            </ul>
            <p className="mt-4 px-3 text-xs text-muted-foreground">
              {t('sales:options.weightedForecast', 'Weighted forecast')}
              <span data-testid="pipeline-weighted-total" className="mt-0.5 block text-base font-semibold tabular text-foreground">
                {mixedPipeline ? dash : formatCurrency(m.funnel.totalWeighted, effectiveCurrency)}
              </span>
            </p>
          </nav>
        )}
        <div className="min-w-0 flex-1">
          {ready && attention.length > 0 && m.scope !== 'Needs attention' && (
            <section aria-label={t('sales:options.needsYou', 'Needs attention')} className="panel-card mb-4 p-[var(--panel-inset)]">
              <h2 className="mb-2 text-sm font-semibold text-foreground">
                {t('sales:options.needsYouHeading', 'Needs you · {{n}}', { n: attention.length })}
              </h2>
              <ul className="divide-y divide-border">
                {attention.slice(0, 4).map((p) => (
                  <li key={p.id} className="flex min-w-0 items-center gap-3 py-2">
                    <StatusPill variant={pillVariantForStatus(p.status)}>{m.stageName(p.status)}</StatusPill>
                    <button type="button" onClick={() => setPreview(p)} className="min-w-0 flex-1 truncate text-left text-sm font-medium text-foreground hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">{p.name}</button>
                    <span className="hidden text-xs text-muted-foreground sm:inline">{attentionReason(m, p)}</span>
                    <Button variant="outline" size="sm" onClick={() => m.onOpen(p)}>{t('sales:options.openDeal', 'Open deal')}</Button>
                  </li>
                ))}
              </ul>
              {attention.length > 4 && (
                <button type="button" className="mt-2 text-xs font-semibold text-primary-text hover:underline" onClick={() => m.setScope('Needs attention')}>
                  {t('sales:options.showAllAttention', 'Show all {{n}}', { n: attention.length })}
                </button>
              )}
            </section>
          )}
          {m.state === 'loading' ? <ListState variant="loading" rows={6} /> : <DealResults m={m} onOpen={m.isDesktop ? setPreview : m.onOpen} />}
        </div>
      </div>
      <DealPreview m={m} deal={preview} onClose={() => setPreview(null)} />
    </div>
  );
};

export default SalesOptionB;
