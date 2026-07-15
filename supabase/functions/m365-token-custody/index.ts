// index.ts — Deno Edge Function entry point for m365-token-custody (Phase 1, ADR-0060).
//
// Integration-only: this file is NOT unit-tested (ADR-0039 decision 7 — mirrors compose-view/
// agent-chat). All business logic lives in the pure handlers (initiate/callback/proxy/revoke/
// refresh), importable in Vitest with deps mocked. This wrapper is the ONLY file that:
//   - reads Deno.env (via a globalThis.Deno guard so no bare 'Deno' global leaks into a Node
//     import graph), and
//   - constructs the real Supabase clients + builds the HandlerDeps object, then calls a handler.
//
// Routing (AC-M365-101/103/110/120): OPTIONS preflight → GET /callback (the Microsoft redirect,
// no Bearer; the single-use state row is the credential) → POST with {action} in the body.

import { createClient } from '@supabase/supabase-js';
import {
  verifyCallerJwt,
  bearerToken,
  JwtVerifyError,
  jwksFromUrl,
  type JwksResolver,
} from '../../../pmo-portal/src/lib/auth/verifyCallerJwt.ts';
import { handleInitiateConnect } from './initiate.ts';
import { handleCallback } from './callback.ts';
import { handleGraphProxy } from './proxy.ts';
import { handleDisconnect } from './revoke.ts';
import { corsHeaders } from './auth.ts';
import type {
  HandlerDeps,
  HandlerResult,
  M365Env,
  GraphProxyRequest,
  M365ErrorResponse,
} from './types.ts';

// Minimal ambient Deno shape — avoids depending on lib.d.ts for the env reads (REC-1 import
// boundary). `Deno.serve` below is the runtime entry API provided by the Deno edge lib.
interface DenoEnvLike {
  env: { get(key: string): string | undefined };
}
const denoEnv = (globalThis as { Deno?: DenoEnvLike }).Deno?.env ?? new Proxy({}, {
  get: () => undefined,
}) as DenoEnvLike['env'];
function cfg(key: string): string {
  return denoEnv.get(key) ?? '';
}

// One cached, rate-limited JWKS resolver (ADR-0057), memoized across warm invocations + built
// lazily so an empty SUPABASE_URL can't throw before the handler returns a typed 401/500.
let _jwks: JwksResolver | null = null;
function getJwks(supabaseUrl: string): JwksResolver {
  if (!_jwks) _jwks = jwksFromUrl(`${supabaseUrl}/auth/v1/.well-known/jwks.json`);
  return _jwks;
}

/** Build the resolved M365Env from Deno env (the single env-reading site). */
function buildEnv(): M365Env {
  const supabaseUrl = cfg('SUPABASE_URL').replace(/\/$/, '');
  return {
    m365TenantId: cfg('M365_TENANT_ID'),
    m365ClientId: cfg('M365_CLIENT_ID'),
    m365ClientSecret: cfg('M365_CLIENT_SECRET'),
    m365RedirectUri: cfg('M365_REDIRECT_URI'),
    m365TokenKek: cfg('M365_TOKEN_KEK'),
    supabaseUrl,
    jwtIssuer: cfg('SUPABASE_JWT_ISSUER') || `${supabaseUrl}/auth/v1`,
    siteUrl: cfg('SITE_URL'),
    allowedOrigin: cfg('AGENT_ALLOWED_ORIGIN') || cfg('SITE_URL'),
  };
}

