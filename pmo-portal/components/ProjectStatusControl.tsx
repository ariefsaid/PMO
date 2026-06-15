import React, { useState, useRef, useEffect } from 'react';
import { usePermission } from '@/src/auth/usePermission';
import { useProjectTransition } from '@/src/hooks/useProjectTransitions';
import { ConfirmDialog, useToast } from '@/src/components/ui';
import {
  LEGAL_PROJECT_TRANSITIONS,
  projectStatusGroup,
  type ProjectStatus,
} from '@/src/lib/db/projectTransitions';

interface ProjectStatusControlProps {
  project: {
    id: string;
    status: ProjectStatus;
    customer_contract_ref: string | null;
  };
}

/**
 * Per-project status-change control (AC-1004, FR-PR-005/011, NFR-PR-UI-001).
 * Cosmetically gated via can('transition','project') on the REAL JWT role (ADR-0016)
 * to the write roles (Admin/Executive/PM/Finance) — the RPC is the real authority.
 * Offers exactly the legal next statuses for the project's current status.
 * When the target is 'Won, Pending KoM', prompts for customer contract ref + date.
 * Surfaces RPC errors inline (not swallowed).
 */
const ProjectStatusControl: React.FC<ProjectStatusControlProps> = ({ project }) => {
  const can = usePermission();
  const mutation = useProjectTransition();
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const [pendingTarget, setPendingTarget] = useState<ProjectStatus | null>(null);
  const [contractRef, setContractRef] = useState('');
  const [contractDate, setContractDate] = useState('');
  // Confirm-before-write (owner rule, PR1-PR3): a chosen non-win target is
  // staged here and only commits when the ConfirmDialog's Confirm is pressed.
  const [confirmTarget, setConfirmTarget] = useState<ProjectStatus | null>(null);

  // Focus management (W2-6): capture trigger + restore on close; focus into popover on open.
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  // Whether focus should be restored to trigger on next render (after open→closed transition).
  const shouldRestoreFocusRef = useRef(false);

  // Move focus into the first menu item when popover opens.
  useEffect(() => {
    if (open && !pendingTarget) {
      const firstBtn = popoverRef.current?.querySelector<HTMLButtonElement>('button');
      firstBtn?.focus();
    }
  }, [open, pendingTarget]);

  // When open closes and shouldRestoreFocus is set, focus the trigger (now mounted).
  useEffect(() => {
    if (!open && shouldRestoreFocusRef.current) {
      shouldRestoreFocusRef.current = false;
      triggerRef.current?.focus();
    }
  }, [open]);

  // Esc closes + restores focus; outside-click closes.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        shouldRestoreFocusRef.current = true;
        setOpen(false);
      }
    };
    const onMouseDown = (e: MouseEvent) => {
      if (
        !popoverRef.current?.contains(e.target as Node) &&
        !triggerRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onMouseDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onMouseDown);
    };
  }, [open]);

  // Cosmetic gate on the REAL role (ADR-0016): hide for non-write roles. The RPC
  // is the real authority — gating on realRole keeps the affordance honest under
  // Admin impersonation (the banner explains the view-as state).
  if (!can('transition', 'project')) return null;

  const legalTargets = (LEGAL_PROJECT_TRANSITIONS[project.status as string] ?? []) as ProjectStatus[];

  // No transitions available (e.g. Internal Project terminal)
  if (legalTargets.length === 0) return null;

  const isDestructiveTarget = (target: ProjectStatus) =>
    projectStatusGroup(target as never) === 'lost';

  const handleTargetSelect = (target: ProjectStatus) => {
    if (target === 'Won, Pending KoM') {
      // PR2 (unchanged): the inline win form's Confirm IS the confirm step.
      setPendingTarget(target);
      setContractRef('');
      setContractDate('');
    } else {
      // PR1 forward / PR3 loss: stage the target; the ConfirmDialog commits it.
      // Nothing writes to the DB on this single click (owner rule).
      setOpen(false);
      setConfirmTarget(target);
    }
  };

  // Commit the staged target and toast on resolve (§6.7). mutateAsync surfaces
  // RPC errors verbatim (the inline alert + warning toast both keep the message).
  const commitConfirm = async () => {
    const target = confirmTarget;
    if (!target) return;
    try {
      await mutation.mutateAsync({ id: project.id, to: target, opts: undefined });
      setConfirmTarget(null);
      toast('Project updated', `Moved to ${target}`, 'success');
    } catch (err) {
      setConfirmTarget(null);
      toast('Status change failed', err instanceof Error ? err.message : undefined, 'warning');
    }
  };

  const handleWinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!contractRef.trim() || !contractDate) return;
    setOpen(false);
    setPendingTarget(null);
    mutation.mutate({
      id: project.id,
      to: 'Won, Pending KoM',
      opts: { customerContractRef: contractRef.trim(), contractDate },
    });
  };

  const handleCancel = () => {
    shouldRestoreFocusRef.current = true;
    setOpen(false);
    setPendingTarget(null);
    setContractRef('');
    setContractDate('');
  };

  return (
    <div data-testid="project-status-control" className="relative">
      {/* Inline error display — always visible when error exists (NFR-PR-UI-001) */}
      {mutation.isError && mutation.error && (
        <p className="mb-1 text-xs text-destructive" role="alert">
          {mutation.error.message}
        </p>
      )}

      {!open && !pendingTarget && (
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-md border border-input px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          disabled={mutation.isPending}
          aria-label="Change status"
          aria-haspopup="true"
          aria-expanded={false}
        >
          {mutation.isPending ? 'Saving…' : 'Change status'}
        </button>
      )}

      {/* Target selection dropdown */}
      {open && !pendingTarget && (
        <div ref={popoverRef} className="absolute right-0 z-20 mt-1 min-w-[180px] rounded-lg border border-border bg-popover p-[5px] shadow-[0_10px_30px_hsl(240_10%_8%/0.16)]">
          <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            Move to
          </p>
          {legalTargets.map(target => (
            <button
              key={target}
              type="button"
              onClick={() => handleTargetSelect(target)}
              className="block w-full rounded-md px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
            >
              {target}
            </button>
          ))}
          <button
            type="button"
            onClick={handleCancel}
            className="mt-[5px] block w-full rounded-md border-t border-border px-2.5 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Win form — requires customer contract ref + date */}
      {pendingTarget === 'Won, Pending KoM' && (
        <form
          onSubmit={handleWinSubmit}
          className="absolute right-0 z-20 mt-1 min-w-[240px] rounded-lg border border-border bg-popover p-3 shadow-[0_10px_30px_hsl(240_10%_8%/0.16)] space-y-2"
        >
          <p className="text-xs font-semibold">Win — enter contract details</p>
          <div>
            <label
              htmlFor={`contract-ref-${project.id}`}
              className="mb-0.5 block text-xs text-muted-foreground"
            >
              Customer contract ref
            </label>
            <input
              id={`contract-ref-${project.id}`}
              type="text"
              required
              value={contractRef}
              onChange={e => setContractRef(e.target.value)}
              placeholder="e.g. CPO-2026-001"
              className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            />
          </div>
          <div>
            <label
              htmlFor={`contract-date-${project.id}`}
              className="mb-0.5 block text-xs text-muted-foreground"
            >
              Contract date
            </label>
            <input
              id={`contract-date-${project.id}`}
              type="date"
              required
              value={contractDate}
              onChange={e => setContractDate(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            />
          </div>
          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              className="flex-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-[0_1px_2px_hsl(var(--primary)/0.25)] transition-colors hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Confirm
            </button>
            <button
              type="button"
              onClick={handleCancel}
              className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* PR1 (forward) / PR3 (loss) confirm-before-write. The win path (PR2)
          keeps its inline form above and never reaches here. */}
      {confirmTarget && (
        <ConfirmDialog
          open
          tone={isDestructiveTarget(confirmTarget) ? 'destructive' : 'default'}
          title={
            isDestructiveTarget(confirmTarget)
              ? 'Mark project as lost'
              : `Move project to ${confirmTarget}?`
          }
          description={
            isDestructiveTarget(confirmTarget)
              ? 'This moves the project to a terminal lost stage. You can still review it, but it leaves the active pipeline.'
              : `This moves the project forward to the ${confirmTarget} stage.`
          }
          confirmLabel={isDestructiveTarget(confirmTarget) ? 'Mark lost' : `Move to ${confirmTarget}`}
          loading={mutation.isPending}
          onCancel={() => setConfirmTarget(null)}
          onConfirm={() => void commitConfirm()}
        />
      )}
    </div>
  );
};

export default ProjectStatusControl;
