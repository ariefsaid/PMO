# Spec: Report templates exported to PDF (#1582)

**Status:** proposed; owner questions at the end need answers before planning. Map #1481. Size L.
**Blocked by #1522** (daily site report), which is itself only a proposed spec with no schema yet.
Source: the competitor review of 2026-10-31, §3b (kept private; not in this repo).
No plan, no ADR, no migration yet.

## Job story

When I have to hand a client or site owner a daily site report or a progress report, I want to pick
my organization's named template, fill it from records already in PMO, and download a PDF with
signature blocks, so that I do not retype the same facts into a word processor each day.

## What exists today (grounding)

| Area | What the repo has | Where |
|---|---|---|
| Daily site report (#1522) | A **proposed spec only**. No table, RPC, repository or screen exists. It names migrations 0530–0532, which are now taken by plan registry work, so #1522 needs new slots. | `docs/specs/daily-site-report.spec.md:1-3`, `:70`; `supabase/migrations/0530_plan_registry.sql` |
| Progress records | BoQ items, cumulative month-end quantities, progress claims, claim lines and claim evidence | `supabase/migrations/0250_progress_billing.sql:40`, `:112`, `:259`, `:293`, `:519` |
| Tenancy pattern | `org_id = public.auth_org_id() and public.is_active_member()` in RLS | `supabase/migrations/0250_progress_billing.sql:83-85` |
| PDF today | One edge function proxies the ERP's own invoice PDF on demand; PMO renders no PDF itself and stores none | `supabase/functions/external-invoice-pdf/index.ts:71`, `:106-112`, `:158-160`; ADR-0083; `docs/specs/invoice-pdf.spec.md:61` |
| PDF filename | A safe-filename helper for invoice PDFs | `pmo-portal/src/lib/invoicePdfFilename.ts:9` |
| Document storage | Private `project-documents` bucket, 5 MB limit, MIME allowlist including PDF; `project_documents` table | `supabase/migrations/0025_document_file_upload.sql:91-100`, `:116`, `:129`; `supabase/migrations/0001_init_schema.sql:243`; `supabase/migrations/0391_document_storage_authority.sql:2` |
| Document viewer | Storage and project targets for the shared viewer | `pmo-portal/src/components/documents/targets/storage.ts`, `project.tsx` |
| Plan switches | Server-side feature gate on writes and RPCs (`assert_feature_on`) | `supabase/migrations/0534_feature_enforcement.sql:1-17` |
| Templates, signatures | None. No client PDF library in `pmo-portal/package.json`; no signature capture; no report template table | searched `pmo-portal/src`, `pmo-portal/pages`, `supabase/migrations`, `package.json` |

### How this spec depends on #1522

The daily site report is the first record type a template renders. This spec needs from #1522: a
stable report record (project, work date, work item, activities, entries, photo links), its read
permission (OD-DSR-5) and its archive rule. Until #1522 lands, only progress records (0250) can feed a
template. This spec does **not** add fields to the daily site report and does not read its offline
queue: only server-confirmed reports render.

## Scope

- Org-level named templates for two record types: **daily site report** and **progress report**
  (a project's progress for a period from BoQ and assessment data).
- A template picks sections, field order, header text, org logo and signature blocks from a fixed set.
- Render one record (or one project and period) to PDF on the server; download it; optionally save
  it as a project document.
- Signature blocks: printed name, role and date lines, filled by hand after printing, or a recorded
  in-app sign-off (owner question 2).

## Out of scope

- A free-form layout designer, custom HTML or scripting in templates.
- Legally binding electronic signatures, certificate signing or a signing service.
- Templates over money records (invoices, payments, budgets). Invoice PDFs stay with ADR-0083.
- Scheduled or emailed reports; bulk export of many records into one PDF.
- Editing the source record from the template screen.

## Functional requirements (EARS)

- **FR-RPT-001** The system shall store report templates per organization, each with a name, a record
  type (`daily_site_report` or `progress_report`), a version and a soft-archive flag (ADR-0018).
- **FR-RPT-002** When an authorized user creates or edits a template, the system shall accept only
  sections and fields from the fixed catalogue for that record type, and reject unknown keys.
- **FR-RPT-003** When a template is changed, the system shall save a new version and keep earlier
  versions readable, so an earlier PDF can be reproduced from the version it used.
- **FR-RPT-004** When a user chooses "Export PDF" on a record they can read, the system shall list the
  active templates for that record type and render the chosen one on the server.
- **FR-RPT-005** When rendering, the system shall read the record and every included source under the
  caller's own permissions; a section the caller cannot read shall print as "Not available", never its
  content.
- **FR-RPT-006** The system shall print in the PDF footer the template name and version, the record
  identity, the generation time in the project's time zone, and the person who generated it.
- **FR-RPT-007** Where a template has signature blocks, the system shall print each with its label,
  printed name, role and date lines.
- **FR-RPT-008** Where in-app sign-off is enabled (owner question 2), when a named signer records a
  sign-off, the system shall store who, when and which record content digest they signed, and print
  it in the block. A sign-off by the record's author shall not count as an approver sign-off when the
  template marks that block as independent.
- **FR-RPT-009** When the record changes after a sign-off, the system shall mark that sign-off as for
  an earlier version and not print it as current.
- **FR-RPT-010** Where the user chooses "Save to project documents", the system shall store the PDF in
  the existing private project-documents storage, linked to the project, and not create a second
  document store.
- **FR-RPT-011** When a template is archived, the system shall hide it from the export list and keep
  its versions for reproducing earlier PDFs.
- **FR-RPT-012** While the organization's plan has the feature off, the system shall refuse template
  writes and renders on the server (`feature_off`) and hide the affordances; reads of saved PDFs stay
  allowed.
- **FR-RPT-013** The system shall render dates in the project's calendar and quantities with their
  unit, using the same formatting rules as the screens, in English or Indonesian per the template.

## Non-functional requirements

- **NFR-RPT-001 Tenancy.** Every new table carries `org_id` stamped by default or trigger, with RLS on
  `org_id = auth_org_id()` and active membership; the client never sends `org_id`.
- **NFR-RPT-002 Role gating.** Template create, edit and archive are registered actions in the role
  matrix (#902), gated by `can()` in the UI and enforced server-side; rendering requires read on the
  record. Impersonation can view templates but not edit them or sign.
- **NFR-RPT-003 Size.** A generated PDF shall be at most 5 MB (the project-documents bucket limit);
  photos are downscaled to fit; when it cannot fit, the render fails with a clear message.
- **NFR-RPT-004 Time.** A daily site report with up to 20 photos shall render in under 10 s at p95; the
  render is bounded at 30 s and returns a retryable error on timeout.
- **NFR-RPT-005 Safety.** Template text is data, never markup or code; the renderer fetches no remote
  URL; responses carry `Cache-Control: no-store`; filenames use a safe-filename helper.
- **NFR-RPT-006 Accessibility.** The template editor and export dialog meet WCAG-AA, use shared form
  primitives and DESIGN.md tokens, and work at 320 px; generated PDFs are tagged with a title and
  language.
- **NFR-RPT-007 Determinism.** The same record content, template version and locale produce the same
  text content (timestamps excepted), so tests can compare extracted text.

## Acceptance criteria

| ID | Given / When / Then | Owning layer |
|---|---|---|
| AC-RPT-001 | **Given** an authorized user, **when** they save a template with a field outside the catalogue, **then** it is rejected and nothing is saved. | Unit (catalogue validator) |
| AC-RPT-002 | **Given** a template of org A, **when** a member of org B lists or renders it, **then** it is not visible and the render is refused. | pgTAP |
| AC-RPT-003 | **Given** a user without the template-edit action, **when** they create or edit a template, **then** the server refuses it. | pgTAP |
| AC-RPT-004 | **Given** a template edited twice, **when** an earlier version is requested, **then** that version's content is returned unchanged. | pgTAP |
| AC-RPT-005 | **Given** a confirmed daily site report and an active template, **when** the user exports it, **then** a PDF downloads whose text contains the report fields, the template name and version, and the signature blocks. | E2E (one curated journey) |
| AC-RPT-006 | **Given** a section whose source the user cannot read, **when** they export, **then** the PDF shows "Not available" for it and none of its content. | Deno (render function, real handler) |
| AC-RPT-007 | **Given** a report with photos that would exceed 5 MB, **when** it is rendered, **then** photos are downscaled and the PDF is at most 5 MB, or a clear size error is returned. | Deno |
| AC-RPT-008 | **Given** a signed-off record, **when** the record is edited, **then** the next PDF shows the sign-off as for an earlier version. | pgTAP (digest rule) + Unit (block text) |
| AC-RPT-009 | **Given** a block marked independent, **when** the record's author signs it, **then** the sign-off is refused. | pgTAP |
| AC-RPT-010 | **Given** "Save to project documents", **when** export completes, **then** the PDF appears in that project's documents and opens in the document viewer. | E2E (same journey as AC-RPT-005) |
| AC-RPT-011 | **Given** the feature is off for the org's plan, **when** a template write or render is called, **then** it fails with `feature_off`. | pgTAP |
| AC-RPT-012 | **Given** an archived template, **when** the user opens the export dialog, **then** it is not listed and earlier saved PDFs still open. | Unit (dialog) |
| AC-RPT-013 | **Given** a project in a time zone ahead of UTC, **when** a report dated today is rendered just after local midnight, **then** the printed work date and generation time use the project's calendar. | Unit (formatter) |
| AC-RPT-014 | **Given** the same record, template version and locale, **when** rendered twice, **then** the extracted text matches except the generation time. | Deno |

## Owner questions

1. **Who designs templates?** Recommend Admin only, with PMs choosing among them. Wider editing risks
   templates that print data the client should not see.
2. **What does a signature mean?** Recommend printed blocks signed by hand on paper for the first
   release. A recorded in-app sign-off (FR-RPT-008/009) is a new approval-like record and an SoD
   question; it should ship alone if wanted.
3. **Renderer.** Recommend server-side rendering in an edge function with a PDF library that runs in
   Deno, over browser `print()` (inconsistent output) and over the ERP's print formats (daily site
   reports are not ERP records). The library choice needs a licence and font check (Indonesian
   characters) in a short spike; an ADR records it.
4. **Store or regenerate?** Recommend download by default, with "Save to project documents" as an
   explicit choice, so nothing is stored by accident.
5. **Logo and branding.** One org logo, or per project or per client?
6. **Progress report period.** Calendar month (matches the cumulative assessment in 0250) or any range?
7. **Plan tier.** Which plan includes report templates?
8. **#1522 migration slots.** Its spec names 0530–0532, now used; confirm #1522 renumbers before this
   spec's plan is written.
