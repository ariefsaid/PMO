// documentPreview.ts — `preview_document` (ADR-0095, #1474). The browser sends only a typed document
// identity; the server reads that row under the caller's JWT, derives the drive/item, proves a folder
// child's containment, and asks Graph for an embeddable preview with the caller's OWN connection.
//
// Order is load-bearing and asserted: parse -> membership/entitlement -> caller-RLS source read ->
// own connection + quota -> (folder-child parent-chain proof) -> Graph preview. An unreadable identity is one fixed
// refusal before any connection read, Graph call or signed link.

import type { HandlerDeps, HandlerResult } from "./types.ts";
import { authorizeFolderCaller, failure, isRecord, UUID } from "./recordFolders.ts";
import {
  MAX_NESTED_FOLDERS,
  PROC_FILE_PHASES,
  type PreviewDocumentRequest,
  type PreviewDocumentResponse,
  type ProcFilePhase,
} from "../_shared/microsoftDocumentPreview.ts";
import { itemKind } from "../_shared/microsoftDocumentReference.ts";
import { safeGraphId } from "./graphFolderWrite.ts";
import { type DocumentPreviewAccess, type FolderOutcome, openCallerDocumentPreview, type PreviewOutcome } from "./graphRead.ts";

export { MAX_NESTED_FOLDERS };

export function parsePreviewRequest(body: unknown): PreviewDocumentRequest | null {
  if (!isRecord(body) || body.action !== "preview_document") return null;
  if (typeof body.id !== "string" || !UUID.test(body.id)) return null;
  const keys = Object.keys(body).sort().join(",");
  if (body.kind === "procurement_file") {
    if (keys !== "action,id,kind,phase") return null;
    return (PROC_FILE_PHASES as readonly unknown[]).includes(body.phase)
      ? { action: "preview_document", kind: "procurement_file", phase: body.phase as never, id: body.id }
      : null;
  }
  if (body.kind !== "project_document" && body.kind !== "procurement_document" && body.kind !== "budget_link") return null;
  if (keys === "action,id,kind") return { action: "preview_document", kind: body.kind, id: body.id };
  if (keys === "action,child_item_id,id,kind" && safeGraphId(body.child_item_id)) {
    return { action: "preview_document", kind: body.kind, id: body.id, child_item_id: body.child_item_id };
  }
  return null;
}

// ── caller-RLS source read ────────────────────────────────────────────────────────────────────

const REGISTER = {
  project_document: { table: "project_documents", cols: "id,org_id,source,ms_drive_id,ms_item_id,ms_item_name,ms_item_kind" },
  procurement_document: { table: "procurement_documents", cols: "id,org_id,source,ms_drive_id,ms_item_id,ms_item_name,ms_item_kind" },
  budget_link: { table: "budget_version_document_links", cols: "id,org_id,ms_drive_id,ms_item_id,ms_item_name,ms_item_kind" },
} as const;
export const FILE_TABLE = {
  purchase_request: "purchase_request_files",
  rfq: "rfq_files",
  quotation: "procurement_quotation_files",
  purchase_order: "purchase_order_files",
  receipt: "procurement_receipt_files",
  invoice: "procurement_invoice_files",
  payment: "payment_files",
} as const satisfies Record<ProcFilePhase, string>;
const FILE_COLS = "id,org_id,archived_at,source,ms_drive_id,ms_item_id,ms_item_name";

/** One refusal for every unreadable, absent, foreign or non-Microsoft identity: it names nothing. */
const NOT_AVAILABLE = () => failure(404, "SOURCE_NOT_FOUND", "This document is not available.");
const UNSUPPORTED = () => failure(422, "PREVIEW_UNSUPPORTED", "Preview isn't available for this file.");
const ACCESS_DENIED = () => failure(403, "SOURCE_ACCESS_DENIED", "Your Microsoft account can't open this file.");
const UNREADABLE = () => failure(500, "INTERNAL_ERROR", "Could not read the document. Try again.");

/** Safe upstream-unavailable envelope; `retryAfter` is a capped whole-second hint, never upstream text. */
export function graphFailed(retryAfter?: number): HandlerResult {
  if (retryAfter === undefined) return failure(502, "GRAPH_ERROR", "Graph API request failed");
  return {
    status: 502,
    body: { error: "GRAPH_ERROR", message: "Graph API request failed", retry_after_seconds: retryAfter },
    headers: { "Content-Type": "application/json", "Retry-After": String(retryAfter) },
  };
}

interface Source {
  driveId: string;
  itemId: string;
  name: string;
  isFolder: boolean;
}

const text = (value: unknown): string | null => typeof value === "string" && value.trim() !== "" ? value : null;

