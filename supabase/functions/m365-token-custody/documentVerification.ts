// documentVerification.ts — user-triggered checks, Issue freeze and reference metadata refresh.
// The browser supplies row IDs/identity pairs only; SQL owns leases and mutation fencing.

import type { HandlerDeps, HandlerResult } from "./types.ts";
import { authorizeMemberEntitled, resolveOrgOrResult } from "./auth.ts";
import { openCallerGraphRead } from "./graphRead.ts";
import { readDocumentMetadataBatch } from "./documentReadBatch.ts";
import { validMicrosoftBrowserUrl } from "../_shared/microsoftDocumentReference.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const MAX_IDS = 20;
const HEADERS = { "Content-Type": "application/json" };
const WRITE_ROLES = new Set([
  "Admin",
  "Executive",
  "Project Manager",
  "Finance",
]);
const ITEM_SELECT = "id,name,webUrl,parentReference,file,folder,cTag";
const VERSION_SELECT = "id,lastModifiedDateTime";

interface ClaimedDocument {
  id: string;
  ms_drive_id: string;
  ms_item_id: string;
  ms_content_tag_at_issue: string | null;
  ms_check_claim: string;
}

interface GraphBatchResponse {
  id?: unknown;
  status?: unknown;
  body?: unknown;
}

interface ProjectDocumentForIssue {
  id: string;
  org_id: string;
  author_id: string | null;
  status: string;
  source: string | null;
  ms_item_kind: string | null;
  ms_drive_id: string | null;
  ms_item_id: string | null;
}

interface ItemSnapshot {
  id: string;
  driveId: string;
  name: string;
  webUrl: string;
  cTag: string | null;
}

interface ReferenceIdentity {
  drive_id: string;
  item_id: string;
}

type RefreshTarget =
  | { kind: "project"; id: string }
  | { kind: "procurement"; id: string }
  | { kind: "budget"; id: string };

interface StoredReference {
  id: string;
  source?: string | null;
  status?: string;
  author_id?: string | null;
  ms_item_kind?: string;
  ms_drive_id: string;
  ms_item_id: string;
}

export async function handleCheckDocuments(
  body: unknown,
  deps: HandlerDeps,
): Promise<HandlerResult> {
  const ids = parseDocumentIds(body);
  if (!ids) {
    return {
      status: 400,
      body: { error: "BAD_REQUEST", message: "Cannot check these documents." },
      headers: HEADERS,
    };
  }
  if (ids.length === 0) {
    return { status: 200, body: { checked: 0 }, headers: HEADERS };
  }

  const resolved = await resolveOrgOrResult(deps);
  if (typeof resolved !== "string") return resolved;
  const { data, error } = await deps.serviceClient.rpc(
    "m365_claim_document_checks",
    { p_actor_id: deps.userId, p_ids: ids },
  );
  if (error || !Array.isArray(data)) {
    return {
      status: 403,
      body: { error: "FORBIDDEN", message: "Cannot check these documents." },
      headers: HEADERS,
    };
  }
  const claimed = data as ClaimedDocument[];
  if (claimed.length === 0) {
    return { status: 200, body: { checked: 0 }, headers: HEADERS };
  }

  const opened = await openCallerGraphRead(deps);
  if (!("batch" in opened)) {
    await releaseClaims(deps, claimed);
    return opened;
  }

  const result = await readDocumentMetadataBatch(
    opened,
    claimed.map((doc) => ({
      drive_id: doc.ms_drive_id,
      item_id: doc.ms_item_id,
    })),
  );
  const responses = result.status === 200 && isRecord(result.body) &&
      Array.isArray(result.body.responses)
    ? result.body.responses as GraphBatchResponse[]
    : [];
  const byId = new Map(
    responses.filter((response) => typeof response.id === "string")
      .map((response) => [response.id as string, response]),
  );

  for (let index = 0; index < claimed.length; index += 1) {
    const doc = claimed[index]!;
    const response = byId.get(String(index + 1));
    const item = isRecord(response?.body) ? response.body : null;
    const parent = isRecord(item?.parentReference)
      ? item.parentReference
      : null;
    const file = item?.file != null && item?.folder == null;
    const name = typeof item?.name === "string" ? item.name : "";
    const url = typeof item?.webUrl === "string" ? item.webUrl : "";
    const cTag = typeof item?.cTag === "string" ? item.cTag : "";
    const identityMatches = item?.id === doc.ms_item_id &&
      parent?.driveId === doc.ms_drive_id;
    const success = response?.status === 200 && file && identityMatches &&
      !!name.trim() && validMicrosoftBrowserUrl(url) && !!cTag.trim();
    await deps.serviceClient.rpc("m365_commit_document_check", {
      p_actor_id: deps.userId,
      p_doc_id: doc.id,
      p_claim: doc.ms_check_claim,
      p_drive_id: doc.ms_drive_id,
      p_item_id: doc.ms_item_id,
      p_baseline: doc.ms_content_tag_at_issue,
      p_name: success ? name : "",
      p_url: success ? url : "",
      p_content_tag: success ? cTag : "",
      p_success: success,
    });
  }

  if (result.status !== 200) return result;
  return { status: 200, body: { checked: claimed.length }, headers: HEADERS };
}

