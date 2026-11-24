import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import type { Enums } from '@/src/lib/supabase/database.types';
import { fetchAllPages } from '@/src/lib/pagedRead';

/**
 * Document categories DAL (#2579, migrations 1090-1093). Reads are the two category tables (any active member of the
 * organisation); every write is one of the Admin management functions, which re-assert the role in the database.
 * org_id is never sent.
 */
export type CategoryRole = Enums<'user_role'>;

export interface DocumentCategory {
  id: string;
  name: string;
  is_system: boolean;
  sort_order: number;
  archived_at: string | null;
  /** The viewer roles. Admin is always present. */
  roles: CategoryRole[];
  /** Job role keys that never see the category, whatever their access level (2047). Never the Administrator. */
  hidden_job_roles?: string[];
}

function fail(error: { message: string; code?: string; details?: string }): never { throw new AppError(error.message, error.code, error.details); }

export async function listDocumentCategories(): Promise<DocumentCategory[]> {
  // Both lists have no provable ceiling (an organisation adds categories and viewer roles), so both are paged rather
  // than silently truncated at PostgREST's 1000-row cap.
  const [cats, roles] = await Promise.all([
    fetchAllPages((f, t) => supabase.from('document_categories').select('id, name, is_system, sort_order, archived_at, hidden_job_roles')
      .order('sort_order', { ascending: true }).order('name', { ascending: true }).order('id', { ascending: true }).range(f, t)),
    fetchAllPages((f, t) => supabase.from('document_category_roles').select('category_id, role')
      .order('category_id', { ascending: true }).order('role', { ascending: true }).range(f, t)),
  ]);
  const byCategory = new Map<string, CategoryRole[]>();
  for (const r of roles) byCategory.set(r.category_id, [...(byCategory.get(r.category_id) ?? []), r.role]);
  return cats.map((c) => ({ ...c, roles: byCategory.get(c.id) ?? [] }));
}

export async function createCategory(name: string, roles: CategoryRole[]): Promise<string> {
  const { data, error } = await supabase.rpc('create_document_category', { p_name: name.trim(), p_roles: roles });
  if (error) fail(error);
  return data;
}
export async function renameCategory(id: string, name: string): Promise<void> {
  const { error } = await supabase.rpc('rename_document_category', { p_id: id, p_name: name.trim() });
  if (error) fail(error);
}
/** Replaces the whole set in one step; the database refuses a set without Admin. */
/** Role access and hidden job roles in one Admin-only save (2049): both change or neither does. */
export async function setCategoryAccess(id: string, roles: CategoryRole[], hiddenJobRoles: string[]): Promise<void> {
  const { error } = await supabase.rpc('set_document_category_access', { p_id: id, p_roles: roles, p_hidden_job_roles: hiddenJobRoles });
  if (error) fail(error);
}

export async function archiveCategory(id: string): Promise<void> {
  const { error } = await supabase.rpc('archive_document_category', { p_id: id });
  if (error) fail(error);
}
export async function restoreCategory(id: string): Promise<void> {
  const { error } = await supabase.rpc('restore_document_category', { p_id: id });
  if (error) fail(error);
}
export async function reorderCategories(ids: string[]): Promise<void> {
  const { error } = await supabase.rpc('reorder_document_categories', { p_ids: ids });
  if (error) fail(error);
}
/** Moves the whole revision lineage of a document; resolves to the number of documents moved. */
export async function refileLineage(documentId: string, categoryId: string): Promise<number> {
  const { data, error } = await supabase.rpc('refile_document_lineage', { p_document_id: documentId, p_category_id: categoryId });
  if (error) fail(error);
  return data;
}
