import { useMutation, useQueryClient } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import { useAuth } from '@/src/auth/useAuth';
import type { MicrosoftReferenceInput } from '@/src/lib/m365/reference';

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
  /** Latest Microsoft file to reference on the new child Draft; never inherits the parent's pin. */
  microsoft?: MicrosoftReferenceInput;
}

export function useRevision(projectId: string) {
  const qc = useQueryClient();
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;

  const createRevision = useMutation({
    mutationFn: (args: CreateRevisionArgs) =>
      repositories.document.createRevision(args.parentId, args, currentUser?.id ?? null, args.microsoft),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project-documents', orgId, projectId] });
    },
  });

  return { createRevision };
}