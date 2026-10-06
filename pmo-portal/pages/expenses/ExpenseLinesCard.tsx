import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button, Card, CardHead, CardPad, ConfirmDialog, EntityFormModal, FormGrid, FormSection, ListState, SelectField,
  TextField, useEntityForm, useToast, type SubmitError,
} from '@/src/components/ui';
import { useExpenseClaimMutations } from '@/src/hooks/useExpenseClaims';
import { Constants } from '@/src/lib/supabase/database.types';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatCurrencyCents, formatDateOnly, formatMoneyInputValue, parseMoneyInputAtScale } from '@/src/lib/format';
import type { ExpenseClaimLineRow, ExpenseLineInput, ExpenseType } from '@/src/lib/db/expenseClaims';
import { expenseTypeLabel } from './expenseLabels';

/** A claim's lines (FR-EXP-003/063). Editable only by the claimant while Draft/Rejected (RLS is the authority);
 *  the claim total is the server's Σ lines — the footer sum here is display, in integer cents. */
export interface ExpenseLinesCardProps {
  claimId: string;
  lines: ExpenseClaimLineRow[];
  isPending: boolean;
  isError: boolean;
  currency: string;
  editable: boolean;
}

export const ExpenseLinesCard: React.FC<ExpenseLinesCardProps> = ({ claimId, lines, isPending, isError, currency, editable }) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { addLine, updateLine, removeLine } = useExpenseClaimMutations();
  const [editing, setEditing] = useState<ExpenseClaimLineRow | 'new' | null>(null);
  const [removeTarget, setRemoveTarget] = useState<ExpenseClaimLineRow | null>(null);
  const totalCents = lines.reduce((sum, l) => sum + Math.round(Number(l.amount) * 100), 0);

  const confirmRemove = async () => {
    if (!removeTarget) return;
    try {
      await removeLine.mutateAsync(removeTarget.id);
      setRemoveTarget(null);
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
    }
  };

  return (
    <Card variant="bare" className="mb-4">
      <CardHead>
        <span>{t('expenses.lines.title', 'Lines')}</span>
        {editable && (
          <span className="ml-auto">
            <Button variant="outline" size="sm" onClick={() => setEditing('new')}>{t('expenses.lines.add', 'Add line')}</Button>
          </span>
        )}
      </CardHead>
      <CardPad>
        {isPending ? (
          <ListState variant="loading" rows={2} />
        ) : isError ? (
          <p role="alert" className="text-sm text-destructive">{t('expenses.lines.error', "Couldn't load the lines.")}</p>
        ) : lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('expenses.lines.empty', 'No lines yet. Add one per receipt.')}</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1 font-medium">{t('expenses.lines.columns.date', 'Date')}</th>
                <th className="py-1 font-medium">{t('expenses.lines.columns.type', 'Type')}</th>
                <th className="py-1 font-medium">{t('expenses.lines.columns.description', 'Description')}</th>
                <th className="py-1 text-right font-medium">{t('expenses.lines.columns.amount', 'Amount')}</th>
                {editable && <th className="py-1" />}
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id} className="border-t border-border">
                  <td className="whitespace-nowrap py-1.5">{formatDateOnly(l.expense_date)}</td>
                  <td className="py-1.5">{expenseTypeLabel(l.expense_type, t)}</td>
                  <td className="py-1.5">{l.description}</td>
                  <td className="py-1.5 text-right tabular-nums">{formatCurrencyCents(Number(l.amount), currency)}</td>
                  {editable && (
                    <td className="whitespace-nowrap py-1.5 text-right">
                      <Button variant="ghost" size="sm" onClick={() => setEditing(l)}
                        aria-label={t('expenses.lines.editAria', 'Edit line {{description}}', { description: l.description })}>
                        {t('expenses.lines.edit', 'Edit')}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setRemoveTarget(l)}
                        aria-label={t('expenses.lines.removeAria', 'Remove line {{description}}', { description: l.description })}>
                        {t('expenses.lines.remove', 'Remove')}
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border font-semibold">
                <td className="py-1.5" colSpan={3}>{t('expenses.lines.total', 'Total')}</td>
                <td className="py-1.5 text-right tabular-nums" data-testid="lines-total">{formatCurrencyCents(totalCents / 100, currency)}</td>
                {editable && <td />}
              </tr>
            </tfoot>
          </table>
        )}
      </CardPad>
      {editing && (
        <ExpenseLineFormModal
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSubmit={async (input) => {
            if (editing === 'new') await addLine.mutateAsync({ claimId, input });
            else await updateLine.mutateAsync({ id: editing.id, input });
            setEditing(null);
          }}
        />
      )}
      <ConfirmDialog
        open={removeTarget !== null}
        tone="destructive"
        title={t('expenses.lines.removeTitle', 'Remove this line?')}
        description={removeTarget?.description ?? ''}
        confirmLabel={t('expenses.lines.remove', 'Remove')}
        loading={removeLine.isPending}
        onConfirm={() => void confirmRemove()}
        onCancel={() => setRemoveTarget(null)}
      />
    </Card>
  );
};

