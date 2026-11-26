import React from 'react';
import ProjectClassificationFilters from '../../components/ProjectClassificationFilters';
import { ExportButton } from '@/src/components/export';
import {
  Button, SelectField, Combobox, Drawer, FigureHiddenLine, FigureScope, Icon, LifecycleStepper, SearchMini, StatTiles, StatusPill, TaxBasisLabel, ViewToggle,
} from '@/src/components/ui';
import { formatCurrency, formatDay } from '@/src/lib/format';
import type { PipelineProject } from '@/src/lib/db/dashboard';
import {
  dealJourneySteps, formatPercent, daysSince, daysSinceLatestTouch, isNeedsAttention, isStaleBid, weightedValue,
} from '../../components/salesPipeline';
import { PipelineResults } from '../sales-pipeline/PipelineResults';
import type { PipelineView } from '@/src/hooks/usePipelineView';
import type { SalesModel } from './useSalesModel';
import { useStageJourneyStepLabel } from './useDealActions';
import { attentionDeals, attentionReason, dash, pipelineFigures, type FigureLines } from './salesLogic';

export const SalesSearch: React.FC<{ m: SalesModel; className?: string }> = ({ m, m: { t }, className }) => (
  <SearchMini
    placeholder={t('sales.search.placeholder', 'Search projects…')}
    aria-label={t('sales.search.label', 'Search projects')}
    value={m.search}
    onChange={(e) => m.setSearch(e.target.value)}
    containerClassName={className ?? 'max-sm:basis-full max-sm:w-full max-sm:min-w-0'}
  />
);

export const SalesClassification: React.FC<{ m: SalesModel; inline?: boolean }> = ({ m, inline }) =>
  m.hasClassification ? (
    <ProjectClassificationFilters
      rows={m.allDeals}
      value={m.workingSet}
      onChange={(patch) => m.setWorkingSet((ws) => ({ ...ws, ...patch }))}
      resetToken={m.classificationResetToken}
      inlineTrigger={inline}
    />
  ) : null;

export const SalesScope: React.FC<{ m: SalesModel }> = ({ m, m: { t } }) => (
  <div className="max-w-full overflow-x-auto [&_button]:shrink-0 [&_button]:whitespace-nowrap">
    <ViewToggle
      className="w-max"
      options={m.DEAL_SCOPES.map((s) => ({ value: s, label: m.scopeLabels[s] }))}
      value={m.scope}
      onChange={m.setScope}
      ariaLabel={t('sales.scopeToggleLabel', 'Project scope')}
    />
  </div>
);

export const SalesExport: React.FC<{ m: SalesModel }> = ({ m }) => (
  <ExportButton
    rows={m.isDesktop && m.view === 'kanban' ? m.boardRows : m.filtered}
    columns={m.exportColumns}
    entity="Pipeline"
  />
);

export const SalesViewToggle: React.FC<{ m: SalesModel; extra?: React.ComponentProps<typeof ViewToggle>['options'] }> = ({ m, m: { t } }) => (
  <ViewToggle
    options={[
      { value: 'kanban', label: t('sales.view.board', 'Board'), icon: 'cards' },
      { value: 'table', label: t('sales.view.table', 'Table'), icon: 'table' },
    ]}
    value={m.view}
    onChange={(v: PipelineView) => m.setView(v)}
    ariaLabel={t('sales.viewToggleLabel', 'Pipeline view')}
  />
);

export const NewProjectButton: React.FC<{ m: SalesModel }> = ({ m, m: { t } }) =>
  m.canCreate ? (
    <Button variant="primary" onClick={() => m.openRecord('/projects/new', 'projects')}>
      <Icon name="plus" />
      {t('sales.newProject', 'New project')}
    </Button>
  ) : null;

/** Phone: one stage selector over the stage list (same control the default page offers). */
export const PhoneStageSelect: React.FC<{ m: SalesModel }> = ({ m, m: { t } }) => (
  <Combobox
    label={t('uxs24.stageLabel', 'Pipeline stage')}
    value={m.selectedStatus ?? ''}
    selectedOption={{ value: m.selectedStatus ?? '', label: m.selectedStatus ? m.stageLabel(m.funnel.openColumns.find((c) => c.statuses.includes(m.selectedStatus!))!) : t('uxs24.allStages', 'All stages') }}
    loadOptions={async () => [{ value: '', label: t('uxs24.allStages', 'All stages') }, ...m.funnel.openColumns.map((c) => ({ value: c.statuses[0], label: m.stageLabel(c) }))]}
    onChange={(value) => m.setWorkingSet((ws) => ({ ...ws, scope: 'Open', status: value as '' | NonNullable<SalesModel['selectedStatus']> }))}
  />
);

