import React, { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button, EntityFormModal, FormGrid, FormSection, GateNotice, SelectField, TextField, useEntityForm, type SubmitError,
} from '@/src/components/ui';
import { Constants } from '@/src/lib/supabase/database.types';
import { budgetCategoryLabel } from '@/src/lib/i18n/budgetCategoryLabel';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatMoneyInputValue, parseMoneyInputAtScale } from '@/src/lib/format';
import type { BudgetCategory, ExpenseClaimInput, ExpenseKind, ExpenseLineInput, ExpenseType } from '@/src/lib/db/expenseClaims';
import { RECEIPT_INPUT_ACCEPT } from '@/src/lib/db/expenseReceipts';
import { useExpensePostingReadiness } from '@/src/hooks/useExpensePostingReadiness';
import { expenseTypeLabel } from './expenseLabels';

/** S-12 (RF-060): before a NEW draft exists, say plainly when it will not reach accounting. PMO-only capture
 *  stays available; this is display only — it never blocks, switches posting on, or re-queues older claims. */
const PostingReadinessNote: React.FC = () => {
  const { t } = useTranslation();
  const { state } = useExpensePostingReadiness();
  if (state === 'checking' || state === 'ready') return null;
  const message = state === 'unavailable'
    ? t('uxs12.expensePosting.formUnknown', "Couldn't check whether expense posting is active. You can still save this in PMO.")
    : state === 'inactive'
      ? t('uxs12.expensePosting.formInactive', "ERPNext is connected, but expense posting isn't switched on. You can still save this in PMO, but it won't reach accounting. An Admin can switch posting on in Integrations.")
      : t('uxs12.expensePosting.formNotConnected', "Expense posting to accounting isn't active. You can still save this in PMO, but it won't reach accounting.");
  return <GateNotice variant="blocked" role="status" className="mb-3">{message}</GateNotice>;
};

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

interface FormValues {
  title: string;
  projectId: string;
  budgetCategory: string;
  purpose: string;
  amount: string;
  advanceId: string;
  expenseDate: string;
  expenseType: string;
  expenseDescription: string;
  expenseAmount: string;
}

export interface ExpenseClaimCaptureDraft {
  firstLine: ExpenseLineInput | null;
  receiptFile: File | null;
}

export interface ExpenseCategoryPrecedent {
  projectId: string;
  budgetCategory: BudgetCategory;
  sourceTitle: string;
}

export interface ExpenseCaptureRecoveryView {
  claimId: string;
  draftSaved: boolean;
  phase: string;
  attachment: { fileId: string; path: string | null; state: string } | null;
}

export interface ExpenseClaimFormModalProps {
  kind: ExpenseKind;
  projectOptions: { value: string; label: string }[];
  advanceOptions: { value: string; label: string }[];
  categoryPrecedents?: ExpenseCategoryPrecedent[];
  captureRecovery?: ExpenseCaptureRecoveryView | null;
  initial?: ExpenseClaimFormInitial;
  onClose: () => void;
  onOpenSavedDraft?: () => Promise<void>;
  onSubmit: (input: ExpenseClaimInput, capture?: ExpenseClaimCaptureDraft) => Promise<void>;
}

