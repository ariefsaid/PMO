import React, { useState } from 'react';
import {
  ListState,
  ProgressBar,
  Button,
  Icon,
  ConfirmDialog,
  useToast,
} from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useMilestones, useMilestoneMutations } from '@/src/hooks/useMilestones';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { pct } from '@/src/lib/format';
import type { MilestoneWithProgress, MilestoneInput, MilestonePatch } from '@/src/lib/db/milestones';
import MilestoneFormModal from './MilestoneFormModal';

export interface MilestoneStripProps {
  projectId: string;
}

/**
 * Milestone strip — renders in the project detail header area (FR-DEL-012, FR-DEL-013,
 * NFR-DEL-UI-001). Shows each milestone's name, target date, effective-% progress bar,
 * and the two-column % display (calculated "From tasks" + input "PM input").
 *
 * Loading/empty/error states per NFR-DEL-UI-001. Empty state shows "Add a milestone"
 * CTA for PM/Admin (FR-DEL-013); hidden to other roles.
 *
 * Inline PM-input edit (click-to-edit number field) for PM/Admin (FR-DEL-020, OQ3).
 * Delete affordance shows ConfirmDialog (OD-UX-1 destructive confirm).
 */
const MilestoneStrip: React.FC<MilestoneStripProps> = ({ projectId }) => {
  const may = usePermission();
  const { toast } = useToast();
  const { data, isPending, isError, refetch } = useMilestones(projectId);
  const { create, update, remove } = useMilestoneMutations(projectId);

  const canCreate = may('create', 'milestone');
  const canEdit = may('edit', 'milestone');
  const canDelete = may('delete', 'milestone');

  const [formTarget, setFormTarget] = useState<{ milestone: MilestoneWithProgress | null } | null>(
    null,
  );
  const [deleteTarget, setDeleteTarget] = useState<MilestoneWithProgress | null>(null);

  const all = data ?? [];

  // ── Shared modal handlers (single source — no copy-paste) ─────────────────
  const handleModalCreate = async (input: MilestoneInput) => {
    await create.mutateAsync({ input });
    toast('Milestone created', input.name, 'success');
    setFormTarget(null);
  };

  const handleModalUpdate = async (id: string, patch: MilestonePatch) => {
    await update.mutateAsync({ id, patch });
    toast('Milestone updated', patch.name ?? 'Milestone', 'success');
    setFormTarget(null);
  };

  const handleModalError = (err: unknown) => {
    const { headline, detail } = classifyMutationError(err);
    toast(headline, detail, 'warning');
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    try {
      await remove.mutateAsync(target.id);
      toast('Milestone deleted', target.name, 'success');
      setDeleteTarget(null);
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
      setDeleteTarget(null);
    }
  };

  if (isPending) {
    return (
      <div
        data-testid="milestone-strip-loading"
        className="rounded-lg border border-border bg-card"
      >
        <ListState variant="loading" rows={2} testId="milestone-strip-skeleton" />
      </div>
    );
  }

  if (isError) {
    return (
      <ListState
        variant="error"
        title="Couldn't load milestones"
        sub="The request failed. Check your connection and try again."
        onRetry={() => refetch()}
      />
    );
  }

  // Empty with no create permission: render nothing at all.
  if (all.length === 0 && !canCreate) return null;

  return (
    <>
      {all.length === 0 ? (
        <div data-testid="milestone-strip-empty">
          <ListState
            variant="empty"
            icon="inbox"
            title="No milestones yet"
            sub="Add a milestone to track delivery progress"
            action={{ label: 'Add a milestone', onClick: () => setFormTarget({ milestone: null }) }}
          />
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-[14px] font-bold tracking-[-0.01em]">Milestones</h3>
            {canCreate && (
              <Button variant="ghost" size="sm" onClick={() => setFormTarget({ milestone: null })}>
                <Icon name="plus" />
                Add milestone
              </Button>
            )}
          </div>

          <div className="flex flex-col gap-3">
            {all.map((m) => (
              <MilestoneRow
                key={m.id}
                milestone={m}
                canEdit={canEdit}
                canDelete={canDelete}
                onEdit={() => setFormTarget({ milestone: m })}
                onDelete={() => setDeleteTarget(m)}
                onUpdateInputPct={async (id, input_pct) => {
                  try {
                    await update.mutateAsync({ id, patch: { input_pct } });
                    toast('Progress updated', m.name, 'success');
                  } catch (err) {
                    const { headline, detail } = classifyMutationError(err);
                    toast(headline, detail, 'warning');
                  }
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Single MilestoneFormModal + ConfirmDialog — shared by both empty and populated branches */}
      {formTarget !== null && (
        <MilestoneFormModal
          milestone={formTarget.milestone}
          onClose={() => setFormTarget(null)}
          onCreate={handleModalCreate}
          onUpdate={handleModalUpdate}
          onError={handleModalError}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        tone="destructive"
        title={deleteTarget ? `Delete "${deleteTarget.name}"?` : 'Delete milestone?'}
        description="Tasks under this milestone become ungrouped; they are not deleted."
        confirmLabel="Delete milestone"
        loading={remove.isPending}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
};

// ── Individual milestone row ───────────────────────────────────────────────────

interface MilestoneRowProps {
  milestone: MilestoneWithProgress;
  canEdit: boolean;
  canDelete: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onUpdateInputPct: (id: string, input_pct: number | null) => Promise<void>;
}

const MilestoneRow: React.FC<MilestoneRowProps> = ({
  milestone: m,
  canEdit,
  canDelete,
  onEdit,
  onDelete,
  onUpdateInputPct,
}) => {
  const [editing, setEditing] = useState(false);
  const [inputVal, setInputVal] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);

  const startEdit = () => {
    setInputVal(m.input_pct != null ? String(Math.round(m.input_pct)) : '');
    setInputError(null);
    setEditing(true);
  };
  const cancelEdit = () => {
    setInputError(null);
    setEditing(false);
  };
  const saveEdit = async () => {
    const raw = inputVal.trim();
    const parsed = raw === '' ? null : Number(raw);
    if (parsed !== null && (isNaN(parsed) || parsed < 0 || parsed > 100)) {
      setInputError('Progress must be between 0 and 100');
      return;
    }
    setInputError(null);
    await onUpdateInputPct(m.id, parsed);
    setEditing(false);
  };

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-secondary/30 p-3">
      {/* Header row: name + date + affordances */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold" title={m.name}>
          {m.name}
        </span>
        {m.target_date && (
          <span className="text-[11.5px] text-muted-foreground tabular">{m.target_date}</span>
        )}
        {canEdit && (
          <Button variant="ghost" size="sm" iconOnly aria-label={`Edit ${m.name}`} onClick={onEdit}>
            <Icon name="pencil" />
          </Button>
        )}
        {canDelete && (
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            aria-label={`Delete ${m.name}`}
            onClick={onDelete}
          >
            <Icon name="x" />
          </Button>
        )}
      </div>

      {/* Progress bar */}
      <ProgressBar value={m.effective_pct} tone="primary" aria-label={`${m.name} delivery`} />

      {/* Two-column % display */}
      <div className="flex gap-4">
        {/* From tasks (calculated) */}
        <span
          aria-label="From tasks"
          className="flex flex-col gap-0.5"
        >
          <span className="text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">
            From tasks
          </span>
          <span className="text-[13px] font-bold tabular text-muted-foreground">
            {pct(m.calculated_pct)}
          </span>
        </span>

        {/* PM input (editable for PM/Admin) */}
        <span aria-label="PM input" className="flex flex-col gap-0.5">
          <span className="text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">
            PM input
          </span>
          {canEdit && editing ? (
            <span className="flex flex-col gap-0.5">
              <span className="flex items-center gap-1">
                <input
                  type="number"
                  min={0}
                  max={100}
                  aria-label="Edit PM input %"
                  className="w-16 rounded border border-border bg-background px-1.5 py-0.5 text-[13px] tabular focus:outline-none focus:ring-1 focus:ring-primary"
                  value={inputVal}
                  onChange={(e) => { setInputVal(e.target.value); setInputError(null); }}
                  autoFocus
                />
                <Button variant="primary" size="sm" onClick={saveEdit}>
                  Save
                </Button>
                <Button variant="ghost" size="sm" onClick={cancelEdit}>
                  Cancel
                </Button>
              </span>
              {inputError && (
                <span className="text-[11.5px] text-destructive">{inputError}</span>
              )}
            </span>
          ) : (
            <span
              className={`text-[13px] font-bold tabular ${canEdit ? 'cursor-pointer hover:underline' : ''}`}
              onClick={canEdit ? startEdit : undefined}
              role={canEdit ? 'button' : undefined}
              tabIndex={canEdit ? 0 : undefined}
              onKeyDown={
                canEdit
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') startEdit();
                    }
                  : undefined
              }
              aria-label={canEdit ? `Edit PM input for ${m.name}` : undefined}
            >
              {pct(m.input_pct)}
            </span>
          )}
        </span>
      </div>
    </div>
  );
};

export default MilestoneStrip;
