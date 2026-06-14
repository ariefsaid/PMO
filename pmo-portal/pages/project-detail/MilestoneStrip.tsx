import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ListState,
  Button,
  ConfirmDialog,
  useToast,
} from '@/src/components/ui';
import { useIsDesktop } from '@/src/components/ui/useIsDesktop';
import { usePermission } from '@/src/auth/usePermission';
import { useMilestones, useMilestoneMutations } from '@/src/hooks/useMilestones';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { pct } from '@/src/lib/format';
import type { MilestoneWithProgress, MilestoneInput, MilestonePatch } from '@/src/lib/db/milestones';
import { MilestonePhaseHeader } from '@/src/components/milestones/MilestonePhaseHeader';
import MilestoneFormModal from './MilestoneFormModal';

export interface MilestoneStripProps {
  projectId: string;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

/** I1/I4: A phase is 'overdue' only if it has STARTED (effective>0 or has tasks) AND past its target AND <100%. */
const hasStarted = (milestone: MilestoneWithProgress) =>
  milestone.effective_pct > 0 || milestone.task_count > 0;

const isOverdueMilestone = (milestone: MilestoneWithProgress) =>
  Boolean(
    milestone.target_date &&
    milestone.target_date < todayIso() &&
    milestone.effective_pct < 100 &&
    hasStarted(milestone),
  );

/** I1: priority: done(100%)→success, current→primary, overdue(started+past+<100%)→warning, else→primary (future/not-started). */
const fillClass = (milestone: MilestoneWithProgress, isCurrent: boolean) => {
  if (milestone.effective_pct >= 100) return 'bg-success';
  if (isCurrent) return 'bg-primary';
  if (isOverdueMilestone(milestone)) return 'bg-warning';
  return 'bg-primary';
};

const clampPct = (value: number) => Math.max(0, Math.min(100, value));

const percentStyle = (value: number) => `${Number(value.toFixed(2))}%`;

const MilestoneStrip: React.FC<MilestoneStripProps> = ({ projectId }) => {
  const may = usePermission();
  const { toast } = useToast();
  const isDesktop = useIsDesktop();
  const { data, isPending, isError, refetch } = useMilestones(projectId);
  const { create, update, remove } = useMilestoneMutations(projectId);

  const canCreate = may('create', 'milestone');
  const canEdit = may('edit', 'milestone');
  const canDelete = may('delete', 'milestone');

  const [formTarget, setFormTarget] = useState<{ milestone: MilestoneWithProgress | null } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MilestoneWithProgress | null>(null);

  const all = data ?? [];
  const currentMilestoneId = all.find((milestone) => milestone.effective_pct < 100)?.id ?? null;

  // I2: weight-weighted rollup of effective_pct across all milestones.
  const totalWeight = all.reduce((sum, m) => sum + m.weight, 0);
  const deliveryRollup = totalWeight > 0
    ? Math.round(all.reduce((sum, m) => sum + m.weight * m.effective_pct, 0) / totalWeight)
    : 0;
  const deliverySegments = totalWeight > 0
    ? all.map((milestone) => ({
        milestone,
        width: (milestone.weight / totalWeight) * clampPct(milestone.effective_pct),
      }))
    : all.map((milestone) => ({ milestone, width: 0 }));

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

  return (
    <>
      {all.length === 0 ? (
        <div data-testid="milestone-strip-empty" className="rounded-lg border border-border bg-card p-4">
          {canCreate ? (
            <EmptyPlanningPrompt onCreate={() => setFormTarget({ milestone: null })} />
          ) : (
            <p className="text-[13px] text-muted-foreground">No delivery phases yet</p>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-[14px] font-bold tracking-[-0.01em]">Delivery phases</h2>
            <div className="flex items-center gap-3" aria-label={`Project delivery ${deliveryRollup}%`}>
              <span className="text-[12px] text-muted-foreground">Project delivery</span>
              <span className="text-[23px] font-bold leading-none tabular text-foreground">{pct(deliveryRollup)}</span>
            </div>
            {canCreate && (
              <Button variant="ghost" size="sm" onClick={() => setFormTarget({ milestone: null })}>
                Add milestone
              </Button>
            )}
          </div>

          <ol aria-label="Delivery phases" className="space-y-4">
            <li>
              {isDesktop ? (
                <div className="delivery-track flex h-3 overflow-hidden rounded-full bg-secondary">
                  {deliverySegments.map(({ milestone, width }) => (
                      <span
                        className={`delivery-fill block h-full ${fillClass(milestone, currentMilestoneId === milestone.id)}`}
                        style={{ width: percentStyle(width) }}
                        key={milestone.id}
                      />
                  ))}
                </div>
              ) : (
                <div className="flex flex-col divide-y divide-border/70 rounded-md border border-border">
                  {all.map((milestone) => (
                    <MilestoneMobileRow
                      key={milestone.id}
                      milestone={milestone}
                      isCurrent={currentMilestoneId === milestone.id}
                      totalWeight={totalWeight}
                      canEdit={canEdit}
                      onEdit={() => setFormTarget({ milestone })}
                    />
                  ))}
                </div>
              )}
            </li>
            {isDesktop && (
              <li>
                <div data-testid="milestone-card-grid" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {all.map((milestone) => (
                    <MilestonePhaseCard
                      key={milestone.id}
                      milestone={milestone}
                      isCurrent={currentMilestoneId === milestone.id}
                      totalWeight={totalWeight}
                      canEdit={canEdit}
                      canDelete={canDelete}
                      projectId={projectId}
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
            )}
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

interface MilestoneMobileRowProps {
  milestone: MilestoneWithProgress;
  isCurrent: boolean;
  totalWeight: number;
  canEdit: boolean;
  onEdit: () => void;
}

const MilestoneMobileRow: React.FC<MilestoneMobileRowProps> = ({
  milestone,
  isCurrent,
  totalWeight,
  canEdit,
  onEdit,
}) => {
  const weightShare = totalWeight > 0 ? Math.round((milestone.weight / totalWeight) * 100) : null;
  const targetLabel = milestone.target_date
    ? `Target ${new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short' }).format(new Date(`${milestone.target_date}T00:00:00`))}`
    : null;
  const overdue = isOverdueMilestone(milestone);

  return (
    <div className="grid grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-3 px-3 py-3">
      <div className="h-2 overflow-hidden rounded-full bg-secondary" aria-hidden="true">
        <span
          data-testid="milestone-mobile-fill"
          className={`block h-full ${fillClass(milestone, isCurrent)}`}
          style={{ width: percentStyle(clampPct(milestone.effective_pct)) }}
        />
      </div>

      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className={`text-[13px] font-semibold ${overdue ? 'text-warning-foreground' : 'text-foreground'}`}>
            {milestone.name}
          </span>
          {isCurrent && <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-primary">Current</span>}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
          <span>{pct(milestone.effective_pct)}</span>
          {weightShare != null && <span>{weightShare}% of project</span>}
          {targetLabel && (
            <span className={overdue ? 'font-semibold text-warning-foreground' : undefined}>
              {targetLabel}
            </span>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <span className="text-[14px] font-bold tabular text-foreground">{pct(milestone.effective_pct)}</span>
        {canEdit && (
          <button
            type="button"
            aria-label={`Edit progress for ${milestone.name}`}
            className="text-[11px] font-semibold text-primary hover:underline"
            onClick={onEdit}
          >
            Edit
          </button>
        )}
      </div>
    </div>
  );
};

const EmptyPlanningPrompt: React.FC<{ onCreate: () => void }> = ({ onCreate }) => (
  <div className="flex flex-col gap-4">
    <div className="flex items-end gap-1.5" aria-hidden="true">
      {[100, 72, 36, 0].map((width, index) => (
        <span key={index} className="flex-1 rounded-full bg-secondary">
          <span className="block h-3 rounded-full bg-primary/20" style={{ width: `${width}%` }} />
        </span>
      ))}
    </div>
    <div className="space-y-1">
      <h3 className="text-[15px] font-semibold">Plan this project&apos;s delivery phases</h3>
      <p className="max-w-[52ch] text-[13px] text-muted-foreground">
        Add the key phases for this project so delivery progress can roll up from weighted milestones.
      </p>
    </div>
    <div>
      <Button variant="primary" size="sm" onClick={onCreate}>
        Add the first phase
      </Button>
    </div>
  </div>
);

interface MilestonePhaseCardProps {
  milestone: MilestoneWithProgress;
  isCurrent: boolean;
  totalWeight: number;
  canEdit: boolean;
  canDelete: boolean;
  /** AC-IFW-RECORD-03: thread the project id so overdue cards can link to the Tasks tab. */
  projectId: string;
  onEditDetails: () => void;
  onDelete: () => void;
  onUpdateInputPct: (id: string, input_pct: number | null) => Promise<void>;
}

const MilestonePhaseCard: React.FC<MilestonePhaseCardProps> = ({
  milestone,
  isCurrent,
  totalWeight,
  canEdit,
  canDelete,
  projectId,
  onEditDetails,
  onDelete,
  onUpdateInputPct,
}) => {
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [inputVal, setInputVal] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);
  // C1: guard refs to prevent double-save (blur+click) and to suppress blur-save on Cancel.
  const cancellingRef = React.useRef(false);
  const savedRef = React.useRef(false);

  const startEdit = () => {
    setMenuOpen(false);
    setInputVal(milestone.input_pct != null ? String(Math.round(milestone.input_pct)) : '');
    setInputError(null);
    cancellingRef.current = false;
    savedRef.current = false;
    setEditing(true);
  };
  const cancelEdit = () => {
    cancellingRef.current = false;
    setInputError(null);
    setEditing(false);
  };
  const saveEdit = async () => {
    // C1: if Cancel's mouseDown fired first, suppress save.
    if (cancellingRef.current) return;
    // C1: prevent double-fire from blur + Save click.
    if (savedRef.current) return;
    savedRef.current = true;
    const raw = inputVal.trim();
    const parsed = raw === '' ? null : Number(raw);
    if (parsed !== null && (isNaN(parsed) || parsed < 0 || parsed > 100)) {
      setInputError('Progress must be between 0 and 100');
      savedRef.current = false;
      return;
    }
    setInputError(null);
    await onUpdateInputPct(milestone.id, parsed);
    setEditing(false);
  };

  return (
    <section
      aria-current={isCurrent ? 'step' : undefined}
      className="relative min-w-0 rounded-md border border-border bg-background/60 p-3"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <MilestonePhaseHeader
            variant="stepper"
            name={milestone.name}
            targetDate={milestone.target_date}
            effectivePct={milestone.effective_pct}
            weight={milestone.weight}
            totalWeight={totalWeight}
            isCurrent={isCurrent}
            isOverdue={isOverdueMilestone(milestone)}
            canEditProgress={canEdit && !editing}
            onEditProgress={canEdit ? startEdit : undefined}
          />
          {/* AC-IFW-RECORD-03 (Lens-D): overdue-phase recovery lever — links to the project's
              Tasks tab so the PM can act on blocking work. One-Blue text link (not a solid button).
              Only shown for overdue phases (started + past target + <100%). */}
          {isOverdueMilestone(milestone) && (
            <Link
              to={`/projects/${projectId}/tasks`}
              className="mt-1 inline-block text-[12px] font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
            >
              View blocking tasks
            </Link>
          )}
        </div>

        {(canEdit || canDelete) && (
          <div className="relative shrink-0">
            <button
              type="button"
              aria-label={`More actions for ${milestone.name}`}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={() => setMenuOpen((open) => !open)}
            >
              <span aria-hidden="true" className="text-[18px] leading-none">⋯</span>
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-9 z-10 min-w-[176px] rounded-md border border-border bg-card p-1 shadow-sm">
                {canEdit && (
                  <button
                    type="button"
                    className="flex w-full rounded-sm px-2.5 py-1.5 text-left text-[13px] hover:bg-accent"
                    onClick={() => {
                      setMenuOpen(false);
                      onEditDetails();
                    }}
                  >
                    Edit milestone
                  </button>
                )}
                {canDelete && (
                  <button
                    type="button"
                    className="flex w-full rounded-sm px-2.5 py-1.5 text-left text-[13px] text-destructive hover:bg-accent"
                    aria-label={`Delete milestone ${milestone.name}`}
                    onClick={() => {
                      setMenuOpen(false);
                      onDelete();
                    }}
                  >
                    Delete milestone
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {editing && (
        <div className="mt-2 flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              type="number"
              min={0}
              max={100}
              aria-label="Edit PM input %"
              className="h-8 w-[72px] rounded-md border border-input bg-background px-2.5 text-[13px] tabular focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
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
                // C1: if Cancel was clicked, suppress blur-save.
                if (cancellingRef.current) return;
                void saveEdit();
              }}
              autoFocus
            />
            <Button variant="primary" size="sm" onClick={saveEdit}>
              Save
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onMouseDown={(e) => {
                // C1: preventDefault stops the input from losing focus,
                // so onBlur does NOT fire before the Cancel click.
                e.preventDefault();
                cancellingRef.current = true;
              }}
              onClick={cancelEdit}
            >
              Cancel
            </Button>
          </div>
          {inputError && <span className="text-[11.5px] text-destructive">{inputError}</span>}
        </div>
      )}
    </section>
  );
};

export default MilestoneStrip;
