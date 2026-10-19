import { useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Combobox,
  EntityFormModal,
  FormGrid,
  FormSection,
} from '@/src/components/ui';
import type { ClickUpListItem, LinkClickUpProjectInput, LinkDirection } from '@/src/lib/repositories/types';

interface TaskListMatchReviewProps {
  open: boolean;
  projectId: string;
  projectName: string;
  lists: readonly ClickUpListItem[];
  proposedListId: string | null;
  canConfirm: boolean;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (input: LinkClickUpProjectInput) => void | Promise<void>;
}

type ReviewStage = 'selection' | 'confirmation';

const isLinkDirection = (value: string): value is LinkDirection =>
  value === 'push-seed' || value === 'pull-adopt';

/** Explicitly reviews one stable PMO project → existing ClickUp list link before saving. */
export function TaskListMatchReview({
  open,
  projectId,
  projectName,
  lists,
  proposedListId,
  canConfirm,
  saving,
  error,
  onClose,
  onConfirm,
}: TaskListMatchReviewProps) {
  const { t } = useTranslation();
  const [listId, setListId] = useState(proposedListId ?? '');
  const [initialSource, setInitialSource] = useState<LinkDirection | ''>('');
  const [stage, setStage] = useState<ReviewStage>('selection');
  const submitError = useMemo(() => error ? { headline: error } : null, [error]);

  if (!open) return null;

  const selectedList = lists.find((list) => list.id === listId);
  const projectLabel = projectName.trim() || t('uxs21.projectFallback', 'This project');
  const sourceLabel = initialSource === 'push-seed'
    ? t('uxs21.sourcePmo', 'Start with PMO tasks')
    : t('uxs21.sourceClickUp', 'Start with existing list tasks');

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!canConfirm || !selectedList || !isLinkDirection(initialSource)) return;

    if (stage === 'selection') {
      setStage('confirmation');
      return;
    }

    void onConfirm({
      tier: 'clickup',
      projectId,
      listId: selectedList.id,
      direction: initialSource,
    });
  };

  return (
    <EntityFormModal
      open
      title={t('uxs21.reviewTitle', 'Review ClickUp link')}
      subtitle={t('uxs21.reviewSubtitle', 'Confirm which existing list belongs to this project.')}
      submitLabel={stage === 'selection'
        ? t('uxs21.reviewAction', 'Review link')
        : t('uxs21.confirmAction', 'Confirm ClickUp link')}
      onSubmit={handleSubmit}
      onClose={onClose}
      loading={saving}
      submitError={submitError}
      dirty={Boolean(initialSource) || listId !== (proposedListId ?? '')}
      submitDisabled={!canConfirm || !selectedList || !isLinkDirection(initialSource)}
    >
      {stage === 'selection' ? (
        <FormSection legend={t('uxs21.linkDetails', 'Link details')}>
          <FormGrid>
            <Combobox
              id="task-list-match-list"
              label={t('uxs21.listLabel', 'ClickUp List')}
              required
              value={listId}
              onChange={setListId}
              selectedOption={selectedList ? {
                value: selectedList.id,
                label: selectedList.name,
                sub: selectedList.folder_name
                  ? `${selectedList.space_name} / ${selectedList.folder_name}`
                  : selectedList.space_name,
              } : null}
              loadOptions={async () => lists.map((list) => ({
                value: list.id,
                label: list.name,
                sub: list.folder_name
                  ? `${list.space_name} / ${list.folder_name}`
                  : list.space_name,
              }))}
              placeholder={t('uxs21.listPlaceholder', 'Choose an existing list')}
              searchPlaceholder={t('uxs21.listSearch', 'Search existing lists')}
              noun={t('uxs21.listNoun', 'list')}
              disabled={saving}
            />
          </FormGrid>
          {proposedListId && listId === proposedListId && (
            <p className="mt-2 text-sm text-muted-foreground" role="status">
              {t('uxs21.exactMatchHint', 'This is a suggested exact name match. Review it before saving.')}
            </p>
          )}
          {proposedListId && listId !== proposedListId && (
            <p className="mt-2 text-sm text-muted-foreground" role="status">
              {t('uxs21.changedMatchHint', 'You changed the suggested match. Confirm that this is the intended existing list.')}
            </p>
          )}
          {!proposedListId && (
            <p className="mt-2 text-sm text-muted-foreground" role="status">
              {t('uxs21.noExactMatchHint', 'There is no unique exact name match. Choose the existing list you intend to link.')}
            </p>
          )}

          <fieldset className="mt-4 space-y-2">
            <legend className="mb-2 text-sm font-medium text-foreground">
              {t('uxs21.sourceLegend', 'Choose the initial task source')}
            </legend>
            <label className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 text-sm text-foreground focus-within:outline focus-within:outline-2 focus-within:outline-ring ${initialSource === 'push-seed' ? 'border-foreground/60 bg-muted/50' : 'border-input'}`}>
              <input
                type="radio"
                name="task-list-initial-source"
                value="push-seed"
                checked={initialSource === 'push-seed'}
                onChange={() => setInitialSource('push-seed')}
                disabled={saving}
                className="mt-0.5 size-4 accent-primary"
              />
              <span>
                <span className="block font-medium">{t('uxs21.sourcePmo', 'Start with PMO tasks')}</span>
                <span className="block text-muted-foreground">{t('uxs21.sourcePmoHelp', 'Use this project’s existing tasks as the starting set.')}</span>
              </span>
            </label>
            <label className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 text-sm text-foreground focus-within:outline focus-within:outline-2 focus-within:outline-ring ${initialSource === 'pull-adopt' ? 'border-foreground/60 bg-muted/50' : 'border-input'}`}>
              <input
                type="radio"
                name="task-list-initial-source"
                value="pull-adopt"
                checked={initialSource === 'pull-adopt'}
                onChange={() => setInitialSource('pull-adopt')}
                disabled={saving}
                className="mt-0.5 size-4 accent-primary"
              />
              <span>
                <span className="block font-medium">{t('uxs21.sourceClickUp', 'Start with existing list tasks')}</span>
                <span className="block text-muted-foreground">{t('uxs21.sourceClickUpHelp', 'Use tasks already in this ClickUp list as the starting set.')}</span>
              </span>
            </label>
          </fieldset>
        </FormSection>
      ) : (
        <div className="space-y-4">
          <div className="rounded-md border border-border bg-muted/30 p-3">
            <dl className="grid gap-3 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className="min-w-0">
                <dt className="text-muted-foreground">{t('uxs21.projectLabel', 'PMO project')}</dt>
                <dd className="mt-0.5 break-words font-medium text-foreground">{projectLabel}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-muted-foreground">{t('uxs21.listLabel', 'ClickUp List')}</dt>
                <dd className="mt-0.5 break-words font-medium text-foreground">{selectedList?.name}</dd>
                {selectedList && (
                  <dd className="break-words text-xs text-muted-foreground">
                    {selectedList.folder_name
                      ? `${selectedList.space_name} / ${selectedList.folder_name}`
                      : selectedList.space_name}
                    <span className="font-mono"> · {selectedList.id}</span>
                  </dd>
                )}
              </div>
              <div className="min-w-0 sm:col-span-2">
                <dt className="text-muted-foreground">{t('uxs21.initialSourceLabel', 'Initial source')}</dt>
                <dd className="mt-0.5 break-words font-medium text-foreground">{sourceLabel}</dd>
              </div>
            </dl>
          </div>
          <p className="text-sm text-muted-foreground">
            {t('uxs21.initialSourceConsequence', 'This choice describes the initial task transfer only. It does not set an ongoing one-way sync direction.')}
          </p>
          <p className="text-sm text-muted-foreground">
            {t('uxs21.transferPendingNote', 'Saving this link does not confirm that the initial task transfer has completed.')}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setStage('selection')}
            disabled={saving}
          >
            {t('uxs21.backToEdit', 'Change selection')}
          </Button>
        </div>
      )}
    </EntityFormModal>
  );
}
