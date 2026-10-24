export type RecordFolderTarget = { kind: 'project' | 'procurement'; id: string };
export type RecordFolderOutcome =
  | { state: 'already_linked' | 'linked' | 'created'; document_id: string }
  | { state: 'needs_choice' | 'default_unset' | 'missing_identifier' };
export interface EnsureRecordFolderRequest extends RecordFolderTarget {
  action: 'ensure_record_folder';
}
export interface RecordFolderCursor {
  kind: 'project' | 'procurement';
  after: string | null;
  /** The sweep's run id, set by the server on every continuation cursor; echo the cursor back unchanged. */
  run?: string;
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
  unmatched: string[];
  /** Set only when the running summary for `pmo m365 status` could not be saved; the page itself succeeded. */
  summary_warning?: string;
  next: RecordFolderCursor | null;
  stopped?: 'connection' | 'default_changed' | 'unavailable';
  /** Capped whole seconds Microsoft asked us to wait, present only with `stopped: 'unavailable'`. */
  retry_after_seconds?: number;
}

export function sanitizeRecordFolderName(value: string): string {
  // NFC first (an NFD-named folder must match its NFC code), then reserved characters and invisible
  // formatting/separator controls (bidi, zero-width, word joiner, soft hyphen, tag characters, C1, line/paragraph separators) become spaces.
  const replaced = value.normalize('NFC')
    .replace(/["*:<>?\/\\|\u202A-\u202E\u2066-\u2069\u200B-\u200F\uFEFF\u0080-\u009F\u2028\u2029\u2060-\u2064\u00AD\u180E\u061C\u{E0000}-\u{E007F}]/gu, ' ')
    .replace(/^[ .]+|[ .]+$/gu, ' ');
  return Array.from(replaced.trim()).slice(0, 120).join('')
    .replace(/[ .]+$/gu, '').trim()
    // SharePoint refuses a leading "~$" and any "_vti_"; neutralize them so a write never fails on them.
    .replace(/^~\$/u, '~-').replace(/_vti_/giu, '_vti-');
}

const DEVICE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu;

/** The full name a folder is created with: sanitized, and never a bare Windows device name. */
export function safeRecordFolderName(value: string): string {
  const name = sanitizeRecordFolderName(value);
  return DEVICE_NAME.test(name) ? `${name} folder` : name;
}
