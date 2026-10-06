/**
 * Build the download filename for an export: `<Entity>_<YYYY-MM-DD>.<ext>`, using the caller-supplied
 * entity label and a date (defaults to today's local date). Date and extension are injectable so
 * callers/tests stay deterministic; `xlsx` remains the default for every existing caller.
 */
export function exportFilename(entity: string, date: Date = new Date(), ext: 'xlsx' | 'csv' = 'xlsx'): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${entity}_${y}-${m}-${d}.${ext}`;
}