Deno.serve(async (req: Request): Promise<Response> => {
  const env = buildEnv();
  const cors = corsHeaders(env.allowedOrigin);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  const url = new URL(req.url);

  // GET /callback — Microsoft redirect. No caller JWT; the single-use state row is the credential.
  if (req.method === 'GET' && url.pathname.endsWith('/callback')) {
    const deps = await callbackDeps(env);
    if (deps instanceof Response) return deps;
    return toResponse(await handleCallback(req, deps), env.allowedOrigin);
  }

  if (req.method !== 'POST') {
    return toResponse(
      { status: 405, body: { error: 'BAD_REQUEST', message: 'method not allowed' } satisfies M365ErrorResponse },
      env.allowedOrigin,
    );
  }

  // POST: parse the {action} body, then route.
  let body: { action?: string };
  try {
    body = (await req.json()) as { action?: string };
  } catch {
    return toResponse(
      { status: 400, body: { error: 'BAD_REQUEST', message: 'invalid JSON body' } satisfies M365ErrorResponse },
      env.allowedOrigin,
    );
  }

  // Verify the caller JWT once for every authenticated action; build the deps with both clients.
  const authed = await authedDeps(req, env);
  if (authed instanceof Response) return authed;

  let result: HandlerResult;
  try {
    switch (body.action) {
      case 'initiate_connect':
        result = await handleInitiateConnect(authed);
        break;
      case 'graph_proxy':
        result = await handleGraphProxy(body as unknown as GraphProxyRequest, authed);
        break;
      case 'refresh':
        // Phase-1 callers exercise refresh implicitly via graph_proxy's auto-refresh (near-expiry).
        // A standalone refresh action is NOT supported (quality #1): the previous router case
        // silently impersonated a Graph GET /me/drive — returning drive metadata the caller never
        // asked for and not actually refreshing if the token had life. Reject explicitly instead.
        result = {
          status: 400,
          body: { error: 'BAD_REQUEST', message: 'action refresh not supported in Phase 1' } satisfies M365ErrorResponse,
        };
        break;
      case 'disconnect':
        result = await handleDisconnect(authed);
        break;
      default:
        result = {
          status: 400,
          body: { error: 'BAD_REQUEST', message: `unknown action: ${body.action ?? ''}` } satisfies M365ErrorResponse,
        };
    }
  } catch (err) {
    // Handlers map expected errors to results; only unexpected throws land here.
    console.error('[m365-token-custody] unexpected error', {
      errorCode: 'INTERNAL_ERROR',
      message: err instanceof Error ? err.name : 'unknown',
    });
    result = {
      status: 500,
      body: { error: 'INTERNAL_ERROR', message: 'unexpected error' } satisfies M365ErrorResponse,
    };
  }

  return toResponse(result, env.allowedOrigin);
});

/** Build deps for the GET /callback path: service client only (no caller JWT, no caller client). */
async function callbackDeps(env: M365Env): Promise<HandlerDeps | Response> {
  if (!env.supabaseUrl || !cfg('SUPABASE_SERVICE_ROLE_KEY')) {
    return toResponse(
      { status: 500, body: { error: 'INTERNAL_ERROR', message: 'missing Supabase configuration' } },
      env.allowedOrigin,
    );
  }
  const serviceClient = createClient(env.supabaseUrl, cfg('SUPABASE_SERVICE_ROLE_KEY'));
  // Bridge the real supabase-js client into the structural M365SupabaseLike seam (same `as never`
  // convention agent-chat/compose-view use — the real client satisfies the shape at runtime).
  return { env, serviceClient: serviceClient as never, userId: '' };
}

/** Verify the caller JWT (ADR-0057) and build deps with BOTH clients for authenticated actions. */
async function authedDeps(req: Request, env: M365Env): Promise<HandlerDeps | Response> {
  const anonKey = cfg('SUPABASE_ANON_KEY');
  const serviceRoleKey = cfg('SUPABASE_SERVICE_ROLE_KEY');
  if (!env.supabaseUrl || !anonKey || !serviceRoleKey) {
    return toResponse(
      { status: 500, body: { error: 'INTERNAL_ERROR', message: 'missing Supabase configuration' } },
      env.allowedOrigin,
    );
  }

  const jwt = bearerToken(req.headers.get('Authorization'));
  if (!jwt) {
    return toResponse(
      { status: 401, body: { error: 'UNAUTHORIZED', message: 'missing Authorization header' } },
      env.allowedOrigin,
    );
  }

  let userId: string;
  try {
    const verified = await verifyCallerJwt(jwt, getJwks(env.supabaseUrl), {
      issuer: env.jwtIssuer,
      audience: 'authenticated',
      algorithms: ['ES256'],
    });
    userId = verified.sub;
  } catch (err) {
    const status = err instanceof JwtVerifyError ? err.status : 401;
    return toResponse(
      { status, body: { error: 'UNAUTHORIZED', message: 'invalid JWT' } },
      env.allowedOrigin,
    );
  }

  const callerClient = createClient(env.supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const serviceClient = createClient(env.supabaseUrl, serviceRoleKey);

  return { env, serviceClient: serviceClient as never, callerClient: callerClient as never, userId };
}

/** Map a HandlerResult to a Deno Response, merging CORS + Content-Type + any handler headers. */
function toResponse(result: HandlerResult, allowedOrigin: string): Response {
  const headers: Record<string, string> = { ...corsHeaders(allowedOrigin) };
  if (result.headers) Object.assign(headers, result.headers);
  let body: string | null = null;
  if (result.body !== undefined) {
    if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
    body = JSON.stringify(result.body);
  }
  return new Response(body, { status: result.status, headers });
}
