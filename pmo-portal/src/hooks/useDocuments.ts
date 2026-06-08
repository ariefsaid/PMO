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
 * scoped to the project so each project's register caches independently; disabled
 * until a projectId is present. org_id is never sent (RLS scopes rows).
 */
export function useDocuments(projectId: string) {
  return useQuery<ProjectDocumentRow[]>({
    queryKey: ['project-documents', projectId],
    queryFn: () => repositories.document.list(projectId),
    enabled: Boolean(projectId),
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
 * seam, scoped to one project. Each invalidates the project's `['project-documents',
 * projectId]` query on success so the register refetches. `create` stamps the CURRENT
 * USER id as `author_id` (never supplied by the form) — the basis for the approver-≠-author
 * SoD on the status workflow. Errors propagate as `AppError` (code preserved) for the
 * caller to classify via `classifyMutationError`.
 */
export function useDocumentMutations(projectId: string) {
  const qc = useQueryClient();
  const { currentUser } = useAuth();
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ['project-documents', projectId] });

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