/** Phone controls: stage selector, scope, search, classification. */
export const PhoneControls: React.FC<{ m: SalesModel; stage?: boolean; scope?: boolean; search?: boolean }> = ({ m, stage = true, scope = true, search = true }) => (
  <div className="grid w-full min-w-0 grid-cols-2 gap-2">
    {stage && m.scope !== 'Lost' && m.scope !== 'Won' && <PhoneStageSelect m={m} />}
    {scope && <SelectField label={m.t("sales.scopeToggleLabel", "Project scope")} value={m.scope} options={m.DEAL_SCOPES.map(value => ({ value, label: m.scopeLabels[value] }))} onChange={value => m.setScope(value as typeof m.scope)} />}
    {search && <SalesSearch m={m} className="col-span-2 min-w-0!" />}
    <div className="col-span-2"><SalesClassification m={m} inline /></div>
  </div>
);

/** Phone: the two money figures as one compact row (a second line per other currency; a hidden figure gets one line). */
export const PhoneFigures: React.FC<{ m: SalesModel }> = ({ m, m: { t } }) => {
  if (m.isDesktop || m.state !== undefined) return null;
  const pf = pipelineFigures(m);
  const unavailable = t('sales:funnel.unavailable', 'Not available');
  const view = (f: FigureLines) => (
    <span className="inline-flex flex-col">
      {f.lines.map((line, i) => <span key={line} className={i === 0 ? undefined : 'text-control font-normal text-muted-foreground'}>{line}</span>)}
    </span>
  );
  return (
    <FigureScope>
      <section aria-label={t('sales:options.figuresLabel', 'Pipeline figures')} className="panel-card mb-4 p-[var(--panel-inset)]">
        <StatTiles
          variant="bare"
          tiles={[
            { label: t('sales:options.weightedForecast', 'Weighted forecast'), value: pf.weighted === null ? null : view(pf.weighted), exactValue: pf.weighted?.exact[0], unavailableReason: pf.weighted === null ? unavailable : undefined },
            { label: t('sales:options.openValue', 'Open value'), value: view(pf.open), exactValue: pf.open.exact[0],
              sub: t('sales:options.openCount', '{{n}} open projects', { n: m.openProjects.length }) },
          ]}
        />
        <FigureHiddenLine className="mt-2 text-control text-muted-foreground" />
      </section>
    </FigureScope>
  );
};

