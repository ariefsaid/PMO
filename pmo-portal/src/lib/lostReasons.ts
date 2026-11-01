// The nine stored keys (mirror of projects_lost_reason_check in 0461) and the one validity rule.
export const LOST_REASON_KEYS = [
  'price', 'competitor', 'scope_fit', 'timing', 'capacity', 'relationship', 'client_cancelled', 'no_decision', 'other',
] as const;
export type LostReasonKey = (typeof LOST_REASON_KEYS)[number];
export const LOST_NOTE_MAX = 500;

export function isLostReasonKey(v: string | null | undefined): v is LostReasonKey {
  return !!v && (LOST_REASON_KEYS as readonly string[]).includes(v);
}

/** One rule for all three call sites; the RPC re-enforces it (FR-LR-002/003). */
export function lostReasonValid(reason: string | null | undefined, note: string | null | undefined): boolean {
  if (!isLostReasonKey(reason)) return false;
  const n = (note ?? '').trim();
  if (n.length > LOST_NOTE_MAX) return false;
  return reason !== 'other' || n.length > 0;
}

type T = (key: string, defaultValue: string) => string;
/** The one label source (FR-LR-014). Literal keys + English defaults: unit tests run with empty catalogues
 *  (test/setup.ts) and the i18n completeness gate reads literal t() calls. null = "Not recorded". */
export function lostReasonLabel(t: T, key: string | null | undefined): string {
  switch (key) {
    case 'price': return t('lostReason:reasons.price', 'Price');
    case 'competitor': return t('lostReason:reasons.competitor', 'Lost to a competitor');
    case 'scope_fit': return t('lostReason:reasons.scope_fit', 'Scope or fit');
    case 'timing': return t('lostReason:reasons.timing', 'Timing');
    case 'capacity': return t('lostReason:reasons.capacity', 'Our capacity');
    case 'relationship': return t('lostReason:reasons.relationship', 'Relationship');
    case 'client_cancelled': return t('lostReason:reasons.client_cancelled', 'Client cancelled or postponed');
    case 'no_decision': return t('lostReason:reasons.no_decision', 'No decision from the client');
    case 'other': return t('lostReason:reasons.other', 'Other');
    default: return t('lostReason:notRecorded', 'Not recorded');
  }
}
