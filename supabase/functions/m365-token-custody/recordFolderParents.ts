// recordFolderParents.ts — default-drive binding, convention ancestors and race-safe leaf creation for
// ensure_record_folder (ADR-0089). Every write goes through the access object's single `createFolder`
// mutator; this module never builds a Graph request itself and never touches a credential.
//
// Only the signed convention path is ever created: `Projects`, `Procurement`, `<UTC year>` and the
// record's own folder. A precise 409 name conflict permits exactly ONE exact-path re-read — never a
// second POST, rename, suffix, overwrite or retry loop.

import type { HandlerResult } from "./types.ts";
import type {
  FolderOutcome,
  GraphReadRequest,
  RecordFolderEnsureAccess,
  RecordFolderLibrary,
  RecordFolderReadAccess,
} from "./graphRead.ts";
import { safeGraphId } from "./graphFolderWrite.ts";
import {
  type MicrosoftReferenceInput,
  validMicrosoftBrowserUrl,
} from "../_shared/microsoftDocumentReference.ts";
import { parseFolderSearchNext } from "../_shared/microsoftFolderConvention.ts";

const MAX_DRIVE_PAGES = 3;
const DRIVE_PAGE_SIZE = 100;
const CONNECTION_CODES = new Set([
  "NOT_CONNECTED",
  "CONNECTION_STALE",
  "CONNECTION_REVOKED",
  "SCOPE_INSUFFICIENT",
]);

export type ParentFailure =
  | { kind: "forbidden" }
  | { kind: "refused" }
  | { kind: "audit_failed" }
  | { kind: "unavailable"; result?: HandlerResult };

export type FolderResolution =
  | { ok: true; item: MicrosoftReferenceInput; created: boolean }
  | { ok: false; failure: ParentFailure };

/** Called immediately after every validated Graph 201; false means the durable receipt failed. */
export type CreatedFolderHook = (item: { drive_id: string; item_id: string }) => Promise<boolean>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type DriveMembership = "member" | "foreign" | "unavailable";

/** The configured drive must belong to the configured default site before ANY write (bounded: 3 x 100). */
export async function verifyDriveBelongsToSite(
  read: RecordFolderReadAccess,
  library: RecordFolderLibrary,
): Promise<{ state: DriveMembership; result?: HandlerResult }> {
  const initial: GraphReadRequest = {
    path: `/sites/${encodeURIComponent(library.site_id)}/drives`,
    query: { "$top": String(DRIVE_PAGE_SIZE), "$select": "id" },
  };
  let request = initial;
  for (let page = 0; page < MAX_DRIVE_PAGES; page += 1) {
    const response = await read.get(request);
    if (response.status !== 200) {
      const code = isRecord(response.body) ? response.body.error : undefined;
      return typeof code === "string" && CONNECTION_CODES.has(code)
        ? { state: "unavailable", result: response }
        : { state: "unavailable" };
    }
    const body = response.body;
    if (!isRecord(body) || !Array.isArray(body.value) || body.value.length > DRIVE_PAGE_SIZE) {
      return { state: "unavailable" };
    }
    for (const drive of body.value) {
      if (isRecord(drive) && drive.id === library.drive_id) return { state: "member" };
    }
    const next = body["@odata.nextLink"];
    if (next === undefined || next === null) return { state: "foreign" };
    const parsed = parseFolderSearchNext(next, initial);
    if (!parsed || JSON.stringify(parsed.query) === JSON.stringify(request.query)) {
      return { state: "unavailable" };
    }
    request = parsed;
  }
  return { state: "unavailable" }; // page cap: never a substitute for membership
}

