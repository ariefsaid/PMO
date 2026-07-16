import React, { useState } from 'react';
import {
  Card,
  Icon,
  StatusPill,
  Button,
  EntityFormModal,
  ConfirmDialog,
  FormSection,
  FormGrid,
  Combobox,
  SelectField,
  FieldError,
  ListState,
} from '@/src/components/ui';
import { useIntegrations } from '@/src/hooks/useIntegrations';
import { useEntityForm } from '@/src/components/ui/useEntityForm';
import { CanWrite } from '@/src/auth/usePermission';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import type { LinkInput, LinkDirection, ProjectBinding } from '@/src/lib/repositories/types';
import { tierLabel } from '@/src/components/integrations/integrationLabels';

interface LinkFormValues {
  listId: string;
  direction: LinkDirection;
}

const validate = (v: LinkFormValues): Partial<Record<keyof LinkFormValues, string>> => {
  const errors: Partial<Record<keyof LinkFormValues, string>> = {};
  if (!v.listId) errors.listId = 'Select a ClickUp List.';
  return errors;
};

/**
 * Project-level integration link/unlink control for ClickUp only.
 * Renders on the project detail page (Tasks tab or a dedicated Integrations section).
 * Gate: `can('edit','project')` for Link/Unlink controls (server re-enforces project-scoped PM check).
 * NOTE: `policy.ts` has NO project-scoped integration primitive; `can('edit','project')` is an
 * ORG-WIDE hint (DELIVERY roles) — the SERVER does the real project-scoped check
 * (ADR-0016: can() is UX-only).
 * DEFER(P4/owner): per-project ERPNext company link — ERPNext is org-level; revisit as an org-settings enhancement
 */
