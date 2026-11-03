import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import {
  CORE_FEATURES,
  FEATURE_KEYS,
  type EntitleableKey,
  type FeatureResolution,
  type FeatureSource,
  type OrgFeatureKey,
  type ResolvedFeatureSet,
} from '@/src/lib/features';

/**
 * org_features DAL — now a thin seam over the database resolver (FR-PLN-005).
 *
 * Reads: `resolved_org_features()` (own org) and `operator_resolved_org_features(uuid)` (the org an
 * Operator is looking at) return the SAME resolved projection the server enforces, so no layer
 * re-implements the global → override → plan order, and the revenue display rule (FR-PLN-005a)
 * arrives as `display_enabled` instead of the FE's old `useRevenueMode()` copy.
 *
 * Operator reads for the console: `operator_plan_catalogue()` (plans, limits, plan matrix, all-orgs
 * flags), `operator_org_plan(uuid)`, `operator_org_overrides(uuid)` (which override rows exist),
 * and `resolved_org_plan()` for the read-only Admin page.
 *
 * Writes: the guarded Operator RPCs from 0532/0533 plus the Admin-owned feedback switch (0419).
 * Every one of them re-asserts its own authority server-side; the FE gate is clarity only (ADR-0016).
 */

/** One row of the resolved projection (0532:177). */
export interface ResolvedFeatureRow {
  feature_key: string;
  enabled: boolean;
  display_enabled: boolean;
  source: string;
}

const SOURCES: ReadonlySet<string> = new Set<FeatureSource>(['global', 'override', 'plan', 'core', 'unknown']);

// Derive the validation set from the CANONICAL registries (gatable + core): a hand-maintained copy
// would silently drop rows when the SQL registry and the FE list diverged. Core keys are accepted
// because the projection returns them (`source: 'core'`) for the console's always-on rows.
const FEATURE_KEY_SET: ReadonlySet<string> = new Set<string>(FEATURE_KEYS);
const ENTITLEMENT_KEY_SET: ReadonlySet<string> = new Set<string>([...FEATURE_KEYS, ...CORE_FEATURES]);
function isValidFeatureKey(key: string): key is OrgFeatureKey {
  return FEATURE_KEY_SET.has(key);
}
function isEntitlementKey(key: string): key is EntitleableKey {
  return ENTITLEMENT_KEY_SET.has(key);
}

function toSource(value: string): FeatureSource {
  return SOURCES.has(value) ? (value as FeatureSource) : 'unknown';
}

/**
 * Project the resolved rows into the two maps the UI needs. Pure, so the shape is proven in a unit
 * test without a client: `display` is what navigation and routes read, `states` is the console's
 * per-key detail. Unknown keys are dropped (a DB registry ahead of the FE must never leak a key the
 * FE cannot label).
 */
export function projectResolvedFeatures(rows: ResolvedFeatureRow[]): ResolvedFeatureSet {
  const display: Partial<Record<EntitleableKey, boolean>> = {};
  const states: Partial<Record<EntitleableKey, FeatureResolution>> = {};
  for (const row of rows) {
    if (!isEntitlementKey(row.feature_key)) continue;
    display[row.feature_key] = row.display_enabled;
    states[row.feature_key] = {
      enabled: row.enabled,
      displayEnabled: row.display_enabled,
      source: toSource(row.source),
    };
  }
  return { display, states };
}

/** The caller's own-org resolved set (one call — the single source of display gating). */
export async function listOwnResolvedFeatures(): Promise<ResolvedFeatureSet> {
  const { data, error } = await supabase.rpc('resolved_org_features');
  if (error) throw new AppError(error.message, error.code);
  return projectResolvedFeatures((data ?? []) as ResolvedFeatureRow[]);
}

/** The resolved set of ONE organisation, for the Operator console (active Operator only, server-side). */
export async function listOperatorResolvedFeatures(orgId: string): Promise<ResolvedFeatureSet> {
  const { data, error } = await supabase.rpc('operator_resolved_org_features', { p_org_id: orgId });
  if (error) throw new AppError(error.message, error.code);
  return projectResolvedFeatures((data ?? []) as ResolvedFeatureRow[]);
}