/** A returned folder item, validated against the identity the server asked for. */
function validateFolderItem(
  raw: unknown,
  expected: { driveId: string; parentId: string; name: string },
): MicrosoftReferenceInput | null {
  if (!isRecord(raw) || raw.folder == null || raw.file != null) return null;
  const parent = isRecord(raw.parentReference) ? raw.parentReference : null;
  if (
    !safeGraphId(raw.id) || typeof raw.name !== "string" ||
    raw.name.toLocaleLowerCase("en") !== expected.name.toLocaleLowerCase("en") ||
    !validMicrosoftBrowserUrl(raw.webUrl) || !parent ||
    parent.driveId !== expected.driveId || parent.id !== expected.parentId
  ) return null;
  return {
    drive_id: expected.driveId,
    item_id: raw.id,
    web_url: raw.webUrl,
    name: raw.name,
    item_kind: "folder",
  };
}

function failureOf(outcome: FolderOutcome): ParentFailure {
  if (outcome.kind === "forbidden") return { kind: "forbidden" };
  return outcome.kind === "unavailable"
    ? { kind: "unavailable", result: outcome.result }
    : { kind: "unavailable" };
}

/**
 * Resolve or create ONE named folder under `parentId`. `lookupFirst` is true for convention ancestors
 * (exact-child GET; only a precise 404 itemNotFound permits the create) and false for the record leaf
 * (the prefix search already established absence; the POST's `fail` conflict behaviour is the race guard).
 */
export async function resolveOrCreateFolder(
  access: RecordFolderEnsureAccess,
  driveId: string,
  parentId: string,
  name: string,
  lookupFirst: boolean,
  onCreated: CreatedFolderHook,
): Promise<FolderResolution> {
  const expected = { driveId, parentId, name };
  if (lookupFirst) {
    const found = await access.readFolder({ kind: "child", parentId, name });
    if (found.kind === "ok") {
      const item = validateFolderItem(found.item, expected);
      return item
        ? { ok: true, item, created: false }
        : { ok: false, failure: { kind: "refused" } }; // a file (or foreign item) occupies the segment
    }
    if (found.kind !== "not_found") return { ok: false, failure: failureOf(found) };
  }
  const created = await access.createFolder(parentId, name);
  if (created.kind === "ok") {
    const item = validateFolderItem(created.item, expected);
    if (!item) return { ok: false, failure: { kind: "unavailable" } };
    // Durable receipt BEFORE continuing to another parent or the link.
    if (!await onCreated({ drive_id: item.drive_id, item_id: item.item_id })) {
      return { ok: false, failure: { kind: "audit_failed" } };
    }
    return { ok: true, item, created: true };
  }
  if (created.kind !== "name_conflict") return { ok: false, failure: failureOf(created) };
  // Precise 409: exactly one re-read of the exact server-computed child.
  const winner = await access.readFolder({ kind: "child", parentId, name });
  if (winner.kind !== "ok") {
    return { ok: false, failure: winner.kind === "not_found" ? { kind: "refused" } : failureOf(winner) };
  }
  const item = validateFolderItem(winner.item, expected);
  return item
    ? { ok: true, item, created: false }
    : { ok: false, failure: { kind: "refused" } };
}

/** Resolve the drive root, then each server convention segment, creating only the missing ones. */
export async function ensureConventionParents(
  access: RecordFolderEnsureAccess,
  driveId: string,
  segments: string[],
  onCreated: CreatedFolderHook,
): Promise<{ ok: true; parentId: string } | { ok: false; failure: ParentFailure }> {
  const root = await access.readFolder({ kind: "root" });
  if (root.kind !== "ok") return { ok: false, failure: failureOf(root) };
  const rootParent = isRecord(root.item.parentReference) ? root.item.parentReference : null;
  if (
    !safeGraphId(root.item.id) || root.item.folder == null ||
    (rootParent !== null && rootParent.driveId !== undefined && rootParent.driveId !== driveId)
  ) return { ok: false, failure: { kind: "refused" } };
  let parentId = root.item.id;
  for (const segment of segments) {
    const resolved = await resolveOrCreateFolder(access, driveId, parentId, segment, true, onCreated);
    if (!resolved.ok) return resolved;
    parentId = resolved.item.item_id;
  }
  return { ok: true, parentId };
}
