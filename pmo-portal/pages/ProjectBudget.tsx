import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useProjectBudget, useBudgetVersions, useBudgetMutations } from '@/src/hooks/useBudget';
import { usePermission } from '@/src/auth/usePermission';
import { useAuth } from '@/src/auth/useAuth';
import { useOrgCurrency } from '@/src/hooks/useOrgCurrency';
import { budgetCategoryLabel } from '@/src/lib/i18n/budgetCategoryLabel';
import {
  formatCurrency,
  formatMoneyInputValue,
  parseMoneyInputAtScale,
} from '@/src/lib/format';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import {
  Button,
  StatusPill,
  ListState,
  Toolbar,
  TableFoot,
  ConfirmDialog,
  useToast,
  NumberField,
} from '@/src/components/ui';
import { budgetVersionVariant } from '@/src/lib/status/statusVariants';
import type { BudgetVersionWithItems, BudgetLineItemRow, NewLineItem } from '@/src/lib/db/budgets';
import { Constants, type Enums } from '@/src/lib/supabase/database.types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const BUDGET_CATEGORIES = Constants.public.Enums.budget_category;

function budgetStatusLabel(status: Enums<'budget_status'>, t: (key: string, fallback: string) => string): string {
  const labels: Record<Enums<'budget_status'>, string> = {
    Draft: t('financeCopy.statusDraft', 'Draft'),
    Active: t('financeCopy.statusActive', 'Active'),
    Archived: t('financeCopy.statusArchived', 'Archived'),
  };
  return labels[status];
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const StatusBadge: React.FC<{ status: Enums<'budget_status'> }> = ({ status }) => {
  const { t } = useTranslation();
  return (
    <span data-testid={`version-status-${status.toLowerCase()}`}>
      <StatusPill variant={budgetVersionVariant(status)}>{budgetStatusLabel(status, t)}</StatusPill>
    </span>
  );
};

const TH: React.FC<{ children: React.ReactNode; align?: 'right' }> = ({ children, align }) => (
  <th
    className={`h-[38px] border-b border-border bg-card px-3 text-[11.5px] font-semibold uppercase tracking-[0.03em] text-muted-foreground ${
      align === 'right' ? 'text-right' : 'text-left'
    }`}
  >
    {children}
  </th>
);

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
}

/** Per-row inline edit state: `null` = reading, `string` = that row's id is open. */
type EditingId = string | null;

