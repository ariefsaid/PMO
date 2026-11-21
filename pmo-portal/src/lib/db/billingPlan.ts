import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import { candidateKey, type PlanCandidate } from '@/src/lib/billingPlan';

/**
 * The monthly billing plan (#2682; migrations 1375, 1376). The candidates are ONE security-invoker read (accepted-not-yet-claimed work,
 * computed in the database from the same sources as the project Cascade); the settings are two small tables written only through
 * Admin/Finance definer functions. No pick is ever sent anywhere: nothing here writes a claim or an invoice.
 */
export const PLAN_LIMIT = 500;

export interface PlanCandidatesResult {
  rows: PlanCandidate[];
  /** True when the database held more than the bound: the screen says so instead of implying a complete list. */
  truncated: boolean;
}

export interface PlanSettings {
  monthlyTarget: number | null;
  targetCurrency: string | null;
  /** Done-not-claimed reminder switch. Off by default. */
  reminderOn: boolean;
  /** #2675: lines older than this many days are flagged while the reminder is on. Null = no limit set (no default). */
  doneNotClaimedAfterDays?: number | null;
  monthTargets: Array<{ month: string; target: number }>;
}

const num = (v: number | string | null): number | null => (v === null ? null : Number(v));

function fail(error: { message: string; code?: string; details?: string | null }): never {
  const detail = typeof error.details === 'string' && /^[a-z][a-z-]*$/.test(error.details) ? error.details : undefined;
  throw new AppError(error.message, detail ?? error.code);
}

export async function getPlanCandidates(projectId: string | null): Promise<PlanCandidatesResult> {
  const { data, error } = await supabase.rpc('billing_plan_candidates', projectId ? { p_project: projectId } : {});
  if (error) throw new AppError(error.message, error.code);
  const all = data ?? [];
  return {
    truncated: all.length > PLAN_LIMIT,
    rows: all.slice(0, PLAN_LIMIT).map((r) => {
      const kind = r.kind === 'order' ? 'order' as const : 'line' as const;
      const base = { kind, workOrderId: r.work_order_id, boqItemId: r.boq_item_id };
      return {
        key: candidateKey(base),
        ...base,
        projectId: r.project_id,
        projectName: r.project_name,
        currency: r.currency,
        woNumber: r.wo_number,
        itemCode: r.item_code,
        description: r.description,
        unit: r.unit,
        earningBasis: r.earning_basis,
        contractQuantity: num(r.contract_quantity),
        acceptedQuantity: num(r.accepted_quantity),
        claimedQuantity: num(r.claimed_quantity),
        unclaimedQuantity: num(r.unclaimed_quantity),
        value: Number(r.value),
        acceptedOn: r.accepted_on,
        today: r.today,
      };
    }),
  };
}

export async function getPlanSettings(): Promise<PlanSettings> {
  const [settings, months] = await Promise.all([
    supabase.from('org_billing_plan_settings').select('monthly_target, target_currency, done_not_claimed_reminder_on, done_not_claimed_after_days').maybeSingle(),
    supabase.from('billing_plan_month_targets').select('month, target').order('month', { ascending: true }).limit(120),
  ]);
  if (settings.error) throw new AppError(settings.error.message, settings.error.code);
  if (months.error) throw new AppError(months.error.message, months.error.code);
  return {
    monthlyTarget: num(settings.data?.monthly_target ?? null),
    targetCurrency: settings.data?.target_currency ?? null,
    reminderOn: settings.data?.done_not_claimed_reminder_on ?? false,
    doneNotClaimedAfterDays: settings.data?.done_not_claimed_after_days ?? null,
    monthTargets: (months.data ?? []).map((m) => ({ month: m.month, target: Number(m.target) })),
  };
}

export async function savePlanSettings(input: { monthlyTarget: number | null; targetCurrency: string | null; reminderOn: boolean }): Promise<void> {
  const { error } = await supabase.rpc('set_billing_plan_settings', {
    p_target: input.monthlyTarget, p_currency: input.targetCurrency, p_reminder_on: input.reminderOn,
  });
  if (error) fail(error);
}

/** #2675: the reminder switch and its day limit (null = no limit). Admin/Finance only, enforced by the definer. */
export async function savePlanReminder(input: { reminderOn: boolean; afterDays: number | null }): Promise<void> {
  const { error } = await supabase.rpc('set_billing_plan_reminder', { p_reminder_on: input.reminderOn, p_after_days: input.afterDays });
  if (error) fail(error);
}

export async function saveMonthTarget(month: string, target: number | null): Promise<void> {
  const { error } = await supabase.rpc('set_billing_plan_month_target', { p_month: month, p_target: target });
  if (error) fail(error);
}
