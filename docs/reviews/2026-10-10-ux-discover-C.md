# Area C — rendered UX discovery, 2026-10-10

⚠️ DEGRADED: single-context, as requested; no subagents or independent second reviewer.

## Five-line verdict
1. **Fix-then-ship:** the visual system is coherent, but new procurement money and payment-state inconsistencies undermine Finance's core job.
2. **Visual consistency:** light/dark remain recognizably PMO; phone work is burdened by tall toolbars and horizontally hidden lifecycle context, not a need for a new aesthetic.
3. **Best practice/accessibility:** named controls, visible focus and slip reconciliation are strengths; a visible withholding action silently fails when its vendor prerequisite is absent.
4. **Effort/intuitive workflow:** empty-draft creation, evidence-versus-stage duplication and an incompletely unified approval inbox add avoidable steps and interpretation.
5. **Guidance/localization:** Bahasa purchasing is patchy and rejection guidance contradicts rework; month-end register completion remains a known roadmap gap, not a newly broken feature.

## Scope, method and evidence limits

- Audited the existing app at `http://127.0.0.1:5200`, build footer `cfaf5386`, with named browser session `disc-C`. No server start/stop, app-code edits, commits, resets, or edits to pre-existing seed records. Created four review-owned requests and one review-owned vendor; mutations below concern those fixtures only. Other reviewers supplied additional live approval work during the pass.
- Walked Engineer request initiation, PM approval/sourcing/receipt, Finance invoice/payment/tax evidence, and rejection→requester rework. Role changes used actual sign-ins, not impersonation. No identities or credentials are reproduced here.
- Used agent-browser core/dogfood, impeccable **critique** and **audit** guidance, taste's forbidden-pattern/pre-flight checks and ui-ux-pro-max review guidelines. This is rendered Discover, not a mockup approval or a regression-suite result.
- Oracles: `DESIGN.md` (identity, one-blue hierarchy, state truth, mobile table cards and actionable next steps); `docs/jtbd.md` §2 (procurement P1–P4, unified approvals, company context); `docs/product-expectations.md`; withholding specification/decisions. Prior-art sweep for withholding confirms the separate monthly-register work is tracked in **#898**.
- Five lenses: **L1** visual consistency; **L2** best practice/accessibility; **L3** effort; **L4** intuitive workflow/IA; **L5** guidance/localized labels. Findings state the role, task and wrong outcome rather than treating every document preference as a defect.
- Desktop **1440×900**, phone **390×844**; light/dark; English/Bahasa changed through **Profile & preferences**, not browser-language emulation. Procurement list/board and raise form were inspected across both viewports/themes/locales. Approvals, company defaults, invoice ledger and slip details were inspected in representative combinations; not every lifecycle mutation was repeated in all eight presentation combinations.
- This run exercised **PMO-native** purchasing. It is **not** evidence that ERP-connected payment posting, mirrored paid detection, statutory filing, currencies other than USD, or all approval kinds' write operations work. Expense/customer-invoice inbox placement was reviewed without deciding another reviewer's records.
- Accessibility assessment is visual/DOM/interaction evidence, **not WCAG certification**. Visible focus, accessible field names and Escape dismissal were inspected. No axe/performance trace or exhaustive keyboard/screen-reader traversal was run. Slip amount-mismatch validation was rendered; transport failures, stale-write conflicts and unavailable ERP feeds were not artificially induced.
- Browser automation retries, off-screen clicks and stale references are excluded as app findings. The earlier suspicion that saved vendor defaults did not prefill was **retracted**: after a verified save and reload, VAT 11% and PPh 23 at 2% correctly produced 11 and 2 on a 100 bill. A blank nominal-rate field does not mean the suggested VAT amount failed.

**Evidence root** — every screenshot basename below resolves under:

`/private/tmp/claude-502/-Users-ariefsaid-Coding-PMO/abd5a194-c2a4-469e-b763-f2a75f07ec08/scratchpad/disc-c/`

**Evidence caution:** filenames are not the oracle. Use the pictured state. Some early `vendor-bills-*` captures show the case overview, not its ledger; the `vendor-bills-confirmed-*` captures explicitly show Documents. The late `approvals-finance-1440-light-id.png` rendered English, so it is **not** Bahasa proof; `approvals-finance-390-dark-id.png` is verified Bahasa. Shared account preferences changed during concurrent discovery. `slip-record-error-390-light-en.png` is not a confirmed application error and is not used as a defect.

## Impact-ranked top 10 fixes

