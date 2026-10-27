import React, { useState, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useProjectBudget, useBudgetVersions, useBudgetMutations, useBudgetActivationMode } from '@/src/hooks/useBudget';
import { usePermission } from '@/src/auth/usePermission';
import { useAuth } from '@/src/auth/useAuth';
import { useProjectProcurements } from '@/src/hooks/useProcurements';
import { budgetCategoryLabel } from '@/src/lib/i18n/budgetCategoryLabel';
import {
  formatCurrencyAuto,
  formatNumberMax2,
  formatMoneyInputValue,
  parseMoneyInputAtScale,
} from '@/src/lib/format';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import {
  Button,
  ListState,
  Toolbar,
  DataTable,
  type Column,
  ConfirmDialog,
  useToast,
  NumberField,
  TaxBasisLabel,
} from '@/src/components/ui';
import type { BudgetVersionWithItems, BudgetLineItemRow, NewLineItem } from '@/src/lib/db/budgets';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import { useBudgetPosition } from './project-detail/useProjectPosition';
import BudgetSummary from './project-detail/budget/BudgetSummary';
import BudgetVersionsDrawer from './project-detail/budget/BudgetVersionsDrawer';
import BudgetErpNotice from './project-detail/budget/BudgetErpNotice';
import { compareBudgetVersions, type BudgetComparisonRow } from './project-detail/budget/budgetModel';
import { Constants, type Enums } from '@/src/lib/supabase/database.types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
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
}

