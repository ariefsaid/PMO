/** The database refuses an empty daily report with `dsr_empty: progress,hours,photo` (SQLSTATE DS001). The screen words it; the message is never shown. */
export const EMPTY_REPORT_CODE = 'DS001';
export type MissingPart = 'progress' | 'hours' | 'photo';

/** The parts a report can carry that this refusal names, or null when the error is not that refusal. */
export function missingPartsFrom(err: unknown): MissingPart[] | null {
  const code = (err as { code?: unknown } | null)?.code;
  if (code !== EMPTY_REPORT_CODE) return null;
  const message = err instanceof Error ? err.message : '';
  const parts = (message.split(':')[1] ?? '').split(',').map((p) => p.trim());
  const known = parts.filter((p): p is MissingPart => p === 'progress' || p === 'hours' || p === 'photo');
  return known.length > 0 ? known : ['progress', 'hours', 'photo'];
}
