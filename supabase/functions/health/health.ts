/**
 * health — pure response-builder for the BetterStack uptime probe (observability
 * floor, DC-OF-003, FR-OF-015/016/017). No Deno globals, no DB, no secrets read
 * here — the caller (index.ts) supplies `version` and `now` explicitly, so this
 * function is importable in Vitest.
 */
export interface HealthBody {
  ok: true;
  service: 'pmo-edge';
  version: string;
  ts: string;
}

export function buildHealthResponse(input: { version: string | undefined; now: () => Date }): HealthBody {
  return {
    ok: true,
    service: 'pmo-edge',
    version: input.version ?? 'unknown',
    ts: input.now().toISOString(),
  };
}
