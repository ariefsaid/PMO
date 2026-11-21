/** Parses the threshold field (#2674): empty = off (null), else 0 to 100 with at most two decimals; a comma decimal is accepted. */
export function parseThreshold(raw: string): { ok: true; value: number | null } | { ok: false } {
  const text = raw.trim().replace(',', '.');
  if (text === '') return { ok: true, value: null };
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(text)) return { ok: false };
  const value = Number(text);
  return value >= 0 && value <= 100 ? { ok: true, value } : { ok: false };
}

