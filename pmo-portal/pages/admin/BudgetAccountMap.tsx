import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ListState,
  ConfirmDialog,
  EntityFormModal,
  type SubmitError,
  FormGrid,
  FormSection,
  StatusPill,
  Button,
  Combobox,
  useToast,
  useEntityForm,
} from '@/src/components/ui';
import { Constants } from '@/src/lib/supabase/database.types';
import { usePermission } from '@/src/auth/usePermission';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import {
  listBudgetCategoryAccountMap,
  createBudgetCategoryAccountMapRow,
  updateBudgetCategoryAccountMapRow,
  deleteBudgetCategoryAccountMapRow,
  setBudgetPushAccount,
  type CategoryAccountMapRow,
  type BudgetCategory,
  listBudgetPostingAccountCatalogue,
} from '@/src/lib/repositories/budgetProjection';
import { isDirectCostPostingAccount, proposeBudgetAccountMap, type BudgetPostingAccount } from '@/src/lib/budget/categoryAccountMap';

/**
 * Administration › Budget account map (P3c FR-BUD-110..113; #768 FR-BAM-010..013) — the Admin CRUD surface for
 * `budget_category_account_map`. Every PMO `budget_category` is ALWAYS shown, mapped or not: an unmapped
 * category, or one with accounts but no push account, FAILS CLOSED at the next push, so it must stay visible.
 *
 * #768: a category may list several ERP accounts. Its actuals add up across all of them; its budget is pushed
 * only to the ONE marked "Budget push" (0246: at most one per category, DB-enforced). An account still belongs
 * to one category (`unique (org_id, erp_account)`), pre-checked here and re-asserted by the DB.
 *
 * ⚑ Admin-only (FR-BUD-112): gated on `can('manage', 'integration', ctx)`. RLS
 * (`budget_category_account_map_write`) and the SECURITY INVOKER `set_budget_push_account` enforce the same
 * predicate server-side. This is UX only; RLS is the authority (ADR-0016).
 */

const BUDGET_CATEGORIES = Constants.public.Enums.budget_category;

interface FormValues {
  erpAccount: string;
}

/** What the account form does: add an account to a category, or rename one account row. */
type FormTarget =
  | { mode: 'create'; category: BudgetCategory; isPushTarget: boolean }
  | { mode: 'edit'; row: CategoryAccountMapRow };

