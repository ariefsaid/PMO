# Area D — Finance, workforce & Administration UX Discover

2026-10-10 · Director-level rendered discovery · Existing local app, browser session `disc-D` only.

## Five-line verdict

1. **Fix-then-ship:** the core financial and workforce workflows function, but cross-module handoffs still make operators reconstruct context.
2. Billing, second-person invoice approval, cancellation/reissue, withholding receipts, claim approval, timesheet approval and advance cash returns were exercised successfully.
3. The highest-impact defect is the allegedly unified approval inbox: expenses sit outside its All count and preview/decision model.
4. Invitation completion was not achieved; the persistent error preserves inputs but gives administrators technical jargon instead of a usable recovery path.
5. Preserve the calm zinc/Inter design identity; prioritize task continuity, evidence preview, mobile action placement and complete bilingual copy over cosmetic redesign.

## Method, evidence and limits

**Single-context by owner instruction; no subagents.** App source was read only to map rendered observations and check interpretations. No app edits, commits, server starts/stops, integration disconnects, seeded-record deletions or role changes were made. Only this review document was written in the repository. Other reviewers' files were left untouched. Browser session `disc-D` was closed at the end.

**Evidence root (`SHOTS`):** `/private/tmp/claude-502/-Users-ariefsaid-Coding-PMO/abd5a194-c2a4-469e-b763-f2a75f07ec08/scratchpad/disc-d/`.

All screenshot references below are relative to `SHOTS`. These are **local-only artifacts, not public attachments**: screenshots and the downloaded workbook contain rendered record/account data. Do not commit or publish them without redaction. The report deliberately uses roles, generic placeholders and route templates rather than account identities.

Reviewed at **1440×900** and **390×844**, in light/dark and English/Bahasa Indonesia. Early unsuffixed captures include English; the later unsuffixed Finance light sweep is Indonesian. Explicit `-en`/`-id` captures disambiguate where available. Filename viewport abbreviations mean width; heights are as above. Screenshots show the actual before-state; there are no fabricated after-screenshots because fixes were not implemented.

The five reporting lenses are **L1 Job/intent** (JTBD outcome and adjacent next action), **L2 Interaction/task effort** (flow, conventions and cognitive load), **L3 IA/navigation** (canonical homes and context), **L4 Visual/accessibility/responsive** (DESIGN.md identity, hierarchy and usable controls), and **L5 Copy/learning/localization** (recognition, errors and en/id consistency). They cover the charter's Visual, IxD, IA and Intent battery. A lens number denotes the basis of the finding, not a claim that every lens failed.

**Oracles:** rendered UI and actual outcomes first; `DESIGN.md` typography/control/state rules; `docs/jtbd.md` §2 Workforce, Admin/Reporting and §3 record verbs/preview; `docs/product-expectations.md`. Finance-specific job stories below extend the Finance role's stated money-control job; they are review hypotheses, not newly signed product requirements. `scripts/prior-art.sh 'expense approval'` was checked; findings here are task-specific observations, not an assertion that no earlier work exists.

### Coverage and actual outcomes

| Surface / primary role | Executed or inspected | Evidence / boundary |
|---|---|---|
| Sales invoices / Finance | Empty directory → general draft form → real VAT failure; then successful work-order draft, second-person approval, populated/paid/cancelled rows | `invoice-form-1440-light.png`, `invoice-error-1440-light-id.png`, `sales-invoices-1440-light-en.png` |
| Work-order invoicing / Finance | New project and work order; issued WO; invoice defaulted remaining amount and description; item code entered; draft created | `invoice-work-order-1440-light-id.png`, `work-order-drafted-1440-light-id.png` |
| Approval / Finance + Admin | Draft author could not approve their own invoice; other persona previewed and approved; number issued | `invoice-detail-1440-light-id.png`, `invoice-approved-1440-light-id.png` |
| Cancellation/reissue / Admin + Finance | Cancelled the review-created unpaid invoice; WO remaining amount restored; recreated at a lower amount; second persona approved | `invoice-cancelled-1440-light-id.png`; original net 1,000 replaced by net 900, gross 999 |
| e-Faktur / Finance | Recorded synthetic reference and date on the review-created draft; saved successfully | `e-faktur-form-1440-light-id.png`, `invoice-approved-1440-light-id.png` |
| Receipts / Finance | Invoice selection prefilled paid/cash amounts; entered withholding 18, cash 981 and a synthetic slip reference; recorded applied amount 999; invoice became Paid | `payment-withholding-1440-light.png`, `incoming-payments-390-light.png` |
| Revenue / Finance + Executive | Empty/zero then populated net revenue 900, open AR zero, one non-cancelled invoice; project row opened the real project | `revenue-by-project-1440-light.png`, `revenue-executive-1440-dark.png`, `revenue-detail-1440-dark.png` |
| Management pack / Finance + Executive | Reviewed period, totals, project/month tables and exports; downloaded XLSX as Finance | `reports-1440-light-en.png`, `reports-390-dark-id.png`, `reports-executive-1440-dark.png`; workbook ZIP integrity checked, one worksheet present. Full spreadsheet arithmetic not certified |
| Claims / Finance + PM | Created claim, added dated travel line, uploaded a test image, submitted, approved with a second persona | `expense-line-1440-light.png`, `expense-draft-1440-light.png`, `expense-approval-1440-dark.png`; claim payment not executed |
| Advances/returns / Finance + PM + Admin | Requested 100, submitted, second persona approved; Admin marked paid with reference, recorded cash return 20; outstanding became 80 | `advance-submitted-1440-light.png`, `advance-return-1440-light-id.png`; linked-claim settlement not executed |
| Timesheets / Engineer + PM | Preserved seeded current-week entries; entered 8 hours Mon–Fri in a clean following week, submitted 40, PM approved, Engineer saw Approved | `timesheet-submitted-1440-light.png`, `timesheet-approved-1440-dark-id.png`, `timesheet-approved-390-dark-id.png` |
| Timesheet ERP push / Engineer + Admin | Inspected approved own week, approval recovery area and organization integration readiness. No push/retry action was offered for the created week | ERP connection displayed connected, setup read failed again after Retry, and no externally-owned domains were configured. Did not alter shared organization configuration to force this path. **Push completion and held/failed/success states remain unproven** |
| Users/invitations/roles / Admin | Directory, invitation and role affordances inspected; attempted invitation twice; retained fields but both attempts failed | `invite-form-1440-dark.png`, `invite-error-1440-dark.png`; no successful invitation or acceptance claim; existing users' roles were not changed |
| Accounting/integrations/project setup/credits / Admin | All five organization destinations inspected in both themes and sizes, en/id; integration setup Retry exercised | `administration-{users,accounting,integrations,projects,credits}-1440-dark.png`, matching `390-dark.png`, `390-dark-id.png`, `390-light-id.png`, `1440-light-id.png`; settings not persisted, credit grants not attempted |

