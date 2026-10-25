import { companyDisplayName } from '@/src/lib/companyDisplayName';
import React from 'react';
import { projectDisplayName } from '@/src/lib/projectDisplayName';
import { useTranslation } from 'react-i18next';
import { formatDateOnly } from '@/src/lib/format';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import { ProjectErpLink } from './ProjectErpLink';
import { classificationValueLabel } from '@/src/lib/projectClassification';

export interface ProjectDetailRailProps {
  project: ProjectWithRefs;
}

const RailSectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
    {children}
  </div>
);

const DetailRow: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="grid max-w-lg grid-cols-[max-content_minmax(0,1fr)] items-baseline gap-2 py-2 text-sm">
    <dt className="text-xs font-semibold text-muted-foreground">{label}</dt>
    <dd className="min-w-0 break-words text-left font-normal text-foreground tabular">{value}</dd>
  </div>
);

const ProjectClassificationRows: React.FC<{ project: ProjectWithRefs }> = ({ project }) => {
  const { t } = useTranslation();
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

const ProjectDetailRail: React.FC<ProjectDetailRailProps> = ({ project }) => {
  const { t } = useTranslation();
  const notSet = t('projectDetail.rail.notSet', 'Not set');
  return (
    <aside
      data-testid="project-detail-rail"
      aria-label={t('projectDetail.rail.ariaLabel', 'Project details rail')}
      className="min-w-0 border-t border-border/70 pt-3"
    >
      <details>
        <summary className="touch-target cursor-pointer rounded-sm py-2 text-sm font-semibold text-foreground">
          {t('uxs13.projectDetailsAndActions', 'Project details')}
        </summary>
        <div className="space-y-8 pt-3">
        <section aria-labelledby="project-details-heading">
          <RailSectionLabel>
            <span id="project-details-heading">{t('projectDetail.rail.detailsHeading', 'Details')}</span>
          </RailSectionLabel>
          <dl className="divide-y divide-border/70">
            {/* #1325: the header leads with the short name; the contractual name is readable here without hovering. */}
            {projectDisplayName(project) !== project.name && (
              <DetailRow label={t('projects:shortName.contractName', 'Contract name')} value={project.name} />
            )}
            {/* #758: the end customer shows ONLY when set — an optional value, so an unset one
                is omitted rather than rendered as "Not set". */}
            {project.end_client && (
              <DetailRow
                label={t('projectDetail.rail.endCustomer', 'End customer')}
                value={companyDisplayName(project.end_client)}
              />
            )}
            <ProjectClassificationRows project={project} />
            <DetailRow
              label={t('projectDetail.rail.pmoNumber', 'PMO Project Number')}
              value={<span className="text-sm tabular">{project.pmo_project_number}</span>}
            />
            <DetailRow
              label={t('projectDetail.rail.clientCode', 'Client Project Code')}
              value={project.code ? <span className="text-sm tabular">{project.code}</span> : notSet}
            />
            <DetailRow
              label={t('projectDetail.rail.customerPoRef', 'Customer PO ref')}
              value={
                project.customer_contract_ref ? (
                  <span className="text-sm tabular">{project.customer_contract_ref}</span>
                ) : (
                  notSet
                )
              }
            />
            {project.contract_date && <DetailRow label={t('projectDetail.rail.customerPoDate', 'Customer PO date')} value={formatDateOnly(project.contract_date)} />}
          </dl>
        </section>
        <ProjectErpLink projectId={project.id} />
        </div>
      </details>
    </aside>
  );
};

export default ProjectDetailRail;
