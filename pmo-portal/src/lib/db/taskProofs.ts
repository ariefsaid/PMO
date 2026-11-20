import { supabase } from '@/src/lib/supabase/client';
import { AppError, assertWriteLanded } from '@/src/lib/appError';
import { toStorageAppError } from '@/src/lib/storageError';
import { sanitizeFilename } from '@/src/lib/storageKey';
import { SIGNED_URL_EXPIRY_SECONDS } from '@/src/lib/fileConstants';
import type { Tables } from '@/src/lib/supabase/database.types';

/**
 * Proof of completion (#2531, migration 0991): photo or document attachments on a task.
 * Private `task-proofs` bucket, path {org}/{task_id}/{proof_id}/{filename}. org_id is never sent from the client
 * (the trigger stamps it from the task); removal is a soft archive (ADR-0018). RLS + triggers are the authority:
 * the Done guard, the 10-per-task cap and "append-only once Done" are enforced in the database.
 */
export type TaskProofRow = Tables<'task_proofs'>;

export const PROOF_MAX_COUNT = 10;
export const PROOF_MAX_BYTES = 15 * 1024 * 1024;
export const PROOF_ALLOWED_MIME = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
] as const;

export type ProofRefusal = 'count' | 'size' | 'type';

/** FR-TWOP-015 / AC-TWOP-012: why a file may not be attached (null = fine). Mirrors the bucket and the DB cap. */
export function proofRefusal(file: { size: number; type: string }, liveCount: number): ProofRefusal | null {
  if (liveCount >= PROOF_MAX_COUNT) return 'count';
  if (file.size > PROOF_MAX_BYTES) return 'size';
  if (!(PROOF_ALLOWED_MIME as readonly string[]).includes(file.type)) return 'type';
  return null;
}

export function buildProofPath(orgId: string, taskId: string, proofId: string, filename: string): string {
  return `${orgId}/${taskId}/${proofId}/${sanitizeFilename(filename)}`;
}

/** Live (not removed) proofs of a task, newest first. RLS scopes rows. */
export async function listTaskProofs(taskId: string): Promise<TaskProofRow[]> {
  const { data, error } = await supabase
    .from('task_proofs')
    .select('*')
    .eq('task_id', taskId)
    .is('archived_at', null)
    .order('created_at', { ascending: false })
    .limit(PROOF_MAX_COUNT); // bounded: the DB caps live proofs at 10 per task
  if (error) throw new AppError(error.message, error.code);
  return (data ?? []) as TaskProofRow[];
}

/**
 * Upload the file, then record it. The org segment of the path comes from the task row (never from the caller).
 * Refuses a file the bucket or cap would refuse, before any network write.
 */
export async function addTaskProof(taskId: string, file: File, liveCount: number): Promise<TaskProofRow> {
  const refusal = proofRefusal(file, liveCount);
  if (refusal) throw new AppError(`proof refused: ${refusal}`, 'proof-' + refusal);
  const { data: task, error: taskErr } = await supabase.from('tasks').select('org_id').eq('id', taskId).maybeSingle();
  if (taskErr) throw new AppError(taskErr.message, taskErr.code);
  if (!task) throw new AppError('Task not found or you do not have permission to attach proof.', '42501');
  const proofId = crypto.randomUUID();
  const path = buildProofPath((task as { org_id: string }).org_id, taskId, proofId, file.name);
  const up = await supabase.storage.from('task-proofs').upload(path, file, { contentType: file.type, upsert: false });
  if (up.error) throw toStorageAppError(up.error);
  const { data, error } = await supabase
    .from('task_proofs')
    .insert({ id: proofId, task_id: taskId, file_path: path, file_name: file.name })
    .select()
    .single();
  if (error) {
    // Best effort: do not leave an orphan object behind a refused row.
    await supabase.storage.from('task-proofs').remove([path]);
    throw new AppError(error.message, error.code);
  }
  return data as TaskProofRow;
}

/** Remove a proof (soft archive). Refused by the database while the task is Done and requires proof. */
export async function removeTaskProof(proofId: string): Promise<void> {
  const { data, error } = await supabase
    .from('task_proofs')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', proofId)
    .select('id');
  if (error) throw new AppError(error.message, error.code);
  assertWriteLanded(data, 'Proof not found or you do not have permission to remove it.');
}

/** A short-lived signed URL to view a proof. */
export async function getTaskProofUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from('task-proofs').createSignedUrl(path, SIGNED_URL_EXPIRY_SECONDS);
  if (error) throw toStorageAppError(error);
  return data.signedUrl;
}