const LineItemEditor: React.FC<LineItemEditorProps> = ({
  lineItems,
  currency,
  onCreateLineItem,
  onDeleteLineItem,
  onUpdateLineItem,
  onSaveSuccess,
  createIsPending = false,
  updateIsPending = false,
  onSaveError,
}) => {
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);
  const [newCategory, setNewCategory] = useState<Enums<'budget_category'>>('Labor');
  const [newDesc, setNewDesc] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [newAmountError, setNewAmountError] = useState<string | null>(null);
  // ⚑ FR-BFY-060 — free TEXT, not a select. The valid values are another system's calendar (the
  // client's ERPNext `Fiscal Year` names), which the write path cannot reach; the years this project
  // has already touched are offered as SUGGESTIONS via a datalist, but a year the project is only now
  // moving into must remain typeable. Validation is push-time, against the live doctype (FR-BFY-021/022).
  const [newFiscalYear, setNewFiscalYear] = useState('');

  // Inline edit state
  const [editingId, setEditingId] = useState<EditingId>(null);
  const [editCategory, setEditCategory] = useState<Enums<'budget_category'>>('Labor');
  const [editDesc, setEditDesc] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editFiscalYear, setEditFiscalYear] = useState('');
  const [editAmountError, setEditAmountError] = useState<string | null>(null);
  /** The years this project's own lines already name — suggestions, never a constraint. */
  const knownFiscalYears = useMemo(
    () => [...new Set(lineItems.map((li) => li.fiscal_year).filter((y): y is string => !!y))].sort(),
    [lineItems],
  );

  const openEdit = (li: BudgetLineItemRow) => {
    setEditingId(li.id);
    setEditCategory(li.category as Enums<'budget_category'>);
    setEditDesc(li.description ?? '');
    setEditAmount(formatMoneyInputValue(Number(li.budgeted_amount)));
    setEditFiscalYear(li.fiscal_year ?? '');
    setEditAmountError(null);
  };

  const closeEdit = () => {
    setEditingId(null);
    setEditAmountError(null);
  };

  const handleSaveEdit = async (li: BudgetLineItemRow) => {
    // Validate with the same locale-aware, storage-scale parser used for the write.
    const parsed = parseMoneyInputAtScale(editAmount, 2);
    if (parsed === null) {
      setEditAmountError('Enter a valid amount with no more than 2 decimal places');
      return;
    }
    if (parsed <= 0) {
      setEditAmountError('Amount must be greater than 0');
      return;
    }
    setEditAmountError(null);
    // B-0.6: wrap in try/catch → surface failure via onSaveError (no silent no-op).
    try {
      await onUpdateLineItem(li.id, {
        category: editCategory,
        description: editDesc || null,
        budgeted_amount: parsed,
        // An emptied field UN-phases the line (NULL), which is a real, deliberate state — never ''.
        fiscal_year: editFiscalYear.trim() || null,
      });
      setEditingId(null);
      onSaveSuccess();
    } catch (err) {
      onSaveError?.(err);
    }
  };

  const handleAdd = async () => {
    const amount = parseMoneyInputAtScale(newAmount, 2);
    if (!newCategory) return;
    if (amount === null) {
      setNewAmountError('Enter a valid amount with no more than 2 decimal places');
      return;
    }
    if (amount <= 0) {
      setNewAmountError('Amount must be greater than 0');
      return;
    }
    setNewAmountError(null);
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
      setNewFiscalYear('');
    } catch (err) {
      onSaveError?.(err);
    }
  };

  const fieldCls =
    'h-8 rounded-md border border-input bg-background px-2.5 text-[13px] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

  return (
    <div
      role="region"
      aria-label={t('financeCopy.budgetLineItemsScrollable', 'Budget line items, scrollable horizontally')}
      tabIndex={0}
      className="relative mt-4 overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr>
            <TH>{t('financeCopy.category', "Category")}</TH>
            <TH>{t('financeCopy.description', "Description")}</TH>
            {/* ⚑ FR-BFY-060: which fiscal year this line belongs to. A multi-fiscal-year project cannot
                reach ERPNext at all until every line names one (the gate refuses an un-phased line
                rather than inventing a split), so the column is not an advanced option — it is the
                control that makes the capability reachable. */}
            <TH>{t('financeCopy.fiscalYear', "Fiscal year")}</TH>
            <TH align="right">{t('financeCopy.budgeted', "Budgeted")}</TH>
            <TH align="right">{t('financeCopy.actualPmoRecorded', 'Actual (PMO recorded)')}</TH>
            <th className="border-b border-border bg-card" />
          </tr>
        </thead>
        <tbody>
          {lineItems.map((li) =>
            editingId === li.id ? (
              // --- Inline edit row ---
              <tr key={li.id} className="border-b border-border/70 bg-accent/30 last:border-b-0">
                <td className="px-3 py-2">
                  {/* Label is visually hidden but wired for a11y */}
                  <label htmlFor={`edit-category-${li.id}`} className="sr-only">
                    {t('financeCopy.category', "Category")}</label>
                  <select
                    id={`edit-category-${li.id}`}
                    aria-label={t('financeCopy.category', "Category")}
                    value={editCategory}
                    onChange={(e) => setEditCategory(e.target.value as Enums<'budget_category'>)}
                    className={fieldCls}
                      autoFocus
                  >
                    {BUDGET_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {budgetCategoryLabel(c, t)}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <input
                    type="text"
                    aria-label={t('financeCopy.description', "Description")}
                    placeholder={t('financeCopy.description', "Description")}
                    value={editDesc}
                    onChange={(e) => setEditDesc(e.target.value)}
                    className={`${fieldCls} w-full`}
                  />
                </td>
                <td className="px-3 py-2">
                  <label htmlFor={`edit-fy-${li.id}`} className="sr-only">
                    {t('financeCopy.fiscalYear', "Fiscal year")}</label>
                  <input
                    id={`edit-fy-${li.id}`}
                    type="text"
                    aria-label={t('financeCopy.fiscalYear', "Fiscal year")}
                    placeholder={t('financeCopy.unPhased', "Un-phased")}
                    list="budget-fiscal-year-options"
                    value={editFiscalYear}
                    onChange={(e) => setEditFiscalYear(e.target.value)}
                    className={`${fieldCls} w-32`}
                  />
                {/* ⚑ A datalist, not a <select>: the valid values are the CLIENT's own ERPNext Fiscal
                    Year names, which this write path cannot read (FR-BFY-022). The years the project
                    already uses are offered; a year it is only now moving into stays typeable. */}
                <datalist id="budget-fiscal-year-options">
                  {knownFiscalYears.map((y) => (
                    <option key={y} value={y} />
                  ))}
                </datalist>
                </td>
                <td className="px-3 py-2 text-right">
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
                </td>
                <td className="px-3 py-2 text-right tabular text-muted-foreground">
                  {formatCurrency(Number(li.actual_amount), currency)}
                </td>
                <td className="space-x-1 px-3 py-2 text-right">
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
                    aria-label={t('financeCopy.deleteBudgetLineItemNamed', 'Delete line item {{category}}', { category: budgetCategoryLabel(li.category, t) })}
                    disabled={updateIsPending}
                  >
                    {t('financeCopy.delete', "Delete")}</Button>
                </td>
              </tr>
            ) : (
              // --- Read row with Edit affordance ---
              <tr key={li.id} className="border-b border-border/70 last:border-b-0">
                <td className="px-3 py-2">{budgetCategoryLabel(li.category as Enums<'budget_category'>, t)}</td>
                <td className="px-3 py-2 text-muted-foreground">{li.description ?? '—'}</td>
                {/* ⚑ An un-phased line SAYS SO. A blank cell would read as "we forgot"; un-phased is a
                    real, deliberate state with a consequence (a multi-fiscal-year project cannot push
                    until it is resolved), so it is stated rather than left empty. */}
                <td className="px-3 py-2 text-muted-foreground">
                  {li.fiscal_year ?? <span className="italic">{t('financeCopy.unPhased', "Un-phased")}</span>}
                </td>
                <td className="px-3 py-2 text-right font-medium tabular">
                  {formatCurrency(Number(li.budgeted_amount), currency)}
                </td>
                <td className="px-3 py-2 text-right tabular text-muted-foreground">
                  {formatCurrency(Number(li.actual_amount), currency)}
                </td>
                <td className="space-x-1 px-3 py-2 text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openEdit(li)}
                    className="text-primary-text hover:bg-primary/10"
                    aria-label={t('financeCopy.editBudgetLineItemNamed', 'Edit line item {{category}}', { category: budgetCategoryLabel(li.category, t) })}
                  >
                    {t('financeCopy.edit', "Edit")}</Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onDeleteLineItem(li.id)}
                    className="text-destructive-text hover:bg-destructive/10"
                    aria-label={t('financeCopy.deleteBudgetLineItemNamed', 'Delete line item {{category}}', { category: budgetCategoryLabel(li.category, t) })}
                  >
                    {t('financeCopy.delete', "Delete")}</Button>
                </td>
              </tr>
            )
          )}
          {adding && (
            <tr className="border-b border-border/70">
              <td className="px-3 py-2">
                <select
                  aria-label={t('financeCopy.lineItemCategory', "Line item category")}
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value as Enums<'budget_category'>)}
                  className={fieldCls}
                >
                  {BUDGET_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {budgetCategoryLabel(c, t)}
                    </option>
                  ))}
                </select>
              </td>
              <td className="px-3 py-2">
                <input
                  type="text"
                  aria-label={t('financeCopy.lineItemDescription', "Line item description")}
                  placeholder={t('financeCopy.description', "Description")}
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  className={`${fieldCls} w-full`}
                />
              </td>
              <td className="px-3 py-2">
                <input
                  type="text"
                  aria-label={t('financeCopy.lineItemFiscalYear', "Line item fiscal year")}
                  placeholder={t('financeCopy.unPhased', "Un-phased")}
                  list="budget-fiscal-year-options"
                  value={newFiscalYear}
                  onChange={(e) => setNewFiscalYear(e.target.value)}
                  className={`${fieldCls} w-32`}
                />
                {/* ⚑ A datalist, not a <select>: the valid values are the CLIENT's own ERPNext Fiscal
                    Year names, which this write path cannot read (FR-BFY-022). The years the project
                    already uses are offered; a year it is only now moving into stays typeable. */}
                <datalist id="budget-fiscal-year-options">
                  {knownFiscalYears.map((y) => (
                    <option key={y} value={y} />
                  ))}
                </datalist>
              </td>
              <td className="px-3 py-2 text-right">
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
              </td>
              <td />
              <td className="space-x-1 px-3 py-2 text-right">
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
                    setNewAmountError(null);
                  }}
                  disabled={createIsPending}
                >
                  {t('financeCopy.cancel', "Cancel")}</Button>
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <TableFoot className="mt-0 rounded-b-lg">
        <span className="text-muted-foreground">{t('financeCopy.total', "Total")}</span>
        <span data-testid="budget-edit-total" className="ml-auto font-bold tabular">
          {formatCurrency(
            lineItems.reduce((sum, li) => sum + Number(li.budgeted_amount), 0),
            currency,
          )}
        </span>
      </TableFoot>
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

