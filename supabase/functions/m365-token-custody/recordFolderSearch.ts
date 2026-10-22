// recordFolderSearch.ts — bounded, complete-vs-uncertain discovery of a record's existing folder
// (FR-M365DOC-069, FR-M365DOC-056).
//
// Discovery is NOT a drive-wide search (files that merely mention the code would crowd a capped result in
// a large library). It resolves the convention parent by PATH (`Projects`, or `Procurement/<UTC year>`) and
// pages ONLY that parent's child listing, ignoring everything that is not a folder. The point of the
// explicit union: ONLY an absent parent or an exhausted, well-formed page chain proves absence. A refused or
// failed read, an exhausted page cap, an unsafe or looping continuation, or an unreadable candidate is
// "uncertain" and never authorizes creating a folder.

import type { HandlerResult } from "./types.ts";
import type { RecordFolderReadAccess } from "./graphRead.ts";
import { safeGraphId } from "./graphFolderWrite.ts";
import { validateFolderItem } from "./recordFolderParents.ts";
import {
  folderChildrenRequest,
  folderNameMatchesCode,
  parseFolderSearchNext,
} from "../_shared/microsoftFolderConvention.ts";
import {
  itemKind,
  type MicrosoftReferenceInput,
  validMicrosoftBrowserUrl,
} from "../_shared/microsoftDocumentReference.ts";

export type FolderSearchResult =
  | { complete: true; matches: MicrosoftReferenceInput[] }
  | {
    complete: false;
    reason: "unavailable" | "page_limit" | "invalid" | "connection";
    /** Present for `connection`: the standard not-connected / stale / revoked / scope envelope. */
    result?: HandlerResult;
    /** Seconds Microsoft asked us to wait (capped), when it sent a usable hint. */
    retryAfter?: number;
  };

/** Page cap for one parent listing: 10 pages x 200 children = at most 2000 child folders examined. */
export const MAX_LISTING_PAGES = 10;
const PAGE_SIZE = 200;

interface ListedFolder {
  id: string;
  name: string;
  webUrl: unknown;
  driveId: unknown;
}

type Failure = Extract<FolderSearchResult, { complete: false }>;
type Listing = { complete: true; folders: ListedFolder[] } | Failure;

