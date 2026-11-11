/** Comment repository contract (live comments on a project or task). */
import type { CommentEntityType, CommentInput, CommentWithAuthor } from '@/src/lib/db/comments';

export interface CommentRepository {
  /** Live comments on one record, oldest first. */
  list(entityType: CommentEntityType, entityId: string): Promise<CommentWithAuthor[]>;
  /** Post a comment; org_id/author are server-stamped, never sent. */
  create(input: CommentInput): Promise<void>;
  /** Soft-delete a comment (author only at the RLS layer). */
  archive(id: string): Promise<void>;
}
