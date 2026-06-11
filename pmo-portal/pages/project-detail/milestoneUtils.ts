/** Format a nullable % value: null → '—'; numeric → '{rounded}%'. */
export function pct(v: number | null): string {
  return v == null ? '—' : `${Math.round(v)}%`;
}
