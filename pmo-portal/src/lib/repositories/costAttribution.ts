/**
 * repositories/costAttribution.ts (#1271, AC-7) — the seam over the four cost-attribution RPCs
 * (migration 0376, contract in docs/specs/cost-attribution.spec.md §3). Read-side only: nothing here
 * writes to ERPNext. Org scope comes from the JWT inside the RPCs, never an argument.
 *
 * Standalone module (same shape as `budgetProjection.ts`): imported directly by its one consumer.
 * A refusal keeps its Postgres code (`42501`, `22023`, `23505`, `40001`) so `classifyMutationError` can map it.
 */
import { supabase } from '@/src/lib/supabase/client';
import { toAppError } from '@/src/lib/appError';
import type { Json } from '@/src/lib/supabase/database.types';

export interface CostAttributionTarget {
  project_id: string;
  project_name: string;
  /** 0–100, up to 4 decimals. */
  percent: number;
}

/** One current (or historical) rule version, as `list_cost_attribution_rules` returns it. */
export interface CostAttributionRule {
  id: string;
  rule_key: string;
  version: number;
  is_current: boolean;
  name: string;
  match_account: string | null;
  match_account_group: string | null;
  match_cost_center: string | null;
  match_party_type: string | null;
  match_party: string | null;
  effective_from: string;
  effective_to: string | null;
  specificity: number;
  targets: CostAttributionTarget[];
  created_by: string | null;
  created_at: string;
}

/** The rule JSON that preview and save both take (spec §3.2). */
export interface CostAttributionDraft {
  rule_key: string | null;
  expected_version: number | null;
  name: string;
  account?: string;
  account_group?: string;
  cost_center: string | null;
  party_type: string | null;
  party: string | null;
  effective_from: string;
  effective_to: string | null;
  targets: Array<{ project_id: string; percent: number }>;
}

export interface CostAttributionPreviewRow {
  project_id: string;
  /** First day of the posting month. */
  month: string;
  /** `null` = the account maps to no budget category, so the amount will not show in project actuals. */
  category: string | null;
  amount: number;
  line_count: number;
}

async function call<T>(operation: () => PromiseLike<{ data: T | null; error: unknown }>): Promise<T | null> {
  const { data, error } = await operation();
  if (error) throw toAppError(error);
  return data;
}

function readTargets(value: Json): CostAttributionTarget[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const t = entry as { project_id: string; project_name: string; percent: number | string };
    return { project_id: t.project_id, project_name: t.project_name, percent: Number(t.percent) };
  });
}

export async function listCostAttributionRules(includeHistory = false): Promise<CostAttributionRule[]> {
  const rows = await call(() => supabase.rpc('list_cost_attribution_rules', { p_include_history: includeHistory }));
  return (rows ?? []).map((row) => ({ ...row, targets: readTargets(row.targets) }));
}

export async function previewCostAttribution(draft: CostAttributionDraft): Promise<CostAttributionPreviewRow[]> {
  const rows = await call(() => supabase.rpc('preview_cost_attribution', { p_rule: draft as unknown as Json }));
  return (rows ?? []).map((row) => ({ ...row, amount: Number(row.amount) }));
}

export async function saveCostAttributionRule(draft: CostAttributionDraft): Promise<void> {
  await call(() => supabase.rpc('save_cost_attribution_rule', { p_rule: draft as unknown as Json }));
}

export async function endCostAttributionRule(ruleKey: string, effectiveTo: string, expectedVersion: number): Promise<void> {
  await call(() => supabase.rpc('end_cost_attribution_rule', {
    p_rule_key: ruleKey, p_effective_to: effectiveTo, p_expected_version: expectedVersion,
  }));
}
