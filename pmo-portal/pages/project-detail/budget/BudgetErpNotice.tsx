import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, StatusPill, useToast } from '@/src/components/ui';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { usePermission } from '@/src/auth/usePermission';
import type { BudgetVersionWithItems } from '@/src/lib/db/budgets';
import {
  fetchBudgetPushStatus,
  releaseActiveBudgetPushHold,
  retryActiveBudgetPush,
  type BudgetPushStatusRow,
} from '@/src/lib/repositories/budgetProjection';
import { describePushError } from '@/src/lib/adapterSeam/pushErrorCopy';
import { classifyMutationError } from '@/src/lib/classifyMutationError';

const ACCOUNT_MAP_HREF = '/administration/accounting#budget-account-map';
const PUSH_STATUS_KEY = (projectId: string) => ['budget-push-status', projectId] as const;

const pushStatusVariant = (state: string | null): 'neutral' | 'progress' | 'won' | 'lost' | 'warn' => {
  if (state === 'pushed') return 'won';
  if (state === 'failed' || state === 'held' || state === 'never-pushed' || state === 'unstamped-activation') return 'lost';
  if (state === 'pending' || state === 'pushing') return 'progress';
  return 'neutral';
};

export default function BudgetErpNotice({
  projectId,
  activeVersion,
  hasDraft = false,
  onRecover,
}: {
  projectId: string;
  activeVersion: BudgetVersionWithItems | undefined;
  hasDraft?: boolean;
  onRecover?: () => void;
}) {
  const { t } = useTranslation('project');
  const { realRole } = useEffectiveRole();
  const may = usePermission();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  // #1402 scopes ERP push state to Finance and Admin; retries remain under the same role gate.
  const visible = realRole === 'Admin' || realRole === 'Finance';
  const canRetry = realRole === 'Admin' || realRole === 'Finance';
  const pushQuery = useQuery<BudgetPushStatusRow[]>({
    queryKey: PUSH_STATUS_KEY(projectId),
    queryFn: () => fetchBudgetPushStatus(projectId),
    enabled: visible && Boolean(activeVersion),
  });
  const retry = useMutation({
    mutationFn: (fiscalYear: string | null) => retryActiveBudgetPush(projectId, fiscalYear),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: PUSH_STATUS_KEY(projectId) }),
  });
  const release = useMutation({
    mutationFn: (fiscalYear: string | null) => releaseActiveBudgetPushHold(projectId, fiscalYear),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: PUSH_STATUS_KEY(projectId) }),
  });
  const canRelease = may('manage', 'pushHold');
  const retryPush = async (row: BudgetPushStatusRow) => {
    try {
      const result = await retry.mutateAsync(row.fiscalYear);
      if (result.pushState === 'pushed') {
        toast(t('financeCopy.budgetPushedToERP', 'Budget pushed to ERPNext'), t('financeCopy.erpEnforcingBudget', 'ERPNext is enforcing this budget.'), 'success');
      } else if (result.pushState === 'nothing-to-push') {
        toast(t('financeCopy.noBudgetLinesToPushTitle', 'There was nothing to push'), t('financeCopy.noBudgetLinesToPushDetail', 'The active budget version has no budget lines, so no ERPNext Budget was created. Add lines and activate a new version.'), 'warning');
      } else {
        const copy = describePushError(row.pushError);
        toast(
          t('financeCopy.budgetPushIncomplete', 'The push did not complete'),
          copy.transport
            ? t('financeCopy.erpUnavailableRetryShortly', 'ERPNext could not be reached. Nothing on this screen needs fixing. Try again shortly.')
            : t('financeCopy.budgetPushReasonNeedsFixing', 'The reason shown above may need fixing first.'),
          'warning',
        );
      }
    } catch (error) {
      const { headline, detail } = classifyMutationError(error);
      toast(headline, detail, 'warning');
    }
  };
  const releaseHold = async (row: BudgetPushStatusRow) => {
    try {
      await release.mutateAsync(row.fiscalYear);
      toast(
        t('financeCopy.budgetPushHoldReleased', 'Hold released'),
        t('financeCopy.budgetPushHoldReleasedDetail', 'The push is queued again. ERPNext is contacted on the next recovery pass, and every check runs afresh.'),
        'success',
      );
    } catch (error) {
      const { headline, detail } = classifyMutationError(error);
      toast(headline, detail, 'warning');
    }
  };

  if (!visible || !activeVersion) return null;
  if (pushQuery.isPending) return null;
  if (pushQuery.isError) {
    return (
      <p role="status" aria-label={t('projectDetail.budget.erpStatus', 'ERP budget enforcement')} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
        {t('projectDetail.budget.erpStatusError', 'ERP enforcement status could not be checked.')}
        <Button variant="ghost" size="sm" onClick={() => void pushQuery.refetch()}>{t('common.retry', 'Retry')}</Button>
      </p>
    );
  }

  // A status word, never the raw state code.
  const pushStateLabel = (state: string | null): string => ({
    pushed: t('financeCopy.enforcedByERPNext', 'Enforced by ERPNext'),
    pending: t('projectDetail.budget.pushQueued', 'Queued'),
    pushing: t('projectDetail.budget.pushSending', 'Sending'),
    failed: t('projectDetail.budget.pushFailed', 'Not sent'),
    held: t('projectDetail.budget.pushHeld', 'On hold'),
  } as Record<string, string>)[state ?? ''] ?? t('projectDetail.budget.pushNotEnforced', 'Not enforced');
  const rows = (pushQuery.data ?? []).filter((row) => row.pushState !== null);
  if (rows.length === 0) return null;
  return (
    <div role="status" aria-label={t('projectDetail.budget.erpStatus', 'ERP budget enforcement')} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground" data-testid="budget-erp-notice">
      {rows.map((row, index) => {
        const state = row.pushState;
        const unstamped = state === 'unstamped-activation';
        const copy = describePushError(row.pushError);
        const noBudgetEnforced = state === 'never-pushed' || unstamped;
        const message = state === 'pushed' || state === 'pending' || state === 'pushing'
          ? ''
          : unstamped
            ? t('projectDetail.budget.activationDateNeeded', 'Add an activation date.')
            : noBudgetEnforced
              ? t('projectDetail.budget.neverPushed', 'No ERP budget yet.')
              : t('projectDetail.budget.previousBudgetStillEnforced', 'Previous budget still enforced. {{message}}', { message: copy.message });
        const offerRetry = !unstamped && (state === 'failed' || state === 'held' || state === 'never-pushed') && copy.retryable && canRetry;
        const offerRelease = state === 'held' && row.holdReleasable && canRelease;
        const needsMap = copy.code === 'budget-category-unmapped' && row.unmappedCategories?.length;
        return (
          <span key={`${row.fiscalYear ?? 'project'}-${state}-${index}`} className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
            {index > 0 && <span aria-hidden="true">·</span>}
            <StatusPill variant={pushStatusVariant(state)}>{pushStateLabel(state)}</StatusPill>
            {message && <span>{message}</span>}
            {unstamped && onRecover && (
              <span className="inline-flex flex-wrap items-center gap-x-2">
                <span>{t('projectDetail.budget.unstampedRecovery', 'Clone the active version or edit the existing draft, then activate it to record a real activation date.')}</span>
                <Button variant="ghost" size="sm" onClick={onRecover}>{hasDraft ? t('projectDetail.budget.editDraftRecovery', 'Edit draft') : t('projectDetail.budget.cloneToRevise', 'Clone to revise')}</Button>
              </span>
            )}
            {row.fiscalYear && <span>({row.fiscalYear})</span>}
            {row.erpBudgetName && <span>{row.erpBudgetName}</span>}
            {needsMap && (
              <>
                <span>{row.unmappedCategories!.join(', ')}</span>
                <Link to={ACCOUNT_MAP_HREF} className="font-medium text-primary-text underline underline-offset-2 hover:text-foreground">
                  {t('financeCopy.openTheBudgetAccountMap', 'Open the budget account map')}
                </Link>
              </>
            )}
            {!needsMap && !unstamped && copy.remedy && <span>{copy.remedy}</span>}
            {offerRetry && (
              <Button variant="ghost" size="sm" loading={retry.isPending} onClick={() => void retryPush(row)}>
                {t('financeCopy.retryThePush', 'Retry the push')}
              </Button>
            )}
            {offerRelease && (
              <Button variant="ghost" size="sm" loading={release.isPending} onClick={() => void releaseHold(row)}>
                {t('financeCopy.releaseTheHold', 'Release the hold')}
              </Button>
            )}
          </span>
        );
      })}
    </div>
  );
}
