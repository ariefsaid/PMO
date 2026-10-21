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

export function folderSearchRequest(driveId: string, term: string): GraphReadRequest {
  const encodedDrive = encodeURIComponent(driveId);
  const escaped = `'${term.replaceAll("'", "''")}'`;
  const encoded = encodeURIComponent(escaped).replaceAll("'", '%27');
  return { path: `/drives/${encodedDrive}/root/search(q=${encoded})`, query: { '$top': '100' } };
}

const allowedNextQueryKeys = new Set(['$top', '$skiptoken', '$skip', '$select', '$orderby', 'search']);
export function parseFolderSearchNext(link: unknown, initial: GraphReadRequest): GraphReadRequest | null {
  if (typeof link !== 'string') return null;
  let url: URL;
  try { url = new URL(link); } catch { return null; }
  if (url.protocol !== 'https:' || url.origin !== 'https://graph.microsoft.com' || url.username || url.password
    || url.hash || url.pathname !== `/v1.0${initial.path}` || /%2e|%2f|%5c/i.test(url.pathname)) return null;
  const query: Record<string, string> = {};
  for (const [key, value] of url.searchParams) {
    if (!allowedNextQueryKeys.has(key) || Object.hasOwn(query, key)) return null;
    query[key] = value;
  }
  if (query.$top !== undefined && query.$top !== '100') return null;
  query.$top = '100';
  return { path: initial.path, query };
}
