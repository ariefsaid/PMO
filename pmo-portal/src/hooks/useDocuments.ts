import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import type {
  ProjectDocumentRow,
  ProjectDocumentInput,
  DocStatus,
} from '@/src/lib/db/documents';
import { useAuth } from '@/src/auth/useAuth';

/**
 * Per-project document register over the repository seam (ADR-0017). queryKey is
 * org-scoped (orgId first) so cache is tenant-scoped — prevents cross-org bleed on
 * impersonation / account-switch (defence-in-depth; RLS is the enforcement authority).
 * Disabled until both orgId and projectId are present.
 */
export function useDocuments(projectId: string) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<ProjectDocumentRow[]>({
    queryKey: ['project-documents', orgId, projectId],
    queryFn: () => repositories.document.list(projectId),
    enabled: Boolean(orgId && projectId),
  });
}

/**
 * Fetch the child (successor) document for lineage display.
 * Returns null when no child exists or the parent has no children.
 * Key is org-scoped to prevent cross-org cache bleed.
 */
export function useChildDocument(parentId: string | null) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<ProjectDocumentRow | null>({
    queryKey: ['project-document-child', orgId, parentId],
    queryFn: () => parentId ? repositories.document.getChild(parentId) : Promise.resolve(null),
    enabled: Boolean(orgId && parentId),
  });
}

export interface UpdateDocumentArgs {
  id: string;
  input: ProjectDocumentInput;
}

export interface TransitionDocumentArgs {
  id: string;
  status: DocStatus;
}

/**
 * Document create / update / status-transition / delete mutations over the repository
 * seam, scoped to one project. Each invalidates the project's org-scoped
 * `['project-documents', orgId, projectId]` query on success so the register refetches.
 * `create` stamps the CURRENT USER id as `author_id` (never supplied by the form) —
 * the basis for the approver-≠-author SoD on the status workflow. Errors propagate as
 * `AppError` (code preserved) for the caller to classify via `classifyMutationError`.
 */
export function useDocumentMutations(projectId: string) {
  const qc = useQueryClient();
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ['project-documents', orgId, projectId] });

  const create = useMutation({
    mutationFn: (input: ProjectDocumentInput) =>
      repositories.document.create(projectId, input, currentUser?.id ?? null),
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: ({ id, input }: UpdateDocumentArgs) => repositories.document.update(id, input),
    onSuccess: invalidate,
  });

  const transition = useMutation({
    mutationFn: ({ id, status }: TransitionDocumentArgs) =>
      repositories.document.transition(id, status),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => repositories.document.delete(id),
    onSuccess: invalidate,
  });

  return { create, update, transition, remove };
}
