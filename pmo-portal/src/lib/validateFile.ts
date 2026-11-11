import {
  ALLOWED_FILE_TYPES,
  DENIED_EXTENSIONS,
  MAX_FILE_SIZE_BYTES,
  MAX_FILE_SIZE_MB,
} from './fileConstants';

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
  if (DENIED_EXTENSIONS.includes(ext)) {
    return { ok: false, message: `File type not allowed (${ext})` };
  }
  if (!ALLOWED_FILE_TYPES.includes(ext)) {
    return { ok: false, message: `File type not allowed (${ext})` };
  }

  return { ok: true };
}

const ZIP = [0x50, 0x4b, 0x03, 0x04];
const JPEG = [0xff, 0xd8, 0xff];

/** Leading bytes each checked type must start with, keyed by extension. Types not listed rely on the name check alone. */
const SIGNATURES: Record<string, readonly number[]> = {
  '.pdf': [0x25, 0x50, 0x44, 0x46, 0x2d],
  '.png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  '.jpg': JPEG,
  '.jpeg': JPEG,
  '.docx': ZIP,
  '.xlsx': ZIP,
  '.pptx': ZIP,
};

/**
 * Content-type check: a file whose leading bytes do not match its extension (e.g. a renamed
 * executable) is rejected. Complements the name-based `validateFile`.
 */
export async function validateFileSignature(file: File): Promise<ValidationResult> {
  const ext = `.${file.name.split('.').pop()?.toLowerCase() ?? ''}`;
  const signature = SIGNATURES[ext];
  if (!signature) return { ok: true };

  const head = new Uint8Array(await file.slice(0, signature.length).arrayBuffer());
  if (head.length < signature.length || signature.some((byte, i) => head[i] !== byte)) {
    return { ok: false, message: 'File content does not match its type' };
  }
  return { ok: true };
}
