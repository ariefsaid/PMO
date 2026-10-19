# User-facing project details — #1044

Status: proposed; owner decisions below use explicitly marked recommended defaults, not assumed sign-off. Inventory baseline: `cbacb2a0` on `dev`, inspected 2026-10-19. Companion: [implementation plan](../plans/2026-10-19-project-detail-user-facing.md).

## Job story and boundary

When I open a project to decide what needs doing, I want business information and actions appropriate to my role, so I do not have to understand integration configuration to manage delivery. Finance/Admin can investigate setup without making every project viewer investigate it.

This is a presentation change, not a new accounting/setup workflow. Preserve amounts, scopes, fiscal years, currencies, version identities, permissions, explicit confirmations and recovery controls. Unknown money must never become zero. Do not conceal a real operational failure as an unconfigured panel.

### Deciding artifacts and prior art

- Issue #1044 is the owner problem statement; #1043 is related setup work, not authorization to redesign setup here.
- `PRODUCT.md`, `DESIGN.md`, `docs/product-expectations.md`: calm default, business vocabulary, production-grade accessibility and financial honesty.
- `docs/decisions.md`, DD-MONEY-1–4; `docs/specs/shared-project-money-position.spec.md`: shared Actual/coverage model, active connection as the accounting-employment signal, and existing unknown/currency safeguards. #1045 is closed; do not reintroduce or re-solve its zero/margin problem here.
- ADR-0010: presentation is owned by unit/RTL tests, not additional database or browser journeys. ADR-0016/0017/0019: reuse permission and repository seams; no policy or write-path changes.
- `docs/qa-portfolio.md`: deterministic gates, rendered Discover, graduate every finding.
- Prior-art searches completed for `1044`, `GL`, `project detail`, `unmapped`, `1045`, and `setup`; shipped code, not the issue's older screenshot vocabulary, decides the inventory.

## Inventory before design

All paths in this table are relative to `pmo-portal/`; line numbers refer to the baseline above. Inspected the project route shell, all seven tab modules, project-local forms/charts, and their rendered integration/financial children. Identifiers in source comments/types are not user-facing inventory findings. This is a source audit, not a claimed rendered Discover pass.

Disposition: **A–E** are bounded implementation slices in the plan; **retain** means intentional business meaning; **follow-up** means separately designed work, not an omitted implementation requirement.

