import React, { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  Card,
  Icon,
  StatusPill,
  Button,
  ConfirmDialog,
  ListState,
} from '@/src/components/ui';
import { useIntegrations } from '@/src/hooks/useIntegrations';
import { CanWrite, usePermission } from '@/src/auth/usePermission';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import type { LinkClickUpProjectInput, ProjectBinding } from '@/src/lib/repositories/types';
import { tierLabel } from '@/src/components/integrations/integrationLabels';
import { TaskListMatchReview } from '@/src/components/integrations/TaskListMatchReview';
import { proposeTaskListMatches } from '@/src/lib/repositories/taskListMatchReview';

/**
 * Project-level integration link/unlink control for ClickUp only.
 * Renders on the project detail page (Tasks tab or a dedicated Integrations section).
 * Gate: `can('edit','project')` for Link/Unlink controls (server re-enforces project-scoped PM check).
 * NOTE: `policy.ts` has NO project-scoped integration primitive; `can('edit','project')` is an
 * ORG-WIDE hint (DELIVERY roles) — the SERVER does the real project-scoped check
 * (ADR-0016: can() is UX-only).
 * DEFER(P4/owner): per-project ERPNext company link — ERPNext is org-level; revisit as an org-settings enhancement
 */
export const ProjectIntegrationsCard: React.FC<{ projectId: string; projectName?: string; compact?: boolean }> = ({
  projectId,
  projectName = '',
  compact = false,
}) => {
  const { t } = useTranslation();
  const may = usePermission();
  const canEditProject = may('edit', 'project');
  const canManageIntegrations = may('manage', 'integration');
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
  const cardClass = compact ? 'p-3' : 'p-4';

  // UI state
  const [linkError, setLinkError] = useState<string | null>(null);
  // Failed-unlink detail lives on the card (the link modal is closed), separate from linkError.
  const [unlinkError, setUnlinkError] = useState<string | null>(null);
  const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);
  const [unlinkTier, setUnlinkTier] = useState<'clickup' | null>(null);
  const [confirmUnlinkBindingId, setConfirmUnlinkBindingId] = useState<string | null>(null);

  const matchProposal = proposeTaskListMatches(
    [{ id: projectId, name: projectName }],
    clickupLists,
    projectBindings,
  )[0];
  const proposedListId = matchProposal?.state === 'proposed' ? matchProposal.listId : null;
  const linkedListIds = new Set(projectBindings
    .filter((binding) => binding.external_tier === 'clickup' && binding.disconnected_at === null)
    .map((binding) => binding.external_container_id));
  const availableClickUpLists = clickupLists.filter((list) => !linkedListIds.has(list.id));

  const handleLinkClick = () => {
    setLinkError(null);
    setIsLinkModalOpen(true);
  };

  const handleLinkConfirm = async (input: LinkClickUpProjectInput) => {
    try {
      await linkProject.mutateAsync(input);
      setLinkError(null);
      setIsLinkModalOpen(false);
      void refetchBindings();
    } catch (err) {
      const { detail } = classifyMutationError(err);
      setLinkError(detail);
    }
  };

  const handleUnlinkClick = (bindingId: string) => {
    setUnlinkTier('clickup');
    setConfirmUnlinkBindingId(bindingId);
  };

  const handleUnlinkConfirm = async () => {
    if (!confirmUnlinkBindingId) return;
    try {
      await unlinkProject.mutateAsync({ tier: 'clickup', projectId });
      setUnlinkError(null);
      setUnlinkTier(null);
      setConfirmUnlinkBindingId(null);
      refetchBindings();
    } catch (err) {
      const { detail } = classifyMutationError(err);
      setUnlinkError(detail);
      setUnlinkTier(null);
      setConfirmUnlinkBindingId(null);
    }
  };

  const renderLinkStatus = (binding: ProjectBinding) => {
    const direction = binding.config?.direction;
    const listId = binding.external_container_id;
    const list = clickupLists.find((l) => l.id === listId);
    const listName = list?.name ?? (isListsPending && !isListsError
      ? t('uxs21.listDetailsLoading', 'Loading list details; saved list ID: {{listId}}', { listId })
      : t('uxs21.listUnavailable', 'List unavailable; saved list ID: {{listId}}', { listId }));
    const initialSource = direction === 'push-seed'
      ? t('uxs21.sourcePmo', 'Start with PMO tasks')
      : direction === 'pull-adopt'
        ? t('uxs21.sourceClickUp', 'Start with existing list tasks')
        : t('uxs21.unknownInitialSource', 'Initial source not recorded');

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
            <span className="font-medium text-foreground">{t('uxs21.initialSourceLabel', 'Initial source')}:</span>{' '}
            {initialSource}
          </span>
          <p role="status" className="max-w-[65ch] text-foreground">
            {t('uxs21.initialTransferPending', 'Project linked. Initial task transfer is not confirmed. Ask your integration administrator to complete the initial transfer.')}
          </p>
          {isListsError && (
            <div className="flex flex-wrap items-center gap-2">
              <span>{t('uxs21.listReadUnavailable', 'List details could not be refreshed. The saved list link is retained.')}</span>
              <Button variant="outline" size="sm" onClick={() => refetchLists()}>
                <Icon name="refresh" className="size-3.55" aria-hidden="true" />
                {t('uxs21.retryLists', 'Retry list details')}
              </Button>
            </div>
          )}
          {isBindingsError && (
            <div className="flex flex-wrap items-center gap-2" role="status">
              <span>{t('uxs21.bindingReadUnavailable', 'Project link details could not be refreshed. The saved link is retained.')}</span>
              <Button variant="outline" size="sm" onClick={() => refetchBindings()}>
                <Icon name="refresh" className="size-3.55" aria-hidden="true" />
                {t('uxs21.retryBinding', 'Retry project link')}
              </Button>
            </div>
          )}
        </div>

        {unlinkError && (
          <div
            role="alert"
            className="flex max-w-[65ch] items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.07] px-3 py-2 text-sm"
          >
            <Icon name="alert" className="mt-px size-4 shrink-0 text-destructive" aria-hidden="true" />
            <div className="min-w-0">
              <p className="font-medium text-destructive-text">
                {t('uxs21.unlinkFailed', 'Could not unlink from ClickUp. The project is still linked. Use Unlink from ClickUp to try again.')}
              </p>
              <p className="mt-0.5 text-muted-foreground">{unlinkError}</p>
            </div>
          </div>
        )}

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
    if (!clickupConnected) {
      return (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <p className="text-sm text-muted-foreground">
            {t('uxs21.clickupNotConnected', 'ClickUp is not connected for this organization.')}
          </p>
          {canManageIntegrations ? (
            <Link
              to="/administration/integrations"
              className="inline-flex min-h-8 items-center rounded-md border border-input bg-background px-3 text-sm font-medium text-foreground hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
            >
              {t('uxs21.setupClickUp', 'Set up ClickUp')}
            </Link>
          ) : (
            <span className="text-sm text-muted-foreground">
              {t('uxs21.askIntegrationAdmin', 'Ask an integration administrator to connect ClickUp.')}
            </span>
          )}
        </div>
      );
    }

    return (
      <CanWrite entity="project" action="edit">
        <Button variant="outline" size="sm" onClick={handleLinkClick} disabled={isListsPending || linkProject.isPending}>
          <Icon name="plus" className="size-3.55" aria-hidden="true" />
          Link to {tierLabel('clickup')}
        </Button>
      </CanWrite>
    );
  };

  const renderClickUpCard = () => {
    // Error state for lists query — ONLY while the org binding is ACTIVE (issue #449). A
    // not-connected org renders the quiet "Not connected" card below instead: a late/stale
    // lists failure (the query is disabled when the binding is inactive, but react-query keeps
    // its last error state) must never hijack an unlinked project's card.
    if (isListsError && clickupConnected && !projectClickUpBinding) {
      // AC-449-3: human copy ONLY. Never render `listsError.message` — supabase-js transport
      // text ("Failed to send a request to the Edge Function…") is diagnostics, not product
      // copy. Raw detail goes to the DEV console, same rule as classifyMutationError (AC-ERR-002).
      if (import.meta.env.DEV) console.debug('[clickup-lists-error]', listsError);
      return (
        <Card key="clickup" className={cardClass} data-tier="clickup">
          <div className="flex items-center gap-2">
            <Icon name="plug" />
            <h3 className="text-[15px] text-foreground font-semibold">{tierLabel('clickup')}</h3>
            <StatusPill variant="neutral" className="bg-destructive/10 text-destructive-text">
              Failed to load lists
            </StatusPill>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <p className="text-sm text-destructive">Couldn't reach ClickUp. Check the connection, then retry.</p>
            <Button variant="outline" size="sm" onClick={() => refetchLists()}>
              <Icon name="refresh" className="size-3.55" aria-hidden="true" />
              Retry
            </Button>
          </div>
        </Card>
      );
    }

    // Error state for project bindings query
    if (isBindingsError && !projectClickUpBinding) {
      return (
        <Card key="clickup" className={cardClass} data-tier="clickup">
          <div className="flex items-center gap-2">
            <Icon name="plug" />
            <h3 className="text-[15px] text-foreground font-semibold">{tierLabel('clickup')}</h3>
            <StatusPill variant="neutral" className="bg-destructive/10 text-destructive-text">
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
      <Card key="clickup" className={cardClass} data-tier="clickup">
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
    <div className={compact ? 'mt-5 max-w-3xl' : 'space-y-3.5'} data-testid={compact ? 'project-integrations-compact' : undefined}>
      {!compact && (
        <div className="flex items-center justify-between">
          <h3 className="text-[15px] font-semibold text-foreground">External Integrations</h3>
          <p className="text-[12px] text-muted-foreground">
            Link this project to ClickUp for bi-directional sync.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-3.5" data-testid="project-integrations-cards">
        {renderClickUpCard()}
      </div>

      {/* Link Modal */}
      {isLinkModalOpen && (
        <TaskListMatchReview
          open
          projectId={projectId}
          projectName={projectName}
          lists={availableClickUpLists}
          proposedListId={proposedListId}
          canConfirm={canEditProject}
          saving={linkProject.isPending}
          error={linkError}
          onClose={() => setIsLinkModalOpen(false)}
          onConfirm={handleLinkConfirm}
        />
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