| Rank | Finding | Impact / fix | Severity | Effort |
|---|---|---|---|---|
| 1 | UXD-C-001 | Reconcile request/commitment totals with captured lines before asking for spend authority. | High | M |
| 2 | UXD-C-004 | One truthful settlement path: payment amount, invoice link and paid state must agree with the case. | High | L |
| 3 | UXD-C-005 | Make “Select Quote” open the actual bid decision, not manufacture a selected stage. | High | M |
| 4 | UXD-C-006 | Resolve vendor prerequisites visibly; never offer a silent withholding action. | High | M |
| 5 | UXD-C-007 | Include all eligible approval kinds in one count/filter/preview model; keep entity-specific decisions. | Med | L |
| 6 | UXD-C-008 | Connect complete receipt evidence to the receipt decision; avoid two competing entry points. | Med | M |
| 7 | UXD-C-009 | Correct rejection/rework semantics and collect an explanation in the return decision. | Med | S–M |
| 8 | UXD-C-002 | Capture request lines before initial submission without forcing an empty-draft detour. | Med | M |
| 9 | UXD-C-010 | Finish the already-planned supplier/period withholding register, with explicit coverage exceptions. | Med — roadmap | L |
| 10 | UXD-C-011 | Localize the complete task, not just the shell and tabs. | Med | M |

High = important task-trust/completion issue, fix before accepting this money workflow. Med = material friction or guidance/job gap. Low = bounded improvement. S/M/L are relative implementation sizes, not time estimates. No Critical security finding is asserted by this UX report.

## Real jobs and effort

**Counting convention:** S = distinct work surfaces (page, tab or modal); C = semantic activations, including select choices, excluding field focus, scrolling, login/theme changes and automation retries; F = typed fields; D = necessary domain decisions. Starts/ends are named below. `≥` marks a lower bound where the initial walk did not retain every activation. ERP minimum is a **proposed ERP-shaped task floor**, not measured SAP/ERPNext performance. It retains approval authority, evidence, reasons, tax confirmation and reconciliation; it does not save clicks by deleting safeguards.

| Role / job; start → goal | Observed S / C / F / D | ERP-shaped floor S / C / F / D | Outcome / excess effort |
|---|---|---|---|
| Engineer: project list → submit one priced request | 6 / 8 / 4 / 6 | 4 / 5 / 4 / 6 | Project→Procurement→raise→empty draft Overview→Line items→submit. Project was prefilled; title, description, quantity and price typed; category selected. Save-empty + tab + add-before-submit add 3 activations. |
| PM: inbox → inspect and approve one request | 3 / 3 / 0 / 1 | 3 / 3 / 0 / 1 | Select→Approve→confirm is reasonable for spend. The problem is the **$0** decision context, not the confirmation count. |
| PM: approved case → quotation-selected stage | 1 / 2 / 0 / 0 | 2 / ≥3 / ≥2 / ≥1 | Request Vendor Quotes→Select Quote succeeded with no quotation. Fewer clicks here mean the sourcing decision was not done. Later quote capture does not justify the earlier stage. |
| PM: case → add one quotation | ≥2 / ≥5 / 1 / ≥2 | 2 / ≥5 / 1 / ≥2 | Open Vendor quotes→Add quotation→choose vendor→save; amount is typed, vendor is selected. Real bid capture exists and should be the canonical doorway. |
| PM: selected/approved case → PO issued | 1 / 1 / 0 / 1 | 1 / 1 / 0 / 1 | Fast direct issue path exists. Approved→PO is an intentional quote bypass; do not forbid it merely to force a wizard. Label skipped evidence honestly. |
| Receiver: PO case → complete delivery recorded and case Received | 2 / 4 / 1 / 1 | 2 / 3 / 1 / 1 | Record receipt→save→confirmation, then separate Confirm Receipt. Delivery-note ref typed. Receipt evidence alone leaves the case at PO. |
| Finance: Received case → captured vendor invoice | 2 / ≥5 / 4 / ≥3 | 2 / ≥3 / 2 / ≥3 | Reference, amount, VAT rate and withholding amount typed; PPh type selected. Verified vendor defaults later eliminate rate/withholding re-entry while preserving review. |
| Finance: invoiced case → “Paid”, primary action | 2 / 2 / 0 / 1 | 2 / ≥3 / ≥1 / ≥2 | Mark Paid→confirm creates a misleading zero-valued result on the first new case. No settlement amount/date/reference decision in this doorway. |
| Finance: invoiced case → capture linked payment, then mark Paid | 3 / 5 / 2 / 2 | 2 / 3 / 2 / 2 | Capture Payment→select invoice→save→Mark Paid→confirm. Payment 1,090 remains **Scheduled** while case says **Paid**. |
| Finance: invoice → record a single-bill issued slip | 2 / 2 / 3 / 4 | 2 / 2 / 3 / 4 | Starting bill, date, period and known PPh type prefilled; number/base/issued amount typed. Correctly succeeds once vendor is present. |
| Finance: invoice → record one slip covering two cases | 2 / 3 / 3 / 5 | 2 / 3 / 3 / 5 | Open→select other bill→save. 20+10=30 reconciled; deliberate 31 mismatch blocked. Effort is already low; bill recognition is weak. |
| Finance: open slip → correct its number with reason | 2 / 2 / 2 / 1 | 2 / 2 / 2 / 1 | Correct metadata→save; number and correction reason captured; history retains the original. |
| Finance: open slip → void PMO entry with reason | 2 / 2 / 1 / 1 | 2 / 2 / 1 / 1 | Void→confirm; reason required, coverage released and history retained. Do not remove this safety step. |
| PM/requester: submitted case → reject → return to draft | 2 / 3 / 0 / 2 | 2 / 3 / 1 / 2 | Reject→confirm, requester Rework. The terminal warning is false and the successful reasonless rejection gives no revision target. |
| Finance: existing vendor record → save tax defaults | 1 / 2 / 2 / 3 | 1 / 2 / 2 / 3 | Enter VAT/PPh rates, select type, save; reload proves persistence. Navigation to the directory, not the card itself, needs work. |
| Finance: month-end → reconcile all suppliers/slips for period | Not completable in visible UI | 2 / ≥3 / 0 / ≥2 | Invoice-scoped histories work. No global period/coverage workspace was found in rendered navigation or the checked route surface; #898 owns this planned capability. |