/**
 * The per-org override keys that EXIST for one organisation (Operator console).
 *
 * The resolved projection reports `source = 'global'` whenever an all-orgs off outranks an
 * override, which hides whether a row is there. This read answers presence, so an Operator can
 * clear a dormant override while the kill switch is off.
 */
export async function listOperatorOrgOverrides(orgId: string): Promise<OrgFeatureKey[]> {
  const { data, error } = await supabase.rpc('operator_org_overrides', { p_org_id: orgId });
  if (error) throw new AppError(error.message, error.code);
  return ((data ?? []) as { feature_key: string }[])
    .map((row) => row.feature_key)
    .filter(isValidFeatureKey);
}

/** A plan and its limits. `null` limits mean "per contract" / unlimited (spec limits table). */
export interface PlanRow {
  planId: string;
  name: string;
  seatLimit: number | null;
  projectLimit: number | null;
  aiMonthlyMessages: number | null;
}

/** The Operator console catalogue: every plan, the plan matrix and the all-orgs flags. */
export interface PlanCatalogue {
  plans: PlanRow[];
  /** planId → key → enabled. */
  defaults: Record<string, Partial<Record<OrgFeatureKey, boolean>>>;
  /** key → all-orgs flag; `null`/absent for the Admin-owned key that has no global row. */
  global: Partial<Record<OrgFeatureKey, boolean | null>>;
}

interface CatalogueRow {
  plan_id: string;
  plan_name: string;
  seat_limit: number | null;
  project_limit: number | null;
  ai_monthly_messages: number | null;
  feature_key: string;
  feature_enabled: boolean;
  global_enabled: boolean | null;
}

/** Pure projection of `operator_plan_catalogue()` rows. */
export function projectPlanCatalogue(rows: CatalogueRow[]): PlanCatalogue {
  const plans = new Map<string, PlanRow>();
  const defaults: Record<string, Partial<Record<OrgFeatureKey, boolean>>> = {};
  const global: Partial<Record<OrgFeatureKey, boolean | null>> = {};
  for (const row of rows) {
    if (!plans.has(row.plan_id)) {
      plans.set(row.plan_id, {
        planId: row.plan_id,
        name: row.plan_name,
        seatLimit: row.seat_limit,
        projectLimit: row.project_limit,
        aiMonthlyMessages: row.ai_monthly_messages,
      });
      defaults[row.plan_id] = {};
    }
    if (!isValidFeatureKey(row.feature_key)) continue;
    defaults[row.plan_id][row.feature_key] = row.feature_enabled;
    global[row.feature_key] = row.global_enabled;
  }
  return { plans: [...plans.values()], defaults, global };
}

/** Operator-only: the whole registry, in one read. */
export async function getPlanCatalogue(): Promise<PlanCatalogue> {
  const { data, error } = await supabase.rpc('operator_plan_catalogue');
  if (error) throw new AppError(error.message, error.code);
  return projectPlanCatalogue((data ?? []) as CatalogueRow[]);
}

/** Operator-only: the plan assigned to one org (`null` = unassigned, resolves as Enterprise). */
export async function getOrgPlan(orgId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('operator_org_plan', { p_org_id: orgId });
  if (error) throw new AppError(error.message, error.code);
  return typeof data === 'string' ? data : null;
}

interface OwnPlanRow {
  plan_id: string;
  plan_name: string;
  seat_limit: number | null;
  project_limit: number | null;
  ai_monthly_messages: number | null;
}

/** Own-org plan for the read-only Admin page (FR-PLN-014). Null when the projection is empty. */
export async function getOwnPlan(): Promise<PlanRow | null> {
  const { data, error } = await supabase.rpc('resolved_org_plan');
  if (error) throw new AppError(error.message, error.code);
  const row = ((data ?? []) as OwnPlanRow[])[0];
  if (!row) return null;
  return {
    planId: row.plan_id,
    name: row.plan_name,
    seatLimit: row.seat_limit,
    projectLimit: row.project_limit,
    aiMonthlyMessages: row.ai_monthly_messages,
  };
}

