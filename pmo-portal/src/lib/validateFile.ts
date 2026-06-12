import { ALLOWED_FILE_TYPES, MAX_FILE_SIZE_BYTES, MAX_FILE_SIZE_MB } from './fileConstants';

export interface ValidationResult {
  ok: boolean;
  message?: string;
}

/**
 * Client-side preflight validation for document uploads.
 * Uses the shared file constants so the UI and storage bucket stay aligned.
 */
export function validateFile(file: File): ValidationResult {
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { ok: false, message: `File exceeds ${MAX_FILE_SIZE_MB} MB limit` };
  }

  const ext = `.${file.name.split('.').pop()?.toLowerCase() ?? ''}`;
  if (!ALLOWED_FILE_TYPES.includes(ext)) {
    return { ok: false, message: `File type not allowed (${ext})` };
  }

  return { ok: true };
}