| Surface / deciding location | Current user-visible detail and effect | Disposition |
|---|---|---|
| `pages/project-detail/ProjectFinancesSection.tsx:96–114` | Missing outstanding uses “ERP outstanding missing”; financial-data reasons recur in invoice buckets. | **A:** plain financial wording; preserve each metric's unavailable/incomplete meaning. |
| `pages/project-detail/ProjectFinancesSection.tsx:132–151` | Coverage count, missing update time, and a spending-setup handoff are separate lines. Handoff names Finance and Admin. | **A:** one default setup prompt for confirmed unmapped spending; Finance hands off to Admin under current access. Missing reading alone is not proof of mapping work. |
| `pages/project-detail/ProjectFinancesSection.tsx:152–171` | Existing category disclosure can contain a full table of unavailable rows. | **A:** useful category readings remain available; configuration-only rows move to Finance/Admin disclosure. No empty table for delivery viewers. |
| `pages/project-detail/ProjectFinancesSection.tsx:174–176` | Invoice scope note describes ERP attribution. | **A:** “Only invoices linked to this project are included.” Preserve scope, not implementation terminology. |
| `pages/project-detail/tabs/OverviewTab.tsx:77–88,392–460` | Shared spending coverage; “Budget snapshot”, budget/actual/variance and category figures. | **A:** title “Budget summary”; retain useful coverage and money. No new budget model. |
| `pages/project-detail/ProjectDetailHeader.tsx:140–240` | Role-aware financial summary consumes shared money state. | **Retain:** business figures and known/unknown protections already shipped; regression proof, no competing derivation. |
| `pages/project-detail/ProjectDetailRail.tsx:144`; `pages/project-detail/ProjectDetail.tsx:310` | Accounting project identity is exposed through a shared child in project layouts. | **B:** project-local Finance/Admin disclosure; no dormant heading for PM/Engineer or duplicate mounts on one responsive layout. |
| `src/components/integrations/ProjectMatchReview.tsx:262–344` | Loading/error vocabulary says ERP; project heading and external target show accounting project codes by default. | **B:** wrapper keeps this technical review off the default project canvas; Administration queue remains unchanged. |
| `src/components/integrations/ProjectMatchReview.tsx:345–377,428–485` | Read-only handoffs, candidate IDs, client code, suggested matches and ambiguity details. | **B / retain:** within Finance/Admin disclosure, preserve exact target and confirmation semantics. Never replace candidate identity with ambiguous friendly text. |
| `pages/project-detail/tabs/TasksTab.tsx:25,38,175–188` and `src/components/projects/ProjectIntegrationsCard.tsx:125–183` | Task write status; linked list name/ID fallback; initial-transfer-not-confirmed and retry controls. | **C:** hide only confirmed unused integration chrome; preserve actual linked work, uncertain reads, list identity for reconciliation and actionable recovery. |
| `src/components/projects/ProjectIntegrationsCard.tsx:188–244` | Disconnected service and organization connection setup occupy the Tasks page. | **C:** PM/Engineer/Finance/Executive see no unused panel; Admin gets one collapsed “Task connection” disclosure with the existing setup destination/action. |
| `src/components/tasks/TaskPushBadge.tsx:33–88` | “Pushing… / Pushed / Push failed”, including accessible labels and tooltips; reused on project tasks and procurement records. | **E:** opt-in business vocabulary on these two callers only; retain state machine and classified failure context. Other callers retain existing contract. |
| `pages/project-detail/tabs/BudgetTab.tsx:35–63` | Forecast already follows active accounting connection; inactive connection gets an explanatory line. | **D:** retain active-binding gate; remove non-actionable disconnected explanation for delivery roles; Admin may inspect one collapsed connection hint. PMO budget stays mounted. |
| `pages/BudgetProjection.tsx:83–94,506–515,680–711` | Per-category missing-reading/mapping sentences repeat; null derived cells depend on the same missing input. | **D:** one visible grouped spending-availability explanation; localized business reasons in cells/AT; Finance/Admin can inspect setup detail. Preserve distinct absence causes. |
| `pages/BudgetProjection.tsx:596–605` | Empty forecast tells every reader to activate and push a version. | **D:** one neutral empty line and only permitted actions; no empty forecast table. Do not infer unconfigured from a pending/error read. |
| `pages/BudgetProjection.tsx:585–594,821–945` | Failed/held budget transmission, year-specific retry/release, category setup remedy. | **D:** plain-language copy and capability-appropriate setup affordance; keep each year's failure and actionable controls visible, not inside a quiet disclosure. |
| `pages/BudgetProjection.tsx:740–755,783–817` | Existing sources/status disclosure contains technical budget document identity and transmission detail. | **D:** Finance/Admin technical disclosure; delivery viewers keep business facts needed to understand the forecast and any actionable failure. |
| `pages/ProjectBudget.tsx:47–64,521–527,914–1059` | Revision shorthand, version name/status, sole-operator qualifier and activation/version controls. | **D:** “Version {{number}}”; retain Draft/Active/Archived, approval qualifier, user-authored names and operational controls. No invented import provenance. |
| `pages/project-detail/ProjectProfitLossSection.tsx:33–42,117–125,162–168` | Capture-window context and honest statement-unavailable state. | **Follow-up:** statement provenance/availability presentation needs its own statement-view contract; preserve available statements, dates and current period controls here. |
| `pages/project-detail/tabs/ProcurementTab.tsx:152–157` | “ERP-native purchases stay in the ERP” is implementation vocabulary explaining list scope. | **E:** “Only purchase requests created in PMO are included.” Do not suggest this is all project spending. |
| `pages/project-detail/tabs/WorkOrdersTab.tsx:291–293` | Tax basis and DPP fraction accompany business values. | **Retain:** financially meaningful basis, not integration error noise; shared tax explanation redesign is a follow-up. |
| `pages/project-detail/tabs/BillingTab.tsx:172–249` | Item codes, billed quantities, invoice number/status and evidence actions. | **Retain:** business document/item identities and workflow statuses, not interchangeable with opaque integration identity. |
| `pages/project-detail/ProjectDrawdown.tsx:95–132` | Issued/draft commitment and ceiling distinctions. | **Retain:** genuine commercial commitments, not integration configuration. |
| `pages/SalesInvoices.tsx:680–695,808–816,959–966` | Historical pre-connection badge, opening-balance carryover and register data-source subtitle. | **E:** business-language badge/subtitle; preserve historical/frozen and opening-balance meaning, amount and date. |
| `pages/SalesInvoices.tsx:1201–1211` | Cancellation explains numeric document status transition. | **E:** remove protocol transition from confirmation copy; preserve cancellation consequences and existing gates. |
| `pages/SalesInvoices.tsx:1473,1533–1539,1675` | Sending progress, accounting item picker and delayed tax/final totals in draft form. | **E** for progress/item label only; **retain** honest delayed totals; invoice-form redesign is follow-up. |
| `pages/procurement/ProcurementDecisionZone.tsx:368–372` | Record creation uses the generic technical task-write badge. | **E:** opt-in record vocabulary; no mutation/approval/retry changes. |
| `pages/procurement/ProcurementLedger.tsx:83,133` | “System #” identifies documents. | **E:** “Document number”; preserve actual record identifiers and links. |
| `pages/procurement/RecordCaptureForm.tsx:189–207` and `pages/procurement/LineItemsSection.tsx:108–109` | Canonical purchase-document kinds and current accounting item selection. | **Retain:** business choices are needed to capture a valid purchase. No record taxonomy or tax-entry redesign. |

