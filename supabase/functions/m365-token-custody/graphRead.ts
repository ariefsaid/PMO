// graphRead.ts — caller-owned Graph read session shared by the proxy and document verifier.
// Connection resolution, token refresh/decryption, scope checks and Graph transport stay inside
// custody. The session never exposes its credential to callers.

import type {
  ConnectionRow,
  GraphProxyRequest,
  HandlerDeps,
  HandlerResult,
} from "./types.ts";
import { microsoftReadQuota, resolveOrgOrResult } from "./auth.ts";
import {
  decryptToken,
  deserializeEnvelope,
  fromByteaValue,
  resolveKek,
} from "./crypto.ts";
import { refreshAccessToken } from "./refresh.ts";
import { recordM365Error } from "./audit.ts";
import { fetchMicrosoftJson } from "./microsoftTransport.ts";
import {
  buildFolderCreateRequest,
  folderWriteAllowed,
  safeGraphId,
  validFolderWriteName,
} from "./graphFolderWrite.ts";
import type { GraphBudget } from "./folderBudget.ts";
import { buildPreviewRequest, previewAllowed, readPreviewGetUrl } from "./graphPreview.ts";
import { validPreviewEmbedUrl } from "../_shared/microsoftDocumentPreview.ts";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const ACCESS_TOKEN_REFRESH_BUFFER_MS = 30_000;
const GRAPH_HEADERS = { "Content-Type": "application/json" };

