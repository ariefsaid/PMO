import React, { useState } from 'react';
import { useProjectBudget, useBudgetVersions, useBudgetMutations } from '@/src/hooks/useBudget';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { formatCurrency } from '@/src/lib/format';
import { Button, StatusPill, ListState, Toolbar, TableFoot, type StatusVariant } from '@/src/components/ui';
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
  onDeleteLineItem: (id: string) => Promise<unknown>;
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
  onActivate: (id: string) => Promise<unknown>;
  onArchive: (id: string) => Promise<unknown>;
  onClone: (id: string) => Promise<unknown>;
  onDeleteDraft: (id: string) => Promise<unknown>;
  onCreateLineItem: (versionId: string, item: NewLineItem) => Promise<unknown>;
  onDeleteLineItem: (id: string) => Promise<unknown>;
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
  const [confirmArchive, setConfirmArchive] = useState(false);

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

      {/* Actions gated by role (cosmetic — RLS is the real gate) */}
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
              {!confirmArchive ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmArchive(true)}
                  className="text-warning-foreground hover:bg-warning/18"
                >
                  Archive
                </Button>
              ) : (
                <div className="flex items-center gap-2 text-[12px]">
                  <span className="font-medium text-warning-foreground">
                    Warning: archiving removes the active budget. Confirm?
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      await onArchive(version.id);
                      setConfirmArchive(false);
                    }}
                    className="bg-warning/18 text-warning-foreground"
                  >
                    Yes, archive
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmArchive(false)}>
                    Cancel
                  </Button>
                </div>
              )}
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

const ProjectBudget: React.FC<ProjectBudgetProps> = ({ projectId }) => {
  const { effectiveRole } = useEffectiveRole();
  const canWrite = effectiveRole != null && (WRITE_ROLES as string[]).includes(effectiveRole);

  const budgetQuery = useProjectBudget(projectId);
  const versionsQuery = useBudgetVersions(projectId);
  const mutations = useBudgetMutations(projectId);

  const [newVersionName, setNewVersionName] = useState('');
  const [showNewVersionForm, setShowNewVersionForm] = useState(false);

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

  const versions = versionsQuery.data ?? [];
  const derivedTotal = budgetQuery.data ?? 0;

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
            onSubmit={async (name) => {
              await mutations.createVersion.mutateAsync({ projectId, name });
              setShowNewVersionForm(false);
              setNewVersionName('');
            }}
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
      </div>
    );
  }

  // Normal state: versions list
  return (
    <div className="flex flex-col gap-4">
      {head}

      {showNewVersionForm && canWrite && (
        <NewVersionForm
          onSubmit={async (name) => {
            await mutations.createVersion.mutateAsync({ projectId, name });
            setShowNewVersionForm(false);
            setNewVersionName('');
          }}
          onCancel={() => setShowNewVersionForm(false)}
          value={newVersionName}
          onChange={setNewVersionName}
        />
      )}

      <div className="flex flex-col gap-4">
        {versions.map((version) => (
          <VersionCard
            key={version.id}
            version={version}
            canWrite={canWrite}
            onActivate={(id) => mutations.activate.mutateAsync(id)}
            onArchive={(id) => mutations.archive.mutateAsync(id)}
            onClone={(id) => mutations.cloneVersion.mutateAsync(id)}
            onDeleteDraft={(id) => mutations.deleteDraft.mutateAsync(id)}
            onCreateLineItem={(versionId, item) =>
              mutations.createLineItem.mutateAsync({ versionId, item })
            }
            onDeleteLineItem={(id) => mutations.deleteLineItem.mutateAsync(id)}
          />
        ))}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// New version form
// ---------------------------------------------------------------------------
const NewVersionForm: React.FC<{
  onSubmit: (name: string) => Promise<void>;
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