// ---------------------------------------------------------------------------
// Version card
// ---------------------------------------------------------------------------
interface VersionCardProps {
  version: BudgetVersionWithItems;
  canWrite: boolean;
  /** OD-BUDGET-6: whether this user may activate this Draft (a second person). */
  canActivate: boolean;
  /** Why Activate is withheld from a writer, when it is (shown in place of the button). */
  activateBlockedReason?: string | null;
  /** Each callback STAGES a confirm at the page level — none writes on click. */
  onActivate: (id: string) => void;
  onArchive: (id: string) => void;
  onClone: (id: string) => void;
  onDeleteDraft: (id: string) => void;
  onCreateLineItem: (versionId: string, item: NewLineItem) => Promise<unknown>;
  onDeleteLineItem: (id: string) => void;
  /** Routine inline update — no confirm required (OD-UX-1). */
  onUpdateLineItem: (id: string, patch: Partial<Pick<BudgetLineItemRow, 'category' | 'description' | 'budgeted_amount' | 'fiscal_year'>>) => Promise<unknown>;
  onUpdateLineItemSuccess: () => void;
  /** B-0.6/0.7: passed through to LineItemEditor. */
  createIsPending?: boolean;
  updateIsPending?: boolean;
  onLineItemSaveError?: (err: unknown) => void;
}

