import React from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { StatusPill, TaxBasisLabel } from '@/src/components/ui';
import { useProjectStatusLabel, useSalesStageLabel } from '@/src/hooks/useProjectStatusLabel';
import { formatCurrencyAuto } from '@/src/lib/format';
import { projectDisplayName } from '@/src/lib/projectDisplayName';
import type { PipelineProject } from '@/src/lib/db/dashboard';
import { ATTENTION_THRESHOLD_DAYS, daysSince, pillVariantForStatus, SALES_COLUMNS, formatPercent } from './salesPipeline';

interface SalesKanbanBoardProps {
  projects: PipelineProject[];
  onOpen: (project: PipelineProject) => void;
  presentation?: 'board' | 'list';
}

const ProjectIdentity: React.FC<{ project: PipelineProject; onOpen: () => void; compact?: boolean }> = ({ project, onOpen, compact = false }) => {
  const { t } = useTranslation('sales');
  const displayName = projectDisplayName(project);
  const ids = [project.pmo_project_number, project.code].filter(Boolean).join(' · ');
  return (
    <div className="min-w-0">
      <Link
        to={`/projects/${project.id}`}
        onClick={(event) => { event.preventDefault(); onOpen(); }}
        data-list-return-focus={`project-${project.id}`}
        className="block min-h-11 break-words text-sm font-semibold text-foreground underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
      >
        {displayName}
      </Link>
      {displayName !== project.name && <p className="break-words text-sm text-muted-foreground">{project.name}</p>}
      {!compact && ids && <p className="break-words font-mono text-xs text-muted-foreground">{ids}</p>}
      {!compact && project.end_client_name && (
        <p className="break-words text-sm text-muted-foreground">
          {t('pipeline.endCustomerLine', 'for {{name}}', { name: project.end_client_name })}
        </p>
      )}
    </div>
  );
};

const Activity: React.FC<{ project: PipelineProject }> = ({ project }) => {
  const { t } = useTranslation('sales');
  const days = daysSince(project.last_update);
  if (days === null) return <span className="text-muted-foreground">{t('pipeline.activityUnavailable', 'Activity unavailable')}</span>;
  const label = days === 0
    ? t('pipeline.today', 'Today')
    : days === 1
      ? t('pipeline.oneDay', '1 day ago')
      : t('pipeline.daysAgo', '{{days}} days ago', { days });
  return (
    <span className={days >= ATTENTION_THRESHOLD_DAYS ? 'font-medium text-warning-foreground' : 'text-muted-foreground'}>
      {label}
    </span>
  );
};

const Deal: React.FC<{ project: PipelineProject; onOpen: () => void; grouped: boolean; compact?: boolean }> = ({ project, onOpen, grouped, compact = false }) => {
  const { t } = useTranslation('sales');
  const statusLabel = useProjectStatusLabel();
  const customer = project.client_name || t('pipeline.customerUnavailable', 'Customer unavailable');
  const terminal = project.status === 'Loss Tender' || project.status === 'Declined';
  return (
    <article className={`min-w-0 rounded-lg border border-border bg-card ${compact ? 'p-2' : 'p-3'}`}>
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <ProjectIdentity project={project} onOpen={onOpen} compact={compact} />
        {(!grouped || terminal) && (
          <StatusPill variant={pillVariantForStatus(project.status)}>{statusLabel(project.status)}</StatusPill>
        )}
      </div>
      <dl className={`mt-4 grid min-w-0 gap-x-4 gap-y-2 text-sm ${compact ? 'grid-cols-2' : 'grid-cols-1 sm:grid-cols-2'}`}>
        <div className={`min-w-0 ${compact ? 'col-span-2' : ''}`}>
          <dt className="text-xs font-semibold text-muted-foreground">{t('pipeline.customer', 'Customer')}</dt>
          <dd className="break-words">{customer}</dd>
        </div>
        {!compact && <div className="min-w-0">
          <dt className="text-xs font-semibold text-muted-foreground">{t('pipeline.owner', 'Owner')}</dt>
          <dd className="break-words">{project.pm_name || t('pipeline.ownerUnavailable', 'Owner unavailable')}</dd>
        </div>}
        {!compact && <div className="min-w-0">
          <dt className="text-xs font-semibold text-muted-foreground">{t('pipeline.lastActivity', 'Last activity')}</dt>
          <dd><Activity project={project} /></dd>
        </div>}
        <div className={`min-w-0 ${compact ? 'col-span-2' : 'sm:col-span-2'}`}>
          <dt className="text-xs font-semibold text-muted-foreground">{t('pipeline.value', 'Value')}</dt>
          <dd className="flex min-w-0 flex-wrap items-center gap-1 tabular">
            <span className="min-w-0 max-w-full break-words [overflow-wrap:anywhere]">{formatCurrencyAuto(project.contract_value, project.currency)}</span>
            <TaxBasisLabel treatment={project.tax_treatment} taxRate={project.tax_rate} taxBaseNumerator={project.tax_base_numerator} taxBaseDenominator={project.tax_base_denominator} showDetails={false} />
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs font-semibold text-muted-foreground">{t('pipeline.winProbability', 'Win probability')}</dt>
          <dd>{terminal ? t('pipeline.notApplicable', 'Not applicable') : formatPercent(project.win_probability)}</dd>
        </div>
      </dl>
    </article>
  );
};

