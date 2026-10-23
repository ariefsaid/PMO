/**
 * `pmo purchases` (#1319, FR-PFE-060..063): bulk-link ERPNext purchase documents into PMO purchases, read the orphan list,
 * link a SharePoint item. Every check lives in the database RPC; --dry-run calls the same RPC with p_dry_run = true.
 * Node 22 standard library only.
 */

/** The PROCUREMENT-WRITER tier of the API-client guard (migration 0363) — keep in step with it. */
export const PURCHASE_RPCS = Object.freeze(['link_erp_purchase_documents', 'link_procurement_sharepoint_item']);
export const PURCHASE_READ_VIEWS = Object.freeze({
  erp_purchase_orphans: Object.freeze(['id', 'erp_doctype', 'erp_name', 'supplier', 'supplier_name', 'doc_date', 'currency',
    'grand_total', 'net_total', 'erp_status', 'project_ids']),
});
export const CSV_COLUMNS = Object.freeze(['erp_doctype', 'erp_name', 'procurement_id', 'project_id', 'group', 'title',
  'budget_category', 'sp_drive_id', 'sp_item_id', 'sp_web_url', 'sp_name', 'sp_kind']);
/** The link RPC takes 1..500 rows per call (FR-PFE-020). */
export const MAX_BATCH = 500;
const ROW_FIELDS = ['erp_doctype', 'erp_name', 'procurement_id', 'project_id', 'group', 'title', 'budget_category'];
const SP_FIELDS = ['drive_id', 'item_id', 'web_url', 'name', 'kind'];

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
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

/** CSV with the CSV_COLUMNS header → link rows (empty cells omitted; sp_* → sharepoint). */
export function rowsFromCsv(text) {
  const [header, ...body] = parseCsv(text);
  if (!header) return [];
  const idx = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
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

/** CLI-side shape checks only (the database decides everything else). */
export function validateLinkRows(rows) {
  const problems = [];
  if (!Array.isArray(rows) || rows.length === 0) return ['the file has no rows'];
  rows.forEach((r, i) => {
    const n = i + 1;
    if (!r || typeof r !== 'object' || Array.isArray(r)) { problems.push(`row ${n}: must be an object`); return; }
    if (typeof r.erp_name !== 'string' || r.erp_name.trim() === '') problems.push(`row ${n}: erp_name is required`);
    if (r.procurement_id && r.project_id) problems.push(`row ${n}: give procurement_id or project_id, not both`);
    if (r.sharepoint !== undefined) {
      const s = r.sharepoint;
      if (!s || typeof s !== 'object' || SP_FIELDS.some((k) => typeof s[k] !== 'string' || s[k] === '') || !['file', 'folder'].includes(s.kind)) {
        problems.push(`row ${n}: sharepoint needs drive_id, item_id, web_url, name and kind file|folder`);
      }
    }
  });
  return problems;
}

/** Send rows in batches of MAX_BATCH; merge results with global row numbers. */
export async function runLink(api, rows, { dryRun }) {
  const out = { dry_run: Boolean(dryRun), counts: { link: 0, skip: 0, refused: 0 }, results: [] };
  for (let start = 0; start < rows.length; start += MAX_BATCH) {
    const batch = rows.slice(start, start + MAX_BATCH);
    const res = await api.rpc('link_erp_purchase_documents', { p_rows: batch, p_dry_run: Boolean(dryRun) });
    for (const r of res?.results ?? []) out.results.push({ ...r, row: start + Number(r.row) });
    for (const k of Object.keys(out.counts)) out.counts[k] += Number(res?.counts?.[k] ?? 0);
  }
  return out;
}
