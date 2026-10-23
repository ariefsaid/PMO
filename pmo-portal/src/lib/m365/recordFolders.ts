import { AppError } from '@/src/lib/appError';
import { supabase } from '@/src/lib/supabase/client';
import { invokeWithTimeout } from '@/src/lib/supabase/invokeWithTimeout';
import { classifyM365InvokeError } from './connectClient';
import type {
  RecordFolderBackfillPage,
  RecordFolderCursor,
  RecordFolderOutcome,
  RecordFolderTarget,
} from '../../../../supabase/functions/_shared/microsoftRecordFolder';

export type {
  RecordFolderBackfillPage,
  RecordFolderCursor,
  RecordFolderOutcome,
  RecordFolderTarget,
} from '../../../../supabase/functions/_shared/microsoftRecordFolder';

const FUNCTION_NAME = 'm365-token-custody';
const SAFE_ERROR = 'Microsoft could not create or link this folder. Please try again.';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const KINDS = new Set(['project', 'procurement']);
const LINKED_STATES = new Set(['already_linked', 'linked', 'created']);
const DOMAIN_STATES = new Set(['needs_choice', 'default_unset', 'missing_identifier']);
const BUCKETS = ['linked', 'needs_choice', 'missing', 'failed', 'skipped'] as const;
const STOPPED = new Set(['connection', 'default_changed', 'unavailable']);
/** The server processes at most five records per invoke (plan: Backfill and performance contract). */
const MAX_PAGE = 5;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

function hasExactKeys(value: Record<string, unknown>, allowed: readonly string[], required: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.every((key) => allowed.includes(key)) && required.every((key) => keys.includes(key));
}

function malformed(): AppError {
  return new AppError(SAFE_ERROR, 'BAD_REQUEST');
}

async function errorCode(error: unknown): Promise<string | undefined> {
  const context = (error as { context?: Response } | null)?.context;
  if (!context || typeof context.clone !== 'function') return undefined;
  try {
    const body = (await context.clone().json()) as { error?: unknown };
    return typeof body?.error === 'string' ? body.error : undefined;
  } catch {
    return undefined;
  }
}

async function throwClassified(error: unknown): Promise<never> {
  const code = await errorCode(error);
  const classified = classifyM365InvokeError(error, code ? { error: code } : undefined);
  throw new AppError(classified.message, classified.code);
}

export function validRecordFolderTarget(target: RecordFolderTarget): boolean {
  return isRecord(target) && KINDS.has(target.kind) && typeof target.id === 'string' && UUID.test(target.id);
}

function decodeOutcome(data: unknown): RecordFolderOutcome {
  if (!isRecord(data) || typeof data.state !== 'string') throw malformed();
  if (LINKED_STATES.has(data.state)) {
    if (!hasExactKeys(data, ['state', 'document_id'], ['state', 'document_id'])) throw malformed();
    if (typeof data.document_id !== 'string' || !UUID.test(data.document_id)) throw malformed();
    return { state: data.state as 'already_linked' | 'linked' | 'created', document_id: data.document_id };
  }
  if (DOMAIN_STATES.has(data.state)) {
    if (!hasExactKeys(data, ['state'], ['state'])) throw malformed();
    return { state: data.state as 'needs_choice' | 'default_unset' | 'missing_identifier' };
  }
  throw malformed();
}

/**
 * Ask the server to link or create the record's SharePoint folder. The body is exactly
 * `{action,kind,id}`: the server loads the record, the default library and the naming
 * convention itself, so no drive, name, org or actor is ever sent from the browser.
 */
export async function ensureRecordFolder(target: RecordFolderTarget): Promise<RecordFolderOutcome> {
  if (!validRecordFolderTarget(target)) throw new AppError(SAFE_ERROR, 'BAD_REQUEST');
  const { data, error } = await invokeWithTimeout(
    supabase.functions.invoke<unknown>(FUNCTION_NAME, {
      body: { action: 'ensure_record_folder', kind: target.kind, id: target.id },
    }),
  );
  if (error) await throwClassified(error);
  return decodeOutcome(data);
}

function validCursor(value: unknown): value is RecordFolderCursor {
  return isRecord(value)
    && hasExactKeys(value, ['kind', 'after'], ['kind', 'after'])
    && typeof value.kind === 'string' && KINDS.has(value.kind)
    && (value.after === null || (typeof value.after === 'string' && UUID.test(value.after)));
}

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

function decodePage(data: unknown, request?: RecordFolderCursor): RecordFolderBackfillPage {
  if (!isRecord(data)) throw malformed();
  const allowed = ['scanned', ...BUCKETS, 'unmatched', 'next', 'stopped', 'retry_after_seconds', 'summary_warning'];
  if (!hasExactKeys(data, allowed, ['scanned', ...BUCKETS, 'unmatched', 'next'])) throw malformed();
  if (!Array.isArray(data.unmatched) || !data.unmatched.every((id) => typeof id === 'string' && UUID.test(id))) throw malformed();
  const counts = [data.scanned, ...BUCKETS.map((key) => data[key])];
  if (!counts.every(isCount)) throw malformed();
  const scanned = data.scanned as number;
  const bucketSum = BUCKETS.reduce((sum, key) => sum + (data[key] as number), 0);
  if (scanned > MAX_PAGE || bucketSum !== scanned) throw malformed();
  const next = data.next === null ? null : validCursor(data.next) ? data.next : undefined;
  if (next === undefined) throw malformed();
  if (data.stopped !== undefined && (typeof data.stopped !== 'string' || !STOPPED.has(data.stopped))) throw malformed();
  const retry = data.retry_after_seconds;
  if (retry !== undefined && (!isCount(retry) || retry > 30 || data.stopped !== 'unavailable')) throw malformed();
  // A continuation must make progress: the same cursor again would loop forever.
  if (next && request && next.kind === request.kind && next.after === request.after) throw malformed();
  const page: RecordFolderBackfillPage = {
    scanned,
    linked: data.linked as number,
    needs_choice: data.needs_choice as number,
    missing: data.missing as number,
    failed: data.failed as number,
    skipped: data.skipped as number,
    unmatched: data.unmatched as string[],
    next,
  };
  if (data.summary_warning !== undefined) {
    if (typeof data.summary_warning !== 'string' || data.summary_warning.length > 200) throw malformed();
    page.summary_warning = data.summary_warning;
  }
  if (data.stopped !== undefined) page.stopped = data.stopped as NonNullable<RecordFolderBackfillPage['stopped']>;
  if (retry !== undefined) page.retry_after_seconds = retry as number;
  return page;
}

/** One match-only page of the Admin sweep. Never creates a folder (server mode `match_only`). */
export async function linkExistingRecordFolders(cursor?: RecordFolderCursor): Promise<RecordFolderBackfillPage> {
  if (cursor !== undefined && !validCursor(cursor)) throw new AppError(SAFE_ERROR, 'BAD_REQUEST');
  const { data, error } = await invokeWithTimeout(
    supabase.functions.invoke<unknown>(FUNCTION_NAME, {
      body: { action: 'link_existing_record_folders', ...(cursor ? { cursor } : {}) },
    }),
  );
  if (error) await throwClassified(error);
  return decodePage(data, cursor);
}
