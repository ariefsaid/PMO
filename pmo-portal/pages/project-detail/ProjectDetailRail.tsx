import React, { useState } from 'react';
import { Button, StatusPill, type ButtonProps, useToast } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useProjectMutations } from '@/src/hooks/useProjects';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatDate } from '@/src/lib/format';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import { pillVariantForProjectStatus } from '../../components/projects';
import ProjectFormModal from '../../components/ProjectFormModal';

export interface ProjectDetailRailProps {
  project: ProjectWithRefs;
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

const railButtonProps: Pick<ButtonProps, 'variant' | 'size'> = {
  variant: 'primary',
  size: 'sm',
};

const ProjectDetailRail: React.FC<ProjectDetailRailProps> = ({ project }) => {
  const may = usePermission();
  const { toast } = useToast();
  const { updateHeader } = useProjectMutations();
  const [editOpen, setEditOpen] = useState(false);

  const canEdit = may('edit', 'project');

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
              Keep the record details current so delivery, budget, procurement, and documents stay aligned.
            </p>
            {canEdit && (
              <Button {...railButtonProps} onClick={() => setEditOpen(true)}>
                Edit project
              </Button>
            )}
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

      {editOpen && (
        <ProjectFormModal
          mode="editHeader"
          initial={{
            id: project.id,
            name: project.name,
            code: project.code,
            client_id: project.client_id,
            project_manager_id: project.project_manager_id,
            clientName: project.client?.name ?? null,
            pmName: project.pm?.full_name ?? null,
            start_date: project.start_date,
            end_date: project.end_date,
          }}
          onClose={() => setEditOpen(false)}
          onSave={async (id, input) => {
            await updateHeader.mutateAsync({ id, input });
            toast('Project updated', input.name, 'success');
            setEditOpen(false);
          }}
          onError={(err) => {
            const { headline, detail } = classifyMutationError(err);
            toast(headline, detail, 'warning');
          }}
        />
      )}
    </aside>
  );
};

export default ProjectDetailRail;
