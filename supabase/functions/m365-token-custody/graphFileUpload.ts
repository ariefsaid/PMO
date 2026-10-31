// graphFileUpload.ts — the ONE Graph file write PMO performs (ADR-0095): a simple content PUT of a
// size-capped file into a server-chosen record folder, renaming on conflict so it can never overwrite.
// Pure: no I/O, no credential. `buildUploadRequest` is its only constructor and `uploadAllowed` is the
// exact-match allowlist the upload transport (graphRead.ts) calls IMMEDIATELY before the network call. Both
// take a server-loaded context; the browser never supplies a drive, parent, path, content type or conflict mode.
//
// The `mutation-witness:*` tags are read by scripts/m365-preview-upload-mutation.mjs.

import {
  ALLOWED_FILE_TYPES,
  DENIED_EXTENSIONS,
  FILE_MIME_BY_EXT,
  MAX_FILE_SIZE_BYTES,
} from "../../../pmo-portal/src/lib/fileConstants.ts";
import { safeGraphId } from "./graphFolderWrite.ts";
import {
  itemKind,
  type MicrosoftReferenceInput,
  validMicrosoftBrowserUrl,
} from "../_shared/microsoftDocumentReference.ts";

export interface UploadContext {
  driveId: string;
  parentId: string;
  fileName: string;
  bytes: number;
}
export interface UploadRequest {
  method: "PUT";
  path: string;
  query: string;
  contentType: string;
  size: number;
}

const MAX_NAME_CODE_POINTS = 120;
const CONFLICT_QUERY = "@microsoft.graph.conflictBehavior=rename";
const RESERVED = /[\\/:*?"<>|#%\u0000-\u001f\u007f]/gu;

const extensionOf = (name: string): string => {
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot).toLowerCase();
};

/** NFC, reserved and control characters become a space, dot runs and edge dots/spaces are dropped, <= 120 code points. */
export function sanitizeUploadFileName(raw: string): string {
  let name = String(raw).normalize("NFC").replace(RESERVED, " ").replace(/\.{2,}/gu, " ")
    .replace(/\s+/gu, " ").replace(/^[\s.]+|[\s.]+$/gu, "");
  const points = Array.from(name);
  if (points.length > MAX_NAME_CODE_POINTS) {
    const ext = extensionOf(name);
    const keep = ext && ext.length <= 10 ? ext.length : 0;
    const base = points.slice(0, points.length - keep).slice(0, MAX_NAME_CODE_POINTS - keep).join("")
      .replace(/[\s.]+$/gu, "");
    name = base + (keep ? name.slice(name.length - keep) : "");
  }
  return name;
}

/** Server policy: the name is already sanitized, bounded, and its extension is allowed and not denied. */
function validName(name: unknown): name is string {
  if (typeof name !== "string" || name === "" || sanitizeUploadFileName(name) !== name) return false;
  const ext = extensionOf(name);
  return ALLOWED_FILE_TYPES.includes(ext) && !DENIED_EXTENSIONS.includes(ext) && ext in FILE_MIME_BY_EXT;
}

function valid(c: UploadContext): boolean {
  return !!c && safeGraphId(c.driveId) && safeGraphId(c.parentId) && validName(c.fileName) &&
    Number.isInteger(c.bytes) && c.bytes > 0 && c.bytes <= MAX_FILE_SIZE_BYTES; // mutation-witness:upload-size-cap
}

const plain = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(v));

export function buildUploadRequest(c: UploadContext): UploadRequest {
  if (!valid(c)) throw new Error("invalid upload context");
  return {
    method: "PUT",
    path: `/drives/${encodeURIComponent(c.driveId)}/items/${encodeURIComponent(c.parentId)}:/${
      encodeURIComponent(c.fileName)
    }:/content`,
    query: CONFLICT_QUERY,
    contentType: FILE_MIME_BY_EXT[extensionOf(c.fileName)]!,
    size: c.bytes,
  };
}

/** True ONLY for the exact server-built request for this context; every other shape is false. */
export function uploadAllowed(request: unknown, c: UploadContext): boolean { // mutation-witness:upload-allowlist-always-true
  if (!valid(c) || !plain(request)) return false;
  if (Object.keys(request).sort().join(",") !== "contentType,method,path,query,size") return false;
  if (request.method !== "PUT") return false; // mutation-witness:upload-method-put
  if (request.query !== CONFLICT_QUERY) return false; // mutation-witness:upload-conflict-rename
  const m = /^\/drives\/([^/?#]+)\/items\/([^/?#]+):\/([^/?#:]+):\/content$/u.exec(String(request.path));
  if (!m || m[1] !== encodeURIComponent(c.driveId) || m[2] !== encodeURIComponent(c.parentId)) return false;
  if (m[3] !== encodeURIComponent(c.fileName)) return false;
  if (!ALLOWED_FILE_TYPES.includes(extensionOf(c.fileName))) return false; // mutation-witness:upload-extension-allowlist
  if (request.contentType !== FILE_MIME_BY_EXT[extensionOf(c.fileName)]) return false;
  return request.size === c.bytes && c.bytes <= MAX_FILE_SIZE_BYTES;
}

/** The returned item is the reference only when it is a file directly under the chosen parent, in the chosen drive. */
export function validateUploadedItem(
  raw: unknown,
  scope: { driveId: string; parentId: string },
): MicrosoftReferenceInput | null {
  if (!plain(raw) || itemKind(raw) !== "file") return null;
  const parent = raw.parentReference;
  if (!plain(parent) || parent.driveId !== scope.driveId || parent.id !== scope.parentId) return null;
  if (!safeGraphId(raw.id) || typeof raw.name !== "string" || raw.name.trim() === "") return null;
  if (!validMicrosoftBrowserUrl(raw.webUrl)) return null;
  return { drive_id: scope.driveId, item_id: raw.id, web_url: raw.webUrl, name: raw.name, item_kind: "file" };
}