**State/a11y boundaries:** real empty, populated, draft/submitted/approved/paid/cancelled and error states were encountered. Loading was seen during navigation; no exhaustive throttled-state matrix or injected-error battery was run. No production service/OAuth flow, operator-only credit grant, receipt reversal, invoice PDF or full WCAG/axe certification is implied. Native-date automation needed an event-setting workaround; that is not recorded as a product defect. At the final 390px invoice check, document width equalled viewport width; contained scrolling is not alleged to be page overflow.

## Top 10 fixes — ranked by user impact

| Rank | ID | Fix / who benefits | Severity | Effort |
|---|---|---|---|---|
| 1 | UXD-D-001 | Include claims/advances in the same counted approval queue, preview and decision pattern / PM, Finance | Important | M |
| 2 | UXD-D-002 | Make late invoice VAT failure fully localized, field-linked and recoverable / Finance | Important | S–M |
| 3 | UXD-D-003 | Replace failed-invitation transport prose with accurate outcome and recovery / Admin | Important | S–M |
| 4 | UXD-D-004 | Preview claim evidence without downloading/leaving the decision / approvers | Important | M |
| 5 | UXD-D-005 | Receive payment directly from the selected invoice, carrying its context / Finance | Important | M |
| 6 | UXD-D-006 | Give invoice details a restorable/shareable record URL / Finance, approvers | Important | M |
| 7 | UXD-D-007 | Put record identity and amount inside expense/payment confirmations / approvers, payers | Important | S |
| 8 | UXD-D-008 | Put pending decisions before approved correction history on phones / approvers | Important | S |
| 9 | UXD-D-009 | After WO billing, offer Open draft and an explicit approval next step / Finance | Important | S–M |
| 10 | UXD-D-010 | Keep timesheet total and Save/Submit reachable while editing a long phone week / Engineer | Important | M |

Effort is indicative: **S** localized component/copy change; **M** multi-component/route/state change. Money workflow semantics and current authority must remain intact. No Critical design issue was established. Invitation and ERP failures may depend on the local environment; their **observed presentation** is the review finding, not an inferred infrastructure/security cause.

## Job effort table

Counts are reconstructed from the exercised control path, not timed analytics. **S/C/T/D = screen states / button-or-selection clicks / typed fields / substantive choices.** Modal and confirmation states count as screens; focus clicks, keyboard characters, scrolling, authentication and reviewer role switching do not. Ranges reflect alternative entry paths. Minimum is a proposed design target preserving required data, confirmation and second-person approval—not a claim that legal/authority steps can disappear.