const SalesKanbanBoard: React.FC<SalesKanbanBoardProps> = ({ projects, onOpen, presentation = 'board' }) => {
  const { t } = useTranslation('sales');
  const stageLabel = useSalesStageLabel();
  const openColumns = SALES_COLUMNS.filter((column) => !column.terminal && column.testId !== 'stage-Won');
  const renderProject = (project: PipelineProject, grouped: boolean) => (
    <Deal key={project.id} project={project} onOpen={() => onOpen(project)} grouped={grouped} compact={presentation === 'list'} />
  );

  if (presentation === 'list') {
    return (
      <ul data-testid="sales-phone-stage-list" aria-label={t('pipeline.phoneList', 'Sales projects')} className="grid min-w-0 list-none gap-3 p-0">
        {projects.map((project) => <li key={project.id} className="min-w-0">{renderProject(project, false)}</li>)}
      </ul>
    );
  }

  const groups = openColumns.map((column) => ({
    key: column.testId,
    name: stageLabel(column),
    projects: projects.filter((project) => column.statuses.includes(project.status)),
    terminal: false,
  }));
  const terminalProjects = projects.filter((project) => project.status === 'Loss Tender' || project.status === 'Declined');
  if (terminalProjects.length > 0) {
    groups.push({ key: 'stage-Lost', name: t('pipeline.lost', 'Lost'), projects: terminalProjects, terminal: true });
  }

  return (
    <div role="region" aria-label={t('pipeline.board', 'Sales pipeline board')} className="max-w-full min-w-0 overflow-x-auto pb-2">
      <div className="grid min-w-[64rem] grid-cols-5 items-start gap-3">
        {groups.map((group) => (
          <section key={group.key} data-testid={group.key} aria-label={`${group.name}, ${group.projects.length}`} className="min-w-0 border-l border-border px-3 py-2 first:border-l-0">
            <h2 className="mb-3 flex min-h-11 items-center justify-between gap-2 border-b border-border pb-2 text-xl font-bold leading-tight tracking-[-0.01em]">
              <span>{group.name}</span>
              <span className="tabular text-muted-foreground">{group.projects.length}</span>
            </h2>
            <ul className="grid min-w-0 list-none gap-3 p-0">
              {group.projects.length > 0
                ? group.projects.map((project) => <li key={project.id} className="min-w-0">{renderProject(project, !group.terminal)}</li>)
                : <li className="px-1 py-2 text-sm text-muted-foreground">{t('pipeline.emptyStageGroup', 'No projects in {{stage}}', { stage: group.name })}</li>}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
};

export default SalesKanbanBoard;