Other audited project modules: `BoqItemFormModal`, `ClaimEvidenceModal`, `InvoiceWorkOrderModal`, `MilestoneFormModal`, `MilestoneStrip`, `PipelineLens`, `ProgressAssessmentModal`, `ProgressClaimModal`, `ProjectBillingStart`, `ProjectGantt`, `ProjectSCurve`, `WorkOrderFormModal`, `WorkOrderValueModal`, and `tabs/DocumentsTab`. Within those rendered modules the audited strings are business identities, dates, permissions and workflow instructions, not the repeated integration-configuration pattern. This statement is bounded to these modules and the table's children, not the entire application.

**Already changed since the issue report:** “Mapped GL costs” is now “Recorded spending”; category rows already sit inside a disclosure; quiet forecast provenance also already has a disclosure. The quoted “Draft — not active · Imported · v1” is not emitted by the current finance-section component. Do not manufacture a new import model or strip words from stored names to reproduce an obsolete screenshot.

## Design defaults and role policy

**D1 — recommended default:** “Finance detail” means real Finance or Admin, not an impersonated view. Executive gets the delivery-facing presentation unless separately authorized by the owner. Existing `usePermission()` remains the action predicate; a role display decision grants no new capability.

**D2 — recommended default:** Finance may investigate spending detail, but current accounting setup is Admin-managed. Finance sees “Ask an administrator to finish spending setup.” Admin sees “Finish spending setup” to `/administration/accounting#budget-account-map` only when `may('manage', 'orgAccounting')`. Never send Finance to an inaccessible screen or broaden permissions to make the link work. `pages/Administration.tsx:284–369` and `src/auth/policy.ts:515–549` decide this contract.

**D3 — recommended default:** one default-canvas integration setup prompt per selected project tab, not one per category/metric. The Overview prompt concerns confirmed category setup. Project-link review stays collapsed, so it does not add a second unsolicited prompt. Native disclosure contents may explain their own distinct setup task after deliberate opening. Retry notices and honest amount labels are not setup prompts.

**D4 — recommended default:** keep useful known category values available to all entitled readers. Only configuration/protocol detail is Finance/Admin-only. A partial reading remains explicitly partial. If there are no known category values, omit the empty category table for delivery readers; never relabel it “no spending”.

**D5 — recommended default:** use existing native `details`/`summary`, tokens and components. Closed initially, keyboard operable, local to the current project; no persistence, global banner framework, new dependency or design system. Preserve document/client/item numbers, business version names and financial basis.

### State rules

| State | Default canvas | Finance/Admin investigation |
|---|---|---|
| Confirmed unused/disconnected optional integration | Hide panel for non-Admin; keep native project work | Admin collapsed connection action; no automatic connection attempt |
| Loading or failed connection/read | Loading/retry with neutral business wording where a panel is otherwise relevant | Same uncertainty; never diagnose setup from a failed request |
| Spending categories known to need setup | Unknown/partial amount and one availability explanation; no repeated row errors | One default setup prompt; collapsed missing-category detail |
| Mapped categories, no reading | “Spending hasn't been updated yet”; unknown remains unknown | No category-setup CTA inferred from absence of a reading |
| Partial known readings | Keep known values, scope and partial qualifier | Missing-category detail on demand |
| Genuine known zero | Formatted zero with the original scope/currency | Same zero, never confused with absence |
| Live actionable failure / held work | Preserve consequence, relevant year and existing permitted recovery actions | Technical identity/provenance may be disclosed separately |

## EARS requirements