| Job / role | Current S/C/T/D | Minimum S/C/T/D | Avoidable effort | Fix |
|---|---|---|---|---|
| Create general project invoice / Finance | 2–3 / 6–8 / 3 / 3–4; VAT failure adds recovery trip | 2 / 4–6 / 3 / 2–3 | Repeat customer choice despite known project; delayed prerequisite discovery | Project-context entry; precheck and localized recovery, 002 |
| Bill a WO and find draft / Finance | 3 / 5–6 / 1 / 2; WO defaults amount/description | 2 / 2–3 / 1 / 2 | Leave project, find invoice list, open menu and view | 009; retain WO defaults |
| Preview/approve invoice / second Finance or Admin | 3 / 4 / 0 / 1 from list | 2 / 3 / 0 / 1 | Menu hides entry; do not remove necessary approval confirmation | 006, clear preview affordance |
| Correct unpaid WO invoice / Admin + Finance | 6–8 / 10–13 / 2 / 3 | 5–6 / 7–10 / 1–2 / 3 | Navigate back to originating WO and reconstruct replacement context | Link cancelled invoice to source WO; 006/009. Keep cancellation and separate approval |
| Record withholding receipt starting at invoice / Finance | 3 / 7 / 3 / 3 | 1–2 / 2–3 / 3 / 2 | Re-select customer and invoice; calculate cash difference mentally | 005/018; do not calculate income-tax liability |
| Record e-Faktur / Finance | 2 / 3 / 2 / 1 | 1 / 2 / 2 / 1 | Decode draft UUID to verify which invoice is being edited | 012 |
| Create claim with one line and receipt / claimant | 4–5 / 8–10 / about 5 / 3 | 3–4 / 6–8 / about 5 / 3 | Separate line editor/upload surfaces; preserve detailed evidence entry | Progressive inline line/receipt composition; no extra Attach after successful upload |
| Review evidence and approve claim / PM | 3–4 / 4–5 / 0 / 1 | 2 / 3 / 0 / 1 | Leave inbox; download/open evidence externally; return | 001/004/007 |
| Request, approve, pay and return advance / claimant + PM + Admin | 6–8 / 9–12 / 5–6 / 4 | 5–7 / 8–10 / 5–6 / 4 | Generic confirms force recall; repeat navigation between actors | 001/007; retain amount/reference and independent decisions |
| Enter five-day week and submit / Engineer | 2 / 4–5 / 5 / 2 | 2 / 4–5 / 5 / 2 | No necessary click reduction; phone scroll effort is high | 010; keep submit's existing auto-save rather than adding Save-first |
| Preview/approve week / PM | 2 / 3 / 0 / 1 | 2 / 3 / 0 / 1 | No extra route required; policy/copy adds unnecessary interpretive load | 011/019; retain in-place preview |
| Verify ERP push / approver or Admin | Approved week + integration page; no executable push in reviewed state | Read week status, act on applicable readiness/retry explanation | Completion cannot be counted in this environment | Follow-up test with configured domain and rich push fixtures; no forced shared-config changes |
| Export management pack / Finance or Executive | 1 / 1–2 / 0–2 / 1–2 | 1 / 1–2 / 0–2 / 1–2 | None proven; XLSX is adjacent to period selection | Preserve current export; validate exported totals at owning layer |
| Inspect project revenue / Executive | 2 / 1 / 0 / 1 | 2 / 1 / 0 / 1 | None proven; project row opens a real project | Preserve direct drill-in |
| Invite colleague / Admin | 2–3 / 4–5 / 1 / 1–2; did not complete | 2 / 3–4 / 1 / 1–2 plus a real success result | Blind retry and guessing what each role grants | 003/015 |
| Configure project numbering / Admin | Up to 2 destinations / 2–3 / 1 / 1 | 1 destination / 1–2 / 1 / 1 | Project setup does not contain project numbering | 014 |
| Understand zero credits / Admin | 1 / 0 / 0 / unresolved next decision | 1 / 0–1 / 0 / 1 | Must ask elsewhere what credits mean and who supplies them | 016 |

## Findings and regression proposals

Regression tests below are **proposed**, not added or run. UI fixes route to `ui-implementer`; graduate each accepted finding into its lowest sufficient test, a routes × oracles matrix cell and a retained design/decision note. Copy uses placeholders rather than real account data.

### UXD-D-001 — “All” is not all, and expenses have a different approval paradigm

- **Route/component/file:** `/approvals`; `ApprovalsPage`, `ExpenseClaimApprovalSection`; `pmo-portal/pages/Approvals.tsx`, `pmo-portal/pages/approvals/ExpenseClaimApprovalSection.tsx`.
- **Evidence:** `approvals-1440-dark.png`: two submitted expense objects appear in a separate region above All **6**, while the six counted items are procurement/timesheets. Expense links navigate to the record; the selected timesheet previews in place.
- **Lenses:** L1/L2/L3/L5. **Important · M.** JTBD §2 Approvals requires one inbox and preview/decision without drilling in; §3 requires analogous objects to share a paradigm.
- **Problem/fix:** a PM clearing the queue cannot use one total or one preview/next-item flow. Include all eligible pending object types in the aggregate, type filters and preview pane; preserve expense-detail deep links and authority. Do not merely relabel the current partial total as All.
- **Proposed copy:** EN “All pending · {{count}}” / “Preview claim”; ID “Semua yang menunggu · {{count}}” / “Pratinjau klaim”.
- **Regression:** unit mixed-type inbox: two expenses plus six other eligible items yield total eight; expense selection previews evidence/decision without navigation. Curated e2e: approve review-created claim from inbox and continue to next item.

### UXD-D-002 — Late VAT error is only half localized

- **Route/component/file:** `/sales-invoices`; `InvoiceFormModal` in `pmo-portal/pages/SalesInvoices.tsx`, mutation error presentation.
- **Evidence:** `invoice-ready-1440-light-id.png` → `invoice-error-1440-light-id.png`. One selected project allowed the filled form to reach submit, then failed for missing VAT. Other selected projects did correctly show the pre-submit prerequisite.
- **Lenses:** L1/L2/L5. **Important · S–M.** Finance needs to issue an accurate draft without discovering setup dependencies after data entry.
- **Problem/fix:** Indonesian headline is followed by English server prose. This increases interpretation work on a blocked money task. Resolve known prerequisite data before entry where possible; on server rejection, map the condition to fully localized, project-linked guidance, retain all values and say no draft was saved. Existing recovery link and retention are strengths; do not replace them with a toast-only error. This is not a claim that VAT prechecks always fail.
- **Proposed copy:** EN “This project needs a VAT rate before you can create an invoice. Your entries are saved in this form.” / “Record project VAT”; ID “Proyek ini memerlukan tarif PPN sebelum faktur dapat dibuat. Isian Anda tetap tersedia di formulir ini.” / “Catat PPN proyek”.
- **Regression:** unit selected-project precheck plus simulated late VAT rejection in en/id: no untranslated server detail; project remedy shown; amounts/items preserved.

