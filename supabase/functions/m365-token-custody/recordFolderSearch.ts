// recordFolderSearch.ts — bounded, complete-vs-uncertain prefix search for a record's existing folder
// (FR-M365DOC-069, FR-M365DOC-056). The point of the explicit union: ONLY an exhausted, well-formed page
// chain proves absence. A refused/failed search, a fourth page, an unsafe or looping continuation, or an
// unreadable candidate is "uncertain" and never authorizes creating a folder.

import type { HandlerResult } from "./types.ts";
import type { RecordFolderReadAccess } from "./graphRead.ts";
import {
  folderMatches,
  folderSearchRequest,
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
  };

const MAX_PAGES = 3;
const PAGE_SIZE = 100;
const MAX_ITEMS = 300;
const CONNECTION_CODES = new Set([
  "NOT_CONNECTED",
  "CONNECTION_STALE",
  "CONNECTION_REVOKED",
  "SCOPE_INSUFFICIENT",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function incomplete(
  reason: "unavailable" | "page_limit" | "invalid",
): FolderSearchResult {
  return { complete: false, reason };
}

/** Returns the reference for a matching folder, null for an item that is not a candidate, or "invalid". */
function decodeItem(
  raw: unknown,
  driveId: string,
  convention: { term: string; parentSegments: string[] },
): MicrosoftReferenceInput | null | "invalid" {
  if (!isRecord(raw)) return "invalid";
  const kind = itemKind(raw);
  if (kind === null) {
    // Both facets is malformed metadata; neither (e.g. a notebook package) is simply not a folder.
    return raw.file != null && raw.folder != null ? "invalid" : null;
  }
  if (kind !== "folder") return null;
  if (typeof raw.id !== "string" || !raw.id || typeof raw.name !== "string" || !raw.name) {
    return "invalid";
  }
  if (
    !raw.name.toLocaleLowerCase("en").startsWith(
      convention.term.toLocaleLowerCase("en"),
    )
  ) return null;
  const parent = isRecord(raw.parentReference) ? raw.parentReference : null;
  if (
    !validMicrosoftBrowserUrl(raw.webUrl) || !parent ||
    typeof parent.driveId !== "string" || typeof parent.path !== "string"
  ) return "invalid";
  const item = {
    drive_id: parent.driveId,
    item_kind: "folder",
    name: raw.name,
    parent_path: parent.path,
  };
  if (!folderMatches(item, convention, driveId)) return null;
  return {
    drive_id: parent.driveId,
    item_id: raw.id,
    web_url: raw.webUrl,
    name: raw.name,
    item_kind: "folder",
  };
}

export async function searchRecordFolders(
  read: RecordFolderReadAccess,
  driveId: string,
  convention: { term: string; parentSegments: string[] },
): Promise<FolderSearchResult> {
  const initial = folderSearchRequest(driveId, convention.term);
  let request = initial;
  const seen = new Set<string>([queryKey(initial.query)]);
  const matches = new Map<string, MicrosoftReferenceInput>();
  let total = 0;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response = await read.get(request);
    if (response.status !== 200) {
      const code = isRecord(response.body) ? response.body.error : undefined;
      return typeof code === "string" && CONNECTION_CODES.has(code)
        ? { complete: false, reason: "connection", result: response }
        : incomplete("unavailable");
    }
    const body = response.body;
    if (!isRecord(body) || !Array.isArray(body.value) || body.value.length > PAGE_SIZE) {
      return incomplete("invalid");
    }
    total += body.value.length;
    if (total > MAX_ITEMS) return incomplete("page_limit");
    for (const raw of body.value) {
      const decoded = decodeItem(raw, driveId, convention);
      if (decoded === "invalid") return incomplete("invalid");
      if (decoded) matches.set(`${decoded.drive_id}\u0000${decoded.item_id}`, decoded);
    }
    const next = body["@odata.nextLink"];
    if (next === undefined || next === null) {
      return { complete: true, matches: [...matches.values()] };
    }
    if (page === MAX_PAGES - 1) return incomplete("page_limit");
    const parsed = parseFolderSearchNext(next, initial);
    if (!parsed) return incomplete("invalid");
    const key = queryKey(parsed.query);
    if (seen.has(key)) return incomplete("invalid");
    seen.add(key);
    request = parsed;
  }
  return incomplete("page_limit");
}

function queryKey(query: Record<string, string> | undefined): string {
  return JSON.stringify(Object.entries(query ?? {}).sort(([a], [b]) => a < b ? -1 : 1));
}
