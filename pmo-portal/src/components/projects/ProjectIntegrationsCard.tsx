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
import type { LinkInput, LinkDirection, ProjectBinding, ExternalTier } from '@/src/lib/repositories/types';
import { tierLabel } from '@/src/components/integrations/integrationLabels';

type TierWithLists = 'clickup' | 'erpnext';

interface LinkFormValues {
  listId: string;
  direction: LinkDirection;
  companyId: string;
}

const validate = (v: LinkFormValues, tier: TierWithLists): Partial<Record<keyof LinkFormValues, string>> => {
  const errors: Partial<Record<keyof LinkFormValues, string>> = {};
  if (tier === 'clickup') {
    if (!v.listId) errors.listId = 'Select a ClickUp List.';
  } else {
    if (!v.companyId) errors.companyId = 'Select an ERPNext Company.';
  }
  return errors;
};

/**
 * Project-level integration link/unlink control.
 * Renders on the project detail page (Tasks tab or a dedicated Integrations section).
 * Gate: Admin via `can('manage','integration')`; PM via `can('edit','project')` (server re-enforces).
 */
export const ProjectIntegrationsCard: React.FC<{ projectId: string }> = ({ projectId }) => {
  const {
    clickupLists,
    isListsPending,
    linkProject,
    unlinkProject,
    projectBindings,
    isBindingsPending,
    refetchBindings,
    getBinding,
  } = useIntegrations();

  const clickupBinding = getBinding('clickup');
  const erpnextBinding = getBinding('erpnext');

  // Find the binding for THIS project (ClickUp only for now)
  const projectClickUpBinding = projectBindings.find(
    (b) => b.external_tier === 'clickup' && b.project_id === projectId,
  );

  const projectErpNextBinding = projectBindings.find(
    (b) => b.external_tier === 'erpnext' && b.project_id === projectId,
  );

  // Determine which tiers are connected at org level
  const clickupConnected = clickupBinding?.status === 'active';
  const erpnextConnected = erpnextBinding?.status === 'active';

  // UI state
  const [linkTier, setLinkTier] = useState<TierWithLists | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [unlinkTier, setUnlinkTier] = useState<ExternalTier | null>(null);
  const [confirmUnlinkBindingId, setConfirmUnlinkBindingId] = useState<string | null>(null);

  // Form for link modal
  const linkForm = useEntityForm<LinkFormValues>({
    initialValues: { listId: '', direction: 'push-seed', companyId: '' },
    validate: (v) => validate(v, linkTier ?? 'clickup'),
    idPrefix: 'link-form',
    requiredFields: linkTier === 'clickup' ? ['listId'] : ['companyId'],
  });

  const handleLinkClick = (tier: TierWithLists) => {
    setLinkTier(tier);
    setLinkError(null);
    linkForm.reset({ listId: '', direction: 'push-seed', companyId: '' });
  };

  const handleLinkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!linkTier) return;

    await linkForm.handleSubmit(async (values) => {
      try {
        const input: LinkInput =
          linkTier === 'clickup'
            ? { tier: 'clickup', projectId, listId: values.listId, direction: values.direction }
            : { tier: 'erpnext', companyId: values.companyId };
        await linkProject.mutateAsync(input);
        setLinkTier(null);
        refetchBindings();
      } catch (err) {
        // Surface inline (mixed-case 409 -> action-required)
        const { detail } = classifyMutationError(err);
        setLinkError(detail);
      }
    });
  };

  const handleUnlinkClick = (tier: ExternalTier, bindingId: string) => {
    setUnlinkTier(tier);
    setConfirmUnlinkBindingId(bindingId);
  };

  const handleUnlinkConfirm = async () => {
    if (!unlinkTier || !confirmUnlinkBindingId) return;
    try {
      await unlinkProject.mutateAsync({ tier: unlinkTier, projectId });
      setUnlinkTier(null);
      setConfirmUnlinkBindingId(null);
      refetchBindings();
    } catch (err) {
      const { detail } = classifyMutationError(err);
      console.error('Unlink failed:', detail);
    }
  };

  const renderLinkStatus = (tier: TierWithLists, binding: ProjectBinding | undefined) => {
    if (!binding) return null;

    const direction = (binding.config?.direction as LinkDirection) ?? 'push-seed';
    const listId = binding.external_container_id;
    const list = clickupLists.find((l) => l.id === listId);
    const listName = list?.name ?? listId;

    return (
      <div className="space-y-2.5">
        <div className="flex items-center gap-2">
          <Icon name="plug" className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">Linked to {tierLabel(tier)}</span>
          <StatusPill variant="won">Linked</StatusPill>
        </div>
        <div className="ml-6 flex flex-col gap-1.5 text-sm text-muted-foreground">
          <span>
            <span className="font-medium text-foreground">{tierLabel(tier)} List:</span>{' '}
            {listName}
          </span>
          <span>
            <span className="font-medium text-foreground">Direction:</span>{' '}
            {direction === 'push-seed' ? 'Push (seed new tasks)' : 'Pull (adopt existing)'}
          </span>
        </div>

        <CanWrite entity="integration" action="manage">
          <Button
            variant="destructive"
            size="sm"
            onClick={() => handleUnlinkClick(tier, binding.id)}
            disabled={unlinkProject.isPending}
          >
            <Icon name="x" className="size-3.55" aria-hidden="true" />
            Unlink from {tierLabel(tier)}
          </Button>
        </CanWrite>
      </div>
    );
  };

  const renderNotLinked = (tier: TierWithLists, connected: boolean) => {
    if (!connected) return null;

    return (
      <CanWrite entity="integration" action="manage">
        <Button variant="outline" size="sm" onClick={() => handleLinkClick(tier)}>
          <Icon name="plus" className="size-3.55" aria-hidden="true" />
          Link to {tierLabel(tier)}
        </Button>
      </CanWrite>
    );
  };

  const renderTierCard = (tier: TierWithLists) => {
    const isClickUp = tier === 'clickup';
    const binding = isClickUp ? projectClickUpBinding : projectErpNextBinding;
    const connected = isClickUp ? clickupConnected : erpnextConnected;

    return (
      <Card key={tier} className="p-4" data-tier={tier}>
        <div className="flex items-center gap-2">
          <Icon name={isClickUp ? 'plug' : 'table'} />
          <h3 className="text-[15px] text-foreground font-semibold">{tierLabel(tier)}</h3>
          <StatusPill
            variant={binding ? 'won' : 'neutral'}
            className={binding ? '' : 'bg-secondary'}
          >
            {binding ? 'Linked' : connected ? 'Connected (org)' : 'Not connected'}
          </StatusPill>
        </div>

        {binding ? (
          renderLinkStatus(tier, binding)
        ) : (
          renderNotLinked(tier, connected)
        )}

        {isClickUp && connected && !binding && isListsPending && (
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
          Link this project to an external system for bi-directional sync.
        </p>
      </div>

      <div className="flex flex-col gap-3.5" data-testid="project-integrations-cards">
        {['clickup', 'erpnext'].map((tier) => renderTierCard(tier as TierWithLists))}
      </div>

      {/* Link Modal */}
      {linkTier && (
        <EntityFormModal
          open
          title={`Link to ${tierLabel(linkTier)}`}
          subtitle={
            linkTier === 'clickup'
              ? 'Select a ClickUp List and choose how to sync this project.'
              : 'Select the ERPNext Company to link this project to.'
          }
          submitLabel={`Link to ${tierLabel(linkTier)}`}
          onSubmit={handleLinkSubmit}
          onClose={() => setLinkTier(null)}
          loading={linkProject.isPending}
          dirty={linkForm.isDirty}
          submitDisabled={!linkForm.isComplete}
          errorSummary={linkError ? [{ fieldId: linkForm.fieldProps('listId').id, message: linkError }] : undefined}
        >
          <FormSection legend="Configuration">
            <FormGrid>
              {linkTier === 'clickup' ? (
                <>
                  <Combobox
                    {...linkForm.fieldProps('listId')}
                    label="ClickUp List"
                    required
                    value={linkForm.values.listId}
                    selectedOption={clickupLists.find((l) => l.id === linkForm.values.listId) ? { value: clickupLists.find((l) => l.id === linkForm.values.listId)!.id, label: clickupLists.find((l) => l.id === linkForm.values.listId)!.name, sub: clickupLists.find((l) => l.id === linkForm.values.listId)!.folder_name ? `${clickupLists.find((l) => l.id === linkForm.values.listId)!.space_name} / ${clickupLists.find((l) => l.id === linkForm.values.listId)!.folder_name}` : clickupLists.find((l) => l.id === linkForm.values.listId)!.space_name } : null}
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
                </>
              ) : (
                <Combobox
                  {...linkForm.fieldProps('companyId')}
                  label="ERPNext Company"
                  required
                  value={linkForm.values.companyId}
                  selectedOption={null}
                  loadOptions={async () => []}
                  placeholder="Select a company…"
                  searchPlaceholder="Search companies…"
                  noun="company"
                  disabled={linkProject.isPending}
                />
              )}
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
        title={unlinkTier ? `Unlink from ${tierLabel(unlinkTier)}?` : 'Unlink?'}
        description="Synced tasks are retained; syncing stops. You can relink later with the same or different settings."
        confirmLabel={unlinkTier ? `Unlink from ${tierLabel(unlinkTier)}` : 'Unlink'}
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