import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { commentRepository } from '@/src/lib/repositories/comments';
import type {
  CommentEntityType,
  CommentInput,
  CommentWithAuthor,
} from '@/src/lib/db/comments';

/** Org-scoped comments list for one project/task. */
export function useComments(entityType: CommentEntityType, entityId: string, options?: { enabled?: boolean }) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<CommentWithAuthor[]>({
    queryKey: ['comments', orgId, entityType, entityId],
    queryFn: () => commentRepository.list(entityType, entityId),
    enabled: Boolean(orgId) && Boolean(entityId) && options?.enabled !== false,
  });
}

export function useCommentMutations(entityType: CommentEntityType, entityId: string) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['comments'] });
  const post = useMutation({
    mutationFn: (input: Pick<CommentInput, 'body' | 'mentions'>) =>
      commentRepository.create({ entityType, entityId, ...input }),
    onSuccess: invalidate,
  });
  const remove = useMutation({ mutationFn: (id: string) => commentRepository.archive(id), onSuccess: invalidate });
  return { post, remove };
}
