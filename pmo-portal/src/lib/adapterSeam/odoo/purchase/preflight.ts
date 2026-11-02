export interface PreflightInput { caller: string; procurement?: string; vendor?: string; invoice?: string; activated?: boolean; beforeCutover?: boolean | 'unknown' }
export type PreflightResult = { outcome: 'accepted'; erpCalls: 0 } | { outcome: 'refused'; code: string; erpCalls: 0 };
export function procurementPreflight(input: PreflightInput): PreflightResult {
  if ([input.procurement, input.vendor, input.invoice].some((owner) => owner !== undefined && owner !== input.caller)) return { outcome: 'refused', code: 'cross-org-link-rejected', erpCalls: 0 };
  if (input.activated === false) return { outcome: 'refused', code: 'config-rejected', erpCalls: 0 };
  if (input.beforeCutover === true) return { outcome: 'refused', code: 'pre-cutover', erpCalls: 0 };
  if (input.beforeCutover === 'unknown') return { outcome: 'refused', code: 'config-rejected', erpCalls: 0 };
  return { outcome: 'accepted', erpCalls: 0 };
}