### Walk results worth retaining

- New request A: two units at 125, total **250** in Line items; inbox total/budget **0**. Empty quoting stage advanced to Quote Selected; a 250 quote was added afterward. Complete receipt document did not itself advance the case. Invoice base 250, VAT 11%, PPh 5 was captured; Mark Paid confirmed **0** and showed a zero payment. Vendor remained unset.
- New request B: base **1,000**, VAT **110**, PPh **20**, net **1,090**. Single-bill slip recorded, number corrected with reason, then voided with reason. A payment for 1,090 linked to its invoice was captured. Mark Paid still confirmed 0; afterward the case was Paid while that payment remained Scheduled and the invoice remained Received.
- New request C: second bill from the same review-owned vendor, base **500**, VAT **55**, PPh **10**. Batch slip covered B+C: base entered from external evidence, withheld **30**. Entering 31 visibly disabled save and explained the exact mismatch. Linked-bill navigation opened the other case's Documents route while retaining the slip context.
- New request D: rejected from PM detail without a note, then requester Rework returned it to Draft despite “terminal/cannot be undone” confirmation. Subsequent re-submission/approval provided a fresh invoice-entry state for the verified-defaults check.

## Findings

### UXD-C-001 — New lines do not become trustworthy approval/commitment money

**Route/source:** `/procurement/:id` Line items/Overview; `/approvals`; `pmo-portal/pages/Approvals.tsx` QueueButton reads `row.total_value`; `pages/approvals/ProcurementApprovalRow.tsx`; `pages/ProcurementDetails.tsx` moneyContext/tiles. **Evidence:** `request-lines-1440-light-en.png`, `approvals-request-1440-light-en.png`, `vendor-invoice-defaults-computed-1440-dark-en.png`.

**Lenses:** L2/L3/L4. **Severity/effort:** High / M. **Job violated:** JTBD P3/P4, know budget impact before committing spend. Engineer enters 2×125 and submits; PM sees 250 line evidence but **0** in queue, total and budget impact. Later cases reproduce 0 against 1,000/500 priced requests. Reload does not repair it. Zero is presented as a monetary fact, not unavailable data.

**Fix:** reconcile the authoritative estimate and request/PO commitment projection when lines are saved/submitted; make the preview, tiles, confirmations and budget signal consume the same basis. Preserve unknown distinctly from genuine zero. Do not simply substitute invoice net into every procurement-stage amount. **New copy EN:** “Request estimate unavailable. Review the line items before approval.” **ID:** “Perkiraan nilai permintaan belum tersedia. Tinjau rincian item sebelum menyetujui.” This is a fallback, not a replacement for fixing reconciliation.

**Test pin:** proposed curated create→lines→submit→different approver journey, assert 250 after reload in queue/preview/budget; extend `pages/ProcurementDetails.test.tsx` and approval-preview tests for genuine-zero versus unavailable. Add `/approvals × authoritative request money` and `/procurement/:id × commitment basis` portfolio cells.

### UXD-C-002 — Raise request creates a shell before the requested goods

**Route/source:** project Procurement→raise modal→`/procurement/:id`; `pages/Procurement.tsx`, `pages/ProcurementDetails.tsx`, request modal/line-item components. **Evidence:** `raise-request-1440-light-en.png`, `raise-request-390-dark-id.png`, `request-lines-1440-light-en.png`.

**Lenses:** L3/L4/L5. **Severity/effort:** Med / M. **Job violated:** P1, capture the real purchase request in context. Title/category are saved first; the user lands on Overview and must discover Line items, add the priced goods and submit separately. The explanatory text announces the detour but does not remove it.

**Fix:** allow repeatable request lines in initial capture, with project prefilled and an optional shell draft. Keep quotations later; they are a different decision. Preserve request/approval separation. **EN:** “Save draft” / “Submit for approval”. **ID:** “Simpan draf” / “Ajukan persetujuan”.

**Test pin:** request-form RTL captures title+line and submits together; one cross-stack job asserts the priced request reaches the inbox. `/project/:id → procurement × request creation` portfolio cell; graduate the revised pattern into DESIGN's form guidance.

### UXD-C-003 — Submitted status explains roles but not the actual handoff

**Route/source:** `/procurement/:id`, `pages/procurement/ProcurementDecisionZone.tsx`, `pages/ProcurementDetails.tsx`. **Evidence:** `request-submitted-1440-light-en.png`.

