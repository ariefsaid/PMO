/** provisionConfirm.mjs — pure typed-confirm matcher (FR-PROV-001, AC-PROV-002). */
export function confirmSlugMatches({ targetSlug, typed }) {
  return typed === targetSlug;
}
