import type { ImprestFloatChoice } from '@/src/lib/db/imprest';
import { formatCurrencyAuto } from '@/src/lib/format';

/**
 * Picker options for "Charge to site float" (#1635). A float is named by its project, the custodian as secondary text
 * (a native option has no second line, so it follows a separator). Where two floats still read alike (one custodian,
 * one project) the float's currency and amount are appended so every choice is distinct.
 */
export function floatChoiceOptions(choices: ImprestFloatChoice[]): Array<{ value: string; label: string }> {
  const labels = choices.map((c) => (c.project_name ? `${c.project_name} · ${c.custodian_name}` : c.custodian_name));
  return choices.map((c, i) => {
    const clash = labels.some((l, j) => j !== i && l === labels[i]);
    const detail = clash && c.currency ? ` (${c.float_amount != null ? formatCurrencyAuto(c.float_amount, c.currency) : c.currency})` : '';
    return { value: c.float_id, label: `${labels[i]}${detail}` };
  });
}
