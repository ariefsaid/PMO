// graphFolderWrite.ts — the ONE Microsoft Graph write PMO performs (ADR-0089, FR-M365DOC-070): create
// an empty folder under a server-chosen parent in the org's default drive. Pure: no I/O, no credential.
//
// `buildFolderCreateRequest` is the only constructor of this request and `folderWriteAllowed` is the
// exact-match allowlist the folder transport (graphRead.ts) calls IMMEDIATELY before the network call.
// Both take a server-loaded `FolderWriteContext` — never browser JSON. A browser `graph_proxy` request
// can never reach this path: that surface is GET-only (graphRead.ts::validateGraphProxyInput).
//
// The `mutation-witness:*` tags are read by scripts/m365-record-folder-write-mutation.mjs, which breaks
// each tagged predicate in turn and requires recordFolderWrite.test.ts to go red.

import { sanitizeRecordFolderName } from "../_shared/microsoftRecordFolder.ts";

/** Server-loaded and immutable for one invocation. */
export interface FolderWriteContext {
  driveId: string;
  parentId: string;
  name: string;
}

export interface FolderCreateRequest {
  method: "POST";
  path: string;
  body: {
    name: string;
    folder: Record<string, never>;
    "@microsoft.graph.conflictBehavior": "fail";
  };
}

const MAX_NAME_CODE_POINTS = 120;
const MAX_ID_LENGTH = 512;
const CONTROL = /[\u0000-\u001f\u007f]/u;
// Safe, opaque Graph identifier: no separator, whitespace, percent (no encoded equivalents), query,
// fragment or control characters, and never a dot segment.
const SAFE_ID = /^[^\s/\\%?#\u0000-\u001f\u007f]+$/u;

export function safeGraphId(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_ID_LENGTH &&
    SAFE_ID.test(value) && !/^\.+$/u.test(value);
}

/** A name the builder may send: already sanitized, nonempty, bounded, no control bytes. */
export function validFolderWriteName(value: unknown): value is string {
  return typeof value === "string" && value !== "" && !CONTROL.test(value) &&
    Array.from(value).length <= MAX_NAME_CODE_POINTS &&
    sanitizeRecordFolderName(value) === value;
}

function validContext(context: FolderWriteContext): boolean {
  return !!context && safeGraphId(context.driveId) &&
    safeGraphId(context.parentId) && validFolderWriteName(context.name);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]);
}

/** Builds the exact folder-only POST. Throws on an unsafe context so a bad context never leaves custody. */
export function buildFolderCreateRequest(
  context: FolderWriteContext,
): FolderCreateRequest {
  if (!validContext(context)) throw new Error("invalid folder write context");
  return {
    method: "POST",
    path: `/drives/${encodeURIComponent(context.driveId)}/items/${
      encodeURIComponent(context.parentId)
    }/children`,
    body: {
      name: context.name,
      folder: {},
      "@microsoft.graph.conflictBehavior": "fail",
    },
  };
}

/**
 * True ONLY for the exact server-built request for this context. Every other shape — file/upload/content
 * bodies, other drive/parent/name, other methods, extra keys/headers/query, rename/replace conflict
 * behaviour, a non-empty folder facet, unsafe identifiers — is false.
 */
export function folderWriteAllowed(request: unknown, context: FolderWriteContext): boolean { // mutation-witness:allowlist-always-true
  if (!validContext(context)) return false;
  if (!isPlainObject(request) || !exactKeys(request, ["method", "path", "body"])) return false;
  if (request.method !== "POST") return false; // mutation-witness:method-post
  if (typeof request.path !== "string") return false;
  const match = /^\/drives\/([^/?#]+)\/items\/([^/?#]+)\/children$/u.exec(request.path);
  if (!match) return false;
  if (match[1] !== encodeURIComponent(context.driveId)) return false; // mutation-witness:drive-equality
  if (match[2] !== encodeURIComponent(context.parentId)) return false;
  const body = request.body;
  if (!isPlainObject(body)) return false;
  if (!exactKeys(body, ["name", "folder", "@microsoft.graph.conflictBehavior"])) return false;
  if (body.name !== context.name) return false;
  if (!isPlainObject(body.folder) || Object.keys(body.folder).length !== 0) return false;
  return body["@microsoft.graph.conflictBehavior"] === "fail";
}