/** Set (upsert) a per-org override via the Operator-only RPC. */
export async function toggleOrgFeature(args: {
  orgId: string;
  key: OrgFeatureKey;
  enabled: boolean;
}): Promise<void> {
  const { data, error } = await supabase.rpc('operator_toggle_feature', {
    p_org_id: args.orgId,
    p_key: args.key,
    p_enabled: args.enabled,
  });
  if (error) throw new AppError(error.message, error.code);
  void data;
}

/** Remove a per-org override so the key falls back to the plan (Operator-only). */
export async function clearOrgFeatureOverride(args: { orgId: string; key: OrgFeatureKey }): Promise<void> {
  const { data, error } = await supabase.rpc('operator_clear_feature_override', {
    p_org_id: args.orgId,
    p_key: args.key,
  });
  if (error) throw new AppError(error.message, error.code);
  void data;
}

/** Assign one org a plan (Operator-only). */
export async function setOrgPlan(args: { orgId: string; planId: string }): Promise<void> {
  const { data, error } = await supabase.rpc('operator_set_org_plan', {
    p_org_id: args.orgId,
    p_plan_id: args.planId,
  });
  if (error) throw new AppError(error.message, error.code);
  void data;
}

/** Flip one key for every org (Operator-only; a global off outranks any override). */
export async function setGlobalFeature(args: { key: OrgFeatureKey; enabled: boolean }): Promise<void> {
  const { data, error } = await supabase.rpc('operator_set_global_feature', {
    p_key: args.key,
    p_enabled: args.enabled,
  });
  if (error) throw new AppError(error.message, error.code);
  void data;
}

/** Flip one key inside one plan's default set (Operator-only). */
export async function setPlanFeature(args: {
  planId: string;
  key: OrgFeatureKey;
  enabled: boolean;
}): Promise<void> {
  const { data, error } = await supabase.rpc('operator_set_plan_feature', {
    p_plan_id: args.planId,
    p_key: args.key,
    p_enabled: args.enabled,
  });
  if (error) throw new AppError(error.message, error.code);
  void data;
}

/** Replace a plan's limits (Operator-only; null = unlimited / per contract). */
export async function setPlanLimits(args: {
  planId: string;
  seatLimit: number | null;
  projectLimit: number | null;
  aiMonthlyMessages: number | null;
}): Promise<void> {
  const { data, error } = await supabase.rpc('operator_set_plan_limits', {
    p_plan_id: args.planId,
    p_seat_limit: args.seatLimit,
    p_project_limit: args.projectLimit,
    p_ai_monthly_messages: args.aiMonthlyMessages,
  });
  if (error) throw new AppError(error.message, error.code);
  void data;
}

/** Admin-only: switch feedback and surveys for the caller's own org (the RPC stamps the org; 0419). */
export async function setFeedbackSurveys(enabled: boolean): Promise<void> {
  const { error } = await supabase.rpc('admin_set_feedback_surveys', { p_enabled: enabled });
  if (error) throw new AppError(error.message, error.code);
}

/** The org's credit-pool balance (grants − usage) via the security-definer RPC (FR-CRE-002). */
export async function getOrgCreditBalance(orgId: string): Promise<number> {
  const { data, error } = await supabase.rpc('org_credit_balance', { p_org_id: orgId });
  if (error) throw new AppError(error.message, error.code);
  return typeof data === 'number' ? data : Number(data ?? 0);
}

/** Operator-only credit grant (FR-CRE-005); rejects `amount <= 0` with errcode `23514`. */
export async function grantOrgCredits(args: {
  orgId: string;
  amount: number;
  note: string;
}): Promise<void> {
  const { data, error } = await supabase.rpc('operator_grant_credits', {
    p_org_id: args.orgId,
    p_amount: args.amount,
    p_note: args.note,
  });
  if (error) throw new AppError(error.message, error.code);
  void data;
}