export async function handleIssueMicrosoftDocument(
  body: unknown,
  deps: HandlerDeps,
): Promise<HandlerResult> {
  const documentId = isRecord(body) && typeof body.document_id === "string" &&
      UUID.test(body.document_id)
    ? body.document_id
    : null;
  if (!documentId) {
    return issueError(400, "BAD_REQUEST", "Cannot issue this document.");
  }
  if (!deps.callerClient) {
    return issueError(500, "INTERNAL_ERROR", "Could not load this document.");
  }

  let membership: { orgId: string; role: string };
  try {
    membership = await authorizeMemberEntitled({
      callerClient: deps.callerClient,
      serviceClient: deps.serviceClient,
      userId: deps.userId,
    });
  } catch {
    return issueError(403, "FORBIDDEN", "Cannot issue this document.");
  }
  if (!WRITE_ROLES.has(membership.role)) {
    return issueError(403, "FORBIDDEN", "Cannot issue this document.");
  }

  const { data, error } = await deps.callerClient
    .from("project_documents")
    .select(
      "id,org_id,author_id,status,source,ms_item_kind,ms_drive_id,ms_item_id",
    )
    .eq("id", documentId)
    .single();
  const document = data as ProjectDocumentForIssue | null;
  if (
    error || !document || document.org_id !== membership.orgId ||
    document.status !== "Draft" || document.source !== "onedrive" ||
    document.ms_item_kind !== "file" || !document.ms_drive_id ||
    !document.ms_item_id
  ) {
    return issueError(
      409,
      "SOURCE_CHANGED",
      "This document is no longer available to Issue.",
    );
  }

  const opened = await openCallerGraphRead(deps);
  if (!("get" in opened)) return opened;
  const path = `/drives/${encodeURIComponent(document.ms_drive_id)}/items/${
    encodeURIComponent(document.ms_item_id)
  }`;
  const beforeResult = await opened.get({
    path,
    query: { "$select": ITEM_SELECT },
  });
  const before = decodeItemSnapshot(
    beforeResult,
    document.ms_drive_id,
    document.ms_item_id,
  );
  if (!before) {
    return issueError(
      409,
      "SOURCE_CHANGED",
      "The Microsoft file could not be verified.",
    );
  }

  const versionsResult = await opened.get({
    path: `${path}/versions`,
    query: { "$select": VERSION_SELECT },
  });
  const pinnedVersion = selectUniqueNewestVersion(versionsResult);

  const afterResult = await opened.get({
    path,
    query: { "$select": ITEM_SELECT },
  });
  const after = decodeItemSnapshot(
    afterResult,
    document.ms_drive_id,
    document.ms_item_id,
  );
  if (!after) {
    return issueError(
      409,
      "SOURCE_CHANGED",
      "The Microsoft file could not be verified.",
    );
  }
  if (before.cTag && after.cTag && before.cTag !== after.cTag) {
    return issueError(
      409,
      "SOURCE_CHANGED",
      "The Microsoft file changed during Issue. Try again.",
    );
  }
  const cTag = before.cTag && after.cTag ? after.cTag : null;

  const { error: issueErrorResult } = await deps.serviceClient.rpc(
    "m365_issue_document",
    {
      p_actor_id: deps.userId,
      p_doc_id: document.id,
      p_drive_id: document.ms_drive_id,
      p_item_id: document.ms_item_id,
      p_content_tag: cTag,
      p_version_id: pinnedVersion,
      p_name: after.name,
      p_url: after.webUrl,
    },
  );
  if (issueErrorResult) {
    const errorRow = issueErrorResult as { code?: unknown; details?: unknown };
    if (
      errorRow.code === "23514" && errorRow.details === "m365-source-changed"
    ) {
      return issueError(
        409,
        "SOURCE_CHANGED",
        "This document changed before Issue could be saved.",
      );
    }
    return issueError(403, "FORBIDDEN", "Cannot issue this document.");
  }
  return {
    status: 200,
    body: {
      issued: true,
      verification: cTag ? "available" : "unavailable",
      version_history: pinnedVersion ? "available" : "unavailable",
    },
    headers: HEADERS,
  };
}

