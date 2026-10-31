import { supabase } from '@/src/lib/supabase/client';
import { invokeWithTimeout } from '@/src/lib/supabase/invokeWithTimeout';
import { validateFile } from '@/src/lib/validateFile';
import { parseInvokeFailure } from './previewClient';
import { assertMicrosoftReference, type MicrosoftReferenceInput } from './reference';
import type { UploadRecordFileTarget } from '../../../../supabase/functions/_shared/microsoftDocumentPreview';

export type { UploadRecordFileTarget } from '../../../../supabase/functions/_shared/microsoftDocumentPreview';

const FUNCTION_NAME = 'm365-token-custody';
/** The custody request deadline is 30 s; the client gives it a little longer so the server's own answer wins. */
const UPLOAD_TIMEOUT_MS = 35_000;

/** Why a SharePoint upload did not happen. Every kind means: nothing was saved in PMO and nothing was swapped. */
export type UploadFailureKind =
  | 'invalid' // the file failed the client preflight (size or type)
  | 'folder' // the record has no SharePoint folder yet
  | 'consent' // Sites.Selected consent is missing: reconnect
  | 'connection' // no usable Microsoft connection
  | 'access' // Microsoft refused the caller on the folder
  | 'entitlement' // the organisation is not entitled to Microsoft documents
  | 'cancelled'
  | 'unavailable';

export class UploadFailure extends Error {
  readonly kind: UploadFailureKind;
  constructor(kind: UploadFailureKind, message?: string) {
    super(message ?? kind);
    this.name = 'UploadFailure';
    this.kind = kind;
  }
}

const KIND_BY_CODE: Record<string, UploadFailureKind> = {
  RECORD_FOLDER_UNAVAILABLE: 'folder',
  SCOPE_INSUFFICIENT: 'consent',
  NOT_CONNECTED: 'connection',
  CONNECTION_STALE: 'connection',
  CONNECTION_REVOKED: 'connection',
  SOURCE_ACCESS_DENIED: 'access',
  NOT_ENTITLED: 'entitlement',
};

function formFor(target: UploadRecordFileTarget, file: File): FormData {
  const form = new FormData();
  form.append('action', 'upload_record_file');
  form.append('target_kind', target.kind);
  if (target.kind === 'project_document') {
    form.append('target_id', target.id);
  } else {
    form.append('phase', target.phase);
    form.append('parent_id', target.parent_id);
  }
  form.append('file', file);
  return form;
}

/**
 * Store one file in the record's SharePoint folder through custody (the caller's own connection, the
 * org default library) and return the Microsoft reference to persist. Custody never writes PMO tables:
 * the caller persists the reference through the repositories, so RLS and the Draft guards stay the authority.
 */
export async function uploadRecordFile(
  target: UploadRecordFileTarget,
  file: File,
  signal?: AbortSignal,
): Promise<MicrosoftReferenceInput> {
  if (!validateFile(file).ok) throw new UploadFailure('invalid');
  const { data, error } = await invokeWithTimeout(
    supabase.functions.invoke<{ reference: unknown }>(FUNCTION_NAME, { body: formFor(target, file), signal }),
    UPLOAD_TIMEOUT_MS,
  );
  if (signal?.aborted) throw new UploadFailure('cancelled');
  if (error) {
    const { code } = await parseInvokeFailure(error);
    throw new UploadFailure((code && KIND_BY_CODE[code]) || 'unavailable');
  }
  const reference = data?.reference;
  try {
    assertMicrosoftReference(reference);
  } catch {
    throw new UploadFailure('unavailable');
  }
  if (reference.item_kind !== 'file') throw new UploadFailure('unavailable');
  return reference;
}
