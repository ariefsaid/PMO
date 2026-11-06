import { useTranslation } from 'react-i18next';
import { usePermission } from '@/src/auth/usePermission';
import { useBudgetActivationMode, useBudgetActivationPrecheck } from '@/src/hooks/useBudget';
import { budgetCategoryLabel } from '@/src/lib/i18n/budgetCategoryLabel';
import type { BudgetReadinessIssue } from '@/src/lib/budget/budgetGate';
import type { BudgetVersionWithItems } from '@/src/lib/db/budgets';
import type { DistributionReadinessStatus } from './DistributionGrid';

export function useBudgetReadiness(draftVersion: BudgetVersionWithItems | undefined, currentUserId: string | null, hasOpenLineBuffers: boolean, distributionStatus: DistributionReadinessStatus = 'current') {
  const { t } = useTranslation('finance');
  const can = usePermission();
  const activationPrecheckQuery = useBudgetActivationPrecheck(draftVersion?.id);
  const activationPrecheck = activationPrecheckQuery.data;
  const activationModeQuery = useBudgetActivationMode(draftVersion?.id);
  const readinessMessages: string[] = [];
  const wholeProjectDistributionReady = draftVersion?.budget_mode !== 'whole_project' || distributionStatus === 'current';
  if (draftVersion?.budget_mode === 'whole_project' && distributionStatus !== 'current') {
    const distributionMessage: Partial<Record<DistributionReadinessStatus, string>> = {
      loading: t('finance:budgetActivation.distributionLoading', 'Checking the saved fiscal-year distribution…'),
      error: t('finance:budgetActivation.distributionReadFailed', "Couldn't load the saved fiscal-year distribution. Retry before activation."),
      absent: t('finance:budgetActivation.distributionMissing', 'Save a fiscal-year distribution before activating this whole-project budget.'),
      stale: t('finance:budgetActivation.distributionStale', 'The saved fiscal-year distribution no longer matches this draft. Review and save it again before activation.'),
      dirty: t('finance:budgetActivation.distributionDirty', 'The distribution has unsaved edits. Save or discard them before activation.'),
      invalid: t('finance:budgetActivation.distributionInvalid', 'The distribution inputs need correction before activation.'),
      saving: t('finance:budgetActivation.distributionSaving', 'Saving the fiscal-year distribution…'),
    };
    const message = distributionMessage[distributionStatus];
    if (message) readinessMessages.push(message);
  }
  const issueMessage = (issue: BudgetReadinessIssue): string => {
    const categories = issue.categories?.map((category) => budgetCategoryLabel(category, t)).join(', ') ??
      issue.lines?.map((line) => budgetCategoryLabel(line.category, t)).join(', ') ?? '';
    const lines = issue.lines?.map((line) => `${budgetCategoryLabel(line.category, t)}${line.fiscalYear ? ` (${line.fiscalYear})` : ''}`).join(', ') ?? categories;
    switch (issue.code) {
      case 'budget-multi-fiscal-year-unphased':
        return t('finance:budgetActivation.unphased', 'Phase every line before activating this multi-year budget. Un-phased categories: {{categories}}.', { categories });
      case 'budget-category-unmapped':
        return t('finance:budgetActivation.unmapped', 'Map these budget categories before activating: {{categories}}.', { categories });
      case 'budget-fiscal-year-invalid':
        return t('finance:budgetActivation.invalidYear', 'Choose a fiscal year listed by ERPNext for these lines: {{lines}}.', { lines });
      case 'budget-fiscal-year-out-of-span':
        return t('finance:budgetActivation.outOfSpan', 'These lines use a fiscal year outside the project dates: {{lines}}.', { lines });
      case 'budget-fiscal-year-ambiguous':
        return t('finance:budgetActivation.ambiguousYear', 'ERPNext has overlapping fiscal years on {{date}} ({{fiscalYears}}). Ask an administrator to correct the calendar.', { date: issue.date ?? '', fiscalYears: issue.fiscalYears?.join(', ') ?? '' });
      case 'budget-project-start-date-missing':
        return t('finance:budgetActivation.missingStart', 'Add a project start date before activating this budget.');
      case 'budget-fiscal-year-unresolved':
        return issue.datePart === 'end'
          ? t('finance:budgetActivation.unresolvedEndYear', 'ERPNext has no fiscal year for the project end date {{date}}.', { date: issue.date ?? '' })
          : t('finance:budgetActivation.unresolvedStartYear', 'ERPNext has no fiscal year for the project start date {{date}}.', { date: issue.date ?? '' });
      default:
        return t('finance:budgetActivation.issue', 'Budget readiness check found an issue that must be resolved before activation.');
    }
  };
  if (activationPrecheckQuery.isPending || activationPrecheckQuery.isFetching) {
    readinessMessages.push(t('finance:budgetActivation.checking', 'Checking project dates, line phasing, ERPNext fiscal years and account mapping…'));
  } else if (activationPrecheckQuery.isError) {
    readinessMessages.push(t('finance:budgetActivation.checkFailed', "Couldn't check budget readiness. Refresh and try again."));
  } else if (activationPrecheck) {
    if (activationPrecheck.erpCheck === 'unavailable') {
      readinessMessages.push(t('finance:budgetActivation.erpUnavailable', "Couldn't check ERPNext; it'll be checked again when the budget is pushed."));
    }
    readinessMessages.push(...activationPrecheck.issues.map(issueMessage));
    if (!hasOpenLineBuffers && activationPrecheck.status === 'ready' && activationPrecheck.erpCheck === 'available') {
      readinessMessages.push(t('finance:budgetActivation.ready', 'Ready to activate. ERPNext fiscal years and budget account mappings are available.'));
    }
  }
  const canConfirmActivation = !!activationPrecheck && wholeProjectDistributionReady && !activationPrecheckQuery.isError &&
    !activationPrecheckQuery.isPending && !activationPrecheckQuery.isFetching && activationPrecheck.status !== 'blocked';

  const modeCurrent = !activationModeQuery.isPending && !activationModeQuery.isFetching && !activationModeQuery.isError;
  const soleOperator = modeCurrent && activationModeQuery.data === 'sole_operator';
  const modeAllows = modeCurrent && (activationModeQuery.data === 'allowed' || soleOperator);
  const canActivate = !!draftVersion && modeAllows && (soleOperator || can('transition', 'budgetVersion', {
    currentUserId,
    record: { status: draftVersion.status, created_by: draftVersion.created_by, editor_ids: draftVersion.editor_ids },
  }));
  const activateBlockedReason = !draftVersion || canActivate ? null
    : activationModeQuery.isPending || activationModeQuery.isFetching
      ? t('finance:budgetActivation.eligibilityChecking', 'Checking activation eligibility…')
    : activationModeQuery.isError || !activationModeQuery.data || activationModeQuery.data === 'blocked'
      ? t('finance:budgetActivation.eligibilityUnavailable', 'Activation eligibility is unavailable. Refresh this page and try again.')
    : draftVersion.created_by == null
      ? t('financeCopy.activateNeedsAdminOrFinance', 'No drafter is recorded for this version, so only Admin or Finance can activate it.')
      : draftVersion.editor_ids?.includes(currentUserId ?? '') || draftVersion.created_by === currentUserId
        ? t('financeCopy.activateEditorBlocked', 'You drafted or edited this version, so someone else must activate it.')
        : t('projectDetail.budget.activationSeparationNextStep', 'The drafter and activator must be different people. Ask an eligible Admin or Finance user who did not edit this draft to activate it.');
  return { readinessMessages, canConfirmActivation, canActivate, activateBlockedReason, soleOperator, activationPrecheckQuery };
}
