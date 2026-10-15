// documentVerification.ts — user-triggered checks for claimed controlled project files.
// The browser supplies row IDs only; SQL owns eligibility, identity, claim generation and baseline.

import type { HandlerDeps, HandlerResult } from "./types.ts";
import { resolveOrgOrResult } from "./auth.ts";
import { openCallerGraphRead } from "./graphRead.ts";
import { readDocumentMetadataBatch } from "./documentReadBatch.ts";
import { validMicrosoftBrowserUrl } from "../_shared/microsoftDocumentReference.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const MAX_IDS = 20;
const HEADERS = { "Content-Type": "application/json" };

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
