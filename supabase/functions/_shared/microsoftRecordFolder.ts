export type RecordFolderTarget = { kind: 'project' | 'procurement'; id: string };
export type RecordFolderOutcome =
  | { state: 'already_linked' | 'linked' | 'created'; document_id: string }
  | { state: 'needs_choice' | 'not_found' | 'default_unset' | 'missing_identifier' };
export interface EnsureRecordFolderRequest extends RecordFolderTarget {
  action: 'ensure_record_folder';
}
export interface RecordFolderCursor {
  kind: 'project' | 'procurement';
  after: string | null;
}
export interface RecordFolderBackfillRequest {
  action: 'link_existing_record_folders';
  cursor?: RecordFolderCursor;
}
export interface RecordFolderBackfillPage {
  scanned: number;
  linked: number;
  needs_choice: number;
  missing: number;
  failed: number;
  skipped: number;
  next: RecordFolderCursor | null;
  stopped?: 'connection' | 'default_changed' | 'unavailable';
}

export function sanitizeRecordFolderName(value: string): string {
  const replaced = value.replace(/["*:<>?\/\\|]/gu, ' ')
    .replace(/^[ .]+|[ .]+$/gu, ' ');
  return Array.from(replaced.trim()).slice(0, 120).join('')
    .replace(/[ .]+$/gu, '').trim();
}
