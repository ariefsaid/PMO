import React, { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, ListState, TextField, useToast } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { repositories } from '@/src/lib/repositories';
import {
  useOrgProjectNumberPatternQuery,
  useOrgProjectNumberTimezoneQuery,
  ORG_PROJECT_NUMBER_PATTERN_KEY,
} from '@/src/hooks/useOrgProjectNumberPattern';
import { previewProjectNumber, projectNumberYear, validateProjectNumberPattern } from '@/src/lib/projectNumberPattern';
import { classifyMutationError } from '@/src/lib/classifyMutationError';

const SYSTEM_DEFAULT = 'PRJ-{YY}-{SEQ4}';

/** Admin control for the org-wide PMO-owned project-number display pattern. */
interface OrgProjectNumberPatternProps {
  editing?: boolean;
  onEdit?: () => void;
  onClose?: () => void;
}

const OrgProjectNumberPattern: React.FC<OrgProjectNumberPatternProps> = ({ editing: controlledEditing, onEdit, onClose }) => {
  const { t } = useTranslation();
  const [localEditing, setLocalEditing] = useState(controlledEditing ?? true);
  const editing = onEdit ? controlledEditing ?? localEditing : localEditing;
  const may = usePermission();
  const canManage = may('manage', 'orgProjectNumbering');
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isError, isSuccess, refetch } = useOrgProjectNumberPatternQuery();
  const timezoneQuery = useOrgProjectNumberTimezoneQuery();
  const timezoneRead = timezoneQuery.isSuccess && !timezoneQuery.isPlaceholderData && timezoneQuery.data !== undefined;
  const previewYear = timezoneRead
    ? projectNumberYear(new Date(), timezoneQuery.data.timezone ?? 'UTC')
    : null;
  const timezoneReadPending = timezoneQuery.isPending && timezoneQuery.fetchStatus === 'fetching';
  const [draft, setDraft] = useState('');
  const current = data ?? SYSTEM_DEFAULT;
  const loadFailed = isError && data === undefined;
  const validation = validateProjectNumberPattern(draft);

  useEffect(() => {
    if (isSuccess && data !== undefined) setDraft(data ?? SYSTEM_DEFAULT);
  }, [data, isSuccess]);

  const mutation = useMutation({
    mutationFn: (value: string | null) => repositories.orgSettings.setProjectNumberPattern(value),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [ORG_PROJECT_NUMBER_PATTERN_KEY] }),
  });

  const save = async () => {
    if (!validation.valid || draft === current) return;
    try {
      await mutation.mutateAsync(draft === SYSTEM_DEFAULT ? null : draft);
      toast(
        t('admin.projectNumberPattern.toast.saved', 'Project number pattern updated'),
        t('admin.projectNumberPattern.toast.detail', 'New project numbers will use this pattern. Existing project numbers are unchanged.'),
        'success',
      );
      closeEditor();
    } catch (error) {
      const { headline, detail } = classifyMutationError(error);
      toast(headline, detail, 'warning');
    }
  };

  const openEditor = () => onEdit ? onEdit() : setLocalEditing(true);
  const closeEditor = () => {
    if (onClose) onClose();
    else setLocalEditing(false);
    setDraft(current);
  };
  const preview = (pattern: string) => {
    if (!validateProjectNumberPattern(pattern).valid) return null;
    return previewYear === null ? (
      <div className="space-y-2 text-[13px] text-muted-foreground" role="status">
        {timezoneReadPending ? <p>{t('uxCorrectness.projectNumberPattern.timezonePending', 'Checking organisation year…')}</p> : <>
          <p>{t('uxCorrectness.projectNumberPattern.previewUnavailable', 'Preview unavailable')}</p>
          <Button type="button" variant="outline" onClick={() => void timezoneQuery.refetch()}>{t('uxCorrectness.projectNumberPattern.retryPreview', 'Retry preview')}</Button>
        </>}
      </div>
    ) : (
      <p data-testid="org-project-number-pattern-preview" className="text-[13px] text-muted-foreground">
        {t('uxs31.projectNumberPattern.preview', 'Preview:')}{' '}
        <span className="font-mono">{previewProjectNumber(pattern, previewYear)}</span>
        <span className="ml-1.5">{t('uxs31.projectNumberPattern.previewNote', 'Illustrative only; the actual number is assigned when a project is created.')}</span>
      </p>
    );
  };

  return (
    <section id="org-project-number-pattern" tabIndex={-1} className="scroll-mt-4" aria-label={t('admin.projectNumberPattern.title', 'Project number pattern')}>
      <h2 className="text-base font-semibold tracking-tight">
        {t('admin.projectNumberPattern.title', 'Project number pattern')}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {t(
          'admin.projectNumberPattern.description',
          'Format PMO-assigned project numbers. The built-in pattern is PRJ-{YY}-{SEQ4}; a custom pattern must use {CLIENT}, {YY}, and {SEQ4} exactly once each.',
        )}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        {t('admin.projectNumberPattern.immutable', 'This affects future proposals only; existing project numbers do not change.')}
      </p>
      <div className="mt-3 max-w-md">
        {loadFailed ? (
          <ListState
            variant="error"
            title={t('admin.projectNumberPattern.loadError.title', "Couldn't load the project number pattern")}
            sub={t('admin.loadErrorSub', 'The request failed. Check your connection and try again.')}
            retryLabel={t('admin.retry', 'Retry')}
            onRetry={() => void refetch()}
          />
        ) : data === undefined ? (
          <ListState variant="loading" rows={1} testId="org-project-number-pattern-loading" />
        ) : canManage && !editing ? (
          <div className="space-y-3">
            <dl className="space-y-1 text-sm">
              <div><dt className="text-muted-foreground">{t('administration:admin.projectNumberPattern.saved', 'Saved pattern')}</dt><dd className="font-mono font-semibold">{current}</dd></div>
            </dl>
            {preview(current)}
            <Button type="button" variant="outline" className="min-h-11" onClick={openEditor}>{t('administration:admin.projectNumberPattern.edit', 'Edit numbering')}</Button>
          </div>
        ) : canManage ? (
          <div className="space-y-3">
            <p className="text-[13px] text-muted-foreground">{t('administration:admin.projectNumberPattern.current', 'Current pattern:')} <span className="font-mono font-semibold text-foreground">{current}</span></p>
            <TextField
              id="org-project-number-pattern-input"
              label={t('admin.projectNumberPattern.label', 'Project number pattern')}
              value={draft}
              onChange={setDraft}
              onBlur={() => undefined}
              error={!validation.valid ? validation.reason : undefined}
              helper={t('admin.projectNumberPattern.example', 'Example: PRE-{CLIENT}-{YY}-{SEQ4}')}
              mono
              disabled={mutation.isPending}
            />
            {preview(draft)}
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" className="min-h-11" onClick={closeEditor}>{t('admin.cancel', 'Cancel')}</Button>
              <Button
                type="button"
                onClick={() => void save()}
                disabled={!validation.valid || draft === current}
                loading={mutation.isPending}
              >
                {mutation.isPending
                  ? t('admin.projectNumberPattern.saving', 'Saving…')
                  : t('admin.projectNumberPattern.save', 'Save pattern')}
              </Button>
            </div>
          </div>
        ) : (
          <div data-testid="org-project-number-pattern-readonly" className="space-y-2 text-sm">
            <p><span className="text-muted-foreground">{t('administration:admin.projectNumberPattern.saved', 'Saved pattern')}:</span> <span className="font-mono font-semibold">{current}</span></p>
            {preview(current)}
            <p className="text-muted-foreground">{t('admin.projectNumberPattern.adminOnly', 'Only an Admin can change this.')}</p>
          </div>
        )}
      </div>
    </section>
  );
};

export default OrgProjectNumberPattern;
