// recordFolders.ts — `ensure_record_folder` (ADR-0089, FR-M365DOC-069..073).
//
// Ensure and link ONE reference-only Microsoft folder for a project or procurement case, with the caller's
// OWN Microsoft connection, without ever making Microsoft availability a condition of saving the record.
// The browser sends only `{action, kind, id}`; the server loads the parent under the caller's RLS, derives
// the name/ancestors/drive/parent, builds the single folder POST itself and links through a caller-RLS RPC.
//
// Order is load-bearing: parse -> membership/entitlement -> writer role -> caller-RLS parent -> existing
// folder no-op (NO connection/settings/Graph) -> default library -> identifier -> rate limit -> own
// connection (+ the Sites.Selected consent) -> convention-parent discovery -> link a single match | ask for
// a choice | create. One 12-second deadline, started with the handler, bounds the whole invocation.

import type { HandlerDeps, HandlerResult } from "./types.ts";
import { M365HandlerError, errorResult } from "./types.ts";
import { authorizeMemberEntitled } from "./auth.ts";
import {
  openCallerRecordFolderAccess,
  type RecordFolderEnsureAccess,
  type RecordFolderLibrary,
  type RecordFolderReadAccess,
} from "./graphRead.ts";
import { createGraphBudget, type GraphBudget } from "./folderBudget.ts";
import { createFolderDiscovery, type FolderDiscovery } from "./recordFolderSearch.ts";
import { checkRequestRate } from "../_shared/requestRateGuard.ts";
import {
  type CreatedFolderHook,
  ensureConventionParents,
  type ParentFailure,
  resolveOrCreateFolder,
  verifyDriveBelongsToSite,
} from "./recordFolderParents.ts";
import { validFolderWriteName } from "./graphFolderWrite.ts";
import {
  type EnsureRecordFolderRequest,
  type RecordFolderOutcome,
  type RecordFolderTarget,
  safeRecordFolderName,
} from "../_shared/microsoftRecordFolder.ts";
import { recordFolderConvention } from "../_shared/microsoftFolderConvention.ts";
import type { MicrosoftReferenceInput } from "../_shared/microsoftDocumentReference.ts";

const HEADERS = { "Content-Type": "application/json" };
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
export const WRITER_ROLES = new Set(["Admin", "Executive", "Project Manager", "Finance"]);
const CONTROL = /[\u0000-\u001f\u007f]/u;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function failure(
  status: number,
  error: string,
  message: string,
): HandlerResult {
  return { status, body: { error, message }, headers: HEADERS };
}

const DENIED = () =>
  failure(403, "FORBIDDEN", "You cannot create a folder for this record.");
const NO_PARENT_READ = () =>
  failure(500, "INTERNAL_ERROR", "Could not read the record. Try again.");
/** Safe upstream-unavailable envelope; `retryAfter` is a capped whole-second hint, never upstream text. */
const GRAPH_FAILED = (retryAfter?: number): HandlerResult => {
  if (retryAfter === undefined) return failure(502, "GRAPH_ERROR", "Graph API request failed");
  return {
    status: 502,
    body: { error: "GRAPH_ERROR", message: "Graph API request failed", retry_after_seconds: retryAfter },
    headers: { ...HEADERS, "Retry-After": String(retryAfter) },
  };
};

// ── request parsing ───────────────────────────────────────────────────────────

export function parseEnsureRequest(body: unknown): EnsureRecordFolderRequest | null {
  if (!isRecord(body)) return null;
  const keys = Object.keys(body).sort().join(",");
  if (keys !== "action,id,kind" || body.action !== "ensure_record_folder") return null;
  if (body.kind !== "project" && body.kind !== "procurement") return null;
  if (typeof body.id !== "string" || !UUID.test(body.id)) return null;
  return { action: "ensure_record_folder", kind: body.kind, id: body.id };
}

// ── caller-RLS reads ──────────────────────────────────────────────────────────

export interface FolderIdentity {
  convention: { term: string; parentSegments: string[] };
  name: string;
}

