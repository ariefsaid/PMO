/**
 * health — Deno Edge Function entry point (observability floor, DC-OF-003).
 * Public, anonymous, no auth, no DB, no secret read (NFR-OF-REL-003) — proves only
 * "the edge runtime is deployed and serving." GET/HEAD -> 200; anything else -> 405.
 * Integration-only (ADR-0039 decision-7); the pure builder lives in health.ts.
 */
import { buildHealthResponse } from './health.ts';
import { DEPLOY_VERSION } from '../_shared/version.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD',
};

Deno.serve((req: Request): Response => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return new Response(JSON.stringify({ error: 'METHOD_NOT_ALLOWED' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  // Baked into this fn's bundle at deploy by scripts/stamp-edge-fns.sh — the only
  // source of truth (a runtime secret could lie for a stale fn; the bundle can't).
  const body = buildHealthResponse({ version: DEPLOY_VERSION, now: () => new Date() });
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
