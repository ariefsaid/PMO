/** ERP Contact master mapping; parent links are resolved server-side through external_refs. */
import { AdapterError, type PmoRecord } from "../../contract.ts";
import type { ErpCtx } from "../doctypeRegistry.ts";
interface ErpContactDoc {
  modified?: string | null;
  first_name?: string | null;
  middle_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  email_id?: string | null;
  phone?: string | null;
  mobile_no?: string | null;
  email_ids?: Array<{ email_id?: string; is_primary?: number }>;
  phone_nos?: Array<
    { phone?: string; is_primary_phone?: number; is_primary_mobile_no?: number }
  >;
  links?: Array<{ link_doctype?: string; link_name?: string }>;
}
export interface ContactMirrorFields {
  full_name: string;
  email: string | null;
  phone: string | null;
}
export function contactFromDoc(doc: unknown): ContactMirrorFields {
  const d = doc as ErpContactDoc;
  return {
    full_name: d.full_name ||
      [d.first_name, d.middle_name, d.last_name].filter(Boolean).join(" ")
        .trim(),
    email: d.email_id || d.email_ids?.find((r) => r.is_primary)?.email_id ||
      d.email_ids?.[0]?.email_id || null,
    phone: d.phone || d.mobile_no ||
      d.phone_nos?.find((r) => r.is_primary_phone || r.is_primary_mobile_no)
        ?.phone ||
      d.phone_nos?.[0]?.phone || null,
  };
}
export function contactCanonicalFromDoc(doc: unknown): PmoRecord {
  return {
    id: `Contact:${String((doc as { name?: unknown }).name ?? "")}`,
    ...contactFromDoc(doc),
    erp_modified: (doc as ErpContactDoc).modified ?? null,
    erp_contact_links: (doc as ErpContactDoc).links ?? [],
  };
}
export function contactToBody(record: PmoRecord, ctx: ErpCtx): unknown {
  const name = typeof record.full_name === "string"
    ? record.full_name.trim()
    : "";
  if (!name) {
    throw new AdapterError("commit-rejected", "Contact name is required");
  }
  if (!ctx.refs.contact_party_type || !ctx.refs.contact_party_name) {
    throw new AdapterError(
      "commit-rejected",
      "Contact company must be mapped to ERPNext",
    );
  }
  return {
    first_name: name,
    links: [{
      link_doctype: ctx.refs.contact_party_type,
      link_name: ctx.refs.contact_party_name,
    }],
    ...(record.email
      ? { email_ids: [{ email_id: record.email, is_primary: 1 }] }
      : {}),
    ...(record.phone
      ? { phone_nos: [{ phone: record.phone, is_primary_phone: 1 }] }
      : {}),
  };
}
// Child tables require a full-document read; list fields stay scalar.
export const CONTACT_FROM_DOC_FIELDS = [
  "name",
  "modified",
  "first_name",
  "middle_name",
  "last_name",
  "full_name",
  "email_id",
  "phone",
  "mobile_no",
] as const;
