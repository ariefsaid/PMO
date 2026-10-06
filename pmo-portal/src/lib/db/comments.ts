import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import type { Tables } from '@/src/lib/supabase/database.types';

export type CommentEntityType = 'project' | 'task';
export type CommentRow = Tables<'comments'>;
/** A comment joined with its author's display name. */
export type CommentWithAuthor = CommentRow & { author: { id: string; full_name: string } | null };

export interface CommentInput {
  entityType: CommentEntityType;
  entityId: string;
  body: string;
  mentions: string[];
}

/**
 * Live comments on one record, oldest first (newest last). Archived (soft-deleted) rows are filtered
 * here. org_id is never sent — RLS scopes to readers of the parent; author_id defaults to the caller.
 */
export async function listComments(
  entityType: CommentEntityType,
  entityId: string,
): Promise<CommentWithAuthor[]> {
  const { data, error } = await supabase
    .from('comments')
    .select('*, author:profiles!comments_author_id_fkey(id, full_name)')
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .is('archived_at', null)
    .order('created_at', { ascending: true });
  if (error) throw new AppError(error.message, error.code);
  return (data ?? []) as CommentWithAuthor[];
}

export async function createComment(input: CommentInput): Promise<void> {
  const { error } = await supabase.from('comments').insert({
    entity_type: input.entityType,
    entity_id: input.entityId,
    body: input.body.trim(),
    mentions: input.mentions,
  });
  if (error) throw new AppError(error.message, error.code);
}

/** Soft delete (author only — RLS). A 0-row result means RLS refused it. */
export async function archiveComment(id: string): Promise<void> {
  const { data, error } = await supabase
    .from('comments')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id)
    .select('id');
  if (error) throw new AppError(error.message, error.code);
  if (!data || data.length === 0) throw new AppError('Comment could not be deleted', '42501');
}
