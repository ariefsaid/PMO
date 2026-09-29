import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ListState,
  ConfirmDialog,
  EntityFormModal,
  type SubmitError,
  TextField,
  FormGrid,
  FormSection,
  StatusPill,
  Button,
  useToast,
  useEntityForm,
} from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import {
  listBudgetCategoryAccountMap,
  createBudgetCategoryAccountMapRow,
  updateBudgetCategoryAccountMapRow,
  deleteBudgetCategoryAccountMapRow,
  type CategoryAccountMapRow,
  type BudgetCategory,
} from '@/src/lib/repositories/budgetProjection';

/**
 * Administration › Budget account map (P3c slice 6, FR-BUD-110..113) — the Admin CRUD surface for
 * `budget_category_account_map`: PMO's 7 fixed `budget_category` values, each mapped (or not) to an
 * ERP account. Every row is ALWAYS shown, mapped or not — an unmapped category is exactly the state
 * that FAILS CLOSED at the next push (`categoryAccountMap.ts`'s `BudgetCategoryUnmappedError`), so it
 * must stay visible, not hidden.
 *
 * ⚑ Admin-only (FR-BUD-112, deliberately stricter than OD-BUDGET-3): gated on `can('manage',
 * 'integration', ctx)` — the map is a per-org accounting-config change, the same class of affordance
 * as connecting/disconnecting an external tier, and RLS enforces the identical Admin-only predicate
 * server-side (`budget_category_account_map_write`). This is UX only; RLS is the authority (ADR-0016).
 *
 * ⚑ The BIJECTION (FR-BUD-111): a category may map to only one account, and an account may back only
 * one category — both directions are DB-unique. A conflicting account is checked CLIENT-SIDE against
 * the loaded rows before submit, naming the conflicting category in the form (not a raw 23505), and is
 * re-asserted by the DB regardless (the FE check is a courtesy, never the enforcement).
 */

const BUDGET_CATEGORIES: BudgetCategory[] = [
  'Labor',
  'Materials',
  'Subcontractors',
  'Equipment',
  'Permits & Fees',
  'Overheads',
  'Contingency',
];

interface FormValues {
  erpAccount: string;
}

