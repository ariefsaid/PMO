/**
 * edgeTestKit — Shared test harness for Supabase Edge Function tests.
 *
 * Supabase's official guidance: import the real handler + mock globalThis.fetch.
 * No dependency injection in production code.
 *
 * This module provides:
 * - `withFetchMock(routes, run)` — stubs globalThis.fetch via @std/testing/mock,
 *   routes by method + full URL parts, records all calls, throws on unexpected fetch
 * - `createJwtAuthority(supabaseUrl)` — ES256 keypair via jose, exports public JWK,
 *   mints JWTs, serves JWKS through the mock so real verifyCallerJwt path executes
 * - `installEdgeEnv()` — sets/restores SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 * - Route helpers: jwksRoute, supabaseSelect, supabaseRpc, clickup, erp, jsonResponse, countResponse
 * - Call assertion helpers: restCall, rpcCall
 */

import { stub } from '@std/testing/mock';
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet, type JWK } from 'jose';

import type { JwksResolver } from '@/src/lib/auth/verifyCallerJwt.ts';

export interface FetchCall {
  method: string;
  url: URL;
  headers: Headers;
  bodyText?: string;
  bodyJson?: unknown;
}

export interface RouteMatch {
  method?: string;
  host?: string;
  pathname?: string | RegExp;
  searchParams?: Record<string, string | RegExp>;
  match?: (call: FetchCall) => boolean;
}

export interface MockRoute extends RouteMatch {
  label: string;
  response:
    | Response
    | ((call: FetchCall) => Response | Promise<Response>);
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function matches(route: MockRoute, call: FetchCall): boolean {
  if (route.method && route.method.toUpperCase() !== call.method) return false;
  if (route.host && route.host !== call.url.host) return false;
  if (route.pathname) {
    if (route.pathname instanceof RegExp) {
      if (!route.pathname.test(call.url.pathname)) return false;
    } else if (route.pathname !== call.url.pathname) return false;
  }
  if (route.searchParams) {
    for (const [key, pattern] of Object.entries(route.searchParams)) {
      const value = call.url.searchParams.get(key);
      if (value === null) return false;
      if (pattern instanceof RegExp) {
        if (!pattern.test(value)) return false;
      } else if (pattern !== value) return false;
    }
  }
  if (route.match && !route.match(call)) return false;
  return true;
}

export interface JwtAuthority {
  jwksUrl: string;
  jwksBody: { keys: JWK[] };
  kid: string;
  mintJwt: (claims: {
    sub: string;
    role?: string;
    aud?: string;
    expSeconds?: number;
  }) => Promise<string>;
}

/**
 * Create an ES256 JWT authority for testing.
 * Generates an ephemeral keypair, exports the public JWK, and provides JWT minting.
 * The JWKS is served at `${supabaseUrl}/auth/v1/.well-known/jwks.json` via jwksRoute().
 */
export async function createJwtAuthority(supabaseUrl: string): Promise<JwtAuthority> {
  const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
  const publicJwk = (await exportJWK(publicKey)) as JWK;
  const kid = 'edge-test-key';
  publicJwk.use = 'sig';
  publicJwk.alg = 'ES256';
  publicJwk.kid = kid;

  const jwksUrl = `${supabaseUrl}/auth/v1/.well-known/jwks.json`;
  const jwksBody = { keys: [publicJwk] };

  return {
    jwksUrl,
    jwksBody,
    kid,
    async mintJwt(claims: { sub: string; role?: string; aud?: string; expSeconds?: number }) {
      const now = Math.floor(Date.now() / 1000);
      return await new SignJWT({ role: claims.role ?? 'authenticated' })
        .setProtectedHeader({ alg: 'ES256', kid })
        .setIssuer(`${supabaseUrl}/auth/v1`)
        .setAudience(claims.aud ?? 'authenticated')
        .setSubject(claims.sub)
        .setIssuedAt(now)
        .setExpirationTime(now + (claims.expSeconds ?? 3600))
        .sign(privateKey);
    },
  };
}

export interface FetchMockContext {
  calls: FetchCall[];
}

/**
 * Stub globalThis.fetch with a route-based mock.
 * Records every call. Throws on unexpected fetch (fail-fast).
 * Restores the original fetch after the run completes (even on error).
 */
export async function withFetchMock<T>(
  routes: MockRoute[],
  run: (ctx: FetchMockContext) => Promise<T>,
): Promise<T> {
  const calls: FetchCall[] = [];

  const fetchStub = stub(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    const bodyText = request.method === 'GET' || request.method === 'HEAD'
      ? undefined
      : await request.clone().text();

    const call: FetchCall = {
      method: request.method.toUpperCase(),
      url,
      headers: request.headers,
      bodyText,
      bodyJson: bodyText ? safeJson(bodyText) : undefined,
    };
    calls.push(call);

    const route = routes.find((r) => matches(r, call));
    if (!route) {
      throw new Error(`Unexpected fetch: ${call.method} ${url}`);
    }

    return typeof route.response === 'function' ? await route.response(call) : route.response;
  });

  try {
    return await run({ calls });
  } finally {
    fetchStub.restore();
  }
}

export interface EdgeEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  restore: () => void;
}