export interface DefaultSnapshot extends RecordFolderLibrary {
  updated_at: string;
}

type RecordLoad =
  | { state: "ok"; identity: FolderIdentity | null }
  | { state: "denied" }
  | { state: "error" };

const nonEmpty = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value : null;

/** Project: `coalesce(code, pmo_project_number)` + `name`. Case: `coalesce(pr_number, code)` + `title`, UTC creation year. */
function identityFor(
  target: RecordFolderTarget,
  row: Record<string, unknown>,
): FolderIdentity | null {
  const number = target.kind === "project"
    ? nonEmpty(row.code) ?? nonEmpty(row.pmo_project_number)
    : nonEmpty(row.pr_number) ?? nonEmpty(row.code);
  if (!number) return null;
  const subject = (target.kind === "project" ? row.name : row.title);
  const subjectText = typeof subject === "string" ? subject : "";
  if (CONTROL.test(number) || CONTROL.test(subjectText)) return null;
  const convention = recordFolderConvention(
    target.kind === "project"
      ? { kind: "project", code: number }
      : {
        kind: "procurement",
        request_number: number,
        created_at: String(row.created_at ?? ""),
      },
  );
  if (!convention) return null;
  const name = safeRecordFolderName(`${number.trim()} ${subjectText}`);
  if (
    !validFolderWriteName(name) ||
    !name.toLocaleLowerCase("en").startsWith(convention.term.toLocaleLowerCase("en"))
  ) return null;
  return { convention, name };
}

export async function loadRecord(
  deps: HandlerDeps,
  orgId: string,
  target: RecordFolderTarget,
): Promise<RecordLoad> {
  const columns = target.kind === "project"
    ? "id,org_id,code,pmo_project_number,name"
    : "id,org_id,code,pr_number,title,created_at";
  const { data, error } = await deps.callerClient!
    .from(target.kind === "project" ? "projects" : "procurements")
    .select(columns)
    .eq("id", target.id)
    .limit(1);
  if (error) return { state: "error" };
  const row = Array.isArray(data) ? data[0] : undefined;
  if (!isRecord(row) || row.id !== target.id || row.org_id !== orgId) {
    return { state: "denied" };
  }
  return { state: "ok", identity: identityFor(target, row) };
}

/** Any folder reference in the record's own register (files / legacy URLs do not count). */
export async function findExistingFolder(
  deps: HandlerDeps,
  target: RecordFolderTarget,
): Promise<{ id: string } | null | "error"> {
  const project = target.kind === "project";
  const { data, error } = await deps.callerClient!
    .from(project ? "project_documents" : "procurement_documents")
    .select("id,ms_linked_at")
    .eq(project ? "project_id" : "procurement_id", target.id)
    .eq("source", "onedrive")
    .eq("ms_item_kind", "folder")
    .order("ms_linked_at")
    .order("id")
    .limit(1);
  if (error || !Array.isArray(data)) return "error";
  const row = data[0];
  return isRecord(row) && typeof row.id === "string" ? { id: row.id } : null;
}

export async function readDefaultSnapshot(
  deps: HandlerDeps,
  orgId: string,
): Promise<DefaultSnapshot | "unset" | "error"> {
  const { data, error } = await deps.callerClient!
    .from("org_m365_document_settings")
    .select("default_site_id,default_drive_id,updated_at")
    .eq("org_id", orgId)
    .limit(1);
  if (error) {
    return (error as { code?: string }).code === "42501" ? "unset" : "error";
  }
  const row = Array.isArray(data) ? data[0] : undefined;
  if (
    !isRecord(row) || !nonEmpty(row.default_site_id) ||
    !nonEmpty(row.default_drive_id) || !nonEmpty(row.updated_at)
  ) return "unset";
  return {
    site_id: row.default_site_id as string,
    drive_id: row.default_drive_id as string,
    updated_at: row.updated_at as string,
  };
}

// ── guarded link + durable receipt ────────────────────────────────────────────

export type LinkFailure = "forbidden" | "default_changed" | "invalid" | "error";

