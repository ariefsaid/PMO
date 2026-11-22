import { stageAgeDays, stageOverdue } from '@/src/lib/billingStages';
import { roleHasCapability } from '@/src/auth/builtInRoles';
import { legacyMayRunBillingSteps } from '@/src/auth/billingStepRights';
import type { WaitingWorkOrderStep, WorkOrderStep } from '@/src/lib/db/workOrderBillingSteps';

/**
 * Pure derivations for a work order's billing step list (docs/specs/billing-steps.spec.md). Dates are ISO `YYYY-MM-DD` days on the
 * organisation's calendar; the caller passes today. Age and overdue reuse the claim steps' own pure rules unchanged (`billingStages.ts`),
 * so nothing about a claim step's due behaviour moves. The database decides who may act; `mayActOnStep` only decides which controls to show.
 */
export type WorkOrderStepStatus = 'done' | 'skipped' | 'current' | 'open';

export const stepStatus = (s: Pick<WorkOrderStep, 'doneOn' | 'skippedOn' | 'startedOn'>): WorkOrderStepStatus =>
  s.doneOn ? 'done' : s.skippedOn ? 'skipped' : s.startedOn ? 'current' : 'open';

/** The day a step is due: its start plus its target days; null with no target or before it starts. */
export function stepDueOn(s: Pick<WorkOrderStep, 'startedOn' | 'targetDays'>): string | null {
  if (!s.startedOn || s.targetDays == null) return null;
  const [y, m, d] = s.startedOn.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + s.targetDays)).toISOString().slice(0, 10);
}

export const stepAgeDays = (s: Pick<WorkOrderStep, 'startedOn' | 'doneOn'>, today: string): number | null =>
  stageAgeDays({ startedOn: s.startedOn, completedOn: s.doneOn }, today);

/** Days beyond target of a current step, or null. */
export function stepDaysOver(s: Pick<WorkOrderStep, 'startedOn' | 'doneOn' | 'skippedOn' | 'targetDays'>, today: string): number | null {
  const o = stageOverdue({ startedOn: s.startedOn, completedOn: s.doneOn, skippedOn: s.skippedOn, targetDays: s.targetDays }, today);
  return o ? o.age - o.target : null;
}

export interface StepActor {
  userId: string | null;
  builtInRoleKey: string | null;
  /** The real access level (never the view-as role). */
  role: string | null;
}

/**
 * Whether to show the action controls on a step: the named person, a holder of the step's owner role, a holder of "run billing steps",
 * or (no built-in role) one of today's claim-step writers. A UX affordance only: the database re-checks and refuses.
 */
export function mayActOnStep(actor: StepActor, step: Pick<WorkOrderStep, 'assigneeId' | 'ownerRoleKey'>): boolean {
  if (actor.userId && step.assigneeId === actor.userId) return true;
  if (actor.builtInRoleKey) {
    return step.ownerRoleKey === actor.builtInRoleKey || roleHasCapability(actor.builtInRoleKey, 'billing_steps_run');
  }
  return legacyMayRunBillingSteps(actor.role);
}

export interface WaitingWorkOrderStepsFact {
  count: number;
  overdue: number;
  href: string;
}

/** The needs-you pointer for the viewer's waiting work-order steps; null when none. */
export function summariseWaitingWorkOrderSteps(rows: ReadonlyArray<WaitingWorkOrderStep>, today: string): WaitingWorkOrderStepsFact | null {
  if (rows.length === 0) return null;
  const overdue = rows.filter((r) => stepDaysOver({ startedOn: r.startedOn, doneOn: null, skippedOn: null, targetDays: r.targetDays }, today) !== null).length;
  const one = new Set(rows.map((r) => r.workOrderId)).size === 1 ? rows[0].workOrderId : null;
  return { count: rows.length, overdue, href: one ? `/work-orders/${encodeURIComponent(one)}` : '/work-orders' };
}
