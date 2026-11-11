import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, ListState, TextField, UnsavedChangesDialog, useToast } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { repositories } from '@/src/lib/repositories';
import {
  useOrgProjectNumberPatternQuery,
  useOrgProjectNumberTimezoneQuery,
  ORG_PROJECT_NUMBER_PATTERN_KEY,
} from '@/src/hooks/useOrgProjectNumberPattern';
import { previewProjectNumber, projectNumberYear, validateProjectNumberPattern } from '@/src/lib/projectNumberPattern';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { useUnsavedChangesGuard } from '@/src/hooks/useUnsavedChangesGuard';

const SYSTEM_DEFAULT = 'PRJ-{YY}-{SEQ4}';

/** Admin control for the org-wide PMO-owned project-number display pattern. */
const OrgProjectNumberPattern: React.FC = () => {
  const { t } = useTranslation();
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
  const [savedPattern, setSavedPattern] = useState(SYSTEM_DEFAULT);
  const savedPatternRef = useRef(savedPattern);
  savedPatternRef.current = savedPattern;
  const initializedPattern = useRef(false);
  const [pendingLeave, setPendingLeave] = useState<{ leave: () => void; stay: () => void } | null>(null);
  const current = data ?? SYSTEM_DEFAULT;
  const loadFailed = isError && data === undefined;
  const validation = validateProjectNumberPattern(draft);

  useEffect(() => {
    if (isSuccess && data !== undefined) {
      const next = data ?? SYSTEM_DEFAULT;
      if (!initializedPattern.current) {
        initializedPattern.current = true;
        setDraft(next);
      } else {
        setDraft((currentDraft) => currentDraft === savedPatternRef.current ? next : currentDraft);
      }
      setSavedPattern(next);
    }
  }, [data, isSuccess]);

  const dirty = data !== undefined && draft !== savedPattern;
  const holdLeave = useCallback((leave: () => void, stay: () => void) => setPendingLeave({ leave, stay }), []);
  const guardLeave = useUnsavedChangesGuard({ dirty, guardHistory: true, onBlocked: holdLeave });

  const mutation = useMutation({
    mutationFn: (value: string | null) => repositories.orgSettings.setProjectNumberPattern(value),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [ORG_PROJECT_NUMBER_PATTERN_KEY] }),
  });

  const save = async () => {
    if (!validation.valid || draft === current) return;
    try {
      await mutation.mutateAsync(draft === SYSTEM_DEFAULT ? null : draft);
      setSavedPattern(draft);
      toast(
        t('admin.projectNumberPattern.toast.saved', 'Project number pattern updated'),
        t('admin.projectNumberPattern.toast.detail', 'New project numbers will use this pattern. Existing project numbers are unchanged.'),
        'success',
      );
    } catch (error) {
      const { headline, detail } = classifyMutationError(error);
      toast(headline, detail, 'warning');
    }
  };

  return (
    <section id="org-project-number-pattern" tabIndex={-1} className="scroll-mt-4" aria-label={t('admin.projectNumberPattern.title', 'Project number pattern')}>
      <h2 className="text-base font-semibold tracking-tight">
        {t('admin.projectNumberPattern.title', 'Project number pattern')}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {t(
          'admin.projectNumberPattern.description',
          'Format of PMO-assigned project numbers. A custom pattern uses {CLIENT}, {YY} and {SEQ4} once each; the default is PRJ-{YY}-{SEQ4}.',
        )}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        {t('admin.projectNumberPattern.immutable', 'Applies to future proposals only.')}
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
        ) : canManage ? (
          <div className="space-y-3">
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
            {validation.valid && (previewYear === null ? (
              <div className="space-y-2 text-control text-muted-foreground" role="status">
                {timezoneReadPending ? (
                  <p>{t('uxCorrectness.projectNumberPattern.timezonePending', 'Checking organisation year…')}</p>
                ) : (
                  <>
                    <p>{t('uxCorrectness.projectNumberPattern.previewUnavailable', 'Preview unavailable')}</p>
                    <Button type="button" variant="outline" onClick={() => void timezoneQuery.refetch()}>
                      {t('uxCorrectness.projectNumberPattern.retryPreview', 'Retry preview')}
                    </Button>
                  </>
                )}
              </div>
            ) : (
              <p data-testid="org-project-number-pattern-preview" className="text-control text-muted-foreground">
                {t('uxs31.projectNumberPattern.preview', 'Preview:')}{' '}
                <span className="font-mono">{previewProjectNumber(draft, previewYear)}</span>
                <span className="ml-1.5">
                  {t('uxs31.projectNumberPattern.previewNote', 'Illustrative only; the actual number is assigned when a project is created.')}
                </span>
              </p>
            ))}
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
            <Button type="button" variant="ghost" onClick={() => guardLeave(() => setDraft(savedPattern))}>
              {t('common.cancel', 'Cancel')}
            </Button>
          </div>
        ) : (
          <p data-testid="org-project-number-pattern-readonly" className="text-sm">
            <span className="font-semibold">{current}</span>
            <span className="ml-2 text-muted-foreground">
              {t('admin.projectNumberPattern.adminOnly', 'Only an Admin can change this.')}
            </span>
          </p>
        )}
      </div>
      <UnsavedChangesDialog
        open={pendingLeave !== null}
        onDiscard={() => { const pending = pendingLeave; setPendingLeave(null); pending?.leave(); }}
        onKeepEditing={() => { const pending = pendingLeave; setPendingLeave(null); pending?.stay(); }}
      />
    </section>
  );
};

export default OrgProjectNumberPattern;