- **FR-001:** The project page shall present business vocabulary by default and preserve financially meaningful scope, status, dates, identities and qualifiers.
- **FR-002:** When an existing successful spending reading identifies categories needing setup, the Overview shall show at most one default setup prompt to real Finance/Admin and none to delivery-facing roles; its direct destination shall be rendered only for a role permitted to manage accounting setup.
- **FR-003:** While a spending reading is partial or unavailable, the page shall retain unknown/partial semantics, show known category readings on demand, and keep configuration-only rows in a closed Finance/Admin disclosure.
- **FR-004:** When a request is pending, fails, or lacks a ledger reading without confirmed category gaps, the page shall describe that state without inferring missing setup and shall preserve existing retry actions.
- **FR-005:** Where accounting project review is available, the project page shall place it in a closed Finance/Admin disclosure; opening/reviewing shall preserve explicit selection, exact identity and confirmation, without automatic writes. The Administration queue shall retain its existing presentation and behavior.
- **FR-006:** When optional task integration is successfully confirmed unused and has no saved project link, the Tasks tab shall hide its unused panel for non-Admin readers and offer Admin one collapsed connection action. While a saved link, active connection, pending read or failed read exists, the page shall preserve relevant status and permitted linking/recovery actions.
- **FR-007:** While the forecast has incomplete spending, it shall group repeated spending-availability explanation once visibly, retain plain accessible cell reasons, and retain every valid budget/cost-to-finish figure and edit control. It shall not collapse partially useful financial data.
- **FR-008:** When forecast/setup status is displayed, the page shall retain separate fiscal-year outcomes and permitted retry/release actions; technical source/document details shall be disclosed to Finance/Admin, and setup destinations shall follow the existing capability predicate.
- **FR-009:** The budget page shall use “Version {{number}}” rather than revision shorthand, retain Draft/Active/Archived and activation qualifiers, and shall not infer or rewrite stored name provenance.
- **FR-010:** Where the audited invoice/procurement pages expose the same small copy pattern, the UI shall use the agreed vocabulary below without changing document lifecycle, historical/frozen behavior, amounts or confirmations.
- **FR-011:** While a project/task or procurement write is in progress, complete or failed, its opted-in status badge shall say “Sending…”, “Sent” or “Couldn't send” and retain classified failure context. “Sent” shall not claim client delivery, approval, initial task transfer or payment.
- **NFR-001:** The change shall leave money derivation, decimal handling, completeness, currency compatibility, invoice settlement/cash distinction and genuine-zero semantics unchanged.
- **NFR-002:** Changed labels, descriptions, tooltips, accessible names and disclosures shall have English and Indonesian catalogue entries, visible keyboard focus and no color-only state or duplicate responsive controls.
- **NFR-003:** Presentation shall reuse existing query results and permission/repository seams, add no polling or per-row requests, and keep external candidate fetching demand-driven. No new schema, RPC, endpoint, RLS policy or tenant identifier threading is permitted.

### Agreed small-copy replacements (recommended defaults)

| Context | English | Indonesian |
|---|---|---|
| Missing invoice balance | Invoice balance is not available yet | Saldo faktur belum tersedia |
| Spending details summary | Spending setup details | Detail penyiapan pengeluaran |
| Category setup explanation | Spending is not available for every category yet. | Pengeluaran belum tersedia untuk semua kategori. |
| Admin setup action | Finish spending setup | Selesaikan penyiapan pengeluaran |
| Finance handoff | Ask an administrator to finish spending setup. | Minta administrator menyelesaikan penyiapan pengeluaran. |
| No reading | Spending hasn't been updated yet. | Pengeluaran belum diperbarui. |
| Project-link disclosure | Accounting project details | Detail proyek akuntansi |
| Task connection disclosure | Task connection | Koneksi tugas |
| Budget technical disclosure | Accounting details | Detail akuntansi |
| Budget revision | Version {{number}} | Versi {{number}} |
| Historical invoice badge | Historical invoice | Faktur historis |
| Historical invoice explanation | Recorded before the accounting connection was enabled; kept as history. | Dicatat sebelum koneksi akuntansi diaktifkan; disimpan sebagai riwayat. |
| Carryover note | Included in the opening balance: {{amount}} on {{date}} | Termasuk dalam saldo awal: {{amount}} pada {{date}} |
| Invoice register subtitle | Customer invoices and their outstanding balances. | Faktur pelanggan dan saldo terutangnya. |
| Cancel consequence | This cancels the invoice. It will be marked Cancelled and can no longer be submitted. Its outstanding amount is released. | Tindakan ini membatalkan faktur. Faktur akan ditandai Dibatalkan dan tidak dapat diajukan lagi. Saldo terutangnya dilepaskan. |
| Invoice item field | Item | Item |
| Invoice send progress | Sending invoice… | Mengirim faktur… |
| Procurement document identity | Document number | Nomor dokumen |
| Project purchase-list scope | Only purchase requests created in PMO are included. | Hanya permintaan pembelian yang dibuat di PMO yang disertakan. |
| Shared opted-in write states | Sending… / Sent / Couldn't send | Mengirim… / Terkirim / Tidak dapat mengirim |