### UXD-D-003 — Failed invitation has no actionable explanation

- **Route/component/file:** `/administration/users`; invite modal / `submitInvite`; `pmo-portal/pages/AdminUsers.tsx`.
- **Evidence:** `invite-error-1440-dark.png`; two attempts showed “Update failed” and “Edge Function returned a non-2xx status code”. No invitation completion was proven.
- **Lenses:** L1/L2/L5. **Important · S–M.** JTBD Admin: onboard colleagues and establish correct access.
- **Problem/fix:** Admin cannot distinguish invitation failure from a role update, determine whether anything was sent, or choose a useful recovery. Keep persistent inline error and retained values; classify outcomes into invitation-specific copy, a retry only when safe, and a support reference for unresolved failures. Do not claim delivery failed or nothing was sent unless the response establishes that outcome.
- **Proposed copy:** EN “We couldn't confirm that the invitation was sent. Your entries are still here. Retry, or contact support if this continues.”; ID “Kami belum dapat memastikan undangan terkirim. Isian Anda tetap tersedia. Coba lagi, atau hubungi dukungan jika masalah berlanjut.”
- **Regression:** unit rejected/unknown invitation response preserves inputs and uses invitation-specific localized recovery, not transport jargon; separate e2e verifies a successful invitation when its delivery dependency is available.

### UXD-D-004 — Claim evidence requires leaving the review

- **Route/component/file:** `/expenses/:claimId`; `ExpenseReceiptsCard`; `pmo-portal/pages/expenses/ExpenseReceiptsCard.tsx`.
- **Evidence:** `expense-approval-1440-dark.png`: attached image is a filename and Download action only. Source maps that action to a downloaded-file window.
- **Lenses:** L1/L2/L3. **Important · M.** Approver's job is inspect evidence before authorizing spend, not manage local files; JTBD preview-before-drill-in applies.
- **Problem/fix:** PM must download/open another viewer and return while remembering the claim. Add accessible image/PDF preview in the record and inbox, with filename, type and fallback Download. Preserve authorized file handling; do not expose permanent public file URLs.
- **Proposed copy:** EN “Preview receipt” / “Download original”; ID “Pratinjau bukti” / “Unduh berkas asli”.
- **Regression:** unit supported-file preview with loading/error/unsupported fallback and keyboard close/focus restoration; e2e approver opens review-created evidence and approves without leaving the inbox.

### UXD-D-005 — Recording money loses the invoice context

- **Route/component/file:** `/sales-invoices` → `/incoming-payments`; invoice row actions and receipt form; `pmo-portal/pages/SalesInvoices.tsx`, `pmo-portal/pages/IncomingPayments.tsx`.
- **Evidence:** `invoice-approved-1440-light-id.png`, `payment-withholding-1440-light.png`. Invoice row menu offered view, received-date, e-Faktur and cancellation—not Receive payment. Receipt creation required separate customer and invoice selection.
- **Lenses:** L1/L2/L3. **Important · M.** Finance wants to settle the invoice already in view.
- **Problem/fix:** the operator leaves the known invoice, opens another form and reconstructs two relationships. Offer context-carrying Receive payment for eligible invoices; initialize invoice/customer and outstanding amount, then collect actual cash, withholding and evidence. Preserve standalone receipt entry for bank-led reconciliation.
- **Proposed copy:** EN “Receive payment for {{invoice}}”; ID “Terima pembayaran untuk {{invoice}}”. Distinguish it from EN “Record client receipt date” / ID “Catat tanggal faktur diterima klien”.
- **Regression:** unit contextual initializer carries correct invoice/customer/currency; curated e2e starts at an unpaid invoice, records withholding receipt and observes Paid/outstanding result without reselecting relationships.

### UXD-D-006 — Invoice details cannot survive reload, and the footer duplicates Close

- **Route/component/file:** `/sales-invoices`; `viewTarget` / invoice-details modal; `pmo-portal/pages/SalesInvoices.tsx`.
- **Evidence:** `invoice-view-1440-dark-en.png`; opening detail left URL at `/sales-invoices`; reload produced no dialog. Footer displayed two Close buttons, one styled as primary. The existing `?q=` search link was checked in source/tests: it filters the list, not a record-detail URL.
- **Lenses:** L1/L2/L3/L4. **Important · M** for lost record context; duplicate footer is **Minor** within the same surface.
- **Problem/fix:** Finance cannot bookmark/share the actual detail with another approver; a reload requires rediscovery. Use an addressable invoice record or URL-backed preview with stable identity, browser Back and list return. Remove the redundant Close action; only a genuine next action should occupy primary emphasis.
- **Proposed copy:** EN “Invoice {{number}}” or “Draft invoice · {{project}}” / “Close”; ID “Faktur {{number}}” or “Draf faktur · {{project}}” / “Tutup”.
- **Regression:** unit URL-backed open/close; e2e direct link and reload retain the correct invoice, Back returns to the prior list/filter; read-only detail has one footer dismissal.

