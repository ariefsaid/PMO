/**
 * Shared file constraints — single source of truth for client + server (OD-DOC-5).
 * The bucket's `file_size_limit` and `allowed_mime_types` in the migration (0025)
 * mirror these values. Changing the cap/type requires changing this constant AND
 * the bucket setting (a migration).
 */

/** Maximum file size in bytes (5 MB). NFR-DOC-001. */
export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

/** Human-readable MB value for error messages. */
export const MAX_FILE_SIZE_MB = MAX_FILE_SIZE_BYTES / (1024 * 1024);

/** Allowed file extensions (lowercase, dot-prefixed). OD-DOC-5 / FR-DOC-031. */
export const ALLOWED_FILE_TYPES: readonly string[] = [
  '.pdf', '.png', '.jpg', '.jpeg', '.webp',
  '.docx', '.xlsx', '.pptx',
  '.dwg', '.dxf',
  '.csv', '.txt',
] as const;

/**
 * MIME types matching the bucket's `allowed_mime_types` (migration 0025).
 * Used for server-side bucket enforcement (defense-in-depth) and pgTAP reference.
 * NOTE: application/octet-stream is intentionally absent — browsers report CAD files
 * as octet-stream, which must NOT be in the bucket list. Use FILE_MIME_BY_EXT for
 * the explicit Content-Type on upload.
 */
export const ALLOWED_MIME_TYPES: readonly string[] = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/vnd.dxf',
  'application/dxf',
  'application/acad',
  'text/csv',
  'text/plain',
] as const;

/**
 * Extension → MIME type map. Used by the DAL to set Content-Type explicitly when
 * creating signed upload URLs. Browsers report CAD/DWG files as application/octet-stream,
 * which the bucket would reject. This map overrides the browser's guess.
 */
export const FILE_MIME_BY_EXT: Record<string, string> = {
  '.pdf':  'application/pdf',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.dwg':  'application/acad',
  '.dxf':  'application/dxf',
  '.csv':  'text/csv',
  '.txt':  'text/plain',
};

/** Signed URL expiry in seconds (60 minutes). NFR-DOC-003 / FR-DOC-013. */
export const SIGNED_URL_EXPIRY_SECONDS = 3600;

/** Extensions that can be previewed in a new browser tab. FR-DOC-042. */
export const PREVIEWABLE_EXTENSIONS: readonly string[] = [
  '.pdf', '.png', '.jpg', '.jpeg', '.webp',
] as const;

/** The `accept` attribute string for the file input. */
export const FILE_INPUT_ACCEPT = ALLOWED_FILE_TYPES.join(',');