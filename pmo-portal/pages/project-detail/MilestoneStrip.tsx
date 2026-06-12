import React, { useMemo, useState } from 'react';
import {
  ListState,
  Button,
  Icon,
  ConfirmDialog,
  useToast,
} from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useMilestones, useMilestoneMutations } from '@/src/hooks/useMilestones';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import type { MilestoneWithProgress, MilestoneInput, MilestonePatch } from '@/src/lib/db/milestones';
import { MilestonePhaseHeader } from '@/src/components/milestones/MilestonePhaseHeader';
import MilestoneFormModal from './MilestoneFormModal';

export interface MilestoneStripProps {
  projectId: string;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

const isOverdueMilestone = (milestone: MilestoneWithProgress) =>
  Boolean(milestone.target_date && milestone.target_date < todayIso() && milestone.effective_pct < 100);

const fillClass = (milestone: MilestoneWithProgress) => {
  if (isOverdueMilestone(milestone)) return 'bg-warning';
  if (milestone.effective_pct >= 100) return 'bg-success';
  return 'bg-primary';
};

const MilestoneStrip: React.FC<MilestoneStripProps> = ({ projectId }) => {
  const may = usePermission();
  const { toast } = useToast();
  const { data, isPending, isError, refetch } = useMilestones(projectId);
  const { create, update, remove } = useMilestoneMutations(projectId);

  const canCreate = may('create', 'milestone');
  const canEdit = may('edit', 'milestone');
  const canDelete = may('delete', 'milestone');

  const [formTarget, setFormTarget] = useState<{ milestone: MilestoneWithProgress | null } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MilestoneWithProgress | null>(null);

  const all = data ?? [];
  const currentMilestoneId = useMemo(
    () => all.find((milestone) => milestone.effective_pct < 100)?.id ?? null,
    [all],
  );

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
      <div data-testid="milestone-strip-loading" className="rounded-lg border border-border bg-card">
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
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-[14px] font-bold tracking-[-0.01em]">Milestones</h2>
            {canCreate && (
              <Button variant="ghost" size="sm" onClick={() => setFormTarget({ milestone: null })}>
                <Icon name="plus" />
                Add milestone
              </Button>
            )}
          </div>

          <ol aria-label="Delivery phases" className="space-y-4">
            <li>
              <div className="flex h-3 overflow-hidden rounded-full bg-border">
                {all.map((milestone) => (
                  <span key={milestone.id} className="flex-1 bg-secondary">
                    <span
                      className={`block h-full rounded-full ${fillClass(milestone)}`}
                      style={{ width: `${Math.max(0, Math.min(100, milestone.effective_pct))}%` }}
                    />
                  </span>
                ))}
              </div>
            </li>
            <li>
              <div
                className="grid gap-3"
                style={{ gridTemplateColumns: `repeat(${Math.max(all.length, 1)}, minmax(0, 1fr))` }}
              >
                {all.map((milestone) => (
                  <MilestonePhaseCard
                    key={milestone.id}
                    milestone={milestone}
                    isCurrent={currentMilestoneId === milestone.id}
                    canEdit={canEdit}
                    canDelete={canDelete}
                    onEditDetails={() => setFormTarget({ milestone })}
                    onDelete={() => setDeleteTarget(milestone)}
                    onUpdateInputPct={async (id, input_pct) => {
                      try {
                        await update.mutateAsync({ id, patch: { input_pct } });
                        toast('Progress updated', milestone.name, 'success');
                      } catch (err) {
                        const { headline, detail } = classifyMutationError(err);
                        toast(headline, detail, 'warning');
                      }
                    }}
                  />
                ))}
              </div>
            </li>
          </ol>
        </div>
      )}

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

interface MilestonePhaseCardProps {
  milestone: MilestoneWithProgress;
  isCurrent: boolean;
  canEdit: boolean;
  canDelete: boolean;
  onEditDetails: () => void;
  onDelete: () => void;
  onUpdateInputPct: (id: string, input_pct: number | null) => Promise<void>;
}

const MilestonePhaseCard: React.FC<MilestonePhaseCardProps> = ({
  milestone,
  isCurrent,
  canEdit,
  canDelete,
  onEditDetails,
  onDelete,
  onUpdateInputPct,
}) => {
  const [editing, setEditing] = useState(false);
  const [inputVal, setInputVal] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);

  const startEdit = () => {
    setInputVal(milestone.input_pct != null ? String(Math.round(milestone.input_pct)) : '');
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
    await onUpdateInputPct(milestone.id, parsed);
    setEditing(false);
  };

  return (
    <section
      aria-current={isCurrent ? 'step' : undefined}
      className="min-w-0 rounded-md border border-border bg-background/60 p-3"
    >
      <MilestonePhaseHeader
        variant="stepper"
        name={milestone.name}
        targetDate={milestone.target_date}
        effectivePct={milestone.effective_pct}
        calculatedPct={milestone.calculated_pct}
        isCurrent={isCurrent}
        isOverdue={isOverdueMilestone(milestone)}
        canEditProgress={canEdit && !editing}
        onEditProgress={canEdit ? startEdit : undefined}
      />

      {editing && (
        <div className="mt-2 flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              type="number"
              min={0}
              max={100}
              aria-label="Edit PM input %"
              className="w-16 rounded border border-border bg-background px-1.5 py-0.5 text-[13px] tabular focus:outline-none focus:ring-1 focus:ring-primary [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              value={inputVal}
              onChange={(e) => {
                setInputVal(e.target.value);
                setInputError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void saveEdit();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  cancelEdit();
                }
              }}
              onBlur={() => {
                void saveEdit();
              }}
              autoFocus
            />
            <Button variant="primary" size="sm" onClick={saveEdit}>
              Save
            </Button>
            <Button variant="ghost" size="sm" onClick={cancelEdit}>
              Cancel
            </Button>
          </div>
          {inputError && <span className="text-[11.5px] text-destructive">{inputError}</span>}
        </div>
      )}

      {(canEdit || canDelete) && (
        <div className="mt-3 flex items-center gap-1">
          {canEdit && (
            <Button variant="ghost" size="sm" onClick={onEditDetails} aria-label={`Edit ${milestone.name}`}>
              <Icon name="pencil" />
              Details
            </Button>
          )}
          {canDelete && (
            <Button variant="ghost" size="sm" onClick={onDelete} aria-label={`Delete ${milestone.name}`}>
              <Icon name="trash" />
              Delete
            </Button>
          )}
        </div>
      )}
    </section>
  );
};

export default MilestoneStrip;
