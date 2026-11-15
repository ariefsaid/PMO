import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button, ConfirmDialog, DataTable, EntityFormModal, FormGrid, Icon, ListState, NumberField, RecordMenu, RecordSection, SelectField,
  TextField, useEntityForm, useToast, type Column, type SubmitError,
} from '@/src/components/ui';
import { cn } from '@/src/components/ui/cn';
import { useIsNarrow } from '@/src/components/ui/useIsNarrow';
import { useExpenseClaimMutations } from '@/src/hooks/useExpenseClaims';
import { Constants } from '@/src/lib/supabase/database.types';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatCurrency, formatDay, formatMoneyInputValue, parseMoneyInputAtScale } from '@/src/lib/format';
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
  const isNarrow = useIsNarrow();
  const { addLine, updateLine, removeLine } = useExpenseClaimMutations();
  const [editing, setEditing] = useState<ExpenseClaimLineRow | 'new' | null>(null);
  const [removeTarget, setRemoveTarget] = useState<ExpenseClaimLineRow | null>(null);
  const totalCents = lines.reduce((sum, l) => sum + Math.round(Number(l.amount) * 100), 0);
  // 1168 canvas: date 112 + type 168 + description (the identity column, takes the rest) + amount 168 + row menu 56.
  // The row menu is a fixed lane, so every amount ends on one edge with or without it.
  const columns = useMemo<Column<ExpenseClaimLineRow>[]>(() => [
    { key: 'date', header: t('expenses.lines.columns.date', 'Date'), kind: 'date', size: 112, cell: (line) => formatDay(line.expense_date) },
    { key: 'type', header: t('expenses.lines.columns.type', 'Type'), kind: 'text', size: 168, cell: (line) => expenseTypeLabel(line.expense_type, t) },
    { key: 'description', header: t('expenses.lines.columns.description', 'Description'), kind: 'primary', cell: (line) => line.description, primaryTitle: (line) => line.description },
    { key: 'amount', header: t('expenses.lines.columns.amount', 'Amount'), kind: 'money', align: 'num', size: 168, cell: (line) => formatCurrency(Number(line.amount), currency, { precision: 'minor' }) },
    ...(editable ? [{
      key: 'actions', header: <span className="sr-only">{t('table.actions', 'Actions')}</span>, kind: 'actions' as const, size: 56, minSize: 56, maxSize: 56,
      cell: (line: ExpenseClaimLineRow) => <div className="flex justify-end">
        <RecordMenu
          ariaLabel={t('expenseClaims:lines.menuAria', 'Line actions: {{description}}', { description: line.description })}
          triggerClassName="border-transparent bg-transparent"
          items={[
            { key: 'edit', label: t('expenses.lines.edit', 'Edit'), onSelect: () => setEditing(line) },
            { key: 'remove', label: t('expenses.lines.remove', 'Remove'), danger: true, onSelect: () => setRemoveTarget(line) },
          ]}
        />
      </div>,
    }] : []),
  ], [currency, editable, t]);

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
    <RecordSection
      title={t('expenses.lines.title', 'Lines')}
      flush={lines.length > 0 && !isPending && !isError}
      actions={
        editable && (
          <Button variant="outline" size="sm" onClick={() => setEditing('new')}>{t('expenses.lines.add', 'Add line')}</Button>
        )
      }
    >
      {isPending ? (
        <ListState variant="loading" rows={2} />
      ) : isError ? (
        <p role="alert" className="text-sm text-destructive">{t('expenses.lines.error', "Couldn't load the lines.")}</p>
      ) : lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('expenses.lines.empty', 'No lines yet. Add one per receipt.')}</p>
      ) : isNarrow ? (
        <ul data-testid="expense-lines-list" aria-label={t('expenses.lines.title', 'Lines')} className="divide-y divide-border border-t border-border">
          {lines.map((line) => {
            // Zoho/Expensify row: what it was + how much + the open chevron on line 1 (one centre line), when · what kind on line 2.
            const body = (
              <span className="block">
                <span className="flex items-center gap-3">
                  <span className="min-w-0 flex-1 text-sm font-semibold text-foreground">{line.description}</span>
                  <span className="shrink-0 text-sm tabular-nums">{formatCurrency(Number(line.amount), currency, { precision: 'minor' })}</span>
                  {editable && <Icon name="chev" aria-hidden className="-ml-1 size-4 shrink-0 text-muted-foreground" />}
                </span>
                <span className="mt-0.5 block text-control text-muted-foreground">{formatDay(line.expense_date)} · {expenseTypeLabel(line.expense_type, t)}</span>
              </span>
            );
            return (
              <li key={line.id}>
                {editable ? (
                  <button type="button" onClick={() => setEditing(line)}
                    aria-label={t('expenses.lines.editAria', 'Edit line {{description}}', { description: line.description })}
                    className="block min-h-11 w-full px-[var(--panel-inset)] py-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring">{body}</button>
                ) : (
                  <div className="px-[var(--panel-inset)] py-3">{body}</div>
                )}
              </li>
            );
          })}
          <li className="flex items-center justify-between gap-3 bg-secondary/40 px-[var(--panel-inset)] py-3 font-semibold">
            <span>{t('expenses.lines.total', 'Total')}</span>
            {/* The total ends on the amounts' right edge: the rows' chevron slot (16 + 8) is kept clear when rows open. */}
            <span data-testid="lines-total" className={cn('tabular-nums', editable && 'mr-6')}>{formatCurrency(totalCents / 100, currency, { precision: 'minor' })}</span>
          </li>
        </ul>
      ) : (
        <DataTable
          embedded
          rows={lines}
          columns={columns}
          rowKey={(line) => line.id}
          tableId="expense-lines"
          accessibleName={t('expenses.lines.title', 'Lines')}
          totals={[{
            key: currency,
            label: t('expenses.lines.total', 'Total'),
            values: {
              date: null,
              amount: <span data-testid="lines-total" className="font-semibold">{formatCurrency(totalCents / 100, currency, { precision: 'minor' })}</span>,
            },
          }]}
        />
      )}
      {editing && (
        <ExpenseLineFormModal
          initial={editing === 'new' ? null : editing}
          currency={currency}
          onClose={() => setEditing(null)}
          onRemove={isNarrow && editing !== 'new' ? () => { setRemoveTarget(editing); setEditing(null); } : undefined}
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
    </RecordSection>
  );
};

