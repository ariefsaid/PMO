/**
 * Format a `Date` as the value an `<input type="datetime-local">` expects:
 * `YYYY-MM-DDTHH:mm` in the browser's LOCAL timezone.
 *
 * ⚑ Deliberately local, not UTC — the control shows and edits wall-clock time, so an ISO/UTC
 * value (as `exportFilename.ts` produces for filenames) would shift the displayed time by the
 * viewer's offset. The caller converts back to an ISO instant on submit (`new Date(value)`).
 */
export function toDatetimeLocalValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
