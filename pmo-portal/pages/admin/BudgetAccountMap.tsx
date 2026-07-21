import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ListState,
  ConfirmDialog,
  EntityFormModal,
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
  const may = usePermission();
  const canManage = may('manage', 'integration');
  const { toast } = useToast();
  const qc = useQueryClient();

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

  const invalidate = () => qc.invalidateQueries({ queryKey: ['budget-category-account-map'] });

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
      toast('Category unmapped', category, 'success');
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
        title="Couldn't load the account map"
        sub="The request failed. Check your connection and try again."
        onRetry={() => refetch()}
      />
    );
  }

  return (
    <section aria-label="Budget category to ERP account map">
      <h2 className="text-[15px] font-semibold tracking-[-0.01em]">Budget account map</h2>
      <p className="mt-1 text-[13px] text-muted-foreground">
        Every budget category must map to an ERP account before its amount can be pushed. An
        unmapped category blocks the push for the WHOLE budget, not just that line.
      </p>
      <table className="mt-3.5 w-full border-collapse">
        <thead>
          <tr>
            <th className="h-[38px] border-b border-border bg-card px-3 text-left text-[11.5px] font-semibold uppercase tracking-[0.03em] text-muted-foreground">
              Category
            </th>
            <th className="h-[38px] border-b border-border bg-card px-3 text-left text-[11.5px] font-semibold uppercase tracking-[0.03em] text-muted-foreground">
              ERP account
            </th>
            {canManage && (
              <th className="h-[38px] border-b border-border bg-card px-3 text-right text-[11.5px] font-semibold uppercase tracking-[0.03em] text-muted-foreground">
                Actions
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {BUDGET_CATEGORIES.map((category) => {
            const account = accountByCategory.get(category);
            return (
              <tr key={category}>
                <td className="border-b border-border px-3 py-2 text-[13.5px] font-medium">{category}</td>
                <td className="border-b border-border px-3 py-2 text-[13.5px]">
                  {account ? account : <StatusPill variant="neutral">Not mapped</StatusPill>}
                </td>
                {canManage && (
                  <td className="border-b border-border px-3 py-2 text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEditTarget({ category, existing: account ?? null })}
                      >
                        {account ? `Edit ${category}` : `Map ${category}`}
                      </Button>
                      {account && (
                        <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(category)}>
                          {`Unmap ${category}`}
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
              toast('Account map saved', `${editTarget.category} → ${erpAccount}`, 'success');
              setEditTarget(null);
            } catch (err) {
              const { headline, detail } = classifyMutationError(err);
              toast(headline, detail, 'warning');
            }
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        tone="destructive"
        title={deleteTarget ? `Unmap ${deleteTarget}?` : 'Unmap category?'}
        description="The category will have no ERP account. Pushing a budget with a non-zero amount in this category will fail closed until it is mapped again."
        confirmLabel="Unmap"
        loading={deleteMutation.isPending}
        onConfirm={onDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
    </section>
  );
};

// ── Create / edit form modal ────────────────────────────────────────────────

interface MapFormModalProps {
  category: BudgetCategory;
  /** The category's CURRENT account, or null when it is unmapped (create vs update). */
  existing: string | null;
  /** Every currently-mapped row (for the client-side bijection pre-check). */
  allRows: CategoryAccountMapRow[];
  onClose: () => void;
  onSubmit: (erpAccount: string) => Promise<void>;
}

const MapFormModal: React.FC<MapFormModalProps> = ({ category, existing, allRows, onClose, onSubmit }) => {
  const isEdit = existing !== null;

  const validate = (v: FormValues): Partial<Record<keyof FormValues, string>> => {
    const errors: Partial<Record<keyof FormValues, string>> = {};
    const trimmed = v.erpAccount.trim();
    if (!trimmed) {
      errors.erpAccount = 'An ERP account is required.';
      return errors;
    }
    // ⚑ FR-BUD-111 the bijection, client-side pre-check: an account already backing a DIFFERENT
    // category is named here — the DB's unique(org, erp_account) re-asserts this regardless.
    const conflict = allRows.find((r) => r.erpAccount === trimmed && r.category !== category);
    if (conflict) {
      errors.erpAccount = `${trimmed} is already mapped to ${conflict.category}.`;
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
      title={isEdit ? `Edit ${category} mapping` : `Map ${category}`}
      subtitle={isEdit ? 'Change the ERP account this category pushes to' : 'Choose the ERP account this category pushes to'}
      submitLabel={isEdit ? 'Save mapping' : 'Save mapping'}
      onSubmit={handleSubmit}
      onClose={onClose}
      loading={form.isSubmitting}
      dirty={form.isDirty}
      submitDisabled={!form.isComplete}
      errorSummary={errorSummary}
    >
      <FormSection legend="Account">
        <FormGrid>
          <TextField
            id={field.id}
            label="ERP account"
            required
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
            error={field.error}
            placeholder="e.g. 5100 - Direct Costs"
            fullWidth
          />
        </FormGrid>
      </FormSection>
    </EntityFormModal>
  );
};

export default BudgetAccountMap;
