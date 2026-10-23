// @vitest-environment jsdom
/**
 * recordFolders — the FE transport for the custody `ensure_record_folder` /
 * `link_existing_record_folders` actions (#1020 lane L6, B01/B02). The supabase invoke boundary is
 * mocked; this file owns the wire contract (exact body, closed result decode, safe errors).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ensureRecordFolder, linkExistingRecordFolders } from '../recordFolders';
import type {
  RecordFolderOutcome as ServerOutcome,
  RecordFolderBackfillPage as ServerPage,
} from '../../../../../supabase/functions/_shared/microsoftRecordFolder';
import type { RecordFolderOutcome, RecordFolderBackfillPage } from '../recordFolders';
import { AppError } from '../../appError';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { functions: { invoke } } }));

const ID = '11111111-1111-4111-8111-111111111111';
const DOC = '22222222-2222-4222-8222-222222222222';
const NEXT = '33333333-3333-4333-8333-333333333333';

function httpError(body: unknown, status = 403): { context: Response } {
  const response = { clone: () => response, json: async () => body, status } as unknown as Response;
  return { context: response };
}

async function capture(fn: () => Promise<unknown>): Promise<AppError> {
  try {
    await fn();
  } catch (e) {
    return e as AppError;
  }
  throw new Error('expected a throw');
}

const page = (over: Record<string, unknown> = {}) => ({
  scanned: 3, linked: 1, needs_choice: 1, missing: 1, failed: 0, skipped: 0, unmatched: [], next: null, ...over,
});

beforeEach(() => invoke.mockReset());

describe('AC-M365DOC-071 — ensureRecordFolder transport', () => {
  it('sends exactly {action,kind,id} and decodes a linked outcome', async () => {
    invoke.mockResolvedValueOnce({ data: { state: 'created', document_id: DOC }, error: null });
    const out = await ensureRecordFolder({ kind: 'project', id: ID });
    expect(invoke).toHaveBeenCalledWith('m365-token-custody', {
      body: { action: 'ensure_record_folder', kind: 'project', id: ID },
    });
    expect(out).toEqual({ state: 'created', document_id: DOC });
  });

  it.each(['needs_choice', 'default_unset', 'missing_identifier'] as const)(
    'decodes the %s domain outcome',
    async (state) => {
      invoke.mockResolvedValueOnce({ data: { state }, error: null });
      expect(await ensureRecordFolder({ kind: 'procurement', id: ID })).toEqual({ state });
    },
  );

  it('rejects an invalid target before any invoke', async () => {
    const err = await capture(() => ensureRecordFolder({ kind: 'project', id: 'not-a-uuid' }));
    expect(err.code).toBe('BAD_REQUEST');
    await capture(() => ensureRecordFolder({ kind: 'budget' as never, id: ID }));
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each([
    ['unknown state', { state: 'weird' }],
    ['retired not_found state', { state: 'not_found' }],
    ['linked without document id', { state: 'linked' }],
    ['linked with extra key', { state: 'linked', document_id: DOC, path: '/x' }],
    ['domain state with extra key', { state: 'needs_choice', message: 'raw' }],
    ['non-uuid document id', { state: 'linked', document_id: 'x' }],
    ['null body', null],
    ['array body', []],
  ])('rejects a malformed result (%s) as a safe error', async (_n, body) => {
    invoke.mockResolvedValueOnce({ data: body, error: null });
    const err = await capture(() => ensureRecordFolder({ kind: 'project', id: ID }));
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe('BAD_REQUEST');
    expect(err.message).not.toContain('raw');
  });

  it('classifies the server error envelope to a stable code and never echoes the server message', async () => {
    invoke.mockResolvedValueOnce({
      data: null,
      error: httpError({ error: 'SCOPE_INSUFFICIENT', message: 'RAW-UPSTREAM-MARKER' }),
    });
    const err = await capture(() => ensureRecordFolder({ kind: 'project', id: ID }));
    expect(err.code).toBe('SCOPE_INSUFFICIENT');
    expect(err.message).not.toContain('RAW-UPSTREAM-MARKER');
  });

  it('classifies a network failure as external-unreachable', async () => {
    invoke.mockResolvedValueOnce({ data: null, error: new Error('fetch failed RAW') });
    const err = await capture(() => ensureRecordFolder({ kind: 'project', id: ID }));
    expect(err.code).toBe('external-unreachable');
    expect(err.message).not.toContain('RAW');
  });

  it('keeps the exported DTO types identical to the server DTOs', () => {
    const a: RecordFolderOutcome = { state: 'linked', document_id: DOC };
    const b: ServerOutcome = a;
    const c: RecordFolderBackfillPage = page() as ServerPage;
    expect([a, b, c].length).toBe(3);
  });
});

describe('AC-M365DOC-072 — linkExistingRecordFolders transport', () => {
  it('sends only the action when no cursor is given', async () => {
    invoke.mockResolvedValueOnce({ data: page({ next: { kind: 'project', after: NEXT } }), error: null });
    const out = await linkExistingRecordFolders();
    expect(invoke).toHaveBeenCalledWith('m365-token-custody', { body: { action: 'link_existing_record_folders' } });
    expect(out.next).toEqual({ kind: 'project', after: NEXT });
  });

  it('sends the exact cursor shape on continuation', async () => {
    invoke.mockResolvedValueOnce({ data: page(), error: null });
    await linkExistingRecordFolders({ kind: 'procurement', after: null });
    expect(invoke).toHaveBeenCalledWith('m365-token-custody', {
      body: { action: 'link_existing_record_folders', cursor: { kind: 'procurement', after: null } },
    });
  });

  it('passes through a summary warning and rejects a non-string one', async () => {
    invoke.mockResolvedValueOnce({ data: page({ summary_warning: 'not saved' }), error: null });
    expect((await linkExistingRecordFolders()).summary_warning).toBe('not saved');
    invoke.mockResolvedValueOnce({ data: page({ summary_warning: 7 }), error: null });
    await expect(linkExistingRecordFolders()).rejects.toBeDefined();
  });

  it('passes through a stopped marker', async () => {
    invoke.mockResolvedValueOnce({ data: page({ stopped: 'connection' }), error: null });
    expect((await linkExistingRecordFolders()).stopped).toBe('connection');
  });

  it.each([
    ['negative count', page({ linked: -1, scanned: 2 })],
    ['non-integer count', page({ linked: 0.5 })],
    ['buckets do not sum to scanned', page({ scanned: 4 })],
    ['scanned over the page cap', page({ scanned: 6, linked: 6, needs_choice: 0, missing: 0 })],
    ['missing bucket', (() => { const p = page(); delete (p as Record<string, unknown>).failed; return p; })()],
    ['extra key', page({ detail: 'x' })],
    ['bad cursor kind', page({ next: { kind: 'budget', after: null } })],
    ['bad cursor id', page({ next: { kind: 'project', after: 'x' } })],
    ['unknown stopped', page({ stopped: 'because' })],
  ])('rejects a malformed page (%s) so the UI loop cannot continue', async (_n, body) => {
    invoke.mockResolvedValueOnce({ data: body, error: null });
    const err = await capture(() => linkExistingRecordFolders());
    expect(err.code).toBe('BAD_REQUEST');
  });

  it('rejects a non-progress continuation cursor', async () => {
    const cursor = { kind: 'project' as const, after: NEXT };
    invoke.mockResolvedValueOnce({ data: page({ next: cursor }), error: null });
    expect((await capture(() => linkExistingRecordFolders(cursor))).code).toBe('BAD_REQUEST');
  });

  it('rejects an invalid cursor before invoking', async () => {
    await capture(() => linkExistingRecordFolders({ kind: 'project', after: 'x' }));
    expect(invoke).not.toHaveBeenCalled();
  });

  it('classifies a server error envelope', async () => {
    invoke.mockResolvedValueOnce({ data: null, error: httpError({ error: 'FORBIDDEN' }) });
    expect((await capture(() => linkExistingRecordFolders())).code).toBe('FORBIDDEN');
  });
});