const VersionCard: React.FC<VersionCardProps> = ({
  version,
  canWrite,
  canActivate,
  activateBlockedReason,
  onActivate,
  onArchive,
  onClone,
  onDeleteDraft,
  onCreateLineItem,
  onDeleteLineItem,
  onUpdateLineItem,
  onUpdateLineItemSuccess,
  createIsPending,
  updateIsPending,
  onLineItemSaveError,
}) => {
  const { t } = useTranslation();
  return (
    <div data-testid="version-card" className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3">
          <span className="font-mono text-[13px] text-muted-foreground">v{version.version}</span>
          <span className="font-semibold">{version.name}</span>
          <StatusBadge status={version.status} />
        </div>
        <span className="ml-auto shrink-0 whitespace-nowrap font-bold tabular">{formatCurrency(version.total, version.currency)}</span>
      </div>

      {/* Actions gated by role (cosmetic — RLS is the real gate). Each action
          stages a ConfirmDialog at the page level; none mutates on a single
          click (owner rule, B2-B5). */}
      {canWrite && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {version.status === 'Draft' && (
            <>
              {canActivate && (
                <Button variant="success" size="sm" onClick={() => onActivate(version.id)}>
                  {t('financeCopy.activate', "Activate")}</Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onDeleteDraft(version.id)}
                className="text-destructive-text hover:bg-destructive/10"
              >
                {t('financeCopy.deleteDraft', "Delete draft")}</Button>
              {activateBlockedReason && (
                <p data-testid="activate-blocked-reason" className="basis-full text-[13px] text-muted-foreground">
                  {activateBlockedReason}
                </p>
              )}
            </>
          )}
          {version.status === 'Active' && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onArchive(version.id)}
                className="text-warning-foreground hover:bg-warning/18"
              >
                {t('financeCopy.archive', "Archive")}</Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onClone(version.id)}
                className="text-primary-text hover:bg-primary/10"
              >
                {t('financeCopy.cloneToRevise', "Clone to revise")}</Button>
            </>
          )}
          {version.status === 'Archived' && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onClone(version.id)}
              className="text-primary-text hover:bg-primary/10"
            >
              {t('financeCopy.cloneToRevise', "Clone to revise")}</Button>
          )}
        </div>
      )}

      {/* Line-item editor for Draft; read-only view for others */}
      {version.status === 'Draft' && canWrite ? (
        <LineItemEditor
          lineItems={version.line_items}
          currency={version.currency}
          onCreateLineItem={(item) => onCreateLineItem(version.id, item)}
          onDeleteLineItem={onDeleteLineItem}
          onUpdateLineItem={onUpdateLineItem}
          onSaveSuccess={onUpdateLineItemSuccess}
          createIsPending={createIsPending}
          updateIsPending={updateIsPending}
          onSaveError={onLineItemSaveError}
        />
      ) : (
        version.line_items.length > 0 && (
          <div
            role="region"
            aria-label={t('financeCopy.budgetVersionLineItemsScrollable', 'Budget version line items, scrollable horizontally')}
            tabIndex={0}
            className="relative mt-4 overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <TH>{t('financeCopy.category', "Category")}</TH>
                  <TH>{t('financeCopy.description', "Description")}</TH>
                  {/* FR-BFY-061: an Active/Archived version's phasing is VISIBLE but not editable —
                      `enforce_draft_line_item` (0005) rejects the write, and re-phasing goes through
                      clone → edit → activate (OD-BUDGET-5). An affordance the DB refuses is worse
                      than none. */}
                  <TH>{t('financeCopy.fiscalYear', "Fiscal year")}</TH>
                  <TH align="right">{t('financeCopy.budgeted', "Budgeted")}</TH>
                  <TH align="right">{t('financeCopy.actualPmoRecorded', 'Actual (PMO recorded)')}</TH>
                </tr>
              </thead>
              <tbody>
                {version.line_items.map((li) => (
                  <tr key={li.id} className="border-b border-border/70 last:border-b-0">
                    <td className="px-3 py-2">{budgetCategoryLabel(li.category as Enums<'budget_category'>, t)}</td>
                    <td className="px-3 py-2 text-muted-foreground">{li.description ?? '—'}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {li.fiscal_year ?? <span className="italic">{t('financeCopy.unPhased', "Un-phased")}</span>}
                    </td>
                    <td className="px-3 py-2 text-right font-medium tabular">
                      {formatCurrency(Number(li.budgeted_amount), version.currency)}
                    </td>
                    <td className="px-3 py-2 text-right tabular text-muted-foreground">
                      {formatCurrency(Number(li.actual_amount), version.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <TableFoot className="mt-0 rounded-b-lg">
              <span className="text-muted-foreground">{t('financeCopy.total', "Total")}</span>
              <span className="ml-auto font-bold">{formatCurrency(version.total, version.currency)}</span>
            </TableFoot>
          </div>
        )
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main page component (NFR-BV-UI-001)
// ---------------------------------------------------------------------------
interface ProjectBudgetProps {
  projectId: string;
}

/** A staged, not-yet-committed budget mutation awaiting the ConfirmDialog
 *  (owner rule: nothing writes on a single click). B1-B5 + delete-line-item. */
type PendingBudgetConfirm =
  | { kind: 'create'; name: string }
  | { kind: 'activate'; id: string; label: string }
  | { kind: 'clone'; id: string; label: string }
  | { kind: 'archive'; id: string; label: string }
  | { kind: 'deleteDraft'; id: string; label: string }
  | { kind: 'deleteLineItem'; id: string; label: string };

const ProjectBudget: React.FC<ProjectBudgetProps> = ({ projectId }) => {
  const { t } = useTranslation();
  // Cosmetic gate on the REAL role (ADR-0016): budget line-item write = the shipped
  // WRITE_ROLES (Admin·Exec·PM·Finance). RLS is the real authority.
  const can = usePermission();
  const canWrite = can('edit', 'budgetLine');
  const { currentUser } = useAuth();
  const currentUserId = currentUser?.id ?? null;
  const { toast } = useToast();
  // The derived total (useProjectBudget) has no version of its own to carry a currency —
  // fall back to the org default until a version is selected (FR-L10N-020).
  const orgCurrency = useOrgCurrency();

  const budgetQuery = useProjectBudget(projectId);
  const versionsQuery = useBudgetVersions(projectId);
  const mutations = useBudgetMutations(projectId);

  const [newVersionName, setNewVersionName] = useState('');
  const [showNewVersionForm, setShowNewVersionForm] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Confirm-before-write: a chosen action is staged here and only commits when
  // the ConfirmDialog's Confirm is pressed (B1-B5 + delete-line-item, §6.5).
  const [pendingConfirm, setPendingConfirm] = useState<PendingBudgetConfirm | null>(null);

  // Derive versions early so useMemo is unconditional (Rules of Hooks).
  // Memoized to give a stable array reference (avoids react-hooks/exhaustive-deps warning on
  // the selected memo below).
  const versions = useMemo<BudgetVersionWithItems[]>(
    () => (versionsQuery.data ?? []) as BudgetVersionWithItems[],
    [versionsQuery.data]
  );
  const derivedTotal = budgetQuery.data ?? 0;

  // AC-BD-02/03: default-resolution priority: explicit pick → Active → highest Draft → highest Archived → first
  const selected = useMemo<BudgetVersionWithItems | null>(() => {
    if (versions.length === 0) return null;
    const byId = selectedId ? versions.find((v) => v.id === selectedId) : undefined;
    if (byId) return byId;
    return (
      versions.find((v) => v.status === 'Active') ??
      [...versions].reverse().find((v) => v.status === 'Draft') ??
      [...versions].reverse().find((v) => v.status === 'Archived') ??
      versions[0]
    );
  }, [versions, selectedId]);

  // Loading state
  if (budgetQuery.isPending || versionsQuery.isPending) {
    return (
      <div data-testid="budget-loading" className="rounded-lg border border-border bg-card">
        <ListState variant="loading" rows={4} />
      </div>
    );
  }

  // Error state
  if (budgetQuery.isError || versionsQuery.isError) {
    return (
      <ListState
        variant="error"
        title={t('financeCopy.budgetLoadFailed', "Couldn't load budget")}
        sub={t('financeCopy.somethingWentWrongFetchingTheBudgetData', "Something went wrong fetching the budget data.")}
        onRetry={() => {
          budgetQuery.refetch();
          versionsQuery.refetch();
        }}
      />
    );
  }

  // OD-BUDGET-6 (UX only — activate_budget_version is the authority): a second person activates.
  const canActivate =
    !!selected &&
    can('transition', 'budgetVersion', {
      currentUserId,
      record: { status: selected.status, created_by: selected.created_by },
    });
  const activateBlockedReason =
    !selected || !canWrite || canActivate || selected.status !== 'Draft'
      ? null
      : selected.created_by == null
        ? t('financeCopy.activateNeedsAdminOrFinance', 'No drafter is recorded for this version, so only Admin or Finance can activate it.')
        : selected.created_by === currentUserId
          ? t('financeCopy.activateDrafterBlocked', 'You drafted this version, so someone else must activate it.')
          : null;

  // Human-readable label for a version id (confirm copy). Falls back to the id.
  const versionLabel = (id: string): string => {
    const v = versions.find((x) => x.id === id);
    return v ? `${v.name} (v${v.version})` : id;
  };

  // Stage a confirm without writing. The page renders one ConfirmDialog from
  // pendingConfirm; commitConfirm() runs the real mutation only on Confirm.
  const requestCreate = (name: string) => setPendingConfirm({ kind: 'create', name });
  const requestActivate = (id: string) =>
    setPendingConfirm({ kind: 'activate', id, label: versionLabel(id) });
  const requestClone = (id: string) =>
    setPendingConfirm({ kind: 'clone', id, label: versionLabel(id) });
  const requestArchive = (id: string) =>
    setPendingConfirm({ kind: 'archive', id, label: versionLabel(id) });
  const requestDeleteDraft = (id: string) =>
    setPendingConfirm({ kind: 'deleteDraft', id, label: versionLabel(id) });
  const requestDeleteLineItem = (id: string) =>
    setPendingConfirm({ kind: 'deleteLineItem', id, label: id });

  // Commit the staged mutation and toast on resolve (§6.7). The RPC contract is
  // byte-for-byte preserved — the confirm only gates WHEN each mutateAsync runs.
  const commitBudgetConfirm = async () => {
    const c = pendingConfirm;
    if (!c) return;
    try {
      switch (c.kind) {
        case 'create':
          await mutations.createVersion.mutateAsync({ projectId, name: c.name });
          setShowNewVersionForm(false);
          setNewVersionName('');
          setPendingConfirm(null);
          toast(t('financeCopy.budgetVersionCreated', 'Budget version created'), c.name, 'success');
          break;
        case 'activate': {
          const { pushState } = await mutations.activate.mutateAsync(c.id);
          setPendingConfirm(null);
          // ⚑ HIGH-C: PMO's transition succeeded either way (ADR-0059 §3.2 — the ERPNext push is a
          // CONSEQUENCE of activation, never its precondition), but a push that did not land must be
          // said out loud. Otherwise ERPNext keeps enforcing the previous budget (or none) while this
          // screen reports a clean success — and when the dispatch never reached the edge function
          // there is no mirror row for the sweep backstop to re-drive either. The recovery affordance
          // is the Budget projection's "Retry the push".
          if (pushState === 'failed') {
            toast(
              t('financeCopy.versionActivatedERPNotUpdated', 'Version activated — but ERPNext was not updated'),
              t('financeCopy.budgetActiveRetryFromProjection', "{{version}}. PMO's budget is active; retry the push from the Budget projection.", { version: c.label }),
              'warning',
            );
          } else if (pushState === 'nothing-to-push') {
            // ⚑ FU-2 round 2: the version has NO line items, so the fan-out attempted no fiscal year and
            // created no ERP `Budget`. Announcing a push would be a statement about money that never
            // moved; announcing a failure would invent an attempt. Nothing was sent — say that, and name
            // the act that changes it. (The per-year `never-pushed` banner agrees rather than contradicts.)
            toast(
              t('financeCopy.versionActivatedNothingSent', 'Version activated — nothing was sent to ERPNext'),
              t('financeCopy.noBudgetLinesToPush', '{{version}} has no budget lines, so no ERPNext Budget was created. Add lines and activate a new version to enforce one.', { version: c.label }),
              'warning',
            );
          } else {
            toast(t('financeCopy.versionActivated', 'Version activated'), c.label, 'success');
          }
          break;
        }
        case 'clone': {
          const newDraftId = await mutations.cloneVersion.mutateAsync(c.id);
          setPendingConfirm(null);
          // Auto-open the new draft (N9: clone auto-opens new draft)
          setSelectedId(newDraftId);
          toast(t('financeCopy.versionCloned', 'Version cloned'), t('financeCopy.newDraftFrom', 'New draft from {{version}}', { version: c.label }), 'success');
          break;
        }
        case 'archive':
          await mutations.archive.mutateAsync(c.id);
          setPendingConfirm(null);
          toast(t('financeCopy.versionArchived', 'Version archived'), c.label, 'success');
          break;
        case 'deleteDraft':
          await mutations.deleteDraft.mutateAsync(c.id);
          setPendingConfirm(null);
          toast(t('financeCopy.draftDeleted', 'Draft deleted'), c.label, 'success');
          break;
        case 'deleteLineItem':
          await mutations.deleteLineItem.mutateAsync(c.id);
          setPendingConfirm(null);
          toast(t('financeCopy.lineItemDeleted', 'Line item deleted'), undefined, 'success');
          break;
      }
    } catch (err) {
      setPendingConfirm(null);
      toast(t('financeCopy.actionFailed', 'Action failed'), err instanceof Error ? err.message : undefined, 'warning');
    }
  };

  // The single page-level ConfirmDialog, derived from pendingConfirm. Destructive
  // (modal+scrim) for archive / delete-draft / delete-line-item; default
  // (popover severity) for create / activate / clone (§6.5 + §3.1).
  const confirmInFlight =
    mutations.createVersion.isPending ||
    mutations.activate.isPending ||
    mutations.cloneVersion.isPending ||
    mutations.archive.isPending ||
    mutations.deleteDraft.isPending ||
    mutations.deleteLineItem.isPending;

  const confirmCopy: Record<
    PendingBudgetConfirm['kind'],
    { tone: 'default' | 'destructive'; title: string; confirmLabel: string }
  > = {
    create: { tone: 'default', title: t('financeCopy.createBudgetVersion', "Create budget version?"), confirmLabel: t('financeCopy.createVersion', 'Create version') },
    activate: { tone: 'default', title: t('financeCopy.makeThisTheActiveBudget', "Make this the active budget?"), confirmLabel: t('financeCopy.activateVersion', 'Activate version') },
    clone: { tone: 'default', title: t('financeCopy.cloneToANewDraft', "Clone to a new draft?"), confirmLabel: t('financeCopy.cloneVersion', 'Clone version') },
    archive: { tone: 'destructive', title: t('financeCopy.archiveThisVersion', "Archive this version?"), confirmLabel: t('financeCopy.archiveVersion', 'Archive version') },
    deleteDraft: { tone: 'destructive', title: t('financeCopy.deleteThisDraft', "Delete this draft?"), confirmLabel: t('financeCopy.deleteDraft', 'Delete draft') },
    deleteLineItem: { tone: 'destructive', title: t('financeCopy.deleteThisLineItem', "Delete this line item?"), confirmLabel: t('financeCopy.delete', 'Delete') },
  };

  // Each handler receives its OWN narrowed variant (a per-kind mapped type), so
  // no fragile in-body re-narrowing (`c.kind === 'create' ? c.name : ''`) is
  // needed and no empty-string '""' can render (item J). The call site dispatches
  // through a single helper that ties the handler to the matching variant.
  type ConfirmDescriptions = {
    [K in PendingBudgetConfirm['kind']]: (c: Extract<PendingBudgetConfirm, { kind: K }>) => string;
  };
  const confirmDescriptions: ConfirmDescriptions = {
    create: (c) => `This creates a new Draft budget version named "${c.name}".`,
    activate: (c) =>
      `This makes ${c.label} the live active budget and supersedes the current active version.`,
    clone: (c) => `This copies ${c.label} into a new editable Draft.`,
    archive: (c) =>
      `This removes ${c.label} as the active budget. You can clone it later to revise.`,
    deleteDraft: (c) => `This permanently deletes the draft ${c.label}. This cannot be undone.`,
    deleteLineItem: () => 'This permanently removes the line item from the draft. This cannot be undone.',
  };
  const describeConfirm = (c: PendingBudgetConfirm): string =>
    // Safe: the union is keyed by `kind`, so the handler at c.kind accepts c.
    (confirmDescriptions[c.kind] as (x: PendingBudgetConfirm) => string)(c);

  const budgetConfirm = pendingConfirm && (
    <ConfirmDialog
      open
      tone={confirmCopy[pendingConfirm.kind].tone}
      title={confirmCopy[pendingConfirm.kind].title}
      description={describeConfirm(pendingConfirm)}
      confirmLabel={confirmCopy[pendingConfirm.kind].confirmLabel}
      loading={confirmInFlight}
      onCancel={() => setPendingConfirm(null)}
      onConfirm={() => void commitBudgetConfirm()}
    />
  );

  const head = (
    // AC-W6-IXD-BUDHEAD (B-3): the redundant <h2>Project Budget</h2> duplicated the
    // selected "Budget" tab label (which already names the section). Dropped — the
    // useful "Active budget: $X" line is promoted as the quiet section lead. The tab
    // is the section heading; no orphaned hierarchy (the page <h1> is the project name).
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="text-sm text-muted-foreground">
          {t('financeCopy.activeBudget', "Active budget:")}{' '}
          <span data-testid="derived-budget" className="font-semibold tabular text-foreground">
            {formatCurrency(derivedTotal, selected?.currency ?? orgCurrency)}
          </span>
        </p>
      </div>
      {canWrite && (
        <Button variant="outline" onClick={() => setShowNewVersionForm(true)}>
          {t('financeCopy.newVersion', "+ New version")}</Button>
      )}
    </div>
  );

  // Empty state
  if (versions.length === 0) {
    return (
      <div data-testid="budget-empty" className="flex flex-col gap-4">
        {head}
        {showNewVersionForm && canWrite && (
          <NewVersionForm
            onSubmit={requestCreate}
            onCancel={() => setShowNewVersionForm(false)}
            value={newVersionName}
            onChange={setNewVersionName}
          />
        )}
        <div className="rounded-lg border border-border bg-card">
          <ListState
            variant="empty"
            icon="dollar"
            title={t('financeCopy.noBudgetVersionsYet', "No budget versions yet")}
            sub={t('financeCopy.createADraftVersionToStartPlanningTheProjectBudget', "Create a Draft version to start planning the project budget.")}
          />
        </div>
        {budgetConfirm}
      </div>
    );
  }

  // Normal state: version selector + single card (AC-BD-01/04/05)
  const selectFieldCls =
    'h-8 rounded-md border border-input bg-background px-2.5 text-[13px] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

  return (
    <div className="flex flex-col gap-4">
      {head}

      {showNewVersionForm && canWrite && (
        <NewVersionForm
          onSubmit={requestCreate}
          onCancel={() => setShowNewVersionForm(false)}
          value={newVersionName}
          onChange={setNewVersionName}
        />
      )}

      {/* AC-BD-01: Version selector bar */}
      <Toolbar
        standalone
        className="flex flex-wrap items-center gap-2 py-2"
        data-testid="version-selector"
      >
        {/* A1: visible label wired to select */}
        <label
          htmlFor="budget-version-select"
          className="text-[12px] font-semibold text-muted-foreground"
        >
          {t('financeCopy.version', "Version")}</label>
        {/* A2/A3: native select — keyboard nav, focus ring, type-ahead all free */}
        <select
          id="budget-version-select"
          aria-label={t('financeCopy.version', "Version")}
          value={selected?.id ?? ''}
          onChange={(e) => setSelectedId(e.target.value)}
          className={`${selectFieldCls} min-w-[200px] max-w-xs`}
        >
          {versions.map((v) => (
            // A4/N1/N2: status in text (not color only), no em-dash, no emoji
            <option key={v.id} value={v.id}>
              {`v${v.version} · ${v.name} (${v.status})`}
            </option>
          ))}
        </select>
        {/* A4/A5: status pill — tinted, darkened AA text, dot + text (not color-only) */}
        {selected && (
          <StatusPill variant={budgetVersionVariant(selected.status)}>{budgetStatusLabel(selected.status, t)}</StatusPill>
        )}
        {/* A6: tabular total in selector bar so it's visible without scrolling */}
        {selected && (
          <span className="ml-auto text-[13px] font-semibold tabular">
            {formatCurrency(selected.total, selected.currency)}
          </span>
        )}
      </Toolbar>

      {/* AC-BD-05: exactly ONE VersionCard */}
      <div className="flex flex-col gap-4">
        {selected && (
          <VersionCard
            key={selected.id}
            version={selected}
            canWrite={canWrite}
            canActivate={canActivate}
            activateBlockedReason={activateBlockedReason}
            onActivate={requestActivate}
            onArchive={requestArchive}
            onClone={requestClone}
            onDeleteDraft={requestDeleteDraft}
            // create/update line-item stay direct (Open-Q#3: a form submit is
            // already a deliberate two-step, not a single click).
            onCreateLineItem={(versionId, item) =>
              mutations.createLineItem.mutateAsync({ versionId, item })
            }
            onDeleteLineItem={requestDeleteLineItem}
            // Inline edit is routine (OD-UX-1): single-click Save + toast, no confirm.
            onUpdateLineItem={(id, patch) =>
              mutations.updateLineItem.mutateAsync({ id, patch })
            }
            onUpdateLineItemSuccess={() =>
              toast(t('financeCopy.lineItemUpdated', 'Line item updated'), undefined, 'success')
            }
            // B-0.7: thread isPending into Save buttons (double-submit guard).
            createIsPending={mutations.createLineItem.isPending}
            updateIsPending={mutations.updateLineItem.isPending}
            // B-0.6: surface mutation errors via toast (no silent no-op).
            onLineItemSaveError={(err) => {
              const { headline, detail } = classifyMutationError(err);
              toast(headline, detail, 'warning');
            }}
          />
        )}
      </div>

      {budgetConfirm}
    </div>
  );
};

// ---------------------------------------------------------------------------
// New version form
// ---------------------------------------------------------------------------
const NewVersionForm: React.FC<{
  /** Stages a create-version confirm (no write on click). */
  onSubmit: (name: string) => void;
  onCancel: () => void;
  value: string;
  onChange: (v: string) => void;
}> = ({ onSubmit, onCancel, value, onChange }) => {
  const { t } = useTranslation();
  return (
    <Toolbar standalone className="items-center">
    <input
      type="text"
      aria-label={t('financeCopy.versionName', "Version name")}
      placeholder={t('financeCopy.versionNameEGBudgetV1', "Version name (e.g. Budget v1)")}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 flex-1 rounded-md border border-input bg-background px-2.5 text-[13.5px] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      autoFocus
    />
    <Button variant="primary" onClick={() => value.trim() && onSubmit(value.trim())} disabled={!value.trim()}>
      {t('financeCopy.create', "Create")}</Button>
    <Button variant="outline" onClick={onCancel}>
      {t('financeCopy.cancel', "Cancel")}</Button>
    </Toolbar>
  );
};

export default ProjectBudget;
