import React from 'react';
import { StatusPill } from '@/src/components/ui';
import { formatDate } from '@/src/lib/format';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import { pillVariantForProjectStatus } from '../../components/projects';
import ProjectStatusControl from '../../components/ProjectStatusControl';

export interface ProjectDetailRailProps {
  project: ProjectWithRefs;
  onEditProject?: () => void;
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

const ProjectDetailRail: React.FC<ProjectDetailRailProps> = ({ project }) => {
  return (
    <aside
      data-testid="project-detail-rail"
      aria-label="Project details rail"
      className="min-w-0 lg:sticky lg:top-4"
    >
      <div className="space-y-8 border-t border-border/70 pt-4 lg:border-t-0 lg:pt-0">
        <section aria-label="Project rail actions">
          <RailSectionLabel>Record</RailSectionLabel>
          <div className="space-y-3">
            <p className="text-sm leading-6 text-muted-foreground">
              Move the project through its delivery stages from here. Edit stays in the header menu.
            </p>
            <ProjectStatusControl
              project={project}
              triggerVariant="primary"
              triggerSize="sm"
            />
          </div>
        </section>

        <section aria-labelledby="project-details-heading">
          <RailSectionLabel>
            <span id="project-details-heading">Details</span>
          </RailSectionLabel>
          <dl className="divide-y divide-border/70 border-y border-border/70">
            <DetailRow label="Customer" value={project.client?.name ?? 'Not set'} />
            <DetailRow label="Project manager" value={project.pm?.full_name ?? 'Unassigned'} />
            <DetailRow
              label="Status"
              value={
                <span className="inline-flex justify-end">
                  <StatusPill variant={pillVariantForProjectStatus(project.status as never)}>
                    {project.status}
                  </StatusPill>
                </span>
              }
            />
            <DetailRow label="Start" value={formatDate(project.start_date)} />
            <DetailRow label="Target end" value={formatDate(project.end_date)} />
            <DetailRow
              label="Code"
              value={project.code ? <span className="font-mono text-[13px]">{project.code}</span> : 'Not set'}
            />
            <DetailRow
              label="Customer PO ref"
              value={
                project.customer_contract_ref ? (
                  <span className="font-mono text-[13px]">{project.customer_contract_ref}</span>
                ) : (
                  'Not set'
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