### UXD-D-007 — Financial confirmation hides what is being authorized

- **Route/component/file:** `/expenses/:claimId`; `ExpenseDecisionBar`; `pmo-portal/pages/expenses/ExpenseDecisionBar.tsx`.
- **Evidence:** exercised claim/advance approval and advance payment; `expense-approval-1440-dark.png`, `advance-return-1440-light-id.png` provide record context. Opened dialogs used “Approve this?” / “Mark as paid?”; source confirms record identity/amount is absent from those titles and unlinked payment body.
- **Lenses:** L1/L2/L5. **Important · S.** Approvers/payers must verify the selected object at the commit point.
- **Problem/fix:** modal occludes the record and asks the user to remember its identity and amount. Include number/title, claimant, amount/currency and relevant settlement consequence in the confirmation. Keep existing optional reference and linked-advance calculation; do not add redundant confirmation layers.
- **Proposed copy:** EN “Approve {{number}} for {{amount}}?” / “Mark {{number}} paid: {{amount}}”; ID “Setujui {{number}} sebesar {{amount}}?” / “Tandai {{number}} dibayar: {{amount}}”.
- **Regression:** unit approve/pay/return/cancel dialogs show the staged record and formatted amount in both locales; switching records never retains the previous confirmation identity.

### UXD-D-008 — Phone inbox prioritizes already-approved history

- **Route/component/file:** `/approvals`; `ReopenableApprovedSection` placement; `pmo-portal/pages/Approvals.tsx`.
- **Evidence:** `approvals-390-dark.png`: two approved correction cards precede pending filters and queue, consuming a substantial part of the first screen.
- **Lenses:** L1/L2/L4. **Important · S.** JTBD inbox: clear waiting decisions; correction is a secondary job.
- **Problem/fix:** users arriving for pending work first encounter unrelated completed history and potentially destructive-looking correction actions. Put pending count/queue first; place correction history in a named collapsed secondary region. Keep exceptional failed/held-push recovery discoverable when applicable.
- **Proposed copy:** EN “Pending decisions” / “Approved history and corrections”; ID “Keputusan yang menunggu” / “Riwayat persetujuan dan koreksi”.
- **Regression:** unit pending region precedes correction history; 390px visual/e2e oracle exposes a pending item/action before expanded archive content.

### UXD-D-009 — Successful WO billing does not hand off to the new draft

- **Route/component/file:** `/projects/:id/work-orders`; `InvoiceWorkOrderModal` and parent completion handling; `pmo-portal/pages/project-detail/InvoiceWorkOrderModal.tsx`.
- **Evidence:** `invoice-work-order-1440-light-id.png` → `work-order-drafted-1440-light-id.png`; successful creation stayed on Work Orders. Finance went to Sales Invoices to find and inspect the draft.
- **Lenses:** L1/L2/L3/L5. **Important · S–M.** Finance's job ends with a draft ready for the correct second person, not merely a changed remaining-value cell.
- **Problem/fix:** retain the new invoice's stable identity in the completion result and provide Open draft plus a concise next-step explanation. Preserve project/WO context and remaining-value refresh; do not auto-approve or unnecessarily navigate away.
- **Proposed copy:** EN “Draft created. A different Finance or Admin user must approve it.” / “Open draft”; ID “Draf dibuat. Pengguna Finance atau Admin lain harus menyetujuinya.” / “Buka draf”.
- **Regression:** unit successful native/ERP creation exposes the returned draft identity even before numbering; e2e completion action opens exactly that draft and does not offer author self-approval.

### UXD-D-010 — Phone timesheet actions are far from the work

- **Route/component/file:** `/timesheets`; mobile grid and footer; `pmo-portal/pages/Timesheets.tsx`, `pmo-portal/src/components/ui/TimesheetGrid.tsx`.
- **Evidence:** `timesheets-390-light-id.png`, `timesheets-390-dark-id.png`: one project/day card nearly fills the screen; the seeded two-project week requires further scrolling before Save/Submit. Desktop entry was efficient.
- **Lenses:** L1/L2/L4. **Important · M.** Engineer JTBD: log hours quickly at the end of work.
- **Problem/fix:** repeat card height, full weekend controls and a bottom-only footer separate completion from entry. Keep total and Save/Submit in a compact sticky, non-obscuring mobile action strip; consider collapsing inactive project/weekend details, not removing days. Preserve visible labels, touch targets and keyboard traversal. Do not add a compulsory Save step: Submit already auto-saves.
- **Proposed copy:** EN “{{hours}} hours this week” / “Save draft” / “Submit week”; ID “{{hours}} jam minggu ini” / “Simpan draf” / “Ajukan minggu ini”.
- **Regression:** 390×844 visual/e2e test with at least two projects and keyboard open: completion actions remain reachable and do not cover the last input or validation message; submit persists all entered hours.

### UXD-D-011 — Workforce localization stops before the operational details