/** Caller-RLS, serialized check-and-insert; the typed link audit comes from the register triggers. */
export async function linkFolderReference(
  deps: HandlerDeps,
  target: RecordFolderTarget,
  reference: MicrosoftReferenceInput,
  snapshot: DefaultSnapshot,
): Promise<
  { ok: true; document_id: string; state: "linked" | "already_linked" } | { ok: true; state: "needs_choice" } | {
    ok: false;
    failure: LinkFailure;
  }
> {
  const { data, error } = await deps.callerClient!.rpc("m365_link_record_folder", {
    p_kind: target.kind,
    p_record_id: target.id,
    p_reference: {
      drive_id: reference.drive_id,
      item_id: reference.item_id,
      web_url: reference.web_url,
      name: reference.name,
      item_kind: "folder",
    },
    p_default_site_id: snapshot.site_id,
    p_default_drive_id: snapshot.drive_id,
    p_settings_updated_at: snapshot.updated_at,
  });
  if (error) {
    const err = error as { code?: string; message?: string; details?: string };
    if (err.code === "42501") return { ok: false, failure: "forbidden" };
    if (
      err.code === "23514" &&
      `${err.details ?? ""} ${err.message ?? ""}`.includes("default")
    ) return { ok: false, failure: "default_changed" };
    if (err.code === "22023") return { ok: false, failure: "invalid" };
    return { ok: false, failure: "error" };
  }
  // The folder is already linked to ANOTHER record of this kind: nothing was inserted; ask the user.
  if (isRecord(data) && data.state === "needs_choice") return { ok: true, state: "needs_choice" };
  if (
    !isRecord(data) || typeof data.document_id !== "string" || !data.document_id ||
    (data.state !== "linked" && data.state !== "already_linked")
  ) return { ok: false, failure: "error" };
  return { ok: true, document_id: data.document_id, state: data.state };
}

/** Durable creation receipt (service-only RPC). A failure here stops the operation: no receipt, no link. */
export function recordFolderCreatedFor(
  deps: HandlerDeps,
  target: RecordFolderTarget,
): CreatedFolderHook {
  return async (item) => {
    const { error } = await deps.serviceClient.rpc("m365_record_folder_created", {
      p_actor_id: deps.userId,
      p_kind: target.kind,
      p_record_id: target.id,
      p_drive_id: item.drive_id,
      p_item_id: item.item_id,
    });
    return !error;
  };
}

// ── match (shared by ensure and the Admin match-only sweep) ───────────────────

export type MatchResult =
  | { kind: "linked" | "already_linked"; document_id: string }
  | { kind: "needs_choice" }
  | { kind: "absent" }
  | { kind: "search_failed"; connection: HandlerResult | null; retryAfter?: number }
  | { kind: "link_failed"; failure: LinkFailure };

/**
 * Folders (of this kind, in this org) already linked to a DIFFERENT record: two records must never silently
 * share one folder. Read under the caller's RLS as a courtesy filter; the guarded link RPC is the authority.
 */
async function linkedElsewhere(
  deps: HandlerDeps,
  target: RecordFolderTarget,
  driveId: string,
  itemIds: string[],
): Promise<Set<string>> {
  const project = target.kind === "project";
  const { data, error } = await deps.callerClient!
    .from(project ? "project_documents" : "procurement_documents")
    .select("ms_item_id")
    .eq("source", "onedrive")
    .eq("ms_item_kind", "folder")
    .eq("ms_drive_id", driveId)
    .in("ms_item_id", itemIds)
    .neq(project ? "project_id" : "procurement_id", target.id);
  const taken = new Set<string>();
  if (error || !Array.isArray(data)) return taken;
  for (const row of data) {
    if (isRecord(row) && typeof row.ms_item_id === "string") taken.add(row.ms_item_id);
  }
  return taken;
}

/**
 * Discover the record's folder under its convention parent and link a SINGLE match. It receives only the
 * read-only discovery, so the match-only sweep can share it with ensure without any way to create or
 * resolve a parent.
 */
