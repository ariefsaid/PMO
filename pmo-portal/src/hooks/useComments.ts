import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { repositories } from '@/src/lib/repositories';
import type {
  CommentEntityType,
  CommentInput,
  CommentWithAuthor,
} from '@/src/lib/db/comments';

/** Org-scoped comments list for one project/task. */
export function useComments(entityType: CommentEntityType, entityId: string) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<CommentWithAuthor[]>({
    queryKey: ['comments', orgId, entityType, entityId],
    queryFn: () => repositories.comment.list(entityType, entityId),
    enabled: Boolean(orgId) && Boolean(entityId),
  });
}

export function useCommentMutations(entityType: CommentEntityType, entityId: string) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['comments'] });
  const post = useMutation({
    mutationFn: (input: Pick<CommentInput, 'body' | 'mentions'>) =>
      repositories.comment.create({ entityType, entityId, ...input }),
    onSuccess: invalidate,
  });
  const remove = useMutation({ mutationFn: (id: string) => repositories.comment.archive(id), onSuccess: invalidate });
  return { post, remove };
}