/**
 * Set/restore SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for edge function tests.
 * Returns an object with the values used and a restore() function.
 * Use ONE stable SUPABASE_URL + keypair per test module (see _jwks memoization nuance in TEST-ARCH.md).
 */
export function installEdgeEnv(overrides?: Partial<Record<'SUPABASE_URL' | 'SUPABASE_SERVICE_ROLE_KEY', string>>): EdgeEnv {
  const previous = {
    SUPABASE_URL: Deno.env.get('SUPABASE_URL'),
    SUPABASE_SERVICE_ROLE_KEY: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
  };
  const next = {
    SUPABASE_URL: overrides?.SUPABASE_URL ?? 'https://edge-test.supabase.test',
    SUPABASE_SERVICE_ROLE_KEY: overrides?.SUPABASE_SERVICE_ROLE_KEY ?? 'test-service-role-key',
  };
  Deno.env.set('SUPABASE_URL', next.SUPABASE_URL);
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', next.SUPABASE_SERVICE_ROLE_KEY);
  return {
    ...next,
    restore() {
      if (previous.SUPABASE_URL === undefined) {
        Deno.env.delete('SUPABASE_URL');
      } else {
        Deno.env.set('SUPABASE_URL', previous.SUPABASE_URL);
      }
      if (previous.SUPABASE_SERVICE_ROLE_KEY === undefined) {
        Deno.env.delete('SUPABASE_SERVICE_ROLE_KEY');
      } else {
        Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', previous.SUPABASE_SERVICE_ROLE_KEY);
      }
    },
  };
}

/**
 * Filter recorded fetch calls for REST calls to a specific table.
 */
export function restCall(calls: FetchCall[], table: string, method?: string): FetchCall[] {
  return calls.filter((c) => {
    if (c.url.pathname !== `/rest/v1/${table}`) return false;
    if (method && c.method !== method.toUpperCase()) return false;
    return true;
  });
}

/**
 * Filter recorded fetch calls for RPC calls to a specific function.
 */
export function rpcCall(calls: FetchCall[], fn: string): FetchCall[] {
  return calls.filter((c) => c.url.pathname === `/rest/v1/rpc/${fn}`);
}

/**
 * Create a JSON response with proper headers.
 */
export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

/**
 * Create a count response (for HEAD + count requests) via Content-Range header.
 * Exercises the real supabase-js count path — this catches the previously shipped count bug.
 */
export function countResponse(count: number, init: ResponseInit = {}): Response {
  return new Response(null, {
    status: init.status ?? 200,
    headers: {
      'content-range': `0-0/${count}`,
      ...(init.headers ?? {}),
    },
  });
}

/**
 * JWKS route for the test authority.
 */
export function jwksRoute(authority: JwtAuthority): MockRoute {
  return {
    label: 'jwks',
    method: 'GET',
    pathname: '/auth/v1/.well-known/jwks.json',
    response: jsonResponse(authority.jwksBody),
  };
}

/**
 * Supabase SELECT route for a table.
 * `responder` receives the FetchCall and returns a Response.
 * The pathname is matched as `/rest/v1/${table}`.
 */
export function supabaseSelect(table: string, responder: (call: FetchCall) => Response): MockRoute {
  return {
    label: `supabase-select-${table}`,
    method: 'GET',
    pathname: `/rest/v1/${table}`,
    response: responder,
  };
}

/**
 * Supabase RPC route for a function.
 * `responder` receives the FetchCall and returns a Response.
 * The pathname is matched as `/rest/v1/rpc/${fn}`.
 */
export function supabaseRpc(fn: string, responder: (call: FetchCall) => Response): MockRoute {
  return {
    label: `supabase-rpc-${fn}`,
    pathname: `/rest/v1/rpc/${fn}`,
    response: responder,
  };
}

/**
 * ClickUp API route matcher.
 * Matches host `api.clickup.com` and the given pathname (string or RegExp).
 */
export function clickup(pathname: string | RegExp, responder: (call: FetchCall) => Response): MockRoute {
  return {
    label: `clickup-${typeof pathname === 'string' ? pathname : 'regex'}`,
    host: 'api.clickup.com',
    pathname,
    response: responder,
  };
}

/**
 * ERPNext site route matcher.
 * Matches the given host and pathname (string or RegExp).
 */
export function erp(host: string, pathname: string | RegExp, responder: (call: FetchCall) => Response): MockRoute {
  return {
    label: `erp-${host}-${typeof pathname === 'string' ? pathname : 'regex'}`,
    host,
    pathname,
    response: responder,
  };
}

/**
 * Build an authenticated Request for testing edge functions.
 */
export function createAuthedRequest(
  url: string,
  body: unknown,
  jwt: string,
  options: { method?: string; contentType?: string } = {},
): Request {
  return new Request(url, {
    method: options.method ?? 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      'content-type': options.contentType ?? 'application/json',
    },
    body: JSON.stringify(body),
  });
}

export { matches as routeMatches };

/**
 * Create a local JWKS resolver for testing (no background intervals).
 * Uses jose's createLocalJWKSet which has no network calls and no timers.
 */
export function createTestJwksResolver(authority: JwtAuthority): JwksResolver {
  return createLocalJWKSet(authority.jwksBody);
}
