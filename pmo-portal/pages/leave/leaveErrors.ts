import type { TFunction } from 'i18next';
import { classifyMutationError, joinSentences } from '@/src/lib/classifyMutationError';

/** One sentence for a refused leave write (#2708). The database names the rule in a stable prefix (`LV_SOD: …`). */
export function leaveErrorMessage(t: TFunction, err: unknown): string {
  const e = err as { code?: string; message?: string } | null;
  const code = e?.code ?? '';
  const prefix = /^([A-Z_]+):/.exec(e?.message ?? '')?.[1] ?? '';
  if (code === '23505') return t('crews:leave.errors.duplicateType', 'That leave type already exists.');
  switch (prefix) {
    case 'LV_OVERLAP': return t('crews:leave.errors.overlap', 'This person already has a pending or approved request on some of these days.');
    case 'LV_RANGE': return t('crews:leave.errors.range', 'The last day is before the first day.');
    case 'LV_SOD': return t('crews:leave.errors.sod', 'You cannot decide your own request, or one you entered. Someone else must.');
    case 'LV_FORBIDDEN': return t('crews:leave.errors.forbidden', 'You cannot do this for this request.');
    case 'LV_DECIDED': return t('crews:leave.errors.decided', 'This request has already been decided. Reload to see it.');
    case 'LV_NOTE': return t('crews:leave.errors.note', 'Give a reason when rejecting.');
    case 'LV_DISABLED': return t('crews:leave.errors.disabled', 'Leave requests are not switched on.');
    default: { const c = classifyMutationError(err); return joinSentences(c.headline, c.detail); }
  }
}
