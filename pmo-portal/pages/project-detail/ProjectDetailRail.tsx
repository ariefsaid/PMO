import React from 'react';
import { useTranslation } from 'react-i18next';
import { StatusPill } from '@/src/components/ui';
import { formatDate } from '@/src/lib/format';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import { pillVariantForProjectStatus } from '../../components/projects';
import ProjectStatusControl from '../../components/ProjectStatusControl';

export interface ProjectDetailRailProps {
  project: ProjectWithRefs;
  onEditProject?: () => void;
  showActionSection?: boolean;
}

const RailSectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
    {children}
  </div>
);

const DetailRow: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-3 py-3 text-sm">
    <dt className="text-muted-foreground">{label}</dt>
    <dd className="min-w-0 text-right font-medium text-foreground">{value}</dd>
  </div>
);

const ProjectDetailRail: React.FC<ProjectDetailRailProps> = ({ project, showActionSection = true }) => {
  const { t } = useTranslation();
  const notSet = t('projectDetail.rail.notSet', 'Not set');
  return (
    <aside
      data-testid="project-detail-rail"
      aria-label={t('projectDetail.rail.ariaLabel', 'Project details rail')}
      className="min-w-0 lg:sticky lg:top-4"
    >
      <div className="space-y-8 border-t border-border/70 pt-4 lg:border-t-0 lg:pt-0">
        {showActionSection && (
          <section aria-label={t('projectDetail.rail.actionsAriaLabel', 'Project rail actions')}>
            <RailSectionLabel>{t('projectDetail.rail.recordHeading', 'Record')}</RailSectionLabel>
            <div className="space-y-3">
              <p className="text-sm leading-6 text-muted-foreground">
                {t(
                  'projectDetail.rail.recordHelp',
                  'Move the project through its delivery stages from here. Edit stays in the header menu.',
                )}
              </p>
              <ProjectStatusControl
                project={project}
                triggerVariant="primary"
                triggerSize="sm"
              />
            </div>
          </section>
        )}

        <section aria-labelledby="project-details-heading">
          <RailSectionLabel>
            <span id="project-details-heading">{t('projectDetail.rail.detailsHeading', 'Details')}</span>
          </RailSectionLabel>
          <dl className="divide-y divide-border/70 border-y border-border/70">
            <DetailRow label={t('projectDetail.rail.customer', 'Customer')} value={project.client?.name ?? notSet} />
            <DetailRow
              label={t('projectDetail.rail.projectManager', 'Project manager')}
              value={project.pm?.full_name ?? t('projectDetail.rail.unassigned', 'Unassigned')}
            />
            <DetailRow
              label={t('projectDetail.rail.status', 'Status')}
              value={
                <span className="inline-flex justify-end">
                  <StatusPill variant={pillVariantForProjectStatus(project.status as never)}>
                    {project.status}
                  </StatusPill>
                </span>
              }
            />
            <DetailRow label={t('projectDetail.rail.start', 'Start')} value={formatDate(project.start_date)} />
            <DetailRow label={t('projectDetail.rail.targetEnd', 'Target end')} value={formatDate(project.end_date)} />
            <DetailRow
              label={t('projectDetail.rail.code', 'Code')}
              value={project.code ? <span className="font-mono text-[13px]">{project.code}</span> : notSet}
            />
            <DetailRow
              label={t('projectDetail.rail.customerPoRef', 'Customer PO ref')}
              value={
                project.customer_contract_ref ? (
                  <span className="font-mono text-[13px]">{project.customer_contract_ref}</span>
                ) : (
                  notSet
                )
              }
            />
          </dl>
        </section>
      </div>

    </aside>
  );
};

export default ProjectDetailRail;
