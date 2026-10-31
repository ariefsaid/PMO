// documentPreview.ts — `preview_document` (ADR-0095, #1474). The browser sends only a typed document
// identity; the server reads that row under the caller's JWT, derives the drive/item, proves a folder
// child's parentage, and asks Graph for an embeddable preview with the caller's OWN connection.
//
// Order is load-bearing and asserted: parse -> membership/entitlement -> caller-RLS source read ->
// own connection + quota -> (folder-child proof) -> Graph preview. An unreadable identity is one fixed
// refusal before any connection read, Graph call or signed link.

import type { HandlerDeps, HandlerResult } from "./types.ts";
import { authorizeFolderCaller, failure, isRecord, UUID } from "./recordFolders.ts";
import {
  PROC_FILE_PHASES,
  type PreviewDocumentRequest,
  type PreviewDocumentResponse,
  type ProcFilePhase,
} from "../_shared/microsoftDocumentPreview.ts";
import { itemKind } from "../_shared/microsoftDocumentReference.ts";
import { safeGraphId } from "./graphFolderWrite.ts";
import { type FolderOutcome, openCallerDocumentPreview, type PreviewOutcome } from "./graphRead.ts";

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

/** A folder child is previewable only as a direct FILE child of the referenced folder, in the same drive. */
function directFileChild(item: Record<string, unknown>, source: Source): string | null {
  if (itemKind(item) !== "file") return null;
  const parent = item.parentReference;
  if (!isRecord(parent)) return null;
  if (parent.driveId !== source.driveId || parent.id !== source.itemId) return null; // mutation-witness:preview-child-parent
  return text(item.name);
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
    const read: FolderOutcome = await access.readItem(source.driveId, childId);
    if (read.kind !== "ok") {
      return read.kind === "forbidden"
        ? ACCESS_DENIED()
        : read.kind === "unavailable"
        ? (read.result ?? graphFailed(read.retryAfter))
        : NOT_AVAILABLE();
    }
    const name = directFileChild(read.item, source);
    if (!name) return NOT_AVAILABLE();
    target = { itemId: childId, name };
  }
  return mapPreviewOutcome(await access.previewItem(source.driveId, target.itemId), target.name);
}
