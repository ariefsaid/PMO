import type { TFunction } from 'i18next';

const REFUSALS = ['COST_WO_PROJECT', 'COST_WO_CANCELLED', 'COST_WO_NO_PROJECT', 'COST_DISCIPLINE'] as const;
const DEFAULTS: Record<(typeof REFUSALS)[number] | 'generic', string> = {
  COST_WO_PROJECT: 'That work order belongs to another project.',
  COST_WO_CANCELLED: 'That work order is cancelled.',
  COST_WO_NO_PROJECT: 'This record has no project, so it cannot go on a work order.',
  COST_DISCIPLINE: "That discipline is no longer on your organisation's list.",
  generic: 'Try again from the record.',
};

/**
 * The plain sentence for a refused work-order/discipline write (#2517). The record itself was already saved
 * when this runs, so the headline says so; the detail names the database's reason (0951 §2) when it is one.
 */
export function describeAttributionError(error: unknown, t: TFunction): { headline: string; detail: string } {
  const message = String((error as { message?: string })?.message ?? '');
  // Codes are matched as the message's leading `CODE:` token, so COST_WO_NO_PROJECT is never read as COST_WO_PROJECT.
  const code = REFUSALS.find((c) => message.startsWith(`${c}:`)) ?? 'generic';
  return {
    headline: t('common:costAttribution.savedWithoutAttribution', 'Saved, but the work order or discipline was not set'),
    detail: t(`common:costAttribution.refusal.${code}`, DEFAULTS[code]),
  };
}