export async function handleRefreshReferences(
  body: unknown,
  deps: HandlerDeps,
): Promise<HandlerResult> {
  const parsed = parseRefreshRequest(body);
  if (!parsed) {
    return {
      status: 400,
      body: {
        error: "BAD_REQUEST",
        message: "Cannot refresh these references.",
      },
      headers: HEADERS,
    };
  }
  if (parsed.items.length === 0) {
    return {
      status: 200,
      body: { refreshed: 0, checked: 0 },
      headers: HEADERS,
    };
  }
  if (!deps.callerClient) {
    return {
      status: 500,
      body: {
        error: "INTERNAL_ERROR",
        message: "Could not load these references.",
      },
      headers: HEADERS,
    };
  }

  let membership: { orgId: string; role: string };
  try {
    membership = await authorizeMemberEntitled({
      callerClient: deps.callerClient,
      serviceClient: deps.serviceClient,
      userId: deps.userId,
    });
  } catch {
    return {
      status: 403,
      body: { error: "FORBIDDEN", message: "Cannot refresh these references." },
      headers: HEADERS,
    };
  }
  const target = parsed.target;
  if (target.kind !== "project" && !WRITE_ROLES.has(membership.role)) {
    return {
      status: 403,
      body: { error: "FORBIDDEN", message: "Cannot refresh these references." },
      headers: HEADERS,
    };
  }

  const query = referenceQuery(deps, target);
  const { data, error } = await query;
  if (error || !Array.isArray(data)) {
    return {
      status: 403,
      body: { error: "FORBIDDEN", message: "Cannot refresh these references." },
      headers: HEADERS,
    };
  }
  const wanted = new Set(parsed.items.map(identityKey));
  const matching = (data as StoredReference[]).filter((row) =>
    (target.kind === "budget" || row.source === "onedrive") &&
    wanted.has(
      identityKey({ drive_id: row.ms_drive_id, item_id: row.ms_item_id }),
    )
  );

  let checked = 0;
  if (target.kind === "project") {
    const controlled = matching.filter((row) =>
      row.ms_item_kind === "file" && row.status !== "Draft"
    );
    if (controlled.length > 0) {
      const check = await handleCheckDocuments({
        document_ids: controlled.map((row) => row.id),
      }, deps);
      if (check.status !== 200) return check;
      if (isRecord(check.body) && typeof check.body.checked === "number") {
        checked = check.body.checked;
      }
    }
  }

  const metadataRows = matching.filter((row) =>
    !(target.kind === "project" && row.ms_item_kind === "file" &&
      row.status !== "Draft")
  );
  if (metadataRows.length === 0) {
    return { status: 200, body: { refreshed: 0, checked }, headers: HEADERS };
  }

  if (
    target.kind === "project" &&
    metadataRows.some((row) =>
      row.status !== "Draft" ||
      (row.author_id !== deps.userId && membership.role !== "Admin")
    )
  ) {
    return {
      status: 403,
      body: { error: "FORBIDDEN", message: "Cannot refresh these references." },
      headers: HEADERS,
    };
  }
  const opened = await openCallerGraphRead(deps);
  if (!("get" in opened)) return opened;
  let refreshed = 0;
  for (const identity of parsed.items) {
    const rows = metadataRows.filter((row) =>
      row.ms_drive_id === identity.drive_id &&
      row.ms_item_id === identity.item_id
    );
    if (rows.length === 0) continue;
    const path = `/drives/${encodeURIComponent(identity.drive_id)}/items/${
      encodeURIComponent(identity.item_id)
    }`;
    const result = await opened.get({
      path,
      query: { "$select": ITEM_SELECT },
    });
    const snapshot = decodeReferenceMetadata(result, identity);
    if (!snapshot) continue;
    for (const row of rows) {
      const args = {
        p_actor_id: deps.userId,
        p_project_document_id: target.kind === "project" ? row.id : null,
        p_procurement_document_id: target.kind === "procurement"
          ? row.id
          : null,
        p_budget_link_id: target.kind === "budget" ? row.id : null,
        p_drive_id: identity.drive_id,
        p_item_id: identity.item_id,
        p_name: snapshot.name,
        p_url: snapshot.webUrl,
      };
      const { data: updated, error: updateError } = await deps.serviceClient
        .rpc("m365_refresh_reference", args);
      if (!updateError && updated === true) refreshed += 1;
    }
  }
  return { status: 200, body: { refreshed, checked }, headers: HEADERS };
}

