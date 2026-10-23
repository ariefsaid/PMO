/**
 * `pmo purchases` (#1319, FR-PFE-060..063): bulk-link ERPNext purchase documents into PMO purchases, read the orphan list,
 * link a SharePoint item. Every check lives in the database RPC; --dry-run calls the same RPC with p_dry_run = true.
 * Node 22 standard library only.
 */

/** The PROCUREMENT-WRITER tier of the API-client guard (migration 0363) — keep in step with it. */
export const PURCHASE_RPCS = Object.freeze(['link_erp_purchase_documents', 'link_procurement_sharepoint_item']);
export const PURCHASE_READ_VIEWS = Object.freeze({
  erp_purchase_orphans: Object.freeze(['id', 'erp_doctype', 'erp_name', 'supplier', 'supplier_name', 'doc_date', 'currency',
    'grand_total', 'net_total', 'erp_status', 'project_ids', 'note']),
  // `orphans --include-set-aside` (migration 0364): the same list plus the documents set aside as overhead, flagged.
  erp_purchase_orphans_all: Object.freeze(['id', 'erp_doctype', 'erp_name', 'supplier', 'supplier_name', 'doc_date', 'currency',
    'grand_total', 'net_total', 'erp_status', 'project_ids', 'set_aside', 'note']),
});
/** The ADMIN/FINANCE tier of the guard (migration 0364): set aside / undo unlinked ERP documents as overhead. */
export const SET_ASIDE_RPCS = Object.freeze(['mark_erp_purchase_documents']);
export const SET_ASIDE_COLUMNS = Object.freeze(['erp_doctype', 'erp_name', 'note']);
/** Same cap as the RPC's note column. */
export const MAX_NOTE = 500;
export const CSV_COLUMNS = Object.freeze(['erp_doctype', 'erp_name', 'procurement_id', 'project_id', 'group', 'title',
  'budget_category', 'sp_drive_id', 'sp_item_id', 'sp_web_url', 'sp_name', 'sp_kind']);
/** The link RPC takes 1..500 rows per call (FR-PFE-020). */
export const MAX_BATCH = 500;
const ROW_FIELDS = ['erp_doctype', 'erp_name', 'procurement_id', 'project_id', 'group', 'title', 'budget_category'];
const SP_FIELDS = ['drive_id', 'item_id', 'web_url', 'name', 'kind'];

/** A link file the CLI refuses before sending anything; `problems` lists every reason. */
export class LinkFileError extends Error {
  constructor(problems) {
    super(problems.join('; '));
    this.problems = problems;
  }
}

/** RFC 4180 subset: quoted fields, "" escapes, CRLF or LF. Returns rows of strings (blank lines dropped). */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (quoted) throw new LinkFileError(['the CSV has an unterminated quote']);
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

/**
 * CSV with a CSV_COLUMNS header → link rows (empty cells omitted; sp_* → sharepoint). An unknown column or a row
 * with more cells than the header is refused: a misspelt `procurement_id` would otherwise create a new purchase.
 */
export function rowsFromCsv(text) {
  const [header, ...body] = parseCsv(text);
  if (!header) return [];
  const names = header.map((h) => h.trim());
  const problems = names.filter((h) => !CSV_COLUMNS.includes(h)).map((h) => `unknown column '${h}' (columns: ${CSV_COLUMNS.join(',')})`);
  body.forEach((cells, i) => {
    if (cells.length > names.length) problems.push(`row ${i + 1} has ${cells.length} cells; the header has ${names.length}`);
  });
  if (problems.length > 0) throw new LinkFileError(problems);
  const idx = Object.fromEntries(names.map((h, i) => [h, i]));
  return body.map((cells) => {
    const get = (k) => (idx[k] === undefined ? '' : (cells[idx[k]] ?? '').trim());
    const row = {};
    for (const k of ROW_FIELDS) if (get(k) !== '') row[k] = get(k);
    const sp = {};
    for (const k of SP_FIELDS) if (get(`sp_${k}`) !== '') sp[k] = get(`sp_${k}`);
    if (Object.keys(sp).length > 0) row.sharepoint = sp;
    return row;
  });
}

const str = (v) => (typeof v === 'string' ? v.trim() : '');

