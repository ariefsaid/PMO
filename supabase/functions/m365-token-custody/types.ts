// types.ts — shared types + error codes for m365-token-custody (Phase 1, ADR-0060).
//
// Node/Deno-portable foundation. The Supabase client is modeled as a STRUCTURAL interface
// (M365SupabaseLike) — the same convention compose-view/agent-chat use (HandlerSupabaseLike). A
// bare '@supabase/supabase-js' type import does NOT resolve under tsc from these edge files
// (no node_modules in the supabase/ walk path), so a local structural interface is the
// dual-runtime-safe choice. index.ts (Deno-only) imports createClient from '@supabase/supabase-js'
// (resolved by the fn's deno.json import map) and bridges the real client in via `as never`.
// This file imports NO Deno global and constructs NO client.

// ── Structural Supabase client seam (mirrors agent-chat HandlerSupabaseLike) ──────────
// `PromiseLike` (not `Promise`): the real supabase-js query builder is a thenable, not nominally a
// Promise (missing catch/finally/[Symbol.toStringTag] under Deno's stricter check) — PromiseLike
// needs only .then(), satisfied by both the real client and every test's plain-object mock.
export interface M365SupabaseLike {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        eq(column: string, value: string): { single(): PromiseLike<{ data: unknown; error: unknown }> };
        single(): PromiseLike<{ data: unknown; error: unknown }>;
      };
    };
    insert(row: object): PromiseLike<{ error: unknown }>;
    delete(): { eq(column: string, value: string): PromiseLike<{ error: unknown }> };
    update(patch: object): { eq(column: string, value: string): PromiseLike<{ error: unknown }> };
    upsert(row: object, opts?: { onConflict?: string }): {
      select(columns: string): { single(): PromiseLike<{ data: unknown; error: unknown }> };
    };
  };
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}

// ── Request/response shapes (the wire contract, ADR-0060 §9) ───────────────────

export interface InitiateConnectRequest {
  action: 'initiate_connect';
}

export interface InitiateConnectResponse {
  authorizeUrl: string;
  state: string;
}

export interface GraphProxyRequest {
  action: 'graph_proxy';
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string; // e.g. '/me/drive/root/children'
  query?: Record<string, string>;
  body?: unknown;
}

export interface RefreshRequest {
  action: 'refresh';
}

export interface DisconnectRequest {
  action: 'disconnect';
}

export type M365Request =
  | InitiateConnectRequest
  | GraphProxyRequest
  | RefreshRequest
  | DisconnectRequest;

// ── Errors ────────────────────────────────────────────────────────────────────

export interface M365ErrorResponse {
  error: M365ErrorCode;
  message: string;
}

export type M365ErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_ENTITLED'
  | 'BAD_REQUEST'
  | 'INVALID_STATE'
  | 'TOKEN_EXCHANGE_FAILED'
  | 'NOT_CONNECTED'
  | 'CONNECTION_STALE'
  | 'CONNECTION_REVOKED'
  | 'SCOPE_INSUFFICIENT'
  | 'GRAPH_ERROR'
  | 'INTERNAL_ERROR';

export const ERROR_STATUS: Record<M365ErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_ENTITLED: 403,
  BAD_REQUEST: 400,
  INVALID_STATE: 400,
  TOKEN_EXCHANGE_FAILED: 502,
  NOT_CONNECTED: 404,
  CONNECTION_STALE: 409,
  CONNECTION_REVOKED: 410,
  SCOPE_INSUFFICIENT: 403,
  GRAPH_ERROR: 502,
  INTERNAL_ERROR: 500,
};

/**
 * Typed handler error. Handlers throw this from pure helper logic (e.g. authz gates) and the
 * top-level handler maps it to a `HandlerResult` via `ERROR_STATUS`. Carries NO secret material —
 * only a stable code + a generic message (AC-M365-140).
 */
export class M365HandlerError extends Error {
  readonly code: M365ErrorCode;
  readonly contextId?: string;
  constructor(code: M365ErrorCode, message?: string, contextId?: string) {
    super(message ?? code);
    this.name = 'M365HandlerError';
    this.code = code;
    this.contextId = contextId;
  }
}

// ── Row shapes (ms_graph_connections 0096, m365_pkce_states 0098) ──────────────

export interface ConnectionRow {
  id: string;
  org_id: string;
  user_id: string;
  entra_tenant_id: string;
  entra_user_object_id: string | null;
  scopes: string[];
  refresh_token_ciphertext: Uint8Array;
  access_token_ciphertext: Uint8Array | null;
  access_token_expires_at: string | null;
  refresh_token_expires_at: string | null;
  key_id: string;
  status: 'active' | 'stale' | 'revoked';
  connected_at: string;
  last_refresh_at: string | null;
  updated_at: string;
}

export interface PkceStateRow {
  id: string;
  org_id: string;
  user_id: string;
  code_verifier: string;
  state: string;
  scopes: string[];
  created_at: string;
  expires_at: string;
}

// ── Dependency injection (ADR-0039 — pure handlers, index.ts owns I/O) ────────

/**
 * Resolved configuration strings. index.ts reads these from Deno.env once and passes them in;
 * handlers NEVER touch Deno.env. Keeping them as plain strings (not env keys) means a Vitest test
 * constructs an `M365Env` object directly.
 */
export interface M365Env {
  m365TenantId: string;
  m365ClientId: string;
  m365ClientSecret: string;
  m365RedirectUri: string;
  m365TokenKek: string; // base64url-encoded 32-byte KEK (graphTokenCrypto expects 32 bytes)
  supabaseUrl: string;
  jwtIssuer: string;
  siteUrl: string; // FE origin for the callback success/error redirect
  allowedOrigin: string; // CORS Access-Control-Allow-Origin (narrowed, never '*')
}

/**
 * Injected dependencies for every m365-token-custody handler. Mirrors compose-view/agent-chat's
 * HandlerDeps (ADR-0039 decision 7): the handler is pure, all I/O injected, importable in Vitest
 * with the Supabase clients + fetch mocked. index.ts is the ONLY place that reads Deno.env,
 * constructs the real clients, and builds this object.
 */
export interface HandlerDeps {
  env: M365Env;
  /** service-role client — the ONLY writer to ms_graph_connections / m365_pkce_states + audit RPC. */
  serviceClient: M365SupabaseLike;
  /** caller-JWT-scoped client for profiles/org_features RLS reads. Undefined on the callback path
   *  (the GET redirect carries no Bearer; the single-use PKCE state row is the credential). */
  callerClient?: M365SupabaseLike;
  /** Verified caller user id (auth.uid()), extracted by index.ts via verifyCallerJwt. Empty on the
   *  callback path (state row supplies org_id/user_id). */
  userId: string;
  /** Injectable fetch (Microsoft token/Graph/revoke). Defaults to the global fetch. */
  fetch?: typeof fetch;
  /** Injectable clock for deterministic expiry tests. Defaults to () => new Date(). */
  now?: () => Date;
}

/** A handler returns a plain result; index.ts maps it to a Deno Response (CORS + Content-Type). */
export interface HandlerResult {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

/** Map a typed handler error to its result (status from ERROR_STATUS, generic message). */
export function errorResult(err: M365HandlerError): HandlerResult {
  return {
    status: ERROR_STATUS[err.code],
    body: { error: err.code, message: err.message },
  };
}