export interface FolderDiscovery {
  /** Strict-boundary folders for `convention.term` under the convention parent. */
  find(convention: { term: string; parentSegments: string[] }): Promise<FolderSearchResult>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function incomplete(
  reason: "unavailable" | "page_limit" | "invalid",
  retryAfter?: number,
): Failure {
  return retryAfter === undefined
    ? { complete: false, reason }
    : { complete: false, reason, retryAfter };
}

/** A failed read: an envelope the user must act on (connection) or a generic outage. */
function readFailure(outcome: { kind: string; result?: HandlerResult; retryAfter?: number }): Failure {
  return outcome.kind === "unavailable" && outcome.result
    ? { complete: false, reason: "connection", result: outcome.result }
    : incomplete("unavailable", outcome.retryAfter);
}

/**
 * One discovery per invocation. Parent resolution and listings are memoised for the invocation, so a
 * sweep over many records of one kind lists the convention parent once. Incomplete results are not memoised.
 */
export function createFolderDiscovery(
  read: RecordFolderReadAccess,
  driveId: string,
): FolderDiscovery {
  const listings = new Map<string, Listing | "absent">();

  async function resolveParent(segments: string[]): Promise<string | "absent" | Failure> {
    const root = await read.readFolder({ kind: "root" });
    if (root.kind !== "ok") return readFailure(root);
    const rootParent = isRecord(root.item.parentReference) ? root.item.parentReference : null;
    if (
      !safeGraphId(root.item.id) || root.item.folder == null ||
      (rootParent !== null && rootParent.driveId !== undefined && rootParent.driveId !== driveId)
    ) return incomplete("invalid");
    let parentId = root.item.id;
    for (const name of segments) {
      const step = await read.readFolder({ kind: "child", parentId, name });
      if (step.kind === "not_found") return "absent";
      if (step.kind !== "ok") return readFailure(step);
      const item = validateFolderItem(step.item, { driveId, parentId, name });
      if (!item) return incomplete("invalid"); // a file (or foreign item) occupies the segment
      parentId = item.item_id;
    }
    return parentId;
  }

  async function listParent(parentId: string): Promise<Listing> {
    const initial = folderChildrenRequest(driveId, parentId);
    let request = initial;
    const seen = new Set<string>([queryKey(initial.query)]);
    const folders = new Map<string, ListedFolder>();
    for (let page = 0; page < MAX_LISTING_PAGES; page += 1) {
      const response = await read.get(request);
      if (response.status !== 200) {
        const code = isRecord(response.body) ? response.body.error : undefined;
        return typeof code === "string" && CONNECTION_CODES.has(code)
          ? { complete: false, reason: "connection", result: response }
          : incomplete(
            "unavailable",
            isRecord(response.body) && typeof response.body.retry_after_seconds === "number"
              ? response.body.retry_after_seconds
              : undefined,
          );
      }
      const body = response.body;
      if (!isRecord(body) || !Array.isArray(body.value) || body.value.length > PAGE_SIZE) {
        return incomplete("invalid");
      }
      for (const raw of body.value) {
        if (!isRecord(raw)) return incomplete("invalid");
        const kind = itemKind(raw);
        if (kind === null) {
          // Both facets is malformed metadata; neither (e.g. a notebook package) is simply not a folder.
          if (raw.file != null && raw.folder != null) return incomplete("invalid");
          continue;
        }
        if (kind !== "folder") continue; // files are never candidates and never count against a cap
        if (typeof raw.id !== "string" || !raw.id || typeof raw.name !== "string" || !raw.name) {
          return incomplete("invalid");
        }
        const parent = isRecord(raw.parentReference) ? raw.parentReference : null;
        folders.set(raw.id, { id: raw.id, name: raw.name, webUrl: raw.webUrl, driveId: parent?.driveId });
      }
      const next = body["@odata.nextLink"];
      if (next === undefined || next === null) return { complete: true, folders: [...folders.values()] };
      if (page === MAX_LISTING_PAGES - 1) return incomplete("page_limit"); // mutation-witness:page-cap-incomplete
      const parsed = parseFolderSearchNext(next, initial);
      if (!parsed) return incomplete("invalid");
      const key = queryKey(parsed.query);
      if (seen.has(key)) return incomplete("invalid");
      seen.add(key);
      request = parsed;
    }
    return incomplete("page_limit");
  }

  return {
    async find(convention) {
      const key = convention.parentSegments.join("/");
      let listing = listings.get(key);
      if (listing === undefined) {
        const parent = await resolveParent(convention.parentSegments);
        if (parent === "absent") {
          listing = "absent";
        } else if (typeof parent !== "string") {
          return parent;
        } else {
          const listed = await listParent(parent);
          if (!listed.complete) return listed;
          listing = listed;
        }
        listings.set(key, listing);
      }
      if (listing === "absent") return { complete: true, matches: [] };
      if (!listing.complete) return listing;
      const matches = new Map<string, MicrosoftReferenceInput>();
      for (const folder of listing.folders) {
        // Strict auto-link rule: a longer code (P-10) must never match the record's code (P-1).
        if (!folderNameMatchesCode(folder.name, convention.term)) continue; // mutation-witness:strict-boundary
        if (!validMicrosoftBrowserUrl(folder.webUrl) || folder.driveId !== driveId) {
          return incomplete("invalid");
        }
        matches.set(folder.id, {
          drive_id: driveId,
          item_id: folder.id,
          web_url: folder.webUrl,
          name: folder.name,
          item_kind: "folder",
        });
      }
      return { complete: true, matches: [...matches.values()] };
    },
  };
}

const CONNECTION_CODES = new Set([
  "NOT_CONNECTED",
  "CONNECTION_STALE",
  "CONNECTION_REVOKED",
  "SCOPE_INSUFFICIENT",
]);

function queryKey(query: Record<string, string> | undefined): string {
  return JSON.stringify(Object.entries(query ?? {}).sort(([a], [b]) => a < b ? -1 : 1));
}