**Lenses:** L3/L4/L5. **Severity/effort:** Med / M. **Job violated:** P1 handoff, understand what happens next. A different eligible user/role explanation and “Pending” do not tell the requester which person/pool currently holds the request. This forces follow-up outside the record.

**Fix:** show actual routing result, submitted time and status adjacent to the stage. If pooled, name the pool; if unassigned, state that rather than inventing an assignee. **EN:** “Waiting for {approver} · submitted {date}” / “View approval status”. **ID:** “Menunggu {approver} · diajukan {date}” / “Lihat status persetujuan”.

**Test pin:** individual/pool/unassigned RTL states, including a real requester who cannot decide their own request. `/procurement/:id × handoff clarity` portfolio cell. Do not introduce an approval bypass to make the status actionable.

### UXD-C-004 — “Paid” is disconnected from settlement evidence

**Route/source:** `/procurement/:id`, `pages/ProcurementDetails.tsx` onActionClick/moneyContext, `pages/procurement/RecordCaptureForm.tsx` payment capture, `pages/procurement/ProcurementLedger.tsx`. **Evidence:** `vendor-payment-form-1440-light-en.png` (confirmation, not capture form), `payment-capture-1440-light-en.png`, `payment-after-capture-confirm-1440-light-en.png`, `payment-after-capture-1440-light-en.png`.

**Lenses:** L2/L3/L4/L5. **Severity/effort:** High / L. **Job violated:** P4, separately release/record the correct payment. Primary Mark Paid confirms **0** with “releases payment”; the first case's payment is 0. In the second walk Finance explicitly captures invoice-linked **1,090** payment evidence, then must use Mark Paid separately. Confirmation is still 0 and the final case is **Paid** while payment is **Scheduled**. These are mutually misleading status/money signals, even without an ERP connection.

**Fix:** define one settlement action based on the selected invoice's payable/outstanding amount, settlement date/reference and ownership mode. Align the case rollup with authoritative invoice/payment states. If capturing only a planned payment, label it as scheduling and do not imply released cash. Preserve separate approver/payer and consequence confirmation. Do not apply the PMO-native transition to ERP-owned payments by analogy.

**EN:** “Record payment” / “Payment amount” / “Payment date” / “Payment reference”; confirmation “Record {amount} paid against {invoice}? This records payment evidence; it does not transfer funds.” **ID:** “Catat pembayaran” / “Jumlah pembayaran” / “Tanggal pembayaran” / “Referensi pembayaran”; “Catat pembayaran {amount} untuk {invoice}? Ini mencatat bukti pembayaran, bukan mentransfer dana.” Use ownership-specific copy for an actual connected release command.

**Test pin:** distinct native and connected curated payment journeys; assert confirmation amount, invoice linkage and final case/payment consistency, including planned/partial settlement. Extend `RecordCaptureForm`/ledger tests; `/procurement/:id × settlement truth` cell. Existing state-transition greens alone cannot prove this job outcome.

### UXD-C-005 — “Select Quote” can claim a selection without a bid decision

**Route/source:** `/procurement/:id`, `pages/ProcurementDetails.tsx` getActions Vendor Quoted→Quote Selected, `pages/procurement/VendorQuotesTab.tsx`. **Evidence:** `quote-selected-empty-1440-light-en.png`.

**Lenses:** L2/L3/L4/L5. **Severity/effort:** High / M. **Job violated:** P2, compare bids and pick one defensibly. Request Vendor Quotes and Select Quote advanced the first new case while Vendor quotes was empty. The header implied a completed sourcing decision that had never occurred. This is not a demand to ban the documented Approved→PO bypass.

**Fix:** stage CTA opens the actual comparison/selection surface; selecting a real bid records the decision and then advances. If the operational path intentionally bypasses quotations, distinguish **skipped** from **completed/selected**. Preserve the comparison implementation already present.

**EN:** “Compare and select a quote”; empty “No quotes recorded. Add a vendor quote to compare bids.” **ID:** “Bandingkan dan pilih penawaran”; “Belum ada penawaran tercatat. Tambahkan penawaran vendor untuk membandingkannya.”

**Test pin:** empty quote stage→CTA cannot fabricate a chosen bid; populated comparison→selection identifies the chosen quote and retains rationale. Extend `ProcurementDetails.selectedQuote.test.tsx`/VendorQuotesTab tests. `/procurement/:id × sourcing decision truth` cell.

### UXD-C-006 — Optional vendor leads to a silent withholding dead end

**Route/source:** `/procurement/:id/documents`, `pages/ProcurementDetails.tsx:1130–1132` renders the recording form only with `p.vendor_id`; `pages/procurement/ProcurementLedger.tsx` offers Record bukti potong. **Evidence:** `slip-no-vendor-click-1440-light-en.png`, `paid-no-vendor-1440-light-en.png`; contrast `slip-record-1440-light-en.png` on the vendor-linked case.