export async function matchAndLinkRecord(
  deps: HandlerDeps,
  target: RecordFolderTarget,
  identity: FolderIdentity,
  snapshot: DefaultSnapshot,
  discovery: FolderDiscovery,
): Promise<MatchResult> {
  const found = await discovery.find(identity.convention);
  if (!found.complete) {
    return { kind: "search_failed", connection: found.result ?? null, retryAfter: found.retryAfter };
  }
  let matches = found.matches;
  if (matches.length > 0) {
    const taken = await linkedElsewhere(deps, target, snapshot.drive_id, matches.map((m) => m.item_id));
    matches = matches.filter((m) => !taken.has(m.item_id)); // mutation-witness:exclude-shared
  }
  if (matches.length === 0) return { kind: "absent" };
  if (matches.length > 1) return { kind: "needs_choice" };
  const linked = await linkFolderReference(deps, target, matches[0]!, snapshot);
  if (!linked.ok) return { kind: "link_failed", failure: linked.failure };
  return linked.state === "needs_choice" ? { kind: "needs_choice" } : { kind: linked.state, document_id: linked.document_id };
}

// ── response mapping ──────────────────────────────────────────────────────────

export function outcomeResult(outcome: RecordFolderOutcome): HandlerResult {
  return { status: 200, body: outcome, headers: HEADERS };
}

export function linkFailureResult(failureKind: LinkFailure): HandlerResult {
  if (failureKind === "forbidden") return DENIED();
  if (failureKind === "default_changed") {
    return failure(502, "GRAPH_ERROR", "The default library changed. Try again.");
  }
  return failure(502, "GRAPH_ERROR", "The folder could not be linked. Try again.");
}

function parentFailureResult(parent: ParentFailure): HandlerResult {
  switch (parent.kind) {
    case "forbidden":
      return failure(403, "FORBIDDEN", "Microsoft denied folder creation access.");
    case "audit_failed":
      return failure(502, "GRAPH_ERROR", "The folder was created but could not be recorded. Try again.");
    case "refused":
      return failure(502, "GRAPH_ERROR", "The Microsoft folder structure prevents creating this folder.");
    default:
      return parent.result ?? GRAPH_FAILED(parent.retryAfter);
  }
}

/** Per-user throttle (availability guard, fail-open like every request-rate limiter): 429 when exceeded. */
export async function folderRateLimited(
  deps: HandlerDeps,
  action: "ensure_record_folder" | "link_existing_record_folders",
  limit: number,
): Promise<HandlerResult | null> {
  const rate = await checkRequestRate(deps.serviceClient as never, {
    key: `m365-token-custody:${action}:${deps.userId}`,
    limit,
    windowSecs: 10 * 60,
  });
  if (!rate.exceeded) return null; // mutation-witness:rate-limit
  return {
    status: 429,
    body: { error: "RATE_LIMITED", message: "Too many requests. Try again shortly." },
    headers: { ...HEADERS, "Retry-After": String(rate.retryAfterSeconds) },
  };
}

// ── ensure ────────────────────────────────────────────────────────────────────

/** Authenticated writer for the caller's org, or the safe error result. */
export async function authorizeFolderCaller(
  deps: HandlerDeps,
  requireRole: (role: string) => boolean,
): Promise<{ orgId: string } | HandlerResult> {
  if (!deps.callerClient) {
    return failure(500, "INTERNAL_ERROR", "caller client missing");
  }
  try {
    const { orgId, role } = await authorizeMemberEntitled({
      callerClient: deps.callerClient,
      serviceClient: deps.serviceClient,
      userId: deps.userId,
    });
    return requireRole(role) ? { orgId } : DENIED();
  } catch (err) {
    if (err instanceof M365HandlerError) return errorResult(err);
    throw err;
  }
}