const BudgetAccountMap: React.FC = () => {
  const { t } = useTranslation();
  const categoryLabel = (value: string) => value === 'Special expenses'
    ? t('budget.category.specialExpenses', 'Special expenses') : value;
  const may = usePermission();
  const canManage = may('manage', 'integration');
  const { toast } = useToast();
  const qc = useQueryClient();
  const sectionRef = useRef<HTMLElement>(null);

  const { data, isPending, isError, refetch } = useQuery<CategoryAccountMapRow[]>({
    queryKey: ['budget-category-account-map'],
    queryFn: listBudgetCategoryAccountMap,
  });
  const catalogueQuery = useQuery({
    queryKey: ['budget-posting-account-catalogue'],
    queryFn: listBudgetPostingAccountCatalogue,
  });

  const rows = useMemo(() => data ?? [], [data]);
  const catalogue = catalogueQuery.data;
  const categoriesNeedingPosting = BUDGET_CATEGORIES.filter((category) =>
    !(data ?? []).some((row) => row.category === category && row.isPushTarget),
  );
  const proposals = useMemo(
    () => proposeBudgetAccountMap(catalogue?.accounts ?? [], categoriesNeedingPosting, rows.map((row) => row.erpAccount)),
    [catalogue?.accounts, categoriesNeedingPosting, rows],
  );
  const accountsByCategory = useMemo(() => {
    const byCategory = new Map<string, CategoryAccountMapRow[]>();
    for (const row of rows) byCategory.set(row.category, [...(byCategory.get(row.category) ?? []), row]);
    return byCategory;
  }, [rows]);

  const [formTarget, setFormTarget] = useState<FormTarget | null>(null);
  const [removeTarget, setRemoveTarget] = useState<CategoryAccountMapRow | null>(null);
  const [pushTarget, setPushTarget] = useState<CategoryAccountMapRow | null>(null);
  const [confirmProposals, setConfirmProposals] = useState(false);
  const [proposalError, setProposalError] = useState<string | null>(null);
  // #559 / AC-ERR-001: the form fires and forgets — this component owns the mutation and its rejection.
  const [saveError, setSaveError] = useState<SubmitError | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['budget-category-account-map'] });

  // AC-ADMIA-004 (fragment deep-link) — unchanged: the ROUTER hash is the source of truth; scroll/focus the
  // map once it has rendered. Declared before the early returns (Rules of Hooks).
  const { hash } = useLocation();
  const mapLoaded = !isPending && !isError;
  useEffect(() => {
    if (!mapLoaded || !sectionRef.current) return;
    if (hash !== '#budget-account-map') return;
    sectionRef.current.scrollIntoView({ block: 'start' });
    sectionRef.current.focus({ preventScroll: true });
  }, [mapLoaded, hash]);

  const createMutation = useMutation({
    mutationFn: (v: { category: BudgetCategory; erpAccount: string; isPushTarget: boolean }) =>
      createBudgetCategoryAccountMapRow(v.category, v.erpAccount, v.isPushTarget),
    onSuccess: invalidate,
  });
  const updateMutation = useMutation({
    mutationFn: (v: { id: string; erpAccount: string }) => updateBudgetCategoryAccountMapRow(v.id, v.erpAccount),
    onSuccess: invalidate,
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteBudgetCategoryAccountMapRow(id),
    onSuccess: invalidate,
  });
  const pushMutation = useMutation({
    mutationFn: (id: string) => setBudgetPushAccount(id),
    onSuccess: invalidate,
  });

  // Removing a category's LAST account unmaps it (the shipped unmap copy); removing a read-only sibling only
  // stops its actuals counting.
  const removeIsLast = removeTarget ? (accountsByCategory.get(removeTarget.category)?.length ?? 0) <= 1 : false;

  const onRemoveConfirm = async () => {
    if (!removeTarget) return;
    const target = removeTarget;
    const wasLast = removeIsLast;
    try {
      await deleteMutation.mutateAsync(target.id);
      toast(
        wasLast ? t('admin.budgetMap.toast.unmapped', 'Category unmapped') : t('admin.budgetMap.toast.removed', 'Account removed'),
        wasLast ? categoryLabel(target.category) : `${categoryLabel(target.category)} · ${target.erpAccount}`,
        'success',
      );
      setRemoveTarget(null);
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
    }
  };

  const onProposalConfirm = async () => {
    setProposalError(null);
    const failures: string[] = [];
    let saved = 0;
    for (const proposal of proposals) {
      try {
        await createMutation.mutateAsync({ category: proposal.category as BudgetCategory, erpAccount: proposal.account, isPushTarget: true });
        saved += 1;
      } catch {
        failures.push(proposal.category);
      }
    }
    await invalidate();
    setConfirmProposals(false);
    if (failures.length) {
      setProposalError(t('uxs10.proposalPartial', { defaultValue: 'Some proposals were not saved ({{categories}}). Existing choices remain unchanged; review those categories and try again.', categories: failures.join(', ') }));
    } else {
      toast(t('uxs10.proposalSaved', 'Posting map confirmed'), t('uxs10.proposalSavedDetail', { defaultValue: '{{count}} category choices were saved.', count: saved }), 'success');
    }
  };

  const onPushConfirm = async () => {
    if (!pushTarget) return;
    const target = pushTarget;
    try {
      await pushMutation.mutateAsync(target.id);
      toast(
        t('admin.budgetMap.toast.pushSet', 'Push account changed'),
        `${categoryLabel(target.category)} → ${target.erpAccount}`,
        'success',
      );
      setPushTarget(null);
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
    }
  };

  if (isPending) {
    return (
      <div className="rounded-lg border border-border bg-card">
        <ListState variant="loading" rows={BUDGET_CATEGORIES.length} testId="budget-account-map-loading" />
      </div>
    );
  }

  if (isError) {
    return (
      <ListState
        variant="error"
        title={t('admin.budgetMap.error.title', "Couldn't load the account map")}
        sub={t('admin.loadErrorSub', 'The request failed. Check your connection and try again.')}
        retryLabel={t('admin.retry', 'Retry')}
        onRetry={() => refetch()}
      />
    );
  }

  return (
    // ⚑ I-8 — the budget projection's banner LINKS here (`/administration/accounting#budget-account-map`).
    <section
      id="budget-account-map"
      className="scroll-mt-4"
      aria-label={t('admin.budgetMap.sectionLabel', 'Budget category to ERP account map')}
      ref={sectionRef}
      tabIndex={-1}
    >
      <h2 className="text-[15px] font-semibold tracking-[-0.01em]">
        {t('admin.budgetMap.title', 'Budget account map')}
      </h2>
      <p className="mt-1 text-[13px] text-muted-foreground">
        {t(
          'admin.budgetMap.description',
          'Every budget category must map to an ERP account before its amount can be pushed. An unmapped category blocks the push for the WHOLE budget, not just that line.',
        )}
      </p>
      <p className="mt-1 text-[13px] text-muted-foreground">
        {t('uxs10.mapPrinciple', 'One direct-cost account receives each category budget. Additional project-tagged accounts can count toward actuals only.')}
      </p>
      <p className="mt-1 text-[13px] text-muted-foreground">
        {t('admin.budgetMap.multiNote', 'A category may list several accounts. Its actuals add up across all of them; its budget is pushed only to the account marked Budget push.')}
      </p>

      <div className="mt-4 border-y border-border py-3" aria-label={t('uxs10.proposalsLabel', 'Suggested posting accounts')}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">{t('uxs10.proposalsTitle', 'Review suggested posting accounts')}</h3>
            <p className="mt-1 text-[13px] text-muted-foreground">{t('uxs10.proposalsHelp', 'Suggestions use enabled ledger accounts grouped under direct costs. Existing choices are kept; unclear categories need your decision.')}</p>
          </div>
          {proposals.length > 0 && canManage && (
            <Button variant="primary" onClick={() => setConfirmProposals(true)}>
              {t('uxs10.reviewProposals', { defaultValue: 'Review {{count}} proposals', count: proposals.length })}
            </Button>
          )}
        </div>
        {catalogueQuery.isPending && <p className="mt-2 text-[13px] text-muted-foreground" role="status">{t('uxs10.catalogueLoading', 'Loading the account chart…')}</p>}
        {catalogueQuery.isError && <div className="mt-2 flex flex-wrap items-center gap-2"><p className="text-[13px] text-destructive-text" role="alert">{t('uxs10.catalogueError', 'The account chart is unavailable. No suggestions were applied.')}</p><Button variant="outline" size="sm" onClick={() => void catalogueQuery.refetch()}>{t('admin.retry', 'Retry')}</Button></div>}
        {catalogue?.source === 'erp-fallback' && <p className="mt-2 text-[13px] text-muted-foreground">{t('uxs10.catalogueFallback', 'The saved account chart is empty; these choices come from the current ERP chart.')}</p>}
        {catalogue && proposals.length === 0 && <p className="mt-2 text-[13px] text-muted-foreground">{t('uxs10.noProposal', 'No clear direct-cost match is available. Resolve the account with your operator; an overhead account will not be substituted.')}</p>}
        {proposalError && <p className="mt-2 text-[13px] text-destructive-text" role="alert">{proposalError}</p>}
      </div>
      {/* ⚑ AC-MOBILE-OVERFLOW-001 — below `sm` each row is a stacked card; from `sm` up an ordinary table. The
          account list wraps (`flex-wrap`, `break-words`), so long account names never push past 390px. */}
      <table className="mt-3.5 w-full border-collapse">
        <thead className="hidden sm:table-header-group">
          <tr>
            <th className="h-[38px] border-b border-border bg-card px-3 text-left text-[11.5px] font-semibold uppercase tracking-[0.03em] text-muted-foreground">
              {t('admin.budgetMap.columns.category', 'Category')}
            </th>
            <th className="h-[38px] border-b border-border bg-card px-3 text-left text-[11.5px] font-semibold uppercase tracking-[0.03em] text-muted-foreground">
              {t('admin.budgetMap.columns.erpAccount', 'ERP account')}
            </th>
            {canManage && (
              <th className="h-[38px] border-b border-border bg-card px-3 text-right text-[11.5px] font-semibold uppercase tracking-[0.03em] text-muted-foreground">
                {t('admin.budgetMap.columns.actions', 'Actions')}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {BUDGET_CATEGORIES.map((category) => {
            const accounts = accountsByCategory.get(category) ?? [];
            const hasPush = accounts.some((a) => a.isPushTarget);
            return (
              <tr key={category} className="block border-b border-border py-2 sm:table-row sm:py-0">
                <td className="block px-3 py-1 text-[13.5px] font-medium sm:table-cell sm:border-b sm:border-border sm:py-2 sm:align-top">
                  {categoryLabel(category)}
                </td>
                <td className="block px-3 py-1 text-[13.5px] sm:table-cell sm:border-b sm:border-border sm:py-2">
                  {accounts.length === 0 ? (
                    <StatusPill variant="warn">{t('admin.budgetMap.unmapped', 'Not mapped — blocks every push')}</StatusPill>
                  ) : (
                    <div className="space-y-2">
                      {!hasPush && <StatusPill variant="warn">{t('admin.budgetMap.noPush', 'No push account — blocks every push')}</StatusPill>}
                      {accounts.filter((account) => account.isPushTarget).map((account) => (
                        <div key={account.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="break-words">{account.erpAccount}</span>
                          <StatusPill variant="open">{t('admin.budgetMap.pushBadge', 'Budget push')}</StatusPill>
                        </div>
                      ))}
                      {accounts.some((account) => !account.isPushTarget) && (
                        <details className="text-[13px]">
                          <summary className="w-fit cursor-pointer text-muted-foreground underline decoration-border underline-offset-2 hover:text-foreground">
                            {t('uxs10.countOnlyAccounts', { defaultValue: '{{count}} additional account(s) count toward actuals only', count: accounts.filter((account) => !account.isPushTarget).length })}
                          </summary>
                          <ul className="mt-2 flex flex-col gap-1.5">
                            {accounts.filter((account) => !account.isPushTarget).map((account) => <li key={account.id} className="break-words">{account.erpAccount}</li>)}
                          </ul>
                        </details>
                      )}
                    </div>
                  )}
                </td>
                {canManage && (
                  <td className="block px-3 py-1 sm:table-cell sm:border-b sm:border-border sm:py-2 sm:align-top">
                    <details className="text-left">
                      <summary className="touch-target ml-auto w-fit cursor-pointer rounded-md px-2 py-1 text-[13px] text-muted-foreground underline decoration-border underline-offset-2 hover:text-foreground">
                        {t('uxs10.rowOptions', 'Account options')}
                      </summary>
                      <div className="mt-2 flex flex-wrap justify-end gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => { setSaveError(null); setFormTarget({ mode: 'create', category, isPushTarget: !hasPush }); }}
                        >
                          {accounts.length === 0
                            ? t('admin.budgetMap.map', { defaultValue: 'Map {{category}}', category: categoryLabel(category) })
                            : t('admin.budgetMap.addAccount', { defaultValue: 'Add account to {{category}}', category: categoryLabel(category) })}
                        </Button>
                        {accounts.map((account) => {
                          const removeBlocked = account.isPushTarget && accounts.length > 1;
                          return <React.Fragment key={account.id}>
                            <Button variant="ghost" size="sm" onClick={() => { setSaveError(null); setFormTarget({ mode: 'edit', row: account }); }}>
                              {t('admin.budgetMap.editAccount', { defaultValue: 'Edit {{account}}', account: account.erpAccount })}
                            </Button>
                            {!account.isPushTarget && <Button variant="ghost" size="sm" onClick={() => setPushTarget(account)}>
                              {t('admin.budgetMap.usePush', { defaultValue: 'Use {{account}} for budget push', account: account.erpAccount })}
                            </Button>}
                            {removeBlocked
                              ? <span className="self-center text-[12px] text-muted-foreground">{t('admin.budgetMap.removePushHint', 'Make another account the push account to remove this one.')}</span>
                              : <Button variant="ghost" size="sm" onClick={() => setRemoveTarget(account)}>{t('admin.budgetMap.removeAccount', { defaultValue: 'Remove {{account}}', account: account.erpAccount })}</Button>}
                          </React.Fragment>;
                        })}
                      </div>
                    </details>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>

      {formTarget && (
        <MapFormModal
          submitError={saveError}
          target={formTarget}
          hasAccounts={(accountsByCategory.get(formTarget.mode === 'edit' ? formTarget.row.category : formTarget.category)?.length ?? 0) > 0}
          allRows={rows}
          catalogueAccounts={catalogue?.accounts ?? []}
          onClose={() => setFormTarget(null)}
          onSubmit={async (erpAccount) => {
            const target = formTarget;
            const category = target.mode === 'edit' ? target.row.category : target.category;
            try {
              if (target.mode === 'edit') {
                await updateMutation.mutateAsync({ id: target.row.id, erpAccount });
              } else {
                await createMutation.mutateAsync({ category: target.category, erpAccount, isPushTarget: target.isPushTarget });
              }
              toast(t('admin.budgetMap.toast.saved', 'Account map saved'), `${categoryLabel(category)} → ${erpAccount}`, 'success');
              setFormTarget(null);
            } catch (err) {
              const { headline, detail } = classifyMutationError(err);
              setSaveError({ headline, detail });
              toast(headline, detail, 'warning');
            }
          }}
        />
      )}

      <ConfirmDialog
        open={!!removeTarget}
        tone="destructive"
        title={
          !removeTarget
            ? t('admin.budgetMap.confirm.fallbackTitle', 'Unmap category?')
            : removeIsLast
              ? t('admin.budgetMap.confirm.title', { defaultValue: 'Unmap {{category}}?', category: categoryLabel(removeTarget.category) })
              : t('admin.budgetMap.confirmRemove.title', { defaultValue: 'Remove {{account}}?', account: removeTarget.erpAccount })
        }
        description={
          removeIsLast
            ? t('admin.budgetMap.confirm.description', 'The category will have no ERP account. Pushing a budget with a non-zero amount in this category will fail closed until it is mapped again.')
            : t('admin.budgetMap.confirmRemove.description', 'Actuals posted to this account will stop counting toward this category. The budget push is unchanged.')
        }
        confirmLabel={removeIsLast ? t('admin.budgetMap.confirm.confirm', 'Unmap') : t('admin.budgetMap.confirmRemove.confirm', 'Remove')}
        loading={deleteMutation.isPending}
        onConfirm={onRemoveConfirm}
        onCancel={() => setRemoveTarget(null)}
      />

      <ConfirmDialog
        open={confirmProposals}
        title={t('uxs10.confirmTitle', 'Confirm proposed posting accounts?')}
        description={t('uxs10.confirmDescription', { defaultValue: 'This will set the proposed direct-cost account for: {{choices}}. Your existing mappings will not change.', choices: proposals.map((item) => `${categoryLabel(item.category)} → ${item.account}`).join('; ') })}
        confirmLabel={t('uxs10.confirmAction', 'Confirm proposals')}
        loading={createMutation.isPending}
        onConfirm={() => void onProposalConfirm()}
        onCancel={() => setConfirmProposals(false)}
      />

      <ConfirmDialog
        open={!!pushTarget}
        title={
          pushTarget
            ? t('admin.budgetMap.confirmPush.title', {
              defaultValue: 'Push {{category}} to {{account}}?',
              category: categoryLabel(pushTarget.category),
              account: pushTarget.erpAccount,
            })
            : t('admin.budgetMap.confirmPush.fallbackTitle', 'Change push account?')
        }
        description={t(
          'admin.budgetMap.confirmPush.description',
          "Future budget pushes send this category's whole total to this account. A budget already in the ERP keeps its current account until it is pushed again.",
        )}
        confirmLabel={t('admin.budgetMap.confirmPush.confirm', 'Use for push')}
        loading={pushMutation.isPending}
        onConfirm={onPushConfirm}
        onCancel={() => setPushTarget(null)}
      />
    </section>
  );
};

// ── Add / rename account form ───────────────────────────────────────────────

interface MapFormModalProps {
  /** #559: owned by the parent (which owns the mutation), rendered here. */
  submitError: SubmitError | null;
  target: FormTarget;
  /** Does the category already list at least one account? (title: "Map X" vs "Add account to X") */
  hasAccounts: boolean;
  /** Every account row (for the client-side one-category-per-account pre-check). */
  allRows: CategoryAccountMapRow[];
  catalogueAccounts: BudgetPostingAccount[];
  onClose: () => void;
  onSubmit: (erpAccount: string) => Promise<void>;
}

const MapFormModal: React.FC<MapFormModalProps> = ({ target, hasAccounts, allRows, catalogueAccounts, submitError, onClose, onSubmit }) => {
  const { t } = useTranslation();
  const categoryLabel = (value: string) => value === 'Special expenses'
    ? t('budget.category.specialExpenses', 'Special expenses') : value;
  const isEdit = target.mode === 'edit';
  const category = target.mode === 'edit' ? target.row.category : target.category;
  const editingId = target.mode === 'edit' ? target.row.id : null;
  const isPushTarget = target.mode === 'edit' ? target.row.isPushTarget : target.isPushTarget;

  const validate = (v: FormValues): Partial<Record<keyof FormValues, string>> => {
    const errors: Partial<Record<keyof FormValues, string>> = {};
    const trimmed = v.erpAccount.trim();
    if (!trimmed) {
      errors.erpAccount = t('admin.budgetMap.form.required', 'An ERP account is required.');
      return errors;
    }
    // ⚑ FR-BAM-001 client-side pre-check: an account already listed (under ANY category, this row excepted) is
    // named here — the DB's unique(org, erp_account) re-asserts it regardless.
    const conflict = allRows.find((r) => r.erpAccount === trimmed && r.id !== editingId);
    if (conflict) {
      errors.erpAccount = t('admin.budgetMap.form.conflict', {
        defaultValue: '{{account}} is already mapped to {{category}}.',
        account: trimmed,
        category: categoryLabel(conflict.category),
      });
    }
    return errors;
  };

  const form = useEntityForm<FormValues>({
    initialValues: { erpAccount: target.mode === 'edit' ? target.row.erpAccount : '' },
    validate,
    idPrefix: 'budget-account-map-form',
    requiredFields: ['erpAccount'],
    module: 'budget-account-map',
  });

  const field = form.fieldProps('erpAccount');
  const availableAccounts = catalogueAccounts.filter((account) =>
    !account.disabled && !account.isGroup && account.rootType === 'Expense' &&
    (isPushTarget ? isDirectCostPostingAccount(account) : true) &&
    !allRows.some((row) => row.erpAccount === account.account && row.id !== editingId),
  );
  const selectedAccount = catalogueAccounts.find((account) => account.account === field.value);

  const errorSummary = form.errors.erpAccount
    ? [{ fieldId: field.id, message: form.errors.erpAccount }]
    : undefined;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void form.handleSubmit(async (values) => {
      await onSubmit(values.erpAccount.trim());
    });
  };

  const title = isEdit
    ? t('admin.budgetMap.form.editTitle', { defaultValue: 'Edit {{category}} mapping', category: categoryLabel(category) })
    : hasAccounts
      ? t('admin.budgetMap.addAccount', { defaultValue: 'Add account to {{category}}', category: categoryLabel(category) })
      : t('admin.budgetMap.map', { defaultValue: 'Map {{category}}', category: categoryLabel(category) });

  const subtitle = !isPushTarget
    ? t('admin.budgetMap.form.readOnlySubtitle', 'Its actuals count toward this category; its budget is not pushed here')
    : isEdit
      ? t('admin.budgetMap.form.editSubtitle', 'Change the ERP account this category pushes to')
      : t('admin.budgetMap.form.createSubtitle', 'Choose the ERP account this category pushes to');

  return (
    <EntityFormModal
      open
      title={title}
      subtitle={subtitle}
      submitLabel={t('admin.budgetMap.form.save', 'Save mapping')}
      onSubmit={handleSubmit}
      submitError={submitError}
      onClose={onClose}
      loading={form.isSubmitting}
      dirty={form.isDirty}
      submitDisabled={!form.isComplete}
      errorSummary={errorSummary}
    >
      <FormSection legend={t('admin.budgetMap.form.legend', 'Account')}>
        <FormGrid>
          <Combobox
            id={field.id}
            label={t('admin.budgetMap.columns.erpAccount', 'ERP account')}
            required
            value={field.value || null}
            selectedOption={selectedAccount ? {
              value: selectedAccount.account,
              label: selectedAccount.account,
              sub: selectedAccount.parentAccount ?? selectedAccount.rootType,
            } : null}
            onChange={(value) => field.onChange(value)}
            loadOptions={async () => availableAccounts.map((account) => ({
              value: account.account,
              label: account.account,
              sub: account.parentAccount ?? account.rootType,
            }))}
            error={field.error}
            placeholder={t('admin.budgetMap.form.placeholder', 'e.g. 5100 - Direct Costs')}
            searchPlaceholder={t('uxs10.accountSearch', 'Search account name or number')}
            noun={t('uxs10.accountNoun', 'account')}
          />
          {isPushTarget && availableAccounts.length === 0 && <p className="text-[13px] text-muted-foreground">{t('uxs10.noPostingAccounts', 'No unused direct-cost ledger accounts are available. Ask your operator to add a suitable account; overhead is not a substitute.')}</p>}
          {!isPushTarget && <p className="text-[13px] text-muted-foreground">{t('uxs10.countOnlyHelp', 'This account counts toward actuals for the category; budgets are never posted to it.')}</p>}
        </FormGrid>
      </FormSection>
    </EntityFormModal>
  );
};

export default BudgetAccountMap;
