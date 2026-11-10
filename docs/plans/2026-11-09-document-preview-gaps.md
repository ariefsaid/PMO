# Document preview: remaining gaps for #1406

Issue: #1406 (preview files in the app, including SharePoint/OneDrive links). Spec:
`docs/specs/document-preview.spec.md`. Prior build: #1474 (plan `docs/plans/2026-10-31-document-preview.md`,
shipped to `dev` in PR #1587). No migration.

## Verdict

#1406 is **mostly met** by #1474. One real gap remains: project documents that are *attached as evidence on
other records* (billing claims, work-order acceptances, subcontract acceptances, T&M client sign-offs) are
shown as plain text or a raw id, with no way to open them. That breaks the issue's "anywhere a document is
linked" clause. Who it hurts: a finance user reviewing a billing claim before raising the invoice sees a
UUID under **Evidence** and has to leave for the Documents tab, find the document by guesswork, and preview
it there.

## What is already met (evidence on `dev`)

| #1406 ask | Shipped code |
| --- | --- |
| One side-panel viewer, mounted app-wide | `pmo-portal/App.tsx:773` (`DocumentViewerProvider`); panel `pmo-portal/src/components/documents/DocumentViewer.tsx` |
| Preview from the project Documents tab (row menu + file cell + quick view) | `pmo-portal/pages/project-detail/tabs/DocumentsTab.tsx:444-446`; `pmo-portal/pages/project-detail/tabs/useDocumentFiles.tsx:109-126,153`; `DocumentsTab.tsx:280` (`LinkedDocumentCell`) |
| Uploaded files (private Storage): PDF/image native, Office via the public viewer on a short-lived link | `pmo-portal/src/components/documents/targets/storage.ts`; `pmo-portal/src/components/documents/renderers.ts` |
| SharePoint/OneDrive links via Graph preview on the viewer's own connection | `pmo-portal/src/components/documents/targets/microsoft.ts`, `targets/reference.ts`; custody action `preview_document` (commit `9ebee7346`) |
| Purchase documents: Microsoft references, phase files, ledger SharePoint files | `pmo-portal/pages/procurement/ProcurementMicrosoftReferences.tsx:132`; `ProcurementFilesSubsection.tsx:64`; `LedgerFileCell.tsx:89` |
| Budget evidence links | `pmo-portal/src/components/m365/BudgetDocumentLinks.tsx:101` |
| Files inside a linked folder | `pmo-portal/src/components/m365/LinkedFolderFiles.tsx:52-61` |
| Expense receipts (claim page + approvals) | `pmo-portal/pages/expenses/ExpenseReceiptsCard.tsx:93`; `pmo-portal/pages/approvals/ExpenseClaimApprovalSection.tsx:41` |
| Connected-org uploads go to the record's SharePoint folder | commits `74f81e43e` (project), `ccfe5d3e8` (purchase) |
| Download / Open in source stay secondary | `DocumentViewer.tsx:134` (Open in source); storage target `download` |
| Proof that every entry point opens the same panel | `pmo-portal/src/components/documents/entryPoints.test.tsx` (AC-001) |

