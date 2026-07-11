/**
 * erpnext/bodies/contact.ts (task 3.3, FR-ENA-095) — read-only `Contact` mirror mapping. No write
 * command exists for `Contact` in P2 (out of scope unless the owner extends OQ-4) — this file is
 * consumed only by the inbound mirror path (the sweep/webhook table writer, slice 8's ingress calls
 * this mapping via `_shared/erpnextMirrorDeps.ts`'s contacts table writer, task 3.6).
 */
interface ErpContactDoc {
  first_name?: string | null;
  last_name?: string | null;
  email_id?: string | null;
  phone?: string | null;
}

export interface ContactMirrorFields {
  full_name: string;
  email: string | null;
  phone: string | null;
}

/** `first_name`/`last_name` -> `full_name`; `email_id` -> `email`; `phone` -> `phone` (FR-ENA-095's
 *  exact column mapping). `company_id` is NOT produced here — the caller resolves the parent
 *  company's PMO id via `external_refs` (this module carries no ref-resolution vocabulary). */
export function contactFromDoc(doc: unknown): ContactMirrorFields {
  const d = doc as ErpContactDoc;
  const fullName = [d.first_name, d.last_name].filter((part): part is string => Boolean(part)).join(' ').trim();
  return {
    full_name: fullName,
    email: d.email_id ?? null,
    phone: d.phone ?? null,
  };
}
