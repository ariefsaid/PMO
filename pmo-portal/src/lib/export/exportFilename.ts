/**
 * Build the download filename for an export: `<Entity>_<YYYY-MM-DD>.xlsx`,
 * using the caller-supplied entity label and a date (defaults to today's local
 * date). The date is injectable so callers/tests stay deterministic.
 */

export function exportFilename(entity: string, date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${entity}_${y}-${m}-${d}.xlsx`;
}
