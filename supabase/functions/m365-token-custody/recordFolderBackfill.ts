// recordFolderBackfill.ts — `link_existing_record_folders` (FR-M365DOC-072, ADR-0089).
//
// An Admin-initiated, foreground, MATCH-ONLY sweep: it links already-existing folders to records that
// have none and can never create anything — it only ever holds a read capability (match_only), so there
// is no create method to call. Pages are keyset-based (`m365_record_folder_candidates`, caller RLS): the
// server processes at most five records sequentially under one shared Graph budget, and returns honest
// per-record counters plus a continuation cursor placed AFTER the last processed record.

import type { HandlerDeps, HandlerResult } from "./types.ts";
import { openCallerRecordFolderAccess } from "./graphRead.ts";
import { createGraphBudget } from "./folderBudget.ts";
import {
  authorizeFolderCaller,
  failure,
  findExistingFolder,
  isRecord,
  linkFailureResult,
  loadRecord,
  matchAndLinkRecord,
  readDefaultSnapshot,
  UUID,
} from "./recordFolders.ts";
import type {
  RecordFolderBackfillPage,
  RecordFolderCursor,
  RecordFolderTarget,
} from "../_shared/microsoftRecordFolder.ts";

const HEADERS = { "Content-Type": "application/json" };
const PAGE_RECORDS = 5;
type Kind = RecordFolderTarget["kind"];
type Stop = NonNullable<RecordFolderBackfillPage["stopped"]>;
type Bucket = "linked" | "needs_choice" | "missing" | "failed" | "skipped";

/** Exact request shape: `{action}` or `{action, cursor:{kind, after}}`; anything else is refused. */
export function parseBackfillRequest(
  body: unknown,
): { cursor: RecordFolderCursor } | null {
  if (!isRecord(body) || body.action !== "link_existing_record_folders") return null;
  const keys = Object.keys(body).sort().join(",");
  if (keys !== "action" && keys !== "action,cursor") return null;
  if (body.cursor === undefined) {
    return keys === "action" ? { cursor: { kind: "project", after: null } } : null;
  }
  const cursor = body.cursor;
  if (!isRecord(cursor) || Object.keys(cursor).sort().join(",") !== "after,kind") {
    return null;
  }
  if (cursor.kind !== "project" && cursor.kind !== "procurement") return null;
  if (cursor.after !== null && (typeof cursor.after !== "string" || !UUID.test(cursor.after))) {
    return null;
  }
  return { cursor: { kind: cursor.kind, after: cursor.after } };
}

async function fetchCandidates(
  deps: HandlerDeps,
  kind: Kind,
  after: string | null,
): Promise<string[] | null> {
  const { data, error } = await deps.callerClient!.rpc("m365_record_folder_candidates", {
    p_kind: kind,
    p_after: after,
  });
  if (error || !Array.isArray(data) || data.length > PAGE_RECORDS + 1) return null;
  const ids: string[] = [];
  for (const row of data) {
    const id = isRecord(row) ? row.id : undefined;
    if (typeof id !== "string" || !UUID.test(id)) return null;
    const lower = id.toLowerCase();
    // Keyset monotonicity: strictly increasing and strictly beyond the cursor, else non-progress.
    if (ids.length > 0 ? lower <= ids[ids.length - 1]! : after !== null && lower <= after.toLowerCase()) {
      return null;
    }
    ids.push(lower);
  }
  return ids;
}