function referenceQuery(
  deps: HandlerDeps,
  target: RefreshTarget,
): PromiseLike<{ data: unknown; error: unknown }> {
  if (target.kind === "project") {
    return deps.callerClient!.from("project_documents")
      .select("id,source,status,author_id,ms_item_kind,ms_drive_id,ms_item_id")
      .eq("project_id", target.id) as unknown as PromiseLike<
        { data: unknown; error: unknown }
      >;
  }
  if (target.kind === "procurement") {
    return deps.callerClient!.from("procurement_documents")
      .select("id,source,ms_drive_id,ms_item_id")
      .eq("procurement_id", target.id) as unknown as PromiseLike<
        { data: unknown; error: unknown }
      >;
  }
  return deps.callerClient!.from("budget_version_document_links")
    .select("id,ms_drive_id,ms_item_id")
    .eq("budget_version_id", target.id) as unknown as PromiseLike<
      { data: unknown; error: unknown }
    >;
}

function parseRefreshRequest(
  body: unknown,
): { target: RefreshTarget; items: ReferenceIdentity[] } | null {
  if (
    !isRecord(body) ||
    (body.action !== undefined && body.action !== "refresh_references") ||
    !Array.isArray(body.items) || body.items.length > MAX_IDS
  ) return null;
  const keys = ["project_id", "procurement_id", "budget_version_id"] as const;
  const present = keys.filter((key) => body[key] !== undefined);
  if (
    present.length !== 1 || typeof body[present[0]!] !== "string" ||
    !UUID.test(body[present[0]!] as string)
  ) return null;
  if (
    Object.keys(body).some((key) =>
      ![...keys, "items", "action"].includes(
        key as typeof keys[number] | "items" | "action",
      )
    )
  ) return null;
  const items: ReferenceIdentity[] = [];
  for (const item of body.items) {
    if (
      !isRecord(item) || Object.keys(item).some((key) =>
        key !== "drive_id" && key !== "item_id"
      ) ||
      !isSafeIdentity(item.drive_id) || !isSafeIdentity(item.item_id)
    ) {
      return null;
    }
    items.push({ drive_id: item.drive_id, item_id: item.item_id });
  }
  const unique = [
    ...new Map(items.map((item) => [identityKey(item), item])).values(),
  ];
  const key = present[0]!;
  const target: RefreshTarget = key === "project_id"
    ? { kind: "project", id: body[key] as string }
    : key === "procurement_id"
    ? { kind: "procurement", id: body[key] as string }
    : { kind: "budget", id: body[key] as string };
  return { target, items: unique };
}

