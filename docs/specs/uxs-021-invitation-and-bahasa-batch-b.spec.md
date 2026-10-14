# Spec — Invitation outcomes and Bahasa batch B (UXS-021 / UXS-006)

**Status: SIGNED — Director, 2026-10-14**, under the owner's "do the UX follow-ups" mandate. Built in three runs: B1 AC-UXB-001..003 (invitation) · B2 004..007 (purchasing) · B3 008..009 (workforce).

Sources: UXD-D-003, UXD-C-011 and UXD-D-011 in `docs/reviews/2026-10-10-ux-discover-{C,D}.md`.

Jobs: Admin understands an invitation result and its safe next step without re-entering data;
purchasing/workforce users understand fields, decisions and feedback in their saved language.
Preserve DESIGN identity and existing business/authorization rules; this is not an infrastructure diagnosis.

## Surfaces and states

Paths are relative to `pmo-portal/`. Cover labels, helpers, placeholders, accessible names and feedback,
including existing populated/loading/empty/error/read-only branches, without inventing new workflows.

| Route / persona | Sources / included states |
|---|---|
| `/administration/users`, Admin | `pages/AdminUsers.tsx`: InviteFormModal/submitInvite; idle, validation, pending, accepted, known refusal, unknown outcome, correction and explicit retry |
| `/procurement`, Engineer/PM/Finance | `pages/Procurement.tsx`, `pages/procurement/NewProcurementModal.tsx`, `budgetCategoryOptions.ts`, `components/ProcurementBoard.tsx`: list/board/view labels, raise form, routing/budget helpers, validation and retained-input failure; shared modal also mounts on project Procurement tab |
| `/procurement/:id/items`, requester/PM | `pages/procurement/LineItemsSection.tsx`: add/edit/delete, quantity/rate errors, empty/read-only/loading, totals and save/refusal feedback |
| `/procurement/:id` and document capture | `pages/ProcurementDetails.tsx`, `pages/procurement/{ProcurementDecisionZone,RecordCaptureForm,VendorBillTaxFields}.tsx`: ready/blocked/routed status, request/approve/return/order/receipt/invoice/payment fields and existing confirmations, failure/retry/push feedback |
| `/approvals`, permitted purchasing reviewer | `pages/Approvals.tsx`, `pages/approvals/ProcurementApprovalRow.tsx` and its preview: request/budget impact, controls, existing confirmations and result feedback |
| `/timesheets`, Engineer | `pages/Timesheets.tsx`, `src/components/ui/TimesheetGrid.tsx`: draft/submitted/approved/returned, totals, hour/note accessible names, Save/Submit/confirmation and error/success feedback |
| `/approvals?scope=timesheets`, PM/Executive/Admin | `pages/timesheets/ApprovalsQueue.tsx`: queue/preview, own/other week, Approve/Return, single/bulk confirmation, success/partial/refused feedback and existing push state labels |

Existing `TimesheetGrid.localization.test.tsx` and the mobile action-strip work already cover part of this
surface; retain those fixes and extend remaining approval/status/feedback coverage rather than rewriting them.

## Requirements (EARS)

