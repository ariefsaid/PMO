import React, { useState } from 'react';
import { useProjectBudget, useBudgetVersions, useBudgetMutations } from '@/src/hooks/useBudget';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { formatCurrency } from '@/src/lib/format';
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

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const StatusBadge: React.FC<{ status: Enums<'budget_status'> }> = ({ status }) => {
  const classes: Record<Enums<'budget_status'>, string> = {
    Draft: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
    Active: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
    Archived: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  };
  return (
    <span
      data-testid={`version-status-${status.toLowerCase()}`}
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${classes[status]}`}
    >
      {status}
    </span>
  );
};

// ---------------------------------------------------------------------------
// Line-item editor (for Draft versions)
// ---------------------------------------------------------------------------
interface LineItemEditorProps {
  versionId: string;
  lineItems: BudgetLineItemRow[];
  onCreateLineItem: (item: NewLineItem) => Promise<unknown>;
  onUpdateLineItem: (id: string, patch: Partial<Pick<BudgetLineItemRow, 'category' | 'description' | 'budgeted_amount' | 'actual_amount'>>) => Promise<unknown>;
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

  return (
    <div className="mt-4">
      <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
        <thead className="bg-gray-50 dark:bg-gray-700/50">
          <tr>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Category</th>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
            <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Budgeted</th>
            <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Actual</th>
            <th className="px-4 py-2" />
          </tr>
        </thead>
        <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-100 dark:divide-gray-700">
          {lineItems.map((li) => (
            <tr key={li.id}>
              <td className="px-4 py-2 text-gray-700 dark:text-gray-300">{li.category}</td>
              <td className="px-4 py-2 text-gray-500 dark:text-gray-400">{li.description ?? '—'}</td>
              <td className="px-4 py-2 text-right text-gray-900 dark:text-white font-medium">
                {formatCurrency(Number(li.budgeted_amount))}
              </td>
              <td className="px-4 py-2 text-right text-gray-500 dark:text-gray-400">
                {formatCurrency(Number(li.actual_amount))}
              </td>
              <td className="px-4 py-2 text-right">
                <button
                  onClick={() => onDeleteLineItem(li.id)}
                  className="text-red-500 hover:text-red-700 text-xs"
                  aria-label={`Delete line item ${li.category}`}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {adding && (
            <tr>
              <td className="px-4 py-2">
                <select
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value as Enums<'budget_category'>)}
                  className="text-sm border border-gray-300 rounded px-2 py-1 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                >
                  {BUDGET_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </td>
              <td className="px-4 py-2">
                <input
                  type="text"
                  placeholder="Description"
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  className="text-sm border border-gray-300 rounded px-2 py-1 w-full dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                />
              </td>
              <td className="px-4 py-2">
                <input
                  type="number"
                  placeholder="Amount"
                  value={newAmount}
                  onChange={(e) => setNewAmount(e.target.value)}
                  className="text-sm border border-gray-300 rounded px-2 py-1 w-24 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                />
              </td>
              <td />
              <td className="px-4 py-2 text-right space-x-2">
                <button onClick={handleAdd} className="text-primary-600 hover:text-primary-700 text-xs font-medium">Save</button>
                <button onClick={() => setAdding(false)} className="text-gray-500 hover:text-gray-700 text-xs">Cancel</button>
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {!adding && (
        <button
          onClick={() => setAdding(true)}
          className="mt-2 text-sm text-primary-600 hover:text-primary-700 font-medium"
        >
          + Add line item
        </button>
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
  onUpdateLineItem: (id: string, patch: Partial<Pick<BudgetLineItemRow, 'category' | 'description' | 'budgeted_amount' | 'actual_amount'>>) => Promise<unknown>;
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
  onUpdateLineItem,
  onDeleteLineItem,
}) => {
  const [confirmArchive, setConfirmArchive] = useState(false);

  return (
    <div data-testid="version-card" className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <span className="text-sm font-mono text-gray-400">v{version.version}</span>
          <span className="font-semibold text-gray-900 dark:text-white">{version.name}</span>
          <StatusBadge status={version.status} />
        </div>
        <span className="text-sm font-bold text-gray-900 dark:text-white">
          {formatCurrency(version.total)}
        </span>
      </div>

      {/* Actions gated by role (cosmetic — RLS is the real gate) */}
      {canWrite && (
        <div className="flex flex-wrap gap-2 mt-3">
          {version.status === 'Draft' && (
            <>
              <button
                onClick={() => onActivate(version.id)}
                className="px-3 py-1.5 text-xs font-medium bg-green-600 text-white rounded-md hover:bg-green-700"
              >
                Activate
              </button>
              <button
                onClick={() => onDeleteDraft(version.id)}
                className="px-3 py-1.5 text-xs font-medium bg-red-100 text-red-700 rounded-md hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400"
              >
                Delete draft
              </button>
            </>
          )}
          {version.status === 'Active' && (
            <>
              {!confirmArchive ? (
                <button
                  onClick={() => setConfirmArchive(true)}
                  className="px-3 py-1.5 text-xs font-medium bg-orange-100 text-orange-700 rounded-md hover:bg-orange-200 dark:bg-orange-900/30 dark:text-orange-400"
                >
                  Archive
                </button>
              ) : (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-orange-600 dark:text-orange-400 font-medium">
                    Warning: archiving removes the active budget. Confirm?
                  </span>
                  <button
                    onClick={async () => { await onArchive(version.id); setConfirmArchive(false); }}
                    className="px-2 py-1 bg-orange-600 text-white rounded hover:bg-orange-700"
                  >
                    Yes, archive
                  </button>
                  <button
                    onClick={() => setConfirmArchive(false)}
                    className="px-2 py-1 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 dark:bg-gray-600 dark:text-gray-200"
                  >
                    Cancel
                  </button>
                </div>
              )}
              <button
                onClick={() => onClone(version.id)}
                className="px-3 py-1.5 text-xs font-medium bg-primary-100 text-primary-700 rounded-md hover:bg-primary-200 dark:bg-primary-900/30 dark:text-primary-400"
              >
                Clone to revise
              </button>
            </>
          )}
          {version.status === 'Archived' && (
            <button
              onClick={() => onClone(version.id)}
              className="px-3 py-1.5 text-xs font-medium bg-primary-100 text-primary-700 rounded-md hover:bg-primary-200 dark:bg-primary-900/30 dark:text-primary-400"
            >
              Clone to revise
            </button>
          )}
        </div>
      )}

      {/* Line-item editor for Draft; read-only view for others */}
      {version.status === 'Draft' && canWrite ? (
        <LineItemEditor
          versionId={version.id}
          lineItems={version.line_items}
          onCreateLineItem={(item) => onCreateLineItem(version.id, item)}
          onUpdateLineItem={onUpdateLineItem}
          onDeleteLineItem={onDeleteLineItem}
        />
      ) : (
        version.line_items.length > 0 && (
          <table className="mt-4 min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700/50">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Category</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Budgeted</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Actual</th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-100 dark:divide-gray-700">
              {version.line_items.map((li) => (
                <tr key={li.id}>
                  <td className="px-4 py-2 text-gray-700 dark:text-gray-300">{li.category}</td>
                  <td className="px-4 py-2 text-gray-500 dark:text-gray-400">{li.description ?? '—'}</td>
                  <td className="px-4 py-2 text-right font-medium text-gray-900 dark:text-white">
                    {formatCurrency(Number(li.budgeted_amount))}
                  </td>
                  <td className="px-4 py-2 text-right text-gray-500 dark:text-gray-400">
                    {formatCurrency(Number(li.actual_amount))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
      <div data-testid="budget-loading" className="animate-pulse space-y-4">
        <div className="h-10 w-64 bg-gray-200 dark:bg-gray-700 rounded" />
        <div className="h-32 bg-gray-200 dark:bg-gray-700 rounded-xl" />
        <div className="h-32 bg-gray-200 dark:bg-gray-700 rounded-xl" />
      </div>
    );
  }

  // Error state
  if (budgetQuery.isError || versionsQuery.isError) {
    return (
      <div className="text-center py-16 border-2 border-dashed border-red-200 dark:border-red-800 rounded-xl">
        <h3 className="text-lg font-medium text-gray-900 dark:text-white">Couldn't load budget</h3>
        <p className="mt-1 text-gray-500 dark:text-gray-400">Something went wrong fetching the budget data.</p>
        <button
          onClick={() => { budgetQuery.refetch(); versionsQuery.refetch(); }}
          className="mt-4 text-primary-600 hover:text-primary-500 font-medium text-sm"
        >
          Retry
        </button>
      </div>
    );
  }

  const versions = versionsQuery.data ?? [];
  const derivedTotal = budgetQuery.data ?? 0;

  // Empty state
  if (versions.length === 0) {
    return (
      <div data-testid="budget-empty" className="space-y-4">
        {/* Header still shows 0 budget */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Project Budget</h2>
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
              Active budget: <span data-testid="derived-budget" className="font-semibold text-gray-900 dark:text-white">{formatCurrency(derivedTotal)}</span>
            </p>
          </div>
          {canWrite && (
            <button
              onClick={() => setShowNewVersionForm(true)}
              className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700"
            >
              + New version
            </button>
          )}
        </div>

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

        <div className="text-center py-16 px-4 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl">
          <h3 className="text-lg font-medium text-gray-900 dark:text-white">No budget versions yet</h3>
          <p className="mt-1 text-gray-500 dark:text-gray-400 max-w-sm mx-auto">
            Create a Draft version to start planning the project budget.
          </p>
        </div>
      </div>
    );
  }

  // Normal state: versions list
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Project Budget</h2>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
            Active budget: <span data-testid="derived-budget" className="font-semibold text-gray-900 dark:text-white">{formatCurrency(derivedTotal)}</span>
          </p>
        </div>
        {canWrite && (
          <button
            onClick={() => setShowNewVersionForm(true)}
            className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700"
          >
            + New version
          </button>
        )}
      </div>

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

      {/* Versions */}
      <div className="space-y-4">
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
            onUpdateLineItem={(id, patch) =>
              mutations.updateLineItem.mutateAsync({ id, patch })
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
  <div className="flex items-center gap-3 p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg border border-gray-200 dark:border-gray-600">
    <input
      type="text"
      placeholder="Version name (e.g. Budget v1)"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="flex-1 text-sm border border-gray-300 rounded px-3 py-2 dark:bg-gray-800 dark:border-gray-600 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
      autoFocus
    />
    <button
      onClick={() => value.trim() && onSubmit(value.trim())}
      disabled={!value.trim()}
      className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 disabled:opacity-50"
    >
      Create
    </button>
    <button
      onClick={onCancel}
      className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-600"
    >
      Cancel
    </button>
  </div>
);

export default ProjectBudget;
