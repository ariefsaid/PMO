// graphRead.ts — caller-owned Graph read session shared by the proxy and document verifier.
// Connection resolution, token refresh/decryption, scope checks and Graph transport stay inside
// custody. The session never exposes its credential to callers.

import type {
  ConnectionRow,
  GraphProxyRequest,
  HandlerDeps,
  HandlerResult,
} from "./types.ts";
import { resolveOrgOrResult } from "./auth.ts";
import {
  decryptToken,
  deserializeEnvelope,
  fromByteaValue,
  resolveKek,
} from "./crypto.ts";
import { refreshAccessToken } from "./refresh.ts";
import { recordM365Error } from "./audit.ts";
import { fetchBounded } from "../_shared/fetchWithDeadline.ts";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const ACCESS_TOKEN_REFRESH_BUFFER_MS = 30_000;
const GRAPH_HEADERS = { "Content-Type": "application/json" };

export interface GraphReadRequest {
  path: string;
  query?: Record<string, string>;
  method?: GraphProxyRequest["method"];
  body?: unknown;
}

export interface GraphBatchEntry {
  id: string;
  method: "GET";
  url: string;
}

export interface GraphReadSession {
  get(request: GraphReadRequest): Promise<HandlerResult>;
  /** Internal custody transport for server-created read batches; not a public proxy action. */
  batch(entries: GraphBatchEntry[]): Promise<HandlerResult>;
}

export function validateGraphProxyInput(
  req: GraphProxyRequest,
): HandlerResult | null {
  if (!req.path || !req.method) {
    return {
      status: 400,
      body: { error: "BAD_REQUEST", message: "method and path required" },
      headers: GRAPH_HEADERS,
    };
  }
  if (
    !normalizeGraphMethod(req.method) || !normalizeGraphRequestPath(req.path)
  ) {
    return {
      status: 400,
      body: {
        error: "BAD_REQUEST",
        message: "method and path must be valid Graph requests",
      },
      headers: GRAPH_HEADERS,
    };
  }
  return null;
}