- **FR-UXB-001:** When an invitation request settles, the interface shall distinguish acknowledged acceptance, an explicitly recognized refusal with a supported remedy, and an unknown outcome; it shall use invitation-specific copy rather than “Update failed” or transport prose.
- **FR-UXB-002:** When the invitation outcome is unknown, the interface shall persistently show **“We couldn't confirm that the invitation was sent.” / “Kami belum dapat memastikan undangan terkirim.”**, retain email/role inputs, and offer conservative verification/support guidance without asserting delivery, non-delivery or that nothing was created.
- **FR-UXB-003:** When a recognized refusal has a supported correction, the interface shall name the actionable remedy in en/id, retain inputs, and allow correction before an explicit resubmission; arbitrary exception text shall not become a known outcome.
- **FR-UXB-004:** While an invitation request is pending, the interface shall prevent duplicate submissions; when an outcome is uncertain, it shall not automatically resend or present blind retry as safe, and shall direct the Admin to check Users before retrying or contact support if still unsure.
- **FR-UXB-005:** When an invitation request is acknowledged, the interface shall describe only the acknowledged result (for example “Invitation request accepted” / “Permintaan undangan diterima”), not claim receipt, mailbox delivery or acceptance by the invitee.
- **FR-UXB-006:** When a purchasing surface above renders, the interface shall localize its system fields, routing/budget explanations, displayed stages, decision consequences, validation and feedback without changing draft creation, transitions, financial amounts or reviewer rules.
- **FR-UXB-007:** When workforce entry or approval renders or a decision settles, the interface shall localize status, totals, hour/note names, action/confirmation and success/refusal/partial-result copy for both single and bulk decisions without changing who may decide.
- **FR-UXB-008:** The interface shall use the single `public/locales/{en,id}/common.json` dictionary pair and static parser-visible `t()` keys, including stored-value display maps following `pages/MyTasks.tsx` `task.status.*`; API enum values shall remain unchanged.
- **FR-UXB-009:** When delegated purchasing/workforce/invitation sources enter scope, the implementation shall name them on the existing route lines in `src/lib/i18n/launch-scope-routes.txt`; `npm run check:i18n` shall pass.
- **NFR-UXB-001:** The change shall retain real-role/SoD/RLS/org boundaries, invitation request shape, account-privacy behavior and existing telemetry redaction; user feedback shall expose no raw server body, infrastructure diagnosis or sensitive diagnostic data.
- **NFR-UXB-002:** Localization shall add zero network calls; one explicit invitation submission shall issue at most one mutation, with zero automatic retry mutations after an unknown outcome.
- **NFR-UXB-003:** Errors shall remain persistent/readable through shared form/live-region patterns; keyboard focus and form values shall survive failed submissions; phone controls shall remain usable at 390px using DESIGN tokens.

## Outcome/error handling and approved copy

| Outcome / error | Required user response / next step |
|---|---|
| Client validation or recognized correctable refusal | Localized field/summary remedy, e.g. “Choose a valid role.” / “Pilih peran yang valid.”; keep inputs, correct then resubmit. |
| Recognized access restriction | Invitation-specific localized explanation and “Ask an administrator for help.” / “Minta bantuan administrator.”; no speculative workaround or blind retry. |
| Timeout, interrupted response, unrecognized/non-JSON refusal or unexpected error | FR-UXB-002 anchor + “Your entries are still here. Check Users before trying again. If you're unsure, contact support.” / “Isian Anda tetap tersedia. Periksa daftar Pengguna sebelum mencoba lagi. Jika masih ragu, hubungi dukungan.” No automatic resend. |
| Acknowledged request | FR-UXB-005 wording; refresh directory through existing query invalidation, without promising email delivery. |
| Purchasing/workforce validation/refusal | Localized existing field/remedy and preserved input/selection; unknown outcomes remain uncertain, never a fabricated failure/success. |

Support guidance shall use only an existing support path and an opaque reference if already supplied and safe;
it shall not invent a ticket number, expose diagnostics, or request credentials. Known refusal classification
must follow the existing response contract, not guess a cause from HTTP status or exception-message substrings.

| en anchor | id anchor |
|---|---|
| Raise a purchase request; Create request | Ajukan permintaan pembelian; Buat permintaan |
| Title; Project; Vendor; Budget category | Judul; Proyek; Vendor; Kategori anggaran |
| Quantity; Unit price; Budget impact | Kuantitas; Harga satuan; Dampak pada anggaran |
| Board; Requested | Papan; Diajukan |
| Approved; Row total; Week total | Disetujui; Total baris; Total minggu |
| {{project}}, {{day}} hours; {{project}}, {{day}} note | Jam {{project}}, {{day}}; Catatan {{project}}, {{day}} |
| Team approvals queue; Approve; Return for changes | Antrean persetujuan tim; Setujui; Kembalikan untuk diperbaiki |
| Timesheet approved; Timesheet returned | Timesheet disetujui; Timesheet dikembalikan |

