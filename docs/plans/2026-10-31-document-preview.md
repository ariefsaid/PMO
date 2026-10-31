# Document preview — implementation plan

> **For the builder:** a planning artifact, not authorization to push, merge, deploy or run any Microsoft grant. Work RED then GREEN in dependency order. The Director dispatches; the edge-function phase (A) and the DB phase (B) are the **auth / token-custody tier: Director-dispatched, one worker per phase, adversarial review, mutation checks**. Phases C-F are a bounded FE slice for an Orca worker.

**Issue:** [#1474](https://github.com/ariefsaid/PMO/issues/1474) (map #1442, unblocked by the sign-off #1470). **Spec:** `docs/specs/document-preview.spec.md` (FR-001..015, NFR-001..008, AC-001..014, signed off in #1470). **Decision tickets:** #1447 (what the first version covers), #1446 (Graph preview feasibility), delivery issue #1406. **ADR:** `docs/adr/0095-document-preview-and-bounded-file-upload.md` (written with this plan; architectural because it adds two custody actions and a second external write). **Start:** after the visual redesign has merged to dev (issue #1474).

**Goal:** one reusable side-panel document viewer opened from every place a document is linked or attached, previewing PDF, images, Word, Excel and PowerPoint; Microsoft files through a server-mediated Graph preview, private uploads natively, and new uploads of a connected organisation stored in the record's SharePoint folder.

**Architecture (one paragraph):** FE `DocumentViewerProvider` (one active document, a `Drawer` panel) → per-source **target adapters** that return a `DocumentViewTarget` (name, a `load()` that runs only on open/retry, optional Download / Open-in-source) → either a signed Storage URL (private files) or a new typed `preview_document` action in `m365-token-custody` (Microsoft files; the caller's own connection; Graph `driveItem: preview`). Upload: a connected organisation sends the file to a new `upload_record_file` custody action (record folder resolved server-side, Graph simple `PUT`), then the browser persists the returned reference through the existing repositories; other organisations keep the signed-URL flow. Purchase attachment tables get additive `source` + Microsoft reference columns.

**Tech:** React 19 + Vite, react-router 8, TanStack Query, i18next, Vitest/RTL + jest-axe, Deno edge tests, pgTAP, Playwright.

**Executor routing (decided before building, `docs/orca-dispatch.md`):**

| Phase | Executor | Why |
|---|---|---|
| A edge actions (A01-A22) | Director-dispatched Orca worker, Terra-class, adversarial reviewer + mutation witness | token custody + an external write |
| B DB (B01-B08) | Director-dispatched Orca worker, Terra-class | RLS / guard trigger change on a document register |
| C-F FE slice (C01-F10) | Orca worker (Luna for UI craft, GLM for the mechanical wiring tasks) | bounded UI; no auth or money files |
| G gates (G01-G07) | Director + reviewers | security review gate, provider proof, rendered review |

One PR to dev for phases A-F is **too wide to review safely**. Split as in "Branches and PRs" below; money/SoD/auth ship alone, and A and B are the auth tier.

---

## 0. Open questions (answer before dispatch; each has a default the builder may take)

**Director, 2026-10-31:** Q2, Q4, Q5, Q6 defaults accepted. Q1 and Q3 are with the owner; build with the defaults (mocks; replacement goes to SharePoint). Migration 0409 (billing kinds takes 0408).

| # | Question | Default taken in this plan | Who |
|---|---|---|---|
| Q1 | **Has the Microsoft app-level `write` grant on the organisation's SharePoint site been executed on the production client tenant** (ADR-0089 decision 1)? Upload needs it; preview does not. This plan makes no claim about the live tenant. | Build and test with mocks. The provider-proof task (G03) and the owner's grant decide go-live. Without the grant a connected-org upload shows the recovery state (Microsoft refuses; `SOURCE_ACCESS_DENIED`) and nothing is written. | owner / Director, before enabling upload for the client |
| Q2 | Does Graph's `preview` return only `postUrl` (form post) for some Office files? | Only `getUrl` is used. A response without `getUrl` is `PREVIEW_UNSUPPORTED`: the panel offers Open in SharePoint + Download. | decided by G03 proof; a `postUrl` form-post renderer is a follow-up issue, not this slice |
| Q3 | A connected organisation **replaces** an existing private file on a Draft document: does the replacement go to SharePoint? | Yes (FR-006: "uploads a file" in a connected org). Needs the one-line guard amendment in B03; the old object is cleaned up after the new reference persists. Alternative if the owner prefers: private files may only be replaced privately, and the guard stays untouched. | owner (low risk either way) |
| Q4 | Name conflicts in the record folder. | `conflictBehavior=rename` (non-destructive; a retry after a failed PMO write makes `name 1.pdf`). Replace and fail are both worse for a retry. | Director |
| Q5 | Which purchase attachment surfaces get SharePoint upload? | The seven typed phase-file tables, via `ProcurementFilesSubsection` and `LedgerFileCell` (both already upload). Expense receipts, budget links and conversation uploads are **not** routed (spec "Out of scope"; a new record kind needs an owning folder decision first). | spec |
| Q6 | Is a viewer for **sub-folders** of a linked folder in scope? | No. `LinkedFolderFiles` lists direct children and shows folders as rows; a child is previewable only when it is a direct child file (server checks `parentReference.id`). Nested browsing is a follow-up. | spec silent; default narrowest |

No spec requirement is unclear. Nothing above weakens an owner decision.

## 1. Deciding artifacts read (verified at `origin/dev` e1576dcc5, 2026-10-31)

Every path below was grepped in this worktree. Searches: `scripts/prior-art.sh "document preview"`, `SharePoint`, `ReceiptPreview`, `record.folder` (the last two surfaced only ADR-0089 and the record-folder scripts; **absence in the five sources is not proof**, so the code was read directly).

- **Custody:** `supabase/functions/m365-token-custody/index.ts` (router: JWT verified first, then `req.json()`, then an `action` switch; one 18 s request deadline via `scope.limit`), `graphRead.ts` (`openOwnConnection` is the single credential owner; `scopeCoversPath` is GET-only; `sendGraphRequest` strips download URLs via `metadataOnly`), `graphFolderWrite.ts` (the template for a per-operation builder + exact-match allowlist with `mutation-witness:` tags), `microsoftTransport.ts` (`fetchMicrosoftJson`: bounded, no redirects), `recordFolders.ts` (`parseEnsureRequest`, `loadRecord`, `findExistingFolder`, `readDefaultSnapshot`, `WRITER_ROLES`), `recordFolderTestKit.ts` + `recordFolderWrite.test.ts` (test pattern: import the shipped `handler`, mock `globalThis.fetch`, no DI), `auth.ts` (`authorizeMemberEntitled`, `resolveOrgOrResult`, `microsoftReadQuota`), `audit.ts` (`logAudit` best-effort, `recordM365Error`), `types.ts` (`M365ErrorCode`, `ERROR_STATUS`, `M365Request`).
- **Scripts:** `scripts/m365-record-folder-write-mutation.mjs` (+ `.test.mjs`) is the mutation-witness harness to mirror; `scripts/deno-test-edge-fns.sh` runs edge tests; `scripts/check-edge-fn-test-binding.mjs` forbids copied handlers.
- **ADRs:** 0060 (token custody), 0063 (Microsoft is source + access authority), 0064 (per-client Entra app), 0071 (controlled documents pin a version; a latest preview must not claim approved bytes), 0086 (GET-only read batches), 0089 (one folder write; "does not authorise a general upload transport"), 0010 (test pyramid), 0016/0017/0019 (policy, repository seam, server SoD).
- **DB:** `supabase/migrations/0292_m365_document_linking.sql` (`doc_source` enum `upload|onedrive`; `m365_ref_complete`; `project_documents_source_complete` requires `file_path is null` for `onedrive`; `guard_project_m365_source` lines 125-165 **forbids switching a row that has a `file_path` to `onedrive`**: this drives Q3/B03), `0349_procurement_integrity_guards.sql` §7 (clients may UPDATE only `title, archived_at` on the seven `*_files` tables; `guard_procurement_file_path`), `0391_document_storage_authority.sql` (storage write = document author or Admin), `0350_engineer_purchasing_scope.sql` (engineer read scope on the files), `0028`/`0036` (the seven tables; `file_path` already nullable), `0058` (admin-only DELETE).
- **FE:** `pmo-portal/src/components/ui/Drawer.tsx` (focus capture/restore, trap, Esc, `nestedOpen`), `ReceiptPreview.tsx` (the second viewer to consolidate; callers `pages/expenses/ExpenseReceiptsCard.tsx`, `pages/approvals/ExpenseClaimApprovalSection.tsx`), `FileCell.tsx` + `fileConstants.ts` (`PREVIEWABLE_EXTENSIONS` drives today's new-tab preview), `pages/project-detail/tabs/useDocumentFiles.tsx` (`openPreview` does `window.open`), `DocumentsTab.tsx`, `DocumentDrawer.tsx`, `src/components/m365/{LinkedDocumentCell,LinkedFolderFiles,BudgetDocumentLinks,LinkedDocumentVersions,DocumentDriftBadge}.tsx`, `pages/procurement/{ProcurementMicrosoftReferences,ProcurementFilesSubsection,LedgerFileCell}.tsx`, `src/hooks/{useFileUpload,useProcurementFiles,useMicrosoftDocuments,useBudgetDocumentLinks}.ts`, `src/lib/db/{documents,procurementFiles}.ts`, `src/lib/repositories/{index,types}.ts`, `src/lib/m365/{graphClient,reference,connectClient}.ts`, `src/components/m365/DocumentLinkPermissions.tsx`.
- **Research:** `docs/research/2026-10-28-document-preview.md` exists on `origin/ariefsaid/research-document-preview` only (commit `39af897f1`). Facts used: preview needs `Files.Read`, which every connection already holds; the URL is short-lived, caller-bound, no published TTL; it must not be logged or persisted.
- **Not present at dev:** `pmo-portal/src/components/documents/` (new directory), any `preview_document` / `upload_record_file` action, any `source` / `ms_*` column on the seven purchase file tables.
- **CSP:** `pmo-portal/public/_headers` sets only `object-src 'none'; base-uri 'self'; frame-ancestors 'none'`, so embedding Graph / Office / Storage iframes needs no header change (G03 re-checks on the real deploy).

## 2. Design decisions

| ID | Decision | Why / what it replaces |
|---|---|---|
| D1 | **One provider-mounted viewer.** `DocumentViewerProvider` wraps routes in `App.tsx` inside `ToastProvider`; `useDocumentViewer().open(target, opener)` / `close()`. The panel is the existing `Drawer` (`width="lg"`) with a body that renders the state machine. | FR-001/002: route, selection, filters and scroll live outside the overlay and are untouched. Reuses Drawer's focus trap, Esc, scrim, `max-md:w-full` (320 px). |
| D2 | **Target adapters, not URLs.** `DocumentViewTarget = { key, name, sourceLabel, load(signal), download?, openInSource?, notice?, extra? }`. `load` is invoked only when the panel opens or Retry is pressed (NFR-004). A late result is dropped by a generation counter + `AbortController` (FR-011). | The spec forbids an arbitrary externally supplied preview URL. |
| D3 | **Microsoft previews go through `preview_document` with a typed identity** `{kind, id[, child_item_id | phase]}`. The server reads the row under the caller's JWT, derives drive/item, checks a folder child's `parentReference`, builds the single Graph `POST …/preview` (body `{}`) from a builder + exact-match allowlist, returns only `{name, get_url}`. | NFR-001/003. `graph_proxy` stays GET-only. |
| D4 | **Upload goes through `upload_record_file`** (multipart, same function): server loads the target under the caller's JWT, resolves the record's folder reference (never creates it), requires it to be in the org default library, requires the stored `Sites.Selected` consent, `PUT …:/{name}:/content?@microsoft.graph.conflictBehavior=rename`, validates the returned item, returns the reference. The **browser persists** it through the existing repositories. | FR-006/007. Reuses ADR-0089's write consent and library; no new Graph scope; no PMO table writes from custody. |
| D5 | **Persistence = additive columns on the seven purchase file tables** (`source doc_source`, `ms_drive_id`, `ms_item_id`, `ms_web_url`, `ms_item_name`, `ms_linked_by`, `ms_linked_at`), a shared `check` that exactly one source is set, and a stamp trigger. Project documents already model it. | NFR-007; spec "choose one representation consistently". Table-level columns beat a polymorphic side table (real FKs and the existing RLS stay). |
| D6 | **Org-level "connected" = a default library is set** (`useMicrosoftDocuments().defaultLibrary != null`); entitlement and the personal connection are enforced server-side and surface as recovery states, never as a silent private fallback. | Spec: "connection state is evaluated at organization level for upload destination". |
| D7 | **Renderer selection is a pure function** `selectRenderer({name, sourceKind})`: Microsoft → ask Graph; private → pdf/png/jpg/jpeg/webp native, docx/xlsx/pptx (+ best-effort legacy doc/xls/ppt) public Office viewer on a fresh signed URL, everything else unsupported with Download. | FR-005/009, NFR-006. Upload acceptance (`fileConstants.ts`) is not widened. |
| D8 | **`ReceiptPreview` is deleted** and its two callers use the shared viewer through a receipt target adapter; its tests port into the viewer suite. | Spec: consolidate, no second viewer. |
| D9 | **Controlled documents** (Issued or later) open as "Latest in SharePoint" with a notice, the drift badge and the existing `ApprovedVersionHistory` recovery rendered in the viewer's `extra` slot. No status, approval or drift write happens on preview. | FR-012, ADR-0071. |
| D10 | **Error vocabulary** (additive to `M365ErrorCode`): `SOURCE_ACCESS_DENIED` 403 (Microsoft refused), `SOURCE_NOT_FOUND` 404 (not readable or absent, deliberately indistinguishable), `PREVIEW_UNSUPPORTED` 422, `RECORD_FOLDER_UNAVAILABLE` 409. Existing `NOT_CONNECTED`, `CONNECTION_STALE`, `CONNECTION_REVOKED`, `SCOPE_INSUFFICIENT`, `NOT_ENTITLED`, `GRAPH_ERROR`, `RATE_LIMITED` are reused. | Lets the panel give "your Microsoft account can't open this" vs "connect Microsoft" (FR-004). |

## 3. Branches and PRs

Workers push branches only; the Director batches. Suggested branches off `origin/dev`:

1. `feat/doc-preview-edge` : phase A (+ ADR-0095, mutation script). **Ships alone** (token custody).
2. `feat/doc-preview-db` : phase B. **Ships alone** (guard trigger + RLS-adjacent). Order-independent of 1 until E.
3. `feat/doc-preview-viewer` : phases C-D (viewer, adapters, all entry points, ReceiptPreview removal). Depends only on the shape of A's wire types (`_shared/microsoftDocumentPreview.ts`, A01), which is the first commit of branch 1; the worker mocks the network.
4. `feat/doc-preview-upload` : phase E (connected-org upload FE), after 1, 2 and 3 are on dev.
5. G (gates, e2e, provider proof) runs per branch and once on the batch.

Migration number **0408** and ADR number **0095** were free on `origin/dev` and in every local worktree on 2026-10-31; the Director reserves them before dispatch. A later collision uses `scripts/renumber-migration.sh <old> <new>` and `npm run check:adrs`, not hand edits.

## 4. Files

**New**
- `supabase/functions/_shared/microsoftDocumentPreview.ts` (+ `.test.ts`) : wire types, kinds, `validPreviewEmbedUrl`.
- `supabase/functions/m365-token-custody/graphPreview.ts` : preview request builder, allowlist, response reader.
- `supabase/functions/m365-token-custody/graphFileUpload.ts` : upload request builder, allowlist, file-name sanitizer, item validator.
- `supabase/functions/m365-token-custody/documentPreview.ts` : `handlePreviewDocument`.
- `supabase/functions/m365-token-custody/recordFileUpload.ts` : `handleUploadRecordFile`.
- `supabase/functions/m365-token-custody/documentPreview.test.ts`, `recordFileUpload.test.ts`.
- `scripts/m365-preview-upload-mutation.mjs` (+ `.test.mjs`).
- `supabase/migrations/0408_document_preview_sources.sql`, `supabase/migrations/rollback/0408_document_preview_sources_down.sql`, `supabase/tests/0408_document_preview_sources.test.sql`.
- `pmo-portal/src/lib/m365/previewClient.ts` (+ test).
- `pmo-portal/src/components/documents/` : `types.ts`, `renderers.ts`, `DocumentViewer.tsx`, `DocumentViewerProvider.tsx`, `targets/{storage,microsoft,project,procurement,budget,folderChild,receipt}.ts(x)`, `useUploadDestination.ts`, and `*.test.ts(x)` beside each.
- `pmo-portal/public/locales/{en,id}/documentViewer.json`.
- `pmo-portal/e2e/document-preview-AC-002-private-pdf-viewer.spec.ts`.
- `docs/adr/0095-document-preview-and-bounded-file-upload.md` (already written with this plan).

**Modified**
`supabase/functions/m365-token-custody/{graphRead.ts,index.ts,types.ts}` · `pmo-portal/src/lib/{fileConstants.ts,supabase/database.types.ts,i18n/index.ts,db/documents.ts,db/procurementFiles.ts,repositories/index.ts,repositories/types.ts}` · `pmo-portal/App.tsx` · `pmo-portal/src/components/{FileCell.tsx,ui/index.ts}` · `pmo-portal/src/components/m365/{LinkedDocumentCell,LinkedFolderFiles,BudgetDocumentLinks}.tsx` · `pmo-portal/pages/project-detail/tabs/ProjectDocumentMicrosoft.tsx` · `pmo-portal/pages/project-detail/tabs/{useDocumentFiles.tsx,DocumentsTab.tsx}` · `pmo-portal/pages/procurement/{ProcurementMicrosoftReferences,ProcurementFilesSubsection,LedgerFileCell}.tsx` · `pmo-portal/pages/expenses/ExpenseReceiptsCard.tsx` · `pmo-portal/pages/approvals/ExpenseClaimApprovalSection.tsx` · `pmo-portal/src/hooks/{useFileUpload,useProcurementFiles}.ts` · `pmo-portal/e2e/AC-DOC-020-upload-download-journey.spec.ts` (preview step only, a deliberate UX change).

**Deleted** `pmo-portal/src/components/ui/ReceiptPreview.tsx` and `pmo-portal/src/components/ui/__tests__/ReceiptPreview.test.tsx` (behaviour ported, D8).

## 5. Traceability table (every AC to its one owning test and layer)

Test titles start `document-preview AC-###` (spec namespace). Deno steps use `Deno.test("document-preview AC-### …")`; pgTAP uses it as the leading token of the description.

| AC | Owning layer | Owning test (file : title token) | Tasks |
|---|---|---|---|
| AC-001 | Unit (parameterized RTL surface adapters) | `pmo-portal/src/components/documents/entryPoints.test.tsx` : `document-preview AC-001` (one row per surface: project row, project quick view, purchase reference, purchase phase file, budget link, folder child, receipt) | C07, D01-D08 |
| AC-002 | E2E (one curated real Storage-to-viewer journey) | `pmo-portal/e2e/document-preview-AC-002-private-pdf-viewer.spec.ts` : `document-preview AC-002` | F08 |
| AC-003 | Unit (shipped edge handler, mocked Microsoft transport) | `supabase/functions/m365-token-custody/documentPreview.test.ts` : `document-preview AC-003` | A05-A12 |
| AC-004 | Unit | `pmo-portal/src/components/documents/DocumentViewer.states.test.tsx` : `document-preview AC-004` (panel copy + recovery). The edge half (own connection only, no borrowed identity) is asserted inside the AC-003 file under the same tag; same layer, no second owner. | A12, C05 |
| AC-005 | Unit (renderer/source matrix) | `pmo-portal/src/components/documents/renderers.test.ts` + `DocumentViewer.render.test.tsx` : `document-preview AC-005` | C01, C06 |
| AC-006 | Unit | `pmo-portal/src/components/documents/DocumentViewer.race.test.tsx` : `document-preview AC-006` | C04 |
| AC-007 | Unit (shipped upload handler + repository contract) | `supabase/functions/m365-token-custody/recordFileUpload.test.ts` : `document-preview AC-007` and `pmo-portal/src/lib/db/documents.upload.test.ts` : `document-preview AC-007` (repository half) | A14-A19, E02 |
| AC-008 | Unit | `pmo-portal/src/components/documents/useUploadDestination.test.tsx` : `document-preview AC-008` (the edge half sits in the AC-007 file under the same tag) | A19, E03 |
| AC-009 | Unit | `pmo-portal/src/hooks/useFileUpload.test.ts` : `document-preview AC-009` | E04 |
| AC-010 | pgTAP | `supabase/tests/0408_document_preview_sources.test.sql` : `document-preview AC-010` | B01-B08 |
| AC-011 | Unit | `pmo-portal/src/components/documents/DocumentViewer.permissions.test.tsx` : `document-preview AC-011` | C08 |
| AC-012 | Unit | `pmo-portal/src/components/documents/targets/project.test.tsx` : `document-preview AC-012` | D02 |
| AC-013 | Unit (RTL, axe, responsive fixtures) | `pmo-portal/src/components/documents/DocumentViewer.a11y.test.tsx` : `document-preview AC-013` | C09 |
| AC-014 | Unit (shipped handler boundary; mutation-checked authorization branch) | `supabase/functions/m365-token-custody/documentPreview.test.ts` and `recordFileUpload.test.ts` : `document-preview AC-014`; mutation harness `scripts/m365-preview-upload-mutation.mjs` | A06, A15, A21 |

AC-004 and AC-007/008 each have an edge half and an FE half at the **same layer (unit)**; the table names the file that carries the AC's canonical title and the second half references it with the same tag. No AC is pushed up a layer.

NFR proof map (not ACs): NFR-001 → AC-014 + B pgTAP; NFR-002 → A12 (no URL in logs/errors) + C10 (no URL in query cache); NFR-003 → A02/A15 allowlists + witness; NFR-004 → C04 (no request before open) ; NFR-005 → AC-013; NFR-006 → AC-009; NFR-007 → AC-010; NFR-008 → F02 locale parity + AC-013 (both languages).

## 6. Conventions every task follows

- TDD: write the failing test, run it and see the named failure, implement, run green, then the touched-file gate. No production code without a red test first.
- Verify commands (run from the worktree root unless a `cd` is shown):
  - Edge: `cd supabase/functions/m365-token-custody && deno test <file> --config deno.json --allow-env --allow-net --allow-read`
  - FE unit: `cd pmo-portal && npx vitest run <files>`
  - pgTAP: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0408_document_preview_sources.test.sql'` (reset + test in **one** lock hold)
  - Gate before every PR: `cd pmo-portal && npm run check:guards && npm run typecheck && npx eslint --max-warnings=0 <touched files>` plus the touched test files only. Never `vitest --changed` or the full suite locally.
- Edge tests import the shipped `handler` from `./index.ts` and mock `globalThis.fetch` (`recordFolderTestKit.ts`); no dependency injection in production code (`scripts/check-edge-fn-test-binding.mjs`).
- Strings are English + Indonesian in `documentViewer.json`; DESIGN.md tokens only; no raw hex. Em dash is allowed as an empty-cell marker, never in prose.
- No attribution trailers in commits. Before any push: `git log --format=%B origin/dev..HEAD | grep -qi co-authored` must NOT match.
- Public repo: comments and test names say nothing about unpatched weaknesses; synthetic fixtures only (`synthetic-drive`, `synthetic-parent-id`).

---

# Phase A : custody edge actions (auth / token-custody tier)

Start every task on branch `feat/doc-preview-edge`. Test commands are in section 6.

### A01 : shared wire types (AC-003, NFR-003)
**Files:** create `supabase/functions/_shared/microsoftDocumentPreview.ts`, `supabase/functions/_shared/microsoftDocumentPreview.test.ts`.
**RED** (`deno test ../_shared/microsoftDocumentPreview.test.ts`): `document-preview AC-003 validPreviewEmbedUrl accepts https Microsoft hosts only`: accepts `https://synthetic.sharepoint.com/sites/x/_layouts/15/embed.aspx?a=b`; rejects `http://`, `https://evil.example/`, `https://sharepoint.com.evil.example/`, a URL with credentials, control characters, a non-string.
**GREEN:**
```ts
import { type MicrosoftReferenceInput, validMicrosoftBrowserUrl } from "./microsoftDocumentReference.ts";

export const PROC_FILE_PHASES = [
  "purchase_request", "rfq", "quotation", "purchase_order", "receipt", "invoice", "payment",
] as const;
export type ProcFilePhase = typeof PROC_FILE_PHASES[number];

export type PreviewDocumentRequest =
  | { action: "preview_document"; kind: "project_document" | "procurement_document" | "budget_link"; id: string; child_item_id?: string }
  | { action: "preview_document"; kind: "procurement_file"; phase: ProcFilePhase; id: string };
export interface PreviewDocumentResponse { name: string; get_url: string }

export type UploadRecordFileTarget =
  | { kind: "project_document"; id: string }
  | { kind: "procurement_file"; phase: ProcFilePhase; parent_id: string };
export interface UploadRecordFileResponse { reference: MicrosoftReferenceInput }

const EMBED_HOST_SUFFIXES = [
  ".sharepoint.com", ".sharepoint.us", ".sharepoint.de", ".sharepoint.cn", ".office.com",
  ".office365.com", ".officeapps.live.com", ".onedrive.com", ".microsoft.com",
];
/** Defence in depth: an iframe `src` only ever points at a Microsoft host over https. */
export function validPreviewEmbedUrl(value: unknown): value is string {
  if (!validMicrosoftBrowserUrl(value)) return false;
  const host = new URL(value).hostname.toLowerCase();
  return EMBED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}
```
**Verify:** `cd supabase/functions/_shared && deno test microsoftDocumentPreview.test.ts --config ../m365-token-custody/deno.json --allow-env --allow-net --allow-read`. Commit.

### A02 : preview builder + allowlist (AC-003, AC-014, NFR-003)
**Files:** create `supabase/functions/m365-token-custody/graphPreview.ts`; test steps go in `documentPreview.test.ts` (created in A05; start the file here with only this step).
**RED:** `document-preview AC-003 preview builder emits only the exact POST`: `buildPreviewRequest({driveId:"synthetic-drive", itemId:"synthetic-item"})` equals `{method:"POST", path:"/drives/synthetic-drive/items/synthetic-item/preview", body:{}}`; `previewAllowed(request, ctx)` is true for it and false for: PATCH/PUT/GET, another drive, another item, a body with keys (`{page:"1"}`), extra top-level keys, `/content`, `/children`, `/createLink`, an id containing `/`, `%`, `?`, `#` or a dot segment, and an `unknown` non-object. Building with an unsafe id throws.
**GREEN:** (mirrors `graphFolderWrite.ts`; reuse `safeGraphId` from it)
```ts
import { safeGraphId } from "./graphFolderWrite.ts";
export interface PreviewContext { driveId: string; itemId: string }
export interface PreviewRequest { method: "POST"; path: string; body: Record<string, never> }

const valid = (c: PreviewContext) => !!c && safeGraphId(c.driveId) && safeGraphId(c.itemId);
const plain = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(v));

export function buildPreviewRequest(c: PreviewContext): PreviewRequest {
  if (!valid(c)) throw new Error("invalid preview context");
  return { method: "POST", body: {},
    path: `/drives/${encodeURIComponent(c.driveId)}/items/${encodeURIComponent(c.itemId)}/preview` };
}

export function previewAllowed(request: unknown, c: PreviewContext): boolean { // mutation-witness:preview-allowlist-always-true
  if (!valid(c) || !plain(request)) return false;
  if (Object.keys(request).sort().join(",") !== "body,method,path") return false;
  if (request.method !== "POST") return false; // mutation-witness:preview-method-post
  const m = /^\/drives\/([^/?#]+)\/items\/([^/?#]+)\/preview$/u.exec(String(request.path));
  if (!m || m[1] !== encodeURIComponent(c.driveId)) return false; // mutation-witness:preview-drive-equality
  if (m[2] !== encodeURIComponent(c.itemId)) return false;
  return plain(request.body) && Object.keys(request.body).length === 0; // mutation-witness:preview-body-empty
}

/** Only an embeddable `getUrl` is ever used; a form-post-only answer is "unsupported" (Q2). */
export function readPreviewGetUrl(data: unknown): string | null {
  return plain(data) && typeof data.getUrl === "string" ? data.getUrl : null;
}
```
**Verify:** `deno test documentPreview.test.ts …` (custody dir). Commit.

### A03 : transport on the credential owner (AC-003, NFR-003)
**Files:** modify `supabase/functions/m365-token-custody/graphRead.ts`.
**RED** (in `documentPreview.test.ts`, through the served handler once A08 lands; here a unit step on `openCallerDocumentAccess` using `recordFolderTestKit.ts` `newWorld`): `previewItem` sends exactly one fetch to `https://graph.microsoft.com/v1.0/drives/synthetic-drive/items/<id>/preview` with method POST, `Authorization: Bearer synthetic-access-token`, body `{}`; a connection with no Files read scope gets `SCOPE_INSUFFICIENT` **before** any token refresh or Graph call; a 403 → `{kind:"forbidden"}`, 404 `itemNotFound` → `not_found`, 400/415 `notSupported`/`unsupportedMediaType` → `unsupported`, 429/503 → `unavailable` with capped `retryAfter`, 200 without a valid `getUrl` → `unsupported`, 200 with a non-Microsoft host → `unavailable`.
**GREEN:** inside `openOwnConnection` add next to `createFolder` (same `token()`, same `sendFolderRequest`-style classifier but a dedicated `sendPreviewRequest` that never logs a URL, upstream text or id: only `{status, connectionId}`):
```ts
export type PreviewOutcome =
  | { kind: "ok"; url: string }
  | { kind: "forbidden" } | { kind: "not_found" } | { kind: "unsupported" }
  | { kind: "unavailable"; result?: HandlerResult; retryAfter?: number };

export interface DocumentPreviewAccess {
  /** Scope-checked GET of ONE item's metadata (used only to prove a folder child's parent). */
  readItem(driveId: string, itemId: string): Promise<HandlerResult>;
  previewItem(driveId: string, itemId: string): Promise<PreviewOutcome>;
}
export async function openCallerDocumentPreview(deps: HandlerDeps): Promise<DocumentPreviewAccess | HandlerResult>
```
`openCallerDocumentPreview` = `openOwnConnection(deps, undefined, (scopes) => scopes.some((s) => FILES_READ.has(s)))` + `microsoftReadQuota(deps)`; `previewItem` builds with `buildPreviewRequest`, calls `previewAllowed` immediately before the fetch (same position as `folderWriteAllowed`), uses `fetchMicrosoftJson` with an explicit 8 s timeout (under the 12 s request deadline of A11), and validates the URL with `validPreviewEmbedUrl`. `readItem` calls the existing scope-checked `get` with `$select=id,name,webUrl,parentReference,file,folder` (all in the `graphUrl` field allowlist), ; its body goes to the handler only, never to the browser. No generic request, credential getter or `fetch` is exported (the static pin in the mutation script, A21).
**Verify:** `deno test documentPreview.test.ts …`. Commit.

### A04 : error vocabulary (D10)
**Files:** modify `supabase/functions/m365-token-custody/types.ts`.
**RED:** a type-level + table test: `ERROR_STATUS.SOURCE_ACCESS_DENIED === 403`, `SOURCE_NOT_FOUND === 404`, `PREVIEW_UNSUPPORTED === 422`, `RECORD_FOLDER_UNAVAILABLE === 409`; `deno check` fails while `ERROR_STATUS` lacks a key (it is a `Record<M365ErrorCode, number>`).
**GREEN:** extend `M365ErrorCode` and `ERROR_STATUS` with the four codes; extend `M365Request` with `PreviewDocumentRequest` (import from `_shared`). Upload is multipart, so it has no JSON `M365Request` member.
**Verify:** `cd supabase/functions/m365-token-custody && deno check index.ts --config deno.json`. Commit.

### A05 : preview request parsing (AC-003, AC-014)
**Files:** create `documentPreview.ts` (parser only); extend `documentPreview.test.ts`.
**RED:** `parsePreviewRequest` accepts exactly `{action, kind, id}` for the three register kinds, `{action, kind, id, child_item_id}` only for them and only with a `safeGraphId` child, and `{action, kind:"procurement_file", phase, id}`; rejects extra keys (`path`, `drive_id`, `item_id`, `url`, `method`), a non-UUID id, an unknown kind or phase, and `child_item_id` on `procurement_file` (a purchase attachment is a file, never a folder). The three register kinds may carry `child_item_id` because each can reference a folder.
**GREEN:**
```ts
import { isRecord, UUID } from "./recordFolders.ts";
import { PROC_FILE_PHASES, type PreviewDocumentRequest } from "../_shared/microsoftDocumentPreview.ts";
import { safeGraphId } from "./graphFolderWrite.ts";

export function parsePreviewRequest(body: unknown): PreviewDocumentRequest | null {
  if (!isRecord(body) || body.action !== "preview_document") return null;
  if (typeof body.id !== "string" || !UUID.test(body.id)) return null;
  const keys = Object.keys(body).sort().join(",");
  if (body.kind === "procurement_file") {
    if (keys !== "action,id,kind,phase") return null;
    return (PROC_FILE_PHASES as readonly unknown[]).includes(body.phase)
      ? { action: "preview_document", kind: "procurement_file", phase: body.phase as never, id: body.id } : null;
  }
  if (body.kind !== "project_document" && body.kind !== "procurement_document" && body.kind !== "budget_link") return null;
  if (keys === "action,id,kind") return { action: "preview_document", kind: body.kind, id: body.id };
  if (keys === "action,child_item_id,id,kind" && safeGraphId(body.child_item_id))
    return { action: "preview_document", kind: body.kind, id: body.id, child_item_id: body.child_item_id };
  return null;
}
```
**Verify:** `deno test documentPreview.test.ts …`. Commit.

### A06 : caller-RLS source load (AC-014, NFR-001)
**Files:** modify `documentPreview.ts`; extend the test.
**RED:** `document-preview AC-014 an unreadable record returns a sanitized refusal before any Microsoft or signed-link call`. With `world.documents = []` (RLS hides the row) the served `handler` answers `404 SOURCE_NOT_FOUND` with the fixed message "This document is not available."; assert `graphCalls(calls).length === 0`, **no** `ms_graph_connections` select (`calls` shows none), no `storage` call, and the body contains no id, kind, drive or table name. Variants: row in another org (`org_id` mismatch) → same 404; a row with `source` not `onedrive` → same 404; `ms_item_kind` not `file` and no `child_item_id` → `422 PREVIEW_UNSUPPORTED`; archived purchase file (`archived_at` set) → 404.
**GREEN:** one table map, one query shape, `deps.callerClient!` only:
```ts
const TABLE = {
  project_document: { table: "project_documents", cols: "id,org_id,source,ms_drive_id,ms_item_id,ms_item_name,ms_item_kind" },
  procurement_document: { table: "procurement_documents", cols: "id,org_id,source,ms_drive_id,ms_item_id,ms_item_name,ms_item_kind" },
  budget_link: { table: "budget_version_document_links", cols: "id,org_id,ms_drive_id,ms_item_id,ms_item_name,ms_item_kind" },
} as const;
const FILE_TABLE = { purchase_request: "purchase_request_files", rfq: "rfq_files", quotation: "procurement_quotation_files",
  purchase_order: "purchase_order_files", receipt: "procurement_receipt_files", invoice: "procurement_invoice_files",
  payment: "payment_files" } as const satisfies Record<ProcFilePhase, string>;
```
`loadSource(deps, orgId, req)` selects with `.eq("id", id).limit(1)` (plus `.is("archived_at", null)` for files and `cols` including `source,ms_*`), requires `row.org_id === orgId`, `row.source === "onedrive"` (budget links have no `source` column; they are always Microsoft), and returns `{driveId, itemId, name, isFolder}` or `null`. Anything else is the one `NOT_AVAILABLE` result. **The order is load-bearing and is asserted:** parse → `authorizeMemberEntitled` → `loadSource` → (child proof) → `openCallerDocumentPreview` → Graph.
**Verify:** `deno test documentPreview.test.ts …`. Commit.

### A07 : folder-child containment (AC-003, AC-014)
**Files:** modify `documentPreview.ts`; extend the test.
**RED:** with a folder reference row and `child_item_id` X: Graph `GET /drives/synthetic-drive/items/X?$select=…` is called once; the preview POST happens only when the item has a `file` facet, no `folder` facet, `parentReference.driveId === row.ms_drive_id` and `parentReference.id === row.ms_item_id`. Each of these fails closed with the fixed 404 and **no preview POST**: parent id differs (a file elsewhere in the library), parent drive differs, item is a folder, malformed `parentReference`, Graph 404/403 on the metadata read (403 → `SOURCE_ACCESS_DENIED`). A `child_item_id` against a **file** reference row → 404 (a file has no children).
**GREEN:** `if (req.child_item_id) { if (!source.isFolder) return NOT_AVAILABLE; const meta = await access.readItem(source.driveId, req.child_item_id); … }` using `isRecord`, `itemKind` from `_shared/microsoftDocumentReference.ts`. The preview target becomes `{driveId: source.driveId, itemId: req.child_item_id}`; `name` comes from the metadata, never the request.
**Verify:** `deno test documentPreview.test.ts …`. Commit.

### A08 : handler + route (AC-003)
**Files:** modify `documentPreview.ts` (export `handlePreviewDocument(body, deps)`), `index.ts`.
**RED:** served `handler` (POST with a signed test JWT, as `recordFolderWrite.test.ts` does) with a readable project document reference → `200 {name, get_url}`; assert exactly one Graph call `POST /v1.0/drives/synthetic-drive/items/<id>/preview`, body `{}`, the response JSON has exactly the keys `name, get_url`, no `access_token`/`refresh_token`/`downloadUrl`; consent unchanged (no write to `ms_graph_connections` scopes); `graph_proxy` with `method:"POST", path:".../preview"` still returns 400 (the browser surface stays GET-only).
**GREEN:** `case "preview_document": result = await handlePreviewDocument(body, authed); break;` in the `index.ts` switch, after `ensure_record_folder`. Handler returns `{status:200, body:{name, get_url}, headers:{"Content-Type":"application/json","Cache-Control":"no-store"}}`. `Cache-Control: no-store` is part of the contract (NFR-002).
**Verify:** `deno test documentPreview.test.ts …`. Commit.

### A09 : outcome mapping (AC-003, AC-004, FR-004)
**Files:** modify `documentPreview.ts`; extend the test.
**RED:** table-driven: Graph 403 → `403 SOURCE_ACCESS_DENIED` ("Your Microsoft account can't open this file."); 404 → `404 SOURCE_NOT_FOUND`; unsupported → `422 PREVIEW_UNSUPPORTED`; 429 → `502 GRAPH_ERROR` + `Retry-After` capped at 30 and `retry_after_seconds`; timeout (hung fetch with `FakeTime`) → `502 GRAPH_ERROR`; connection missing → `404 NOT_CONNECTED`; stale → `409 CONNECTION_STALE`; revoked → `410`; no Files read scope → `403 SCOPE_INSUFFICIENT`; `NOT_ENTITLED` → 403. **AC-004 half:** in every case the only `ms_graph_connections` read is `.eq("user_id", USER)` for the JWT subject (assert on the recorded PostgREST URL), and a second org member's connection row present in the world is never touched.
**GREEN:** a small `mapOutcome(outcome)` using `failure()` from `recordFolders.ts`. Upstream text is never forwarded.
**Verify:** `deno test documentPreview.test.ts …`. Commit.

### A10 : secrecy of the capability (NFR-002)
**Files:** modify the test and, if needed, `graphRead.ts`.
**RED:** spy `console.error` / `console.log` / `console.warn`, run success and every failure above: no emitted line contains the `get_url`, the Graph item id, the file name, or a bearer token; `recordM365Error` receives only `{errorCode, contextId: connection.id, orgId}`; error bodies contain none of them; a 200 response sets `Cache-Control: no-store`.
**GREEN:** adjust `sendPreviewRequest` logging to `{status, connectionId}` only (the `redact: true` style of the folder transport).
**Verify:** `deno test documentPreview.test.ts …`. Commit.

### A11 : rate limit + deadline (NFR-004)
**Files:** modify `documentPreview.ts` (uses `microsoftReadQuota` through `openCallerDocumentPreview`), `index.ts` (add `preview_document` to the 12 s deadline branch like `ensure_record_folder`).
**RED:** 121st preview call in a minute for one user → `429 RATE_LIMITED`; a preview whose Graph call hangs resolves `502 GRAPH_ERROR` inside the deadline with `FakeTime`.
**GREEN:** `if (body?.action === "preview_document") scope?.limit(12_000);` with a `// mutation-witness:preview-request-deadline` tag.
**Verify:** `deno test documentPreview.test.ts …`. Commit.

### A12 : AC-003/AC-004 closing step
**Files:** test only.
**RED/GREEN:** one named step `document-preview AC-003 …` that runs the happy path end to end and asserts the AC's four clauses (dedicated operation only, ephemeral embeddable result, consent unchanged, no tokens). Confirm the AC-004 tag exists on the A09 step. Run the whole file.
**Verify:** `deno test documentPreview.test.ts --config deno.json --allow-env --allow-net --allow-read` green. Commit.

### A13 : upload name + request builder (AC-007, NFR-003, NFR-006)
**Files:** create `graphFileUpload.ts`; start `recordFileUpload.test.ts`.
**RED:** `document-preview AC-007 upload builder emits only the exact content PUT`. `buildUploadRequest({driveId, parentId, fileName:"Site plan.pdf", bytes:n})` → `{method:"PUT", path:"/drives/synthetic-drive/items/synthetic-parent-id:/Site%20plan.pdf:/content", query:"@microsoft.graph.conflictBehavior=rename", contentType:"application/pdf", size:n}`. `uploadAllowed` is false for: POST/PATCH, `@microsoft.graph.conflictBehavior=replace|fail`, extra query keys, `/createUploadSession`, another drive/parent, a name with `/ \ : * ? " < > | # %` or control characters or `..`, a name over 120 code points, an extension outside `ALLOWED_FILE_TYPES` (`.exe`, `.zip` in `DENIED_EXTENSIONS`), size 0 or over `MAX_FILE_SIZE_BYTES`, a content type that is not the server-derived `FILE_MIME_BY_EXT[ext]`. `sanitizeUploadFileName("a/b:c.pdf")` is `"a b c.pdf"`, keeps a single extension, NFC-normalises, trims dots and spaces.
**GREEN:** imports `ALLOWED_FILE_TYPES, DENIED_EXTENSIONS, FILE_MIME_BY_EXT, MAX_FILE_SIZE_BYTES` from `../../../pmo-portal/src/lib/fileConstants.ts` (one size/type policy, NFR-006; the custody `index.ts` already imports from `pmo-portal/src`). Exports `sanitizeUploadFileName`, `buildUploadRequest`, `uploadAllowed` (exact-match, tags `upload-allowlist-always-true`, `upload-method-put`, `upload-conflict-rename`, `upload-size-cap`, `upload-extension-allowlist`), and `validateUploadedItem(raw, {driveId, parentId})` (file facet present, folder absent, `safeGraphId(id)`, string name, `validMicrosoftBrowserUrl(webUrl)`, `parentReference.driveId === driveId && parentReference.id === parentId`) returning a `MicrosoftReferenceInput` with `item_kind:"file"` or null.
**Verify:** `deno test recordFileUpload.test.ts …`. Commit.

### A14 : upload transport (AC-007)
**Files:** modify `graphRead.ts`.
**RED:** `uploadFile(parentId, fileName, bytes)`: refuses with `SCOPE_INSUFFICIENT` **before any refresh or Graph call** when `Sites.Selected` is absent (reuse `SITES_SELECTED_SCOPES`, re-checked after the token refresh like `createFolder`'s `mutation-witness:refreshed-folder-grant`); sends one PUT with `Content-Type` from the builder (not `application/json`), the raw bytes, `Authorization` bearer; accepts only 200/201 with a JSON driveItem; 403 → `forbidden`; 409 → `unavailable`; 507/413 → `unavailable`; never retries.
**GREEN:** `openCallerRecordFileUpload(deps, library: RecordFolderLibrary, budget): Promise<{uploadFile(...)} | HandlerResult>` built on `openOwnConnection(deps, undefined, sitesSelected, budget)` so the drive comes from the server-loaded default library, never from the request. `fetchMicrosoftJson` already supports a binary `body` and its own `Content-Type` (pass headers explicitly; do not spread `GRAPH_HEADERS`); explicit 25 s timeout, under the 30 s request deadline of A16. Quota key `m365-token-custody:upload:${userId}`, 30 per 60 s via `checkRequestRate`.
**Verify:** `deno test recordFileUpload.test.ts …`. Commit.

### A15 : upload request parsing (AC-014, AC-009)
**Files:** create `recordFileUpload.ts` (parser); extend the test.
**RED:** `parseUploadRequest(formData)` accepts exactly the fields `action=upload_record_file`, `target_kind`, `target_id` (project) or `phase` + `parent_id` (purchase), and one `file` part. Rejects: JSON content type, extra fields (`drive_id`, `parent_item_id`, `folder`, `path`, `name`, `conflict`), non-UUID ids, a file over `MAX_FILE_SIZE_BYTES` (checked from `file.size` **and** by counting bytes, never trusting a header), an empty file, a denied or unlisted extension, two `file` parts. The browser-supplied `file.type` is ignored.
**GREEN:** returns `{target, file: {name, bytes: Uint8Array}}`; the safe name comes from `sanitizeUploadFileName(file.name)`.
**Verify:** `deno test recordFileUpload.test.ts …`. Commit.

### A16 : router accepts multipart (AC-007)
**Files:** modify `index.ts`.
**RED:** served `handler` with `Content-Type: multipart/form-data` and a valid JWT reaches `handleUploadRecordFile`; without a JWT it is `401` **before** the body is read (the audit LOW-B5 ordering stays); a JSON body still routes exactly as before (re-run `documentLinking.test.ts`, `recordFolders.test.ts` unchanged); `OPTIONS` preflight allows the multipart content type (check `corsHeaders` in `auth.ts` `Access-Control-Allow-Headers`).
**GREEN:** after `authedDeps`, `const type = req.headers.get("content-type") ?? ""; if (type.startsWith("multipart/form-data")) { scope?.limit(30_000); const form = await req.formData().catch(() => null); if (!form) return 400; result = await handleUploadRecordFile(form, authed); return toResponse(result, env.allowedOrigin); }` before the JSON `req.json()` block. `// mutation-witness:upload-request-deadline` on the `limit` call.
**Verify:** `deno test recordFileUpload.test.ts …` and the three existing custody suites. Commit.

### A17 : upload authorization + target load (AC-007, AC-014, FR-006, FR-014)
**Files:** modify `recordFileUpload.ts`.
**RED:** order asserted: parse → `authorizeMemberEntitled` → role in `WRITER_ROLES` (403 `FORBIDDEN` "You cannot upload to this record.") → caller-RLS target load → record folder → default library → quota → connection → Graph. A read-only role (`Engineer`, `Viewer`-class) gets 403 with **zero** Graph calls and no connection read. Project target: row must be `status === "Draft"`, `author_id === USER` or role `Admin` (mirrors `0391` and `guard_project_m365_source`), `source !== "onedrive"`; otherwise 403. Purchase target: the phase parent is read under the caller's JWT from `procurement_receipts` etc. (`PHASE_PARENT = {quotation:"procurement_quotations", receipt:"procurement_receipts", invoice:"procurement_invoices", purchase_request:"purchase_requests", rfq:"rfqs", purchase_order:"purchase_orders", payment:"payments"}`, the same map `0349` passes to `guard_procurement_file_path`), gives `procurement_id`; row org must equal the caller org. An unreadable target is the fixed 404 "This record is not available." before any Graph call.
**GREEN:** reuse `WRITER_ROLES`, `isRecord`, `failure`, `UUID` from `recordFolders.ts`.
**Verify:** `deno test recordFileUpload.test.ts …`. Commit.

### A18 : record folder + default library (AC-007, AC-008, FR-006/007)
**Files:** modify `recordFileUpload.ts`.
**RED:** `findRecordFolderRef(deps, kind, recordId)` reads `project_documents` / `procurement_documents` where `source='onedrive' and ms_item_kind='folder'` ordered by `ms_linked_at, id` limit 1 (same rule as `findExistingFolder`, so the same folder `ensure_record_folder` links) selecting `ms_drive_id, ms_item_id`. No folder row → `409 RECORD_FOLDER_UNAVAILABLE` ("This record has no SharePoint folder yet. Create the folder first.") and **no Graph call and no folder creation**. Default library unset → same code, other message. Folder drive ≠ `default_drive_id` → same code ("The record folder is outside the organisation library."). Parent item id is `ms_item_id` from the row, never from the request.
**GREEN:** `readDefaultSnapshot` from `recordFolders.ts`; compare `row.ms_drive_id === snapshot.drive_id`.
**Verify:** `deno test recordFileUpload.test.ts …`. Commit.

### A19 : the upload itself + outcome mapping (AC-007, AC-008)
**Files:** modify `recordFileUpload.ts`; extend the test.
**RED (AC-007):** happy path: one PUT to `/v1.0/drives/synthetic-drive/items/synthetic-parent-id:/Site%20plan.pdf:/content?@microsoft.graph.conflictBehavior=rename`, content-type `application/pdf`, body bytes equal the input; returns `200 {reference:{drive_id,item_id,web_url,name,item_kind:"file"}}` where `name` is the **returned** name (rename-on-conflict aware); the response contains no token. **RED (AC-008):** Graph 403 → `403 SOURCE_ACCESS_DENIED`; missing `Sites.Selected` → `403 SCOPE_INSUFFICIENT`; no connection → `404 NOT_CONNECTED`; stale/revoked; item with the wrong parent / a folder facet / no webUrl → `502 GRAPH_ERROR` and **no reference returned**; 5xx/timeout → `502 GRAPH_ERROR`; in no case is Storage touched (`calls` has no `storage/v1` request) and no `project_documents`/`*_files` write occurs (`calls` has no PATCH/POST to PostgREST tables other than the quota/audit RPCs).
**GREEN:** `mapUploadOutcome` shares `mapOutcome` from A09. After a confirmed success call `logAudit(serviceClient, {action:"m365.file_uploaded", orgId, actorId: deps.userId, entityId: <target id>, detail:{kind:<target kind>}})`: metadata only, no name, path or URL; best-effort by design (a missed audit row never fails a confirmed upload, unlike ADR-0089's mandatory creation receipt, because the register write that follows is itself audited by `project_document_m365_audit`/typed link audit).
**Verify:** `deno test recordFileUpload.test.ts …`. Commit.

### A20 : AC-014 on the upload boundary
**Files:** test only.
**RED/GREEN:** `document-preview AC-014 upload refuses an unreadable or unwritable target before any Microsoft operation`: parameterized over {other-org project doc, non-Draft doc, someone else's Draft as non-Admin, read-only role, unknown phase parent, archived parent}; each yields the sanitized refusal; assert zero Graph calls, no `ms_graph_connections` read, no response body leaking ids.
**Verify:** `deno test recordFileUpload.test.ts …`. Commit.

### A21 : mutation witness (AC-014, NFR-003)
**Files:** create `scripts/m365-preview-upload-mutation.mjs` and `scripts/m365-preview-upload-mutation.test.mjs`, modelled on `scripts/m365-record-folder-write-mutation.mjs` (isolated run per mutation, SHA-256 restore in `finally` and on SIGINT/SIGTERM).
**Mutations (each must turn the named test red, not just fail to compile):** `preview-allowlist-always-true`, `preview-method-post`, `preview-drive-equality`, `preview-body-empty`, `preview-request-deadline`, `upload-allowlist-always-true`, `upload-method-put`, `upload-conflict-rename`, `upload-size-cap`, `upload-extension-allowlist`, `upload-request-deadline`, plus handler-order breakers: delete the `loadSource` row-read check (AC-014 must fail), delete the `org_id` equality, delete the folder-child `parentReference.id` equality, delete the `WRITER_ROLES` check, delete the folder-in-default-library check. **Static pins:** the allowlist call sits immediately before the one fetch in `previewItem` / `uploadFile`; `graphRead.ts` exports no credential getter and no generic authenticated request; `graph_proxy` still rejects non-GET.
**Verify:** `node scripts/m365-preview-upload-mutation.mjs` (all mutations killed) and `node --test scripts/m365-preview-upload-mutation.test.mjs`. Commit.

### A22 : edge gate for the branch
Run `scripts/deno-test-edge-fns.sh` scoped to `m365-token-custody` and `_shared` (or the two commands in section 6 for every touched file), `npm run check:guards`, `npm run check:adrs`, then hand the branch to the security review in **G01**. Do not push before the Director says.

---

# Phase B : database (auth / RLS tier)

Branch `feat/doc-preview-db`. Test command is the one-lock-hold pgTAP command in section 6. Fixture style: copy `supabase/tests/0349_procurement_evidence_files.test.sql` (synthetic org/users/procurements with fixed UUID prefixes).

### B01 : write the failing pgTAP file (AC-010)
**Files:** create `supabase/tests/0408_document_preview_sources.test.sql` with the full plan below (all RED before B02).
Assertions (descriptions start `document-preview AC-010 …`):
1. each of the seven tables has `source`, `ms_drive_id`, `ms_item_id`, `ms_web_url`, `ms_item_name`, `ms_linked_by`, `ms_linked_at` (`has_column`, via a loop over the table names).
2. PM inserts a Microsoft-backed row (`source='onedrive', file_path=null`, complete ref) into each table → succeeds; `ms_linked_by = auth.uid()` and `ms_linked_at` are stamped by the trigger even when the client sends other values.
3. inserts violating exactly-one-source fail `23514`: file_path + ms ref; ms columns with `source` null; `source='onedrive'` with an incomplete ref; `source='upload'`.
4. an existing storage-backed insert (`file_path` set, no ms columns) still succeeds and the `guard_procurement_file_path` key check still rejects a foreign key.
5. client UPDATE of any `ms_*` or `source` column is denied (`42501`, column grants unchanged from 0349), UPDATE of `title`/`archived_at` still works.
6. read contract unchanged: org member reads both kinds of row; another org's user reads none; Engineer read-scope policy (0350) still hides rows outside scope; Admin-only DELETE (0058) still holds for a Microsoft-backed row.
7. cross-org insert denied; non-writer role denied.
8. project documents: a Draft row with `source='upload'`, `file_path` set, by its author, updated in **one statement** to `source='onedrive', file_path=null` + complete ref → succeeds (B03); the same update fails `23514` when the row is not Draft, when the actor is not the author and not Admin, and when `file_path` is left set; `onedrive → upload` direction unchanged; controlled (Issued) document replace still denied.
9. rows of an unrelated pre-existing kind (budget links) untouched: their `budget_version_document_links` constraints still reject an incomplete ref.
**RED check:** `supabase test db` reports the planned count with failures on 1-8.

### B02 : purchase attachment source columns (AC-010, NFR-007)
**Files:** create `supabase/migrations/0408_document_preview_sources.sql`.
```sql
-- 0408 — document preview: one durable source per purchase attachment (additive, reversible).
-- Rollback: supabase/migrations/rollback/0408_document_preview_sources_down.sql
do $$
declare t text;
begin
  foreach t in array array['procurement_quotation_files','procurement_receipt_files','procurement_invoice_files',
    'purchase_request_files','rfq_files','purchase_order_files','payment_files'] loop
    execute format($f$
      alter table public.%1$I
        add column source public.doc_source,
        add column ms_drive_id text,
        add column ms_item_id text,
        add column ms_web_url text,
        add column ms_item_name text,
        add column ms_linked_by uuid references public.profiles(id),
        add column ms_linked_at timestamptz,
        add constraint %1$I_source_one check (
          (source is null and num_nonnulls(ms_drive_id,ms_item_id,ms_web_url,ms_item_name,ms_linked_by,ms_linked_at)=0)
          or (source='onedrive' and file_path is null
              and public.m365_ref_complete(ms_drive_id,ms_item_id,ms_web_url,ms_item_name,'file',ms_linked_by,ms_linked_at))
        ) $f$, t);
  end loop;
end $$;
```
`source` stays null for every existing row (no backfill, no bulk migration); a storage-backed attachment is "`source is null` and `file_path` set". `'upload'` is deliberately not accepted on these tables so there is exactly one representation of each source.
**Verify:** pgTAP assertions 1, 3 green. Commit.

### B03 : stamp trigger for the new columns (AC-010)
Same migration: `public.stamp_procurement_file_ms_source()` (`language plpgsql set search_path = public, pg_catalog`): on `INSERT`, if `new.source='onedrive'` then `new.ms_linked_by := auth.uid(); new.ms_linked_at := now();` (unless `public.actor_bypasses_rls()` supplied them) else null both; `revoke all … from public, anon, authenticated`; `before insert` trigger named `zz_<table>_ms_stamp` on each table (the `zz_` prefix runs after the 0349 guard, as in that migration).
**Verify:** assertion 2 green.

### B04 : amend `guard_project_m365_source` for the Draft upload-to-Microsoft swap (AC-010, FR-014, Q3)
Same migration: `create or replace function public.guard_project_m365_source()` copied from 0292 lines 125-165 with **one** condition changed:
```sql
-- before:  if new.source='onedrive' and (old.file_path is not null or (old.source is not null and old.source is distinct from 'upload')) then raise …
-- after:
if new.source='onedrive' and (
     (old.file_path is not null and not (old.source='upload' and new.file_path is null))
     or (old.source is not null and old.source is distinct from 'upload')) then
  raise exception 'This entry already has a file or link.' using errcode='23514',detail='m365-source-collision';
end if;
```
All later checks in the function (Draft only; author or Admin; writer roles; org match) still run for the swap because they key on `new.source='onedrive'`. Re-read the full 0292 function body while editing: the only diff in the migration file against 0292's definition is this clause.
**Verify:** pgTAP assertion 8. Commit.

### B05 : rollback file (NFR-007)
**Files:** create `supabase/migrations/rollback/0408_document_preview_sources_down.sql`: drop the seven triggers and the function, drop the seven constraints then the seven column sets (`drop column if exists`), and `create or replace` the 0292 body of `guard_project_m365_source` back. Header comment: "rows whose only source is a Microsoft item lose that link; existing uploaded bytes and Microsoft files are never touched; rehearse before first use".
**Verify:** `scripts/with-db-lock.sh bash -c 'supabase db reset && psql … -f supabase/migrations/rollback/0408_document_preview_sources_down.sql'` runs clean (use the repo's rollback harness pattern from `scripts/test-m365-batch-sweep-rollback.sh`); then re-apply 0408. Commit.

### B06 : types by hand, minimal (AC-010)
**Files:** modify `pmo-portal/src/lib/supabase/database.types.ts`: add the seven columns (`source: Database['public']['Enums']['doc_source'] | null`, the four text columns, `ms_linked_by`, `ms_linked_at`) to `Row`/`Insert`/`Update` of the seven tables only. Do **not** regenerate the whole file (it is already behind `dev` by unrelated lines; `docs/decisions.md` records the same note), so a regeneration would drag unrelated churn into this PR.
**Verify:** `cd pmo-portal && npm run typecheck` and `npm run check:shadow-types`. Commit.

### B07 : isolation probe denominator
`scripts/isolation-probe-denominator.json` lists tenant tables, not columns. All seven purchase file tables are already listed (checked: one entry each) and 0408 adds no table, so nothing changes. **Verify:** `grep -c '"table":"payment_files"' scripts/isolation-probe-denominator.json` prints 1 for each of the seven names; no commit.

### B08 : DB gate
Full touched-file pgTAP in one lock hold (section 6), `npm run check:migrations`, hand to the security review (G01). No `db push` anywhere; production deploy is out of scope and needs the owner's per-instance yes.

---

# Phase C : the shared viewer (FE)

Branch `feat/doc-preview-viewer`. All files under `pmo-portal/src/components/documents/` unless stated.

### C01 : renderer selection (AC-005, FR-005/009, NFR-006)
**Files:** create `renderers.ts`, `renderers.test.ts`; modify `pmo-portal/src/lib/fileConstants.ts`.
**RED** `document-preview AC-005 selectRenderer matrix`: private source: `a.pdf` → `native-pdf`; `.png/.jpg/.jpeg/.webp` (any case) → `native-image`; `.docx/.xlsx/.pptx/.doc/.xls/.ppt` → `office-online`; `.csv/.txt/.dwg/.dxf/.zip/no extension` → `unsupported`; microsoft source: any name → `microsoft` (the server decides). A file name with a path (`a/b.pdf`) uses the last segment. `ALLOWED_FILE_TYPES` is unchanged (assert deep-equal to the current list, NFR-006: preview never widens upload).
**GREEN:**
```ts
export type RendererKind = 'native-pdf' | 'native-image' | 'office-online' | 'microsoft' | 'unsupported';
const IMAGE = new Set(['png', 'jpg', 'jpeg', 'webp']);
const OFFICE = new Set(['docx', 'xlsx', 'pptx', 'doc', 'xls', 'ppt']);
export function selectRenderer(input: { name: string; source: 'private' | 'microsoft' }): RendererKind {
  if (input.source === 'microsoft') return 'microsoft';
  const ext = input.name.split('/').pop()!.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'pdf') return 'native-pdf';
  if (IMAGE.has(ext)) return 'native-image';
  return OFFICE.has(ext) ? 'office-online' : 'unsupported';
}
export const officeViewerUrl = (signedUrl: string) =>
  `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(signedUrl)}`;
```
In `fileConstants.ts` add `VIEWABLE_EXTENSIONS` (the viewer's supported set, documented as "preview only; upload acceptance is `ALLOWED_FILE_TYPES`") and leave `PREVIEWABLE_EXTENSIONS` for any remaining reader until D05 removes the last use.
**Verify:** `cd pmo-portal && npx vitest run src/components/documents/renderers.test.ts`. Commit.

### C02 : target + error types (D2, D10)
**Files:** create `types.ts`.
```ts
import type { ReactNode } from 'react';

export type PreviewResult =
  | { mode: 'image'; url: string }
  | { mode: 'pdf'; url: string }
  | { mode: 'embed'; url: string; provider: 'microsoft' | 'office-online' }
  | { mode: 'unsupported' };

export type PreviewFailureKind =
  | 'access_denied' | 'not_connected' | 'connection_stale' | 'consent_needed'
  | 'not_found' | 'unsupported' | 'rate_limited' | 'unavailable' | 'no_file' | 'expired';

export class PreviewFailure extends Error {
  constructor(public readonly kind: PreviewFailureKind, public readonly retryAfterSeconds?: number) { super(kind); }
}

export interface DocumentViewTarget {
  /** Stable identity: one active document owns the panel; a late result for another key is dropped. */
  key: string;
  name: string;
  /** 'SharePoint' | 'OneDrive' | 'Microsoft 365' | 'PMO' (display only). */
  sourceLabel: string;
  /** Runs on open and on Retry only (NFR-004). Throws PreviewFailure. */
  load: (signal: AbortSignal) => Promise<PreviewResult>;
  /** Authorized download of the original, independent of preview (FR-010). */
  download?: () => Promise<void>;
  /** Validated https URL; label is the source-appropriate "Open in SharePoint". */
  openInSource?: { url: string; label: string };
  /** FR-012: e.g. "Latest in SharePoint, not the approved version". */
  notice?: string;
  /** Existing recovery / drift UI rendered under the preview (project controlled files). */
  extra?: ReactNode;
}
```
No test (types only); `npm run typecheck` is the verify. Commit with C03.

### C03 : Microsoft preview client (AC-003/004, FR-003/004)
**Files:** create `pmo-portal/src/lib/m365/previewClient.ts`, `previewClient.test.ts`.
**RED:** `previewMicrosoftDocument(request)` calls `supabase.functions.invoke('m365-token-custody', {body:{action:'preview_document', ...request}})` through `invokeWithTimeout`; maps the response `{name,get_url}` to `{mode:'embed', provider:'microsoft', url}` after re-validating the host with `validPreviewEmbedUrl` (a bad host → `PreviewFailure('unavailable')`); maps error codes → kinds: `SOURCE_ACCESS_DENIED`→`access_denied`, `NOT_CONNECTED`→`not_connected`, `CONNECTION_STALE`/`CONNECTION_REVOKED`→`connection_stale`, `SCOPE_INSUFFICIENT`→`consent_needed`, `SOURCE_NOT_FOUND`→`not_found`, `PREVIEW_UNSUPPORTED`→`unsupported`, `RATE_LIMITED`→`rate_limited` (+`Retry-After`), anything else→`unavailable`. The request type is the shared `PreviewDocumentRequest` re-exported from `pmo-portal/src/lib/m365/previewClient.ts` via `../../../../supabase/functions/_shared/microsoftDocumentPreview` (same import style as `reference.ts`). Parse the error code the way `graphClient.ts::parseErrorCode` does (reuse by exporting it). The URL is never written to `console`, the query client or storage.
**GREEN:** straight from the above.
**Verify:** `npx vitest run src/lib/m365/previewClient.test.ts`. Commit.

### C04 : the viewer state machine + provider (AC-006, FR-001/011, NFR-004)
**Files:** create `DocumentViewerProvider.tsx`, `DocumentViewer.tsx`, `DocumentViewer.race.test.tsx`.
**RED** `document-preview AC-006`: (a) opening a target calls `load` once and shows the loading status **before** `load` resolves (assert the status node exists while the promise is pending); (b) no `load` call happens at render time of a list row, only on `open`; (c) `load` rejects with `PreviewFailure('expired')` → error state with a **Retry** button; Retry calls `load` again (second call, fresh `AbortSignal`) and shows the new result; (d) open A (pending), open B, then resolve A late → B's content is shown, A's result is dropped and A's `AbortSignal` is aborted; (e) closing while pending aborts and a later resolve renders nothing; (f) no automatic retry: a failed load is called exactly once until Retry is pressed (fake timers advance 60 s).
**GREEN:**
```tsx
type ViewerState =
  | { phase: 'closed' }
  | { phase: 'loading'; target: DocumentViewTarget; gen: number }
  | { phase: 'ready'; target: DocumentViewTarget; result: PreviewResult }
  | { phase: 'failed'; target: DocumentViewTarget; kind: PreviewFailureKind };

// provider: useRef generation counter + AbortController held in a ref
const run = useCallback((target: DocumentViewTarget) => {
  controller.current?.abort();
  const ac = (controller.current = new AbortController());
  const gen = ++generation.current;
  setState({ phase: 'loading', target, gen });
  target.load(ac.signal).then(
    (result) => { if (gen === generation.current && !ac.signal.aborted) setState({ phase: 'ready', target, result }); },
    (err) => { if (gen === generation.current && !ac.signal.aborted)
      setState({ phase: 'failed', target, kind: err instanceof PreviewFailure ? err.kind : 'unavailable' }); },
  );
}, []);
const open = (target, opener) => { openerRef.current = opener ?? (document.activeElement as HTMLElement | null); run(target); };
const close = () => { controller.current?.abort(); generation.current += 1; setState({ phase: 'closed' });
  const el = openerRef.current; openerRef.current = null; requestAnimationFrame(() => el?.isConnected && el.focus({ preventScroll: true })); };
```
The provider renders `<Drawer open title={target.name} width="lg" onClose={close} footer={...}>` with the body from C05/C06. `DocumentViewerProvider` exposes `useDocumentViewer(): { open(target, opener?), close() }` via context; outside a provider the hook throws a clear error (a test asserts it). **The URL lives only in this component's state** (NFR-002): `useDocumentViewer` never stores results in the query cache; assert with `queryClient.getQueryCache().getAll()` length 0 in a test.
**Verify:** `npx vitest run src/components/documents/DocumentViewer.race.test.tsx`. Commit.

### C05 : states and recovery copy (AC-004, FR-004/010/011, failure table)
**Files:** extend `DocumentViewer.tsx`; create `DocumentViewer.states.test.tsx`; create `pmo-portal/public/locales/{en,id}/documentViewer.json` (EN + ID, same keys) and register `documentViewer` in `NAMESPACES` in `pmo-portal/src/lib/i18n/index.ts`.
**RED** `document-preview AC-004` and states: for each `PreviewFailureKind` the panel shows plain-language copy and the right actions: `access_denied` → "Your Microsoft account can't open this file. Ask the owner for access, or open it in SharePoint." + **Open in SharePoint** (when `openInSource`) and **no** Reconnect button; `not_connected` / `connection_stale` → "Connect your Microsoft account to preview this file." with the existing connect entry (link to the profile/integration settings route used by `M365BrowseNotice.tsx`; read it before choosing), plus Open in source; `consent_needed` → reconnect text; `unsupported` → "Preview isn't available for this file type." + Download; `expired`/`unavailable` → Retry + Download + Open in source; `no_file` → "No file is attached." with **no** Download button and **no** preview; `rate_limited` → text only, Retry disabled until `retryAfterSeconds` elapsed. Download failure shows the denial reason (FR-010) and does not claim a fallback grants access. In all states the dialog has Close.
**GREEN:** a `FAILURE_COPY: Record<PreviewFailureKind, {key, actions}>` table; `role="alert"` for failures, `role="status"` + `aria-live="polite"` for loading (reuses the markup of the old `ReceiptPreview`).
**Verify:** `npx vitest run src/components/documents/DocumentViewer.states.test.tsx && npm run check:i18n`. Commit.

### C06 : renderers inside the panel (AC-005, FR-005/008/009)
**Files:** extend `DocumentViewer.tsx`; create `DocumentViewer.render.test.tsx`.
**RED** `document-preview AC-005`: `{mode:'image'}` → `<img alt={name}>`, onError → failed `unavailable`; `{mode:'pdf'}` → `<iframe title={name}>` with the URL; `{mode:'embed', provider:'microsoft'}` → `<iframe title={name} sandbox="allow-scripts allow-same-origin allow-forms allow-popups">`; `{mode:'embed', provider:'office-online'}` → iframe whose `src` starts `https://view.officeapps.live.com/op/embed.aspx?src=` and encodes a **fresh** signed URL (the test counts `getSignedUrl` calls: one per open, one more per Retry); unsupported → copy + Download; Download stays reachable in every state (including a failed Office viewer); the iframe `load` event is **not** used as proof of rendering (no assertion or state keyed on it, per the spec's provider-proof note).
**GREEN:** one `switch (result.mode)`; Office-online iframe also gets a visible note "If the preview stays blank, download the file." (a blank public-viewer frame is indistinguishable from success, so the escape hatch is always shown for that provider).
**Verify:** `npx vitest run src/components/documents/DocumentViewer.render.test.tsx`. Commit.

### C07 : target adapters, private storage (AC-001, AC-005, FR-008/010)
**Files:** create `targets/storage.ts`, `targets/storage.test.ts`.
**RED:** `storageTarget({key,name,filePath,getSignedUrl,sourceLabel:'PMO'})`: `load` calls `getSignedUrl(filePath)` once and returns per `selectRenderer`: pdf/image direct URL, office → `{mode:'embed',provider:'office-online',url:officeViewerUrl(url)}`, other → `{mode:'unsupported'}` **without** calling `getSignedUrl`; no `filePath` → throws `PreviewFailure('no_file')`; `download` calls `getSignedUrl(filePath,{download:true})` and triggers an anchor download, rethrowing the classified storage error for the panel to show; a rejected signing → `PreviewFailure('unavailable')`.
**GREEN:** takes the accessor as a parameter (the callers pass `repositories.document.getSignedUrl` / `repositories.procurementFiles.getSignedUrl` / the receipt `download`), so one adapter serves project, purchase and receipt files.
**Verify:** `npx vitest run src/components/documents/targets/storage.test.ts`. Commit.

### C08 : permissions are read-only by construction (AC-011, FR-013/014)
**Files:** create `DocumentViewer.permissions.test.tsx`.
**RED** `document-preview AC-011`: render the viewer under `AuthProvider` fixtures for a read-only role (e.g. `Engineer`/`Viewer` as defined in `src/auth/policy.ts`) and under an impersonated role: Preview, Download and Open-in-source work; the viewer renders **no** upload/replace/link/archive/status control (query the panel for those names: none), and the surface adapters still hide mutation buttons through `can()`/`useDocumentLinkPermissions` (cases assert `FileCell` without `onUpload`/`onReplace`, `LinkedDocumentCell` link actions per `DocumentLinkPermissions.tsx`). Impersonation: the real role gates (`realRole === effectiveRole`) are unchanged.
**GREEN:** no new production code expected (the viewer carries no mutation affordance); if a case fails, fix the surface, not the test.
**Verify:** `npx vitest run src/components/documents/DocumentViewer.permissions.test.tsx`. Commit.

### C09 : accessibility and narrow viewport (AC-013, NFR-005/008)
**Files:** create `DocumentViewer.a11y.test.tsx`.
**RED** `document-preview AC-013`: for {loading, ready (embed), ready (image), denied, unsupported} × {en, id} (render under `createInstance()` + `I18nextProvider` with the real en/id `documentViewer.json`, the pattern at `LinkedDocumentCell.test.tsx` line 198): `axe` (jest-axe, already used in `NativeStatementPair.test.tsx`) reports no violations; the dialog is named (accessible name = file name), the iframe has a `title`, the image has `alt`; Tab cycles inside the panel and Shift+Tab wraps (Drawer trap); Esc closes; focus returns to the opener when it still exists and to `document.body` safely when it was removed; with `window.innerWidth = 320` the panel root has `max-md:w-full` semantics (assert the class from `Drawer`) and the action row wraps (`flex-wrap`), no element has a fixed `min-width` over 320 (assert none of the panel's elements carry an inline width above 320).
**GREEN:** adjust markup only (`flex-wrap`, `min-w-0`), tokens only.
**Verify:** `npx vitest run src/components/documents/DocumentViewer.a11y.test.tsx`. Commit.

### C10 : mount the provider (FR-001)
**Files:** modify `pmo-portal/App.tsx` (wrap the routed tree inside `ToastProvider`, around line 547), `pmo-portal/src/components/documents/index.ts` (re-export hook + types).
**RED:** `App`-level smoke test in `DocumentViewerProvider.test.tsx`: navigating routes while the panel is open keeps it open? (No: a route change closes it; assert `close` on location change via `useLocation` effect, so a stale panel never covers a new page.) The panel never changes `location.pathname`/`search`/scroll (assert unchanged after open and close).
**GREEN:** `useLocation()` effect → `close()` on pathname change only (not on search-param/filter change, which must keep the panel and the user's place).
**Verify:** `npx vitest run src/components/documents/DocumentViewerProvider.test.tsx` and `npm run typecheck`. Commit.

---

# Phase D : wire every entry point (FE)

Each task: RED = the surface's existing test gains a case asserting the Preview action calls `useDocumentViewer().open` with a target whose `key`/`name` match and does **not** call `window.open`; GREEN = swap the handler. The AC-001 parameterized test (D08) is the owner; per-surface cases are in the surface's own test file and untagged. Verify each with `npx vitest run <surface test>`.

### D01 : project register files (AC-001, FR-001/008)
**Files:** `pages/project-detail/tabs/useDocumentFiles.tsx`, `src/components/FileCell.tsx`, `src/components/FileCell.test.tsx`, `pages/project-detail/tabs/DocumentsTab.test.tsx`.
Replace `handlePreview`'s `window.open(url)` with `viewer.open(storageTarget({…getSignedUrl: (p) => repositories.document.getSignedUrl(p)}), e.currentTarget)`; `FileCell.canPreview` uses `VIEWABLE_EXTENSIONS` (Office files now previewable); `openPreview(doc)` for a Microsoft reference opens `microsoftTarget` (D02) instead of `window.open(reference.web_url)`. Update the `FileCell` test that asserted preview only for pdf/images. **Deliberate UX change (preview in panel), so `e2e/AC-DOC-020-upload-download-journey.spec.ts` preview steps are updated in F08, goal oracle intact.**

### D02 : project Microsoft reference + controlled-version labels (AC-012, FR-012)
**Files:** create `targets/project.tsx`, `targets/project.test.tsx`; modify `pages/project-detail/tabs/ProjectDocumentMicrosoft.tsx`, `src/components/m365/LinkedDocumentCell.tsx`.
**RED** `document-preview AC-012`: a Draft file reference opens with no notice; an **Issued/Approved** one opens with `notice` "Latest in SharePoint. This is not the approved version." (EN+ID), `extra` containing `DocumentDriftBadge` with the row's `drift_state` and `ApprovedVersionHistory` (the existing recovery, unchanged props); when `load` fails `unsupported`/`unavailable` for an approved document the `extra` recovery is still present and the panel never relabels the latest bytes as approved; the spy repository shows **no** `transition`, `update`, `confirm` or `setDrift` call during open/close (nothing written); pinned `version_id_at_issue` text is shown from the row, not recomputed. A folder reference does not open the viewer (it keeps "Open folder" + "Show files").
**GREEN:** `projectDocumentTarget(row, owner)` → `microsoftTarget({request:{kind:'project_document', id: row.id}, name: reference.name, openInSource, …})` (below). `LinkedDocumentCell` gets a **Preview** button for `item_kind==='file'` (calls `viewer.open`), keeping "Open in {{place}}" as the secondary action (`openReference` unchanged, still `validMicrosoftBrowserUrl`-guarded).

### D03 : shared Microsoft target (AC-003/004)
**Files:** create `targets/microsoft.ts`, `targets/microsoft.test.ts`.
```ts
export function microsoftTarget(a: {
  request: Omit<PreviewDocumentRequest, 'action'>; name: string; webUrl: string; extra?: ReactNode; notice?: string;
}): DocumentViewTarget {
  const place = microsoftProvenance(a.webUrl);
  return {
    key: `ms:${JSON.stringify(a.request)}`, name: a.name, sourceLabel: place,
    load: (signal) => previewMicrosoftDocument(a.request, signal),
    openInSource: validMicrosoftBrowserUrl(a.webUrl) ? { url: a.webUrl, label: `Open in ${place}` } : undefined,
    extra: a.extra, notice: a.notice,
  };
}
```
**RED:** the target never contains the Graph drive/item ids or a URL in `key`; `openInSource` is dropped for a non-https stored URL; `load` forwards the abort signal.

### D04 : purchase references and phase files (AC-001, FR-001/015)
**Files:** `pages/procurement/ProcurementMicrosoftReferences.tsx` (+ its test), `pages/procurement/ProcurementFilesSubsection.tsx` (+ test), `pages/procurement/LedgerFileCell.tsx` (+ test), `src/hooks/useProcurementFiles.ts`.
`ProcurementMicrosoftReferences` → `microsoftTarget({kind:'procurement_document', id})` for file references; `ProcurementFilesSubsection` Preview button (today limited by `isPreviewable`, `window.open`) → `procurementFileTarget(row)`: row with `source==='onedrive'` → `microsoftTarget({kind:'procurement_file', phase, id})`, else `storageTarget` with `download` from `useProcurementFiles().download`. `LedgerFileCell.SingleFileButton` (today opens a signed URL in a new tab) opens the same target. Keep the legacy plain-link row ("Open linked document") as Open in source only (spec: unresolved legacy link → panel explains + validated Open in source): `legacyLinkTarget(url)` whose `load` throws `PreviewFailure('unsupported')`.

### D05 : budget evidence (AC-001, FR-001)
**Files:** `src/components/m365/BudgetDocumentLinks.tsx` (+ test). `budgetReference(row)` file → `microsoftTarget({kind:'budget_link', id: row.id})`. Read paths stay valid on Active/Archived versions; link/unlink stay Draft-gated by `useDocumentLinkPermissions().budgetEdit` (unchanged).

### D06 : folder children (AC-001, FR-015)
**Files:** `src/components/m365/LinkedFolderFiles.tsx` (+ test), `LinkedDocumentCell.tsx`. `LinkedFolderFiles` gains an `owner` prop (`ReferenceOwner` + the parent row id; passed down by `LinkedDocumentCell`) and, per **file** child, a Preview button → `microsoftTarget({kind: owner.kind==='project'?'project_document':owner.kind==='procurement'?'procurement_document':'budget_link', id: owner.id, child_item_id: file.item_id}, name: file.name, webUrl: file.web_url)`. The existing Open link stays. Folder children (rows with `item_kind==='folder'`) get no Preview. Folder browsing and file preview stay distinct calls.

### D07 : expense receipts and approval evidence (AC-001, FR-015, D8)
**Files:** `pages/expenses/ExpenseReceiptsCard.tsx`, `pages/approvals/ExpenseClaimApprovalSection.tsx`, their tests, `src/components/ui/index.ts` (drop the `ReceiptPreview` export), **delete** `src/components/ui/ReceiptPreview.tsx` and `src/components/ui/__tests__/ReceiptPreview.test.tsx`.
`receiptTarget({name, getUrl, download})` is `storageTarget` over the existing parent-authorized accessor (`useExpenseReceipts().download`). The "Preview receipt" `Button` stays in the card and calls `viewer.open`. Port the old `ReceiptPreview.test.tsx` cases into `DocumentViewer.*.test.tsx` first (Esc, focus return, unsupported copy, failed → Download original); delete the old files only when those pass. Verify the card tests and the approval-section test.

### D08 : AC-001 parameterized owner
**Files:** create `entryPoints.test.tsx`.
**RED/GREEN** `document-preview AC-001`: `it.each` over the seven surfaces {project register row, project quick view, purchase Microsoft reference, purchase phase file, budget link, folder child, expense receipt}. Each case renders the real leaf component inside a spy `DocumentViewerContext` + `MemoryRouter`, clicks the Preview control, and asserts: `open` called once with a target whose `name` is the file name; `window.open` **not** called (spy); `location.pathname` and the `?filter=` search unchanged; the selected-row marker (`aria-selected`/`selectedKey` surface) unchanged; no `<a target="_blank">` was activated.
**Verify:** `npx vitest run src/components/documents/entryPoints.test.tsx`. Commit.

---

# Phase E : connected-organisation upload (FE)

Branch `feat/doc-preview-upload`; starts after A, B, C merge to dev.

### E01 : upload client + repository seam (AC-007, FR-006)
**Files:** create `pmo-portal/src/lib/m365/uploadClient.ts` and `uploadClient.test.ts`; modify `src/lib/repositories/{types,index}.ts` only if a repository method is needed (the hook may call the client directly, as `previewClient` is called by targets).
**RED:** `uploadRecordFile(target, file)` posts a `FormData` with exactly `action, target_kind, target_id | phase, parent_id, file` via `supabase.functions.invoke` (no JSON), validates the response with `assertMicrosoftReference` and `item_kind==='file'`, maps `RECORD_FOLDER_UNAVAILABLE` → `PreviewFailure`-style `UploadFailure('folder')`, `SCOPE_INSUFFICIENT` → `consent`, `NOT_CONNECTED/STALE/REVOKED` → `connection`, `SOURCE_ACCESS_DENIED` → `access`, `NOT_ENTITLED` → `entitlement`, else `unavailable`. Client-side `validateFile(file)` (existing `src/lib/validateFile.ts`) runs first.

### E02 : persistence through the existing repositories (AC-007, NFR-007, FR-014)
**Files:** `src/lib/db/documents.ts`, `src/lib/db/procurementFiles.ts`, `src/lib/repositories/*`; create `src/lib/db/documents.upload.test.ts`.
**RED** `document-preview AC-007` (repository half): `attachMicrosoftUpload(docId, reference)` issues **one** UPDATE `{source:'onedrive', file_path:null, ms_drive_id, ms_item_id, ms_web_url, ms_item_name, ms_item_kind:'file'}` with `.eq('id', docId)` and asserts the write landed (`assertWriteLanded`); a rejected write throws the `AppError` with its Postgres code. `confirmMicrosoftUpload(phase, parentId, reference, title, uploadedById)` inserts `{<parentCol>: parentId, source:'onedrive', file_path:null, ms_*, title, uploaded_by_id}` through the same `FILE_TABLE_BY_PHASE` map (no per-phase copies; reuse `normalizeRow`, extending `ProcurementFileRow` with optional `source` + `ms_*`). `listProcurementFiles` already `select('*')`, so rows carry the new columns.
**GREEN:** add both functions and the repository entries; remove nothing.

### E03 : destination decision hook (AC-008, FR-006/007, D6)
**Files:** create `useUploadDestination.ts`, `useUploadDestination.test.tsx`.
**RED** `document-preview AC-008`: `useUploadDestination(record)` returns `{kind:'microsoft'}` when `useMicrosoftDocuments().defaultLibrary != null`, else `{kind:'private'}`; while the settings read is pending or errored it returns `{kind:'unknown'}` and the caller disables upload (a settings failure is never "no library", the rule `useMicrosoftDocuments` already documents). When `{kind:'microsoft'}` and the upload fails with folder/consent/connection/access/entitlement, the hook's `onFailure` surfaces the recovery (copy + the existing Create folder action `RecordFolderAction` for `folder`, the connect entry for `connection`/`consent`), the **previous attachment is unchanged** (assert the repository spies were not called) and **no `prepareUpload` (Storage) call occurs** (no silent fallback). A success calls only the Microsoft persistence path.

### E04 : project upload wiring (AC-009, AC-007, FR-006/008/014)
**Files:** `src/hooks/useFileUpload.ts`, `src/hooks/useFileUpload.test.ts`.
**RED** `document-preview AC-009`: with destination `private` the existing flow is byte-for-byte as today (`prepareUpload` → `uploadWithProgress` → `confirmUpload`, `allowReplace` cleanup), size > 5 MiB and disallowed types still rejected by `validateFile`/`classifyUploadError`, Download keeps working for every type; with destination `microsoft` the flow is `uploadRecordFile` → `attachMicrosoftUpload`, then (for a replace) `cleanupObject(oldPath)` **after** the attach succeeded and only best-effort; if `attachMicrosoftUpload` fails the old private file reference is untouched and the error is classified (the uploaded Microsoft file stays; copy tells the user it can be linked from the picker). Only `Draft` + `canEditDoc` rows reach either path (existing `handleFileSelected` gate in `useDocumentFiles.tsx`).
**GREEN:** branch inside `uploadDocumentFile` on the destination passed in from `useDocumentFiles`; progress is indeterminate for the Microsoft path (single request; show the existing progress bar at 0 then 100, cancel via `AbortController` aborts the fetch).

### E05 : purchase upload wiring (AC-007/008, FR-006/007, Q5)
**Files:** `src/hooks/useProcurementFiles.ts` (+ test `useProcurementFiles.test.ts` case), `pages/procurement/ProcurementFilesSubsection.tsx`, `LedgerFileCell.tsx`.
Same branch as E04 using `confirmMicrosoftUpload`. The record folder is the **purchase case's** folder (server-derived from the phase parent). Existing `procFile`/phase restrictions on `canWrite` stay untouched; RLS and the 0349 guard are the authority.

### E06 : FE gate
`npm run check:guards`, `npm run typecheck`, eslint on touched files, the touched vitest files. No e2e here (F08 is the only curated journey).

---

# Phase F : localization, ADR hygiene, journey

### F01 : copy inventory
Every user-visible string added in C-E has an EN and ID entry in `documentViewer.json` (keys: `viewer.title`, `viewer.loading`, `viewer.close`, `viewer.retry`, `viewer.download`, `viewer.openInSource`, `viewer.latestNotice`, `failure.accessDenied`, `failure.notConnected`, `failure.consentNeeded`, `failure.unsupported`, `failure.unavailable`, `failure.noFile`, `failure.rateLimited`, `viewer.officeBlankHint`, `upload.folderUnavailable`, `upload.connectionNeeded`, `upload.accessDenied`, `upload.linkLater`). Surface strings that already live in `project.json`/`common.json`/`recordFolders.json` (`m365Documents.cell.*`) get the new `cell.preview` key beside them.
### F02 : parity
`cd pmo-portal && npm run check:i18n` (en/id key parity + namespace registration + the common-keys baseline). Fix by adding keys, never by editing the baseline.
### F03 : ADR
Confirm ADR-0095 renders in `npm run check:adrs` and its links resolve; update its status to Accepted when the Director accepts. No other ADR.
### F04 : docs pointers
Add a one-line pointer from `docs/specs/document-preview.spec.md` "Implementation handoff checklist" to this plan, and tick only the boxes the merged code satisfies (docs-only, push direct to `dev` per repo rule when the Director says).
### F05 : DESIGN.md tokens audit
Grep the new components for raw hex / `px` font sizes / arbitrary shadows; replace with tokens (`bg-popover`, `border-border`, `text-support`, `text-control`, `--space-content-inset`). `eslint --max-warnings=0` on the new files.
### F06 : `ux-proof`
`scripts/ux-proof.sh` on the touched routes (project detail documents tab, procurement detail, budget version evidence, expenses). Capture the viewer in loading, ready (image), denied, unsupported, in EN and ID at 1280 px and 320 px. The Director does one rendered review; cap one fix round.
### F07 : e2e skip/isolation guards
`npm run check:e2e-isolation` (the new spec carries a `// @e2e-isolation:` tag), `node scripts/check-e2e-skips.mjs --self-test`.
### F08 : the one curated journey (AC-002, FR-001/008)
**Files:** create `pmo-portal/e2e/document-preview-AC-002-private-pdf-viewer.spec.ts`; modify the preview step of `e2e/AC-DOC-020-upload-download-journey.spec.ts`.
Header: `// @e2e-isolation: self-isolated — unique doc title/code (Date.now()); PM uploads and previews own PDF; no seed coupling.` Reuse `document-file-upload.helpers.ts` (`createDocument`, `documentRow`, `openDocumentsTab`) and `fixtures/tiny-upload.pdf`.
`test('document-preview AC-002: a private project PDF opens inside PMO and closing returns to the same project', …)`: login as the project manager, open the project's Documents tab, upload the fixture (organisation has no M365 in the local seed, so the private flow runs), open Preview from the row, expect the dialog named by the file name, an `iframe[title="<file name>"]` whose `src` is a Storage signed URL on the local Supabase origin and **that URL answers `200 application/pdf`** (fetch it from the test with the page's request context), `page.url()` unchanged and no new page opened (`context.pages().length === 1`), Close (and Esc in a second pass), then the Documents tab, project header and the document row are still on screen. The goal oracle is "viewer in PMO, route intact", not an iframe-load event. Update the `AC-DOC-020` preview assertions to look for the dialog instead of a popup, steps only; its goal oracle (the previewed bytes are the uploaded image) stays.
**Verify:** `scripts/e2e-local.sh document-preview-AC-002` and `scripts/e2e-local.sh AC-DOC-020` (both under `scripts/with-db-lock.sh`, reset only if a migration/seed changed on the branch). Commit.

### F09 : visual regression
If the repo's visual-regression suite (`scripts/ci-e2e.sh` lane) snapshots the documents tab, review the diff screenshot before updating any baseline; update only when the diff is the intended Preview button. Do not run the full browser suite locally (CI's `integration` job runs it on the PR to `main`).

### F10 : branch handoff
Per branch: gate evidence in the handoff (commands run, output tail), `git log --format=%B origin/dev..HEAD | grep -qi co-authored` negative, push the branch only. No PR (the Director batches).

---

# Phase G : gates the plan requires beyond tests

### G01 : security review of the preview and upload endpoints (token-custody gate, issue #1474)
Dispatch `security-auditor` (Terra-class) on branches `feat/doc-preview-edge` and `feat/doc-preview-db` **before merge**, with the brief: OWASP + STRIDE on `preview_document` and `upload_record_file` and the migration. Specific checks, each answered with file:line evidence:
1. Authorization order in both handlers equals A06/A17 (parse, membership + entitlement, role, caller-RLS read, folder/library proof, quota, connection, Graph). Run the mutation harness (A21) and confirm every mutation is killed; read the survivors list (must be empty).
2. No path from the browser to a generic Graph request: `graph_proxy` remains GET-only and body-less; the new allowlists are exact-match; `graphRead.ts` exports no credential getter or generic request.
3. Token custody (ADR-0060): no access/refresh token or download URL in any response, log line, `error_events` row or audit detail; preview responses carry `Cache-Control: no-store`.
4. Preview URL handling: host allowlist, never stored (query cache, DB, analytics), iframe `sandbox`, `referrerpolicy`.
5. Tenancy: `org_id` is server-derived; a row from another org is the same 404 as a missing row; folder children are proven direct children of the referenced folder; upload target folder is inside the org default library.
6. Upload abuse: size/type enforced server-side from bytes, server-derived content type, file-name sanitiser, rename-on-conflict never replaces, per-user quota, 30 s deadline, no redirect following (`fetchMicrosoftJson`).
7. Migration: new columns are insert-only for clients (0349 column grants), the one-source check, the stamp trigger cannot be bypassed by an authenticated client, the amended `guard_project_m365_source` allows only Draft author/Admin upload-to-Microsoft swaps.
8. Public-repo hygiene of everything written (no secrets, tenant ids, hostnames).
Findings are fixed in the same branch or filed as issues the same day (private detail in `docs/private/`, never in a public issue).

### G02 : code-quality + spec review
`spec-reviewer` against `docs/specs/document-preview.spec.md` (every FR/NFR/AC), `code-quality-reviewer`. One review, one fix round, then the Director verifies.

### G03 : bounded provider proof (spec "Provider-internal Office rendering is not a deterministic local-test oracle")
Manual, non-sensitive, run by the Director/owner on the staging sample org after Q1 is answered (an agent never runs a live tenant grant). Fixtures: a one-page docx, xlsx, pptx and pdf with synthetic content uploaded to a **sample** library, and the same four as private Storage uploads on a staging project.
1. Graph path: from the viewer, preview each of the four SharePoint files; record (screenshot) whether the embed renders, and that `getUrl` host matches the allowlist (adjust `EMBED_HOST_SUFFIXES` if staging shows another Microsoft host). Check that the iframe works under the deployed `_headers` and the `sandbox` set; record whether any Office type returns only `postUrl` (feeds Q2).
2. Public Office viewer: open each private Office file; the signed URL must be reachable from the public internet (staging Storage), so the proof runs on staging, not local Docker. Record render vs. blank; the blank case must show the Download hint.
3. Upload: as a connected-org PM, upload one PDF to a project and one to a purchase receipt; confirm the file appears in the record's folder, the reference persists, Preview renders it via the Graph path, a second upload with the same name makes `name 1.ext`, and with the app grant removed the recovery state appears with nothing written.
4. Do **not** claim an iframe `load` event proves rendering: the evidence is the screenshot.
Results are written to the PR description (no tenant ids, hostnames, user names).

### G04 : the whole-batch gate
CI decides: PR to `dev` merges on green `verify`, `pgtap` and both unit shards; browser e2e runs on the release PR to `main` (owner rule 2026-10-30). Locally the final gate is section 6's list plus F06/F08. Production is not touched; any later promotion needs the owner's per-instance production yes, and the deploy order is DB (0408) → edge function (`m365-token-custody`) → FE.

### G05 : rollout order and flag
Deploy back to front: migration 0408, then the edge function, then the FE. The FE upload branch (phase E) is inert for an organisation with no default library, and preview of Microsoft files is inert without a personal connection (it shows the connect state), so no feature flag is needed. If the Director wants a kill switch for a staged rollout, the existing `m365_integration` entitlement already gates both custody actions server-side.

### G06 : follow-ups to file as issues (same day, not dismissed)
Sub-folder browsing/preview (Q6); `postUrl` form-post renderer (Q2 if the proof shows need); SharePoint routing for expense receipts and budget evidence uploads (needs an owning-folder decision); an upload-session path for files over 5 MiB (needs an ADR); preview of CAD/text types.

### G07 : roadmap
When the build ships, update the pinned Roadmap issue (#1571) in the same session.

---

## 7. Task and AC coverage summary

- **Task count:** Phase A 22 (A01-A22), B 8 (B01-B08), C 10 (C01-C10), D 8 (D01-D08), E 6 (E01-E06), F 10 (F01-F10), G 7 (G01-G07): **71 tasks**; each A-E behaviour task is a 2-5 minute red/green cycle with an exact verify command; F/G are checks and reviews.
- **AC coverage:** AC-001 → C07, D01-D08 · AC-002 → F08 · AC-003 → A01-A12 · AC-004 → A09, C05 · AC-005 → C01, C06, C07 · AC-006 → C04 · AC-007 → A13-A19, E01, E02, E05 · AC-008 → A18, A19, E03, E05 · AC-009 → E04 · AC-010 → B01-B08 · AC-011 → C08 · AC-012 → D02 · AC-013 → C09 · AC-014 → A06, A17, A20, A21.
- **FR coverage:** FR-001/002 C04-C10; FR-003 A03-A12; FR-004 A09, C05; FR-005 C01, C06; FR-006 A13-A19, E01-E05; FR-007 A18-A19, E03; FR-008 C07, E04; FR-009 C01, C06; FR-010 C05, C07; FR-011 C04; FR-012 D02; FR-013 C08; FR-014 A17, B04, C08, E04; FR-015 D04-D07.
- **No placeholders left:** the only open items are the six questions in section 0, each with a default.
