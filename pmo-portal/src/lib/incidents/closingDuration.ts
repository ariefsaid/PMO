import type { TFunction } from 'i18next';

/**
 * Formats closing duration in hours to a human-readable string.
 * Supports days, hours, and minutes with bilingual translation fallback.
 */
export function formatClosingDuration(
  hours: number | null | undefined,
  t?: TFunction | ((key: string, fallback: string, options?: Record<string, unknown>) => string),
): string {
  if (hours === null || hours === undefined || Number.isNaN(hours)) {
    return '—';
  }
  if (hours >= 48) {
    const days = (hours / 24).toFixed(1);
    return t ? String(t('closingReport.durationDays', '{{days}} days', { days })) : `${days} days`;
  }
  if (hours >= 1) {
    const h = Math.round(hours);
    return t ? String(t('closingReport.durationHours', '{{count}} hrs', { count: h })) : `${h} hrs`;
  }
  const mins = Math.max(1, Math.round(hours * 60));
  return t ? String(t('closingReport.durationMinutes', '{{count}} mins', { count: mins })) : `${mins} mins`;
}
