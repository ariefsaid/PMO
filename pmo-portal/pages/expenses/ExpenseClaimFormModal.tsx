import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  EntityFormModal, FormGrid, FormSection, SelectField, TextField, useEntityForm, type SubmitError,
} from '@/src/components/ui';
import { Constants } from '@/src/lib/supabase/database.types';
import { budgetCategoryLabel } from '@/src/lib/i18n/budgetCategoryLabel';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatMoneyInputValue, parseMoneyInputAtScale } from '@/src/lib/format';
import type { BudgetCategory, ExpenseClaimInput, ExpenseKind } from '@/src/lib/db/expenseClaims';

/** Create / edit the header of a claim or an advance (#775, FR-EXP-061). A claim's amount is never entered here
 *  — the server sums its lines (0247 §3). Amounts parse in the user's number locale at 2 decimals (#468). */
export interface ExpenseClaimFormInitial {
  title: string;
  projectId: string | null;
  budgetCategory: BudgetCategory | null;
  purpose: string | null;
  amount: number;
  advanceId: string | null;
}

interface FormValues { title: string; projectId: string; budgetCategory: string; purpose: string; amount: string; advanceId: string }

export interface ExpenseClaimFormModalProps {
  kind: ExpenseKind;
  projectOptions: { value: string; label: string }[];
  advanceOptions: { value: string; label: string }[];
  initial?: ExpenseClaimFormInitial;
  onClose: () => void;
  onSubmit: (input: ExpenseClaimInput) => Promise<void>;
}

export const ExpenseClaimFormModal: React.FC<ExpenseClaimFormModalProps> = ({
  kind, projectOptions, advanceOptions, initial, onClose, onSubmit,
}) => {
  const { t } = useTranslation();
  const validate = useMemo(
    () => (v: FormValues): Partial<Record<keyof FormValues, string>> => {
      const errors: Partial<Record<keyof FormValues, string>> = {};
      if (!v.title.trim()) errors.title = t('expenses.form.errors.titleRequired', 'Give it a short title.');
      if (kind === 'advance') {
        const amount = parseMoneyInputAtScale(v.amount, 2);
        if (amount === null || !(amount > 0)) errors.amount = t('expenses.form.errors.amountPositive', 'Enter an amount greater than zero.');
      }
      return errors;
    },
    [t, kind],
  );
  const form = useEntityForm<FormValues>({
    initialValues: {
      title: initial?.title ?? '',
      projectId: initial?.projectId ?? '',
      budgetCategory: initial?.budgetCategory ?? '',
      purpose: initial?.purpose ?? '',
      amount: initial && kind === 'advance' ? formatMoneyInputValue(initial.amount) : '',
      advanceId: initial?.advanceId ?? '',
    },
    validate,
    idPrefix: 'expense-form',
    requiredFields: kind === 'advance' ? ['title', 'amount'] : ['title'],
    module: 'expenses',
  });
  const titleField = form.fieldProps('title');
  const projectField = form.fieldProps('projectId');
  const categoryField = form.fieldProps('budgetCategory');
  const purposeField = form.fieldProps('purpose');
  const amountField = form.fieldProps('amount');
  const advanceField = form.fieldProps('advanceId');
  const [saveError, setSaveError] = useState<SubmitError | null>(null);

  const categoryOptions = useMemo(
    () => [
      { value: '', label: t('expenses.form.category.none', 'No category') },
      ...Constants.public.Enums.budget_category.map((c) => ({ value: c, label: budgetCategoryLabel(c, t) })),
    ],
    [t],
  );
  const errorSummary = [
    form.errors.title ? { fieldId: titleField.id, message: form.errors.title } : null,
    form.errors.amount ? { fieldId: amountField.id, message: form.errors.amount } : null,
  ].filter((item): item is { fieldId: string; message: string } => item !== null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void form.handleSubmit(async (values) => {
      const input: ExpenseClaimInput = {
        kind,
        title: values.title.trim(),
        purpose: values.purpose.trim() || null,
        projectId: values.projectId || null,
        budgetCategory: (values.budgetCategory || null) as BudgetCategory | null,
        ...(kind === 'advance' ? { amount: parseMoneyInputAtScale(values.amount, 2) ?? 0 } : {}),
        ...(kind === 'claim' ? { advanceId: values.advanceId || null } : {}),
      };
      try {
        await onSubmit(input);
      } catch (err) {
        const { headline, detail } = classifyMutationError(err);
        setSaveError({ headline, detail });
      }
    });
  };

  const title = initial
    ? t('expenses.form.editTitle', 'Edit details')
    : kind === 'advance'
      ? t('expenses.form.advanceTitle', 'Request a cash advance')
      : t('expenses.form.claimTitle', 'New expense claim');
  const subtitle = kind === 'advance'
    ? t('expenses.form.advanceSubtitle', 'Cash you take before the work. Claims you file afterwards settle it.')
    : t('expenses.form.claimSubtitle', 'Add lines and receipts on the next screen.');

  return (
    <EntityFormModal
      open
      title={title}
      subtitle={subtitle}
      submitLabel={initial ? t('expenses.form.submitSave', 'Save') : t('expenses.form.submitCreate', 'Create')}
      onSubmit={handleSubmit}
      onClose={onClose}
      loading={form.isSubmitting}
      dirty={form.isDirty}
      submitDisabled={!form.isComplete}
      errorSummary={errorSummary}
      submitError={saveError}
    >
      <FormSection legend={t('expenses.form.sections.details', 'Details')}>
        <FormGrid>
          <TextField id={titleField.id} label={t('expenses.form.title.label', 'Title')} required value={titleField.value}
            onChange={titleField.onChange} onBlur={titleField.onBlur} error={titleField.error}
            placeholder={t('expenses.form.title.placeholder', 'e.g. Site visit, week 41')} fullWidth />
          <SelectField id={projectField.id} label={t('expenses.form.project.label', 'Project')} value={projectField.value}
            onChange={(v) => projectField.onChange(v)} onBlur={projectField.onBlur}
            options={[{ value: '', label: t('expenses.form.project.none', 'Overhead (no project)') }, ...projectOptions]} />
          <SelectField id={categoryField.id} label={t('expenses.form.category.label', 'Budget category')} value={categoryField.value}
            onChange={(v) => categoryField.onChange(v)} onBlur={categoryField.onBlur} options={categoryOptions}
            helper={t('expenses.form.category.helper', "Decides who approves: spend within the project's budget for this category goes to the project's approver.")} />
          {kind === 'advance' && (
            <TextField id={amountField.id} label={t('expenses.form.amount.label', 'Amount')} required inputMode="decimal"
              value={amountField.value} onChange={amountField.onChange} onBlur={amountField.onBlur} error={amountField.error} />
          )}
          {kind === 'claim' && advanceOptions.length > 0 && (
            <SelectField id={advanceField.id} label={t('expenses.form.advance.label', 'Settle against advance')} value={advanceField.value}
              onChange={(v) => advanceField.onChange(v)} onBlur={advanceField.onBlur}
              options={[{ value: '', label: t('expenses.form.advance.none', 'No advance') }, ...advanceOptions]} />
          )}
          <TextField id={purposeField.id} label={t('expenses.form.purpose.label', 'Purpose')} value={purposeField.value}
            onChange={purposeField.onChange} onBlur={purposeField.onBlur}
            placeholder={t('expenses.form.purpose.placeholder', 'What the money was for')} fullWidth />
        </FormGrid>
      </FormSection>
    </EntityFormModal>
  );
};
