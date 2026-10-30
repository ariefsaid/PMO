import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { budgetCategoryLabel } from '@/src/lib/i18n/budgetCategoryLabel';
import { formatCurrencyAuto, formatCurrencyCents, formatMoneyInputValue, parseMoneyInputAtScale } from '@/src/lib/format';
import { Button, DataTable, NumberField, type Column } from '@/src/components/ui';
import type { BudgetLineItemRow, NewLineItem } from '@/src/lib/db/budgets';
import { Constants, type Enums } from '@/src/lib/supabase/database.types';

const BUDGET_CATEGORIES = Constants.public.Enums.budget_category;

// ---------------------------------------------------------------------------
// Line-item editor (for Draft versions)
// ---------------------------------------------------------------------------
interface LineItemEditorProps {
  lineItems: BudgetLineItemRow[];
  /** The parent budget version's currency (the record's own — every line item shares it). */
  currency: string;
  onCreateLineItem: (item: NewLineItem) => Promise<unknown>;
  /** Stages a destructive confirm at the page level — does not delete on click. */
  onDeleteLineItem: (id: string) => void;
  /** Routine inline update (OD-UX-1: single-click + toast, no confirm). */
  onUpdateLineItem: (id: string, patch: Partial<Pick<BudgetLineItemRow, 'category' | 'description' | 'budgeted_amount' | 'fiscal_year'>>) => Promise<unknown>;
  onSaveSuccess: () => void;
  /** B-0.7: isPending flags from the parent mutation (createLineItem / updateLineItem).
   *  Disables Save while a write is in-flight — prevents double-submit duplication. */
  createIsPending?: boolean;
  updateIsPending?: boolean;
  /** B-0.6: called when a line-item write fails so the page-level toast fires. */
  onSaveError?: (err: unknown) => void;
  fiscalYearNames?: string[] | null;
}

/** One DataTable row of the editor: an existing line, or the single in-progress new line. */
type EditorRow = { kind: 'item'; li: BudgetLineItemRow } | { kind: 'new' };

/** Per-row inline edit state: `null` = reading, `string` = that row's id is open. */
type EditingId = string | null;
type EditDraft = { category: Enums<'budget_category'>; description: string; amount: string; fiscalYear: string; amountError: string | null; fiscalYearError: string | null };

