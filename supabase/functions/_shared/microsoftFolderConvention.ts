import { sanitizeRecordFolderName } from './microsoftRecordFolder.ts';

export type PickerContext =
  | { kind: 'project'; code: string | null }
  | { kind: 'procurement'; request_number: string | null; created_at: string }
  | { kind: 'budget' };
export interface GraphReadRequest { path: string; query?: Record<string, string> }

export function normalizeFolderParentPath(path: string | null, driveId: string): string | null {
  if (!path || !driveId || /[\\/\x00-\x1f\x7f]/u.test(driveId)) return null;
  let suffix: string;
  const drivePrefix = `/drives/${driveId}/root:`;
  if (path.startsWith(drivePrefix)) suffix = path.slice(drivePrefix.length);
  else if (path.startsWith('/drive/root:')) suffix = path.slice('/drive/root:'.length);
  else return null;
  if (suffix !== '' && !suffix.startsWith('/')) return null;
  const segments: string[] = [];
  for (const raw of suffix.split('/').filter(Boolean)) {
    let segment: string;
    try { segment = decodeURIComponent(raw); } catch { return null; }
    if (!segment || segment === '.' || segment === '..' || segment.includes('/') || segment.includes('\\')
      || [...segment].some((c) => c.charCodeAt(0) <= 0x1f || c.charCodeAt(0) === 0x7f)) return null;
    segments.push(segment);
  }
  return `/drive/root:${segments.length ? `/${segments.join('/')}` : ''}`;
}

export function recordFolderConvention(context: PickerContext): { term: string; parentSegments: string[] } | null {
  if (context.kind === 'project') {
    const term = context.code ? sanitizeRecordFolderName(context.code.trim()) : '';
    return term ? { term, parentSegments: ['Projects'] } : null;
  }
  if (context.kind === 'procurement') {
    const term = context.request_number ? sanitizeRecordFolderName(context.request_number.trim()) : '';
    const date = new Date(context.created_at);
    if (!term || Number.isNaN(date.getTime())) return null;
    return { term, parentSegments: ['Procurement', String(date.getUTCFullYear())] };
  }
  return null;
}

export function folderMatches(item: { drive_id: string; item_kind: string; name: string; parent_path: string | null }, convention: { term: string; parentSegments: string[] }, driveId: string): boolean {
  return item.drive_id === driveId && item.item_kind === 'folder'
    && item.name.toLocaleLowerCase('en').startsWith(convention.term.toLocaleLowerCase('en'))
    && normalizeFolderParentPath(item.parent_path, driveId) === `/drive/root:${convention.parentSegments.length ? `/${convention.parentSegments.join('/')}` : ''}`;
}

/**
 * Strict auto-link match (ensure/backfill only): the folder name IS the code, or the code followed by a
 * single space; '-', '_' and '.' are not boundaries, so P-1 never matches P-10 or P-1-A. `code` is already sanitized. The picker's looser prefix
 * suggestions keep using {@link folderMatches}.
 */
export function folderNameMatchesCode(name: string, code: string): boolean {
  const n = name.normalize('NFC').toLocaleLowerCase('en');
  const c = code.normalize('NFC').toLocaleLowerCase('en');
  if (!c || !n.startsWith(c)) return false;
  return n.length === c.length || n[c.length] === ' '; // mutation-witness:space-boundary
}

export function folderSearchRequest(driveId: string, term: string): GraphReadRequest {
  const encodedDrive = encodeURIComponent(driveId);
  const escaped = `'${term.replaceAll("'", "''")}'`;
  const encoded = encodeURIComponent(escaped).replaceAll("'", '%27');
  return { path: `/drives/${encodedDrive}/root/search(q=${encoded})`, query: { '$top': '100' } };
}

export function folderChildrenRequest(driveId: string, parentId: string): GraphReadRequest {
  return {
    path: `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(parentId)}/children`,
    query: { '$top': '200', '$select': 'id,name,webUrl,parentReference,folder,file' },
  };
}

const allowedNextQueryKeys = new Set(['$top', '$skiptoken', '$skip', '$select', '$orderby', 'search']);

function decodedPath(pathname: string): string | null {
  try { return decodeURIComponent(pathname); } catch { return null; }
}

/**
 * Validate a Graph `@odata.nextLink` against the request it continues. The path is compared DECODED, so
 * Graph may send a literal `'` / `,` or the percent-encoded form; encoded separators and dot segments are
 * refused first. `$top` (and `$select`, when sent) must equal the initial request's.
 */
export function parseFolderSearchNext(link: unknown, initial: GraphReadRequest): GraphReadRequest | null {
  if (typeof link !== 'string') return null;
  let url: URL;
  try { url = new URL(link); } catch { return null; }
  if (url.protocol !== 'https:' || url.origin !== 'https://graph.microsoft.com' || url.username || url.password
    || url.hash || /%2e|%2f|%5c/i.test(url.pathname)) return null;
  const actual = decodedPath(url.pathname);
  const expected = decodedPath(`/v1.0${initial.path}`);
  if (actual === null || expected === null || actual !== expected) return null;
  const query: Record<string, string> = {};
  for (const [key, value] of url.searchParams) {
    if (!allowedNextQueryKeys.has(key) || Object.hasOwn(query, key)) return null;
    query[key] = value;
  }
  const top = initial.query?.$top ?? '100';
  if (query.$top !== undefined && query.$top !== top) return null;
  if (query.$select !== undefined && query.$select !== initial.query?.$select) return null;
  query.$top = top;
  return { path: initial.path, query };
}
