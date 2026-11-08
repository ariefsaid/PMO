import React from 'react';
import ProjectClassificationFilters from '../../components/ProjectClassificationFilters';
import { ExportButton } from '@/src/components/export';
import {
  Button, Drawer, Icon, LifecycleStepper, SearchMini, StatusPill, TaxBasisLabel, ViewToggle,
} from '@/src/components/ui';
import { formatCurrency, formatRelativeTime } from '@/src/lib/format';
import type { PipelineProject } from '@/src/lib/db/dashboard';
import {
  dealJourneySteps, formatPercent, isNeedsAttention, isStaleBid, pillVariantForStatus, weightedValue,
} from '../../components/salesPipeline';
import { PipelineResults } from '../sales-pipeline/PipelineResults';
import type { PipelineView } from '@/src/hooks/usePipelineView';
import type { SalesModel } from './useSalesModel';
import { useStageJourneyStepLabel } from './useDealActions';
import { attentionReason, dash, openValueTotal } from './salesLogic';

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
  <div className="max-w-full overflow-x-auto scroll-fade-x">
    <ViewToggle
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
  <label className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground">
    <span className="shrink-0">{t('uxs24.stageLabel', 'Pipeline stage')}</span>
    <select
      data-testid="sales-phone-stage-selector"
      aria-label={t('uxs24.stageLabel', 'Pipeline stage')}
      value={m.selectedStatus ?? ''}
      onChange={(e) => {
        const status = e.currentTarget.value as '' | NonNullable<SalesModel['selectedStatus']>;
        m.setWorkingSet((ws) => ({ ...ws, scope: 'Open', status }));
      }}
      className="min-h-11 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <option value="">{t('uxs24.allStages', 'All stages')}</option>
      {m.funnel.openColumns.map((c) => (
        <option key={c.statuses[0]} value={c.statuses[0]}>{m.stageLabel(c)}</option>
      ))}
    </select>
  </label>
);

/** Phone controls: stage selector, scope, search, classification. */
export const PhoneControls: React.FC<{ m: SalesModel; stage?: boolean; scope?: boolean; search?: boolean }> = ({ m, stage = true, scope = true, search = true }) => (
  <div className="w-full min-w-0 space-y-2">
    {stage && m.scope !== 'Lost' && m.scope !== 'Won' && <PhoneStageSelect m={m} />}
    {scope && <SalesScope m={m} />}
    {search && <SalesSearch m={m} className="min-w-0! flex-1" />}
    <SalesClassification m={m} inline />
  </div>
);

/** Phone: the figures that lead on desktop, as one compact row. */
export const PhoneFigures: React.FC<{ m: SalesModel }> = ({ m, m: { t } }) => {
  if (m.isDesktop || m.state !== undefined) return null;
  const total = openValueTotal(m);
  const cur = m.funnel.effectiveCurrency;
  return (
    <section aria-label={t('sales:options.figuresLabel', 'Pipeline figures')} className="panel-card mb-4 grid grid-cols-2 gap-4 p-[var(--panel-inset)]">
      <Figure label={t('sales:options.weightedForecast', 'Weighted forecast')} value={total === null ? dash : formatCurrency(m.funnel.totalWeighted, cur)} />
      <Figure label={t('sales:options.openValue', 'Open value')} value={total === null ? dash : formatCurrency(total, cur)}
        note={t('sales:options.openCount', '{{n}} open projects', { n: m.openProjects.length })} />
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

/** A figure with its meaning beside it: the answer first and largest. */
export const Figure: React.FC<{ label: React.ReactNode; value: React.ReactNode; note?: React.ReactNode; lead?: boolean; onClick?: () => void; testId?: string }> = ({ label, value, note, lead, onClick, testId }) => {
  const body = (
    <>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span data-testid={testId} className={`tabular font-semibold text-foreground ${lead ? 'text-3xl leading-tight' : 'text-xl leading-snug'}`}>{value}</span>
      {note && <span className="text-xs text-muted-foreground">{note}</span>}
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className="flex min-w-0 flex-col items-start gap-0.5 rounded-md text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring hover:bg-secondary/50">{body}</button>
  ) : (
    <div className="flex min-w-0 flex-col items-start gap-0.5">{body}</div>
  );
};

/** Quick-view of one deal: read first, one filled action to open the record. */
export const DealPreview: React.FC<{ m: SalesModel; deal: PipelineProject | null; onClose: () => void }> = ({ m, deal, onClose }) => {
  const { t } = m;
  const journeyStepLabel = useStageJourneyStepLabel();
  return (
    <Drawer
      open={deal !== null}
      onClose={onClose}
      title={deal?.name ?? ''}
      status={deal ? <StatusPill variant={pillVariantForStatus(deal.status)}>{m.stageName(deal.status)}</StatusPill> : undefined}
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
            <div><dt className="text-xs text-muted-foreground">{t('projectDetail.pipeline.stat.value', 'Value')}</dt>
              <dd className="tabular text-base font-semibold">{formatCurrency(deal.contract_value, deal.currency)}</dd>
              <dd className="text-xs text-muted-foreground"><TaxBasisLabel treatment={deal.tax_treatment} taxRate={deal.tax_rate} taxBaseNumerator={deal.tax_base_numerator} taxBaseDenominator={deal.tax_base_denominator} /></dd></div>
            <div><dt className="text-xs text-muted-foreground">{t('projectDetail.pipeline.stat.weighted', 'Weighted')}</dt>
              <dd className="tabular text-base font-semibold">{formatCurrency(weightedValue(deal), deal.currency)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">{t('sales:goProbability', '% Go')}</dt>
              <dd className="tabular">{formatPercent(deal.go_probability ?? deal.win_probability)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">{t('sales:getProbability', '% Get')}</dt>
              <dd className="tabular">{formatPercent(deal.get_probability ?? 1)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">{t('projectDetail.pipeline.stat.owner', 'Owner')}</dt>
              <dd>{deal.pm_name ?? t('projectDetail.pipeline.notSet', 'Not set')}</dd></div>
            <div><dt className="text-xs text-muted-foreground">{t('sales:options.lastUpdate', 'Last update')}</dt>
              <dd>{deal.last_update ? formatRelativeTime(deal.last_update) : dash}</dd></div>
          </dl>
          {(isNeedsAttention(deal) || isStaleBid(deal)) && (
            <p role="status" className="text-sm text-foreground">{attentionReason(m, deal)}</p>
          )}
          <LifecycleStepper variant="bar" steps={dealJourneySteps(deal.status, journeyStepLabel)} aria-label={t('projectDetail.pipeline.journeyAriaLabel', 'Project stage journey')} className="[&_span]:text-xs" />
        </div>
      )}
    </Drawer>
  );
};
