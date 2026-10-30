import React from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@/src/components/ui';
import { pickClassification } from '@/src/lib/projectClassification';
import { companyDisplayName } from '@/src/lib/companyDisplayName';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import ProjectFormModal from '../../components/ProjectFormModal';

interface ProjectListActionsProps {
  editTarget: ProjectWithRefs | null;
  setEditTarget: (project: ProjectWithRefs | null) => void;
  archiveTarget: ProjectWithRefs | null;
  setArchiveTarget: (project: ProjectWithRefs | null) => void;
  archivePending: boolean;
  onArchiveConfirm: () => void;
  onSave: React.ComponentProps<typeof ProjectFormModal>['onSave'];
  onError: React.ComponentProps<typeof ProjectFormModal>['onError'];
}
export function ProjectListActions({ editTarget, setEditTarget, archiveTarget, setArchiveTarget,
  archivePending, onArchiveConfirm, onSave, onError }: ProjectListActionsProps) {
  const { t } = useTranslation();
  return <>
      {/* Edit-header modal (Admin·Exec·PM) — opened from the row menu */}
      {editTarget && (
        <ProjectFormModal
          mode="editHeader"
          initial={{
            ...pickClassification(editTarget),
            id: editTarget.id,
            name: editTarget.name,
            short_name: editTarget.short_name,
            code: editTarget.code,
            client_id: editTarget.client_id,
            project_manager_id: editTarget.project_manager_id,
            clientName: editTarget.client ? companyDisplayName(editTarget.client) : null,
            end_client_id: editTarget.end_client_id,
            endClientName: editTarget.end_client ? companyDisplayName(editTarget.end_client) : null,
            pmName: editTarget.pm?.full_name ?? null,
            start_date: editTarget.start_date,
            end_date: editTarget.end_date,
          }}
          onClose={() => setEditTarget(null)}
          onSave={onSave}
          onError={onError}
        />
      )}

      {/* Archive confirm (default tone) */}
      <ConfirmDialog
        open={!!archiveTarget}
        tone="default"
        /* ⚑ The named branch stays a template literal — see the interpolation note above. */
        title={
          archiveTarget
            ? `Archive ${archiveTarget.name}?`
            : t('projects.confirm.archiveTitle', 'Archive project?')
        }
        description={t(
          'projects.confirm.archiveDescription',
          'It will be hidden from the default project list. Existing references stay intact. You can restore it later.',
        )}
        confirmLabel={t('projects.confirm.archiveConfirm', 'Archive project')}
        loading={archivePending}
        onConfirm={onArchiveConfirm}
        onCancel={() => setArchiveTarget(null)}
      />
  </>;
}