**Lenses:** L2/L3/L4/L5. **Severity/effort:** High / M. **Job violated:** P1 plus slip job story, record external tax evidence for the bill. Vendor was optional at request creation and remained unset through quote capture, invoice and Paid. A visible Record bukti potong button does nothing: fresh visible click produced no dialog and no explanatory alert. This is a verified prerequisite/feedback failure, not an inferred authorization issue.

**Fix:** resolve/confirm the procurement's vendor at the appropriate sourcing/invoice step. When vendor is missing, provide an adjacent recoverable explanation and contextual link; do not leave an enabled no-op or silently infer vendor from an arbitrary quote. Preserve the rule that one slip groups bills of the same vendor.

**EN:** “Select a vendor before recording withholding evidence” / “Set vendor”. **ID:** “Pilih vendor sebelum mencatat bukti potong” / “Tentukan vendor”.

**Test pin:** missing-vendor ledger action opens a visible recovery path; vendor-linked action opens the modal. Extend `ProcurementDetails.test.tsx` and `VendorWithholdingSlipCell.test.tsx`; curate optional-vendor request→invoice→slip recovery. `/procurement/:id/documents × prerequisite remedy` cell; retain DESIGN's honest-doorway rule.

### UXD-C-007 — All-kind approvals are separate islands, not one inbox

**Route/source:** `/approvals`; `pages/Approvals.tsx:37–42,645–667,761–808,829–938`, `pages/approvals/ExpenseClaimApprovalSection.tsx`, `SalesInvoiceApprovalSection.tsx`, procurement preview components. **Evidence:** `approvals-all-kinds-1440-light-en.png`, `approvals-pm-1440-dark-en.png`, `approvals-pm-390-dark-en.png`, `approvals-finance-390-dark-id.png`.

**Lenses:** L1/L3/L4/L5. **Severity/effort:** Med / L. **Job violated:** unified-inbox JTBD, preview/decide without drilling around. The main queue's scope/type model includes procurement and timesheets only. A pending expense appears in a separate region above it, outside All's count; customer invoices use another separate section. Phone switches to expanding sections rather than the desktop selected-item preview. Finance has fewer kinds and no unified scope selector. The role-specific eligible set should differ; the concept of “All waiting on me” should not.

**Fix:** aggregate eligible kinds into one queue model/count/filter, with consistent preview-before-drill-in and entity-specific actions. Mobile can use an expandable preview, but preserve selected item/scope and count semantics. Move approved-reopen work behind a separate view so it does not outrank pending authority.

**EN:** “All pending” / “Purchase requests” / “Timesheets” / “Expense claims” / “Customer invoices” / “Approved · reopen for correction”. **ID:** “Semua yang menunggu” / “Permintaan pembelian” / “Timesheet” / “Klaim biaya” / “Faktur pelanggan” / “Disetujui · buka kembali untuk koreksi”.

**Test pin:** mixed-kind fixtures assert count=sum of all currently eligible pending kinds, with no duplicate items; same selected context across viewport changes. Extend Approvals tests plus curated mixed-inbox preview journey, retaining each kind's authority rules. `/approvals × all-kind completeness`, `× preview parity` cells.

### UXD-C-008 — Complete receipt evidence and receipt progression compete

**Route/source:** `/procurement/:id`, `pages/ProcurementDetails.tsx` receipt actions, `pages/procurement/ProcurementDecisionZone.tsx`, `RecordCaptureForm.tsx`. **Evidence:** `gr-recorded-po-stage-1440-light-en.png`.

**Lenses:** L3/L4/L5. **Severity/effort:** Med / M. **Job violated:** P1, capture real GR and move the case forward on the same page. Saving and confirming a **Complete** receipt creates its record but leaves PO stage unchanged. The receiver must separately choose Confirm Receipt; conversely that CTA can move the case without this delivery evidence. Recording a document versus declaring the stage are different operations, but their relationship is not made clear.

**Fix:** one receipt decision surface shows quantities/status/reference/file and its stage consequence. Offer a clearly named evidence-only save if that is required; complete receipt plus explicit confirmation should not need a second unrelated CTA. Partial receipt must remain distinct and must not falsely complete the case.

**EN:** “Record delivery” / “Save receipt evidence” / “Confirm complete receipt”. **ID:** “Catat penerimaan barang” / “Simpan bukti penerimaan” / “Konfirmasi penerimaan lengkap”.

**Test pin:** partial/full/evidence-only component cases; curated full receipt yields the intended record+stage and partial receipt remains partial. `/procurement/:id × receipt evidence/progression consistency` cell. Preserve a legitimate missing-file exception rather than forcing fictitious uploads.

### UXD-C-009 — Rejection claims finality, but rework is supported

**Route/source:** `/procurement/:id`; `pages/ProcurementDetails.tsx:190–193,579–605` shares terminal confirmation text, `pages/procurement/ProcurementDecisionZone.tsx:225–253` hides optional Notes behind Add a note. **Evidence:** `reject-confirm-1440-dark-en.png`, `rejected-requester-1440-dark-id.png`, `reworked-draft-1440-dark-id.png`.