/** Resolve and open the authenticated caller's own connection without returning token material. */
export async function openCallerGraphRead(
  deps: HandlerDeps,
  beforeConnection?: () => HandlerResult | null,
): Promise<GraphReadSession | HandlerResult> {
  const resolved = await resolveOrgOrResult(deps);
  if (typeof resolved !== "string") return resolved;
  const rejected = beforeConnection?.();
  if (rejected) return rejected;
  const { serviceClient, userId } = deps;
  const { data: conn, error: connError } = await serviceClient
    .from("ms_graph_connections")
    .select("*")
    .eq("org_id", resolved)
    .eq("user_id", userId)
    .single();

  if (connError || !conn) {
    return {
      status: 404,
      body: {
        error: "NOT_CONNECTED",
        message: "no active Microsoft 365 connection",
      },
      headers: GRAPH_HEADERS,
    };
  }
  const connection = conn as ConnectionRow;
  if (connection.status === "stale") {
    return {
      status: 409,
      body: {
        error: "CONNECTION_STALE",
        message: "connection expired, please reconnect",
      },
      headers: GRAPH_HEADERS,
    };
  }
  if (connection.status === "revoked") {
    return {
      status: 410,
      body: { error: "CONNECTION_REVOKED", message: "connection revoked" },
      headers: GRAPH_HEADERS,
    };
  }

  let accessToken: string | undefined;
  const token = async (): Promise<string | HandlerResult> => {
    if (accessToken) return accessToken;
    try {
      accessToken = await loadFreshAccessToken(connection, deps);
      return accessToken;
    } catch {
      const { data: fresh } = await serviceClient
        .from("ms_graph_connections")
        .select("status")
        .eq("id", connection.id)
        .single();
      if ((fresh as { status?: string } | null)?.status === "revoked") {
        return {
          status: 410,
          body: { error: "CONNECTION_REVOKED", message: "connection revoked" },
          headers: GRAPH_HEADERS,
        };
      }
      return {
        status: 409,
        body: {
          error: "CONNECTION_STALE",
          message: "token refresh failed, please reconnect",
        },
        headers: GRAPH_HEADERS,
      };
    }
  };

  const get = async (request: GraphReadRequest): Promise<HandlerResult> => {
    const method = normalizeGraphMethod(request.method ?? "GET");
    const normalizedPath = normalizeGraphRequestPath(request.path);
    if (!method || !normalizedPath) {
      return {
        status: 400,
        body: {
          error: "BAD_REQUEST",
          message: "method and path must be valid Graph requests",
        },
        headers: GRAPH_HEADERS,
      };
    }
    if (!scopeCoversPath(connection.scopes, method, normalizedPath)) {
      return {
        status: 403,
        body: {
          error: "SCOPE_INSUFFICIENT",
          message: "requested Graph path requires additional consent",
        },
        headers: GRAPH_HEADERS,
      };
    }
    const bearer = await token();
    if (typeof bearer !== "string") return bearer;
    const url = graphUrl(normalizedPath, request.query);
    if (!url) {
      return {
        status: 400,
        body: {
          error: "BAD_REQUEST",
          message: "resolved path escapes the allowed Graph surface",
        },
        headers: GRAPH_HEADERS,
      };
    }
    return await sendGraphRequest(
      url,
      method,
      bearer,
      deps,
      connection,
      resolved,
      request.body,
    );
  };

  const batch = async (entries: GraphBatchEntry[]): Promise<HandlerResult> => {
    const ids = new Set<string>();
    const validEntries = Array.isArray(entries) && entries.length > 0 &&
      entries.length <= 20 && entries.every((entry) => {
        if (
          !entry || typeof entry.id !== "string" || !/^\d+$/u.test(entry.id) ||
          entry.method !== "GET" || ids.has(entry.id) ||
          typeof entry.url !== "string" ||
          Object.keys(entry).some((key) =>
            key !== "id" && key !== "method" && key !== "url"
          )
        ) return false;
        ids.add(entry.id);
        const [path, query] = entry.url.split("?", 2);
        const segments = path?.split("/");
        return !!path && segments?.length === 5 && segments[1] === "drives" &&
          !!segments[2] && segments[3] === "items" && !!segments[4] &&
          query ===
            "$select=id,name,webUrl,parentReference,file,folder,cTag,sharepointIds" &&
          scopeCoversPath(connection.scopes, "GET", path);
      });
    if (!validEntries) {
      return {
        status: 400,
        body: {
          error: "BAD_REQUEST",
          message: "cannot read these Graph items",
        },
        headers: GRAPH_HEADERS,
      };
    }
    const bearer = await token();
    if (typeof bearer !== "string") return bearer;
    const url = new URL(`${GRAPH_BASE}/$batch`);
    return await sendGraphRequest(
      url,
      "POST",
      bearer,
      deps,
      connection,
      resolved,
      { requests: entries.map(({ id, method, url }) => ({ id, method, url })) },
    );
  };

  return { get, batch };
}