export async function handleEnsureRecordFolder(
  body: unknown,
  deps: HandlerDeps,
): Promise<HandlerResult> {
  // The ONE deadline for this invocation starts here and is threaded through every Graph call and the refresh.
  const budget = createGraphBudget();
  const request = parseEnsureRequest(body);
  if (!request) {
    return failure(400, "BAD_REQUEST", "Cannot create a folder for this record.");
  }
  const target: RecordFolderTarget = { kind: request.kind, id: request.id };

  const caller = await authorizeFolderCaller(deps, (role) => WRITER_ROLES.has(role));
  if ("status" in caller) return caller;

  const record = await loadRecord(deps, caller.orgId, target);
  if (record.state === "denied") return DENIED();
  if (record.state === "error") return NO_PARENT_READ();

  // A record that already has a folder reference is left alone: no connection, settings or Graph work.
  const existing = await findExistingFolder(deps, target);
  if (existing === "error") return NO_PARENT_READ();
  if (existing) {
    return outcomeResult({ state: "already_linked", document_id: existing.id });
  }

  const snapshot = await readDefaultSnapshot(deps, caller.orgId);
  if (snapshot === "error") return NO_PARENT_READ();
  if (snapshot === "unset") return outcomeResult({ state: "default_unset" });
  if (!record.identity) return outcomeResult({ state: "missing_identifier" });
  const identity = record.identity;

  const limited = await folderRateLimited(deps, "ensure_record_folder", 30);
  if (limited) return limited;
  const access = await openCallerRecordFolderAccess(deps, snapshot, "ensure", budget);
  if (!("createFolder" in access)) return access;

  const match = await matchAndLinkRecord(deps, target, identity, snapshot, createFolderDiscovery(access, snapshot.drive_id));
  switch (match.kind) {
    case "linked":
    case "already_linked":
      return outcomeResult({ state: match.kind, document_id: match.document_id });
    case "needs_choice":
      return outcomeResult({ state: "needs_choice" });
    case "search_failed":
      return match.connection ?? GRAPH_FAILED(match.retryAfter);
    case "link_failed":
      return linkFailureResult(match.failure);
    case "absent":
      return await createAndLink(deps, target, caller.orgId, identity, snapshot, access, budget);
  }
}

async function createAndLink(
  deps: HandlerDeps,
  target: RecordFolderTarget,
  orgId: string,
  identity: FolderIdentity,
  snapshot: DefaultSnapshot,
  access: RecordFolderEnsureAccess,
  budget: GraphBudget,
): Promise<HandlerResult> {
  // The configured drive must belong to the configured default site before any write.
  const membership = await verifyDriveBelongsToSite(access, snapshot);
  if (membership.state !== "member") {
    return membership.result ?? GRAPH_FAILED();
  }
  if (budget.remaining() <= 0) return GRAPH_FAILED(); // never start the write stage past the deadline
  // Best-effort pre-write comparison; the link RPC re-fences strictly inside its transaction.
  const current = await readDefaultSnapshot(deps, orgId);
  if (
    current === "error" || current === "unset" ||
    current.site_id !== snapshot.site_id || current.drive_id !== snapshot.drive_id ||
    current.updated_at !== snapshot.updated_at
  ) return linkFailureResult("default_changed");

  const onCreated = recordFolderCreatedFor(deps, target);
  const parents = await ensureConventionParents(
    access,
    snapshot.drive_id,
    identity.convention.parentSegments,
    onCreated,
  );
  if (!parents.ok) return parentFailureResult(parents.failure);
  const leaf = await resolveOrCreateFolder(
    access,
    snapshot.drive_id,
    parents.parentId,
    identity.name,
    false,
    onCreated,
    true, // FR-073: a 409 winner after our own POST still gets the creation receipt
  );
  if (!leaf.ok) return parentFailureResult(leaf.failure);

  const linked = await linkFolderReference(deps, target, leaf.item, snapshot);
  if (!linked.ok) return linkFailureResult(linked.failure);
  if (linked.state === "needs_choice") return outcomeResult({ state: "needs_choice" });
  // `created` only for THIS invocation's leaf 201; a conflict winner or a racing link is not.
  const state = leaf.created && linked.state === "linked" ? "created" : linked.state;
  return outcomeResult({ state, document_id: linked.document_id });
}