export const ExpenseClaimFormModal: React.FC<ExpenseClaimFormModalProps> = ({
  kind, projectOptions, advanceOptions, categoryPrecedents = [], captureRecovery = null, initial, onClose, onOpenSavedDraft, onSubmit,
}) => {
  const { t } = useTranslation();
  const validate = useMemo(
    () => (v: FormValues): Partial<Record<keyof FormValues, string>> => {
      const errors: Partial<Record<keyof FormValues, string>> = {};
      if (!v.title.trim()) errors.title = t('expenses.form.errors.titleRequired', 'Give it a short title.');
      const hasFirstLine = Boolean(v.expenseDate || v.expenseType || v.expenseDescription.trim() || v.expenseAmount.trim());
      if (kind === 'claim' && !initial && hasFirstLine) {
        if (!v.expenseDate) errors.expenseDate = t('expenses.lines.errors.dateRequired', 'Enter the date of the expense.');
        if (!v.expenseType) errors.expenseType = t('uxs29.expenseCapture.expenseTypeRequired', 'Choose an expense type.');
        if (!v.expenseDescription.trim()) errors.expenseDescription = t('expenses.lines.errors.descriptionRequired', 'Describe the expense.');
        const lineAmount = parseMoneyInputAtScale(v.expenseAmount, 2);
        if (lineAmount === null || !(lineAmount > 0)) errors.expenseAmount = t('expenses.lines.errors.amountPositive', 'Enter an amount greater than zero.');
      }
      if (kind === 'advance') {
        const amount = parseMoneyInputAtScale(v.amount, 2);
        if (amount === null || !(amount > 0)) errors.amount = t('expenses.form.errors.amountPositive', 'Enter an amount greater than zero.');
      }
      return errors;
    },
    [t, kind, initial],
  );
  const form = useEntityForm<FormValues>({
    initialValues: {
      title: initial?.title ?? '',
      projectId: initial?.projectId ?? '',
      budgetCategory: initial?.budgetCategory ?? '',
      purpose: initial?.purpose ?? '',
      amount: initial && kind === 'advance' ? formatMoneyInputValue(initial.amount) : '',
      advanceId: initial?.advanceId ?? '',
      expenseDate: '',
      expenseType: '',
      expenseDescription: '',
      expenseAmount: '',
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
  const expenseDateField = form.fieldProps('expenseDate');
  const expenseTypeField = form.fieldProps('expenseType');
  const expenseDescriptionField = form.fieldProps('expenseDescription');
  const expenseAmountField = form.fieldProps('expenseAmount');
  const hasFirstLine = Boolean(
    form.values.expenseDate || form.values.expenseType || form.values.expenseDescription.trim() || form.values.expenseAmount.trim(),
  );
  const [saveError, setSaveError] = useState<SubmitError | null>(null);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [titleManuallyEdited, setTitleManuallyEdited] = useState(Boolean(initial));
  const [categoryManuallyEdited, setCategoryManuallyEdited] = useState(Boolean(initial));
  const receiptInputRef = useRef<HTMLInputElement>(null);

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
    form.errors.expenseDate ? { fieldId: expenseDateField.id, message: form.errors.expenseDate } : null,
    form.errors.expenseType ? { fieldId: expenseTypeField.id, message: form.errors.expenseType } : null,
    form.errors.expenseDescription ? { fieldId: expenseDescriptionField.id, message: form.errors.expenseDescription } : null,
    form.errors.expenseAmount ? { fieldId: expenseAmountField.id, message: form.errors.expenseAmount } : null,
  ].filter((item): item is { fieldId: string; message: string } => item !== null);

  const filenameTitle = (file: File | null) => file?.name.replace(/\.[^.]+$/, '').trim() || file?.name || '';
  const setSuggestedTitle = (description: string, file = receiptFile) => {
    if (!titleManuallyEdited) form.setValue('title', description.trim() || filenameTitle(file));
  };
  const currentCategoryPrecedent = categoryPrecedents.find((item) => item.projectId === projectField.value);
  const recoveryPending = Boolean(captureRecovery?.draftSaved && captureRecovery.phase !== 'complete');

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
        const lineAmount = parseMoneyInputAtScale(values.expenseAmount, 2);
        const hasFirstLine = Boolean(values.expenseDate || values.expenseType || values.expenseDescription.trim() || values.expenseAmount.trim());
        const capture = kind === 'claim' && !initial
          ? {
            firstLine: hasFirstLine && lineAmount !== null
              ? {
                expenseDate: values.expenseDate,
                expenseType: values.expenseType as ExpenseType,
                description: values.expenseDescription.trim(),
                amount: lineAmount,
              }
              : null,
            receiptFile,
          }
          : undefined;
        await onSubmit(input, capture);
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
    : !initial
      ? t('uxs29.expenseCapture.claimSubtitle', 'Start with a receipt or first expense line. You can add more after saving.')
      : t('expenses.form.claimSubtitle', 'Add lines and receipts on the next screen.');

  return (
    <EntityFormModal
      open
      title={title}
      subtitle={subtitle}
      submitLabel={recoveryPending
        ? t('uxs29.expenseCapture.retryReceipt', 'Retry receipt')
        : initial ? t('expenses.form.submitSave', 'Save') : t('expenses.form.submitCreate', 'Create')}
      onSubmit={handleSubmit}
      onClose={() => { if (!recoveryPending) onClose(); }}
      loading={form.isSubmitting}
      dirty={form.isDirty || receiptFile !== null}
      submitDisabled={!form.isComplete}
      errorSummary={errorSummary}
      submitError={saveError}
    >
      {!initial && <PostingReadinessNote />}
      {recoveryPending && (
        <div className="mb-3 rounded-md border border-border bg-muted/40 p-3">
          <p role="status" className="text-sm text-foreground">
            {t('uxs29.expenseCapture.draftSavedReceiptPending', 'Your draft is saved. The receipt is not attached yet. Retry to finish this draft, or open it and attach a receipt later.')}
          </p>
          {onOpenSavedDraft && (
            <Button variant="outline" size="sm" className="mt-2" onClick={() => {
              void onOpenSavedDraft().catch((err: unknown) => {
                const { headline, detail } = classifyMutationError(err);
                setSaveError({ headline, detail });
              });
            }}>
              {t('uxs29.expenseCapture.openSavedDraft', 'Open saved draft')}
            </Button>
          )}
        </div>
      )}
      {kind === 'claim' && !initial && (
        <FormSection legend={t('uxs29.expenseCapture.firstExpense', 'First expense')}>
          <p className="mb-2 text-xs text-muted-foreground">
            {t('uxs29.expenseCapture.firstExpenseHelp', 'Add a receipt, a complete expense line, or both. No receipt upload starts until you save.')}
          </p>
          <FormGrid>
            <div className="col-span-full flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{t('uxs29.expenseCapture.receipt', 'Receipt (optional)')}</span>
              <input
                ref={receiptInputRef}
                type="file"
                accept={RECEIPT_INPUT_ACCEPT}
                className="sr-only"
                tabIndex={-1}
                aria-label={t('uxs29.expenseCapture.chooseReceiptFile', 'Choose a receipt file')}
                disabled={recoveryPending}
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  event.target.value = '';
                  setReceiptFile(file);
                  if (file && !form.values.expenseDescription.trim()) setSuggestedTitle('', file);
                  else if (!file && !form.values.expenseDescription.trim()) setSuggestedTitle('');
                }}
              />
              <Button variant="outline" size="sm" disabled={recoveryPending} onClick={() => receiptInputRef.current?.click()}>
                {t('uxs29.expenseCapture.chooseReceipt', 'Choose receipt')}
              </Button>
              {receiptFile && (
                <span className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
                  <span className="max-w-52 truncate" title={receiptFile.name}>{receiptFile.name}</span>
                  <Button variant="ghost" size="sm" disabled={recoveryPending} onClick={() => {
                    setReceiptFile(null);
                    if (!form.values.expenseDescription.trim()) setSuggestedTitle('');
                  }}>
                    {t('uxs29.expenseCapture.removeReceipt', 'Remove')}
                  </Button>
                </span>
              )}
            </div>
            <TextField id={expenseDateField.id} type="date" label={t('expenses.lines.date', 'Date')} required={hasFirstLine}
              value={expenseDateField.value} onChange={expenseDateField.onChange} onBlur={expenseDateField.onBlur}
              error={expenseDateField.error} disabled={recoveryPending} />
            <SelectField id={expenseTypeField.id} label={t('expenses.lines.type', 'Type')} value={expenseTypeField.value} required={hasFirstLine}
              onChange={(value) => expenseTypeField.onChange(value)} onBlur={expenseTypeField.onBlur}
              error={expenseTypeField.error}
              options={Constants.public.Enums.expense_type.map((value) => ({ value, label: expenseTypeLabel(value, t) }))}
              placeholder={t('uxs29.expenseCapture.expenseTypePlaceholder', 'Choose a type')} disabled={recoveryPending} />
            <TextField id={expenseDescriptionField.id} label={t('expenses.lines.description', 'Description')} required={hasFirstLine}
              value={expenseDescriptionField.value}
              onChange={(value) => {
                expenseDescriptionField.onChange(value);
                setSuggestedTitle(value);
              }}
              onBlur={expenseDescriptionField.onBlur} error={expenseDescriptionField.error} fullWidth disabled={recoveryPending} />
            <TextField id={expenseAmountField.id} inputMode="decimal" label={t('expenses.lines.amount', 'Amount')} required={hasFirstLine}
              value={expenseAmountField.value} onChange={expenseAmountField.onChange} onBlur={expenseAmountField.onBlur}
              error={expenseAmountField.error} disabled={recoveryPending} />
          </FormGrid>
        </FormSection>
      )}
      <FormSection legend={t('expenses.form.sections.details', 'Details')}>
        <FormGrid>
          <TextField id={titleField.id} label={t('expenses.form.title.label', 'Title')} required value={titleField.value}
            onChange={(value) => { setTitleManuallyEdited(true); titleField.onChange(value); }} onBlur={titleField.onBlur} error={titleField.error}
            placeholder={t('expenses.form.title.placeholder', 'e.g. Site visit, week 41')} fullWidth disabled={recoveryPending} />
          <SelectField id={projectField.id} label={t('expenses.form.project.label', 'Project')} value={projectField.value}
            disabled={recoveryPending}
            onChange={(v) => {
              projectField.onChange(v);
              if (!categoryManuallyEdited) {
                const precedent = categoryPrecedents.find((item) => item.projectId === v);
                form.setValue('budgetCategory', precedent?.budgetCategory ?? '');
              }
            }} onBlur={projectField.onBlur}
            options={[{ value: '', label: t('expenses.form.project.none', 'Overhead (no project)') }, ...projectOptions]} />
          <SelectField id={categoryField.id} label={t('expenses.form.category.label', 'Budget category')} value={categoryField.value}
            disabled={recoveryPending}
            onChange={(v) => { setCategoryManuallyEdited(true); categoryField.onChange(v); }} onBlur={categoryField.onBlur} options={categoryOptions}
            helper={t('expenses.form.category.helper', "Decides who approves: spend within the project's budget for this category goes to the project's approver.")} />
          {!initial && !categoryManuallyEdited && currentCategoryPrecedent && (
            <p className="col-span-full text-xs text-muted-foreground" role="note">
              {t('uxs29.expenseCapture.categorySource', 'Suggested from your most recent same-project claim: {{title}}.', { title: currentCategoryPrecedent.sourceTitle })}
            </p>
          )}
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
            placeholder={t('expenses.form.purpose.placeholder', 'What the money was for')} fullWidth disabled={recoveryPending} />
        </FormGrid>
      </FormSection>
    </EntityFormModal>
  );
};