- **Route/component/file:** `/timesheets`, `/approvals?scope=timesheets`; grid/preview; `pmo-portal/src/components/ui/TimesheetGrid.tsx`, `pmo-portal/pages/timesheets/ApprovalsQueue.tsx`.
- **Evidence:** `timesheets-390-light-id.png`, `timesheet-approved-390-dark-id.png`, `timesheet-approved-1440-dark-id.png`; Bahasa pages retain Approved, ROW TOTAL/WEEK TOTAL and English accessible hour/note names. Admin Bahasa approval snapshot retained Team approvals queue, Approve/Return.
- **Lenses:** L2/L4/L5. **Important · S–M.** Local-language workers and screen-reader users need the same comprehensible status/actions as the translated shell.
- **Problem/fix:** route all grid totals, states, actions, confirmation/feedback and accessible names through localized semantic keys; format totals through the shared formatter. Preserve consistent project names/codes rather than translating record content.
- **Proposed copy:** EN “Approved” / “Week total” / “{{project}}, {{day}} hours”; ID “Disetujui” / “Total minggu” / “Jam {{project}}, {{day}}”. EN “Return for changes”; ID “Kembalikan untuk diperbaiki”.
- **Regression:** unit complete en/id draft/approved/approval preview including accessible names and success feedback; screenshot oracle at both sizes must not leave English operational labels in Bahasa mode.

### UXD-D-012 — Draft e-Faktur form identifies the invoice by UUID

- **Route/component/file:** `/sales-invoices`; e-Faktur modal `recordLabel`; `pmo-portal/pages/SalesInvoices.tsx` (fallback is invoice ID).
- **Evidence:** `e-faktur-form-1440-light-id.png`: subtitle is an internal UUID, despite the invoice already having recognizable customer, project and WO context.
- **Lenses:** L1/L2/L5. **Minor · S.** Finance needs to confidently attach tax evidence to the intended invoice.
- **Problem/fix:** for unnumbered drafts, show human-readable draft/customer/project or WO identity. Explain that the reference is copied from the issued tax document and number/date travel together. Do not invent statutory format requirements from this single synthetic successful entry.
- **Proposed copy:** EN “For draft invoice · {{project}}” / “Copy the number from the issued e-Faktur document”; ID “Untuk draf faktur · {{project}}” / “Salin nomor dari dokumen e-Faktur yang diterbitkan”.
- **Regression:** unit numbered and unnumbered invoices use recognizable labels, never UUID as the sole displayed identity; pair validation and existing empty/non-VAT behavior remain unchanged.

### UXD-D-013 — Expense breadcrumb never finishes loading

- **Route/component/file:** `/expenses/:claimId`; shell breadcrumb/cache resolution; `pmo-portal/App.tsx`, `pmo-portal/src/hooks/useCachedRecordLists.ts`, `pmo-portal/src/components/shell/Breadcrumb.tsx`.
- **Evidence:** `expense-draft-1440-light.png`, `expense-approval-1440-dark.png`, `advance-return-1440-light-id.png`: settled content and successful transitions coexist with “Expenses > Loading…”.
- **Lenses:** L2/L3/L5. **Minor · S–M.** JTBD record Get-back/Name paradigm requires stable identity.
- **Problem/fix:** the shell's perpetual placeholder falsely signals unfinished data and makes record context unreliable. Resolve expense detail identity from its existing query cache, without initiating unnecessary list fetches. Distinguish pending, resolved and not-found states; translate the parent crumb.
- **Proposed copy:** EN “Expenses › {{numberOrTitle}}”; ID “Biaya › {{numberOrTitle}}”.
- **Regression:** unit shell on a cold expense deep link transitions loading → actual title after detail resolution, and missing record → localized not-found; no extra list request solely for a breadcrumb.

### UXD-D-014 — Project numbering lives under Accounting, not Project setup

- **Route/component/file:** `/administration/accounting`, `/administration/projects`; section composition; `pmo-portal/pages/Administration.tsx`, `pmo-portal/pages/admin/OrgProjectNumberPattern.tsx`.
- **Evidence:** `administration-accounting-1440-light-id.png`, `administration-projects-1440-light-id.png`; source confirms number pattern is the first Accounting component, while Project setup contains classification options.
- **Lenses:** L1/L2/L3/L5. **Minor · S–M.** Admin configuring project identification naturally starts at Project setup and must search another destination.
- **Problem/fix:** move the numbering editor to the canonical Project setup destination, retaining a cross-link if existing users enter through Accounting. Keep actual tax/account mapping controls in Accounting; do not duplicate editable configuration in both places.
- **Proposed copy:** EN “Project numbering” / “Set the format used for new project numbers”; ID “Penomoran proyek” / “Atur format nomor untuk proyek baru”.
- **Regression:** unit Project setup owns one numbering editor; Accounting exposes at most a link; route/copy test preserves existing configuration and future-record-only semantics.

### UXD-D-015 — Role assignment asks for a policy decision without policy help

- **Route/component/file:** `/administration/users`; invitation and role modal; `pmo-portal/pages/AdminUsers.tsx`.
- **Evidence:** `invite-form-1440-dark.png`; role helper says it determines what the person can see/do but gives no selected-role capability summary. Source uses similarly generic role-form help.
- **Lenses:** L1/L2/L5. **Minor · M.** Admin's JTBD is correct access, not merely choosing a role name.
- **Problem/fix:** administrators unfamiliar with this product must infer permissions from generic labels. Add a compact selected-role summary and a read-only capability reference derived from the real policy. Show scope and relevant approval limits; no role writes were exercised in this pass, and no access-control defect is alleged.
- **Proposed copy:** EN “What this role can do” / “View role capabilities”; ID “Kemampuan peran ini” / “Lihat kemampuan peran”. Actual bullets must be generated from the current policy, not guessed in copy.
- **Regression:** unit changing selected role updates the summary and labels in en/id, derived from policy; inspect-only capability expansion must not save a role or modify users.

