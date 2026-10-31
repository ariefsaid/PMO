// recordFileUpload.ts — `upload_record_file` (ADR-0095, #1474): upload one size-capped file into the record's
// SharePoint folder with the caller's OWN Microsoft connection, and return the reference. The browser then
// persists that reference through the existing repositories; custody never writes a PMO table.
//
// Order is load-bearing and asserted: parse -> membership/entitlement -> writer role -> caller-RLS target ->
// record folder (never created here) -> default library -> quota -> own connection (+ Sites.Selected) -> PUT.
// An unreadable or unwritable target is refused before any connection read or Microsoft call. Microsoft
// availability never turns into a silent private-Storage fallback: every failure is a typed recovery state.

import type { HandlerDeps, HandlerResult } from "./types.ts";
import { M365HandlerError, errorResult } from "./types.ts";
import { authorizeMemberEntitled } from "./auth.ts";
import { failure, isRecord, readDefaultSnapshot, UUID, WRITER_ROLES } from "./recordFolders.ts";
import { graphFailed } from "./documentPreview.ts";
import { createGraphBudget } from "./folderBudget.ts";
import { safeGraphId } from "./graphFolderWrite.ts";
import { sanitizeUploadFileName, validateUploadedItem, validUploadFileName } from "./graphFileUpload.ts";
import { openCallerRecordFileUpload, type UploadOutcome } from "./graphRead.ts";
import { checkRequestRate } from "../_shared/requestRateGuard.ts";
import { logAudit } from "./audit.ts";
import {
  PROC_FILE_PHASES,
  type ProcFilePhase,
  type UploadRecordFileResponse,
  type UploadRecordFileTarget,
} from "../_shared/microsoftDocumentPreview.ts";
import { MAX_FILE_SIZE_BYTES } from "../../../pmo-portal/src/lib/fileConstants.ts";

export interface ParsedUpload {
  target: UploadRecordFileTarget;
  fileName: string;
  bytes: Uint8Array;
}

const PROJECT_FIELDS = "action,file,target_id,target_kind";
const PURCHASE_FIELDS = "action,file,parent_id,phase,target_kind";

/**
 * The multipart contract: exactly the fields of one target kind plus ONE `file` part. The browser-supplied
 * `file.type` is ignored (the content type is derived from the extension), the size is checked from the
 * declared size AND by counting the bytes actually read, and the name is sanitized server-side.
 */
export async function parseUploadRequest(form: FormData): Promise<ParsedUpload | null> {
  const names = [...form.keys()];
  const sorted = [...names].sort().join(",");
  const kind = form.get("target_kind");
  if (form.get("action") !== "upload_record_file") return null;
  let target: UploadRecordFileTarget;
  if (kind === "project_document" && sorted === PROJECT_FIELDS) {
    const id = form.get("target_id");
    if (typeof id !== "string" || !UUID.test(id)) return null;
    target = { kind, id };
  } else if (kind === "procurement_file" && sorted === PURCHASE_FIELDS) {
    const id = form.get("parent_id");
    const phase = form.get("phase");
    if (typeof id !== "string" || !UUID.test(id)) return null;
    if (typeof phase !== "string" || !(PROC_FILE_PHASES as readonly string[]).includes(phase)) return null;
    target = { kind, phase: phase as ProcFilePhase, parent_id: id };
  } else return null;

  const file = form.get("file");
  if (typeof file === "string" || file === null) return null;
  if (file.size <= 0 || file.size > MAX_FILE_SIZE_BYTES) return null; // mutation-witness:upload-size-cap
  const fileName = sanitizeUploadFileName(file.name);
  if (!validUploadFileName(fileName)) return null; // mutation-witness:upload-extension-allowlist
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength <= 0 || bytes.byteLength > MAX_FILE_SIZE_BYTES) return null;
  return { target, fileName, bytes };
}

const DENIED = () => failure(403, "FORBIDDEN", "You cannot upload to this record.");
const NOT_AVAILABLE = () => failure(404, "SOURCE_NOT_FOUND", "This record is not available.");
const UNREADABLE = () => failure(500, "INTERNAL_ERROR", "Could not read the record. Try again.");
const NO_FOLDER = (message: string) => failure(409, "RECORD_FOLDER_UNAVAILABLE", message);

/** The phase parent tables: the same map migration 0349 passes to `guard_procurement_file_path`. */
const PHASE_PARENT = {
  quotation: "procurement_quotations",
  receipt: "procurement_receipts",
  invoice: "procurement_invoices",
  purchase_request: "purchase_requests",
  rfq: "rfqs",
  purchase_order: "purchase_orders",
  payment: "payments",
} as const satisfies Record<ProcFilePhase, string>;

interface FolderScope {
  kind: "project" | "procurement";
  recordId: string;
}

/**
 * The target, read under the caller's JWT. A project document must be a Draft the caller authored (or any
 * Draft for an Admin) that is not already a Microsoft reference: the same predicate the document guard
 * trigger enforces when the reference is persisted, so the upload is refused before it is spent.
 */