/** One DataTable row of the editor: an existing line, or the single in-progress new line. */
type EditorRow = { kind: 'item'; li: BudgetLineItemRow } | { kind: 'new' };

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
      setEditAmountError(t('financeCopy.amountMustBeGreaterThanZero', 'Amount must be greater than 0'));
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
      setNewAmountError(t('financeCopy.amountMustBeGreaterThanZero', 'Amount must be greater than 0'));
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
      className={fieldCls}
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
                onChange={(e) => setNewFiscalYear(e.target.value)}
                className={`${fieldCls} w-32`}
              />
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
              onChange={(e) => setEditFiscalYear(e.target.value)}
              className={`${fieldCls} w-32`}
            />
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
        totals={[{
          key: 'total',
          label: t('financeCopy.total', "Total"),
          values: {
            amount: <span data-testid="budget-edit-total" className="font-bold">{formatCurrencyAuto(total, currency)}</span>,
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

// ---------------------------------------------------------------------------
// Main page component (NFR-BV-UI-001)
// ---------------------------------------------------------------------------
interface ProjectBudgetProps {
  projectId: string;
  project: ProjectWithRefs;
}

/** A staged, not-yet-committed budget mutation awaiting the ConfirmDialog
 *  (owner rule: nothing writes on a single click). B1-B5 + delete-line-item. */
type PendingBudgetConfirm =
  | { kind: 'create'; name: string }
  | { kind: 'activate'; id: string; label: string; soleOperator: boolean }
  | { kind: 'clone'; id: string; label: string }
  | { kind: 'archive'; id: string; label: string }
  | { kind: 'deleteDraft'; id: string; label: string }
  | { kind: 'deleteLineItem'; id: string; label: string };

const ProjectBudget: React.FC<ProjectBudgetProps> = ({ projectId, project }) => {
  const { t } = useTranslation();
  const can = usePermission();
  const canWrite = can('edit', 'budgetLine');
  const canReadProcurements = can('view', 'procurement');
  const canManageAccounting = can('manage', 'orgAccounting');
  const { currentUser } = useAuth();
  const currentUserId = currentUser?.id ?? null;
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const budgetQuery = useProjectBudget(projectId);
  const versionsQuery = useBudgetVersions(projectId);
  const mutations = useBudgetMutations(projectId);
  const position = useBudgetPosition(project);
  const procurementsQuery = useProjectProcurements(canReadProcurements ? projectId : null);

  const [newVersionName, setNewVersionName] = useState('');
  const [showNewVersionForm, setShowNewVersionForm] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<PendingBudgetConfirm | null>(null);

  const versions = useMemo<BudgetVersionWithItems[]>(
    () => (versionsQuery.data ?? []) as BudgetVersionWithItems[],
    [versionsQuery.data],
  );
  const activeVersion = versions.find((version) => version.status === 'Active');
  const draftVersion = versions.find((version) => version.status === 'Draft');
  const activationModeQuery = useBudgetActivationMode(draftVersion?.id);

  if (budgetQuery.isPending || versionsQuery.isPending) {
    return <div data-testid="budget-loading"><ListState variant="loading" rows={4} /></div>;
  }
  if (budgetQuery.isError || versionsQuery.isError) {
    return (
      <ListState
        variant="error"
        title={t('financeCopy.budgetLoadFailed', "Couldn't load budget")}
        sub={t('financeCopy.somethingWentWrongFetchingTheBudgetData', 'Something went wrong fetching the budget data.')}
        onRetry={() => {
          void budgetQuery.refetch();
          void versionsQuery.refetch();
        }}
      />
    );
  }

  const soleOperator = activationModeQuery.data === 'sole_operator';
  const canActivate = !!draftVersion && (soleOperator || can('transition', 'budgetVersion', {
    currentUserId,
    record: { status: draftVersion.status, created_by: draftVersion.created_by, editor_ids: draftVersion.editor_ids },
  }));
  const versionLabel = (id: string): string => {
    const version = versions.find((item) => item.id === id);
    return version ? version.name + ' (v' + version.version + ')' : id;
  };
  const requestCreate = (name: string) => setPendingConfirm({ kind: 'create', name });
  const requestActivate = (id: string) => setPendingConfirm({ kind: 'activate', id, label: versionLabel(id), soleOperator });
  const requestClone = (id: string) => setPendingConfirm({ kind: 'clone', id, label: versionLabel(id) });
  const requestArchive = (id: string) => setPendingConfirm({ kind: 'archive', id, label: versionLabel(id) });
  const requestDeleteDraft = (id: string) => setPendingConfirm({ kind: 'deleteDraft', id, label: versionLabel(id) });
  const requestDeleteLineItem = (id: string) => setPendingConfirm({ kind: 'deleteLineItem', id, label: id });

  const commitBudgetConfirm = async () => {
    const confirm = pendingConfirm;
    if (!confirm) return;
    try {
      switch (confirm.kind) {
        case 'create': {
          await mutations.createVersion.mutateAsync({ projectId, name: confirm.name });
          setShowNewVersionForm(false);
          setNewVersionName('');
          setPendingConfirm(null);
          toast(t('financeCopy.budgetVersionCreated', 'Budget version created'), confirm.name, 'success');
          break;
        }
        case 'activate': {
          const { pushState } = await mutations.activate.mutateAsync(confirm.id);
          void queryClient.invalidateQueries({ queryKey: ['budget-push-status', projectId] });
          setPendingConfirm(null);
          if (pushState === 'failed') {
            toast(
              t('financeCopy.versionActivatedERPNotUpdated', 'Version activated — but ERPNext was not updated'),
              t('projectDetail.budget.erpReviewHint', "{{version}}. The budget is active; ask Finance or an administrator to review ERP enforcement.", { version: confirm.label }),
              'warning',
            );
          } else if (pushState === 'nothing-to-push') {
            toast(
              t('financeCopy.versionActivatedNothingSent', 'Version activated — nothing was sent to ERPNext'),
              t('financeCopy.noBudgetLinesToPush', '{{version}} has no budget lines, so no ERPNext Budget was created. Add lines and activate a new version to enforce one.', { version: confirm.label }),
              'warning',
            );
          } else {
            toast(t('financeCopy.versionActivated', 'Version activated'), confirm.label, 'success');
          }
          break;
        }
        case 'clone': {
          await mutations.cloneVersion.mutateAsync(confirm.id);
          setPendingConfirm(null);
          toast(t('financeCopy.versionCloned', 'Version cloned'), t('financeCopy.newDraftFrom', 'New draft from {{version}}', { version: confirm.label }), 'success');
          break;
        }
        case 'archive':
          await mutations.archive.mutateAsync(confirm.id);
          void queryClient.invalidateQueries({ queryKey: ['budget-push-status', projectId] });
          setPendingConfirm(null);
          toast(t('financeCopy.versionArchived', 'Version archived'), confirm.label, 'success');
          break;
        case 'deleteDraft':
          await mutations.deleteDraft.mutateAsync(confirm.id);
          setPendingConfirm(null);
          toast(t('financeCopy.draftDeleted', 'Draft deleted'), confirm.label, 'success');
          break;
        case 'deleteLineItem':
          await mutations.deleteLineItem.mutateAsync(confirm.id);
          setPendingConfirm(null);
          toast(t('financeCopy.lineItemDeleted', 'Line item deleted'), undefined, 'success');
          break;
      }
    } catch (error) {
      setPendingConfirm(null);
      toast(t('financeCopy.actionFailed', 'Action failed'), error instanceof Error ? error.message : undefined, 'warning');
    }
  };

  const confirmInFlight = mutations.createVersion.isPending || mutations.activate.isPending || mutations.cloneVersion.isPending ||
    mutations.archive.isPending || mutations.deleteDraft.isPending || mutations.deleteLineItem.isPending;
  const confirmCopy: Record<PendingBudgetConfirm['kind'], { tone: 'default' | 'destructive'; title: string; confirmLabel: string }> = {
    create: { tone: 'default', title: t('financeCopy.createBudgetVersion', 'Create budget version?'), confirmLabel: t('financeCopy.createVersion', 'Create version') },
    activate: { tone: 'default', title: t('financeCopy.makeThisTheActiveBudget', 'Make this the active budget?'), confirmLabel: t('financeCopy.activateVersion', 'Activate version') },
    clone: { tone: 'default', title: t('financeCopy.cloneToANewDraft', 'Clone to a new draft?'), confirmLabel: t('financeCopy.cloneVersion', 'Clone version') },
    archive: { tone: 'destructive', title: t('financeCopy.archiveThisVersion', 'Archive this version?'), confirmLabel: t('financeCopy.archiveVersion', 'Archive version') },
    deleteDraft: { tone: 'destructive', title: t('financeCopy.deleteThisDraft', 'Delete this draft?'), confirmLabel: t('financeCopy.deleteDraft', 'Delete draft') },
    deleteLineItem: { tone: 'destructive', title: t('financeCopy.deleteThisLineItem', 'Delete this line item?'), confirmLabel: t('financeCopy.delete', 'Delete') },
  };
  type ConfirmDescriptions = { [K in PendingBudgetConfirm['kind']]: (confirm: Extract<PendingBudgetConfirm, { kind: K }>) => string };
  const confirmDescriptions: ConfirmDescriptions = {
    create: (confirm) => t('financeCopy.confirmCreateDescription', 'This creates a new Draft budget version named "{{name}}".', { name: confirm.name }),
    activate: (confirm) => confirm.soleOperator
      ? t('financeCopy.confirmSoleOperatorActivation', "You're the only person in this organisation, so you can activate a budget you prepared yourself. Once a colleague joins, a second person will need to activate it.")
      : t('financeCopy.confirmActivateDescription', 'This makes {{version}} the live active budget and supersedes the current active version.', { version: confirm.label }),
    clone: (confirm) => t('financeCopy.confirmCloneDescription', 'This copies {{version}} into a new editable Draft.', { version: confirm.label }),
    archive: (confirm) => t('financeCopy.confirmArchiveDescription', 'This removes {{version}} as the active budget. You can clone it later to revise.', { version: confirm.label }),
    deleteDraft: (confirm) => t('financeCopy.confirmDeleteDraftDescription', 'This permanently deletes the draft {{version}}. This cannot be undone.', { version: confirm.label }),
    deleteLineItem: () => t('financeCopy.confirmDeleteLineItemDescription', 'This permanently removes the line item from the draft. This cannot be undone.'),
  };
  const describeConfirm = (confirm: PendingBudgetConfirm): string =>
    (confirmDescriptions[confirm.kind] as (value: PendingBudgetConfirm) => string)(confirm);
  const budgetConfirm = pendingConfirm && (
    <ConfirmDialog
      open
      tone={confirmCopy[pendingConfirm.kind].tone}
      title={confirmCopy[pendingConfirm.kind].title}
      description={describeConfirm(pendingConfirm)}
      confirmLabel={confirmCopy[pendingConfirm.kind].confirmLabel}
      loading={confirmInFlight}
      restoreFocusFallback={() => document.querySelector<HTMLElement>('#budget-primary-action, #budget-versions-trigger')}
      onCancel={() => setPendingConfirm(null)}
      onConfirm={() => void commitBudgetConfirm()}
    />
  );

  const categoryLabel = (category: string) => budgetCategoryLabel(category, t);
  const proposedChanges = activeVersion && draftVersion
    ? compareBudgetVersions(activeVersion.line_items, draftVersion.line_items)
    : [];
  const comparisonColumns: Column<BudgetComparisonRow>[] = [
    { key: 'category', header: t('financeCopy.category', 'Category'), kind: 'text', size: 180, cell: (row) => categoryLabel(row.category) },
    { key: 'current', header: t('projectDetail.budget.current', 'Current'), kind: 'money', align: 'num', size: 145, cell: (row) => formatNumberMax2(row.a) },
    { key: 'proposed', header: t('projectDetail.budget.proposed', 'Proposed'), kind: 'money', align: 'num', size: 145, cell: (row) => formatNumberMax2(row.b) },
    { key: 'change', header: t('projectDetail.budget.change', 'Change'), kind: 'money', align: 'num', size: 140, cell: (row) => (
      <span className={row.change > 0 ? 'text-destructive-text' : undefined}>{row.change > 0 ? '+' : ''}{formatNumberMax2(row.change)}</span>
    ) },
  ];
  const draftEditor = draftVersion && canWrite ? (
    <LineItemEditor
      key={draftVersion.id}
      lineItems={draftVersion.line_items}
      currency={draftVersion.currency}
      onCreateLineItem={(item) => mutations.createLineItem.mutateAsync({ versionId: draftVersion.id, item })}
      onDeleteLineItem={requestDeleteLineItem}
      onUpdateLineItem={(id, patch) => mutations.updateLineItem.mutateAsync({ id, patch })}
      onSaveSuccess={() => toast(t('financeCopy.lineItemUpdated', 'Line item updated'), undefined, 'success')}
      createIsPending={mutations.createLineItem.isPending}
      updateIsPending={mutations.updateLineItem.isPending}
      onSaveError={(error) => {
        const { headline, detail } = classifyMutationError(error);
        toast(headline, detail, 'warning');
      }}
    />
  ) : null;

  // The page header carries the one filled action; a tab's own action stays outline.
  const primaryAction = !activeVersion && !draftVersion && canWrite
    ? <Button id="budget-primary-action" variant="outline" onClick={() => setShowNewVersionForm(true)}>{t('projectDetail.budget.createBudget', 'Create budget')}</Button>
    : !activeVersion && draftVersion && canActivate
      ? <Button id="budget-primary-action" variant="outline" onClick={() => requestActivate(draftVersion.id)}>{t('financeCopy.activate', 'Activate')}</Button>
      : activeVersion && !draftVersion && canWrite
        ? <Button id="budget-primary-action" variant="outline" onClick={() => requestClone(activeVersion.id)}>{t('projectDetail.budget.updateBudget', 'Update budget')}</Button>
        : null;

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid={versions.length === 0 ? 'budget-empty' : undefined}>
      <header className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">{t('projectDetail.budget.title', 'Project budget')}</h2>
          <p className="mt-1 flex items-baseline gap-2 text-xs text-muted-foreground">
            <span>{project.currency}</span>
            {project.tax_treatment && <TaxBasisLabel treatment={project.tax_treatment} showDetails={false} className="text-xs" />}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {primaryAction}
          {versions.length > 0 && <Button id="budget-versions-trigger" variant="ghost" size="sm" onClick={() => setVersionsOpen(true)}>{t('projectDetail.budget.versions', 'Versions')}</Button>}
        </div>
      </header>

      {showNewVersionForm && !activeVersion && !draftVersion && canWrite && (
        <NewVersionForm onSubmit={requestCreate} onCancel={() => setShowNewVersionForm(false)} value={newVersionName} onChange={setNewVersionName} />
      )}

      {!activeVersion && !draftVersion && versions.length === 0 && (
        <div className="border-t border-border pt-4">
          <ListState
            variant="empty"
            icon="dollar"
            title={t('financeCopy.noBudgetVersionsYet', 'No budget versions yet')}
            sub={t('financeCopy.createADraftVersionToStartPlanningTheProjectBudget', 'Create a Draft version to start planning the project budget.')}
          />
        </div>
      )}

      {activeVersion && draftVersion && (
        <section aria-label={t('projectDetail.budget.proposedUpdate', 'Proposed update')} className="min-w-0 space-y-3" data-testid="budget-proposed-update">
          <h3 className="text-sm font-semibold">{t('projectDetail.budget.proposedUpdate', 'Proposed update')}</h3>
          <DataTable
            rows={proposedChanges}
            columns={comparisonColumns}
            rowKey={(row) => row.category}
            tableId="project-budget-proposed-update"
            accessibleName={t('projectDetail.budget.proposedUpdateTable', 'Proposed budget changes')}
            cardBelow={600}
          />
          {draftEditor}
          {canActivate
            ? <Button variant="success" onClick={() => requestActivate(draftVersion.id)}>{t('financeCopy.activate', 'Activate')}</Button>
            : <p className="text-sm text-muted-foreground">{t('projectDetail.budget.waitingForFinance', 'Waiting for approval by finance')}</p>}
        </section>
      )}

      {!activeVersion && draftVersion && (
        <section aria-label={t('projectDetail.budget.draftBudget', 'Draft budget')} className="min-w-0 space-y-3">
          {draftEditor}
          {!canActivate && <p className="text-sm text-muted-foreground">{t('projectDetail.budget.waitingForFinance', 'Waiting for approval by finance')}</p>}
        </section>
      )}

      <BudgetErpNotice
        projectId={projectId}
        activeVersion={activeVersion}
      />

      <BudgetSummary
        project={project}
        activeVersion={activeVersion}
        position={position}
        procurements={procurementsQuery.data}
        canReadProcurements={canReadProcurements && !procurementsQuery.isPending && !procurementsQuery.isError}
        canManageAccounting={canManageAccounting}
      />

      <BudgetVersionsDrawer
        open={versionsOpen}
        onClose={() => setVersionsOpen(false)}
        versions={versions}
        canWrite={canWrite}
        hasDraft={Boolean(draftVersion)}
        nestedOpen={Boolean(pendingConfirm)}
        onArchive={requestArchive}
        onClone={requestClone}
        onDeleteDraft={requestDeleteDraft}
      />
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