Not code gaps, tracked elsewhere and out of this plan:
- Staging provider proof with a real tenant (plan G03 of #1474; #1474 stays open for it).
- Sub-folders, form-post Office previews, CAD/plain text, uploads over 5 MiB (#1588).
- SharePoint destination for receipts and budget evidence uploads (#1589).
- A legacy plain-text purchase link opens in a new tab after URL validation
  (`ProcurementMicrosoftReferences.tsx:141-149`); the spec's source table allows "validated Open in source"
  for unresolved legacy links, so this stays.

## The gap

| Surface | Today |
| --- | --- |
| Billing claim detail, Evidence list | `pmo-portal/pages/project-detail/tabs/BillingTab.tsx:564` renders `evidence.document_id` (a raw id) |
| Work-order claim drawer, Evidence list | `pmo-portal/pages/project-detail/tabs/WorkOrdersTab.tsx:1355` same raw id |
| Work-order acceptance (BAST) | `pmo-portal/pages/project-detail/WorkOrderAcceptances.tsx:90-93` title as plain text |
| Subcontract acceptance | `pmo-portal/pages/procurement/SubcontractLinesSection.tsx:249-258` title as plain text |
| T&M claim detail, client sign-off | `pmo-portal/pages/project-detail/TimeAndMaterials.tsx:779` (`ClaimDetail`) never shows `claim.document_id` (`src/lib/db/timeAndMaterials.ts:163`) |

All five surfaces already hold the project's register rows (`useDocuments(projectId)`: `BillingTab.tsx:91`,
`WorkOrdersTab.tsx:221`, `TimeAndMaterials.tsx:76`, `SubcontractLinesSection.tsx:49`; `WorkOrderAcceptances`
receives `documents` as a prop, line 20). So the fix is pure FE: look the id up in rows already loaded and
open the existing viewer with the same target the Documents tab builds. No new query, RPC, migration, grant
or custody path. Read authorization is unchanged: the row is only present if RLS let the user read it, and
the target goes through the same document repository accessor / Graph `project_document` request.

## New acceptance criteria (append to the spec's AC table)

| AC | Given / When / Then | Owning layer | FR |
| --- | --- | --- | --- |
| AC-015 | Given a register row with a stored file or a valid Microsoft reference, when the shared project-document target helper builds a target, then it equals what the Documents tab opens (storage key `project-document:<id>` / `project_document` Graph request); given neither, it returns null. | Unit | FR-001/005 |
| AC-016 | Given a billing claim, work-order claim, BAST, subcontract acceptance or T&M sign-off that links a readable project document, when the user selects the document's name, then the common viewer opens for that document without leaving the record. | Unit (parameterized RTL, extends `entryPoints.test.tsx`) | FR-001/015 |
| AC-017 | Given a linked document id that is not in the user's readable register (archived, or not visible), when the evidence list renders, then it shows a plain "Document not available" label, never a raw id, and offers no Preview. | Unit | FR-013 |

## Tasks (TDD; each 2-5 min)

Paths are relative to `pmo-portal/`. Tests are written first; CI runs them.

### T1. Shared target helper (AC-015)
1. Red: create `src/components/documents/targets/projectRegister.test.ts`:
   - `it('AC-015 a stored file opens the project-document storage target')`: row `{ id: 'd1', title: 'Survey', file_path: 'org/p/d1/s.pdf', source: 'upload' }` → `projectRegisterTarget(row, getSignedUrl)?.key === 'project-document:d1'`.
   - `it('AC-015 a SharePoint reference opens the project_document Graph target')`: row with `source: 'onedrive'`, `ms_drive_id`, `ms_item_id`, `ms_web_url: 'https://tenant.sharepoint.com/sites/x/Plan.pdf'`, `ms_item_name`, `ms_item_kind: 'file'`, `file_path: null` → target is non-null and its name is the row title (reuse the fixture shape from `src/components/documents/targets/project.test.tsx`).
   - `it('AC-015 no file and no reference returns null')`.
   - `it('AC-015 an invalid Microsoft URL returns null')` (`source: 'onedrive'`, `ms_web_url: 'https://evil.example/x'`).
2. Green: create `src/components/documents/targets/projectRegister.ts` exporting
   `projectRegisterTarget(doc: ProjectDocumentRow, getSignedUrl: SignedUrlAccessor): DocumentViewTarget | null` by
   moving the body of `openPreview` out of `pages/project-detail/tabs/useDocumentFiles.tsx:109-126`
   (`projectReference` + `validMicrosoftBrowserUrl` → `referenceTarget`; else `file_path` → `storageTarget`).
3. Refactor `useDocumentFiles.tsx` `openPreview` to call it; keep the existing refusal toast when the row has a
   reference URL but the helper returns null. Existing `entryPoints.test.tsx` "project register row" case must
   stay unchanged.

### T2. `ProjectDocumentLink` component (AC-016, AC-017)
1. Red: create `src/components/documents/targets/ProjectDocumentLink.test.tsx` (wrap in `DocumentViewerContext`
   with a spy `open`, as `entryPoints.test.tsx` does):
   - `it('AC-016 selecting the document name opens the viewer for it')`: `documentId='d1'`, `documents=[row d1 'Survey']` → button named "Preview Survey"; click → `open` called once with key `project-document:d1`.
   - `it('AC-017 an unreadable id shows "Document not available" and no button')`: `documents=[]` → text "Document not available", no `button`, raw id not in the DOM.
   - `it('AC-017 a readable row with no file shows the title without Preview')`.
2. Green: create `src/components/documents/targets/ProjectDocumentLink.tsx`:
   props `{ documentId: string | null; documents: ProjectDocumentRow[]; prefix?: string }`. Finds the row; when
   `projectRegisterTarget` is non-null renders a `Button variant="ghost" size="sm"` labelled with the title,
   `aria-label` = `documentViewer:viewer.previewNamed`, `onClick` → `useViewerOnDemand().open(target, e.currentTarget)`;
   row without target → title text; no row → `documentViewer:viewer.unavailableDocument`.
   Signed URLs via `repositories.document.getSignedUrl` (same accessor as `useDocumentFiles.tsx:124`).
3. i18n: add `viewer.unavailableDocument` to `public/locales/en/documentViewer.json` ("Document not available")
   and `public/locales/id/documentViewer.json` ("Dokumen tidak tersedia"). Export the component from
   `src/components/documents/index.ts`.

### T3. Billing claim evidence (AC-016/017)
1. Red: in `pages/project-detail/tabs/__tests__/BillingTab.test.tsx` add
   `it('AC-016 claim evidence shows the document title and opens the viewer')` and
   `it('AC-017 claim evidence never renders the raw document id')` using the file's existing claim/document mocks.
   If the file mocks `@/src/components/documents` or `viewerContext`, extend that mock with `ProjectDocumentLink`.
2. Green: `BillingTab.tsx:564` replace `<span>{evidence.document_id}</span>` with
   `<ProjectDocumentLink documentId={evidence.document_id} documents={documents.data ?? []} />`.

### T4. Work-order claim drawer evidence
1. Red: `pages/project-detail/__tests__/WorkOrdersTab.billing.test.tsx`
   `it('AC-016 work-order claim evidence opens the viewer, not a raw id')`.
2. Green: `WorkOrdersTab.tsx:1355` same swap, `documents.data ?? []` from line 221.

### T5. Work-order acceptance (BAST)
1. Red: add `it('AC-016 the signed BAST title opens the viewer')` to the acceptances test (find it with
   `grep -rln "WorkOrderAcceptances" pages/project-detail/__tests__`; if none, create
   `pages/project-detail/__tests__/WorkOrderAcceptances.test.tsx`).
2. Green: `WorkOrderAcceptances.tsx:90-93` keep the "Signed BAST:" sentence via a new key
   `projectTabs:contractQuantities.workOrders.acceptances.documentLabel` ("Signed BAST:" / id "BAST bertanda tangan:")
   followed by `<ProjectDocumentLink documentId={a.document_id} documents={documents} />`; the no-document copy stays.
   Add the key to `public/locales/en/projectTabs.json` and `public/locales/id/projectTabs.json`.

### T6. Subcontract acceptance
1. Red: `pages/procurement/SubcontractLinesSection.test.tsx`
   `it('AC-016 the signed acceptance document opens the viewer')`.
2. Green: `SubcontractLinesSection.tsx:256-258` same pattern; new key `subcontract.acceptance.documentLabel`
   ("Signed document:" / "Dokumen bertanda tangan:") in `public/locales/{en,id}/procurement.json`.

### T7. T&M client sign-off document
1. Red: `pages/project-detail/TimeAndMaterials.test.tsx`
   `it('AC-016 the claim detail shows the signed sign-off document and opens the viewer')` (claim fixture with
   `document_id` set and a matching register row) and
   `it('AC-017 no sign-off document shows nothing extra')`.
2. Green: pass `documents={documents.data ?? []}` into `ClaimDetail` (`TimeAndMaterials.tsx:531`); render a
   `signoff.documentLabel` line ("Signed sign-off:" / "Sign-off bertanda tangan:") with `ProjectDocumentLink`
   only when `claim.document_id` is set. Keys in `public/locales/{en,id}/timeAndMaterials.json`.

### T8. Entry-point matrix + spec
1. Extend `src/components/documents/entryPoints.test.tsx` `surfaces` with
   `{ name: 'evidence link', fileName: 'Survey', ui: <ProjectDocumentLink documentId="doc-2" documents={[row]} />, control: /Preview Survey/ }`
   so AC-001's "same panel, route kept" assertion covers it.
2. `docs/specs/document-preview.spec.md`: append AC-015–017 to the AC table and add "evidence links on billing
   claims, acceptances and T&M sign-offs" to the Scope paragraph.

## Gates (per worker rules for this lane)
`npm run check:guards`; `npx eslint --max-warnings=0` on every touched file. Tests written, run by CI
(affected unit on the PR to `dev`). Before editing, grep `vi.mock(` for `@/src/components/documents`,
`viewerContext` and `@/src/lib/repositories` in each touched test file and update those mocks in the same branch.
No DB, RLS, edge-function or grant change, so no pgTAP and no security-sensitive surface beyond reusing the
existing read accessors.

## Rendered check
`scripts/ux-proof.sh` on the project Billing, Work orders, T&M tabs and a procurement detail with a
subcontract acceptance (seed rows with linked evidence), in CI or by the Director; one review, one fix.
