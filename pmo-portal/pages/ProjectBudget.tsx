import React, { useState, useMemo } from 'react';
import { useProjectBudget, useBudgetVersions, useBudgetMutations } from '@/src/hooks/useBudget';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { formatCurrency } from '@/src/lib/format';
import {
  Button,
  StatusPill,
  ListState,
  Toolbar,
  TableFoot,
  ConfirmDialog,
  useToast,
  type StatusVariant,
} from '@/src/components/ui';
import type { BudgetVersionWithItems, BudgetLineItemRow, NewLineItem } from '@/src/lib/db/budgets';
import type { Enums } from '@/src/lib/supabase/database.types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const WRITE_ROLES: Array<Enums<'user_role'>> = ['Admin', 'Executive', 'Project Manager', 'Finance'];
const BUDGET_CATEGORIES: Array<Enums<'budget_category'>> = [
  'Labor',
  'Materials',
  'Subcontractors',
  'Equipment',
  'Permits & Fees',
  'Overheads',
  'Contingency',
];

/** vpill: Active → success, Draft → warning, Archived → secondary (DESIGN.md). */
const VERSION_PILL: Record<Enums<'budget_status'>, StatusVariant> = {
  Active: 'won',
  Draft: 'warn',
  Archived: 'neutral',
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const StatusBadge: React.FC<{ status: Enums<'budget_status'> }> = ({ status }) => (
  <span data-testid={`version-status-${status.toLowerCase()}`}>
    <StatusPill variant={VERSION_PILL[status]}>{status}</StatusPill>
  </span>
);

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
  onCreateLineItem: (item: NewLineItem) => Promise<unknown>;
  /** Stages a destructive confirm at the page level — does not delete on click. */
  onDeleteLineItem: (id: string) => void;
}

