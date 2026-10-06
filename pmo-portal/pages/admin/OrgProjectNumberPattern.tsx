import React, { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, ListState, TextField, useToast } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { repositories } from '@/src/lib/repositories';
import { useOrgProjectNumberPatternQuery, ORG_PROJECT_NUMBER_PATTERN_KEY } from '@/src/hooks/useOrgProjectNumberPattern';
import { validateProjectNumberPattern } from '@/src/lib/projectNumberPattern';
import { classifyMutationError } from '@/src/lib/classifyMutationError';

const SYSTEM_DEFAULT = 'PRJ-{YY}-{SEQ4}';

/** Admin control for the org-wide PMO-owned project-number display pattern. */
const OrgProjectNumberPattern: React.FC = () => {
  const { t } = useTranslation();
  const may = usePermission();
  const canManage = may('manage', 'orgProjectNumbering');
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isError, isSuccess, refetch } = useOrgProjectNumberPatternQuery();
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
    } catch (error) {
      const { headline, detail } = classifyMutationError(error);
      toast(headline, detail, 'warning');
    }
  };

  return (
    <section id="org-project-number-pattern" aria-label={t('admin.projectNumberPattern.title', 'Project number pattern')}>
      <h2 className="text-base font-semibold tracking-tight">
        {t('admin.projectNumberPattern.title', 'Project number pattern')}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {t('admin.projectNumberPattern.description', 'Format PMO-assigned project numbers. Use {CLIENT}, {YY}, and {SEQ4} exactly once each.')}
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
        ) : (
          <p data-testid="org-project-number-pattern-readonly" className="text-sm">
            <span className="font-semibold">{current}</span>
            <span className="ml-2 text-muted-foreground">
              {t('admin.projectNumberPattern.adminOnly', 'Only an Admin can change this.')}
            </span>
          </p>
        )}
      </div>
    </section>
  );
};

export default OrgProjectNumberPattern;