function decodeReferenceMetadata(
  result: HandlerResult,
  identity: ReferenceIdentity,
): { name: string; webUrl: string } | null {
  if (!result || result.status !== 200 || !isRecord(result.body)) return null;
  const item = result.body;
  const parent = isRecord(item.parentReference) ? item.parentReference : null;
  const hasFile = item.file != null;
  const hasFolder = item.folder != null;
  const name = typeof item.name === "string" ? item.name : "";
  const webUrl = typeof item.webUrl === "string" ? item.webUrl : "";
  if (
    item.id !== identity.item_id || parent?.driveId !== identity.drive_id ||
    hasFile === hasFolder ||
    !name.trim() || !validMicrosoftBrowserUrl(webUrl)
  ) return null;
  return { name, webUrl };
}

function identityKey(identity: ReferenceIdentity): string {
  return `${identity.drive_id}\u0000${identity.item_id}`;
}

function isSafeIdentity(value: unknown): value is string {
  return typeof value === "string" && !!value.trim() &&
    !/[\u0000-\u001f\u007f]/u.test(value);
}

function decodeItemSnapshot(
  result: HandlerResult,
  expectedDriveId: string,
  expectedItemId: string,
): ItemSnapshot | null {
  if (!result || result.status !== 200 || !isRecord(result.body)) return null;
  const item = result.body;
  const parent = isRecord(item.parentReference) ? item.parentReference : null;
  const file = item.file != null;
  const folder = item.folder != null;
  const name = typeof item.name === "string" ? item.name : "";
  const webUrl = typeof item.webUrl === "string" ? item.webUrl : "";
  if (
    item.id !== expectedItemId || parent?.driveId !== expectedDriveId ||
    file === folder || !file || !name.trim() ||
    !validMicrosoftBrowserUrl(webUrl)
  ) return null;
  return {
    id: expectedItemId,
    driveId: expectedDriveId,
    name,
    webUrl,
    cTag: typeof item.cTag === "string" && item.cTag.trim() ? item.cTag : null,
  };
}

function selectUniqueNewestVersion(result: HandlerResult): string | null {
  if (
    result.status !== 200 || !isRecord(result.body) ||
    !Array.isArray(result.body.value)
  ) return null;
  const versions = result.body.value.flatMap((value) => {
    if (
      !isRecord(value) || typeof value.id !== "string" || !value.id.trim() ||
      typeof value.lastModifiedDateTime !== "string"
    ) return [];
    const modifiedAt = Date.parse(value.lastModifiedDateTime);
    return Number.isFinite(modifiedAt) ? [{ id: value.id, modifiedAt }] : [];
  });
  if (versions.length === 0) return null;
  versions.sort((a, b) => b.modifiedAt - a.modifiedAt);
  if (
    versions.length > 1 && versions[0]!.modifiedAt === versions[1]!.modifiedAt
  ) return null;
  return versions[0]!.id;
}

function issueError(
  status: number,
  error: string,
  message: string,
): HandlerResult {
  return { status, body: { error, message }, headers: HEADERS };
}

function parseDocumentIds(body: unknown): string[] | null {
  if (
    !isRecord(body) || !Array.isArray(body.document_ids) ||
    body.document_ids.length > MAX_IDS
  ) return null;
  if (
    body.document_ids.some((id) => typeof id !== "string" || !UUID.test(id))
  ) return null;
  return [...new Set(body.document_ids as string[])];
}

async function releaseClaims(
  deps: HandlerDeps,
  claimed: ClaimedDocument[],
): Promise<void> {
  await Promise.all(
    claimed.map((doc) =>
      deps.serviceClient.rpc("m365_commit_document_check", {
        p_actor_id: deps.userId,
        p_doc_id: doc.id,
        p_claim: doc.ms_check_claim,
        p_drive_id: doc.ms_drive_id,
        p_item_id: doc.ms_item_id,
        p_baseline: doc.ms_content_tag_at_issue,
        p_name: "",
        p_url: "",
        p_content_tag: "",
        p_success: false,
      })
    ),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