## Acceptance criteria

All criteria run in en/id using real catalogues, asserting **specific labels**, not “no English anywhere”.
Exclude user-authored names/titles/notes/locations, provider/brand names (ERPNext, ClickUp, Microsoft), stored
enums, URL parameters and analytics names. Retain legitimate PR/PO/PPh abbreviations and catalogue borrowings.

- **AC-UXB-001** — Given a filled invitation form and recognized correctable/refused outcomes, When submission is refused, Then persistent invitation-specific localized copy names the supported correction/help, retains inputs and never uses update/transport jargon.
- **AC-UXB-002** — Given a filled invitation form, When timeout/unrecognized/non-JSON/unexpected failure leaves the outcome unknown, Then the exact conservative anchor and check-Users/support guidance appear, inputs stay, and neither toast nor inline message claims sent/not-sent/delivered/nothing-created or an infrastructure cause.
- **AC-UXB-003** — Given pending then unknown invitation outcome, When submit is pressed repeatedly and the form is corrected/resubmitted explicitly after checking the outcome, Then only one call runs while pending, none auto-retries, preserved values remain editable, and later acknowledgement uses request-accepted rather than delivery copy.
- **AC-UXB-004** — Given purchasing list/board and the shared raise form, When states/validation/routing/category helpers render and a create fails, Then “Ajukan permintaan pembelian”, “Judul”, “Proyek”, “Vendor”, “Kategori anggaran”, “Buat permintaan”, “Papan” and “Diajukan” map to their English counterparts; input and submitted raw category/status values are unchanged.
- **AC-UXB-005** — Given editable/read-only line items, When add/edit/delete/invalid quantity or rate and failure states render, Then field/instruction/total/confirmation/remedy labels are localized, numeric-format examples use the configured number locale, and entered values are retained.
- **AC-UXB-006** — Given procurement stages with requester/reviewer/payer and blocked/routed fixtures, When decisions, budget preview and confirmations/results render, Then specific localized action/role/consequence labels match the existing decision semantics, preserve authoritative amounts and keep stored transition payloads unchanged.
- **AC-UXB-007** — Given receipt/invoice/payment capture and tax prerequisites, When fields/options/validation/confirmation/push/refusal states render, Then system labels and remedies are localized while amounts, invoice links, required evidence and persisted values remain unchanged; invoice recognition follows UXS-031.
- **AC-UXB-008** — Given draft/submitted/approved/returned timesheets, When grid and page feedback render, Then totals, statuses, hour/note names and Save/Submit/confirmation/error/success text use the locale without altering hours, number-format preference or Submit's auto-save.
- **AC-UXB-009** — Given own/other eligible weeks and single/bulk/mixed-result decisions, When queue/preview/confirmation and feedback render, Then “Antrean persetujuan tim”, “Setujui”, “Kembalikan untuk diperbaiki” and localized per-result counts/status/messages are correct, including refused/partial outcomes; policy/blocked distinctions and write authority remain unchanged.

## Ownership and graduation (planned)

Each AC owns **one unit (Vitest/RTL) `it`** with its AC-id in the title and fixture loops as needed, following
ADR-0010. Mock repositories/hooks, not the named UI children. New `.bahasa`/`.feedback` files are planned;
existing non-owning tests remain supporting regression proof. Add the last column to `docs/decisions.md`
and register each test + cell in `docs/qa-portfolio.md` only after implementation is green.

