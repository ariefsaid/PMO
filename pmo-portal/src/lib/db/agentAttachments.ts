import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import {
  AGENT_ATTACHMENT_MAX_BYTES,
  ALLOWED_AGENT_ATTACHMENT_MIME,
  getAgentAttachmentContentType,
} from '@/src/lib/agent/attachmentMime';
import type { Tables } from '@/src/lib/supabase/database.types';

const BUCKET = 'agent-attachments';

export type AgentAttachmentRow = Tables<'agent_attachments'>;

interface PostgrestErrorLike {
  message: string;
  code?: string;
}

export interface PrepareAgentAttachmentUploadInput {
  threadId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface PreparedAgentAttachmentUpload {
  attachmentId: string;
  signedUrl: string;
  path: string;
}

function throwWrite(error: PostgrestErrorLike): never {
  throw new AppError(error.message, error.code);
}

function validateAttachmentUpload(input: PrepareAgentAttachmentUploadInput): void {
  if (!ALLOWED_AGENT_ATTACHMENT_MIME.includes(input.mimeType as never)) {
    throw new AppError('File type not allowed', 'P0001');
  }
  if (input.sizeBytes <= 0 || input.sizeBytes > AGENT_ATTACHMENT_MAX_BYTES) {
    throw new AppError('File exceeds 8 MB limit', 'P0001');
  }
}

/**
 * Prepare a per-conversation attachment upload.
 *
 * Creates the RLS-scoped metadata row first so the Storage policy can verify
 * the signed-upload object's path against an owner-private `agent_attachments`
 * row. org_id/owner_id/storage_path are stamped by the database trigger and
 * policy; the client supplies only thread + file metadata.
 */
export async function prepareAgentAttachmentUpload(
  input: PrepareAgentAttachmentUploadInput,
): Promise<PreparedAgentAttachmentUpload> {
  validateAttachmentUpload(input);

  // storage_path has no SQL DEFAULT (only a `before insert` trigger stamps it,
  // 0060_agent_attachments.sql), so the generated Insert type marks it required
  // even though the client must never supply it — the trigger derives it from
  // org_id/id and the INSERT policy would reject a client-supplied value.
  const { data: row, error: insertError } = await supabase
    .from('agent_attachments')
    .insert({
      thread_id: input.threadId,
      mime_type: input.mimeType,
      size_bytes: input.sizeBytes,
      original_filename: input.fileName,
    } as never)
    .select('id, storage_path')
    .single();
  if (insertError) throwWrite(insertError);
  if (!row?.id || !row.storage_path) throw new AppError('Could not prepare attachment upload');

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(row.storage_path);
  if (error) throwWrite({ message: error.message, code: error.name === 'StorageError' ? '42501' : undefined });
  if (!data?.signedUrl) throw new AppError('Could not create upload URL');

  return {
    attachmentId: row.id,
    signedUrl: data.signedUrl,
    path: data.path,
  };
}

export async function prepareAgentAttachmentFileUpload(
  threadId: string,
  file: File,
): Promise<PreparedAgentAttachmentUpload> {
  const mimeType = getAgentAttachmentContentType(file) ?? file.type;
  return prepareAgentAttachmentUpload({
    threadId,
    fileName: file.name,
    mimeType,
    sizeBytes: file.size,
  });
}

/**
 * Mark the prepared row as ready for resolver pickup after the object upload
 * succeeds. Text extraction remains pending until the edge resolver processes it.
 */
export async function confirmAgentAttachmentUpload(attachmentId: string): Promise<void> {
  const { error } = await supabase
    .from('agent_attachments')
    .update({ extracted_text_status: 'pending', archived_at: null })
    .eq('id', attachmentId);
  if (error) throwWrite(error);
}

/**
 * Best-effort cleanup for prepared/uploaded attachment objects. The storage
 * remove is non-fatal; the metadata row is soft-archived so a failed upload
 * cannot later be resolved by the deputy.
 */
export async function cleanupAgentAttachmentObject(path: string): Promise<void> {
  if (!path) return;
  await supabase.storage.from(BUCKET).remove([path]);
  const { error } = await supabase
    .from('agent_attachments')
    .update({ archived_at: new Date().toISOString() })
    .eq('storage_path', path);
  if (error) throwWrite(error);
}
