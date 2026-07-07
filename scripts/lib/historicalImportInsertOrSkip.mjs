/**
 * historicalImportInsertOrSkip.mjs — re-run-safe insert for the historical loader
 * (Deliverable 3, FR-HIST-011 / AC-HIST-006; fix-round B2). Mirrors the D2 skip mechanism:
 * check (import_key, batch) existence first, and if the DB partial-unique index (migration 0072)
 * still fires a 23505 on a concurrent race, treat it as "already imported → skipped" and re-resolve
 * the winning row. This makes a same-batch re-run create ZERO new rows.
 *
 * Pure of any Supabase specifics — the caller injects `findExisting` (returns {id}|null),
 * `insert` (returns {data,error} Supabase-style), and optionally `reResolve` (used after a 23505).
 *
 * @returns { action: 'created'|'skipped'|'failed', id?, error? }
 */
export async function insertOrSkip({ findExisting, insert, reResolve }) {
  const existing = await findExisting();
  if (existing) return { action: 'skipped', id: existing.id };

  const { data, error } = await insert();
  if (!error) return { action: 'created', id: data?.id };

  if (error.code === '23505') {
    const raced = reResolve ? await reResolve() : (await findExisting());
    return { action: 'skipped', id: raced?.id };
  }
  return { action: 'failed', error: error.message ?? String(error) };
}