/** Desktop: what waits on the person: stale deals as rows that open the deal, then the decided counts. */
export const NeedsAttentionCard: React.FC<{ m: SalesModel; onOpen: (p: PipelineProject) => void; compact?: boolean }> = ({ m, onOpen, compact = false, m: { t } }) => {
  const deals = attentionDeals(m);
  const shown = deals.slice(0, 5);
  return (
    <section aria-label={t('sales:options.needsYou', 'Needs attention')} className={compact ? "panel-card flex flex-wrap items-center gap-x-6 gap-y-2 px-[var(--panel-inset)] py-3" : "panel-card p-[var(--panel-inset)]"}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-group font-semibold">{t('sales:options.needsYouHeading', 'Needs you · {{n}}', { n: deals.length })}</h2>
        {deals.length > shown.length && (
          <button type="button" className="text-control font-medium text-primary-text hover:underline" onClick={() => m.setScope('Needs attention')}>
            {t('sales:options.showAllAttention', 'Show all {{n}}', { n: deals.length })}
          </button>
        )}
      </div>
      {shown.length === 0 ? (
        <p className="text-control text-muted-foreground">{t('sales:options.nothingStale', 'Nothing is stale')}</p>
      ) : (
        <ul className="divide-y divide-border">
          {shown.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => onOpen(p)} className="flex min-h-11 w-full min-w-0 flex-col items-start justify-center rounded-md py-1.5 text-left hover:bg-secondary/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
                <span className="w-full truncate text-control font-semibold text-foreground">{p.name}</span>
                <span className="w-full truncate text-control text-warning-foreground">{compact && !m.isDesktop
                  ? (isStaleBid(p)
                    ? t('sales:options.staleReasonShort', 'Stage {{days}}d', { days: daysSince(p.stage_started_at) ?? dash })
                    : t('sales:options.idleReasonShort', 'Idle {{days}}d', { days: daysSinceLatestTouch(p) ?? dash }))
                  : attentionReason(m, p)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className={`${compact ? 'mt-2 flex gap-4 border-t border-border pt-2' : 'mt-2 grid grid-cols-1 divide-y divide-border/70 border-t border-border pt-2'} text-control`}>
        <button type="button" className={`font-medium text-primary-text hover:underline ${compact ? '' : 'flex min-h-8 items-center text-left'}`} onClick={() => m.setScope('Won')}>
          {compact && !m.isDesktop ? t('sales:options.wonCountShort', 'Won {{n}}', { n: m.wonState === 'ready' ? m.won.length : dash }) : t('sales:options.wonCount', 'Won {{n}} all time', { n: m.wonState === 'ready' ? m.won.length : dash })}
        </button>
        <button type="button" className={`font-medium text-primary-text hover:underline ${compact ? '' : 'flex min-h-8 items-center text-left'}`} onClick={() => m.setScope('Lost')}>
          {compact && !m.isDesktop ? t('sales:options.lostCountShort', 'Lost {{n}}', { n: m.lostState === 'ready' ? m.lost.length : dash }) : t('sales:options.lostCount', 'Lost {{n}} all time', { n: m.lostState === 'ready' ? m.lost.length : dash })}
        </button>
      </div>
    </section>
  );
};

/** The deals body: board / table / phone stage list, with every state (the default page's component). */
export const DealResults: React.FC<{ m: SalesModel; view?: PipelineView; onOpen?: (p: PipelineProject) => void }> = ({ m, view, onOpen }) => (
  <PipelineResults
    state={m.state}
    view={view ?? m.view}
    isDesktop={m.isDesktop}
    scope={m.scope}
    scopeCount={m.scopeRows.length}
    filtered={m.filtered}
    kanbanFiltered={m.boardRows}
    tableColumns={m.tableColumns}
    onOpen={onOpen ?? m.onOpen}
    stageIndex={m.stageIndex}
    selectedStatus={m.selectedStatus}
    wonPending={m.wonState === 'pending'}
    lostPending={m.lostState === 'pending'}
    wonError={m.wonQ.isError}
    lostError={m.lostQ.isError}
    refetchPipeline={m.open.refetch}
    refetchWon={m.wonQ.refetch}
    refetchLost={m.lostQ.refetch}
    clearFilters={m.clearFilters}
    filtersActive={m.filtersActive}
    narrowedWithinScope={m.narrowedWithinScope}
    classificationsActive={m.classificationsActive}
    search={m.search}
  />
);

/** Quick-view of one deal: read first, one filled action to open the record. */
export const DealPreview: React.FC<{ m: SalesModel; deal: PipelineProject | null; onClose: () => void }> = ({ m, deal, onClose }) => {
  const { t } = m;
  const journeyStepLabel = useStageJourneyStepLabel();
  return (
    <Drawer
      open={deal !== null}
      onClose={onClose}
      title={deal?.name ?? ''}
      status={deal ? <StatusPill record="project" state={deal.status} /> : undefined}
      footer={deal ? (
        <Button variant="primary" onClick={() => { const d = deal; onClose(); m.onOpen(d); }}>
          {t('sales:options.openDeal', 'Open deal')}
        </Button>
      ) : undefined}
    >
      {deal && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {deal.client_name ?? dash}
            {deal.end_client_name && <> · {t('sales:pipeline.endCustomerLine', 'for {{name}}', { name: deal.end_client_name })}</>}
          </p>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div><dt className="text-control text-muted-foreground">{t('projectDetail.pipeline.stat.value', 'Value')}</dt>
              <dd className="tabular text-base font-semibold">{deal.contract_value == null ? dash : formatCurrency(deal.contract_value, deal.currency)}</dd>
              <dd className="text-control text-muted-foreground"><TaxBasisLabel treatment={deal.tax_treatment} taxRate={deal.tax_rate} taxBaseNumerator={deal.tax_base_numerator} taxBaseDenominator={deal.tax_base_denominator} /></dd></div>
            <div><dt className="text-control text-muted-foreground">{t('projectDetail.pipeline.stat.weighted', 'Weighted')}</dt>
              <dd className="tabular text-base font-semibold">{deal.contract_value == null || (deal.go_probability ?? deal.win_probability) == null ? dash : formatCurrency(weightedValue(deal), deal.currency)}</dd></div>
            <div><dt className="text-control text-muted-foreground">{t('sales:goProbability', '% Go')}</dt>
              <dd className="tabular">{formatPercent(deal.go_probability ?? deal.win_probability)}</dd></div>
            <div><dt className="text-control text-muted-foreground">{t('sales:getProbability', '% Get')}</dt>
              <dd className="tabular">{formatPercent(deal.get_probability ?? 1)}</dd></div>
            <div><dt className="text-control text-muted-foreground">{t('projectDetail.pipeline.stat.owner', 'Owner')}</dt>
              <dd>{deal.pm_name ?? t('projectDetail.pipeline.notSet', 'Not set')}</dd></div>
            <div><dt className="text-control text-muted-foreground">{t('sales:options.lastUpdate', 'Last update')}</dt>
              <dd>{deal.last_update ? formatDay(deal.last_update) : dash}</dd></div>
          </dl>
          {(isNeedsAttention(deal) || isStaleBid(deal)) && (
            <p role="status" className="text-sm text-foreground">{attentionReason(m, deal)}</p>
          )}
          <LifecycleStepper variant="bar" steps={dealJourneySteps(deal.status, journeyStepLabel)} aria-label={t('projectDetail.pipeline.journeyAriaLabel', 'Project stage journey')} className="[&_span]:text-control" />
        </div>
      )}
    </Drawer>
  );
};