**Lenses:** L2/L4/L5. **Severity/effort:** Med / S–M. **Job violated:** P4 decision→P1 revision handoff. Reject dialog says terminal/cannot be undone. The requester can then Rework to Draft and resubmit. Rejection also succeeds with no reason; a note facility exists before the dialog, but the rejection decision does not prompt it and the requester is left guessing what to change. “Ready to advance” is not rejection-specific guidance.

**Fix:** distinguish return-for-revision from genuinely terminal cancellation; tell the requester the next step and surface a reason in the decision dialog. Decide whether a reason must be mandatory as product policy rather than inventing a new authority rule. Do not remove supported rework merely to make the warning true.

**EN:** “Return for revision” / “Explain what needs changing” / “The requester can revise and resubmit.” **ID:** “Kembalikan untuk revisi” / “Jelaskan bagian yang perlu diubah” / “Pemohon dapat merevisi dan mengajukan kembali.”

**Test pin:** rejection/return wording matches transition semantics; requester sees entered explanation and can rework; no terminal copy for reversible return. Extend `ProcurementDetails.terminal.test.tsx` and notes/confirmation tests. `/procurement/:id × recovery semantics` cell.

### UXD-C-010 — Monthly withholding reconciliation has no user workspace yet

**Route/source:** rendered Procurement/Finance navigation and invoice-scoped history in `/procurement/:id/documents`; `pages/ProcurementDetails.tsx:1253–1261`, `src/hooks/useVendorWithholdingSlips.ts:53–61`, `src/components/shell/routeMatch.ts`, `docs/specs/vendor-withholding-slip.spec.md §3/§6`. **Evidence:** `slip-register-history-1440-light-en.png`, `vendor-bills-confirmed-1440-light-en.png`, `slip-batch-detail-1440-dark-id.png`.

**Lenses:** L3/L4/L5. **Severity/effort:** Med / L, **planned job gap, not a #911 regression**. **Job violated:** slip job story, reconcile the monthly register without duplicate counting or opening ERPNext. Current history is filtered to one bill; it is useful for investigation but cannot answer “which suppliers/periods remain uncovered?” across cases. Rendered rail/palette and checked procurement/route components supplied no global tax-register screen. The #911 spec explicitly excludes building it and hands it to **#898**.

**Fix:** implement the existing #898 handoff with one canonical Finance tax workspace; group currency/type correctly, distinguish active/void/review/unavailable coverage, and drill back to bill/case. Do not turn invoice history into a second competing register or sum a batch slip once per linked bill.

**EN:** “Vendor withholding register” / “Tax period” / “Missing slip” / “Needs review”. **ID:** “Register bukti potong vendor” / “Masa pajak” / “Belum ada bukti potong” / “Perlu ditinjau”.

**Test pin:** #898 acceptance on two-bill slip counted once, voided-only/uncovered and review exceptions, period/currency grouping, drill/back context. Future `/tax-register × monthly completeness` cell; retain the existing #911 data grain decision, not a new ADR.

### UXD-C-011 — Bahasa stops halfway through the purchase job

**Route/source:** `/procurement`, raise modal, `/procurement/:id`, `/approvals`; `pages/Procurement.tsx`, procurement form/line-item/decision components, `pages/Approvals.tsx`, `pages/approvals/ProcurementApprovalRow.tsx`, locale resources. **Evidence:** `raise-request-390-dark-id.png`, `request-lines-1440-dark-id.png`, `approvals-finance-390-dark-id.png`, `procurement-board-390-light-id.png`.

**Lenses:** L1/L2/L3/L5. **Severity/effort:** Med / M. **Job violated:** P1/P3/P4, understand the real gate and budget decision. In verified Bahasa, the shell/list tabs localize but Raise a purchase request, Title/Project/Vendor, routing helper, Create request, line-table instructions, Board, Requested and much budget explanation remain English. Technical PR/PO/PPh abbreviations can remain; task verbs and consequences should not require code-switching. Slip detail and company-default copy are notably more complete.

**Fix:** audit complete task paths against the locale manifest, including placeholders, headers, helper/error text, confirmation and status labels. Translate raw enum presentation consistently without translating persisted values. Keep account number convention distinct from language.

**EN→ID:** “Raise a purchase request”→“Ajukan permintaan pembelian”; “Title”→“Judul”; “Budget category”→“Kategori anggaran”; “Create request”→“Buat permintaan”; “Budget impact”→“Dampak pada anggaran”; “Board”→“Papan”; “Requested”→“Diajukan”.

**Test pin:** locale-focused RTL assertions for the above literal leaks, plus two presentation snapshots (390 dark ID, 1440 light ID) with no user data in fixture labels. `/procurement × task locale completeness`, `/approvals × budget locale` cells. Do not use screenshot filenames as locale assertions.

### UXD-C-012 — Supplier defaults depend on a CRM-shaped doorway

**Route/source:** `/companies/:id`, Finance rail and command palette; `src/components/shell/Rail.tsx:70–76` Companies belongs to CRM, `src/components/shell/routeMatch.ts:65–78`, `pages/company/VendorTaxDefaultsCard.tsx`. **Evidence:** `vendor-tax-defaults-persisted-1440-dark-en.png`, `vendor-invoice-defaults-computed-1440-dark-en.png`.