const BudgetAccountMap: React.FC = () => {
  const { t } = useTranslation();
  const may = usePermission();
  const canManage = may('manage', 'integration');
  const { toast } = useToast();
  const qc = useQueryClient();
  const sectionRef = useRef<HTMLElement>(null);

  const { data, isPending, isError, refetch } = useQuery<CategoryAccountMapRow[]>({
    queryKey: ['budget-category-account-map'],
    queryFn: listBudgetCategoryAccountMap,
  });

  const rows = useMemo(() => data ?? [], [data]);
  const accountByCategory = useMemo(
    () => new Map(rows.map((r) => [r.category, r.erpAccount])),
    [rows],
  );

  const [editTarget, setEditTarget] = useState<{ category: BudgetCategory; existing: string | null } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BudgetCategory | null>(null);
  // #559 / AC-ERR-001: the mapping form fires and forgets — this component owns the mutation and
  // its rejection — so the error is held here and threaded into the dialog.
  const [saveError, setSaveError] = useState<SubmitError | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['budget-category-account-map'] });

  // AC-ADMIA-004 (fragment deep-link): the accounting link targets `#budget-account-map`, and the
  // shell preserves that fragment across the compatibility redirect. A history-API navigation that
  // lands on a fragment (replace + async panel mount) does NOT auto-scroll the way an in-page anchor
  // click does, so once the map has loaded we scroll/focus its own deep-link target. Focus moves to
  // the map heading without trapping focus; the global focus ring is the only visual affordance
  // (no new visual token). Runs only when the whole map has rendered (the pending branch returns
  // before the section, so the ref is null until `mapLoaded` flips). Declared before the early
  // returns so the hook order never changes across the loading → loaded transition (Rules of Hooks).
  // ⚑ The ROUTER hash is the single source of truth (URL is the canonical route model), not
  // `window.location.hash` — so a MemoryRouter navigation that changes the fragment re-fires this
  // while the panel stays mounted and loaded, and is testable without mutating a global.
  const { hash } = useLocation();
  const mapLoaded = !isPending && !isError;
  useEffect(() => {
    if (!mapLoaded || !sectionRef.current) return;
    if (hash !== '#budget-account-map') return;
    sectionRef.current.scrollIntoView({ block: 'start' });
    sectionRef.current.focus({ preventScroll: true });
  }, [mapLoaded, hash]);

  const createMutation = useMutation({
    mutationFn: (v: { category: BudgetCategory; erpAccount: string }) =>
      createBudgetCategoryAccountMapRow(v.category, v.erpAccount),
    onSuccess: invalidate,
  });
  const updateMutation = useMutation({
    mutationFn: (v: { category: BudgetCategory; erpAccount: string }) =>
      updateBudgetCategoryAccountMapRow(v.category, v.erpAccount),
    onSuccess: invalidate,
  });
  const deleteMutation = useMutation({
    mutationFn: (category: BudgetCategory) => deleteBudgetCategoryAccountMapRow(category),
    onSuccess: invalidate,
  });

  const onDeleteConfirm = async () => {
    if (!deleteTarget) return;
    const category = deleteTarget;
    try {
      await deleteMutation.mutateAsync(category);
      toast(t('admin.budgetMap.toast.unmapped', 'Category unmapped'), category, 'success');
      setDeleteTarget(null);
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
    }
  };

  if (isPending) {
    return (
      <div className="rounded-lg border border-border bg-card">
        <ListState variant="loading" rows={7} testId="budget-account-map-loading" />
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
    // ⚑ I-8 (rendered Discover pass, 2026-07-22) — the budget projection's "categories need an ERP
    // account" banner LINKS here (`/administration/accounting#budget-account-map`), so the anchor is
    // part of the contract, not decoration.
    <section
      id="budget-account-map"
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
      {/* ⚑ AC-MOBILE-OVERFLOW-001 (audit round 6 e2e run) — at 390px this table's min-content width is
          541px (the "Not mapped — blocks every push" pill plus a "Map <Category>" control), so it bled
          151px past the viewport with no scroller to excuse it. Same remedy as the budget projection's
          grid: below `sm` each row is a stacked label/value card — nothing is clipped, nothing pans —
          and it is an ordinary table from `sm` up. One markup tree, one render. */}
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
            const account = accountByCategory.get(category);
            return (
              <tr key={category} className="block border-b border-border py-2 sm:table-row sm:py-0">
                <td className="block px-3 py-1 text-[13.5px] font-medium sm:table-cell sm:border-b sm:border-border sm:py-2">
                  {category}
                </td>
                <td className="block px-3 py-1 text-[13.5px] sm:table-cell sm:border-b sm:border-border sm:py-2">
                  {/* ⚑ I-8 — an operator arriving from the budget banner asks one question: WHICH of
                      these is blocking my push? "Not mapped" is a description; it never says that the
                      consequence is project-wide. The page's own copy above already states the rule —
                      an unmapped category blocks the WHOLE budget — so the row says it too, where the
                      decision is actually made. */}
                  {account ? (
                    account
                  ) : (
                    <StatusPill variant="warn">{t('admin.budgetMap.unmapped', 'Not mapped — blocks every push')}</StatusPill>
                  )}
                </td>
                {canManage && (
                  <td className="block px-3 py-1 text-right sm:table-cell sm:border-b sm:border-border sm:py-2">
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEditTarget({ category, existing: account ?? null })}
                      >
                        {account
                          ? t('admin.budgetMap.edit', { defaultValue: 'Edit {{category}}', category })
                          : t('admin.budgetMap.map', { defaultValue: 'Map {{category}}', category })}
                      </Button>
                      {account && (
                        <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(category)}>
                          {t('admin.budgetMap.unmap', { defaultValue: 'Unmap {{category}}', category })}
                        </Button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>

      {editTarget && (
        <MapFormModal
          submitError={saveError}
          category={editTarget.category}
          existing={editTarget.existing}
          allRows={rows}
          onClose={() => setEditTarget(null)}
          onSubmit={async (erpAccount) => {
            try {
              if (editTarget.existing !== null) {
                await updateMutation.mutateAsync({ category: editTarget.category, erpAccount });
              } else {
                await createMutation.mutateAsync({ category: editTarget.category, erpAccount });
              }
              toast(
                t('admin.budgetMap.toast.saved', 'Account map saved'),
                `${editTarget.category} → ${erpAccount}`,
                'success',
              );
              setEditTarget(null);
            } catch (err) {
              const { headline, detail } = classifyMutationError(err);
              setSaveError({ headline, detail });
              toast(headline, detail, 'warning');
            }
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        tone="destructive"
        title={
          deleteTarget
            ? t('admin.budgetMap.confirm.title', { defaultValue: 'Unmap {{category}}?', category: deleteTarget })
            : t('admin.budgetMap.confirm.fallbackTitle', 'Unmap category?')
        }
        description={t(
          'admin.budgetMap.confirm.description',
          'The category will have no ERP account. Pushing a budget with a non-zero amount in this category will fail closed until it is mapped again.',
        )}
        confirmLabel={t('admin.budgetMap.confirm.confirm', 'Unmap')}
        loading={deleteMutation.isPending}
        onConfirm={onDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
    </section>
  );
};

// ── Create / edit form modal ────────────────────────────────────────────────

interface MapFormModalProps {
  /** #559: owned by the parent (which owns the mutation), rendered here. */
  submitError: SubmitError | null;
  category: BudgetCategory;
  /** The category's CURRENT account, or null when it is unmapped (create vs update). */
  existing: string | null;
  /** Every currently-mapped row (for the client-side bijection pre-check). */
  allRows: CategoryAccountMapRow[];
  onClose: () => void;
  onSubmit: (erpAccount: string) => Promise<void>;
}

const MapFormModal: React.FC<MapFormModalProps> = ({ category, existing, allRows, submitError, onClose, onSubmit }) => {
  const { t } = useTranslation();
  const isEdit = existing !== null;

  const validate = (v: FormValues): Partial<Record<keyof FormValues, string>> => {
    const errors: Partial<Record<keyof FormValues, string>> = {};
    const trimmed = v.erpAccount.trim();
    if (!trimmed) {
      errors.erpAccount = t('admin.budgetMap.form.required', 'An ERP account is required.');
      return errors;
    }
    // ⚑ FR-BUD-111 the bijection, client-side pre-check: an account already backing a DIFFERENT
    // category is named here — the DB's unique(org, erp_account) re-asserts this regardless.
    const conflict = allRows.find((r) => r.erpAccount === trimmed && r.category !== category);
    if (conflict) {
      errors.erpAccount = t('admin.budgetMap.form.conflict', {
        defaultValue: '{{account}} is already mapped to {{category}}.',
        account: trimmed,
        category: conflict.category,
      });
    }
    return errors;
  };

  const form = useEntityForm<FormValues>({
    initialValues: { erpAccount: existing ?? '' },
    validate,
    idPrefix: 'budget-account-map-form',
    requiredFields: ['erpAccount'],
    module: 'budget-account-map',
  });

  const field = form.fieldProps('erpAccount');

  const errorSummary = form.errors.erpAccount
    ? [{ fieldId: field.id, message: form.errors.erpAccount }]
    : undefined;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void form.handleSubmit(async (values) => {
      await onSubmit(values.erpAccount.trim());
    });
  };

  return (
    <EntityFormModal
      open
      title={
        isEdit
          ? t('admin.budgetMap.form.editTitle', { defaultValue: 'Edit {{category}} mapping', category })
          : t('admin.budgetMap.map', { defaultValue: 'Map {{category}}', category })
      }
      subtitle={
        isEdit
          ? t('admin.budgetMap.form.editSubtitle', 'Change the ERP account this category pushes to')
          : t('admin.budgetMap.form.createSubtitle', 'Choose the ERP account this category pushes to')
      }
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
          <TextField
            id={field.id}
            label={t('admin.budgetMap.columns.erpAccount', 'ERP account')}
            required
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
            error={field.error}
            placeholder={t('admin.budgetMap.form.placeholder', 'e.g. 5100 - Direct Costs')}
            fullWidth
          />
        </FormGrid>
      </FormSection>
    </EntityFormModal>
  );
};

export default BudgetAccountMap;