## Acceptance criteria and owning layer

IDs are issue-qualified (`AC-1044-###`) to avoid collisions with other specs. All new canonical proofs are **unit/RTL**: the changed contracts concern rendering, interactions and permission-aware destinations using existing data. No new database behavior or cross-stack write flow is introduced. Existing database/e2e ownership is not transferred here.

- **AC-1044-001 — setup audience and destination.** Given the same successful reading with unmapped categories and each real role (Admin, Finance, PM, Engineer, Executive), when Overview renders, then Admin gets exactly one accounting-setup link to the canonical anchored route, Finance gets exactly one Admin handoff without that link, and the other roles get neither setup instruction nor inaccessible link. View-as shall not create capabilities. **Owner:** `pages/project-detail/ProjectFinancesSection.test.tsx`.
- **AC-1044-002 — useful detail without repeated setup rows.** Given no known categories, or a partial reading containing a known zero, a positive value and an unavailable category, when each reader opens available disclosures, then no empty category table is offered to delivery readers, known values including zero remain available when present, partial scope stays explicit, and only Finance/Admin can inspect missing-category setup detail. **Owner:** same finance-section test file.
- **AC-1044-003 — honest uncertainty and financial invariants.** Given pending/error/no-reading, restricted, mixed-currency, missing-outstanding, receipt-cash and genuine-zero fixtures, when the section and existing shared summaries render, then no unknown value or derived margin becomes zero, retry still works, cash is not equated with settlement, and no category-setup diagnosis is inferred from absent/failed reading alone. **Owner:** same finance-section test file; existing shared-money tests remain regression proofs.
- **AC-1044-004 — project-link disclosure.** Given connected, disconnected, linked, unlinked and failed-read project fixtures and each real role, when the project mounts, then PM/Engineer/Executive see no technical project-link panel, Finance/Admin see a closed disclosure when relevant, and opening it reveals current identity without creating/linking anything. **Owner:** `pages/project-detail/__tests__/ProjectErpLink.test.tsx`.
- **AC-1044-005 — explicit match review survives.** Given the Admin disclosure opened and an existing match candidate selected, when review is confirmed, then only the chosen link is written with the original identity; cancelling writes nothing, and the Administration queue's existing exact/ambiguous-match behavior is unchanged. **Owner:** `src/components/integrations/ProjectMatchReview.test.tsx`.
- **AC-1044-006 — unused task panel.** Given successful connection and project-binding reads confirming no active task connection and no saved project link, when Tasks renders, then non-Admin readers see no unused connection panel, while Admin can open one closed connection disclosure; PMO tasks remain present. **Owner:** `src/components/projects/__tests__/ProjectIntegrationsCard.test.tsx`.
- **AC-1044-007 — do not conceal task work or uncertainty.** Given an active connection, a saved project link, a pending read, a failed read or failed list refresh, when Tasks renders, then relevant list identity, pending initial-transfer truth, explicit link choices, retries and permitted actions remain available; no extra setup/fetch/write runs merely because a disclosure opens. **Owner:** same integrations-card test file.
- **AC-1044-008 — forecast unavailable grouping.** Given all-missing and partially known category readings with budget and cost-to-finish data, when Forecast renders, then one visible grouped spending-availability explanation replaces repeated configuration sentences, every unknown/derived dependent cell remains unavailable with an accessible business reason, and valid figures plus cost-to-finish editing remain intact. **Owner:** `pages/BudgetProjection.test.tsx`.
- **AC-1044-009 — budget outcomes stay actionable.** Given mixed fiscal-year outcomes, retryable failure, held work and a category-setup remedy, when each role renders the forecast, then year-specific consequences and existing permitted recovery controls stay visible; only capable readers get a direct setup link and Finance/Admin alone get technical document/source detail. **Owner:** same projection test file.
- **AC-1044-010 — optional forecast.** Given active, inactive, pending and failed accounting-connection readings, when Budget renders for each role, then PMO budget remains mounted, the existing active-binding gate is preserved, delivery readers see no dormant integration panel or setup instruction, and only Admin can inspect the confirmed-inactive connection hint. **Owner:** `pages/project-detail/tabs/BudgetTab.test.tsx`.
- **AC-1044-011 — business version identity.** Given Draft, Active and Archived versions, including a stored name containing import/revision wording and a sole-operator activation qualifier, when Budget renders, then revision is “Version N”, the name/status/qualifier and original permitted controls remain, and no name is heuristically rewritten. **Owner:** `pages/ProjectBudget.test.tsx`.
- **AC-1044-012 — invoice vocabulary without lifecycle change.** Given a historical invoice, an accounting-connected invoice and a permitted cancellation action, when the invoice views/dialog render, then the agreed business copy is used, historical/carryover amount/date and frozen behavior remain, cancellation keeps its consequences and confirmation, and numeric protocol transition text is absent. **Owner:** `pages/__tests__/SalesInvoices.vocabulary.test.tsx`.
- **AC-1044-013 — record progress and identity.** Given each opted-in badge state and a procurement record, when rendered, then business progress is distinct in visible and accessible copy, idle stays absent, classified failure context is retained, and the ledger labels the unchanged identity “Document number”. Non-opted-in badge callers retain their existing contract. **Owner:** new `pages/procurement/__tests__/ProjectInternalsPresentation.test.tsx`, rendering the real badge and ledger with their existing hook seams.
- **AC-1044-014 — localized, accessible presentation.** Given English and Indonesian catalogues, Finance/Admin and delivery-facing fixtures, when the changed project surfaces are keyboard-operated and checked with axe, then disclosures are closed initially, focusable, labeled and usable, labels do not leak raw keys, duplicate layout controls are absent, and no new per-row or duplicate financial request is made. **Owner:** new `pages/project-detail/__tests__/ProjectUserFacingDetails.test.tsx`; component-owned AC tests above continue to cover amounts/actions. This is a composed frontend fixture, not a live-service e2e.

