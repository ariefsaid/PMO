import React, { useMemo, useState } from 'react';
import { AccessDenied, Badge, ListState, StatusPill, Tooltip, ViewToggle } from '@/src/components/ui';
import { RowMenu } from '@/src/components/ui/RowMenu';
import { formatCurrency, formatRelativeTime } from '@/src/lib/format';
import type { PipelineProject } from '@/src/lib/db/dashboard';
import {
  SALES_COLUMNS, formatPercent, isNeedsAttention, isStaleBid, pillVariantForStatus, weightedValue,
} from '../../../components/salesPipeline';
import {
  DealPreview, DealResults, Figure, NewProjectButton, PhoneControls, PhoneFigures, SalesClassification, SalesExport,
  SalesScope, SalesSearch,
} from './SalesParts';
import type { SalesModel } from './useSalesModel';
import { attentionReason, dash, openValueTotal } from './salesLogic';

type CView = 'grouped' | 'kanban' | 'table';

/**
 * Option C, forecast-led: one hero figure with the stage mix drawn under it, then every stage as
 * a section with its own subtotal and compact deal lines. Board and table stay one click away.
 */
const SalesOptionC: React.FC<{ m: SalesModel }> = ({ m }) => {
  const { t } = m;
  const [preview, setPreview] = useState<PipelineProject | null>(null);
  const [cview, setCview] = useState<CView>('grouped');
  const groups = useMemo(
    () => SALES_COLUMNS.map((col) => ({
      col,
      rows: m.boardRows.filter((p) => col.statuses.includes(p.status) && (!m.selectedStatus || col.terminal || col.statuses.includes(m.selectedStatus))),
    })),
    [m.boardRows, m.selectedStatus],
  );
  if (!m.canViewSales) {
    return (
      <AccessDenied
        title={t('sales.accessDenied.title', "You don't have access to the Sales Pipeline")}
        sub={t('sales.accessDenied.sub', 'The Sales Pipeline is available to managers and finance. Your work lives on your dashboard, projects, and tasks.')}
        onBack={() => m.navigate('/')}
      />
    );
  }
  const ready = m.state === undefined;
  const { mixedPipeline, effectiveCurrency, stageProjections, totalWeighted } = m.funnel;
  const total = openValueTotal(m);
  const grouped = m.isDesktop && cview === 'grouped';
  const results = grouped ? null : <DealResults m={m} view={m.isDesktop ? (cview === 'table' ? 'table' : 'kanban') : undefined} onOpen={m.isDesktop ? setPreview : m.onOpen} />;
  return (
    <div className="min-w-0">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-xl font-semibold text-foreground">{t('shell.nav.sales', 'Sales Pipeline')}</h1>
        <NewProjectButton m={m} />
      </div>
      <PhoneFigures m={m} />
      {ready && m.isDesktop && (
        <section aria-label={t('sales.summaryLabel', 'Pipeline summary')} className="panel-card mb-4 p-[var(--panel-inset)]">
          <div className="flex flex-wrap items-end gap-x-10 gap-y-3">
            <Figure lead label={t('sales:options.weightedForecast', 'Weighted forecast')} testId="pipeline-weighted-total"
              value={mixedPipeline ? dash : formatCurrency(totalWeighted, effectiveCurrency)}
              note={total === null ? t('sales:pipeline.mixedCurrency', 'Mixed currencies, so no single total')
                : t('sales:options.ofOpen', 'of {{value}} open across {{n}} projects', { value: formatCurrency(total, effectiveCurrency), count: m.openProjects.length })} />
            <Figure label={t('sales:options.outcomes', 'Won · Lost')} value={`${m.won.length} · ${m.lost.length}`} onClick={() => m.setScope('Won')} />
          </div>
          {!mixedPipeline && totalWeighted > 0 && (
            <div className="mt-4">
              <div className="flex h-2 w-full overflow-hidden rounded-full bg-secondary" role="img"
                aria-label={t('sales:options.mixAria', 'Weighted forecast by stage')}>
                {stageProjections.map((p, i) => (
                  <span key={p.status} style={{ width: `${(p.weightedValue / totalWeighted) * 100}%`, opacity: 0.35 + i * 0.16 }} className="h-full bg-primary" />
                ))}
              </div>
              <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
                {stageProjections.map((p) => (
                  <li key={p.status}>
                    <button type="button" aria-pressed={m.selectedStatus === p.status} onClick={() => m.selectStage(p.status as never)}
                      className="rounded text-xs text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring aria-pressed:font-semibold aria-pressed:text-foreground">
                      {m.stageLabel(p.col)} <span className="tabular">{p.mixedStage ? dash : formatCurrency(p.weightedValue, p.stageCurrency)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
      {m.state !== 'loading' && (m.isDesktop ? (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <SalesScope m={m} />
          <SalesSearch m={m} />
          <SalesClassification m={m} />
          <div className="ml-auto flex items-center gap-3">
            <SalesExport m={m} />
            <ViewToggle<CView>
              options={[
                { value: 'grouped', label: t('sales:options.viewByStage', 'By stage'), icon: 'funnel' },
                { value: 'kanban', label: t('sales.view.board', 'Board'), icon: 'cards' },
                { value: 'table', label: t('sales.view.table', 'Table'), icon: 'table' },
              ]}
              value={cview}
              onChange={(v) => { setCview(v); if (v !== 'grouped') m.setView(v); }}
              ariaLabel={t('sales.viewToggleLabel', 'Pipeline view')}
            />
          </div>
        </div>
      ) : <div className="mb-4"><PhoneControls m={m} /></div>)}
      {m.state === 'loading' ? <ListState variant="loading" rows={6} /> : grouped ? (
        m.state !== undefined ? <DealResults m={m} /> : (
          <div className="space-y-3">
            {groups.filter(({ col, rows }) => rows.length > 0 || !col.terminal).map(({ col, rows }) => {
              const sumBy = new Set(rows.map((r) => r.currency));
              const single = sumBy.size === 1 ? [...sumBy][0] : null;
              return (
                <details key={col.testId} open={!col.terminal} data-testid={col.testId} className="panel-card">
                  <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-4 gap-y-1 p-[var(--space-content-inset)] text-sm">
                    <span aria-hidden className="size-2 shrink-0 self-center rounded-full" style={{ background: col.dotColor }} />
                    <span className="font-semibold text-foreground">{m.stageLabel(col)}</span>
                    <span className="tabular text-muted-foreground">{rows.length}</span>
                    <span className="tabular text-muted-foreground">
                      {single ? formatCurrency(rows.reduce((s, r) => s + r.contract_value, 0), single) : sumBy.size === 0 ? dash : dash}
                    </span>
                    {!col.terminal && single && (
                      <span className="tabular text-muted-foreground">
                        {t('sales.funnel.weighted', '{{value}} weighted', { value: formatCurrency(rows.reduce((s, r) => s + weightedValue(r), 0), single) })}
                      </span>
                    )}
                  </summary>
                  {rows.length === 0 ? (
                    <p className="px-[var(--space-content-inset)] pb-3 text-sm text-muted-foreground">{t('projects.kanban.empty', { defaultValue: 'No projects in {{stage}}', stage: m.stageLabel(col) })}</p>
                  ) : (
                    <ul className="divide-y divide-border border-t border-border">
                      {rows.map((p) => (
                        <li key={p.id} className="flex min-w-0 items-center gap-3 px-[var(--space-content-inset)] py-2">
                          <button type="button" onClick={() => setPreview(p)} className="min-w-0 flex-1 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
                            <span className="block truncate text-sm font-medium text-foreground">{p.name}</span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {p.client_name ?? dash}{p.end_client_name ? ` · ${t('sales:pipeline.endCustomerLine', 'for {{name}}', { name: p.end_client_name })}` : ''}
                            </span>
                          </button>
                          {(isNeedsAttention(p) || isStaleBid(p)) && !col.terminal && (
                            <Tooltip content={attentionReason(m, p)}><Badge tabIndex={0} role="status">{t('sales.scope.needsAttention', 'Needs attention')}</Badge></Tooltip>
                          )}
                          {!col.terminal && (
                            <span className="hidden gap-1 lg:flex">
                              <Badge>{t('sales:goShort', 'Go')} {formatPercent(p.go_probability ?? p.win_probability)}</Badge>
                              <Badge>{t('sales:getShort', 'Get')} {formatPercent(p.get_probability ?? 1)}</Badge>
                            </span>
                          )}
                          <span className="hidden w-28 truncate text-xs text-muted-foreground xl:block">{p.pm_name ?? dash}</span>
                          <span className="hidden w-24 text-right text-xs text-muted-foreground xl:block">{p.last_update ? formatRelativeTime(p.last_update) : dash}</span>
                          <span className="w-36 text-right text-sm font-semibold tabular text-foreground">{formatCurrency(p.contract_value, p.currency)}</span>
                          <StatusPill variant={pillVariantForStatus(p.status)} className="hidden 2xl:inline-flex">{m.stageName(p.status)}</StatusPill>
                          <RowMenu
                            ariaLabel={`${p.name}`}
                            items={[
                              { label: t('sales:options.openDeal', 'Open deal'), onClick: () => m.onOpen(p) },
                              { label: t('sales:options.quickView', 'Quick view'), onClick: () => setPreview(p) },
                            ]}
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </details>
              );
            })}
          </div>
        )
      ) : results}
      <DealPreview m={m} deal={preview} onClose={() => setPreview(null)} />
    </div>
  );
};

export default SalesOptionC;
