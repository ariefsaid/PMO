import { AppError } from '@/src/lib/appError';
import { supabase } from '@/src/lib/supabase/client';
import { invokeWithTimeout } from '@/src/lib/supabase/invokeWithTimeout';
import { classifyM365InvokeError } from './connectClient';
import {
  validMicrosoftBrowserUrl,
  type MicrosoftReferenceInput,
  type MicrosoftItemKind,
} from './reference';

export interface GraphSite { id: string; name: string; web_url: string }
export interface GraphDrive { id: string; name: string; web_url: string }
export interface GraphItem extends MicrosoftReferenceInput {
  parent_path: string | null;
  content_tag: string | null;
  sharepoint_ids: { site_url: string; list_id: string; list_item_id: string } | null;
}
export interface GraphVersion { id: string; modified_at: string | null }
export interface GraphReadRequest { path: string; query?: Record<string, string> }
export interface GraphPage<T> { value: T[]; next: GraphReadRequest | null; unsupported_count?: number }

const FUNCTION_NAME = 'm365-token-custody';
const SAFE_BROWSE_ERROR = 'Microsoft could not load these items. Please try again.';

type GraphPageEnvelope = { value?: unknown; '@odata.nextLink'?: unknown };
type Decode<T> = (value: unknown) => T | null;

function parseErrorCode(error: unknown): Promise<string | undefined> | string | undefined {
  const context = (error as { context?: Response } | null)?.context;
  if (!context || typeof context.clone !== 'function') return undefined;
  return context.clone().json().then((body: { error?: unknown }) =>
    typeof body?.error === 'string' ? body.error : undefined,
  ).catch(() => undefined);
}

async function throwBrowseError(error: unknown): Promise<never> {
  const code = await parseErrorCode(error);
  const classified = classifyM365InvokeError(error, code ? { error: code } : undefined);
  throw new AppError(classified.message, classified.code);
}

async function readGraphPage<T>(request: GraphReadRequest, decode: Decode<T>): Promise<GraphPage<T>> {
  const { data, error } = await invokeWithTimeout(
    supabase.functions.invoke<GraphPageEnvelope>(FUNCTION_NAME, {
      body: {
        action: 'graph_proxy',
        method: 'GET',
        path: request.path,
        ...(request.query ? { query: request.query } : {}),
      },
    }),
  );
  if (error) await throwBrowseError(error);
  if (!data || !Array.isArray(data.value) || data.value.length > 100) {
    throw new AppError(SAFE_BROWSE_ERROR, 'BAD_REQUEST');
  }
  const value: T[] = [];
  let unsupported = 0;
  for (const entry of data.value) {
    const decoded = decode(entry);
    if (decoded === null) unsupported += 1;
    else value.push(decoded);
  }
  const nextLink = data['@odata.nextLink'];
  const next = nextLink == null ? null : parseNextLink(nextLink, request);
  return { value, next, unsupported_count: unsupported };
}

const ALLOWED_NEXT_QUERY_KEYS = new Set(['$top', '$skiptoken', '$skip', '$select', '$orderby', 'search']);

export function parseNextLink(link: unknown, initialRequest: GraphReadRequest): GraphReadRequest {
  if (typeof link !== 'string') throw new AppError(SAFE_BROWSE_ERROR, 'BAD_REQUEST');
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    throw new AppError(SAFE_BROWSE_ERROR, 'BAD_REQUEST');
  }
  const expectedPath = `/v1.0${initialRequest.path}`;
  if (url.protocol !== 'https:' || url.origin !== 'https://graph.microsoft.com'
      || url.username || url.password || url.hash || url.pathname !== expectedPath
      || /%2e|%2f|%5c/i.test(url.pathname)) {
    throw new AppError(SAFE_BROWSE_ERROR, 'BAD_REQUEST');
  }
  const query: Record<string, string> = {};
  for (const [key, value] of url.searchParams) {
    if (!ALLOWED_NEXT_QUERY_KEYS.has(key) || Object.prototype.hasOwnProperty.call(query, key)) {
      throw new AppError(SAFE_BROWSE_ERROR, 'BAD_REQUEST');
    }
    query[key] = value;
  }
  if (query.$top !== undefined && query.$top !== '100') {
    throw new AppError(SAFE_BROWSE_ERROR, 'BAD_REQUEST');
  }
  query.$top = '100';
  return { path: initialRequest.path, query };
}