/**
 * The batch unit, mirroring link_erp_purchase_documents: rows naming no purchase that share a project and a group
 * (default: the document number) become ONE new purchase, so they must travel in one call.
 */
function groupKey(r) {
  if (str(r.procurement_id) !== '') return `purchase:${str(r.procurement_id).toLowerCase()}|${str(r.erp_name)}`;
  return `${str(r.project_id).toLowerCase() || '-'}|${str(r.group) || str(r.erp_name)}`;
}

/** CLI-side checks only (the database decides everything else). */
export function validateLinkRows(rows) {
  const problems = [];
  if (!Array.isArray(rows) || rows.length === 0) return ['the file has no rows'];
  const seen = new Map(); // erp_name → [{ n, doctype }]
  const groups = new Map(); // key → { size, label }
  rows.forEach((r, i) => {
    const n = i + 1;
    if (!r || typeof r !== 'object' || Array.isArray(r)) { problems.push(`row ${n}: must be an object`); return; }
    for (const k of Object.keys(r)) if (!ROW_FIELDS.includes(k) && k !== 'sharepoint') problems.push(`row ${n}: unknown field '${k}'`);
    if (typeof r.erp_name !== 'string' || r.erp_name.trim() === '') problems.push(`row ${n}: erp_name is required`);
    if (r.procurement_id && r.project_id) problems.push(`row ${n}: give procurement_id or project_id, not both`);
    if (r.sharepoint !== undefined) {
      const s = r.sharepoint;
      if (!s || typeof s !== 'object' || SP_FIELDS.some((k) => typeof s[k] !== 'string' || s[k] === '') || !['file', 'folder'].includes(s.kind)) {
        problems.push(`row ${n}: sharepoint needs drive_id, item_id, web_url, name and kind file|folder`);
      }
    }
    const name = str(r.erp_name);
    if (name !== '') {
      const doctype = str(r.erp_doctype);
      const prior = (seen.get(name) ?? []).find((p) => p.doctype === '' || doctype === '' || p.doctype === doctype);
      if (prior) problems.push(`row ${n}: ERP document ${name} is already listed on row ${prior.n}`);
      if (!seen.has(name)) seen.set(name, []);
      seen.get(name).push({ n, doctype });
    }
    const key = groupKey(r);
    const g = groups.get(key) ?? { size: 0, label: `group '${str(r.group) || name}' (project ${str(r.project_id) || 'none'})` };
    g.size += 1;
    groups.set(key, g);
  });
  for (const g of groups.values()) {
    if (g.size > MAX_BATCH) problems.push(`${g.label} has ${g.size} rows; one group must fit in one call of ${MAX_BATCH} rows`);
  }
  return problems;
}

/**
 * File row indexes packed into calls of ≤ MAX_BATCH rows, never splitting a group. Rows are gathered by group
 * (project + group key); groups go in order of their first row, so calls follow the file as closely as possible.
 */
