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
  if (!data || !Array.isArray(data.value)) {
    throw new AppError(SAFE_BROWSE_ERROR, 'BAD_REQUEST');
  }
  const value: T[] = [];
  let unsupported = 0;
  for (const entry of data.value) {
    const decoded = decode(entry);
    if (decoded === null) unsupported += 1;
    else value.push(decoded);
  }
  return { value, next: null, unsupported_count: unsupported };
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
