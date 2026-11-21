import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';

/**
 * Document categories DAL (#2579, migrations 1090-1093). Reads are the two category tables (any active member of the
 * organisation); every write is one of the Admin management functions, which re-assert the role in the database.
 * org_id is never sent. The tables and functions are not in the generated types until the next `supabase gen types`,
 * so the client is typed here (as documentExpiry does).
 */
export type CategoryRole = 'Executive' | 'Project Manager' | 'Finance' | 'Engineer' | 'Admin';

export interface DocumentCategory {
  id: string;
  name: string;
  is_system: boolean;
  sort_order: number;
  archived_at: string | null;
  /** The viewer roles. Admin is always present. */
  roles: CategoryRole[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const table = (name: string): any => supabase.from(name as never);
const rpc = (fn: string, args: Record<string, unknown>) =>
  (supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string; code?: string; details?: string } | null }>)
    .call(supabase, fn, args);
function fail(error: { message: string; code?: string; details?: string }): never { throw new AppError(error.message, error.code, error.details); }

export async function listDocumentCategories(): Promise<DocumentCategory[]> {
  const [cats, roles] = await Promise.all([
    table('document_categories').select('id, name, is_system, sort_order, archived_at').order('sort_order', { ascending: true }).order('name', { ascending: true }),
    table('document_category_roles').select('category_id, role'),
  ]);
  if (cats.error) fail(cats.error);
  if (roles.error) fail(roles.error);
  const byCategory = new Map<string, CategoryRole[]>();
  for (const r of (roles.data ?? []) as { category_id: string; role: CategoryRole }[]) {
    byCategory.set(r.category_id, [...(byCategory.get(r.category_id) ?? []), r.role]);
  }
  return ((cats.data ?? []) as Omit<DocumentCategory, 'roles'>[]).map((c) => ({ ...c, roles: byCategory.get(c.id) ?? [] }));
}

async function call(fn: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await rpc(fn, args);
  if (error) fail(error);
  return data;
}

export async function createCategory(name: string, roles: CategoryRole[]): Promise<string> {
  return (await call('create_document_category', { p_name: name.trim(), p_roles: roles })) as string;
}
export async function renameCategory(id: string, name: string): Promise<void> {
  await call('rename_document_category', { p_id: id, p_name: name.trim() });
}
/** Replaces the whole set in one step; the database refuses a set without Admin. */
export async function setCategoryRoles(id: string, roles: CategoryRole[]): Promise<void> {
  await call('set_document_category_roles', { p_id: id, p_roles: roles });
}
export async function archiveCategory(id: string): Promise<void> {
  await call('archive_document_category', { p_id: id });
}
export async function restoreCategory(id: string): Promise<void> {
  await call('restore_document_category', { p_id: id });
}
export async function reorderCategories(ids: string[]): Promise<void> {
  await call('reorder_document_categories', { p_ids: ids });
}
/** Moves the whole revision lineage of a document; resolves to the number of documents moved. */
export async function refileLineage(documentId: string, categoryId: string): Promise<number> {
  return (await call('refile_document_lineage', { p_document_id: documentId, p_category_id: categoryId })) as number;
}
