import type { CostAttributionDraft, CostAttributionRule } from '@/src/lib/repositories/costAttribution';

/** The rule form's values — strings as typed; `toDraft` turns them into the RPC JSON (spec §3.2). */
export interface RuleFormValues {
  name: string;
  matchBy: 'account' | 'account_group';
  matchValue: string;
  costCenter: string;
  partyType: string;
  party: string;
  effectiveFrom: string;
  effectiveTo: string;
  targets: Array<{ projectId: string; percent: string }>;
}

export type RuleFormErrorKey =
  | 'name' | 'matchValue' | 'effectiveFrom' | 'effectiveTo' | 'party' | 'targets';

export const EMPTY_RULE_VALUES: RuleFormValues = {
  name: '', matchBy: 'account', matchValue: '', costCenter: '', partyType: '', party: '',
  effectiveFrom: '', effectiveTo: '', targets: [{ projectId: '', percent: '100' }],
};

export function valuesFromRule(rule: CostAttributionRule): RuleFormValues {
  return {
    name: rule.name,
    matchBy: rule.match_account_group ? 'account_group' : 'account',
    matchValue: rule.match_account_group ?? rule.match_account ?? '',
    costCenter: rule.match_cost_center ?? '',
    partyType: rule.match_party_type ?? '',
    party: rule.match_party ?? '',
    effectiveFrom: rule.effective_from,
    effectiveTo: rule.effective_to ?? '',
    targets: rule.targets.map((t) => ({ projectId: t.project_id, percent: String(t.percent) })),
  };
}

/** Percent text → ten-thousandths (4 decimals, the column's scale), or null when not a valid percent in (0, 100]. */
export function percentUnits(text: string): number | null {
  const m = /^(\d{1,3})(?:\.(\d{1,4}))?$/.exec(text.trim());
  if (!m) return null;
  const units = Number(m[1]) * 10000 + Number((m[2] ?? '').padEnd(4, '0'));
  return units > 0 && units <= 1_000_000 ? units : null;
}

const DAY_MS = 86_400_000;
/** `effective_to = effective_from − 1 day` is allowed (it voids a rule); anything earlier is refused (FR-CAT-010). */
function earlierThanDayBefore(to: string, from: string): boolean {
  const f = Date.parse(`${from}T00:00:00Z`);
  const t = Date.parse(`${to}T00:00:00Z`);
  return Number.isFinite(f) && Number.isFinite(t) && t < f - DAY_MS;
}

/** Stable codes (the form maps them to words) so this stays free of UI copy. */
export type RuleFormErrorCode =
  | 'required' | 'before-from' | 'party-type-needs-party'
  | 'no-project' | 'duplicate-project' | 'bad-percent' | 'total-not-100';

export function validateRule(v: RuleFormValues): Partial<Record<RuleFormErrorKey, RuleFormErrorCode>> {
  const errors: Partial<Record<RuleFormErrorKey, RuleFormErrorCode>> = {};
  if (!v.name.trim()) errors.name = 'required';
  if (!v.matchValue.trim()) errors.matchValue = 'required';
  if (!v.effectiveFrom) errors.effectiveFrom = 'required';
  if (v.effectiveFrom && v.effectiveTo && earlierThanDayBefore(v.effectiveTo, v.effectiveFrom)) errors.effectiveTo = 'before-from';
  if (v.partyType.trim() && !v.party.trim()) errors.party = 'party-type-needs-party';
  const ids = v.targets.map((t) => t.projectId);
  if (ids.some((id) => !id)) errors.targets = 'no-project';
  else if (new Set(ids).size !== ids.length) errors.targets = 'duplicate-project';
  else {
    const units = v.targets.map((t) => percentUnits(t.percent));
    if (units.some((u) => u === null)) errors.targets = 'bad-percent';
    else if (units.reduce<number>((a, u) => a + (u as number), 0) !== 1_000_000) errors.targets = 'total-not-100';
  }
  return errors;
}

const blankToNull = (s: string): string | null => (s.trim() ? s.trim() : null);

/** `expected` carries the rule being edited (new version of the same `rule_key`); null = a new rule. */
export function toDraft(v: RuleFormValues, editing: Pick<CostAttributionRule, 'rule_key' | 'version'> | null): CostAttributionDraft {
  return {
    rule_key: editing?.rule_key ?? null,
    expected_version: editing?.version ?? null,
    name: v.name.trim(),
    ...(v.matchBy === 'account' ? { account: v.matchValue.trim() } : { account_group: v.matchValue.trim() }),
    cost_center: blankToNull(v.costCenter),
    party_type: blankToNull(v.party) ? blankToNull(v.partyType) : null,
    party: blankToNull(v.party),
    effective_from: v.effectiveFrom,
    effective_to: blankToNull(v.effectiveTo),
    targets: v.targets.map((t) => ({ project_id: t.projectId, percent: Number(t.percent) })),
  };
}