function readText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function decodeItem(value: unknown): GraphItem | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const parent = item.parentReference && typeof item.parentReference === 'object'
    ? item.parentReference as Record<string, unknown>
    : {};
  const hasFileFacet = item.file != null;
  const hasFolderFacet = item.folder != null;
  const kind: MicrosoftItemKind | null = hasFileFacet === hasFolderFacet
    ? null
    : hasFileFacet ? 'file' : 'folder';
  const id = readText(item.id);
  const driveId = readText(parent.driveId);
  const name = readText(item.name);
  const webUrl = item.webUrl;
  if (!id || !driveId || !name || !kind || !validMicrosoftBrowserUrl(webUrl)) return null;
  const sharepoint = item.sharepointIds && typeof item.sharepointIds === 'object'
    ? item.sharepointIds as Record<string, unknown>
    : null;
  const siteUrl = sharepoint ? readText(sharepoint.siteUrl) : null;
  const listId = sharepoint ? readText(sharepoint.listId) : null;
  const listItemId = sharepoint ? readText(sharepoint.listItemId) : null;
  const path = readText(parent.path);
  return {
    drive_id: driveId,
    item_id: id,
    web_url: webUrl,
    name,
    item_kind: kind,
    parent_path: path,
    content_tag: readText(item.cTag),
    sharepoint_ids: siteUrl && listId && listItemId
      ? { site_url: siteUrl, list_id: listId, list_item_id: listItemId }
      : null,
  };
}

export function browseOneDrive(request: GraphReadRequest): Promise<GraphPage<GraphItem>> {
  return readGraphPage({
    ...request,
    query: { ...(request.query ?? {}), '$top': '100' },
  }, decodeItem);
}

function segment(value: string): string {
  const hasControl = [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
  if (!value || value === '.' || value === '..' || value.includes('/') || value.includes('\\')
      || hasControl || /%2e|%2f|%5c/i.test(value)) {
    throw new AppError('Microsoft location is invalid.', 'BAD_REQUEST');
  }
  return encodeURIComponent(value);
}

function decodeLocation(value: unknown): GraphSite | GraphDrive | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const id = readText(item.id);
  const name = readText(item.name);
  const webUrl = item.webUrl;
  if (!id || !name || !validMicrosoftBrowserUrl(webUrl)) return null;
  return { id, name, web_url: webUrl };
}

async function readGraphObject<T>(request: GraphReadRequest, decode: (value: unknown) => T | null): Promise<T> {
  const { data, error } = await invokeWithTimeout(
    supabase.functions.invoke<unknown>(FUNCTION_NAME, {
      body: {
        action: 'graph_proxy', method: 'GET', path: request.path,
        ...(request.query ? { query: request.query } : {}),
      },
    }),
  );
  if (error) await throwBrowseError(error);
  const value = data ? decode(data) : null;
  if (!value) throw new AppError(SAFE_BROWSE_ERROR, 'BAD_REQUEST');
  return value;
}

export function listSites(search?: string): Promise<GraphPage<GraphSite>> {
  return readGraphPage({
    path: '/sites', query: { search: search || '*', '$top': '100' },
  }, (value) => decodeLocation(value) as GraphSite | null);
}

export function listDrives(siteId: string): Promise<GraphPage<GraphDrive>> {
  return readGraphPage({
    path: `/sites/${segment(siteId)}/drives`, query: { '$top': '100' },
  }, (value) => decodeLocation(value) as GraphDrive | null);
}

export function getPersonalDrive(): Promise<GraphDrive> {
  return readGraphObject({ path: '/me/drive' }, (value) => decodeLocation(value) as GraphDrive | null);
}

export function listChildren(driveId: string, folderId?: string): Promise<GraphPage<GraphItem>> {
  const drive = segment(driveId);
  const path = folderId
    ? `/drives/${drive}/items/${segment(folderId)}/children`
    : `/drives/${drive}/root/children`;
  return readGraphPage({ path, query: { '$top': '100' } }, decodeItem);
}

export function searchDrive(driveId: string, term: string): Promise<GraphPage<GraphItem>> {
  const escapedLiteral = `'${term.replace(/'/g, "''")}'`;
  const encodedLiteral = encodeURIComponent(escapedLiteral).replace(/'/g, '%27');
  return readGraphPage({
    path: `/drives/${segment(driveId)}/root/search(q=${encodedLiteral})`,
    query: { '$top': '100' },
  }, decodeItem);
}

function decodeVersion(value: unknown): GraphVersion | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const version = value as Record<string, unknown>;
  const id = readText(version.id);
  if (!id) return null;
  return { id, modified_at: readText(version.lastModifiedDateTime) };
}

export function listVersions(ref: MicrosoftReferenceInput, next?: GraphReadRequest): Promise<GraphPage<GraphVersion>> {
  const request = next ?? {
    path: `/drives/${segment(ref.drive_id)}/items/${segment(ref.item_id)}/versions`,
    query: { '$top': '100', '$select': 'id,lastModifiedDateTime' },
  };
  return readGraphPage({
    ...request,
    query: { ...(request.query ?? {}), '$top': '100' },
  }, decodeVersion);
}

export function getItem(ref: MicrosoftReferenceInput): Promise<GraphItem> {
  return readGraphObject({
    path: `/drives/${segment(ref.drive_id)}/items/${segment(ref.item_id)}`,
    query: { '$select': 'id,name,webUrl,parentReference,file,folder,cTag,sharepointIds' },
  }, decodeItem);
}
