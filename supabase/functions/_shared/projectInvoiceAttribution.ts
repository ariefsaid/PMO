import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import { invertProjectMap } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/projectMap.ts';

/** Resolve ERP project names only through the activated binding and same-org PMO projects. */
export async function resolveInvoiceProjects(
  db: SupabaseClient,
  orgId: string,
  names: readonly unknown[],
): Promise<ReadonlyMap<string, string | null>> {
  const result = new Map<string, string | null>();
  const strings = [...new Set(names.filter((name): name is string => typeof name === 'string' && name.length > 0))];
  if (strings.length === 0) return result;

  const { data: binding, error: bindingError } = await db.from('external_org_bindings')
    .select('config').eq('org_id', orgId).eq('external_tier', 'erpnext').not('activated_at', 'is', null).maybeSingle();
  if (bindingError) throw new AppError(bindingError.message, bindingError.code);
  const config = binding?.config as { project_map?: Record<string, unknown> } | undefined;
  const inverse = invertProjectMap(config?.project_map);
  const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  const candidates = [...new Set(strings.flatMap((name) => {
    const id = inverse.get(name);
    return id && uuid.test(id) ? [id] : [];
  }))];
  const valid = new Set<string>();
  for (let start = 0; start < candidates.length; start += 200) {
    const { data, error } = await db.from('projects').select('id').eq('org_id', orgId)
      .in('id', candidates.slice(start, start + 200));
    if (error) throw new AppError(error.message, error.code);
    for (const row of data ?? []) valid.add(row.id);
  }
  for (const name of strings) {
    const id = inverse.get(name);
    result.set(name, id && valid.has(id) ? id : null);
  }
  return result;
}

export async function resolveInvoiceProject(
  db: SupabaseClient,
  orgId: string,
  erpProject: unknown,
): Promise<string | null> {
  if (typeof erpProject !== 'string') return null;
  return (await resolveInvoiceProjects(db, orgId, [erpProject])).get(erpProject) ?? null;
}
