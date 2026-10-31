// graphPreview.ts — the ONE Graph call behind `preview_document` (ADR-0095): `driveItem: preview` for a
// server-resolved drive/item. Pure: no I/O, no credential. `buildPreviewRequest` is its only constructor and
// `previewAllowed` is the exact-match allowlist the transport (graphRead.ts) calls IMMEDIATELY before the
// network call. Both take a server-loaded context, never browser JSON; `graph_proxy` stays GET-only.
//
// The `mutation-witness:*` tags are read by scripts/m365-preview-upload-mutation.mjs.

import { safeGraphId } from "./graphFolderWrite.ts";

export interface PreviewContext {
  driveId: string;
  itemId: string;
}
export interface PreviewRequest {
  method: "POST";
  path: string;
  body: Record<string, never>;
}

const valid = (c: PreviewContext) => !!c && safeGraphId(c.driveId) && safeGraphId(c.itemId);
const plain = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(v));

export function buildPreviewRequest(c: PreviewContext): PreviewRequest {
  if (!valid(c)) throw new Error("invalid preview context");
  return {
    method: "POST",
    body: {},
    path: `/drives/${encodeURIComponent(c.driveId)}/items/${encodeURIComponent(c.itemId)}/preview`,
  };
}

export function previewAllowed(request: unknown, c: PreviewContext): boolean { // mutation-witness:preview-allowlist-always-true
  if (!valid(c) || !plain(request)) return false;
  if (Object.keys(request).sort().join(",") !== "body,method,path") return false;
  if (request.method !== "POST") return false; // mutation-witness:preview-method-post
  const m = /^\/drives\/([^/?#]+)\/items\/([^/?#]+)\/preview$/u.exec(String(request.path));
  if (!m || m[1] !== encodeURIComponent(c.driveId)) return false; // mutation-witness:preview-drive-equality
  if (m[2] !== encodeURIComponent(c.itemId)) return false;
  return plain(request.body) && Object.keys(request.body).length === 0; // mutation-witness:preview-body-empty
}

/** Only an embeddable `getUrl` is ever used; a form-post-only answer is "unsupported" (plan Q2). */
export function readPreviewGetUrl(data: unknown): string | null {
  return plain(data) && typeof data.getUrl === "string" ? data.getUrl : null;
}
