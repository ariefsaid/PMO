import { useMutation, useQueryClient } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import { useAuth } from '@/src/auth/useAuth';

/**
 * Revision creation mutation for the project-documents register.
 * Invalidates the project's document list on success.
 */

export interface CreateRevisionArgs {
  parentId: string;
  title: string;
  code: string;
  category: string;
  revision: string;
  doc_date: string;
}

export function useRevision(projectId: string) {
  const qc = useQueryClient();
  const { currentUser } = useAuth();

  const createRevision = useMutation({
    mutationFn: (args: CreateRevisionArgs) =>
      repositories.document.createRevision(args.parentId, args, currentUser?.id ?? null),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project-documents', projectId] });
    },
  });

  return { createRevision };
}