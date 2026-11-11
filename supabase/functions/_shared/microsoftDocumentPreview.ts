// microsoftDocumentPreview.ts — wire types for the two bounded custody actions behind the document
// viewer (ADR-0095): `preview_document` (a read) and `upload_record_file` (the one file write). Shared by
// the edge function and the browser client so both sides parse the same contract.

import { type MicrosoftReferenceInput, validMicrosoftBrowserUrl } from "./microsoftDocumentReference.ts";

export const PROC_FILE_PHASES = [
  "purchase_request",
  "rfq",
  "quotation",
  "purchase_order",
  "receipt",
  "invoice",
  "payment",
] as const;
export type ProcFilePhase = typeof PROC_FILE_PHASES[number];

export type PreviewDocumentRequest =
  | {
    action: "preview_document";
    kind: "project_document" | "procurement_document" | "budget_link";
    id: string;
    child_item_id?: string;
  }
  | { action: "preview_document"; kind: "procurement_file"; phase: ProcFilePhase; id: string };
export interface PreviewDocumentResponse {
  name: string;
  get_url: string;
}

export type UploadRecordFileTarget =
  | { kind: "project_document"; id: string }
  | { kind: "procurement_file"; phase: ProcFilePhase; parent_id: string };
export interface UploadRecordFileResponse {
  reference: MicrosoftReferenceInput;
}

const EMBED_HOST_SUFFIXES = [
  ".sharepoint.com",
  ".sharepoint.us",
  ".sharepoint.de",
  ".sharepoint.cn",
  ".office.com",
  ".office365.com",
  ".officeapps.live.com",
  ".onedrive.com",
  ".microsoft.com",
];

/** Defence in depth: an iframe `src` only ever points at a Microsoft host over https. */
export function validPreviewEmbedUrl(value: unknown): value is string {
  if (!validMicrosoftBrowserUrl(value)) return false;
  const host = new URL(value).hostname.toLowerCase();
  return EMBED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}
