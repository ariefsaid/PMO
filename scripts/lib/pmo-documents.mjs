/**
 * pmo-documents.mjs — the pure rules behind `pmo documents create|upload` (#1857).
 *
 * A register entry is one `project_documents` row; its file is a private object in the `project-documents` bucket at
 * {org_id}/{project_id}/{document_id}/{sanitized name}, recorded on the row as `file_path` with `source: upload`. These
 * mirror the app (pmo-portal/src/lib/fileConstants.ts, storageKey.ts, db/documents.ts); scripts/pmo-documents.test.mjs
 * reads the app's lists so the two cannot drift. The database stays the authority: the request guard (0884) admits
 * POST and PATCH on project_documents, and the table's row policy, column grants and triggers decide each write.
 */
import path from 'node:path';

// The seven names every organisation starts with (the app's offline seed, pmo-portal/src/lib/documentCategories.json). Categories are
// the organisation's own since #2579, so this list is NOT a check: the database resolves the name against the organisation's live
// categories (case-insensitively), and an unknown or blank name is filed under Other. It is kept only for the usage hint.
import SEED_CATEGORIES from '../../pmo-portal/src/lib/documentCategories.json' with { type: 'json' };

export const CATEGORY_SEED_HINT = SEED_CATEGORIES.join(', ');
const MAX_CATEGORY_LENGTH = 120;

/** The request-guard tier these commands use — keep in step with the guard's `document_write_tables` (0884). */
export const DOCUMENT_WRITE_TABLES = Object.freeze(['project_documents']);
export const DOCUMENT_BUCKET = 'project-documents';

export const ALLOWED_EXTENSIONS = Object.freeze(['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.docx', '.xlsx', '.pptx', '.dwg', '.dxf', '.csv', '.txt']);
export const DENIED_EXTENSIONS = Object.freeze(['.zip', '.exe', '.bat', '.sh', '.cmd', '.dll', '.msi', '.app']);
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MIME_BY_EXT = Object.freeze({
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.dwg': 'application/acad',
  '.dxf': 'application/dxf',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
});

/** The app's storage-key filename rule (storageKey.ts sanitizeFilename). */
export function sanitizeFilename(original) {
  const replaced = String(original).replace(/\.\./g, '').replace(/[\s_]/g, '-');
  const collapsed = replaced.replace(/[^a-zA-Z0-9.-]/g, '').toLowerCase().replace(/-{2,}/g, '-').replace(/^-|-$/g, '');
  return collapsed.length > 0 ? collapsed : 'file';
}

/** {org_id}/{project_id}/{document_id}/{sanitized name}, from the row the server returned, never from user input alone. */
export function storagePath(orgId, projectId, documentId, fileName) {
  return `${orgId}/${projectId}/${documentId}/${sanitizeFilename(fileName)}`;
}

const isDate = (v) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};
const optional = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * The register entry `documents create` would send, or the problems that stop it. org_id and status are never sent:
 * the column default stamps the caller's org and every entry starts as Draft.
 */
export function planEntry({ project, category, title, code, revision, date }, isUuid) {
  const problems = [];
  if (!project || !isUuid(String(project))) problems.push('--project <uuid> is required');
  if (typeof category !== 'string' || !category.trim()) problems.push('--category is required');
  else if (category.trim().length > MAX_CATEGORY_LENGTH) problems.push(`--category must be at most ${MAX_CATEGORY_LENGTH} characters`);
  if (typeof title !== 'string' || !title.trim()) problems.push('--title is required');
  if (date !== undefined && !isDate(String(date))) problems.push('--date must be a real date, YYYY-MM-DD');
  if (problems.length) return { problems };
  return {
    problems,
    entry: { project_id: project, category: category.trim(), title: title.trim(), code: optional(code), revision: optional(revision), doc_date: optional(date) },
  };
}

/** The file check the app runs before an upload: denied types first, then the allow-list, then the size. */
export function checkFile(name, bytes) {
  const ext = path.extname(name).toLowerCase();
  if (DENIED_EXTENSIONS.includes(ext) || !ALLOWED_EXTENSIONS.includes(ext)) return { problem: `File type not allowed (${ext || 'no extension'}); allowed: ${ALLOWED_EXTENSIONS.join(' ')}` };
  if (bytes > MAX_FILE_BYTES) return { problem: `The file is larger than ${MAX_FILE_BYTES / (1024 * 1024)} MB` };
  return { contentType: MIME_BY_EXT[ext] };
}

/** Why an entry cannot take an upload, as the app refuses it, or null. */
export function uploadRefusal(doc) {
  if (!doc) return { code: 'document_not_found', message: 'Document not found, or you cannot see it.' };
  if (doc.status !== 'Draft') return { code: 'document_not_draft', message: `Only a Draft document takes a file; this one is ${doc.status}.` };
  if (doc.source === 'onedrive') return { code: 'document_has_microsoft_reference', message: 'This document already has a Microsoft reference; unlink it in the app first.' };
  return null;
}

/**
 * The note for a created entry whose category the database did not file as asked (#2579): the name matched none of the organisation's
 * live categories, so the entry sits under Other. Null when it was filed as asked (compared case-insensitively, as the database does).
 */
export function categoryResolutionNote(requested, document) {
  const filed = typeof document?.category === 'string' ? document.category : null;
  if (!filed || String(requested).trim().toLowerCase() === filed.toLowerCase()) return null;
  return `"${String(requested).trim()}" is not one of this organisation's document categories, so the entry was filed under "${filed}". Change its category in the app, or create the category in Administration first.`;
}
