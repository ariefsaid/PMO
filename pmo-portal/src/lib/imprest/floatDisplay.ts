import type { ImprestFloatChoice } from '@/src/lib/db/imprest';

/**
 * Picker options for "Charge to site float" (#1635). A float is named by its project, the custodian as secondary text
 * (a native option has no second line, so it follows a separator). Where two floats still read alike (one custodian,
 * one project) the float's currency is appended, then a neutral "float N" (never the amount: members must not see it).
 */
export function floatChoiceOptions(choices: ImprestFloatChoice[]): Array<{ value: string; label: string }> {
  const base = choices.map((c) => (c.project_name ? `${c.project_name} · ${c.custodian_name}` : c.custodian_name));
  const withCcy = base.map((l, i) => (base.some((o, j) => j !== i && o === l) && choices[i].currency ? `${l} (${choices[i].currency})` : l));
  const seen = new Map<string, number>();
  return choices.map((c, i) => {
    const l = withCcy[i];
    const dupes = withCcy.filter((o) => o === l).length;
    const n = (seen.get(l) ?? 0) + 1;
    seen.set(l, n);
    return { value: c.float_id, label: dupes > 1 ? `${l} · float ${n}` : l };
  });
}
