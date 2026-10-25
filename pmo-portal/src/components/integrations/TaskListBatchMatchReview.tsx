import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { ClickUpListItem, LinkClickUpProjectInput, LinkDirection } from '@/src/lib/repositories/types';
import { Button, EntityFormModal } from '@/src/components/ui';

export interface TaskListProposal {
  projectId: string;
  projectName: string;
  list: ClickUpListItem;
}

type BatchOutcome = 'saved' | 'failed';

interface TaskListBatchMatchReviewProps {
  open: boolean;
  proposals: readonly TaskListProposal[];
  canConfirm: boolean;
  onClose: () => void;
  onComplete: () => void | Promise<void>;
  onConfirm: (input: LinkClickUpProjectInput) => void | Promise<void>;
}

const sourceLabel = (direction: LinkDirection, t: (key: string, fallback: string) => string) =>
  direction === 'push-seed'
    ? t('uxs21.sourcePmo', 'Start with PMO tasks')
    : t('uxs21.sourceClickUp', 'Start with existing list tasks');

export function TaskListBatchMatchReview({
  open,
  proposals,
  canConfirm,
  onClose,
  onComplete,
  onConfirm,
}: TaskListBatchMatchReviewProps) {
  const { t } = useTranslation();
  const [rows] = useState<readonly TaskListProposal[]>(proposals);
  const [stage, setStage] = useState<'selection' | 'confirmation'>('selection');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(rows.map(({ projectId }) => projectId)));
  const [batchDirection, setBatchDirection] = useState<LinkDirection | ''>('');
  const [overrides, setOverrides] = useState<Record<string, LinkDirection | ''>>({});
  const [outcomes, setOutcomes] = useState<Record<string, BatchOutcome>>({});
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  const selected = rows.filter(({ projectId }) => selectedIds.has(projectId));
  const directionFor = (projectId: string) => overrides[projectId] || batchDirection;
  const pendingRetries = selected.filter(({ projectId }) => outcomes[projectId] === 'failed');
  const batchRows = Object.keys(outcomes).length > 0 ? pendingRetries : selected;
  const canReview = canConfirm && selected.length > 0 && selected.every(({ projectId }) => Boolean(directionFor(projectId)));

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canConfirm || saving) return;
    if (stage === 'selection') {
      if (canReview) setStage('confirmation');
      return;
    }

    if (!batchRows.length) return;
    setSaving(true);
    const nextOutcomes = { ...outcomes };
    for (const proposal of batchRows) {
      const direction = directionFor(proposal.projectId);
      if (!direction) continue;
      const input: LinkClickUpProjectInput = {
        tier: 'clickup',
        projectId: proposal.projectId,
        listId: proposal.list.id,
        direction,
      };
      try {
        await onConfirm(input);
        nextOutcomes[proposal.projectId] = 'saved';
      } catch {
        nextOutcomes[proposal.projectId] = 'failed';
      }
    }
    setOutcomes(nextOutcomes);
    await onComplete();
    setSaving(false);
    const failed = Object.values(nextOutcomes).some((outcome) => outcome === 'failed');
    if (!failed) onClose();
  };

  const selectedCount = selected.length;
  const submitLabel = stage === 'selection'
    ? t('integrations:uxs21.batchReviewAction', 'Review project connections')
    : pendingRetries.length > 0
      ? t('integrations:uxs21.batchRetryAction', 'Retry failed match')
      : selectedCount === rows.length
        ? t('integrations:uxs21.batchAcceptAllAction', 'Accept all clear matches')
        : t('integrations:uxs21.batchAcceptSelectedAction', 'Accept selected clear matches');

  return (
    <EntityFormModal
      open
      title={stage === 'selection'
        ? t('integrations:uxs21.batchTitle', 'Review clear ClickUp matches')
        : t('integrations:uxs21.batchConfirmTitle', 'Confirm project connections')}
      subtitle={stage === 'selection'
        ? t('integrations:uxs21.batchSubtitle', 'Clear name matches are selected. Confirm each project and its initial task source.')
        : t('integrations:uxs21.batchConfirmSubtitle', 'These links use existing ClickUp lists. The choice controls the initial task transfer only.')}
      submitLabel={submitLabel}
      onSubmit={handleSubmit}
      onClose={onClose}
      loading={saving}
      dirty={selectedCount > 0 && Boolean(batchDirection)}
      submitDisabled={stage === 'selection'
        ? !canReview || saving
        : !canConfirm || saving || batchRows.length === 0}
    >
      {stage === 'selection' ? (
        <div className="space-y-4">
          <ul className="divide-y divide-border rounded-md border border-border">
            {rows.map((proposal) => {
              const checked = selectedIds.has(proposal.projectId);
              const saved = outcomes[proposal.projectId] === 'saved';
              return (
                <li key={proposal.projectId} className="grid gap-2 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,0.75fr)] sm:items-center">
                  <label className="flex min-h-11 min-w-0 cursor-pointer items-center gap-3 text-sm text-foreground">
                    <input
                      aria-label={t('integrations:uxs21.batchInclude', 'Include {{name}}', { name: proposal.projectName })}
                      type="checkbox"
                      checked={checked}
                      disabled={saving || saved}
                      onChange={(event) => setSelectedIds((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(proposal.projectId);
                        else next.delete(proposal.projectId);
                        return next;
                      })}
                      className="size-4 shrink-0 accent-primary"
                    />
                    <span className="min-w-0 break-words">
                      <span className="block font-medium">{proposal.projectName}</span>
                      <span className="block text-muted-foreground">{proposal.list.name}</span>
                    </span>
                  </label>
                  <label className="grid min-h-11 min-w-0 gap-1 text-xs text-muted-foreground">
                    <span>{t('integrations:uxs21.batchSourceFor', 'Initial task source for {{name}}', { name: proposal.projectName })}</span>
                    <select
                      aria-label={t('integrations:uxs21.batchSourceFor', 'Initial task source for {{name}}', { name: proposal.projectName })}
                      className="min-h-11 min-w-0 rounded-md border border-input bg-background px-3 text-sm text-foreground"
                      value={overrides[proposal.projectId] ?? ''}
                      disabled={saving || saved}
                      onChange={(event) => setOverrides((current) => ({
                        ...current,
                        [proposal.projectId]: event.target.value as LinkDirection | '',
                      }))}
                    >
                      <option value="">{t('integrations:uxs21.batchUseCommonSource', 'Use batch choice')}</option>
                      <option value="push-seed">{t('uxs21.sourcePmo', 'Start with PMO tasks')}</option>
                      <option value="pull-adopt">{t('uxs21.sourceClickUp', 'Start with existing list tasks')}</option>
                    </select>
                  </label>
                </li>
              );
            })}
          </ul>
          <fieldset className="space-y-1.5">
            <legend className="mb-1 text-sm font-medium text-foreground">
              {t('integrations:uxs21.batchSourceLegend', 'Initial task source for selected projects')}
            </legend>
            <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border border-input px-3 py-2.5 text-sm text-foreground focus-within:outline focus-within:outline-2 focus-within:outline-ring">
              <input type="radio" name="task-list-batch-source" value="push-seed" checked={batchDirection === 'push-seed'} onChange={() => setBatchDirection('push-seed')} disabled={saving} className="mt-0.5 size-4 accent-primary" />
              <span>{t('uxs21.sourcePmo', 'Start with PMO tasks')}</span>
            </label>
            <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border border-input px-3 py-2.5 text-sm text-foreground focus-within:outline focus-within:outline-2 focus-within:outline-ring">
              <input type="radio" name="task-list-batch-source" value="pull-adopt" checked={batchDirection === 'pull-adopt'} onChange={() => setBatchDirection('pull-adopt')} disabled={saving} className="mt-0.5 size-4 accent-primary" />
              <span>{t('uxs21.sourceClickUp', 'Start with existing list tasks')}</span>
            </label>
          </fieldset>
          {Object.entries(outcomes).filter(([, outcome]) => outcome === 'failed').map(([projectId]) => {
            const proposal = rows.find((row) => row.projectId === projectId);
            return proposal ? (
              <p key={projectId} className="text-sm text-destructive-text" role="alert">
                {proposal.projectName}: {t('integrations:uxs21.batchSaveFailed', 'This link was not saved. Your choice is kept so you can retry.')}
              </p>
            ) : null;
          })}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {t('integrations:uxs21.batchConsequence', 'This connects each selected PMO project to the shown ClickUp list. The initial source choice does not start ongoing syncing.')}
          </p>
          <ul className="divide-y divide-border rounded-md border border-border">
            {selected.map((proposal) => {
              const direction = directionFor(proposal.projectId);
              const outcome = outcomes[proposal.projectId];
              return (
                <li key={proposal.projectId} className="px-3 py-2.5 text-sm">
                  <span className="block break-words font-medium text-foreground">{proposal.projectName} → {proposal.list.name}</span>
                  <span className="text-muted-foreground">{direction ? sourceLabel(direction, t) : ''}</span>
                  {outcome === 'saved' && <span className="ml-2 text-success-text">{t('integrations:uxs21.batchSaved', 'Saved')}</span>}
                  {outcome === 'failed' && (
                    <span className="mt-1 block text-destructive-text" role="alert">
                      {t('integrations:uxs21.batchSaveFailed', 'This link was not saved. Your choice is kept so you can retry.')}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="text-sm text-muted-foreground" role="note">
            {t('uxs21.transferPendingNote', 'Saving this link does not confirm that the initial task transfer has completed.')}
          </p>
          {Object.values(outcomes).some((outcome) => outcome === 'failed') ? (
            <p className="text-sm text-muted-foreground" role="status">
              {t('integrations:uxs21.batchPartialOutcome', '{{saved}} saved; {{failed}} need attention. Saved links are not repeated.', {
                saved: Object.values(outcomes).filter((outcome) => outcome === 'saved').length,
                failed: Object.values(outcomes).filter((outcome) => outcome === 'failed').length,
              })}
            </p>
          ) : null}
          {Object.keys(outcomes).length === 0 && (
            <Button type="button" variant="outline" className="min-h-11" onClick={() => setStage('selection')} disabled={saving}>
              {t('uxs21.backToEdit', 'Change selection')}
            </Button>
          )}
        </div>
      )}
    </EntityFormModal>
  );
}
