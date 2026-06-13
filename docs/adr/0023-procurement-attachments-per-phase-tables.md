# ADR-0023 — Procurement attachments: per-phase child tables (not polymorphic)

- **Status:** Accepted (2026-06-13)
- **Feature:** W1-P — Procurement attachments (KANNA Wave 1)
- **Migration:** `0028_procurement_files.sql`; pgTAP `0070`/`0071`

## Context

Procurement needs **multiple file attachments per phase row** (supplier quotations, goods
receipts (GR), vendor invoices (VI)). The legacy `procurement_quotations.file_url` single-URL
column is insufficient (one file, no metadata, no soft-archive, no per-org storage scoping).

Two designs were considered:

- **(a) Polymorphic** — one `procurement_files(parent_type, parent_id, ...)` table with a
  `parent_type` discriminator and a non-FK `parent_id`.
- **(b) Per-phase child tables** — three typed tables, each with a real FK to its phase parent.

## Decision

**(b) — three per-phase child tables:** `procurement_quotation_files`,
`procurement_receipt_files`, `procurement_invoice_files`. Each mirrors the 0006 procurement
child-table shape: `org_id` (column default + parent-org-guard write RLS, never client-sent),
a `<phase>_id` FK **`on delete cascade`**, `title`, `file_path`, `uploaded_by_id`,
`created_at`, and `archived_at` (soft-archive, ADR-0018).

Files live in a **new private storage bucket `procurement-files`** (5 MB cap + the shared
0025 MIME allowlist). Object paths are 6-component / 5-segment:
`{org_id}/{procurement_id}/{phase}/{file_id}/{filename}`. Storage RLS mirrors the 0025
project-documents pattern but with the procurement role gate and a segment-2 in-org
procurement existence check (and **no Draft-status gate** — procurement files attach at any
phase whose parent row exists). **RLS is the enforcement authority**; the FE `can('…','procFile')`
gate is UX-only.

v1 covers **quotation / GR / VI only**. PR/PO **header** attachments are deferred.

## Consequences

- **+** Real referential integrity (typed FKs); `on delete cascade` for free; no `parent_type`
  dispatch; RLS reuses the proven 0006 parent-org-guard shape verbatim per table.
- **+** Forward-compatible toward a real ERP procurement module (typed tables age better than a
  polymorphic catch-all).
- **−** Three near-identical tables + policies (accepted: the ERP trajectory favors typed
  tables; the duplication is mechanical and proven by pgTAP per table).
- Legacy `procurement_quotations.file_url` kept but **deprecated** (untouched, no backfill).
- Admin-only hard-delete + PR/PO header attachments deferred to a future issue (another child
  table + bucket-path phase).
