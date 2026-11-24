import { useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import type { CategoryRole, DocumentCategory } from '@/src/lib/db/documentCategories';
import { useOptionalRealRole } from '@/src/auth/impersonation';
import { viewableCategories } from '@/src/lib/documentCategories';
import { useOrgQuery } from '@/src/hooks/useOrgQuery';

/** Org-scoped key so the cache never bleeds across tenants (defence in depth; RLS is the authority). */
export const DOCUMENT_CATEGORIES_KEY = ['document-categories'] as const;

/** The organisation's categories with their viewer roles (#2579). Any active member may read the list; the documents are what is gated. */
export function useDocumentCategories() {
  return useOrgQuery<DocumentCategory[]>([...DOCUMENT_CATEGORIES_KEY], () => repositories.documentCategory.list(), { staleness: 'live' });
}

/**
 * The categories the caller's REAL role may file into (FR-DCV-017); the database decides, this keeps the form's list honest.
 * `keepId` keeps the category an edited document already holds, even if archived. Empty until the list loads.
 */
export function useViewableCategories(keepId?: string) {
  const realRole = useOptionalRealRole();
  const { data } = useDocumentCategories();
  return useMemo(() => (data ? viewableCategories(data, realRole, keepId) : []), [data, realRole, keepId]);
}

/** The Admin management writes. Every one refreshes the category list; a rename or re-file also refreshes the registers. */
export function useDocumentCategoryMutations() {
  const qc = useQueryClient();
  const refresh = () => Promise.all([
    qc.invalidateQueries({ queryKey: DOCUMENT_CATEGORIES_KEY }),
    qc.invalidateQueries({ queryKey: ['project-documents'] }),
  ]);
  const repo = repositories.documentCategory;
  return {
    create: useMutation({ mutationFn: (v: { name: string; roles: CategoryRole[] }) => repo.create(v.name, v.roles), onSuccess: refresh }),
    rename: useMutation({ mutationFn: (v: { id: string; name: string }) => repo.rename(v.id, v.name), onSuccess: refresh }),
    /** Role access and hidden job roles in one save (both or neither). */
    setAccess: useMutation({ mutationFn: (v: { id: string; roles: CategoryRole[]; keys: string[] }) => repo.setAccess(v.id, v.roles, v.keys), onSuccess: refresh }),
    archive: useMutation({ mutationFn: (id: string) => repo.archive(id), onSuccess: refresh }),
    restore: useMutation({ mutationFn: (id: string) => repo.restore(id), onSuccess: refresh }),
    reorder: useMutation({ mutationFn: (ids: string[]) => repo.reorder(ids), onSuccess: refresh }),
  };
}