export async function handleLinkExistingRecordFolders(
  body: unknown,
  deps: HandlerDeps,
): Promise<HandlerResult> {
  const request = parseBackfillRequest(body);
  if (!request) {
    return failure(400, "BAD_REQUEST", "Cannot link existing folders.");
  }
  const caller = await authorizeFolderCaller(deps, (role) => role === "Admin");
  if ("status" in caller) return caller;

  const snapshot = await readDefaultSnapshot(deps, caller.orgId);
  if (snapshot === "error") {
    return failure(500, "INTERNAL_ERROR", "Could not read the record. Try again.");
  }
  if (snapshot === "unset") {
    return failure(400, "BAD_REQUEST", "Choose a default document library first.");
  }
  const budget = createGraphBudget();
  const read = await openCallerRecordFolderAccess(deps, snapshot, "match_only", budget);
  if (!("get" in read)) return read;

  const page: RecordFolderBackfillPage = {
    scanned: 0,
    linked: 0,
    needs_choice: 0,
    missing: 0,
    failed: 0,
    skipped: 0,
    next: null,
  };
  let kind: Kind = request.cursor.kind;
  let after = request.cursor.after;
  let lastProcessed: string | null = null;
  let stop: { reason: Stop; result: HandlerResult } | null = null;
  let budgetEnded = false;
  let moreInKind = false;

  const processOne = async (
    id: string,
  ): Promise<{ bucket: Bucket } | { stop: Stop; result: HandlerResult }> => {
    const target = { kind, id };
    const record = await loadRecord(deps, caller.orgId, target);
    if (record.state === "denied") return { bucket: "skipped" };
    if (record.state === "error") return { bucket: "failed" };
    const existing = await findExistingFolder(deps, target);
    if (existing === "error") return { bucket: "failed" };
    if (existing) return { bucket: "skipped" }; // a concurrent link appeared
    if (!record.identity) return { bucket: "missing" };
    const match = await matchAndLinkRecord(deps, target, record.identity, snapshot, read);
    switch (match.kind) {
      case "linked":
        return { bucket: "linked" };
      case "already_linked":
        return { bucket: "skipped" };
      case "needs_choice":
        return { bucket: "needs_choice" };
      case "absent":
        return { bucket: "missing" };
      case "search_failed":
        if (match.connection) {
          return { stop: "connection", result: match.connection };
        }
        // A failure caused by the spent shared budget is not this record's fault: stop, don't mark failed.
        return budget.remaining() <= 0
          ? {
            stop: "unavailable",
            result: failure(502, "GRAPH_ERROR", "Graph API request failed"),
          }
          : { bucket: "failed" };
      case "link_failed":
        return match.failure === "default_changed"
          ? { stop: "default_changed", result: linkFailureResult("default_changed") }
          : { bucket: "failed" };
    }
  };

  for (let guard = 0; guard < 2 && !stop && !budgetEnded; guard += 1) {
    const ids = await fetchCandidates(deps, kind, after);
    if (ids === null) {
      stop = {
        reason: "unavailable",
        result: failure(502, "GRAPH_ERROR", "Could not list the records to link."),
      };
      break;
    }
    if (ids.length === 0) {
      if (kind === "project") {
        kind = "procurement";
        after = null;
        continue; // empty project page: transition to cases within this invocation
      }
      break;
    }
    moreInKind = ids.length > PAGE_RECORDS;
    for (const id of ids.slice(0, PAGE_RECORDS)) {
      if (budget.remaining() <= 0) {
        budgetEnded = true;
        break;
      }
      const done = await processOne(id);
      if ("stop" in done) {
        stop = { reason: done.stop, result: done.result };
        break;
      }
      page.scanned += 1;
      page[done.bucket] += 1;
      lastProcessed = id;
    }
    break;
  }

  if (page.scanned === 0 && (stop || budgetEnded)) {
    // No progress is an error, never a cursor that loops.
    return stop?.result ?? failure(502, "GRAPH_ERROR", "Graph API request failed");
  }
  if (stop) page.stopped = stop.reason;
  if (lastProcessed !== null && (stop || budgetEnded || moreInKind)) {
    page.next = { kind, after: lastProcessed };
  } else if (kind === "project") {
    page.next = { kind: "procurement", after: null };
  } else {
    page.next = null;
  }
  return { status: 200, body: page, headers: HEADERS };
}