**Lenses:** L3/L4/L5. **Severity/effort:** Med / S–M. **Job violated:** Finance/company JTBD, manage vendor context. In this rendered configuration Finance can set vendor tax defaults, but Companies is absent from its visible rail. It is reachable in the command palette and through linked vendors, so this is **discoverability**, not “unreachable” or a permission defect. A new supplier setup job should not depend on knowing that vendor master data sits under generic CRM Companies.

**Fix:** provide a Finance/Procurement supplier-directory doorway to the canonical company entities, independent of unrelated CRM navigation. A Vendors filter/view is sufficient; do not duplicate records/routes or introduce a second vendor master. Link it from vendor selection where permitted.

**EN:** “Vendors” / “Manage vendor defaults”. **ID:** “Vendor” / “Kelola default pajak vendor”.

**Test pin:** rendered navigation test for purchasing enabled with CRM navigation absent; Finance can reach vendor setup through an ordinary task entry point. Existing Companies detail remains canonical. `/companies/:id × vendor setup discoverability` cell.

### UXD-C-013 — Slip candidate rows expose database identity instead of recognition cues

**Route/source:** slip record modal, `pages/procurement/VendorWithholdingSlipModal.tsx:76–81`. **Evidence:** `slip-batch-1440-light-en.png`, `slip-batch-mismatch-1440-light-en.png`.

**Lenses:** L1/L3/L4/L5. **Severity/effort:** Med / M. **Job violated:** slip job, select the right bills from the external issued document. Two candidates display system VI numbers plus a long raw case UUID and date; external invoice references/request titles are not shown. Finance holding supplier references has to cross-check elsewhere. The exact-match footer is excellent but only proves amounts, not intended bill recognition.

**Fix:** display external invoice reference + system VI number, readable case title/project and date. Keep immutable IDs for linkage, not the primary human label. Add search by those identifiers when candidate volume warrants it, preserving stable paging and selections.

**EN:** “Vendor invoice reference” / “Request” / “Search eligible bills”. **ID:** “Referensi faktur vendor” / “Permintaan” / “Cari tagihan yang memenuhi syarat”.

**Test pin:** `VendorWithholdingSlipModal.test.tsx` shows both references/title and preserves selected bills across pages; a two-case journey chooses by external reference, not UUID. `/slip capture × bill recognition` cell.

### UXD-C-014 — Phone procurement puts toolbar work before purchase work

**Route/source:** `/procurement` mobile list/board; `pages/Procurement.tsx`, shared toolbar/board and lifecycle presentation. **Evidence:** `procurement-board-390-light-en.png`, `procurement-board-390-light-id.png`, `procurement-390-light-en.png`, `vendor-invoice-defaults-computed-390-dark-en.png`.

**Lenses:** L1/L3/L4. **Severity/effort:** Low / S–M. **Job violated:** P1, find the case/next phase quickly. In the verified phone board the first work card begins around y=550 after explanatory copy, status strip, search, Export/Import/Import cycle data and view switch. Only the first pipeline lanes fit; invoice/payment work requires horizontal exploration. Case detail similarly starts its mini-pipeline at PR even when the current job is invoice entry. Horizontal boards are not inherently wrong, but mobile work prioritization is weak.

**Fix:** use the existing mobile-toolbar convention: status/search/view prominent, rare import/export in overflow; offer jump-to/current-stage positioning while preserving the full pipeline and an accessible scroll hint. Do not remove downstream stages merely to fit the phone.

**EN:** “More actions” / “Jump to stage” / “Scroll to see all stages”. **ID:** “Tindakan lainnya” / “Lompat ke tahap” / “Geser untuk melihat semua tahap”.

**Test pin:** phone visual regression plus keyboard/touch access to late stages and overflow actions; `/procurement × phone work prioritization` cell. Retain the chosen board mode and current filter across drill/back.

## Strengths and lens assessment

| Lens | Strengths observed | Issues / assessment |
|---|---|---|
| **L1 Visual consistency** | Token-led neutral surfaces, restrained blue, readable data hierarchy, good dark slip detail; no generic gradients or invented aesthetic. Ledger becomes labeled cards on phone. | Important: inconsistent approval presentation by kind (007), mixed-language interface (011). Minor: tall phone toolbar/hidden current stage (014), raw identity noise (013). Preserve DESIGN, do not redesign the brand. |
| **L2 Best practice/accessibility** | Required slip fields named; reconciliation difference announces feedback; visible focus ring; mobile bill checkboxes enlarged; modal Escape dismissal worked. | Important: silent vendor prerequisite (006), contradictory financial/terminal state communication (001/004/009). Full WCAG/performance conclusions remain unverified. |
| **L3 Effort** | Contextual project prefill, inline approval preview, vendor defaults, one modal for multi-case slip, metadata correction and reasoned void are efficient. | Empty-draft and receipt/payment double paths (002/008/004); all-kind inbox/regrouping and bill identity cross-checks (007/010/013). Retain warranted confirmations. |
| **L4 Intuitive workflow / IA** | One case gathers records; bid comparison exists; linked slip bills open canonical case Documents with query context; company records remain canonical. | Stage labels outrun evidence (005/008), payment rollup contradiction (004), approval/register/supplier home mismatches (007/010/012). |
| **L5 Guidance/localized labels** | Slip explicitly records an externally issued document; void explicitly concerns the PMO entry; default-tax suggestions name their rate/basis; reconciliation says what to fix. | Actual approval handoff unnamed (003), reason/finality guidance mismatched (009), task translation incomplete (011), vendor prerequisite unexplained (006). |