export const ProjectIntegrationsCard: React.FC<{ projectId: string }> = ({ projectId }) => {
  const {
    clickupLists,
    isListsPending,
    isListsError,
    listsError,
    refetchLists,
    linkProject,
    unlinkProject,
    projectBindings,
    isBindingsPending,
    isBindingsError,
    bindingsError,
    refetchBindings,
    getBinding,
  } = useIntegrations();

  const clickupBinding = getBinding('clickup');

  // Find the binding for THIS project (ClickUp only)
  const projectClickUpBinding = projectBindings.find(
    (b) => b.external_tier === 'clickup' && b.project_id === projectId,
  );

  // Determine if ClickUp is connected at org level
  const clickupConnected = clickupBinding?.status === 'active';

  // UI state
  const [linkError, setLinkError] = useState<string | null>(null);
  const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);
  const [unlinkTier, setUnlinkTier] = useState<'clickup' | null>(null);
  const [confirmUnlinkBindingId, setConfirmUnlinkBindingId] = useState<string | null>(null);

  // Form for link modal
  const linkForm = useEntityForm<LinkFormValues>({
    initialValues: { listId: '', direction: 'push-seed' },
    validate,
    idPrefix: 'link-form',
    requiredFields: ['listId'],
  });

  const handleLinkClick = () => {
    setLinkError(null);
    linkForm.reset({ listId: '', direction: 'push-seed' });
    setIsLinkModalOpen(true);
  };

  const handleLinkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    await linkForm.handleSubmit(async (values) => {
      try {
        const input: LinkInput = { tier: 'clickup', projectId, listId: values.listId, direction: values.direction };
        await linkProject.mutateAsync(input);
        setLinkError(null);
        refetchBindings();
      } catch (err) {
        // Surface inline (mixed-case 409 -> action-required)
        const { detail } = classifyMutationError(err);
        setLinkError(detail);
      }
    });
  };

  const handleUnlinkClick = (bindingId: string) => {
    setUnlinkTier('clickup');
    setConfirmUnlinkBindingId(bindingId);
  };

  const handleUnlinkConfirm = async () => {
    if (!confirmUnlinkBindingId) return;
    try {
      await unlinkProject.mutateAsync({ tier: 'clickup', projectId });
      setUnlinkTier(null);
      setConfirmUnlinkBindingId(null);
      refetchBindings();
    } catch (err) {
      const { detail } = classifyMutationError(err);
      setLinkError(detail);
      setUnlinkTier(null);
      setConfirmUnlinkBindingId(null);
    }
  };

  const renderLinkStatus = (binding: ProjectBinding) => {
    const direction = (binding.config?.direction as LinkDirection) ?? 'push-seed';
    const listId = binding.external_container_id;
    const list = clickupLists.find((l) => l.id === listId);
    const listName = list?.name ?? listId;

    return (
      <div className="space-y-2.5">
        <div className="flex items-center gap-2">
          <Icon name="plug" className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">Linked to {tierLabel('clickup')}</span>
          <StatusPill variant="won">Linked</StatusPill>
        </div>
        <div className="ml-6 flex flex-col gap-1.5 text-sm text-muted-foreground">
          <span>
            <span className="font-medium text-foreground">{tierLabel('clickup')} List:</span>{' '}
            {listName}
          </span>
          <span>
            <span className="font-medium text-foreground">Direction:</span>{' '}
            {direction === 'push-seed' ? 'Push (seed new tasks)' : 'Pull (adopt existing)'}
          </span>
        </div>

        <CanWrite entity="project" action="edit">
          <Button
            variant="destructive"
            size="sm"
            onClick={() => handleUnlinkClick(binding.id)}
            disabled={unlinkProject.isPending}
          >
            <Icon name="x" className="size-3.55" aria-hidden="true" />
            Unlink from {tierLabel('clickup')}
          </Button>
        </CanWrite>
      </div>
    );
  };

  const renderNotLinked = () => {
    if (!clickupConnected) return null;

    return (
      <CanWrite entity="project" action="edit">
        <Button variant="outline" size="sm" onClick={handleLinkClick}>
          <Icon name="plus" className="size-3.55" aria-hidden="true" />
          Link to {tierLabel('clickup')}
        </Button>
      </CanWrite>
    );
  };

  const renderClickUpCard = () => {
    // Error state for lists query
    if (isListsError) {
      return (
        <Card key="clickup" className="p-4" data-tier="clickup">
          <div className="flex items-center gap-2">
            <Icon name="plug" />
            <h3 className="text-[15px] text-foreground font-semibold">{tierLabel('clickup')}</h3>
            <StatusPill variant="neutral" className="bg-destructive/10 text-destructive">
              Failed to load lists
            </StatusPill>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <p className="text-sm text-destructive">{listsError?.message ?? 'Failed to load ClickUp lists'}</p>
            <Button variant="outline" size="sm" onClick={() => refetchLists()}>
              <Icon name="refresh" className="size-3.55" aria-hidden="true" />
              Retry
            </Button>
          </div>
        </Card>
      );
    }

    // Error state for project bindings query
    if (isBindingsError) {
      return (
        <Card key="clickup" className="p-4" data-tier="clickup">
          <div className="flex items-center gap-2">
            <Icon name="plug" />
            <h3 className="text-[15px] text-foreground font-semibold">{tierLabel('clickup')}</h3>
            <StatusPill variant="neutral" className="bg-destructive/10 text-destructive">
              Failed to load
            </StatusPill>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <p className="text-sm text-destructive">{bindingsError?.message ?? 'Failed to load project bindings'}</p>
            <Button variant="outline" size="sm" onClick={() => refetchBindings()}>
              <Icon name="refresh" className="size-3.55" aria-hidden="true" />
              Retry
            </Button>
          </div>
        </Card>
      );
    }

    return (
      <Card key="clickup" className="p-4" data-tier="clickup">
        <div className="flex items-center gap-2">
          <Icon name="plug" />
          <h3 className="text-[15px] text-foreground font-semibold">{tierLabel('clickup')}</h3>
          <StatusPill
            variant={projectClickUpBinding ? 'won' : 'neutral'}
            className={projectClickUpBinding ? '' : 'bg-secondary'}
          >
            {projectClickUpBinding ? 'Linked' : clickupConnected ? 'Connected (org)' : 'Not connected'}
          </StatusPill>
        </div>

        {projectClickUpBinding ? (
          renderLinkStatus(projectClickUpBinding)
        ) : (
          renderNotLinked()
        )}

        {clickupConnected && !projectClickUpBinding && isListsPending && (
          <ListState variant="loading" rows={1} />
        )}
      </Card>
    );
  };

  // Loading state for the whole card. Distinct testId so it doesn't collide with a host page's own
  // ListState loading skeleton (e.g. the TasksTab task list) when both render at once.
  if (isBindingsPending) {
    return (
      <div className="rounded-lg border border-border bg-card">
        <ListState variant="loading" rows={3} testId="project-integrations-loading" />
      </div>
    );
  }

  return (
    <div className="space-y-3.5">
      <div className="flex items-center justify-between">
        <h3 className="text-[15px] font-semibold text-foreground">External Integrations</h3>
        <p className="text-[12px] text-muted-foreground">
          Link this project to ClickUp for bi-directional sync.
        </p>
      </div>

      <div className="flex flex-col gap-3.5" data-testid="project-integrations-cards">
        {renderClickUpCard()}
      </div>

      {/* Link Modal */}
      {isLinkModalOpen && (
        <EntityFormModal
          open
          title={`Link to ${tierLabel('clickup')}`}
          subtitle="Select a ClickUp List and choose how to sync this project."
          submitLabel={`Link to ${tierLabel('clickup')}`}
          onSubmit={handleLinkSubmit}
          onClose={() => setIsLinkModalOpen(false)}
          loading={linkProject.isPending}
          dirty={linkForm.isDirty}
          submitDisabled={!linkForm.isComplete}
          errorSummary={linkError ? [{ fieldId: linkForm.fieldProps('listId').id, message: linkError }] : undefined}
        >
          <FormSection legend="Configuration">
            <FormGrid>
              <Combobox
                {...linkForm.fieldProps('listId')}
                label="ClickUp List"
                required
                value={linkForm.values.listId}
                selectedOption={clickupLists.find((l) => l.id === linkForm.values.listId)
                  ? {
                      value: clickupLists.find((l) => l.id === linkForm.values.listId)!.id,
                      label: clickupLists.find((l) => l.id === linkForm.values.listId)!.name,
                      sub: clickupLists.find((l) => l.id === linkForm.values.listId)!.folder_name
                        ? `${clickupLists.find((l) => l.id === linkForm.values.listId)!.space_name} / ${clickupLists.find((l) => l.id === linkForm.values.listId)!.folder_name}`
                        : clickupLists.find((l) => l.id === linkForm.values.listId)!.space_name,
                    }
                  : null}
                loadOptions={async () =>
                  clickupLists.map((l) => ({
                    value: l.id,
                    label: l.name,
                    sub: l.folder_name ? `${l.space_name} / ${l.folder_name}` : l.space_name,
                  }))
                }
                placeholder="Select a list…"
                searchPlaceholder="Search lists…"
                noun="list"
                disabled={linkProject.isPending}
              />
              <SelectField
                label="Sync Direction"
                options={[
                  { value: 'push-seed', label: 'Push (seed new tasks)' },
                  { value: 'pull-adopt', label: 'Pull (adopt existing)' },
                ]}
                value={linkForm.values.direction}
                onChange={(v) => linkForm.fieldProps('direction').onChange(v as LinkDirection)}
              />
            </FormGrid>
          </FormSection>
          {linkError && (
            <FieldError id={`${linkForm.fieldProps('listId').id}-submit`}>
              {linkError}
            </FieldError>
          )}
        </EntityFormModal>
      )}

      {/* Unlink ConfirmDialog */}
      <ConfirmDialog
        open={!!unlinkTier}
        tone="destructive"
        title={`Unlink from ${tierLabel('clickup')}?`}
        description="Synced tasks are retained; syncing stops. You can relink later with the same or different settings."
        confirmLabel={`Unlink from ${tierLabel('clickup')}`}
        loading={unlinkProject.isPending}
        onConfirm={handleUnlinkConfirm}
        onCancel={() => {
          setUnlinkTier(null);
          setConfirmUnlinkBindingId(null);
        }}
      />
    </div>
  );
};

export default ProjectIntegrationsCard;