const LineItemEditor: React.FC<LineItemEditorProps> = ({
  lineItems,
  onCreateLineItem,
  onDeleteLineItem,
}) => {
  const [adding, setAdding] = useState(false);
  const [newCategory, setNewCategory] = useState<Enums<'budget_category'>>('Labor');
  const [newDesc, setNewDesc] = useState('');
  const [newAmount, setNewAmount] = useState('');

  const handleAdd = async () => {
    const amount = parseFloat(newAmount);
    if (!newCategory || isNaN(amount)) return;
    await onCreateLineItem({ category: newCategory, description: newDesc || null, budgeted_amount: amount });
    setAdding(false);
    setNewDesc('');
    setNewAmount('');
  };

  const fieldCls =
    'h-8 rounded-md border border-input bg-background px-2.5 text-[13px] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr>
            <TH>Category</TH>
            <TH>Description</TH>
            <TH align="right">Budgeted</TH>
            <TH align="right">Actual</TH>
            <th className="border-b border-border bg-card" />
          </tr>
        </thead>
        <tbody>
          {lineItems.map((li) => (
            <tr key={li.id} className="border-b border-border/70 last:border-b-0">
              <td className="px-3 py-2">{li.category}</td>
              <td className="px-3 py-2 text-muted-foreground">{li.description ?? '—'}</td>
              <td className="px-3 py-2 text-right font-medium tabular">
                {formatCurrency(Number(li.budgeted_amount))}
              </td>
              <td className="px-3 py-2 text-right tabular text-muted-foreground">
                {formatCurrency(Number(li.actual_amount))}
              </td>
              <td className="px-3 py-2 text-right">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onDeleteLineItem(li.id)}
                  className="text-destructive hover:bg-destructive/10"
                  aria-label={`Delete line item ${li.category}`}
                >
                  Delete
                </Button>
              </td>
            </tr>
          ))}
          {adding && (
            <tr className="border-b border-border/70">
              <td className="px-3 py-2">
                <select
                  aria-label="Line item category"
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value as Enums<'budget_category'>)}
                  className={fieldCls}
                >
                  {BUDGET_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </td>
              <td className="px-3 py-2">
                <input
                  type="text"
                  placeholder="Description"
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  className={`${fieldCls} w-full`}
                />
              </td>
              <td className="px-3 py-2 text-right">
                <input
                  type="number"
                  placeholder="Amount"
                  value={newAmount}
                  onChange={(e) => setNewAmount(e.target.value)}
                  className={`${fieldCls} w-28 text-right tabular`}
                />
              </td>
              <td />
              <td className="space-x-1 px-3 py-2 text-right">
                <Button variant="ghost" size="sm" onClick={handleAdd} className="text-primary">
                  Save
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>
                  Cancel
                </Button>
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {!adding && (
        <Button variant="ghost" size="sm" onClick={() => setAdding(true)} className="mt-2 text-primary">
          + Add line item
        </Button>
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
  /** Each callback STAGES a confirm at the page level — none writes on click. */
  onActivate: (id: string) => void;
  onArchive: (id: string) => void;
  onClone: (id: string) => void;
  onDeleteDraft: (id: string) => void;
  onCreateLineItem: (versionId: string, item: NewLineItem) => Promise<unknown>;
  onDeleteLineItem: (id: string) => void;
}

const VersionCard: React.FC<VersionCardProps> = ({
  version,
  canWrite,
  onActivate,
  onArchive,
  onClone,
  onDeleteDraft,
  onCreateLineItem,
  onDeleteLineItem,
}) => {
  return (
    <div data-testid="version-card" className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="font-mono text-[13px] text-muted-foreground">v{version.version}</span>
          <span className="font-semibold">{version.name}</span>
          <StatusBadge status={version.status} />
        </div>
        <span className="font-bold tabular">{formatCurrency(version.total)}</span>
      </div>

      {/* Actions gated by role (cosmetic — RLS is the real gate). Each action
          stages a ConfirmDialog at the page level; none mutates on a single
          click (owner rule, B2-B5). */}
      {canWrite && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {version.status === 'Draft' && (
            <>
              <Button variant="success" size="sm" onClick={() => onActivate(version.id)}>
                Activate
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onDeleteDraft(version.id)}
                className="text-destructive hover:bg-destructive/10"
              >
                Delete draft
              </Button>
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
                Archive
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onClone(version.id)}
                className="text-primary hover:bg-primary/10"
              >
                Clone to revise
              </Button>
            </>
          )}
          {version.status === 'Archived' && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onClone(version.id)}
              className="text-primary hover:bg-primary/10"
            >
              Clone to revise
            </Button>
          )}
        </div>
      )}

      {/* Line-item editor for Draft; read-only view for others */}
      {version.status === 'Draft' && canWrite ? (
        <LineItemEditor
          lineItems={version.line_items}
          onCreateLineItem={(item) => onCreateLineItem(version.id, item)}
          onDeleteLineItem={onDeleteLineItem}
        />
      ) : (
        version.line_items.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <TH>Category</TH>
                  <TH>Description</TH>
                  <TH align="right">Budgeted</TH>
                  <TH align="right">Actual</TH>
                </tr>
              </thead>
              <tbody>
                {version.line_items.map((li) => (
                  <tr key={li.id} className="border-b border-border/70 last:border-b-0">
                    <td className="px-3 py-2">{li.category}</td>
                    <td className="px-3 py-2 text-muted-foreground">{li.description ?? '—'}</td>
                    <td className="px-3 py-2 text-right font-medium tabular">
                      {formatCurrency(Number(li.budgeted_amount))}
                    </td>
                    <td className="px-3 py-2 text-right tabular text-muted-foreground">
                      {formatCurrency(Number(li.actual_amount))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <TableFoot className="mt-0 rounded-b-lg">
              <span className="text-muted-foreground">Total</span>
              <span className="ml-auto font-bold">{formatCurrency(version.total)}</span>
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
  const { effectiveRole } = useEffectiveRole();
  const canWrite = effectiveRole != null && (WRITE_ROLES as string[]).includes(effectiveRole);
  const { toast } = useToast();

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
        title="Couldn't load budget"
        sub="Something went wrong fetching the budget data."
        onRetry={() => {
          budgetQuery.refetch();
          versionsQuery.refetch();
        }}
      />
    );
  }

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
          toast('Budget version created', c.name, 'success');
          break;
        case 'activate':
          await mutations.activate.mutateAsync(c.id);
          setPendingConfirm(null);
          toast('Version activated', c.label, 'success');
          break;
        case 'clone':
          await mutations.cloneVersion.mutateAsync(c.id);
          setPendingConfirm(null);
          toast('Version cloned', `New draft from ${c.label}`, 'success');
          break;
        case 'archive':
          await mutations.archive.mutateAsync(c.id);
          setPendingConfirm(null);
          toast('Version archived', c.label, 'success');
          break;
        case 'deleteDraft':
          await mutations.deleteDraft.mutateAsync(c.id);
          setPendingConfirm(null);
          toast('Draft deleted', c.label, 'success');
          break;
        case 'deleteLineItem':
          await mutations.deleteLineItem.mutateAsync(c.id);
          setPendingConfirm(null);
          toast('Line item deleted', undefined, 'success');
          break;
      }
    } catch (err) {
      setPendingConfirm(null);
      toast('Action failed', err instanceof Error ? err.message : undefined, 'warning');
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
    create: { tone: 'default', title: 'Create budget version?', confirmLabel: 'Create version' },
    activate: { tone: 'default', title: 'Make this the active budget?', confirmLabel: 'Activate version' },
    clone: { tone: 'default', title: 'Clone to a new draft?', confirmLabel: 'Clone version' },
    archive: { tone: 'destructive', title: 'Archive this version?', confirmLabel: 'Archive version' },
    deleteDraft: { tone: 'destructive', title: 'Delete this draft?', confirmLabel: 'Delete draft' },
    deleteLineItem: { tone: 'destructive', title: 'Delete this line item?', confirmLabel: 'Delete' },
  };

  const confirmDescriptions: Record<PendingBudgetConfirm['kind'], (c: PendingBudgetConfirm) => string> = {
    create: (c) => `This creates a new Draft budget version named "${c.kind === 'create' ? c.name : ''}".`,
    activate: (c) =>
      `This makes ${'label' in c ? c.label : 'this version'} the live active budget and supersedes the current active version.`,
    clone: (c) => `This copies ${'label' in c ? c.label : 'this version'} into a new editable Draft.`,
    archive: (c) =>
      `This removes ${'label' in c ? c.label : 'this version'} as the active budget. You can clone it later to revise.`,
    deleteDraft: (c) =>
      `This permanently deletes the draft ${'label' in c ? c.label : ''}. This cannot be undone.`,
    deleteLineItem: () => 'This permanently removes the line item from the draft. This cannot be undone.',
  };

  const budgetConfirm = pendingConfirm && (
    <ConfirmDialog
      open
      tone={confirmCopy[pendingConfirm.kind].tone}
      title={confirmCopy[pendingConfirm.kind].title}
      description={confirmDescriptions[pendingConfirm.kind](pendingConfirm)}
      confirmLabel={confirmCopy[pendingConfirm.kind].confirmLabel}
      loading={confirmInFlight}
      onCancel={() => setPendingConfirm(null)}
      onConfirm={() => void commitBudgetConfirm()}
    />
  );

  const head = (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-[20px] font-bold tracking-[-0.01em]">Project Budget</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Active budget:{' '}
          <span data-testid="derived-budget" className="font-semibold tabular text-foreground">
            {formatCurrency(derivedTotal)}
          </span>
        </p>
      </div>
      {canWrite && (
        <Button variant="primary" onClick={() => setShowNewVersionForm(true)}>
          + New version
        </Button>
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
            title="No budget versions yet"
            sub="Create a Draft version to start planning the project budget."
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
          Version
        </label>
        {/* A2/A3: native select — keyboard nav, focus ring, type-ahead all free */}
        <select
          id="budget-version-select"
          aria-label="Version"
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
          <StatusPill variant={VERSION_PILL[selected.status]}>{selected.status}</StatusPill>
        )}
        {/* A6: tabular total in selector bar so it's visible without scrolling */}
        {selected && (
          <span className="ml-auto text-[13px] font-semibold tabular">
            {formatCurrency(selected.total)}
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
}> = ({ onSubmit, onCancel, value, onChange }) => (
  <Toolbar standalone className="items-center">
    <input
      type="text"
      placeholder="Version name (e.g. Budget v1)"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 flex-1 rounded-md border border-input bg-background px-2.5 text-[13.5px] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      autoFocus
    />
    <Button variant="primary" onClick={() => value.trim() && onSubmit(value.trim())} disabled={!value.trim()}>
      Create
    </Button>
    <Button variant="outline" onClick={onCancel}>
      Cancel
    </Button>
  </Toolbar>
);

export default ProjectBudget;
