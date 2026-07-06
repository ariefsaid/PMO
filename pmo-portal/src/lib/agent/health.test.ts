/**
 * Tests for the health edge function's pure response-builder (observability floor,
 * DC-OF-003, FR-OF-015/016/017).
 *
 * Test-location convention (standing rule — see openRouterModelClient.test.ts header,
 * errorLog.test.ts): edge-fn logic tests live under pmo-portal/ (Vitest's root); the
 * implementation stays in supabase/functions/, imported here via a relative path.
 */
import { describe, it, expect } from 'vitest';
import { buildHealthResponse } from '../../../../supabase/functions/health/health';

describe('buildHealthResponse', () => {
  it('AC-OF-011: returns exactly {ok, service, version, ts} with no extra field', () => {
    const body = buildHealthResponse({ version: '1.4.0', now: () => new Date('2026-07-04T12:00:00.000Z') });
    expect(body).toEqual({
      ok: true,
      service: 'pmo-edge',
      version: '1.4.0',
      ts: '2026-07-04T12:00:00.000Z',
    });
    expect(Object.keys(body)).toHaveLength(4);
  });

  it("AC-OF-011: version falls back to 'unknown' when undefined", () => {
    const body = buildHealthResponse({ version: undefined, now: () => new Date('2026-07-04T12:00:00.000Z') });
    expect(body.version).toBe('unknown');
  });
});
