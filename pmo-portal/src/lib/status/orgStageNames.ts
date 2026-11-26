/**
 * #2906: the organisation's own stage names for the reader's language. Filled once per session by
 * `useApplyOrgStageNames`; every stage label path asks here first and falls back to the shipped
 * wording. The stored stage key never changes.
 */
export interface StageNameRow { status: string; label_en: string | null; label_id: string | null }

let active: Record<string, string> = {};

/** Returns true when the names changed, so the caller knows to re-render. */
export function setOrgStageNames(rows: readonly StageNameRow[], locale: string): boolean {
  const lang = locale.startsWith('id') ? 'id' : 'en';
  const next: Record<string, string> = {};
  for (const r of rows) {
    const name = lang === 'id' ? r.label_id : r.label_en;
    if (name) next[r.status] = name;
  }
  if (JSON.stringify(next) === JSON.stringify(active)) return false;
  active = next;
  return true;
}

export const orgStageName = (status: string): string | undefined => active[status];