### UXD-D-016 — Zero credits has neither meaning nor next step

- **Route/component/file:** `/administration/credits`; `AdministrationCredits`; `pmo-portal/pages/AdministrationCredits.tsx`.
- **Evidence:** `administration-credits-390-light-id.png`, `administration-credits-1440-light-id.png`: organization balance 0 credits and otherwise empty content for an organization Admin.
- **Lenses:** L1/L5. **Minor · S.** Admin needs to understand whether this balance requires action.
- **Problem/fix:** this is a real balance, not an empty-data error, but nothing explains its use, allocation owner or zero-balance consequence. Add verified product policy text and a legitimate help/request route. Do not manufacture a payment CTA or show operator-only Grant controls to ordinary Admins.
- **Proposed copy:** EN “Organization credit balance” / “Learn how credits are allocated”; ID “Saldo kredit organisasi” / “Pelajari alokasi kredit”. State the actual usage/zero-balance consequence only after product confirms it.
- **Regression:** unit zero/nonzero ordinary-Admin states show meaning/help without Grant; operator grant behavior and existing error/loading distinctions remain intact.

### UXD-D-017 — Money uses an identifier typeface

- **Route/component/file:** `/sales-invoices`, `/incoming-payments`; monetary table spans; `pmo-portal/pages/SalesInvoices.tsx` (amount/outstanding spans), `pmo-portal/pages/IncomingPayments.tsx` (amount span).
- **Evidence:** `sales-invoices-1440-light-en.png`, `incoming-payments-1440-light.png`. DOM computed style confirmed invoice amount uses the monospace stack while adjacent total-due uses Inter; source confirms `font-mono` on money cells.
- **Lenses:** L4. **Minor · S.** Violates DESIGN.md §3 Mono-For-Identifiers Rule: money is Inter-tabular, not mono.
- **Problem/fix:** Finance compares net, total and outstanding figures rendered with different rhythms/typefaces. Use Inter with mandatory tabular numerals and consistent numeric alignment; retain mono only on document/reference identifiers.
- **Proposed copy:** labels unchanged: EN “Amount” / “Outstanding”; ID “Jumlah” / “Belum dibayar”. This is a token fix, not an occasion to rename the financial concept.
- **Regression:** computed-style or token-bound component test checks money's font family/tabular numerals; visual oracle checks aligned currency/amount cells in both themes and locales.

### UXD-D-018 — Withholding entry lacks an adjacent reconciliation summary

- **Route/component/file:** `/incoming-payments`; Receive Payment form; `pmo-portal/pages/IncomingPayments.tsx`.
- **Evidence:** `payment-withholding-1440-light.png`; selecting invoice initialized Paid Amount and Received Amount to 999. Entering withheld 18 left cash at 999 until it was manually changed to 981.
- **Lenses:** L1/L2/L5. **Minor · S–M.** Finance must reconcile gross applied amount, actual cash and stated withholding.
- **Problem/fix:** helpful individual field explanations exist, but the operator must perform the cross-field reconciliation mentally. Show an adjacent live breakdown/difference using the current amounts and established receipt semantics; allow deliberate edits. Do not infer a tax rate, silently recalculate tax, or introduce a new accounting equality rule without checking existing product decisions.
- **Proposed copy:** EN “Cash {{cash}} + withholding {{tax}} = {{sum}}” / “Applied to invoice: {{applied}}”; ID “Kas {{cash}} + pajak dipotong {{tax}} = {{sum}}” / “Dialokasikan ke faktur: {{applied}}”.
- **Regression:** unit localized preview updates for cash/withholding/partial-payment edits and currency scale; accepted business-valid differences must not be blocked merely to satisfy the preview.

### UXD-D-019 — General SoD guidance looks like a record-specific block

- **Route/component/file:** `/approvals` timesheet panel; `TimesheetApprovalPreview`; `pmo-portal/pages/timesheets/ApprovalsQueue.tsx`.
- **Evidence:** `approvals-1440-dark.png`: another person's submitted week, enabled Approve and a prominent amber lock notice “You cannot approve your own timesheet”. PM approval subsequently succeeded. Source uses a general `GateNotice variant="blocked"` for panel previews by default.
- **Lenses:** L2/L4/L5. **Minor · S.** The general rule is true; this is **not** a false server refusal or an authority defect.
- **Problem/fix:** the blocked styling visually competes with the valid decision action and makes the reviewer determine whether the current week is prohibited. Present general policy as quiet help; reserve blocked notices for a current-record restriction with its actual reason. Localize it with the rest of the preview.
- **Proposed copy:** EN “Policy: a different person approves each timesheet.”; ID “Aturan: timesheet disetujui oleh orang yang berbeda.” For a real self-owned restriction, use explicit current-record copy instead.
- **Regression:** unit non-owned eligible week has enabled decision and neutral policy help; restricted own week has the specific blocked explanation. Backend authority remains unchanged.

## Four charter lenses — assessment

### Lens A — Visual/correctness

**Strengths:** coherent restrained light/dark surfaces, compact desktop tables, recognizable primary actions, preserved project/WO/customer PO context, strong persistent form-error treatment, and useful phone record cards. No aesthetic rebrand, generic gradient treatment or fake-depth redesign is needed.