interface LineValues { expenseDate: string; expenseType: string; description: string; amount: string }

const ExpenseLineFormModal: React.FC<{
  initial: ExpenseClaimLineRow | null;
  currency: string;
  onClose: () => void;
  /** Phone: a line row is the edit target, so Remove lives inside its edit sheet. */
  onRemove?: () => void;
  onSubmit: (input: ExpenseLineInput) => Promise<void>;
}> = ({ initial, currency, onClose, onRemove, onSubmit }) => {
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
      <FormGrid>
          <TextField id={dateField.id} type="date" required label={t('expenses.lines.date', 'Date')} value={dateField.value}
            onChange={dateField.onChange} onBlur={dateField.onBlur} error={dateField.error} />
          <SelectField id={typeField.id} label={t('expenses.lines.type', 'Type')} value={typeField.value}
            onChange={(v) => typeField.onChange(v)} onBlur={typeField.onBlur}
            options={Constants.public.Enums.expense_type.map((x) => ({ value: x, label: expenseTypeLabel(x, t) }))} />
          <TextField id={descField.id} required label={t('expenses.lines.description', 'Description')} value={descField.value}
            onChange={descField.onChange} onBlur={descField.onBlur} error={descField.error} fullWidth />
          <NumberField id={amountField.id} required prefix={currency} label={t('expenses.lines.amount', 'Amount')}
            value={amountField.value} onChange={amountField.onChange} onBlur={amountField.onBlur} error={amountField.error} />
      </FormGrid>
      {onRemove && (
        <Button type="button" variant="outline" className="mt-3 w-full" onClick={onRemove}
          aria-label={t('expenses.lines.removeAria', 'Remove line {{description}}', { description: initial?.description ?? '' })}>
          {t('expenses.lines.remove', 'Remove')}
        </Button>
      )}
    </EntityFormModal>
  );
};
