/**
 * The labour anchors (FR-OLH-012, FR-OLH-022). Same mechanism as `purchase/anchors.ts` (`ir.model.data`, module `pmo`);
 * a separate key family so no probe can ever adopt a purchase document, and vice versa. Bed claim V-OLH-6 (still an
 * assumption behind the plan's fake): an `ir.model.data` row with `module='pmo'` can be created by the integration user
 * on `account.analytic.line` and `account.move`, and survives an edit of the anchored record.
 *
 * Two families:
 * - `lbl:<timesheet>:<project>:<YYYYMMDD>` — one line per (timesheet, project, entry date), immutable, so a second push
 *   adopts the line it already made instead of creating another (AC-OLH-022).
 * - `lcost:<batch>:<revision>` — one journal entry per labour-cost batch revision (D7): a lost answer is adopted, never
 *   re-posted.
 */
import { isIsoDate } from './bodies.ts';

const U8 = '[0-9a-f]{8}';
const U4 = '[0-9a-f]{4}';
const U12 = '[0-9a-f]{12}';
const uuid = `${U8}-${U4}-${U4}-${U4}-${U12}`;
const UUID_RE = new RegExp(`^${uuid}$`, 'i');

export const LABOUR_LINE_KEY_RE = new RegExp(`^lbl:${uuid}:${uuid}:(\\d{8})$`, 'i');
export const LABOUR_COST_KEY_RE = new RegExp(`^lcost:${uuid}:[1-9][0-9]*$`, 'i');
const LINE_NAME_RE = new RegExp(`^lbl_(${U8})_(${U4})_(${U4})_(${U4})_(${U12})_(${U8})_(${U4})_(${U4})_(${U4})_(${U12})_(\\d{8})$`, 'i');
const COST_NAME_RE = new RegExp(`^lcost_(${U8})_(${U4})_(${U4})_(${U4})_(${U12})_([1-9][0-9]*)$`, 'i');

const dotted = (parts: readonly string[]) => `${parts[0]}-${parts[1]}-${parts[2]}-${parts[3]}-${parts[4]}`;
const compact = (date: string) => date.replace(/-/g, '');
const dashed = (compactDate: string) => `${compactDate.slice(0, 4)}-${compactDate.slice(4, 6)}-${compactDate.slice(6, 8)}`;

/** The immutable key of one Odoo hours line. A malformed uuid or a day that does not exist is a programming error. */
export function labourLineKey(timesheetId: string, projectId: string, date: string): string {
  if (!UUID_RE.test(timesheetId) || !UUID_RE.test(projectId)) throw new Error('Invalid labour line key');
  if (!isIsoDate(date)) throw new Error('Invalid labour line date');
  // Postgres uuids are lower case; folding here keeps a differently-cased id on the one anchor instead of keying it twice.
  return `lbl:${timesheetId.toLowerCase()}:${projectId.toLowerCase()}:${compact(date)}`;
}

/** The immutable key of one labour-cost batch revision (revisions start at 1, D7). */
export function labourCostKey(batchId: string, revision: number): string {
  if (!UUID_RE.test(batchId) || !Number.isSafeInteger(revision) || revision < 1) throw new Error('Invalid labour cost key');
  return `lcost:${batchId.toLowerCase()}:${revision}`;
}

/** The `ir.model.data` row that anchors a document: `name` carries the key with every non-alphanumeric replaced (V-OLH-6). */
export function labourExternalIdentifier(key: string): { module: 'pmo'; name: string } {
  if (!LABOUR_LINE_KEY_RE.test(key) && !LABOUR_COST_KEY_RE.test(key)) throw new Error('Invalid labour key');
  return { module: 'pmo', name: key.replace(/[^a-zA-Z0-9_]/g, '_') };
}

/**
 * The line key a normalised identifier name was made from, or null for any other name (a purchase `po_…` included).
 * Only a lossless name is recovered: the sweep uses it to tell an anchored labour line from one an Odoo user created.
 */
export function parseLabourLineKey(name: string): string | null {
  const m = LINE_NAME_RE.exec(name);
  if (!m) return null;
  const date = dashed(m[11]);
  if (!isIsoDate(date)) return null;
  const key = `lbl:${dotted(m.slice(1, 6))}:${dotted(m.slice(6, 11))}:${m[11]}`;
  return LABOUR_LINE_KEY_RE.test(key) ? key : null;
}

/** The labour key of either family behind a normalised identifier name, or null (no cross-family adoption). */
export function keyFromLabourExternalIdentifier(name: string): string | null {
  const line = parseLabourLineKey(name);
  if (line !== null) return line;
  const m = COST_NAME_RE.exec(name);
  if (!m) return null;
  const key = `lcost:${dotted(m.slice(1, 6))}:${m[6]}`;
  return LABOUR_COST_KEY_RE.test(key) ? key : null;
}
