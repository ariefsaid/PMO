/** Comment repository implementation. */
import { listComments, createComment, archiveComment } from '@/src/lib/db/comments';
import { wrap } from './repositoryErrors';
import type { CommentRepository } from './contracts/comments';

export const commentRepository: CommentRepository = {
  list: (entityType, entityId) => wrap(() => listComments(entityType, entityId)),
  create: (input) => wrap(() => createComment(input)),
  archive: (id) => wrap(() => archiveComment(id)),
};