const BudgetLineItemEditor: React.FC<LineItemEditorProps> = ({
  lineItems,
  currency,
  onCreateLineItem,
  onDeleteLineItem,
  onUpdateLineItem,
  onSaveSuccess,
  createIsPending = false,
  updateIsPending = false,
  onSaveError,
  fiscalYearNames = null,
}) => {
  const { t } = useTranslation('finance');
  const [adding, setAdding] = useState(false);
  const [newCategory, setNewCategory] = useState<Enums<'budget_category'>>('Labor');
  const [newDesc, setNewDesc] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [newAmountError, setNewAmountError] = useState<string | null>(null);
  const [newFiscalYearError, setNewFiscalYearError] = useState<string | null>(null);
  // Fiscal-year names come from the read-only Draft precheck when ERPNext is reachable. Keep this as
  // text input because customer calendars use their own names; the live list is suggestions, not a select.
  const [newFiscalYear, setNewFiscalYear] = useState('');

  // Inline edit state
  const [editDrafts, setEditDrafts] = useState<Record<string, EditDraft>>({});
  const [editingId, setEditingId] = useState<EditingId>(null);
  const [editCategory, setEditCategory] = useState<Enums<'budget_category'>>('Labor');
  const [editDesc, setEditDesc] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editFiscalYear, setEditFiscalYear] = useState('');
  const [editAmountError, setEditAmountError] = useState<string | null>(null);
  const [editFiscalYearError, setEditFiscalYearError] = useState<string | null>(null);
  /** The years this project's own lines already name — suggestions, never a constraint. */
  const knownFiscalYears = useMemo(
    () => [...new Set([
      ...lineItems.map((li) => li.fiscal_year).filter((y): y is string => !!y),
      ...(fiscalYearNames ?? []),
    ])].sort(),
    [lineItems, fiscalYearNames],
  );

  const validateFiscalYear = (value: string): boolean => {
    const fiscalYear = value.trim();
    if (!fiscalYear) return true;
    // ERPNext's exact names are authoritative when available. During an outage, reject obviously
    // numeric typos like "202" while preserving arbitrary client labels until the next live check.
    return fiscalYearNames === null
      ? !/^\d+$/.test(fiscalYear) || /^\d{4}$/.test(fiscalYear)
      : fiscalYearNames.includes(fiscalYear);
  };

  const openEdit = (li: BudgetLineItemRow) => {
    if (editingId) {
      setEditDrafts((drafts) => ({ ...drafts, [editingId]: { category: editCategory, description: editDesc, amount: editAmount, fiscalYear: editFiscalYear, amountError: editAmountError, fiscalYearError: editFiscalYearError } }));
    }
    const draft = editDrafts[li.id];
    setEditingId(li.id);
    setEditCategory(draft?.category ?? li.category as Enums<'budget_category'>);
    setEditDesc(draft?.description ?? li.description ?? '');
    setEditAmount(draft?.amount ?? formatMoneyInputValue(Number(li.budgeted_amount)));
    setEditFiscalYear(draft?.fiscalYear ?? li.fiscal_year ?? '');
    setEditAmountError(draft?.amountError ?? null);
    setEditFiscalYearError(draft?.fiscalYearError ?? null);
  };

  const closeEdit = () => {
    if (editingId) setEditDrafts((drafts) => {
      const next = { ...drafts };
      delete next[editingId];
      return next;
    });
    setEditingId(null);
    setEditAmountError(null);
    setEditFiscalYearError(null);
  };

  const validate = (fiscalYear: string, amount: string) => {
    if (!validateFiscalYear(fiscalYear)) return { fiscalYearError: t('finance:budgetActivation.invalidFiscalYearName', 'Choose a fiscal year from ERPNext, or leave it blank.'), amountError: null, amount: null };
    const parsed = parseMoneyInputAtScale(amount, 2);
    if (parsed === null) return { fiscalYearError: null, amountError: 'Enter a valid amount with no more than 2 decimal places', amount: null };
    if (parsed <= 0) return { fiscalYearError: null, amountError: t('financeCopy.amountMustBeGreaterThanZero', 'Amount must be greater than 0'), amount: null };
    return { fiscalYearError: null, amountError: null, amount: parsed };
  };

  const handleSaveEdit = async (li: BudgetLineItemRow) => {
    const validation = validate(editFiscalYear, editAmount);
    setEditFiscalYearError(validation.fiscalYearError);
    setEditAmountError(validation.amountError);
    const parsed = validation.amount;
    if (parsed === null) return;
    // B-0.6: wrap in try/catch → surface failure via onSaveError (no silent no-op).
    try {
      await onUpdateLineItem(li.id, {
        category: editCategory,
        description: editDesc || null,
        budgeted_amount: parsed,
        // An emptied field UN-phases the line (NULL), which is a real, deliberate state — never ''.
        fiscal_year: editFiscalYear.trim() || null,
      });
      closeEdit();
      onSaveSuccess();
    } catch (err) {
      onSaveError?.(err);
    }
  };

  const handleAdd = async () => {
    const validation = validate(newFiscalYear, newAmount);
    setNewFiscalYearError(validation.fiscalYearError);
    setNewAmountError(validation.amountError);
    const amount = validation.amount;
    if (!newCategory || amount === null) return;
    // B-0.6: wrap in try/catch → surface failure via onSaveError (no silent no-op).
    try {
      await onCreateLineItem({
        category: newCategory,
        description: newDesc || null,
        budgeted_amount: amount,
        fiscal_year: newFiscalYear.trim() || null,
      });
      setAdding(false);
      setNewDesc('');
      setNewAmount('');
      setNewAmountError(null);
      setNewFiscalYearError(null);
      setNewFiscalYear('');
    } catch (err) {
      onSaveError?.(err);
    }
  };

  const fieldCls =
    'h-8 rounded-md border border-input bg-background px-2.5 text-[13px] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

  const total = lineItems.reduce((sum, li) => sum + Number(li.budgeted_amount), 0);
  const rows: EditorRow[] = [
    ...lineItems.map((li): EditorRow => ({ kind: 'item', li })),
    ...(adding ? [{ kind: 'new' } as EditorRow] : []),
  ];

  const fiscalYearDatalist = (
    // ⚑ A datalist, not a <select>: the valid values are the CLIENT's own ERPNext Fiscal
    // Year names, which this write path cannot read (FR-BFY-022). The years the project
    // already uses are offered; a year it is only now moving into stays typeable.
    <datalist id="budget-fiscal-year-options">
      {knownFiscalYears.map((y) => (
        <option key={y} value={y} />
      ))}
    </datalist>
  );

  const categorySelect = (props: { id?: string; label: string; value: Enums<'budget_category'>; onChange: (v: Enums<'budget_category'>) => void; autoFocus?: boolean }) => (
    <select
      id={props.id}
      aria-label={props.label}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value as Enums<'budget_category'>)}
      className={`${fieldCls} max-w-full`}
      autoFocus={props.autoFocus}
    >
      {BUDGET_CATEGORIES.map((c) => (
        <option key={c} value={c}>
          {budgetCategoryLabel(c, t)}
        </option>
      ))}
    </select>
  );

  const columns: Column<EditorRow>[] = [
    {
      key: 'category',
      header: t('financeCopy.category', "Category"),
      kind: 'text',
      size: 170,
      cell: (row) => {
        if (row.kind === 'new') {
          return categorySelect({ label: t('financeCopy.lineItemCategory', "Line item category"), value: newCategory, onChange: setNewCategory });
        }
        const li = row.li;
        return editingId === li.id
          ? categorySelect({ id: `edit-category-${li.id}`, label: t('financeCopy.category', "Category"), value: editCategory, onChange: setEditCategory, autoFocus: true })
          : budgetCategoryLabel(li.category as Enums<'budget_category'>, t);
      },
    },
    {
      key: 'description',
      header: t('financeCopy.description', "Description"),
      kind: 'meta',
      size: 260,
      cell: (row) => {
        if (row.kind === 'new') {
          return (
            <input
              type="text"
              aria-label={t('financeCopy.lineItemDescription', "Line item description")}
              placeholder={t('financeCopy.description', "Description")}
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              className={`${fieldCls} w-full`}
            />
          );
        }
        const li = row.li;
        return editingId === li.id ? (
          <input
            type="text"
            aria-label={t('financeCopy.description', "Description")}
            placeholder={t('financeCopy.description', "Description")}
            value={editDesc}
            onChange={(e) => setEditDesc(e.target.value)}
            className={`${fieldCls} w-full`}
          />
        ) : (
          <span className="text-muted-foreground">{li.description ?? '—'}</span>
        );
      },
    },
    // ⚑ FR-BFY-060: which fiscal year this line belongs to. A multi-fiscal-year project cannot
    // reach ERPNext at all until every line names one (the gate refuses an un-phased line
    // rather than inventing a split), so the column is not an advanced option — it is the
    // control that makes the capability reachable.
    {
      key: 'fiscal_year',
      header: t('financeCopy.fiscalYear', "Fiscal year"),
      kind: 'text',
      size: 150,
      cell: (row) => {
        if (row.kind === 'new') {
          return (
            <>
              <input
                type="text"
                aria-label={t('financeCopy.lineItemFiscalYear', "Line item fiscal year")}
                placeholder={t('financeCopy.unPhased', "Un-phased")}
                list="budget-fiscal-year-options"
                value={newFiscalYear}
                onChange={(e) => {
                  setNewFiscalYear(e.target.value);
                  setNewFiscalYearError(null);
                }}
                className={`${fieldCls} w-32`}
              />
              {newFiscalYearError && <p role="alert" className="text-xs text-destructive-text">{newFiscalYearError}</p>}
              {fiscalYearDatalist}
            </>
          );
        }
        const li = row.li;
        // ⚑ An un-phased line SAYS SO. A blank cell would read as "we forgot"; un-phased is a
        // real, deliberate state with a consequence (a multi-fiscal-year project cannot push
        // until it is resolved), so it is stated rather than left empty.
        return editingId === li.id ? (
          <>
            <label htmlFor={`edit-fy-${li.id}`} className="sr-only">
              {t('financeCopy.fiscalYear', "Fiscal year")}</label>
            <input
              id={`edit-fy-${li.id}`}
              type="text"
              aria-label={t('financeCopy.fiscalYear', "Fiscal year")}
              placeholder={t('financeCopy.unPhased', "Un-phased")}
              list="budget-fiscal-year-options"
              value={editFiscalYear}
              onChange={(e) => {
                setEditFiscalYear(e.target.value);
                setEditFiscalYearError(null);
              }}
              className={`${fieldCls} w-32`}
            />
            {editFiscalYearError && <p role="alert" className="text-xs text-destructive-text">{editFiscalYearError}</p>}
            {fiscalYearDatalist}
          </>
        ) : (
          <span className="text-muted-foreground">
            {li.fiscal_year ?? <span className="italic">{t('financeCopy.unPhased', "Un-phased")}</span>}
          </span>
        );
      },
    },
    {
      key: 'amount',
      header: t('financeCopy.budgeted', "Budgeted"),
      kind: 'money',
      align: 'num',
      size: 184,
      cell: (row) => {
        if (row.kind === 'new') {
          return (
            <NumberField
              label={t('financeCopy.lineItemAmount', "Line item amount")}
              hideLabel
              placeholder={t('financeCopy.amount', "Amount")}
              value={newAmount}
              onChange={(value) => {
                setNewAmount(value);
                setNewAmountError(null);
              }}
              error={newAmountError ?? undefined}
              localeAware
              className="w-28"
            />
          );
        }
        const li = row.li;
        return editingId === li.id ? (
          <div className="flex flex-col items-end gap-0.5">
            {/* NumberField owns the (visually hidden) label — a second <label> here doubled
                the accessible name to "Amount Amount". */}
            <NumberField
              id={`edit-amount-${li.id}`}
              label={t('financeCopy.amount', "Amount")}
              hideLabel
              value={editAmount}
              onChange={(value) => {
                setEditAmount(value);
                setEditAmountError(null);
              }}
              error={editAmountError ?? undefined}
              localeAware
              className="w-28"
            />
          </div>
        ) : (
          <span className="font-medium">{formatCurrencyAuto(Number(li.budgeted_amount), currency)}</span>
        );
      },
    },
    {
      key: 'actions',
      header: <span className="sr-only">{t('table.actions', 'Actions')}</span>,
      kind: 'actions',
      align: 'num',
      size: 230,
      minSize: 230,
      maxSize: 230,
      cell: (row) => {
        if (row.kind === 'new') {
          return (
            <div className="space-x-1">
              {/* B-0.7: loading/disabled while createIsPending — prevents double-submit. */}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void handleAdd()}
                className="text-primary-text"
                loading={createIsPending}
                disabled={createIsPending}
              >
                {t('financeCopy.save', "Save")}</Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setAdding(false);
                  setNewCategory('Labor');
                  setNewDesc('');
                  setNewAmount('');
                  setNewFiscalYear('');
                  setNewFiscalYearError(null);
                  setNewAmountError(null);
                }}
                disabled={createIsPending}
              >
                {t('financeCopy.cancel', "Cancel")}</Button>
            </div>
          );
        }
        const li = row.li;
        const deleteLabel = t('financeCopy.deleteBudgetLineItemNamed', 'Delete line item {{category}}', { category: budgetCategoryLabel(li.category, t) });
        return editingId === li.id ? (
          <div className="space-x-1">
            {/* B-0.7: loading/disabled while updateIsPending — prevents double-submit. */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void handleSaveEdit(li)}
              className="text-primary-text"
              aria-label={t('financeCopy.save', "Save")}
              loading={updateIsPending}
              disabled={updateIsPending}
            >
              {t('financeCopy.save', "Save")}</Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={closeEdit}
              aria-label={t('financeCopy.cancel', "Cancel")}
              disabled={updateIsPending}
            >
              {t('financeCopy.cancel', "Cancel")}</Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onDeleteLineItem(li.id)}
              className="text-destructive-text hover:bg-destructive/10"
              aria-label={deleteLabel}
              disabled={updateIsPending}
            >
              {t('financeCopy.delete', "Delete")}</Button>
          </div>
        ) : (
          <div className="space-x-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => openEdit(li)}
              disabled={updateIsPending && editingId !== null}
              className="text-primary-text hover:bg-primary/10"
              aria-label={t('financeCopy.editBudgetLineItemNamed', 'Edit line item {{category}}', { category: budgetCategoryLabel(li.category, t) })}
            >
              {t('financeCopy.edit', "Edit")}</Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onDeleteLineItem(li.id)}
              className="text-destructive-text hover:bg-destructive/10"
              aria-label={deleteLabel}
            >
              {t('financeCopy.delete', "Delete")}</Button>
          </div>
        );
      },
    },
  ];

  return (
    <div className="relative mt-4">
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(row) => (row.kind === 'new' ? '__new__' : row.li.id)}
        tableId="budget-line-items-editor"
        accessibleName={t('financeCopy.lineItemsSection', 'Line items')}
        className="rounded-none border-0 bg-transparent"
        totals={[{
          key: 'total',
          label: t('financeCopy.total', "Total"),
          values: {
            amount: <span data-testid="budget-edit-total" className="font-bold">{formatCurrencyCents(total, currency)}</span>,
          },
        }]}
      />
      {!adding && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setNewAmountError(null);
            setAdding(true);
          }}
          className="mt-2 text-primary-text"
        >
          {t('financeCopy.addBudgetLineItem', "+ Add line item")}</Button>
      )}
    </div>
  );
};

export default BudgetLineItemEditor;