async function sendGraphRequest(
  url: URL,
  method: string,
  accessToken: string,
  deps: HandlerDeps,
  connection: ConnectionRow,
  orgId: string,
  body?: unknown,
): Promise<HandlerResult> {
  const { serviceClient } = deps;
  let graphRes: Response;
  try {
    graphRes = await fetchBounded(deps.fetch ?? fetch, url.toString(), {
      method,
      headers: { Authorization: `Bearer ${accessToken}`, ...GRAPH_HEADERS },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    await recordM365Error(serviceClient, {
      errorCode: "GRAPH_ERROR",
      contextId: connection.id,
      orgId,
    });
    return {
      status: 502,
      body: { error: "GRAPH_ERROR", message: "Graph API request failed" },
      headers: GRAPH_HEADERS,
    };
  }
  if (!graphRes.ok) {
    let upstreamCode = "";
    let upstreamMessage = "";
    try {
      const errBody = (await graphRes.json()) as {
        error?: { code?: string; message?: string };
      };
      upstreamCode = String(errBody?.error?.code ?? "");
      upstreamMessage = String(errBody?.error?.message ?? "").slice(0, 200);
    } catch { /* non-JSON upstream body */ }
    console.error("[m365-token-custody] graph_proxy upstream failure", {
      status: graphRes.status,
      upstreamCode,
      upstreamMessage,
      requestId: graphRes.headers.get("request-id") ?? "",
      connectionId: connection.id,
      path: url.pathname.slice("/v1.0".length),
    });
    await recordM365Error(serviceClient, {
      errorCode: "GRAPH_ERROR",
      contextId: connection.id,
      orgId,
    });
    return {
      status: 502,
      body: { error: "GRAPH_ERROR", message: "Graph API request failed" },
      headers: GRAPH_HEADERS,
    };
  }
  return { status: 200, body: await graphRes.json(), headers: GRAPH_HEADERS };
}

function graphUrl(path: string, query?: Record<string, string>): URL | null {
  const url = new URL(`${GRAPH_BASE}${path}`);
  if (
    url.origin !== "https://graph.microsoft.com" ||
    !url.pathname.startsWith("/v1.0/")
  ) return null;
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
  }
  return url;
}

async function loadFreshAccessToken(
  connection: ConnectionRow,
  deps: HandlerDeps,
): Promise<string> {
  const { env, serviceClient, now } = deps;
  const nowFn = now ?? (() => new Date());
  const kek = resolveKek(env, connection.key_id);
  const expiresAtMs = connection.access_token_expires_at
    ? new Date(connection.access_token_expires_at).getTime()
    : 0;
  if (
    !connection.access_token_ciphertext ||
    expiresAtMs < nowFn().getTime() + ACCESS_TOKEN_REFRESH_BUFFER_MS
  ) {
    const refreshed = await refreshAccessToken(connection, deps);
    if (!refreshed) throw new Error("refresh failed");
    const { data: fresh, error: freshError } = await serviceClient
      .from("ms_graph_connections")
      .select("access_token_ciphertext, key_id")
      .eq("id", connection.id)
      .single();
    const freshRow = fresh as {
      access_token_ciphertext: Uint8Array | null;
      key_id: string;
    } | null;
    if (freshError || !freshRow || !freshRow.access_token_ciphertext) {
      throw new Error("refresh produced no token");
    }
    const envelope = deserializeEnvelope(
      fromByteaValue(freshRow.access_token_ciphertext),
    );
    return decryptToken(
      envelope.ciphertext,
      envelope.iv,
      resolveKek(env, freshRow.key_id),
    );
  }
  const envelope = deserializeEnvelope(
    fromByteaValue(connection.access_token_ciphertext),
  );
  return decryptToken(envelope.ciphertext, envelope.iv, kek);
}

const GRAPH_METHODS = new Set(["GET", "POST", "PATCH", "PUT", "DELETE"]);
const WRITE_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);
const ENCODED_UNSAFE_PATH = /%2e|%2f|%5c/i;

function normalizeGraphMethod(
  method: unknown,
): GraphProxyRequest["method"] | null {
  if (typeof method !== "string") return null;
  const upper = method.toUpperCase();
  return GRAPH_METHODS.has(upper) ? upper as GraphProxyRequest["method"] : null;
}

function normalizeGraphRequestPath(path: unknown): string | null {
  if (
    typeof path !== "string" || !path.startsWith("/") ||
    /(?:\.\.|\/\/|\?|#|\\)/.test(path)
  ) return null;
  if (ENCODED_UNSAFE_PATH.test(path)) return null;
  return normalizePathForScope(path);
}

function normalizePathForScope(path: string): string | null {
  if (ENCODED_UNSAFE_PATH.test(path)) return null;
  try {
    const url = new URL(`${GRAPH_BASE}${path}`);
    if (
      url.origin !== "https://graph.microsoft.com" ||
      !url.pathname.startsWith("/v1.0/")
    ) return null;
    const normalized = url.pathname.slice("/v1.0".length);
    if (
      /(?:\.\.|\/\/|\?|#|\\)/.test(normalized) ||
      ENCODED_UNSAFE_PATH.test(normalized)
    ) return null;
    return normalized;
  } catch {
    return null;
  }
}

function isOneDrivePath(path: string): boolean {
  return path === "/me/drive" || path.startsWith("/me/drive/") ||
    path === "/drives" || path.startsWith("/drives/") || path === "/sites" ||
    path.startsWith("/sites/");
}

export function scopeCoversPath(
  scopes: string[],
  method: string,
  path: string,
): boolean {
  const normalizedPath = normalizePathForScope(path);
  if (!normalizedPath || !isOneDrivePath(normalizedPath)) return false;
  const normalizedMethod = normalizeGraphMethod(method);
  if (!normalizedMethod) return false;
  if (WRITE_METHODS.has(normalizedMethod)) {
    return scopes.some((scope) =>
      scope === "Files.ReadWrite" || scope === "Files.ReadWrite.All"
    );
  }
  return scopes.some((scope) =>
    ["Files.Read", "Files.ReadWrite", "Files.Read.All", "Files.ReadWrite.All"]
      .includes(scope)
  );
}
