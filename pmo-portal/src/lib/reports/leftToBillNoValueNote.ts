/** Any i18next `t`: the page reads a bare `useTranslation()`, home its `dashboard` namespace. */
type Translate = (key: string, options: Record<string, unknown>) => string;

/**
 * #2203: the one sentence said beside every Left to bill total when held contracts with no value are left
 * out of it (`leftToBillSummaryAt`'s `noValueCount`). Callers show it only when the count is above 0.
 */
export function leftToBillNoValueNote(t: Translate, count: number): string {
  return t('financeHub:managementPack.leftToBillNoValue', {
    count,
    defaultValue_one: '{{count}} contract with no value, not in the total',
    defaultValue_other: '{{count}} contracts with no value, not in the total',
  });
}
