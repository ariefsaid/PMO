/** Durable, operator-attributed cancellation intent for an archived v16 Budget. */
export interface BudgetArchiveCancelIntent {
  id: string;
  org_id: string;
  project_id: string;
  budget_version_id: string;
  source_mirror_id: string;
  actor_user_id: string;
  fiscal_year: string;
  erp_account: string;
  erp_budget_name: string;
  activated_at_witness: string;
  pushed_project_start_date: string | null;
  pushed_project_end_date: string | null;
}

export interface BudgetArchiveLifecycle {
  status: string;
  activatedAt: string | null;
  activeSuccessorUsesTarget: boolean;
}

export interface BudgetArchiveBackstopDeps {
  listPending(orgId: string, limit: number): Promise<BudgetArchiveCancelIntent[]>;
  readLifecycle(job: BudgetArchiveCancelIntent): Promise<BudgetArchiveLifecycle | null>;
  targetIsStillLiveAndOwned(job: BudgetArchiveCancelIntent): Promise<boolean>;
  /** true after the command is confirmed; false while the outbox's ordinary retry window is pending. */
  driveCancellation(job: BudgetArchiveCancelIntent): Promise<boolean>;
  markComplete(job: BudgetArchiveCancelIntent): Promise<void>;
  markSuperseded(job: BudgetArchiveCancelIntent): Promise<void>;
  markHeld(job: BudgetArchiveCancelIntent, reason: string): Promise<void>;
  noteRetry(job: BudgetArchiveCancelIntent, reason: string): Promise<void>;
}

export interface ReconcileBudgetArchiveCancellationsResult {
  driven: number;
  superseded: number;
  held: number;
  errors: Array<{ id: string; error: string }>;
}

export const BUDGET_ARCHIVE_BACKSTOP_LIMIT = 200;

/**
 * Re-check each durable archive decision against current PMO state before contacting ERPNext.
 * A newer active version that uses the same live ERP Budget supersedes an unissued cancellation;
 * stale witnesses are held for an operator. One failed row cannot starve the remaining bounded queue.
 */
export async function reconcileOrgBudgetArchiveCancellations(
  deps: BudgetArchiveBackstopDeps,
  orgId: string,
): Promise<ReconcileBudgetArchiveCancellationsResult> {
  const jobs = await deps.listPending(orgId, BUDGET_ARCHIVE_BACKSTOP_LIMIT);
  let driven = 0;
  let superseded = 0;
  let held = 0;
  const errors: Array<{ id: string; error: string }> = [];

  for (const job of jobs) {
    try {
      const lifecycle = await deps.readLifecycle(job);
      if (!lifecycle || lifecycle.status !== 'Archived' || lifecycle.activatedAt !== job.activated_at_witness) {
        const reason = !lifecycle || lifecycle.status !== 'Archived' ? 'version-not-archived' : 'activation-witness-changed';
        await deps.markHeld(job, reason);
        held += 1;
        continue;
      }
      if (lifecycle.activeSuccessorUsesTarget) {
        await deps.markSuperseded(job);
        superseded += 1;
        continue;
      }
      if (!(await deps.targetIsStillLiveAndOwned(job))) {
        await deps.markHeld(job, 'erp-target-witness-changed');
        held += 1;
        continue;
      }

      if (!(await deps.driveCancellation(job))) continue;
      await deps.markComplete(job);
      driven += 1;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      const code = (err as { code?: unknown } | null)?.code;
      if (code === 'commit-rejected' || code === 'command-held' || code === 'budget-sweep-gate-held') {
        try {
          await deps.markHeld(job, reason);
          held += 1;
        } catch (holdError) {
          errors.push({ id: job.id, error: `${reason}; hold could not be recorded: ${holdError instanceof Error ? holdError.message : String(holdError)}` });
        }
        continue;
      }
      try {
        await deps.noteRetry(job, reason);
      } catch (recordError) {
        const recordReason = recordError instanceof Error ? recordError.message : String(recordError);
        errors.push({ id: job.id, error: `${reason}; retry detail could not be recorded: ${recordReason}` });
        continue;
      }
      errors.push({ id: job.id, error: reason });
    }
  }

  return { driven, superseded, held, errors };
}
