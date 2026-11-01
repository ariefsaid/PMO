import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PreviewFailure } from '@/src/components/documents/types';
import { previewMicrosoftDocument } from '../previewClient';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { functions: { invoke } } }));

const EMBED = 'https://synthetic.sharepoint.com/sites/x/_layouts/15/embed.aspx?a=b';
const failure = (body: unknown, status: number, headers: Record<string, string> = {}) => ({
  data: null,
  error: { context: new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } }) },
});

beforeEach(() => invoke.mockReset());

describe('previewMicrosoftDocument', () => {
  it('document-preview AC-003 sends only the typed identity and returns an embed result', async () => {
    invoke.mockResolvedValue({ data: { name: 'Plan.pdf', get_url: EMBED }, error: null });
    const result = await previewMicrosoftDocument({ kind: 'project_document', id: 'doc-1' });
    expect(result).toEqual({ mode: 'embed', provider: 'microsoft', url: EMBED });
    expect(invoke).toHaveBeenCalledWith('m365-token-custody', { body: { action: 'preview_document', kind: 'project_document', id: 'doc-1' } });
  });

  it('document-preview AC-003 forwards a folder child and a purchase phase unchanged', async () => {
    invoke.mockResolvedValue({ data: { name: 'x', get_url: EMBED }, error: null });
    await previewMicrosoftDocument({ kind: 'budget_link', id: 'b-1', child_item_id: 'child-1' });
    await previewMicrosoftDocument({ kind: 'procurement_file', phase: 'receipt', id: 'f-1' });
    expect(invoke.mock.calls.map((call) => call[1].body)).toEqual([
      { action: 'preview_document', kind: 'budget_link', id: 'b-1', child_item_id: 'child-1' },
      { action: 'preview_document', kind: 'procurement_file', phase: 'receipt', id: 'f-1' },
    ]);
  });

  it.each([
    ['http://synthetic.sharepoint.com/e'],
    ['https://evil.example/e'],
    ['https://sharepoint.com.evil.example/e'],
    [undefined],
    [42],
  ])('document-preview AC-003 refuses a returned URL that is not an https Microsoft host (%s)', async (url) => {
    invoke.mockResolvedValue({ data: { name: 'x', get_url: url }, error: null });
    await expect(previewMicrosoftDocument({ kind: 'project_document', id: 'd' })).rejects.toMatchObject({ kind: 'unavailable' });
  });

  it.each([
    ['SOURCE_ACCESS_DENIED', 403, 'access_denied'],
    ['NOT_CONNECTED', 404, 'not_connected'],
    ['CONNECTION_STALE', 409, 'connection_stale'],
    ['CONNECTION_REVOKED', 410, 'connection_stale'],
    ['SCOPE_INSUFFICIENT', 403, 'consent_needed'],
    ['SOURCE_NOT_FOUND', 404, 'not_found'],
    ['PREVIEW_UNSUPPORTED', 422, 'unsupported'],
    ['RATE_LIMITED', 429, 'rate_limited'],
    ['GRAPH_ERROR', 502, 'unavailable'],
    ['NOT_ENTITLED', 403, 'unavailable'],
    ['SOMETHING_NEW', 500, 'unavailable'],
  ] as const)('document-preview AC-004 maps %s to %s', async (code, status, kind) => {
    invoke.mockResolvedValue(failure({ error: code, message: 'x' }, status));
    await expect(previewMicrosoftDocument({ kind: 'project_document', id: 'd' })).rejects.toEqual(expect.objectContaining({ kind }));
  });

  it('document-preview AC-004 carries a capped Retry-After for a throttle', async () => {
    invoke.mockResolvedValue(failure({ error: 'RATE_LIMITED', message: 'x' }, 429, { 'Retry-After': '60' }));
    await expect(previewMicrosoftDocument({ kind: 'project_document', id: 'd' })).rejects.toMatchObject({ kind: 'rate_limited', retryAfterSeconds: 30 });
    invoke.mockResolvedValue(failure({ error: 'GRAPH_ERROR', message: 'x', retry_after_seconds: 5 }, 502));
    await expect(previewMicrosoftDocument({ kind: 'project_document', id: 'd' })).rejects.toMatchObject({ kind: 'rate_limited', retryAfterSeconds: 5 });
  });

  it('document-preview AC-004 a network failure with no response is unavailable', async () => {
    invoke.mockResolvedValue({ data: null, error: new Error('network') });
    const error = await previewMicrosoftDocument({ kind: 'project_document', id: 'd' }).catch((e) => e);
    expect(error).toBeInstanceOf(PreviewFailure);
    expect(error.kind).toBe('unavailable');
  });

  it('document-preview AC-006 an aborted request drops its late answer', async () => {
    const controller = new AbortController();
    invoke.mockImplementation(async () => { controller.abort(); return { data: { name: 'x', get_url: EMBED }, error: null }; });
    await expect(previewMicrosoftDocument({ kind: 'project_document', id: 'd' }, controller.signal)).rejects.toBeInstanceOf(PreviewFailure);
  });

  it('document-preview AC-003 the capability is never logged', async () => {
    const spies = (['log', 'warn', 'error', 'info'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    invoke.mockResolvedValue({ data: { name: 'x', get_url: EMBED }, error: null });
    await previewMicrosoftDocument({ kind: 'project_document', id: 'd' });
    for (const spy of spies) { expect(JSON.stringify(spy.mock.calls)).not.toContain('embed.aspx'); spy.mockRestore(); }
  });
});