- **AC-1044-015 — empty forecast is not setup diagnosis.** Given successful empty projection results with or without a supplied fiscal year, and separate pending/error fixtures, when Forecast renders, then success shows one neutral availability line rather than an empty grid or activation/push instruction, pending/error remain distinct with existing retry behavior, and genuine blocked outcomes stay visible. **Owner:** `pages/BudgetProjection.test.tsx`.

## Out of scope / follow-ups

1. Statement provenance and optional statement-panel policy: preserve statement availability, capture dates and period semantics; coordinate with the statement lane before redesign.
2. Setup workflow/permission redesign, including making Finance a configuration editor; separate owner decision. No “fix” by giving a user more authority.
3. Invoice/procurement form or document-taxonomy redesign, shared tax-basis disclosure changes, and a global status/error vocabulary migration beyond the two opted-in badge callers.
4. Larger forecast hierarchy/phasing redesign: preserve selected-year arithmetic, per-year recovery, editable cost-to-finish and valid partial data. This issue only groups repeated configuration explanation and adjusts disclosure/copy.
5. Stored budget-name migration or inferred “Imported” provenance. No schema/data migration is justified by the current rendered code.

## Owner open questions (non-blocking defaults)

1. Should Finance eventually edit accounting setup? **Default D2:** no permission change; explicit Admin handoff now.
2. Should Executive inspect technical provenance? **Default D1:** delivery-facing presentation; existing business financial access unchanged.
3. Hide or collapse unused services? **Default D3/D5:** hide for non-Admin, one closed Admin disclosure; never hide real failures or useful partial data.
4. Keep version names even when they contain “Imported”? **Default D5:** yes; expand “vN” to “Version N” without altering business data.
5. Broaden statement/setup/form work into this issue? **Default:** no; retain the separately listed follow-ups.

## Risks / acceptance evidence

- A calm screen can accidentally become falsely reassuring: test null, partial, restricted, mixed currency, zero, failed refresh and stale data explicitly.
- Closing a panel must not remove actionable delivery work or imply initial task transfer completed. Preserve current matching/write/recovery tests.
- Shared components and translations affect other callers; use the project wrapper and opt-in badge prop to limit blast radius, run changed-importer tests and rebase locale edits immediately before each slice PR.
- Source audit is not visual acceptance. Required at build time: role-rich rendered Discover at mobile/desktop, both themes/locales where affected, regression gates, and graduation of every finding. No build, runtime pass or owner sketch approval is claimed by these planning documents.
