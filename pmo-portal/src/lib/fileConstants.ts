/**
 * Shared client file constraints (OD-DOC-5). Bucket limits are configured separately
 * in the storage migration and must remain aligned with the upload rules.
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

/** Explicit denylist enforced before the allowlist. FR-DOC-033. */
export const DENIED_EXTENSIONS: readonly string[] = [
  '.zip', '.exe', '.bat', '.sh', '.cmd', '.dll', '.msi', '.app',
] as const;

/** Signed URL expiry in seconds (60 minutes). NFR-DOC-003 / FR-DOC-013. */
export const SIGNED_URL_EXPIRY_SECONDS = 3600;

/**
 * Extensions the in-app document viewer can show (preview only; upload acceptance is `ALLOWED_FILE_TYPES`).
 * Legacy Word/Excel/PowerPoint are best effort through Microsoft's public viewer.
 */
export const VIEWABLE_EXTENSIONS: readonly string[] = [
  '.pdf', '.png', '.jpg', '.jpeg', '.webp',
  '.docx', '.xlsx', '.pptx', '.doc', '.xls', '.ppt',
] as const;

/** The `accept` attribute string for the file input. */
export const FILE_INPUT_ACCEPT = ALLOWED_FILE_TYPES.join(',');