**Issues:** Important 008/010 (priority/reachability), Important 011 (localized accessible names); Minor 006 duplicate primary Close, 017 money typography, 019 misleading warning treatment. Contrast, focus and interaction performance require deterministic follow-up—not unmeasured pass claims. No systemic page overflow or jank was established in this scoped pass.

### Lens B — IxD/task-flow

**Strengths:** WO remaining/default description reduce entry, receipt invoice selection prefills amounts, Submit auto-saves a week, second-person approval is clear for invoices, and return outstanding changes immediately.

**Issues:** Important 001/004/005/007/009; Minor 018/019. The main cost is memory/context reconstruction and moving evidence outside the decision, rather than an excess of legally necessary approval steps.

**Nielsen-10 directional scores** (1 weak, 5 strong; judgment, not instrumented measurement): visibility 3; real-world language 3; user control 4; consistency 2; error prevention 3; recognition over recall 2; flexibility/efficiency 3; minimalism 4; error recovery 2; help/learning 2. Concrete evidence is in the numbered findings, not the score itself.

**Five-role walkthrough:** Engineer completes entry but must scroll to commit and decode mixed-language totals; PM can decide timesheets efficiently but expense evidence/queue differs; Finance successfully bills/settles but repeatedly re-establishes invoice context; Admin reaches coherent routed sections but cannot complete the invitation attempt or infer role/credit meaning; Executive can inspect project revenue and export a pack without an invented intervention workflow. Required independent approval is productive effort, not friction to remove.

### Lens C — IA/navigation

**Strengths:** organization settings have distinct routed destinations; project revenue rows reach actual projects; workforce review has a canonical approvals destination rather than a second embedded approval queue.

**Issues:** Important 001/006; Minor 013/014. Keep one canonical home for an entity/configuration while adding context-preserving entry points—not duplicate screens with divergent state. Invoice `?q=` search support is acknowledged; it does not restore opened details.

### Lens D — Intent/JTBD

**Strengths:** Finance can get from WO to an accurately taxed approved invoice and settle it; reporting can produce a downloadable workbook; Engineer can submit an entire week without a separate required Save.

**Issues:** Important 001/004 violate the approval preview paradigm; 005/009 separate the next lever from the insight; 008/010 put secondary/history or repeated card detail ahead of the primary action. Minor 015/016 leave the Admin's capability/credit decision unexplained. Five intent questions were applied: job, expected location, priority, adjacent action and analogous-object consistency. The non-scope calibration anchors were not falsely filed as Area D defects.

## Cross-area patterns and handoff

1. **Count and preview must share the same population.** An “All” count beside out-of-band approvable objects creates task blindness. Apply the mixed-type oracle wherever inboxes/exception tiles summarize work.
2. **Carry relationships forward.** WO → draft, invoice → payment and insight → record should retain identity, amount basis/currency and source reference. Avoid forcing users to rediscover relationships already known to the app.
3. **Decision evidence belongs beside the decision.** Preview-before-drill-in is a product paradigm, not a procurement-only feature. Make it shared for claims and other evidence-bearing approvals.
4. **Copy is part of the transaction contract.** Name the object/amount at commit; distinguish Create/Approve/Receive/Cancel; state known versus uncertain outcomes. Do not replace technical prose with confidently inaccurate reassurance.
5. **Complete localization below the shell.** Statuses, accessible names, total labels, confirmation bodies and failure details need the same en/id coverage as navigation.
6. **Responsive design needs an action-priority oracle.** A phone layout can fit the viewport and still bury the user's job beneath archive cards or repeated daily inputs. Test a two-project week and mixed approval queue, not a single empty card.
7. **Explain setup readiness without altering shared configuration.** Connection, domain ownership and successfully transferred data are different states. Current integrations already explain that connection alone is insufficient; unavailable setup/push paths need separate environment-enabled acceptance coverage, not speculative UX defects.
8. **Read-only is a deliberate experience.** Ordinary Admin credit visibility is not missing Grant authority. Supply meaning and legitimate help; preserve current permissions.
9. **Token fidelity should become deterministic.** Font family/tabular numeric rules and locale label completeness belong in component/visual gates, not repeated human rediscovery.

### What was deliberately not called a defect

- Missing VAT on a project is a valid prerequisite; several forms showed the appropriate precheck/remedy. Finding 002 is the observed late/error-copy path, not a request to allow untaxed invoices.
- The general SoD rule is valid and the PM's approval succeeded; 019 concerns visual framing, not incorrect permission enforcement.
- The initial disabled numbering Save can reflect unchanged state; no “broken Save” claim is made.
- Browser dropdown/date automation quirks are not app defects; phone tables/cards were not labelled overflow solely because content was below the fold or a desktop table scrolled internally.
- Cancellation/reissue, withholding receipt recording, net revenue reflection and advance return balance changes succeeded; no money-calculation defect was established.
- Zero ordinary-Admin credits does not justify adding an operator-only Grant action.
- The monthly pack's January–October default is a legitimate selectable period, not by itself a reporting bug. XLSX download was verified; this does not prove every exported calculation.

**Next round:** fix 001–010 first; add/graduate the proposed tests and matrix cells, then re-render the same rich fixtures at both sizes/themes/locales. Exercise successful invitations and configured timesheet push/held/retry paths in a suitable local dependency state. This review is complete as discovery, not acceptance of the unproven paths or permission to ship a red gate.

DISCOVER-D-DONE