function planBatches(rows) {
  const byGroup = new Map();
  rows.forEach((r, i) => {
    const key = groupKey(r);
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key).push(i);
  });
  const batches = [];
  let current = [];
  for (const members of byGroup.values()) {
    if (current.length + members.length > MAX_BATCH) { batches.push(current); current = []; }
    current.push(...members);
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/**
 * Send rows in calls that keep each group whole; report every result under its FILE row number, in file order.
 * When a call fails, the report keeps what earlier calls did and adds `failed_at_row`, `not_saved_rows` and `error`.
 */
export async function runLink(api, rows, { dryRun }) {
  const out = { dry_run: Boolean(dryRun), counts: { link: 0, skip: 0, refused: 0 }, results: [] };
  const batches = planBatches(rows);
  for (let b = 0; b < batches.length; b++) {
    const idx = batches[b];
    let res;
    try {
      res = await api.rpc('link_erp_purchase_documents', { p_rows: idx.map((i) => rows[i]), p_dry_run: Boolean(dryRun) });
    } catch (e) {
      const unsaved = batches.slice(b).flat().map((i) => i + 1).sort((x, y) => x - y);
      out.failed_at_row = Math.min(...idx) + 1;
      out.not_saved_rows = unsaved;
      out.error = Object.fromEntries(['message', 'code', 'status'].filter((k) => e?.[k] !== undefined && e?.[k] !== null).map((k) => [k, e[k]]));
      break;
    }
    for (const r of res?.results ?? []) out.results.push({ ...r, row: idx[Number(r.row) - 1] + 1 });
    for (const k of Object.keys(out.counts)) out.counts[k] += Number(res?.counts?.[k] ?? 0);
  }
  out.results.sort((x, y) => x.row - y.row);
  return out;
}

/** CSV with a SET_ASIDE_COLUMNS header → set-aside rows (empty cells omitted). Unknown columns and ragged rows are refused. */
export function setAsideRowsFromCsv(text) {
  const [header, ...body] = parseCsv(text);
  if (!header) return [];
  const names = header.map((h) => h.trim());
  const problems = names.filter((h) => !SET_ASIDE_COLUMNS.includes(h)).map((h) => `unknown column '${h}' (columns: ${SET_ASIDE_COLUMNS.join(',')})`);
  body.forEach((cells, i) => {
    if (cells.length > names.length) problems.push(`row ${i + 1} has ${cells.length} cells; the header has ${names.length}`);
  });
  if (problems.length > 0) throw new LinkFileError(problems);
  return body.map((cells) => {
    const row = {};
    names.forEach((h, i) => { const v = (cells[i] ?? '').trim(); if (v !== '') row[h] = v; });
    return row;
  });
}

/** CLI-side checks for a set-aside file (the database decides everything else). `undo` leaves notes alone, so a note is refused. */
export function validateSetAsideRows(rows, { undo = false } = {}) {
  const problems = [];
  if (!Array.isArray(rows) || rows.length === 0) return ['the file has no rows'];
  const seen = new Map();
  rows.forEach((r, i) => {
    const n = i + 1;
    if (!r || typeof r !== 'object' || Array.isArray(r)) { problems.push(`row ${n}: must be an object`); return; }
    for (const k of Object.keys(r)) if (!SET_ASIDE_COLUMNS.includes(k)) problems.push(`row ${n}: unknown field '${k}'`);
    if (typeof r.erp_name !== 'string' || r.erp_name.trim() === '') problems.push(`row ${n}: erp_name is required`);
    if (r.note !== undefined) {
      if (typeof r.note !== 'string') problems.push(`row ${n}: note must be text`);
      else if (undo) problems.push(`row ${n}: --undo does not change notes; remove the note`);
      else if (r.note.length > MAX_NOTE) problems.push(`row ${n}: note is longer than ${MAX_NOTE} characters`);
    }
    const name = str(r.erp_name);
    if (name !== '') {
      const doctype = str(r.erp_doctype);
      const prior = (seen.get(name) ?? []).find((p) => p.doctype === '' || doctype === '' || p.doctype === doctype);
      if (prior) problems.push(`row ${n}: ERP document ${name} is already listed on row ${prior.n}`);
      if (!seen.has(name)) seen.set(name, []);
      seen.get(name).push({ n, doctype });
    }
  });
  return problems;
}

/** Send set-aside rows in calls of ≤ MAX_BATCH; same report shape and partial-failure fields as runLink. */
export async function runSetAside(api, rows, { undo, dryRun }) {
  const out = { dry_run: Boolean(dryRun), action: undo ? 'undo' : 'set_aside', counts: { apply: 0, skip: 0, refused: 0 }, results: [] };
  for (let at = 0; at < rows.length; at += MAX_BATCH) {
    const chunk = rows.slice(at, at + MAX_BATCH);
    let res;
    try {
      res = await api.rpc('mark_erp_purchase_documents', { p_rows: chunk, p_action: out.action, p_dry_run: Boolean(dryRun) });
    } catch (e) {
      out.failed_at_row = at + 1;
      out.not_saved_rows = Array.from({ length: rows.length - at }, (_, k) => at + k + 1);
      out.error = Object.fromEntries(['message', 'code', 'status'].filter((k) => e?.[k] !== undefined && e?.[k] !== null).map((k) => [k, e[k]]));
      break;
    }
    for (const r of res?.results ?? []) out.results.push({ ...r, row: at + Number(r.row) });
    for (const k of Object.keys(out.counts)) out.counts[k] += Number(res?.counts?.[k] ?? 0);
  }
  return out;
}
