import React from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { StatusPill, TaxBasisLabel } from '@/src/components/ui';
import { useProjectStatusLabel, useSalesStageLabel } from '@/src/hooks/useProjectStatusLabel';
import { formatCurrencyAuto, formatNumberExact } from '@/src/lib/format';
import { projectDisplayName } from '@/src/lib/projectDisplayName';
import type { PipelineProject } from '@/src/lib/db/dashboard';
import { ATTENTION_THRESHOLD_DAYS, daysSince, pillVariantForStatus, SALES_COLUMNS, formatPercent } from './salesPipeline';

interface SalesKanbanBoardProps {
  projects: PipelineProject[];
  onOpen: (project: PipelineProject) => void;
  presentation?: 'board' | 'list';
}

const ProjectIdentity: React.FC<{ project: PipelineProject; onOpen: () => void }> = ({ project, onOpen }) => {
  const displayName = projectDisplayName(project);

  return (
    <div className="min-w-0">
      <Link
        to={`/projects/${project.id}`}
        onClick={(event) => { event.preventDefault(); onOpen(); }}
        data-list-return-focus={`project-${project.id}`}
        className="block min-h-11 break-words text-sm font-normal text-foreground underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
      >
        {displayName}
      </Link>
    </div>
  );
};

const Activity: React.FC<{ project: PipelineProject }> = ({ project }) => {
  const { t } = useTranslation('sales');
  const days = daysSince(project.last_update);
  if (days === null) return <span className="text-foreground">{t('pipeline.activityUnavailable', 'Activity unavailable')}</span>;
  const label = days === 0
    ? t('pipeline.today', 'Today')
    : days === 1
      ? t('pipeline.oneDay', '1 day ago')
      : t('pipeline.daysAgo', '{{days}} days ago', { days });
  return (
    <span className={days >= ATTENTION_THRESHOLD_DAYS ? 'text-warning-foreground' : 'text-foreground'}>
      {label}
    </span>
  );
};

const Deal: React.FC<{ project: PipelineProject; onOpen: () => void; grouped: boolean; sharedMoney?: boolean }> = ({ project, onOpen, grouped, sharedMoney = false }) => {
  const { t } = useTranslation('sales');
  const statusLabel = useProjectStatusLabel();
  const stageLabel = useSalesStageLabel();
  const stage = SALES_COLUMNS.find((column) => !column.terminal && column.testId !== 'stage-Won' && column.statuses.includes(project.status));
  const customer = project.client_name || t('pipeline.customerUnavailable', 'Customer unavailable');
  const terminal = project.status === 'Loss Tender' || project.status === 'Declined';
  return (
    <article className="min-w-0 rounded-lg border border-border bg-card p-2">
      <h3 className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xl font-bold tabular"><span className="whitespace-nowrap">{sharedMoney ? formatNumberExact(project.contract_value) : formatCurrencyAuto(project.contract_value, project.currency)}</span>{!sharedMoney && <TaxBasisLabel treatment={project.tax_treatment} taxRate={project.tax_rate} taxBaseNumerator={project.tax_base_numerator} taxBaseDenominator={project.tax_base_denominator} showDetails={false} className="font-semibold" />}</h3>
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <ProjectIdentity project={project} onOpen={onOpen} />
        {(!grouped || terminal) && (
          <StatusPill variant={pillVariantForStatus(project.status)} className="text-xs font-semibold">{stage ? stageLabel(stage) : statusLabel(project.status)}</StatusPill>
        )}
      </div>
      <div className="mt-2 flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
        <span className="text-xs font-semibold text-muted-foreground">{t('pipeline.winProbability', 'Win probability')}: <span className="text-sm font-normal text-foreground tabular">{terminal ? t('pipeline.notApplicable', 'Not applicable') : formatPercent(project.win_probability)}</span></span>
      </div>
      <dl className="mt-2 grid w-fit max-w-full grid-cols-[max-content_minmax(0,1fr)] items-baseline gap-x-2 gap-y-1 text-sm">
        <dt className="text-xs font-semibold text-muted-foreground">{t('pipeline.lastActivity', 'Last activity')}</dt>
        <dd className="text-left text-foreground tabular"><Activity project={project} /></dd>
        <dt className="text-xs font-semibold text-muted-foreground">{t('pipeline.owner', 'Owner')}</dt>
        <dd className="break-words text-left text-foreground tabular">{project.pm_name || t('pipeline.ownerUnavailable', 'Owner unavailable')}</dd>
      </dl>
      {projectDisplayName(project) !== project.name && <p className="mt-2 break-words text-sm text-muted-foreground">{project.name}</p>}
      <p className="mt-2 break-words text-sm">{customer}</p>
      <details className="mt-2 text-sm">
        <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-xs font-semibold">
          {t('pipeline.references', 'Project references')} · {[project.pmo_project_number, project.code, project.end_client_name].filter(Boolean).length}
        </summary>
        <p className="break-words">{[project.pmo_project_number, project.code].filter(Boolean).join(' · ')}</p>
        {project.end_client_name && <p className="break-words">{project.end_client_name}</p>}
      </details>
    </article>
  );
};

const SalesKanbanBoard: React.FC<SalesKanbanBoardProps> = ({ projects, onOpen, presentation = 'board' }) => {
  const { t } = useTranslation('sales');
  const stageLabel = useSalesStageLabel();
  const openColumns = SALES_COLUMNS.filter((column) => !column.terminal && column.testId !== 'stage-Won');
  const renderProject = (project: PipelineProject, grouped: boolean, sharedMoney = false) => (
    <Deal key={project.id} project={project} onOpen={() => onOpen(project)} grouped={grouped} sharedMoney={sharedMoney} />
  );

  if (presentation === 'list') {
    return (
      <ul data-testid="sales-phone-stage-list" aria-label={t('pipeline.phoneList', 'Sales projects')} className="grid min-w-0 list-none gap-4 p-0">
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
      <div className="grid min-w-[64rem] grid-cols-5 items-start gap-4">
        {groups.map((group) => {
          const first = group.projects[0];
          const sharedMoney = !!first && group.projects.every((project) => project.currency === first.currency && project.tax_treatment === first.tax_treatment && project.tax_rate === first.tax_rate && project.tax_base_numerator === first.tax_base_numerator && project.tax_base_denominator === first.tax_base_denominator);
          return (
          <section key={group.key} data-testid={group.key} aria-label={`${group.name}, ${group.projects.length}`} className="min-w-0 py-2">
            <h2 className="mb-2 flex min-h-11 items-center justify-between gap-2 border-b border-border pb-2 text-xl font-bold leading-tight tracking-[-0.01em]">
              <span>{group.name}</span>
              <span className="tabular text-muted-foreground">{group.projects.length}</span>
            </h2>
            {sharedMoney && <p className="mb-2 flex flex-wrap items-center gap-2 text-xs font-semibold text-muted-foreground">{first.currency} <TaxBasisLabel treatment={first.tax_treatment} showDetails={false} className="font-semibold" /></p>}
            <ul className="grid min-w-0 list-none gap-4 p-0">
              {group.projects.length > 0
                ? group.projects.map((project) => <li key={project.id} className="min-w-0">{renderProject(project, !group.terminal, sharedMoney)}</li>)
                : <li className="px-1 py-2 text-sm text-muted-foreground">{t('pipeline.emptyStageGroup', 'No projects in {{stage}}', { stage: group.name })}</li>}
            </ul>
          </section>
        );})}
      </div>
    </div>
  );
};

export default SalesKanbanBoard;
