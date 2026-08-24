import { supabase } from '@/src/lib/supabase/client';

/**
 * Read-only probes the budget import needs before it writes (#495, ADR-0027).
 * REST reads only (OD-ARCH-1) — a read-only existence check needs no RPC.
 *
 * `org_id` is NEVER supplied as a filter: RLS already scopes every read to the caller's org
 * (ADR-0016/0017). `procurementImportSkip.ts` once passed a literal `org_id = ''` here, which is
 * never equal to a uuid, so header idempotency silently did nothing. Same shape, same omission,
 * deliberately.
 */

/**
 * The Draft version an import should attach to, or null when the project has none.
 *
 * ⚑ DD-BIMP-7 — a project may legally hold SEVERAL Drafts (`0001` constrains `unique
 * (project_id, version)` and uniqueness only for `status = 'Active'`), so "the Draft" is not a
 * single row and picking arbitrarily would misfile lines silently. The HIGHEST version wins,
 * because that is what `pages/ProjectBudget.tsx`'s selector already resolves to on screen —
 * the version the operator is looking at when they click Import. A second rule here would make
 * the importer disagree with the page it was launched from.
 */
export async function findImportTargetDraft(projectId: string): Promise<{ id: string } | null> {
  const { data, error } = await supabase
    .from('budget_versions')
    .select('id')
    .eq('project_id', projectId)
    .eq('status', 'Draft')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as { id: string } | null) ?? null;
}

/**
 * The already-imported line for this key WITHIN this version, or null.
 *
 * Scoped to `budget_version_id`, matching `budget_line_items_import_key_uidx` exactly (0195). The
 * scope is not incidental: it is what lets a re-import after activation land its lines in a fresh
 * Draft instead of skipping them all and leaving that Draft empty.
 */
export async function findImportedLine(
  versionId: string,
  importKey: string,
): Promise<{ id: string } | null> {
  const { data, error } = await supabase
    .from('budget_line_items')
    .select('id')
    .eq('budget_version_id', versionId)
    .eq('import_key', importKey)
    .maybeSingle();
  if (error) throw error;
  return (data as { id: string } | null) ?? null;
}
