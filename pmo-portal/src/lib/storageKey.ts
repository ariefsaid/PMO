/**
 * Storage key sanitization and path construction for the project-documents bucket.
 * Object keys: {org_id}/{project_id}/{document_id}/{sanitized_filename}
 *
 * The DAL fetches the document row (org_id, project_id) server-side and builds
 * the path internally — never from user input alone (FR-DOC-011).
 */

/**
 * Sanitize a user-supplied filename for use as the last segment of a storage key.
 * 1. Strip path-traversal patterns (..)
 * 2. Replace spaces and underscores with hyphens
 * 3. Strip disallowed characters (allow alphanumeric, dots, hyphens)
 * 4. Lowercase the entire result (prevents case-sensitivity collisions)
 * 5. Collapse consecutive hyphens
 * 6. Strip leading/trailing hyphens
 * Returns 'file' if nothing survives.
 */
export function sanitizeFilename(original: string): string {
  // Strip path-traversal patterns
  const noTraversal = original.replace(/\.\./g, '');
  // Replace spaces and underscores with hyphens
  const replaced = noTraversal.replace(/[\s_]/g, '-');
  // Strip disallowed characters (allow alphanumeric, dots, hyphens)
  const stripped = replaced.replace(/[^a-zA-Z0-9.-]/g, '');
  const lower = stripped.toLowerCase();
  const collapsed = lower.replace(/-{2,}/g, '-').replace(/^-|-$/g, '');
  return collapsed.length > 0 ? collapsed : 'file';
}

/**
 * Build the full storage object path for a document file.
 * Pattern: {org_id}/{project_id}/{doc_id}/{sanitized_filename}
 */
export function buildStoragePath(
  orgId: string,
  projectId: string,
  docId: string,
  filename: string,
): string {
  return `${orgId}/${projectId}/${docId}/${sanitizeFilename(filename)}`;
}