**Role-review battery alignment:** Lens A (Visual) strengths are token identity/focus/mobile cards; Important issues 001/004/006/011 and Minor 014, no new-aesthetic recommendation. Lens B (IxD) strengths are prefill/inline preview/slip batch capture; Important issues 002/007/008/009/013. Lens C (IA) strengths are canonical case/company URLs and linked bill drill-in; Important issues 007/010/012. Lens D (Intent) uses JTBD P1–P4 and the slip story: Important issues 001/003/004/005/006/008. No Critical issue is declared. The findings above supply route, violated job, evidence and suggested fix; this read-only run has **no after-fix screenshots** and makes no claim that fixes passed.

## Cross-area patterns / Director handoff

1. **Truthful money before cosmetic polish.** Header/child/rollup discrepancies can look polished while breaking decisions. Other areas should pin authoritative amount/basis and unavailable-versus-zero, not snapshot a number merely because it renders. Graduate 001/004 into reconciliation tests and the decisions retention KB.
2. **One operational decision, one honest doorway.** “Record” versus “advance” needs explicit semantics. The vendor-invoice flow already combines evidence capture and stage change; receipts/payments/quotation selection should achieve comparable clarity without flattening legitimate partial/evidence-only cases.
3. **All means all eligible pending work.** Share count, scope and preview semantics across procurement/timesheet/expense/customer invoice. Keep permission/authority decisions entity-specific. Coordinate 007 with the expense/invoice discovery owner instead of filing duplicate fixes.
4. **Master data follows the job, not its historical module label.** Vendors are required purchasing context even when CRM navigation is not in use. Add a canonical filtered doorway, not another supplier entity. Coordinate 012 with global navigation discovery.
5. **Task-complete localization.** Locale checks must cover the action's prerequisites, validation, state and confirmation, not just H1/navigation. Share 011's path-level oracle with all areas; do not normalize away legitimate technical abbreviations.
6. **Recognizable references, immutable links.** External supplier invoice number, system VI number and human case/project title should coexist. Raw UUIDs are not useful recognition cues. Apply 013's pattern to other financial evidence selectors.
7. **Record-local evidence is not a monthly workspace.** Preserve #911's successful capture/correct/void flow. #898 should provide the missing cross-case overview using its existing two grains; no new withholding schema or statutory issuance promise is proposed here.
8. **Phone prioritization is a separate task lens.** Keep rare administration/import tools accessible but subordinate to current work. Preserve stage context across desktop↔phone and drill/back rather than treating smaller width as a different product.

### Graduation and completion

- Findings are proposals, **not new passing tests**. For each accepted item: follow-up ui-implementer writes the owning test, adds the route×oracle cell and a DESIGN/decisions retention note, implements, then re-renders the same named evidence state. Use existing decisions for planned work; no duplicate ADR for #898 or the canonical-company seam.
- Retain the successful single/multi-bill slip, exact mismatch, metadata-history, reasoned void, linked-bill and verified-defaults outcomes as regression oracles. Do not “fix” them by removing confirmation, reconciliation or reason capture.
- Only this review document was authored by Area C. Other concurrently appearing Area A/B/D documents were not changed. No commit or push. Session **disc-C** was closed; no other browser session or application server was closed.

DISCOVER-C-DONE

## Director verification (2026-10-10)

The three money-path suspects were checked against the database functions at head; all three are real.

- **UXD-C-001 — confirmed.** Approval routing uses `procurement_request_amount()` = greatest(`total_value`, Σ line amounts). Nothing rolls line amounts into `procurements.total_value`, and the screens (approval queue, detail tiles, confirm dialogs, reserved/committed spend) read the raw `total_value`. A request priced only through its lines is routed on its real amount but shown, and counted in budget spend, as 0.
- **UXD-C-004 — confirmed.** `transition_procurement` → Paid inserts a Paid payment of `total_value` only when no payment exists. If Finance already captured a Scheduled payment, it stays Scheduled while the case reads Paid; if the request was line-priced, the inserted payment is 0. The "releases payment" confirm copy is also wrong for PMO-owned payments (nothing is transferred).
- **UXD-C-005 — confirmed.** `transition_procurement` allows Vendor Quoted → Quote Selected with no quote selected; only `select_procurement_quote` records a bid. The status button bypasses it.

These are money-path fixes (Director-dispatched), ranked ahead of every visual slice.
