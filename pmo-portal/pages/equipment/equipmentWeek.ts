/** Local-calendar week helpers for the equipment grid (#1519 S6). Work dates are plain `YYYY-MM-DD` strings (NFR-EQU-004). */
const pad = (n: number): string => String(n).padStart(2, '0');
export const toIso = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fromIso = (iso: string): Date => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (iso: string, n: number): string => { const d = fromIso(iso); d.setDate(d.getDate() + n); return toIso(d); };
/** The Monday on or before `iso` (weeks start on Monday, OQ-8). */
export const mondayOf = (iso: string): string => addDays(iso, -((fromIso(iso).getDay() + 6) % 7));
export const weekDays = (weekStart: string): string[] => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
/** First day of the month holding `iso`, and of the month `n` months later. */
export const monthStart = (iso: string, n = 0): string => { const d = fromIso(iso); return toIso(new Date(d.getFullYear(), d.getMonth() + n, 1)); };
