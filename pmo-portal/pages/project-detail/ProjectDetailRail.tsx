import { companyDisplayName } from '@/src/lib/companyDisplayName';
import React from 'react';
import { projectDisplayName } from '@/src/lib/projectDisplayName';
import { useTranslation } from 'react-i18next';
import { formatDateOnly } from '@/src/lib/format';
import { Icon } from '@/src/components/ui';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import ProjectStatusControl from '../../components/ProjectStatusControl';
import { ProjectErpLink } from './ProjectErpLink';
import { classificationValueLabel } from '@/src/lib/projectClassification';

export interface ProjectDetailRailProps {
  project: ProjectWithRefs;
  showActionSection?: boolean;
  /** Disclosure label; defaults to the legacy "Project details and actions". */
  summaryLabel?: string;
  /** Quiet variant: a small muted disclosure with no rule above it. */
  quiet?: boolean;
  /** Render only the existing detail rows for the header menu; no second disclosure or actions. */
  detailsOnly?: boolean;
}

const RailSectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h2 className="mb-3 text-xs font-semibold text-muted-foreground">
    {children}
  </h2>
);

const DetailRow: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-3 py-3 text-sm">
    <dt className="text-muted-foreground">{label}</dt>
    <dd className="min-w-0 break-words text-right font-medium text-foreground">{value}</dd>
  </div>
);

const ProjectClassificationRows: React.FC<{ project: ProjectWithRefs }> = ({ project }) => {
  const { t } = useTranslation('project');
  return (
    <>
      {project.service_line && <DetailRow label={t('projectClassification.serviceLine', 'Service line')} value={project.service_line} />}
      {project.sector && <DetailRow label={t('projectClassification.sector', 'Sector')} value={project.sector} />}
      {project.location && <DetailRow label={t('projectClassification.location', 'Location')} value={project.location} />}
      {project.award_type && <DetailRow label={t('projectClassification.awardType', 'Award type')} value={classificationValueLabel(t, project.award_type)} />}
      {project.bidding_entity && <DetailRow label={t('projectClassification.biddingEntity', 'Bidding entity')} value={classificationValueLabel(t, project.bidding_entity)} />}
    </>
  );
};

const ProjectDetailRail: React.FC<ProjectDetailRailProps> = ({ project, showActionSection = true, summaryLabel, quiet = false, detailsOnly = false }) => {
  const { t } = useTranslation('project');
  const notSet = t('projectDetail.rail.notSet', 'Not set');
  const detailSection = (
    <section aria-labelledby="project-details-heading">
      <RailSectionLabel>
        <span id="project-details-heading">{t('projectDetail.rail.detailsHeading', 'Details')}</span>
      </RailSectionLabel>
      <dl className="divide-y divide-border/70">
        {/* #1325: the header leads with the short name; the contractual name is readable here without hovering. */}
        {projectDisplayName(project) !== project.name && (
          <DetailRow label={t('projects:shortName.contractName', 'Contract name')} value={project.name} />
        )}
        <DetailRow label={t('projectDetail.rail.customer', 'Customer')} value={project.client ? companyDisplayName(project.client) : notSet} />
        {/* #758: the end customer shows ONLY when set — an optional value, so an unset one
            is omitted rather than rendered as "Not set". */}
        {project.end_client && (
          <DetailRow
            label={t('projectDetail.rail.endCustomer', 'End customer')}
            value={companyDisplayName(project.end_client)}
          />
        )}
        <DetailRow
          label={t('projectDetail.rail.projectManager', 'Project manager')}
          value={project.pm?.full_name ?? t('projectDetail.rail.unassigned', 'Unassigned')}
        />
        <ProjectClassificationRows project={project} />
        <DetailRow label={t('projectDetail.rail.start', 'Start')} value={formatDateOnly(project.start_date)} />
        <DetailRow label={t('projectDetail.rail.targetEnd', 'Target end')} value={formatDateOnly(project.end_date)} />
        {project.contract_date && <DetailRow label={t('projectDetail.rail.contractDate', 'Contract date')} value={formatDateOnly(project.contract_date)} />}
        <DetailRow
          label={t('projectDetail.rail.pmoNumber', 'PMO Project Number')}
          value={<span className="font-mono text-[13px]">{project.pmo_project_number}</span>}
        />
        <DetailRow
          label={t('projectDetail.rail.clientCode', 'Client Project Code')}
          value={project.code ? <span className="font-mono text-[13px]">{project.code}</span> : notSet}
        />
        <DetailRow
          label={t('projectDetail.rail.customerPoRef', 'Customer PO ref')}
          value={project.customer_contract_ref ? <span className="font-mono text-[13px]">{project.customer_contract_ref}</span> : notSet}
        />
      </dl>
    </section>
  );
  if (detailsOnly) {
    return (
      <aside data-testid="project-detail-rail" aria-label={t('projectDetail.rail.ariaLabel', 'Project details rail')} className="min-w-0">
        {detailSection}
      </aside>
    );
  }
  return (
    <aside
      data-testid="project-detail-rail"
      aria-label={t('projectDetail.rail.ariaLabel', 'Project details rail')}
      className={quiet ? 'min-w-0' : 'min-w-0 border-t border-border/70 pt-3'}
    >
      <details>
        <summary className={quiet ? 'touch-target inline-flex cursor-pointer list-none items-center gap-1 rounded-sm py-1 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden' : 'touch-target cursor-pointer rounded-sm py-2 text-sm font-semibold text-foreground'}>
          {summaryLabel ?? t('uxs13.projectDetailsAndActions', 'Project details and actions')}
          {quiet && <Icon name="chev" className="size-3 rotate-90 [details[open]_&]:-rotate-90" aria-hidden="true" />}
        </summary>
        <div className="space-y-8 pt-3">
        {showActionSection && (
          <section aria-label={t('projectDetail.rail.actionsAriaLabel', 'Project rail actions')}>
            <RailSectionLabel>{t('projectDetail.rail.recordHeading', 'Record')}</RailSectionLabel>
            <div className="space-y-3">
              <ProjectStatusControl
                project={project}
                triggerVariant="primary"
                triggerSize="sm"
              />
            </div>
          </section>
        )}

        {detailSection}
        <ProjectErpLink projectId={project.id} managerId={project.project_manager_id ?? null} />
        </div>
      </details>
    </aside>
  );
};

export default ProjectDetailRail;