export interface GraphReadRequest {
  path: string;
  query?: Record<string, string>;
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
  // The browser surface is GET-only and body-less (FR-M365DOC-070): held write scopes never make a
  // browser-supplied mutation permissible. The single folder write is server-built (graphFolderWrite.ts).
  const browserMethodAllowed = normalizeGraphMethod(req.method) === "GET"; // mutation-witness:browser-get-only
  if (
    !browserMethodAllowed || req.body !== undefined ||
    !normalizeGraphRequestPath(req.path)
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
  const own = await openOwnConnection(deps, beforeConnection);
  if (!("connection" in own)) return own;
  const limited = await microsoftReadQuota(deps);
  if (limited) return limited;
  return { get: (request) => own.get(request), batch: own.batch };
}

const MAX_RETRY_AFTER_SECONDS = 30;

/** Retry-After as whole seconds capped at 30, or undefined when absent / not a plain non-negative integer. */
export function retryAfterSeconds(header: string | null): number | undefined {
  if (header === null || !/^\d{1,6}$/u.test(header.trim())) return undefined;
  return Math.min(Number(header.trim()), MAX_RETRY_AFTER_SECONDS);
}

/** Closed internal result of a folder metadata read or the single folder create. Never a raw upstream body. */
export type FolderOutcome =
  | { kind: "ok"; item: Record<string, unknown> }
  | { kind: "not_found" }
  | { kind: "name_conflict" }
  | { kind: "forbidden" }
  | { kind: "unavailable"; result?: HandlerResult; retryAfter?: number };

export type FolderReadTarget =
  | { kind: "root" }
  | { kind: "child"; parentId: string; name: string };

export interface RecordFolderLibrary {
  site_id: string;
  drive_id: string;
}

/** Read-only capability: listings and exact-folder reads through the scope-checked GET. No write method exists on it. */
export interface RecordFolderReadAccess {
  get(request: GraphReadRequest): Promise<HandlerResult>;
  readFolder(target: FolderReadTarget): Promise<FolderOutcome>;
}

/** Ensure capability: reads plus exactly one mutator, `createFolder(parentId, name)`. */
export interface RecordFolderEnsureAccess extends RecordFolderReadAccess {
  createFolder(parentId: string, name: string): Promise<FolderOutcome>;
}

export type RecordFolderMode = "ensure" | "match_only";

const SITES_SELECTED_SCOPES = new Set([
  "Sites.Selected",
  "https://graph.microsoft.com/Sites.Selected",
]);

/**
 * Open the caller's own connection for record-folder work (used only by recordFolders.ts). `mode` is
 * chosen by the server, never parsed from the browser. `ensure` additionally requires the stored
 * `Sites.Selected` consent — checked BEFORE any token refresh or Graph call; refresh never upgrades old
 * consent. `match_only` needs the existing read scopes only and has no create method at all.
 */
export function openCallerRecordFolderAccess(
  deps: HandlerDeps,
  library: RecordFolderLibrary,
  mode: "ensure",
  budget: GraphBudget,
): Promise<RecordFolderEnsureAccess | HandlerResult>;
export function openCallerRecordFolderAccess(
  deps: HandlerDeps,
  library: RecordFolderLibrary,
  mode: "match_only",
  budget: GraphBudget,
): Promise<RecordFolderReadAccess | HandlerResult>;
export async function openCallerRecordFolderAccess(
  deps: HandlerDeps,
  library: RecordFolderLibrary,
  mode: RecordFolderMode,
  budget: GraphBudget,
): Promise<RecordFolderReadAccess | RecordFolderEnsureAccess | HandlerResult> {
  const own = await openOwnConnection(
    deps,
    undefined,
    mode === "ensure"
      ? (scopes) => scopes.some((scope) => SITES_SELECTED_SCOPES.has(scope))
      : undefined,
    budget,
  );
  if (!("connection" in own)) return own;
  const spent: HandlerResult = {
    status: 502,
    body: { error: "GRAPH_ERROR", message: "Graph API request failed" },
    headers: GRAPH_HEADERS,
  };
  const read: RecordFolderReadAccess = {
    get: (request) => {
      const timeoutMs = budget.slice();
      return timeoutMs === null
        ? Promise.resolve(spent)
        : own.get(request, { timeoutMs, redact: true });
    },
    readFolder: (target) => {
      const timeoutMs = budget.slice();
      return timeoutMs === null
        ? Promise.resolve({ kind: "unavailable" })
        : own.readFolder(library.drive_id, target, timeoutMs);
    },
  };
  if (mode === "match_only") return read;
  const ensure: RecordFolderEnsureAccess = {
    ...read,
    createFolder: (parentId, name) => {
      const timeoutMs = budget.slice();
      return timeoutMs === null
        ? Promise.resolve({ kind: "unavailable" })
        : own.createFolder(library.drive_id, parentId, name, timeoutMs);
    },
  };
  return ensure;
}

export type PreviewOutcome =
  | { kind: "ok"; url: string }
  | { kind: "forbidden" }
  | { kind: "not_found" }
  | { kind: "unsupported" }
  | { kind: "unavailable"; result?: HandlerResult; retryAfter?: number };

/** Read capability plus exactly one preview call. No write method, credential getter or generic request exists on it. */
export interface DocumentPreviewAccess {
  /** Scope-checked metadata read of ONE item (used only to prove a folder child's parent); never returned to the browser. */
  readItem(driveId: string, itemId: string): Promise<FolderOutcome>;
  previewItem(driveId: string, itemId: string): Promise<PreviewOutcome>;
}

const FILES_READ_SCOPES = new Set(["Files.Read", "Files.ReadWrite", "Files.Read.All", "Files.ReadWrite.All"]);
const PREVIEW_TIMEOUT_MS = 8_000;

/**
 * Open the caller's own connection for `preview_document`. The Files read grant every connection already
 * holds is required BEFORE any token refresh or Graph call; no new consent is ever asked for.
 */
export async function openCallerDocumentPreview(
  deps: HandlerDeps,
): Promise<DocumentPreviewAccess | HandlerResult> {
  const own = await openOwnConnection(
    deps,
    undefined,
    (scopes) => scopes.some((scope) => FILES_READ_SCOPES.has(scope)),
    undefined,
    "previewing a file requires additional consent",
  );
  if (!("connection" in own)) return own;
  const limited = await microsoftReadQuota(deps);
  if (limited) return limited;
  return {
    readItem: (driveId, itemId) => own.readItem(driveId, itemId, PREVIEW_TIMEOUT_MS),
    previewItem: (driveId, itemId) => own.previewItem(driveId, itemId, PREVIEW_TIMEOUT_MS),
  };
}

interface OwnConnection {
  connection: ConnectionRow;
  get(
    request: GraphReadRequest,
    options?: { timeoutMs?: number; redact?: boolean },
  ): Promise<HandlerResult>;
  batch(entries: GraphBatchEntry[]): Promise<HandlerResult>;
  readFolder(
    driveId: string,
    target: FolderReadTarget,
    timeoutMs: number,
  ): Promise<FolderOutcome>;
  createFolder(
    driveId: string,
    parentId: string,
    name: string,
    timeoutMs: number,
  ): Promise<FolderOutcome>;
  readItem(
    driveId: string,
    itemId: string,
    timeoutMs: number,
  ): Promise<FolderOutcome>;
  previewItem(
    driveId: string,
    itemId: string,
    timeoutMs: number,
  ): Promise<PreviewOutcome>;
}

const FOLDER_ITEM_SELECT = "id,name,webUrl,parentReference,file,folder";

async function openOwnConnection(
  deps: HandlerDeps,
  beforeConnection?: () => HandlerResult | null,
  requireScope?: (scopes: string[]) => boolean,
  deadline?: GraphBudget,
  scopeMessage = "folder creation requires additional consent",
): Promise<OwnConnection | HandlerResult> {
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
  if (requireScope && !requireScope(connection.scopes ?? [])) {
    return {
      status: 403,
      body: { error: "SCOPE_INSUFFICIENT", message: scopeMessage },
      headers: GRAPH_HEADERS,
    };
  }

  let accessToken: string | undefined;
  const token = async (): Promise<string | HandlerResult> => {
    if (accessToken) return accessToken;
    try {
      accessToken = await loadFreshAccessToken(connection, deps, deadline);
      return accessToken;
    } catch {
      // A refresh that ran into the invocation deadline is an outage, not a stale connection.
      if (deadline && deadline.remaining() <= 0) {
        return {
          status: 502,
          body: { error: "GRAPH_ERROR", message: "Graph API request failed" },
          headers: GRAPH_HEADERS,
        };
      }
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

  const get = async (
    request: GraphReadRequest,
    options?: { timeoutMs?: number; redact?: boolean },
  ): Promise<HandlerResult> => {
    const normalizedPath = normalizeGraphRequestPath(request.path);
    if (!normalizedPath) {
      return {
        status: 400,
        body: {
          error: "BAD_REQUEST",
          message: "method and path must be valid Graph requests",
        },
        headers: GRAPH_HEADERS,
      };
    }
    if (!scopeCoversPath(connection.scopes, "GET", normalizedPath)) {
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
    if (!scopeCoversPath(connection.scopes, "GET", normalizedPath)) {
      return { status: 403, body: { error: "SCOPE_INSUFFICIENT", message: "requested Graph path requires additional consent" }, headers: GRAPH_HEADERS };
    }
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
      "GET",
      bearer,
      deps,
      connection,
      resolved,
      undefined,
      options,
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
    if (!entries.every((entry) => scopeCoversPath(connection.scopes, "GET", entry.url.split("?", 1)[0]!))) {
      return { status: 403, body: { error: "SCOPE_INSUFFICIENT", message: "requested Graph path requires additional consent" }, headers: GRAPH_HEADERS };
    }
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

  const readFolder = async (
    driveId: string,
    target: FolderReadTarget,
    timeoutMs: number,
  ): Promise<FolderOutcome> => {
    if (
      !safeGraphId(driveId) ||
      (target.kind === "child" &&
        (!safeGraphId(target.parentId) || !validFolderWriteName(target.name)))
    ) return { kind: "unavailable" };
    const path = target.kind === "root"
      ? `/drives/${encodeURIComponent(driveId)}/root`
      : `/drives/${encodeURIComponent(driveId)}/items/${
        encodeURIComponent(target.parentId)
      }:/${encodeURIComponent(target.name)}`;
    // A name such as "P-1 v1..2" is legitimate: only a dot SEGMENT is a traversal (names are validated).
    const normalizedPath = normalizeGraphRequestPath(path, true);
    if (
      !normalizedPath || !scopeCoversPath(connection.scopes, "GET", normalizedPath, true)
    ) return { kind: "unavailable" };
    const bearer = await token();
    if (typeof bearer !== "string") {
      return { kind: "unavailable", result: bearer };
    }
    if (!scopeCoversPath(connection.scopes, "GET", normalizedPath, true)) return { kind: "unavailable" };
    const url = graphUrl(normalizedPath, { "$select": FOLDER_ITEM_SELECT });
    if (!url) return { kind: "unavailable" };
    return await sendFolderRequest(
      url,
      "GET",
      bearer,
      deps,
      connection,
      resolved,
      undefined,
      timeoutMs,
    );
  };

  const readItem = async (
    driveId: string,
    itemId: string,
    timeoutMs: number,
  ): Promise<FolderOutcome> => {
    if (!safeGraphId(driveId) || !safeGraphId(itemId)) return { kind: "unavailable" };
    const path = `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}`;
    const normalizedPath = normalizeGraphRequestPath(path);
    if (!normalizedPath || !scopeCoversPath(connection.scopes, "GET", normalizedPath)) {
      return { kind: "unavailable" };
    }
    const bearer = await token();
    if (typeof bearer !== "string") return { kind: "unavailable", result: bearer };
    if (!scopeCoversPath(connection.scopes, "GET", normalizedPath)) return { kind: "unavailable" };
    const url = graphUrl(normalizedPath, { "$select": FOLDER_ITEM_SELECT });
    if (!url) return { kind: "unavailable" };
    return await sendFolderRequest(url, "GET", bearer, deps, connection, resolved, undefined, timeoutMs);
  };

  const createFolder = async (
    driveId: string,
    parentId: string,
    name: string,
    timeoutMs: number,
  ): Promise<FolderOutcome> => {
    const context = { driveId, parentId, name };
    let request: ReturnType<typeof buildFolderCreateRequest>;
    try {
      request = buildFolderCreateRequest(context);
    } catch {
      return { kind: "unavailable" };
    }
    const bearer = await token();
    if (typeof bearer !== "string") {
      return { kind: "unavailable", result: bearer };
    }
    if (requireScope && !requireScope(connection.scopes ?? [])) { // mutation-witness:refreshed-folder-grant
      return { kind: "unavailable", result: {
        status: 403, body: { error: "SCOPE_INSUFFICIENT", message: "folder creation requires additional consent" }, headers: GRAPH_HEADERS,
      } };
    }
    const url = graphUrl(request.path);
    if (!url) return { kind: "unavailable" };
    // The exact allowlist runs IMMEDIATELY before the only write call in custody.
    if (!folderWriteAllowed(request, context)) return { kind: "unavailable" };
    return await sendFolderRequest(
      url,
      "POST",
      bearer,
      deps,
      connection,
      resolved,
      request.body,
      timeoutMs,
    );
  };

  const previewItem = async (
    driveId: string,
    itemId: string,
    timeoutMs: number,
  ): Promise<PreviewOutcome> => {
    const context = { driveId, itemId };
    let request: ReturnType<typeof buildPreviewRequest>;
    try {
      request = buildPreviewRequest(context);
    } catch {
      return { kind: "unavailable" };
    }
    const bearer = await token();
    if (typeof bearer !== "string") return { kind: "unavailable", result: bearer };
    // A refresh can change the stored scopes; the read grant is re-checked on the refreshed set.
    if (requireScope && !requireScope(connection.scopes ?? [])) {
      return { kind: "unavailable", result: {
        status: 403, body: { error: "SCOPE_INSUFFICIENT", message: scopeMessage }, headers: GRAPH_HEADERS,
      } };
    }
    const url = graphUrl(request.path);
    if (!url) return { kind: "unavailable" };
    // The exact allowlist runs IMMEDIATELY before the only preview call in custody.
    if (!previewAllowed(request, context)) return { kind: "unavailable" };
    return await sendPreviewRequest(url, bearer, deps, connection, resolved, timeoutMs);
  };

  return { connection, get, batch, readFolder, createFolder, readItem, previewItem };
}

/**
 * Preview transport: one bounded POST `{}`, never retried. Only an embeddable Microsoft `getUrl` is an
 * `ok`; the URL is a short-lived capability, so nothing here logs or stores it, the item id or the name:
 * a failure logs `{status, connectionId}` only and upstream text is never returned.
 */
async function sendPreviewRequest(
  url: URL,
  accessToken: string,
  deps: HandlerDeps,
  connection: ConnectionRow,
  orgId: string,
  timeoutMs: number,
): Promise<PreviewOutcome> {
  let graphRes: Response;
  let data: unknown;
  try {
    ({ response: graphRes, data } = await fetchMicrosoftJson(deps.fetch ?? fetch, url.toString(), {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, ...GRAPH_HEADERS },
      body: "{}",
    }, timeoutMs));
  } catch {
    await recordM365Error(deps.serviceClient, { errorCode: "GRAPH_ERROR", contextId: connection.id, orgId });
    return { kind: "unavailable" };
  }
  if (!graphRes.ok) {
    let upstreamCode = "";
    try {
      upstreamCode = String((data as { error?: { code?: unknown } } | null)?.error?.code ?? "");
    } catch { /* non-JSON upstream body */ }
    if (graphRes.status === 403) return { kind: "forbidden" };
    if (graphRes.status === 404) return { kind: "not_found" };
    if (
      graphRes.status === 415 ||
      (graphRes.status === 400 && ["notSupported", "unsupportedMediaType"].includes(upstreamCode))
    ) return { kind: "unsupported" };
    const retryAfter = graphRes.status === 429 || graphRes.status === 503
      ? retryAfterSeconds(graphRes.headers.get("Retry-After"))
      : undefined;
    console.error("[m365-token-custody] preview upstream failure", {
      status: graphRes.status,
      connectionId: connection.id,
    });
    await recordM365Error(deps.serviceClient, { errorCode: "GRAPH_ERROR", contextId: connection.id, orgId });
    return retryAfter === undefined ? { kind: "unavailable" } : { kind: "unavailable", retryAfter };
  }
  if (graphRes.status !== 200) return { kind: "unavailable" };
  const getUrl = readPreviewGetUrl(data);
  if (getUrl === null) return { kind: "unsupported" };
  return validPreviewEmbedUrl(getUrl) ? { kind: "ok", url: getUrl } : { kind: "unavailable" };
}

/**
 * Folder transport: bounded, never retried, and classifies ONLY 404 itemNotFound as absence and
 * 409 nameAlreadyExists as a name conflict. Every other failure, invalid JSON, or a create that did not
 * answer 201 is `unavailable`. No upstream text, URL, name or path is logged or returned.
 */
async function sendFolderRequest(
  url: URL,
  method: "GET" | "POST",
  accessToken: string,
  deps: HandlerDeps,
  connection: ConnectionRow,
  orgId: string,
  body: unknown,
  timeoutMs: number,
): Promise<FolderOutcome> {
  let graphRes: Response;
  let data: unknown;
  try {
    ({ response: graphRes, data } = await fetchMicrosoftJson(deps.fetch ?? fetch, url.toString(), {
      method,
      headers: { Authorization: `Bearer ${accessToken}`, ...GRAPH_HEADERS },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }, timeoutMs));
  } catch {
    await recordM365Error(deps.serviceClient, {
      errorCode: "GRAPH_ERROR",
      contextId: connection.id,
      orgId,
    });
    return { kind: "unavailable" };
  }
  if (!graphRes.ok) {
    let upstreamCode = "";
    try {
      const errBody = data as { error?: { code?: unknown } };
      upstreamCode = String(errBody?.error?.code ?? "");
    } catch { /* non-JSON upstream body */ }
    if (graphRes.status === 404 && upstreamCode === "itemNotFound") {
      return { kind: "not_found" };
    }
    if (graphRes.status === 409 && upstreamCode === "nameAlreadyExists") {
      return { kind: "name_conflict" };
    }
    if (graphRes.status === 403) return { kind: "forbidden" };
    const retryAfter = graphRes.status === 429 || graphRes.status === 503
      ? retryAfterSeconds(graphRes.headers.get("Retry-After"))
      : undefined;
    console.error("[m365-token-custody] folder upstream failure", {
      status: graphRes.status,
      connectionId: connection.id,
    });
    await recordM365Error(deps.serviceClient, {
      errorCode: "GRAPH_ERROR",
      contextId: connection.id,
      orgId,
    });
    return retryAfter === undefined
      ? { kind: "unavailable" }
      : { kind: "unavailable", retryAfter };
  }
  if (method === "POST" ? graphRes.status !== 201 : graphRes.status !== 200) {
    return { kind: "unavailable" };
  }
  try {
    const item = data;
    return item && typeof item === "object" && !Array.isArray(item)
      ? { kind: "ok", item: item as Record<string, unknown> }
      : { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
}

async function sendGraphRequest(
  url: URL,
  method: string,
  accessToken: string,
  deps: HandlerDeps,
  connection: ConnectionRow,
  orgId: string,
  body?: unknown,
  options: { timeoutMs?: number; redact?: boolean } = {},
): Promise<HandlerResult> {
  const { serviceClient } = deps;
  let graphRes: Response;
  let data: unknown;
  try {
    ({ response: graphRes, data } = await fetchMicrosoftJson(deps.fetch ?? fetch, url.toString(), {
      method,
      headers: { Authorization: `Bearer ${accessToken}`, ...GRAPH_HEADERS },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }, options.timeoutMs));
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
      const errBody = data as {
        error?: { code?: string; message?: string };
      };
      upstreamCode = String(errBody?.error?.code ?? "");
      upstreamMessage = String(errBody?.error?.message ?? "").slice(0, 200);
    } catch { /* non-JSON upstream body */ }
    // Record-folder reads (options.redact) log status only: the path carries the record's code/name.
    console.error(
      "[m365-token-custody] graph_proxy upstream failure",
      options.redact
        ? { status: graphRes.status, connectionId: connection.id }
        : {
          status: graphRes.status,
          upstreamCode,
          upstreamMessage,
          requestId: graphRes.headers.get("request-id") ?? "",
          connectionId: connection.id,
          path: url.pathname.slice("/v1.0".length),
        },
    );
    await recordM365Error(serviceClient, {
      errorCode: "GRAPH_ERROR",
      contextId: connection.id,
      orgId,
    });
    // Record-folder reads only: a throttled/unavailable answer may carry a bounded retry hint (seconds).
    const retryAfter = options.redact && (graphRes.status === 429 || graphRes.status === 503)
      ? retryAfterSeconds(graphRes.headers.get("Retry-After"))
      : undefined;
    return {
      status: 502,
      body: retryAfter === undefined
        ? { error: "GRAPH_ERROR", message: "Graph API request failed" }
        : { error: "GRAPH_ERROR", message: "Graph API request failed", retry_after_seconds: retryAfter },
      headers: GRAPH_HEADERS,
    };
  }
  if (data === null) return { status: 502, body: { error: "GRAPH_ERROR", message: "Graph API request failed" }, headers: GRAPH_HEADERS };
  return { status: 200, body: metadataOnly(data), headers: GRAPH_HEADERS }; // mutation-witness:metadata-projection
}

function metadataOnly(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(metadataOnly);
  if (!value || typeof value !== "object") return value;
  // ponytail: strip known capability/token fields rather than keep a field list. A keep-list also
  // filters envelope keys (batch `responses`/`status`/`body`) and silently broke document checks.
  return Object.fromEntries(Object.entries(value).filter(([key]) =>
    !["@microsoft.graph.downloadUrl", "@content.downloadUrl", "access_token", "refresh_token"].includes(key)
  ).map(([key, item]) => [key, metadataOnly(item)]));
}

function graphUrl(path: string, query?: Record<string, string>): URL | null {
  const url = new URL(`${GRAPH_BASE}${path}`);
  if (
    url.origin !== "https://graph.microsoft.com" ||
    !url.pathname.startsWith("/v1.0/")
  ) return null;
  if (query) {
    const keys = new Set(["$top", "$skiptoken", "$skip", "$select", "$orderby", "search"]);
    const fields = new Set(["id", "name", "webUrl", "parentReference", "file", "folder", "cTag", "eTag", "sharepointIds", "lastModifiedDateTime", "size", "driveType", "description"]);
    for (const [key, value] of Object.entries(query)) {
      if (!keys.has(key) || typeof value !== "string" || value.length > 8192 ||
        (key === "$select" && value.split(",").some((field) => !fields.has(field)))) return null;
      url.searchParams.set(key, value);
    }
  }
  return url;
}

async function loadFreshAccessToken(
  connection: ConnectionRow,
  deps: HandlerDeps,
  deadline?: GraphBudget,
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
    const timeoutMs = deadline ? deadline.slice() : undefined;
    if (timeoutMs === null) throw new Error("deadline spent");
    const refreshed = await refreshAccessToken(connection, deps, timeoutMs);
    if (!refreshed) throw new Error("refresh failed");
    const { data: fresh, error: freshError } = await serviceClient
      .from("ms_graph_connections")
      .select("access_token_ciphertext, key_id, scopes")
      .eq("id", connection.id)
      .single();
    const freshRow = fresh as {
      access_token_ciphertext: Uint8Array | null;
      key_id: string;
      scopes?: string[];
    } | null;
    if (freshError || !freshRow || !freshRow.access_token_ciphertext) {
      throw new Error("refresh produced no token");
    }
    connection.scopes = Array.isArray(freshRow.scopes) ? freshRow.scopes : [];
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
const ENCODED_UNSAFE_PATH = /%2e|%2f|%5c/i;

function normalizeGraphMethod(
  method: unknown,
): GraphProxyRequest["method"] | null {
  if (typeof method !== "string") return null;
  const upper = method.toUpperCase();
  return GRAPH_METHODS.has(upper) ? upper as GraphProxyRequest["method"] : null;
}

/** True when any `/`-separated segment is exactly `.` or `..` (the only real traversal forms). */
function hasDotSegment(path: string): boolean {
  return path.split("/").some((segment) => segment === "." || segment === "..");
}

/**
 * `dotSegmentsOnly` (server-built folder reads only): reject a `.`/`..` SEGMENT instead of any `..`
 * substring, so a folder name like "v1..2" is not mistaken for traversal. Browser requests keep the
 * stricter substring rule.
 */
function normalizeGraphRequestPath(
  path: unknown,
  dotSegmentsOnly = false,
): string | null {
  if (typeof path !== "string" || !path.startsWith("/")) return null;
  const dotted = dotSegmentsOnly ? hasDotSegment(path) : /\.\./.test(path);
  if (dotted || /(?:\/\/|\?|#|\\)/.test(path)) return null;
  if (ENCODED_UNSAFE_PATH.test(path)) return null;
  return normalizePathForScope(path, dotSegmentsOnly);
}

function normalizePathForScope(
  path: string,
  dotSegmentsOnly = false,
): string | null {
  if (ENCODED_UNSAFE_PATH.test(path)) return null;
  try {
    const url = new URL(`${GRAPH_BASE}${path}`);
    if (
      url.origin !== "https://graph.microsoft.com" ||
      !url.pathname.startsWith("/v1.0/")
    ) return null;
    const normalized = url.pathname.slice("/v1.0".length);
    const dotted = dotSegmentsOnly
      ? hasDotSegment(normalized)
      : /\.\./.test(normalized);
    if (
      dotted || /(?:\/\/|\?|#|\\)/.test(normalized) ||
      ENCODED_UNSAFE_PATH.test(normalized)
    ) return null;
    return normalized;
  } catch {
    return null;
  }
}

function isOneDrivePath(path: string): boolean { // mutation-witness:metadata-paths
  // Named metadata endpoints only. Opaque identifiers remain encoded single path segments.
  const id = "[^/?#:]+";
  const drive = `(?:/me/drive|/drives/${id})`;
  return path === "/sites" || path === "/drives" ||
    new RegExp(`^/sites/${id}(?:/drives)?$`, "u").test(path) ||
    new RegExp(`^${drive}(?:/(?:root(?:/children|/search\\(q=[^/]+\\))?|items(?:/${id}(?:/children|/versions)?)?))?$`, "u").test(path) ||
    new RegExp(`^${drive}/items/${id}:/[^/]+$`, "u").test(path);
}

export function scopeCoversPath(
  scopes: string[],
  method: string,
  path: string,
  dotSegmentsOnly = false,
): boolean {
  const normalizedPath = normalizePathForScope(path, dotSegmentsOnly);
  if (!normalizedPath || !isOneDrivePath(normalizedPath)) return false;
  const normalizedMethod = normalizeGraphMethod(method);
  // Reads only: held write scopes never make a mutation permissible here (FR-M365DOC-070).
  if (normalizedMethod !== "GET") return false; // mutation-witness:scope-get-only
  return scopes.some((scope) =>
    ["Files.Read", "Files.ReadWrite", "Files.Read.All", "Files.ReadWrite.All"]
      .includes(scope)
  );
}
