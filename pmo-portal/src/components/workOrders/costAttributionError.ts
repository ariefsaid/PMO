import type { TFunction } from 'i18next';

const REFUSALS = ['COST_WO_PROJECT', 'COST_WO_CANCELLED', 'COST_WO_NO_PROJECT', 'COST_DISCIPLINE'] as const;
const DEFAULTS: Record<(typeof REFUSALS)[number] | 'generic', string> = {
  COST_WO_PROJECT: 'That work order belongs to another project.',
  COST_WO_CANCELLED: 'That work order is cancelled.',
  COST_WO_NO_PROJECT: 'This record has no project, so it cannot go on a work order.',
  COST_DISCIPLINE: "That discipline is no longer on your organisation's list.",
  generic: 'Try again from the record.',
};

// Static keys (not a template) so the i18n gate can see each one is used.
function refusalText(code: (typeof REFUSALS)[number] | 'generic', t: TFunction): string {
  switch (code) {
    case 'COST_WO_PROJECT': return t('workOrderCost:refusal.COST_WO_PROJECT', DEFAULTS.COST_WO_PROJECT);
    case 'COST_WO_CANCELLED': return t('workOrderCost:refusal.COST_WO_CANCELLED', DEFAULTS.COST_WO_CANCELLED);
    case 'COST_WO_NO_PROJECT': return t('workOrderCost:refusal.COST_WO_NO_PROJECT', DEFAULTS.COST_WO_NO_PROJECT);
    case 'COST_DISCIPLINE': return t('workOrderCost:refusal.COST_DISCIPLINE', DEFAULTS.COST_DISCIPLINE);
    default: return t('workOrderCost:refusal.generic', DEFAULTS.generic);
  }
}

/**
 * The plain sentence for a refused work-order/discipline write (#2517). The record itself was already saved
 * when this runs, so the headline says so; the detail names the database's reason (0951 §2) when it is one.
 */
export function describeAttributionError(error: unknown, t: TFunction): { headline: string; detail: string } {
  const message = String((error as { message?: string })?.message ?? '');
  // Codes are matched as the message's leading `CODE:` token, so COST_WO_NO_PROJECT is never read as COST_WO_PROJECT.
  const code = REFUSALS.find((c) => message.startsWith(`${c}:`)) ?? 'generic';
  return {
    headline: t('workOrderCost:savedWithoutAttribution', 'Saved, but the work order or discipline was not set'),
    detail: refusalText(code, t),
  };
}
