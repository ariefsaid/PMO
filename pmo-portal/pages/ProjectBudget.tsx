import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { useProjectBudget, useBudgetVersions, useBudgetMutations, useBudgetActivationMode } from '@/src/hooks/useBudget';
import { usePermission } from '@/src/auth/usePermission';
import { useAuth } from '@/src/auth/useAuth';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useUsers } from '@/src/hooks/useUsers';
import { useProjectProcurements } from '@/src/hooks/useProcurements';
import { useErpnextBinding } from '@/src/hooks/useErpnextBinding';
import { budgetCategoryLabel } from '@/src/lib/i18n/budgetCategoryLabel';
import {
  formatCurrency,
  formatCurrencyAuto,
  formatMoneyInputValue,
  formatNumberMax2,
  formatShortMoney,
  formatInstantDate,
  parseMoneyInputAtScale,
} from '@/src/lib/format';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { budgetVersionVariant } from '@/src/lib/status/statusVariants';
import {
  Button,
  Icon,
  ListState,
  Toolbar,
  DataTable,
  type Column,
  type RowMenuItem,
  ConfirmDialog,
  useToast,
  NumberField,
  TaxBasisLabel,
  StatusPill,
  Tooltip,
  KPIRow,
  KPITile,
  ViewToggle,
  ProgressBar,
  Drawer,
  MenuButton,
} from '@/src/components/ui';
import type { BudgetVersionWithItems, BudgetLineItemRow, NewLineItem } from '@/src/lib/db/budgets';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import { useBudgetPosition } from './project-detail/useProjectPosition';
import BudgetVersionsDrawer from './project-detail/budget/BudgetVersionsDrawer';
import BudgetErpNotice from './project-detail/budget/BudgetErpNotice';
import { buildBudgetSummaryRows, committedTotal, type BudgetSummaryRow } from './project-detail/budget/budgetModel';
import { Constants, type Enums } from '@/src/lib/supabase/database.types';
import BudgetProjection from './BudgetProjection';
import { AttributedSpendingNote } from './project-detail/AttributedSpendingNote';
import { fetchBudgetPushStatus, type BudgetPushStatusRow } from '@/src/lib/repositories/budgetProjection';

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
  const { t } = useTranslation('finance');
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
        className="rounded-none border-0 bg-transparent"
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
  const { t } = useTranslation('finance');
  const can = usePermission();
  const { realRole } = useEffectiveRole();
  const canWrite = can('edit', 'budgetLine');
  const canReadMoney = can('view', 'salesInvoice');
  const canReadProcurements = can('view', 'procurement');
  const canManageAccounting = can('manage', 'orgAccounting');
  // #1402 scopes ERP push status to Finance and Admin.
  const canViewBudgetEnforcement = realRole === 'Admin' || realRole === 'Finance';
  const { currentUser } = useAuth();
  const usersQuery = useUsers();
  const erpBindingQuery = useErpnextBinding();
  const currentUserId = currentUser?.id ?? null;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedForecast = searchParams.get('budgetView') === 'forecast';
  const setBudgetView = (nextView: 'actual' | 'forecast') => {
    const next = new URLSearchParams(searchParams);
    next.delete('open');
    if (nextView === 'forecast') next.set('budgetView', 'forecast');
    else next.delete('budgetView');
    setSearchParams(next, { replace: true });
  };
  const openCategory = (row: BudgetSummaryRow) => {
    const next = new URLSearchParams(searchParams);
    next.set('open', row.category);
    setSearchParams(next);
  };
  const closeCategory = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('open');
    setSearchParams(next, { replace: true });
  };

  const budgetQuery = useProjectBudget(projectId);
  const versionsQuery = useBudgetVersions(projectId);
  const mutations = useBudgetMutations(projectId);
  const position = useBudgetPosition(project);
  const procurementsQuery = useProjectProcurements(canReadProcurements ? projectId : null);
  const pushStatusQuery = useQuery<BudgetPushStatusRow[]>({
    queryKey: ['budget-push-status', projectId],
    queryFn: () => fetchBudgetPushStatus(projectId),
    enabled: canViewBudgetEnforcement && Boolean(projectId),
  });

  const [newVersionName, setNewVersionName] = useState('');
  const [showNewVersionForm, setShowNewVersionForm] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<PendingBudgetConfirm | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [draftEditorOpen, setDraftEditorOpen] = useState(false);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(() => new Set());

  const versions = useMemo<BudgetVersionWithItems[]>(
    () => (versionsQuery.data ?? []) as BudgetVersionWithItems[],
    [versionsQuery.data],
  );
  const activeVersion = versions.find((version) => version.status === 'Active');
  const draftVersion = versions.find((version) => version.status === 'Draft');
  const hasActiveErpBinding = erpBindingQuery.data?.status === 'active';
  const view = requestedForecast && hasActiveErpBinding && activeVersion ? 'forecast' : 'actual';
  const orderedVersions = [...versions].sort((a, b) => a.version - b.version);
  const selectedVersion = view === 'forecast'
    ? activeVersion
    : versions.find((version) => version.id === selectedVersionId) ?? activeVersion ?? draftVersion ?? orderedVersions.at(-1);
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
  const activateBlockedReason = !draftVersion || canActivate ? null
    : draftVersion.created_by == null
      ? t('financeCopy.activateNeedsAdminOrFinance', 'No drafter is recorded for this version, so only Admin or Finance can activate it.')
      : draftVersion.editor_ids?.includes(currentUserId ?? '') || draftVersion.created_by === currentUserId
        ? t('financeCopy.activateEditorBlocked', 'You drafted or edited this version, so someone else must activate it.')
        : t('projectDetail.budget.activationSeparationNextStep', 'The drafter and activator must be different people. Ask an eligible Admin or Finance user who did not edit this draft to activate it.');
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

  const canSeeActuals = canReadMoney && position.canSeeActual;
  const canSeeCommitments = canReadMoney && canReadProcurements && !procurementsQuery.isPending && !procurementsQuery.isError;
  const summaryRows = selectedVersion && canReadMoney ? buildBudgetSummaryRows({
    lines: selectedVersion.line_items,
    actuals: position.rows,
    procurements: procurementsQuery.data,
    canReadProcurements: canSeeCommitments,
    currency: project.currency,
  }) : [];
  const enrichedRows = summaryRows.map((row) => {
    const actualKnown = canSeeActuals && row.spent !== null;
    const committedKnown = canSeeCommitments && row.committed !== null;
    const left = actualKnown && committedKnown ? row.budget - (row.spent ?? 0) - (row.committed ?? 0) : null;
    const used = row.budget > 0 && actualKnown && committedKnown
      ? ((row.spent ?? 0) + (row.committed ?? 0)) / row.budget * 100
      : null;
    return { ...row, left, used };
  });
  const selectedCategory = view === 'actual'
    ? enrichedRows.find((row) => row.category === searchParams.get('open')) ?? null
    : null;
  const totalBudget = activeVersion?.total ?? null;
  const tableBudgetTotal = selectedVersion?.total ?? null;
  const totalSpent = enrichedRows.length > 0 && enrichedRows.every((row) => row.spent !== null && canSeeActuals)
    ? enrichedRows.reduce((sum, row) => sum + (row.spent ?? 0), 0)
    : null;
  // L12: one committed calculation for the whole project — the Overview reads the same shared total.
  const totalCommitted = canSeeCommitments ? committedTotal(enrichedRows) : null;
  const totalLeft = tableBudgetTotal !== null && totalSpent !== null && totalCommitted !== null
    ? tableBudgetTotal - totalSpent - totalCommitted
    : null;
  const tableLeftTotal = tableBudgetTotal !== null && totalSpent !== null && totalCommitted !== null
    ? tableBudgetTotal - totalSpent - totalCommitted
    : null;
  // C4: an unknown author or date is left out of the line, never printed as "unavailable".
  const authorName = (version: BudgetVersionWithItems) => version.created_by != null && version.created_by === currentUserId
    ? t('common.you', 'You')
    : usersQuery.data?.find((user) => user.id === version.created_by)?.full_name ?? null;
  const versionMeta = (version: BudgetVersionWithItems) => [
    version.created_at ? formatInstantDate(version.created_at) : null,
    authorName(version),
  ].filter(Boolean).join(' · ');
  /** A row's budget status, or null when spending or commitments are unknown (the page states that reason once). */
  const getStatus = (row: { budget: number; spent: number | null; committed: number | null; used: number | null; left: number | null }) => {
    if (row.budget === 0 && row.left !== null && row.left < 0) return { variant: 'warn' as const, label: t('projectDetail.budget.notBudgeted', 'Not budgeted') };
    if (row.used === null || row.left === null) return null;
    if (row.left < 0) return { variant: 'lost' as const, label: t('projectDetail.budget.overBudget', 'Over budget') };
    if (row.used >= 90) return { variant: 'lost' as const, label: t('projectDetail.budget.atRisk', 'At risk') };
    if (row.used >= 70) return { variant: 'warn' as const, label: t('projectDetail.budget.watch', 'Watch') };
    return { variant: 'won' as const, label: t('projectDetail.budget.onTrack', 'On track') };
  };
  // C5/C6: whole units; tables and the drawer print bare numbers under the one "USD · excl. PPN" heading.
  // C5 + money precision: no trailing .00 on whole amounts, but a real fraction (1,234.5) is never rounded away.
  const formatAmount = (value: number | null) => value === null ? '—' : formatNumberMax2(value);
  // F11: KPI tiles carry the short amount; the full amount stays on hover and for screen readers.
  const tileAmount = (value: number | null) => {
    if (value === null) return { value: '—' };
    const short = formatShortMoney(value, project.currency);
    const exact = formatCurrency(value, project.currency);
    return short === exact ? { value: short } : { value: short, exactValue: exact };
  };
  const budgetUnit = <span className="text-xs text-muted-foreground">{project.currency}{project.tax_treatment && <> · <TaxBasisLabel treatment={project.tax_treatment} showDetails={false} className="text-xs" /></>}</span>;
  const actualSource = t('projectDetail.budget.actualsSource', 'Source: project finance by category; this is an as-of aggregate, with no transaction trend in this view.');
  const exportRows = (rows: BudgetSummaryRow[], filename: string) => {
    const header = ['Category', 'Budget', 'Spent', 'Committed', 'Left'];
    const csv = [header, ...rows.map((row) => {
      const left = canSeeActuals && row.spent !== null && canSeeCommitments && row.committed !== null
        ? row.budget - row.spent - row.committed
        : null;
      return [budgetCategoryLabel(row.category, t), row.budget, row.spent ?? '', row.committed ?? '', left ?? ''];
    })].map((line) => line.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${filename}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const openDraftEditor = () => {
    if (draftVersion) {
      setBudgetView('actual');
      setSelectedVersionId(draftVersion.id);
      setDraftEditorOpen(true);
    }
  };
  const adjustInDraft = () => {
    if (draftVersion) openDraftEditor();
    else {
      closeCategory();
      setBudgetView('actual');
      if (activeVersion && canWrite) requestClone(activeVersion.id);
      else if (canWrite) setShowNewVersionForm(true);
    }
  };

  const actualColumns: Column<(typeof enrichedRows)[number]>[] = [
    {
      key: 'category',
      header: t('financeCopy.category', 'Category'),
      kind: 'primary',
      rowHeader: true,
      size: 250,
      cell: (row) => {
        const name = budgetCategoryLabel(row.category, t);
        return <button type="button" className="min-w-0 truncate text-left font-medium text-foreground underline-offset-2 hover:underline" aria-label={t('projectDetail.budget.openCategory', 'Open {{category}} budget details', { category: name })} onClick={(event) => { event.stopPropagation(); openCategory(row); }}>{name}</button>;
      },
      secondaryCell: () => null,
    },
    {
      key: 'budget', header: t('financeCopy.budget', 'Budget'), kind: 'money', align: 'num', size: 125, minSize: 100,
      cell: (row) => <Tooltip content={t('projectDetail.budget.budgetSource', 'Source: selected budget version line items, grouped by category.')}><span>{formatAmount(row.budget)}</span></Tooltip>,
    },
    {
      key: 'spent', header: t('projectDetail.budget.spent', 'Spent'), kind: 'money', align: 'num', size: 125, minSize: 100,
      cell: (row) => <Tooltip content={actualSource}><span>{canSeeActuals ? formatAmount(row.spent) : '—'}</span></Tooltip>,
    },
    {
      key: 'committed', header: t('projectDetail.budget.committed', 'Committed'), kind: 'money', align: 'num', size: 125, minSize: 100,
      cell: (row) => <Tooltip content={t('projectDetail.budget.committedSource', 'Source: ordered, received, supplier-invoiced and paid procurement totals in the project currency, including those with no budget category.')}><span>{canSeeCommitments ? formatAmount(row.committed) : '—'}</span></Tooltip>,
    },
    {
      key: 'left', header: t('projectDetail.budget.left', 'Left'), kind: 'money', align: 'num', size: 125, minSize: 100,
      cell: (row) => <Tooltip content={t('projectDetail.budget.leftFormula', 'Calculated as budget minus spent and committed.')}><span className={row.left !== null && row.left < 0 ? 'text-destructive-text' : undefined}>{formatAmount(row.left)}</span></Tooltip>,
    },
    {
      key: 'used', header: t('projectDetail.budget.percentUsed', '% used'), kind: 'percent', align: 'num', size: 100, minSize: 80,
      cell: (row) => row.used === null
        ? <Tooltip content={t('projectDetail.budget.utilizationUnknown', 'Utilization is unavailable when budget, spending, or commitments are unknown, or when budget is zero.')}><span>—</span></Tooltip>
        : <Tooltip content={t('projectDetail.budget.utilizationFormula', 'Calculated as (spent + committed) divided by budget.')}><span tabIndex={0}><ProgressBar compact value={Math.round(row.used)} showValue aria-label={t('projectDetail.budget.percentUsedFor', '{{category}} percent used', { category: budgetCategoryLabel(row.category, t) })} /></span></Tooltip>,
    },
    {
      key: 'status', header: t('projectDetail.budget.status', 'Status'), kind: 'status', size: 125, minSize: 112,
      cell: (row) => { const status = getStatus(row); return status ? <StatusPill variant={status.variant}>{status.label}</StatusPill> : null; },
    },
  ];
  const actualTotals = enrichedRows.length ? [{
    key: 'total', label: t('financeCopy.total', 'Total'),
    values: {
      budget: <Tooltip content={t('projectDetail.budget.budgetSource', 'Source: selected budget version line items, grouped by category.')}><span tabIndex={0}>{formatAmount(tableBudgetTotal)}</span></Tooltip>,
      spent: <Tooltip content={actualSource}><span tabIndex={0}>{formatAmount(totalSpent)}</span></Tooltip>,
      committed: <Tooltip content={t('projectDetail.budget.committedSource', 'Source: ordered, received, supplier-invoiced and paid procurement totals in the project currency, including those with no budget category.')}><span tabIndex={0}>{formatAmount(totalCommitted)}</span></Tooltip>,
      left: <Tooltip content={t('projectDetail.budget.leftFormula', 'Calculated as budget minus spent and committed.')}><span tabIndex={0}>{formatAmount(tableLeftTotal)}</span></Tooltip>,
      used: tableBudgetTotal && totalSpent !== null && totalCommitted !== null
        ? <Tooltip content={t('projectDetail.budget.utilizationFormula', 'Calculated as (spent + committed) divided by budget.')}><span tabIndex={0}>{Math.round((totalSpent + totalCommitted) / tableBudgetTotal * 100)}%</span></Tooltip>
        : '—',
    },
  }] : [];
  const categoryMenu = (row: (typeof enrichedRows)[number]): RowMenuItem[] => [
    ...(canWrite ? [{ label: t('projectDetail.budget.adjustInDraft', 'Adjust in a draft'), onClick: adjustInDraft }] : []),
    { label: t('projectDetail.budget.exportCategory', 'Export category'), onClick: () => exportRows([row], `Budget_${row.category}`) },
  ];
  const versionRows = orderedVersions.slice().reverse();
  const versionColumns: Column<BudgetVersionWithItems>[] = [
    {
      key: 'version', header: t('projectDetail.budget.version', 'Version'), kind: 'primary', rowHeader: true,
      cell: (version) => <span><span className="font-mono text-xs text-muted-foreground">v{version.version}</span> <span className="font-semibold">{version.name}</span></span>,
      secondaryCell: (version) => versionMeta(version) ? <span className="text-xs text-muted-foreground">{versionMeta(version)}</span> : null,
    },
    { key: 'status', header: t('projectDetail.budget.status', 'Status'), kind: 'status', cell: (version) => <StatusPill variant={budgetVersionVariant(version.status)}>{version.status}</StatusPill> },
    { key: 'total', header: t('financeCopy.total', 'Total'), kind: 'money', align: 'num', cell: (version) => <Tooltip content={t('projectDetail.budget.versionTotalSource', 'Source: sum of the budget line items in this version.')}><span tabIndex={0}>{formatAmount(version.total)}</span></Tooltip> },
    { key: 'change', header: t('projectDetail.budget.change', 'Change'), kind: 'money', align: 'num', cell: (version) => {
      const index = orderedVersions.findIndex((item) => item.id === version.id);
      const previous = index > 0 ? orderedVersions[index - 1] : null;
      return previous ? <Tooltip content={t('projectDetail.budget.versionChangeSource', 'Calculated as this version total minus the prior numbered version total.')}><span tabIndex={0} className={version.total > previous.total ? 'text-destructive-text' : undefined}>{version.total > previous.total ? t('projectDetail.budget.changeIncrease', '+') : ''}{formatAmount(version.total - previous.total)}</span></Tooltip> : '—';
    } },
    ...(canViewBudgetEnforcement ? [{ key: 'accounting', header: t('projectDetail.budget.accountingSystem', 'Accounting system'), cell: (version: BudgetVersionWithItems) => {
      if (version.status !== 'Active') return '—';
      if (pushStatusQuery.isPending) return <span className="text-muted-foreground">{t('projectDetail.budget.checkingPushState', 'Checking')}</span>;
      if (pushStatusQuery.isError) return <span className="inline-flex items-center gap-1 text-muted-foreground">{t('projectDetail.budget.pushStateError', "Couldn't check")}<Button variant="ghost" size="sm" onClick={() => void pushStatusQuery.refetch()}>{t('common.retry', 'Retry')}</Button></span>;
      const states = (pushStatusQuery.data ?? []).filter((row) => row.pushState !== null);
      if (!states.length) return <StatusPill variant="neutral">{t('projectDetail.budget.pushNotEnforced', 'Not enforced')}</StatusPill>;
      const labels: Record<string, { label: string; variant: 'won' | 'warn' | 'lost' | 'progress' }> = {
        pushed: { label: t('financeCopy.enforcedByERPNext', 'Enforced by ERPNext'), variant: 'won' },
        pending: { label: t('projectDetail.budget.pushQueued', 'Queued'), variant: 'progress' },
        pushing: { label: t('projectDetail.budget.pushSending', 'Sending'), variant: 'progress' },
        failed: { label: t('projectDetail.budget.pushFailed', 'Not sent'), variant: 'lost' },
        held: { label: t('projectDetail.budget.pushHeld', 'On hold'), variant: 'warn' },
        'never-pushed': { label: t('projectDetail.budget.neverPushed', 'No ERP budget yet'), variant: 'lost' },
        'unstamped-activation': { label: t('projectDetail.budget.activationDateNeeded', 'Add an activation date'), variant: 'lost' },
      };
      return <span className="flex flex-wrap gap-x-3 gap-y-1">{states.map((row, index) => {
        const state = labels[row.pushState ?? ''] ?? { label: t('projectDetail.budget.pushNotEnforced', 'Not enforced'), variant: 'lost' as const };
        return <StatusPill key={`${row.fiscalYear ?? 'project'}-${index}`} variant={state.variant}>{state.label}{row.fiscalYear ? ` · ${row.fiscalYear}` : ''}</StatusPill>;
      })}</span>;
    } } satisfies Column<BudgetVersionWithItems>] : []),
  ];
  const versionMenu = (version: BudgetVersionWithItems): RowMenuItem[] => [
    { label: t('projectDetail.budget.openVersion', 'Open version'), onClick: () => { setBudgetView('actual'); setSelectedVersionId(version.id); setVersionsOpen(true); } },
    { label: t('projectDetail.budget.compare', 'Compare'), onClick: () => setVersionsOpen(true) },
    ...(canWrite && !draftVersion && (version.status === 'Active' || version.status === 'Archived') ? [{ label: t('financeCopy.cloneToRevise', 'Clone to revise'), onClick: () => requestClone(version.id) }] : []),
    ...(canWrite && version.status === 'Active' ? [{ label: t('financeCopy.archive', 'Archive'), onClick: () => requestArchive(version.id), danger: true }] : []),
    ...(canWrite && version.status === 'Draft' && canActivate ? [{ label: t('financeCopy.activate', 'Activate'), onClick: () => requestActivate(version.id) }] : []),
    ...(canWrite && version.status === 'Draft' ? [{ label: t('financeCopy.deleteDraft', 'Delete draft'), onClick: () => requestDeleteDraft(version.id), danger: true }] : []),
  ];

  const commitBudgetConfirm = async () => {
    const confirm = pendingConfirm;
    if (!confirm) return;
    try {
      switch (confirm.kind) {
        case 'create': {
          const created = await mutations.createVersion.mutateAsync({ projectId, name: confirm.name });
          // BU-1: the new Draft is the version in view, as after "Clone to revise".
          setSelectedVersionId(created.id);
          setBudgetView('actual');
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
          const newDraftId = await mutations.cloneVersion.mutateAsync(confirm.id);
          setPendingConfirm(null);
          setSelectedVersionId(newDraftId);
          setDraftEditorOpen(false);
          setBudgetView('actual');
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

  const draftEditor = draftVersion && canWrite && draftEditorOpen && selectedVersion?.id === draftVersion.id ? (
    <section aria-label={t('projectDetail.budget.draftEditor', 'Draft budget editor')} className="min-w-0 space-y-3" data-testid="budget-draft-editor">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{draftVersion.name} · v{draftVersion.version}</h3>
        <Button variant="ghost" size="sm" onClick={() => setDraftEditorOpen(false)}>{t('common.close', 'Close')}</Button>
      </div>
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
    </section>
  ) : null;

  if (!canReadMoney) {
    return (
      <section className="rounded-lg border border-border bg-card p-4" data-testid="budget-option-a">
        <h2 className="text-base font-semibold">{t('projectDetail.budget.title', 'Project budget')}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{t('projectDetail.budget.noMoneyAccess', 'Budget details are available to project management and finance.')}</p>
      </section>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid={versions.length === 0 ? 'budget-empty' : 'budget-option-a'}>
      <header className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        {/* C6: currency and tax basis are said once, in the page heading; every figure below is a bare number. */}
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <h2 className="text-base font-semibold text-foreground">{t('projectDetail.budget.title', 'Project budget')}</h2>
          {budgetUnit}
        </div>
      </header>

      {draftVersion && (
        <section aria-label={t('projectDetail.budget.draftWaiting', 'Draft waiting for approval')} className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4" data-testid="budget-draft-banner">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <StatusPill variant="draft">{t('financeCopy.statusDraft', 'Draft')}</StatusPill>
              <h3 className="font-semibold">{t('projectDetail.budget.draftWaiting', 'Draft waiting for approval')}</h3>
              <span className="text-sm text-muted-foreground">{draftVersion.name} · v{draftVersion.version}</span>
            </div>
            {!canActivate && <p role="status" className="mt-1 text-sm text-muted-foreground">{activateBlockedReason ?? t('projectDetail.budget.waitingForFinance', 'Waiting for approval by finance')}</p>}
            {canActivate && <p className="mt-1 text-sm text-muted-foreground">{t('projectDetail.budget.draftReady', 'This draft is ready for an eligible approver to activate.')}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canWrite && <Button variant="outline" size="sm" onClick={() => { setSelectedVersionId(draftVersion.id); setDraftEditorOpen(true); }}>{t('projectDetail.budget.editDraft', 'Edit draft')}</Button>}
            {canActivate && <Button variant="success" size="sm" onClick={() => requestActivate(draftVersion.id)}>{t('projectDetail.budget.activateVersionNamed', 'Activate v{{version}}', { version: draftVersion.version })}</Button>}
          </div>
        </section>
      )}
      {/* SUB-D: with no versions at all, the empty state below says it once. */}
      {!activeVersion && versions.length > 0 && <p role="status" className="text-sm text-muted-foreground">{t('projectDetail.budget.noActiveBudget', 'No active budget')}</p>}

      {showNewVersionForm && canWrite && <NewVersionForm onSubmit={requestCreate} onCancel={() => setShowNewVersionForm(false)} value={newVersionName} onChange={setNewVersionName} />}

      {versions.length === 0 && <ListState variant="empty" icon="dollar" title={t('financeCopy.noBudgetVersionsYet', 'No budget versions yet')} sub={t('financeCopy.createADraftVersionToStartPlanningTheProjectBudget', 'Create a Draft version to start planning the project budget.')} action={canWrite ? { label: t('projectDetail.budget.createBudget', 'Create budget'), onClick: () => setShowNewVersionForm(true) } : undefined} />}

      <KPIRow aria-label={t('projectDetail.budget.figures', 'Budget figures')} className="grid-cols-2 lg:grid-cols-4">
        <KPITile icon="dollar" tone="blue" label={t('financeCopy.budget', 'Budget')} {...tileAmount(totalBudget)} help={t('projectDetail.budget.activeBudgetSource', 'Source: active budget version line items, grouped by category.')} />
        <KPITile icon="chart-column" tone="violet" label={t('projectDetail.budget.spent', 'Spent')} {...tileAmount(totalSpent)} unavailableReason={totalSpent === null ? t('projectDetail.budget.spendingUnavailable', 'Spending is unknown or unavailable.') : undefined} help={actualSource} />
        <KPITile icon="invoices" tone="amber" label={t('projectDetail.budget.committed', 'Committed')} {...tileAmount(totalCommitted)} unavailableReason={totalCommitted === null ? t('projectDetail.budget.commitmentsUnavailable', 'Commitments are unknown or unavailable.') : undefined} help={t('projectDetail.budget.committedSource', 'Source: ordered, received, supplier-invoiced and paid procurement totals in the project currency, including those with no budget category.')} />
        <KPITile icon="down" tone={totalLeft !== null && totalLeft < 0 ? 'red' : 'green'} label={t('projectDetail.budget.left', 'Left')} {...tileAmount(totalLeft)} negative={totalLeft !== null && totalLeft < 0} unavailableReason={totalLeft === null ? t('projectDetail.budget.leftUnavailable', 'Left is unknown while spending or commitments are unavailable.') : undefined} help={t('projectDetail.budget.leftFormula', 'Calculated as budget minus spent and committed.')} />
      </KPIRow>

      <section aria-label={t('projectDetail.budget.budgetVsActual', 'Budget vs actual')} className="min-w-0 space-y-3 rounded-lg border border-border bg-card p-3 sm:p-4">
        {selectedRows.size > 0 && view === 'actual' ? (
          <div className="flex min-w-0 flex-wrap items-center gap-2" role="toolbar" aria-label={t('projectDetail.budget.selectedCategories', 'Selected categories')}>
            <span className="text-sm font-medium">{t('projectDetail.budget.selectedCount', '{{count}} selected', { count: selectedRows.size })}</span>
            {canWrite && <Button variant="outline" size="sm" onClick={adjustInDraft}>{t('projectDetail.budget.adjustInDraft', 'Adjust in a draft')}</Button>}
            <Button variant="outline" size="sm" onClick={() => exportRows(enrichedRows.filter((row) => selectedRows.has(row.category)), 'ProjectBudgetSelected')}>{t('projectDetail.budget.exportRows', 'Export rows')}</Button>
            <Button variant="ghost" size="sm" onClick={() => setSelectedRows(new Set())}>{t('common.clear', 'Clear')}</Button>
          </div>
        ) : <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
          <ViewToggle
            ariaLabel={t('projectDetail.budget.budgetView', 'Budget view')}
            value={view}
            onChange={(next) => { setBudgetView(next); setSelectedRows(new Set()); if (next === 'forecast') setDraftEditorOpen(false); }}
            options={[
              { value: 'actual', label: t('projectDetail.budget.budgetVsActual', 'Budget vs actual') },
              ...(hasActiveErpBinding && activeVersion ? [{ value: 'forecast' as const, label: t('projectDetail.budget.forecast', 'Forecast') }] : []),
            ]}
          />
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>{t('projectDetail.budget.version', 'Version')}</span>
              <select aria-label={t('projectDetail.budget.version', 'Version')} value={selectedVersion?.id ?? ''} disabled={view === 'forecast'} onChange={(event) => { setSelectedVersionId(event.target.value); setDraftEditorOpen(false); }} className="h-9 max-w-52 rounded-md border border-input bg-background px-2 text-sm text-foreground disabled:opacity-70">
                {versions.map((version) => <option key={version.id} value={version.id}>v{version.version} · {version.status}</option>)}
              </select>
            </label>
            <span className="text-xs text-muted-foreground">{view === 'actual' ? t('projectDetail.budget.wholeProject', 'Whole project') : t('projectDetail.budget.fiscalYearInForecast', 'Fiscal year in forecast')}</span>
            {canWrite && activeVersion && !draftVersion && <Button variant="outline" size="sm" onClick={() => requestClone(activeVersion.id)}>{t('projectDetail.budget.updateBudget', 'Update budget')}</Button>}
            {view === 'actual' && <Button variant="outline" size="sm" onClick={() => exportRows(enrichedRows, 'ProjectBudget')}>{t('projectDetail.budget.export', 'Export')}</Button>}
          </div>
        </div>}
        {view === 'actual' ? (
          selectedVersion ? <>
            {selectedVersion.status !== 'Active' && <p className="text-sm text-muted-foreground">{t('projectDetail.budget.viewingVersion', 'Viewing {{status}} v{{version}}; project spending and commitments reflect the current project totals.', { status: selectedVersion.status, version: selectedVersion.version })}</p>}
            {draftEditor}
            <DataTable
              embedded
              rows={enrichedRows}
              columns={actualColumns}
              rowKey={(row) => row.category}
              onActivate={openCategory}
              selectedKey={selectedCategory?.category}
              selection={{
                selectedIds: selectedRows,
                onChange: setSelectedRows,
                rowLabel: (row) => t('projectDetail.budget.selectCategory', 'Select {{category}}', { category: budgetCategoryLabel(row.category, t) }),
              }}
              rowMenu={categoryMenu}
              tableId="project-budget-option-a"
              accessibleName={t('projectDetail.budget.actualTable', 'Budget vs actual by category')}
              cardBelow={600}
              totals={actualTotals}
              emptyTitle={t('projectDetail.budget.noCategories', 'No budget categories in this version')}
              emptySub={t('projectDetail.budget.noCategoriesSub', 'Add budget lines to show the category breakdown.')}
            />
            {position.actualsPending && <p role="status" className="text-sm text-muted-foreground">{t('projectDetail.cost.spendingChecking', 'Checking spending…')}</p>}
            {position.actualsError && <p role="status" className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">{t('projectDetail.budget.actualsError', "Couldn't check spending.")}<Button variant="ghost" size="sm" onClick={() => void position.refetchActuals()}>{t('common.retry', 'Retry')}</Button></p>}
            {canSeeActuals && position.unknown > 0 && !position.actualsPending && !position.actualsError && <p className="text-sm text-muted-foreground">{t('projectDetail.cost.spendingUnlinked', "Spending isn't linked yet.")} {canManageAccounting ? <a href="/administration/accounting#budget-account-map" className="font-medium text-primary-text underline underline-offset-2">{t('projectDetail.cost.finishSetup', 'Finish spending setup')}</a> : t('projectDetail.cost.askAdmin', 'An administrator can finish the setup.')}</p>}
          </> : versions.length === 0 ? null : <ListState variant="empty" title={t('projectDetail.budget.noActiveBudget', 'No active budget')} sub={t('financeCopy.createADraftVersionToStartPlanningTheProjectBudget', 'Create a Draft version to start planning the project budget.')} />
        ) : activeVersion ? <><AttributedSpendingNote projectId={projectId} /><BudgetProjection projectId={projectId} currency={project.currency} canEdit={canWrite} committedByCategory={Object.fromEntries(summaryRows.map((row) => [row.category, canSeeCommitments ? row.committed : null]))} canReadCommitments={canSeeCommitments} onAdjustInDraft={adjustInDraft} onExport={(rows) => {
          const headers = ['Category', 'Budget', 'Spent', 'Cost to finish', 'Forecast final', 'Forecast remaining'];
          const csv = [headers, ...rows.map((row) => [budgetCategoryLabel(row.category, t), row.pmoBudgetAmount ?? '', row.actualsToDate ?? '', row.pmoEtc, row.projectedFinalCost ?? '', row.projectedVariance ?? ''])].map((line) => line.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n');
          const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
          const link = document.createElement('a'); link.href = url; link.download = 'ProjectBudgetForecast.csv'; link.click(); URL.revokeObjectURL(url);
        }} /></> : <ListState variant="empty" title={t('projectDetail.budget.forecastNeedsActive', 'Activate a budget to view its forecast')} />}
      </section>

      <section aria-label={t('projectDetail.budget.versionsTitle', 'Budget versions')} className="min-w-0 space-y-3 rounded-lg border border-border bg-card p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{t('projectDetail.budget.versionsTitle', 'Budget versions')}</h3>
          <div className="flex flex-wrap items-center gap-2">
            {canWrite && versions.length > 0 && !draftVersion && <Button variant="outline" size="sm" onClick={() => setShowNewVersionForm(true)}>{t('projectDetail.budget.newVersion', 'New version')}</Button>}
            {versions.length > 0 && <Button id="budget-versions-trigger" variant="ghost" size="sm" onClick={() => setVersionsOpen(true)}>{t('projectDetail.budget.manageVersions', 'Manage versions')}</Button>}
          </div>
        </div>
        {versions.length > 0 ? <DataTable
          embedded
          rows={versionRows}
          columns={versionColumns}
          rowKey={(version) => version.id}
          onActivate={(version) => { setBudgetView('actual'); setSelectedVersionId(version.id); setVersionsOpen(true); }}
          selectedKey={selectedVersion?.id}
          rowMenu={versionMenu}
          tableId="project-budget-versions-card"
          accessibleName={t('projectDetail.budget.versionsTitle', 'Budget versions')}
          cardBelow={600}
        /> : null}
      </section>

      {canViewBudgetEnforcement && <details className="rounded-lg border border-border bg-card p-3 sm:p-4">
        <summary className="touch-target cursor-pointer text-sm font-semibold">{t('projectDetail.budget.sourcesEnforcement', 'Sources and budget enforcement')}</summary>
        <div className="mt-3 space-y-3">
          <p className="text-sm text-muted-foreground">{t('projectDetail.budget.sourceDescription', 'Budget totals come from version line items. Spent comes from project finance. Commitments come from qualifying procurement records. Forecasts use the ERP ledger and estimates for the selected client fiscal year.')}</p>
          <BudgetErpNotice
            projectId={projectId}
            activeVersion={activeVersion}
            hasDraft={Boolean(draftVersion)}
            onRecover={!canWrite ? undefined : () => {
              setBudgetView('actual');
              if (draftVersion) {
                setSelectedVersionId(draftVersion.id);
                setDraftEditorOpen(true);
              } else if (activeVersion) {
                requestClone(activeVersion.id);
              }
            }}
          />
        </div>
      </details>}

      <Drawer
        open={Boolean(selectedCategory)}
        title={selectedCategory ? budgetCategoryLabel(selectedCategory.category, t) : ''}
        icon={<Icon name="dollar" />}
        status={selectedCategory && (() => { const status = getStatus(selectedCategory); return status ? <StatusPill variant={status.variant}>{status.label}</StatusPill> : undefined; })()}
        onClose={closeCategory}
        width="lg"
        nestedOpen={Boolean(pendingConfirm)}
        headerActions={selectedCategory && <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
          {canWrite && <Button variant="primary" size="sm" onClick={adjustInDraft}>{t('projectDetail.budget.adjustInDraft', 'Adjust in a draft')}</Button>}
          <Link className="touch-target inline-flex min-h-9 items-center rounded-md border border-input bg-background px-3 text-sm font-medium text-foreground hover:bg-accent" to={`/projects/${encodeURIComponent(projectId)}/budget`}>{t('projectDetail.budget.openFullPage', 'Open full page')}</Link>
          {/* B1: the same drawer header as every record — main action · Open full page · ⋯. */}
          <MenuButton items={[{ label: t('projectDetail.budget.exportCategory', 'Export category'), onClick: () => exportRows([selectedCategory], `Budget_${selectedCategory.category}`) }]}
            ariaLabel={t('projectDetail.budget.categoryActions', '{{category}} actions', { category: budgetCategoryLabel(selectedCategory.category, t) })} />
        </div>}
      >
        {selectedCategory && <div className="space-y-5">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h2 className="text-sm font-semibold">{t('projectDetail.budget.categoryFigures', 'Figures')}</h2>
            {budgetUnit}
          </div>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            {[
              [t('financeCopy.budget', 'Budget'), formatAmount(selectedCategory.budget), t('projectDetail.budget.budgetSource', 'Source: selected budget version line items, grouped by category.')],
              [t('projectDetail.budget.spent', 'Spent'), canSeeActuals ? formatAmount(selectedCategory.spent) : '—', actualSource],
              [t('projectDetail.budget.committed', 'Committed'), canSeeCommitments ? formatAmount(selectedCategory.committed) : '—', t('projectDetail.budget.committedSource', 'Source: ordered, received, supplier-invoiced and paid procurement totals in the project currency, including those with no budget category.')],
              [t('projectDetail.budget.left', 'Left'), formatAmount(selectedCategory.left), t('projectDetail.budget.leftFormula', 'Calculated as budget minus spent and committed.')],
            ].map(([label, value, source]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="mt-1 font-semibold tabular-nums"><Tooltip content={source}><span tabIndex={0}>{value}</span></Tooltip></dd></div>)}
          </dl>
          {/* C4: cost to finish and forecast final are per fiscal year, so they live in Forecast — pointed to, not printed as placeholders. */}
          <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
            {t('projectDetail.budget.forecastPointer', 'Cost to finish and forecast final are set per fiscal year in Forecast.')}
            {hasActiveErpBinding && activeVersion && <button type="button" className="touch-target rounded-sm font-medium text-primary-text underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring" onClick={() => setBudgetView('forecast')}>{t('projectDetail.budget.openForecast', 'Open Forecast')}</button>}
          </p>
          {selectedCategory.used !== null && <div className="flex flex-col items-start gap-1.5"><Tooltip content={t('projectDetail.budget.utilizationFormula', 'Calculated as (spent + committed) divided by budget.')}><span tabIndex={0} className="text-sm font-medium">{t('projectDetail.budget.percentUsed', '% used')}</span></Tooltip><ProgressBar value={Math.round(selectedCategory.used)} showValue aria-label={t('projectDetail.budget.percentUsedFor', '{{category}} percent used', { category: budgetCategoryLabel(selectedCategory.category, t) })} /></div>}
          <section aria-labelledby="budget-records-heading" className="space-y-2">
            <h2 id="budget-records-heading" className="text-sm font-semibold">{t('projectDetail.budget.recordsBehindSpending', 'Records behind the spending')}</h2>
            <p className="text-sm text-muted-foreground">{t('projectDetail.budget.ledgerRowsUnavailable', 'Transaction-level ledger records are unavailable in the project finance summary.')}</p>
          </section>
          <section aria-labelledby="budget-category-lines-heading" className="space-y-2">
            <h2 id="budget-category-lines-heading" className="text-sm font-semibold">{t('projectDetail.budget.budgetLineItems', 'Budget line items')}</h2>
            <ul className="divide-y divide-border" aria-label={t('projectDetail.budget.budgetLineItems', 'Budget line items')}>
              {selectedCategory.lines.map((line) => <li key={line.id ?? `${line.category}-${line.description}`} className="flex min-w-0 items-start justify-between gap-3 py-2 text-sm"><span className="min-w-0 break-words text-muted-foreground">{line.description || '—'}<span className="ml-2 text-xs">{t('financeCopy.fiscalYear', 'Fiscal year')}: {line.fiscal_year ?? t('financeCopy.unPhased', 'Un-phased')}</span></span><Tooltip content={t('projectDetail.budget.budgetLineSource', 'Source: selected budget version line item.')}><span tabIndex={0} className="shrink-0 tabular-nums">{formatAmount(Number(line.budgeted_amount))}</span></Tooltip></li>)}
              {selectedCategory.lines.length === 0 && <li className="py-2 text-sm text-muted-foreground">{t('projectDetail.budget.noLineItems', 'No budget line items are recorded for this category.')}</li>}
            </ul>
          </section>
          <section aria-labelledby="budget-notes-heading" className="space-y-2">
            <h2 id="budget-notes-heading" className="text-sm font-semibold">{t('projectDetail.budget.notes', 'Notes')}</h2>
            <p className="text-sm text-muted-foreground">{t('projectDetail.budget.categoryNotesUnavailable', 'No category notes are recorded.')}</p>
          </section>
        </div>}
      </Drawer>

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
  const { t } = useTranslation('finance');
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