async function loadTarget(
  deps: HandlerDeps,
  caller: { orgId: string; role: string },
  target: UploadRecordFileTarget,
): Promise<FolderScope | HandlerResult> {
  const project = target.kind === "project_document";
  const table = project ? "project_documents" : PHASE_PARENT[target.phase];
  const cols = project ? "id,org_id,project_id,status,author_id,source" : "id,org_id,procurement_id";
  const id = project ? target.id : target.parent_id;
  const { data, error } = await deps.callerClient!.from(table).select(cols).eq("id", id).limit(1);
  if (error) return UNREADABLE();
  const row = Array.isArray(data) ? data[0] : undefined;
  if (!isRecord(row) || row.id !== id || row.org_id !== caller.orgId) return NOT_AVAILABLE(); // mutation-witness:upload-org-equality
  if (!project) {
    return typeof row.procurement_id === "string"
      ? { kind: "procurement", recordId: row.procurement_id }
      : NOT_AVAILABLE();
  }
  if (
    row.status !== "Draft" || row.source === "onedrive" ||
    (row.author_id !== deps.userId && caller.role !== "Admin")
  ) return DENIED();
  return typeof row.project_id === "string" ? { kind: "project", recordId: row.project_id } : NOT_AVAILABLE();
}

/** The record's one folder reference: the same oldest-first rule `ensure_record_folder` links. Never created here. */
async function findRecordFolderRef(
  deps: HandlerDeps,
  scope: FolderScope,
): Promise<{ driveId: string; itemId: string } | null | "error"> {
  const project = scope.kind === "project";
  const { data, error } = await deps.callerClient!
    .from(project ? "project_documents" : "procurement_documents")
    .select("ms_drive_id,ms_item_id,ms_linked_at,id")
    .eq(project ? "project_id" : "procurement_id", scope.recordId)
    .eq("source", "onedrive")
    .eq("ms_item_kind", "folder")
    .order("ms_linked_at")
    .order("id")
    .limit(1);
  if (error || !Array.isArray(data)) return "error";
  const row = data[0];
  if (!isRecord(row)) return null;
  return safeGraphId(row.ms_drive_id) && safeGraphId(row.ms_item_id)
    ? { driveId: row.ms_drive_id, itemId: row.ms_item_id }
    : null;
}

async function uploadRateLimited(deps: HandlerDeps): Promise<HandlerResult | null> {
  const rate = await checkRequestRate(deps.serviceClient as never, {
    key: `m365-token-custody:upload:${deps.userId}`, limit: 30, windowSecs: 60,
  });
  if (!rate.exceeded) return null; // mutation-witness:upload-quota
  return {
    status: 429,
    body: { error: "RATE_LIMITED", message: "Too many requests. Try again shortly." },
    headers: { "Content-Type": "application/json", "Retry-After": String(rate.retryAfterSeconds) },
  };
}

export function mapUploadOutcome(
  outcome: UploadOutcome,
  scope: { driveId: string; parentId: string },
): HandlerResult & { reference?: UploadRecordFileResponse["reference"] } {
  switch (outcome.kind) {
    case "ok": {
      const reference = validateUploadedItem(outcome.item, scope);
      if (!reference) return graphFailed();
      const body: UploadRecordFileResponse = { reference };
      return { status: 200, body, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }, reference };
    }
    case "forbidden":
      return failure(403, "SOURCE_ACCESS_DENIED", "Microsoft refused the upload. Check your access to the record folder.");
    case "not_found":
      return NO_FOLDER("The record folder is no longer available in SharePoint.");
    default:
      return outcome.result ?? graphFailed(outcome.retryAfter);
  }
}

export async function handleUploadRecordFile(form: FormData, deps: HandlerDeps): Promise<HandlerResult> {
  const budget = createGraphBudget(30_000);
  const parsed = await parseUploadRequest(form);
  if (!parsed) return failure(400, "BAD_REQUEST", "Cannot upload this file.");

  if (!deps.callerClient) return failure(500, "INTERNAL_ERROR", "caller client missing");
  let caller: { orgId: string; role: string };
  try {
    caller = await authorizeMemberEntitled({
      callerClient: deps.callerClient,
      serviceClient: deps.serviceClient,
      userId: deps.userId,
    });
  } catch (err) {
    if (err instanceof M365HandlerError) return errorResult(err);
    throw err;
  }
  if (!WRITER_ROLES.has(caller.role)) return DENIED(); // mutation-witness:upload-writer-role

  const scope = await loadTarget(deps, caller, parsed.target);
  if ("status" in scope) return scope;

  const folder = await findRecordFolderRef(deps, scope);
  if (folder === "error") return UNREADABLE();
  if (!folder) return NO_FOLDER("This record has no SharePoint folder yet. Create the folder first.");
  const snapshot = await readDefaultSnapshot(deps, caller.orgId);
  if (snapshot === "error") return UNREADABLE();
  if (snapshot === "unset") return NO_FOLDER("Choose the organisation's SharePoint library first.");
  if (folder.driveId !== snapshot.drive_id) { // mutation-witness:upload-folder-in-library
    return NO_FOLDER("The record folder is outside the organisation library.");
  }

  const limited = await uploadRateLimited(deps);
  if (limited) return limited;
  const access = await openCallerRecordFileUpload(deps, snapshot, budget);
  if (!("uploadFile" in access)) return access;

  const result = mapUploadOutcome(
    await access.uploadFile(folder.itemId, parsed.fileName, parsed.bytes),
    { driveId: snapshot.drive_id, parentId: folder.itemId },
  );
  if (result.reference) {
    // Metadata only (no name, path or URL). Best effort by design: the register write that follows is itself audited.
    await logAudit(deps.serviceClient, {
      action: "m365.file_uploaded",
      orgId: caller.orgId,
      actorId: deps.userId,
      entityId: parsed.target.kind === "project_document" ? parsed.target.id : parsed.target.parent_id,
      detail: { kind: parsed.target.kind },
    });
  }
  const { reference: _reference, ...response } = result;
  return response;
}
