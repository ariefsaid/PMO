// documentVerification.ts — user-triggered checks and controlled-file Issue freeze.
// The browser supplies row IDs only; SQL owns eligibility, identity, claim generation and baseline.

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
