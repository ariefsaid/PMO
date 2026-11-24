import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import type { BoardRow } from '@/src/lib/billingBoard';

/**
 * The billing board read (#2681; migration 1370): every open claim with its current step, as ONE security-invoker function so RLS
 * decides what the caller sees. The database bounds it at 501 rows; this seam hands back at most 500 and says whether it cut.
 */
export const BOARD_LIMIT = 500;

export interface BillingBoardResult {
  rows: BoardRow[];
  /** True when the database held more than the bound: the screen says so instead of implying a complete board. */
  truncated: boolean;
}

export async function getBillingBoard(projectId: string | null): Promise<BillingBoardResult> {
  const { data, error } = await supabase.rpc('billing_board', projectId ? { p_project: projectId } : {});
  if (error) throw new AppError(error.message, error.code);
  const all = data ?? [];
  return {
    truncated: all.length > BOARD_LIMIT,
    rows: all.slice(0, BOARD_LIMIT).map((r) => ({
      claimId: r.claim_id,
      projectId: r.project_id,
      projectName: r.project_name,
      workOrderId: r.work_order_id,
      woNumber: r.wo_number,
      claimCreatedAt: r.claim_created_at,
      claimValue: String(r.claim_value),
      currency: r.currency,
      stepCount: Number(r.step_count),
      stepsDone: Number(r.steps_done),
      currentPosition: r.current_position === null ? null : Number(r.current_position),
      currentName: r.current_name,
      ownerRole: r.owner_role,
      startedOn: r.started_on,
      lastCompletedOn: r.last_completed_on,
      dueOn: r.due_on,
      allDone: r.all_done,
      today: r.today,
    })),
  };
}