/** The row the caller's own JWT can read, in the caller's org, that is a live Microsoft reference. */
async function loadSource(
  deps: HandlerDeps,
  orgId: string,
  req: PreviewDocumentRequest,
): Promise<Source | null | "error"> {
  const isFile = req.kind === "procurement_file";
  const target = isFile ? { table: FILE_TABLE[req.phase], cols: FILE_COLS } : REGISTER[req.kind];
  const { data, error } = await deps.callerClient!.from(target.table).select(target.cols).eq("id", req.id).limit(1);
  if (error) return "error";
  const row = Array.isArray(data) ? data[0] : undefined;
  if (!isRecord(row) || row.id !== req.id || row.org_id !== orgId) return null; // mutation-witness:preview-org-equality
  if (isFile && row.archived_at != null) return null;
  // Budget links are always Microsoft references and have no `source` column.
  if (req.kind !== "budget_link" && row.source !== "onedrive") return null; // mutation-witness:preview-source-onedrive
  const driveId = text(row.ms_drive_id);
  const itemId = text(row.ms_item_id);
  const name = text(row.ms_item_name);
  if (!driveId || !itemId || !name) return null;
  const kind = isFile ? "file" : row.ms_item_kind;
  if (kind !== "file" && kind !== "folder") return null;
  return { driveId, itemId, name, isFolder: kind === "folder" };
}

// ── outcome mapping ───────────────────────────────────────────────────────────────────────────

export function mapPreviewOutcome(outcome: PreviewOutcome, name: string): HandlerResult {
  switch (outcome.kind) {
    case "ok": {
      const body: PreviewDocumentResponse = { name, get_url: outcome.url };
      // The URL is a short-lived capability: it is never cached by the browser, a proxy or a log.
      return { status: 200, body, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } };
    }
    case "forbidden":
      return ACCESS_DENIED();
    case "not_found":
      return NOT_AVAILABLE();
    case "unsupported":
      return UNSUPPORTED();
    default:
      return outcome.result ?? graphFailed(outcome.retryAfter);
  }
}

/** A failed metadata read: 403 is the account-access state, 404 the fixed refusal, anything else upstream-unavailable. */
function readRefusal(read: Exclude<FolderOutcome, { kind: "ok" }>): HandlerResult {
  if (read.kind === "forbidden") return ACCESS_DENIED();
  if (read.kind === "unavailable") return read.result ?? graphFailed(read.retryAfter);
  return NOT_AVAILABLE();
}

/**
 * A folder child is previewable only as a FILE inside the referenced folder: its Graph parent chain, read
 * server-side by id under the caller's own connection, must reach the referenced folder in the same drive
 * within MAX_NESTED_FOLDERS sub-folders. The browser supplies only the child id; every ancestor id comes from
 * Microsoft metadata, never from a client path. Returns the child's name, or the refusal.
 */
async function fileInsideFolder(access: DocumentPreviewAccess, childId: string, source: Source): Promise<string | HandlerResult> {
  const read = await access.readItem(source.driveId, childId);
  if (read.kind !== "ok") return readRefusal(read);
  const name = text(read.item.name);
  if (read.item.id !== childId || itemKind(read.item) !== "file" || !name) return NOT_AVAILABLE();
  let parent = read.item.parentReference;
  for (let hops = 0;; hops += 1) {
    if (!isRecord(parent) || parent.driveId !== source.driveId) return NOT_AVAILABLE(); // mutation-witness:preview-ancestor-drive
    const parentId = typeof parent.id === "string" ? parent.id : "";
    if (parentId !== "" && parentId === source.itemId) return name; // mutation-witness:preview-child-parent
    // No parent id means the drive root was passed: the file is outside the referenced folder.
    if (!safeGraphId(parentId)) return NOT_AVAILABLE(); // mutation-witness:preview-ancestor-id
    if (hops >= MAX_NESTED_FOLDERS) return NOT_AVAILABLE(); // mutation-witness:preview-ancestor-bound
    const up = await access.readItem(source.driveId, parentId);
    if (up.kind !== "ok") return readRefusal(up);
    if (up.item.id !== parentId || itemKind(up.item) !== "folder") return NOT_AVAILABLE(); // mutation-witness:preview-ancestor-folder
    parent = up.item.parentReference;
  }
}

export async function handlePreviewDocument(body: unknown, deps: HandlerDeps): Promise<HandlerResult> {
  const req = parsePreviewRequest(body);
  if (!req) return failure(400, "BAD_REQUEST", "Cannot preview this document.");

  const caller = await authorizeFolderCaller(deps, () => true); // mutation-witness:preview-membership
  if ("status" in caller) return caller;

  const source = await loadSource(deps, caller.orgId, req);
  if (source === "error") return UNREADABLE();
  if (!source) return NOT_AVAILABLE(); // mutation-witness:preview-source-required
  const childId = "child_item_id" in req ? req.child_item_id : undefined;
  if (childId && !source.isFolder) return NOT_AVAILABLE();
  if (!childId && source.isFolder) return UNSUPPORTED();

  const access = await openCallerDocumentPreview(deps);
  if (!("previewItem" in access)) return access;

  let target = { itemId: source.itemId, name: source.name };
  if (childId) {
    const name = await fileInsideFolder(access, childId, source);
    if (typeof name !== "string") return name;
    target = { itemId: childId, name };
  }
  return mapPreviewOutcome(await access.previewItem(source.driveId, target.itemId), target.name);
}