| AC | Owning test file (relative to `pmo-portal/`) | Routes × primary oracle | Graduation note |
|---|---|---|---|
| AC-UXB-001 | `pages/AdminUsers.bahasa.test.tsx` | `/administration/users` × action-completeness | Invitation refusals name the invitation and remedy. |
| AC-UXB-002 | `pages/AdminUsers.bahasa.test.tsx` | `/administration/users` × state-coverage | Unknown outcome is not confirmed non-delivery. |
| AC-UXB-003 | `pages/AdminUsers.test.tsx` | `/administration/users` × state-coverage/action-completeness | Preserve inputs; explicit submission, never blind resend. |
| AC-UXB-004 | `pages/Procurement.bahasa.test.tsx` | `/procurement`, `/projects/:id/procurement` shared form × job-fit-per-role/cross-screen consistency | Translation follows the raise-request component. |
| AC-UXB-005 | `pages/procurement/LineItemsSection.test.tsx` | `/procurement/:id/items` × state-coverage/cross-screen consistency | Language and numeric-format preference are distinct. |
| AC-UXB-006 | `pages/ProcurementDetails.bahasa.test.tsx` | `/procurement/:id`, `/approvals` procurement preview × action-completeness/cross-screen consistency | Translate safeguards; never change authority/consequences. |
| AC-UXB-007 | `pages/procurement/RecordCaptureForm.bahasa.test.tsx` | `/procurement/:id/documents` capture × state-coverage/cross-screen consistency | Tax/evidence/push feedback is task copy, not diagnostics. |
| AC-UXB-008 | `pages/Timesheets.bahasa.test.tsx` | `/timesheets` × state-coverage/cross-screen consistency | Extend shipped grid/strip localization through results. |
| AC-UXB-009 | `pages/timesheets/__tests__/ApprovalsQueue.feedback.test.tsx` | `/approvals?scope=timesheets` × state-coverage/cross-screen consistency | Single and bulk outcomes share localized semantics. |

## Discover, exclusions, files and TODO

- Manual Discover: Director judges agent-browser screenshots at **1440×900 and 390×844 × en/id**. Admin: filled invite known-refusal/unknown/pending/acknowledgement fixtures; Engineer/PM: purchasing board/raise/lines; PM/Finance: blocked/eligible decisions, budget preview and capture; Engineer: two-project draft/approved week; PM: own/other week preview, single/bulk success/refusal. Use controlled local responses for uncertain outcomes, not real repeated mail sends. Record each AC cell's locale/persona/state/viewport; sweep WCAG-AA labels/focus, state-coverage, cross-screen consistency and mobile@390. No new Playwright visual gates; these copy/state ACs need no new e2e, and this spec claims no live delivery proof.
- Out: invitation transport/delivery configuration, acceptance/auth flow, new resend/idempotency endpoint, role/capability redesign; purchasing totals/payment/quotation/receipt/rework-policy changes; unified inbox redesign; new workforce authority/push pipeline; mobile action-strip redesign; delivery batch A and tax-evidence recognition (UXS-031). Existing success journeys/enforcement tests remain intact.
- Shared rulings: users see **Phase / Fase**; Work Order remains the existing catalogue borrowing. Sales-invoice nav/breadcrumb/page use **Faktur Penjualan**, with **AC-FIN-002**'s explicit assertion amendment owned by batch A, not duplicated here.
- Likely touched: named source surfaces, `src/lib/db/adminUsers.ts` only if preserving structured outcome evidence needs adjustment, existing invitation error-classification boundary (`src/lib/invite/` if extracted), procurement stage label helper and timesheet static status mapping, catalogue pair/launch manifest, owning test files. No broad rewrite of `classifyMutationError` or backend changes are required.
- [ ] Obtain owner sign-off; plan exact outcome whitelist/remedies and static keys before coding; add failing AC-tagged tests first.
- [ ] Localize shared purchasing/workforce children and invitation outcomes through the existing dictionary; preserve all existing transaction rules and tests.
- [ ] Extend delegated-component launch scope; pass `npm run check:i18n` and scoped local gates under CLAUDE.md's lock rules.
- [ ] Complete manual Discover; add each AC's test/cell/retention note and graduate any new findings before acceptance.