interface LineValues { expenseDate: string; expenseType: string; description: string; amount: string }

const ExpenseLineFormModal: React.FC<{
  initial: ExpenseClaimLineRow | null;
  onClose: () => void;
  onSubmit: (input: ExpenseLineInput) => Promise<void>;
}> = ({ initial, onClose, onSubmit }) => {
  const { t } = useTranslation();
  const validate = useMemo(
    () => (v: LineValues): Partial<Record<keyof LineValues, string>> => {
      const e: Partial<Record<keyof LineValues, string>> = {};
      if (!v.expenseDate) e.expenseDate = t('expenses.lines.errors.dateRequired', 'Enter the date of the expense.');
      if (!v.description.trim()) e.description = t('expenses.lines.errors.descriptionRequired', 'Describe the expense.');
      const amount = parseMoneyInputAtScale(v.amount, 2);
      if (amount === null || !(amount > 0)) e.amount = t('expenses.lines.errors.amountPositive', 'Enter an amount greater than zero.');
      return e;
    },
    [t],
  );
  const form = useEntityForm<LineValues>({
    initialValues: {
      expenseDate: initial?.expense_date ?? '',
      expenseType: initial?.expense_type ?? 'Travel',
      description: initial?.description ?? '',
      amount: initial ? formatMoneyInputValue(Number(initial.amount)) : '',
    },
    validate,
    idPrefix: 'expense-line',
    requiredFields: ['expenseDate', 'description', 'amount'],
    module: 'expenses',
  });
  const dateField = form.fieldProps('expenseDate');
  const typeField = form.fieldProps('expenseType');
  const descField = form.fieldProps('description');
  const amountField = form.fieldProps('amount');
  const [saveError, setSaveError] = useState<SubmitError | null>(null);
  const errorSummary = [
    form.errors.expenseDate ? { fieldId: dateField.id, message: form.errors.expenseDate } : null,
    form.errors.description ? { fieldId: descField.id, message: form.errors.description } : null,
    form.errors.amount ? { fieldId: amountField.id, message: form.errors.amount } : null,
  ].filter((item): item is { fieldId: string; message: string } => item !== null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void form.handleSubmit(async (v) => {
      const input: ExpenseLineInput = {
        expenseDate: v.expenseDate,
        expenseType: v.expenseType as ExpenseType,
        description: v.description.trim(),
        amount: parseMoneyInputAtScale(v.amount, 2) as number,
      };
      try {
        await onSubmit(input);
      } catch (err) {
        const { headline, detail } = classifyMutationError(err);
        setSaveError({ headline, detail });
      }
    });
  };

  return (
    <EntityFormModal
      open
      title={initial ? t('expenses.lines.editTitle', 'Edit line') : t('expenses.lines.addTitle', 'Add a line')}
      submitLabel={initial ? t('expenses.lines.save', 'Save line') : t('expenses.lines.add', 'Add line')}
      onSubmit={handleSubmit}
      onClose={onClose}
      loading={form.isSubmitting}
      dirty={form.isDirty}
      submitDisabled={!form.isComplete}
      errorSummary={errorSummary}
      submitError={saveError}
    >
      <FormSection legend={t('expenses.lines.sectionLegend', 'Expense')}>
        <FormGrid>
          <TextField id={dateField.id} type="date" required label={t('expenses.lines.date', 'Date')} value={dateField.value}
            onChange={dateField.onChange} onBlur={dateField.onBlur} error={dateField.error} />
          <SelectField id={typeField.id} label={t('expenses.lines.type', 'Type')} value={typeField.value}
            onChange={(v) => typeField.onChange(v)} onBlur={typeField.onBlur}
            options={Constants.public.Enums.expense_type.map((x) => ({ value: x, label: expenseTypeLabel(x, t) }))} />
          <TextField id={descField.id} required label={t('expenses.lines.description', 'Description')} value={descField.value}
            onChange={descField.onChange} onBlur={descField.onBlur} error={descField.error} fullWidth />
          <TextField id={amountField.id} required inputMode="decimal" label={t('expenses.lines.amount', 'Amount')}
            value={amountField.value} onChange={amountField.onChange} onBlur={amountField.onBlur} error={amountField.error} />
        </FormGrid>
      </FormSection>
    </EntityFormModal>
  );
};
