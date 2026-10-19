# Library adoption census and migration portfolio — 2026-10-19

**Decision:** [ADR-0089](../adr/0089-headless-ui-foundation.md): use **`@base-ui/react@1.8.0`**, already resolved through BlockNote, behind the existing PMO facades. No application/package/test changes in this deliverable. Do not replace native controls or product logic merely to increase library usage.

## 1. Scope, counting and evidence

Snapshot: `f72bb815877b8ae82943bcf62f58e261b174cb45`, branch `claude/v024-lib-audit`. `gh repo view --json visibility` returned PUBLIC. This document contains UI/maintainability findings, not an assessment of access controls or infrastructure.

The denominator is **742 production `.ts`/`.tsx` files**: `src/components` 179; `components` 17; `pages` 119; `src/hooks` 92; `src/lib` 335. Exclude `__tests__`, `__fixtures__`, `testing`, and `*.test.*`, `*.spec.*`, `*.test-helpers.*`. The original 1,946-path sweep included tests and other files. All five roots were enumerated, not a sample of prominent widgets. A TypeScript AST walk checked JSX/opening attributes and call expressions, avoiding commented-out markup. The complete native/date/event site registers below make the inline denominator explicit. DAL/repositories, integration adapters and business calculations were classified as domain code rather than interchangeable widgets; their generic pagination/timeout/rate-limit seams are included.

**Inventory unit:** an implementation family with a common engine/API, not an individual rendered instance or business entity form. Every family has a `LIB-###`, an implementation/site count **N**, source line counts, a grep caller count **C**, evidence and verdict. Multi-source families enumerate their members; shared source LOC is not counted twice as code removed. Inline occurrences inherit their family's ID; their full register is below, not a top-N list. Aggregate counts count families, not DOM instances.

**C is a lexical grep caller-candidate count, not a dynamic call graph.** Search production TS/TSX throughout `pmo-portal`, not only the five inventory roots; exclude tests, fixture helpers, e2e and `index.ts`/`index.tsx` barrels, plus the defining file(s). Count distinct files matching the named symbol; comments/type references can overcount, aliases can undercount. `C=internal` means the inline implementation is used within its enclosing source, not exported independently. For grouped rows, per-symbol counts are given instead of adding overlapping caller sets. This makes counts reproducible and avoids pretending that 58 reference files are 58 independent runtime mounts.

Example (repo root; change symbol/defining path for other rows):

```bash
rg -l -w ConfirmDialog pmo-portal -g '*.{ts,tsx}' \
  -g '!**/__tests__/**' -g '!**/testing/**' -g '!**/__fixtures__/**' \
  -g '!**/e2e/**' -g '!*.test.*' -g '!*.spec.*' -g '!*.test-helpers.*' \
  -g '!index.ts' -g '!index.tsx' -g '!ConfirmDialog.tsx' | wc -l
# 58
wc -l pmo-portal/src/components/ui/ConfirmDialog.tsx
# 314
```

Paths below are **relative to `pmo-portal/`**. `path:line (LOC)` identifies the deciding implementation, not a test/report that claims it exists. Evidence labels: **D** = deterministic source-level defect with a named user outcome; **R** = composition/scaling risk requiring a regression or browser probe, not a reproduced defect; **OK** = bounded, useful implementation worth retaining. No full-app render was performed, and unsupported RTL is a compatibility risk, not a claim that a current user workflow fails.

Verdicts:

- **U** = **ALREADY-INSTALLED-UNDERUSED → `@base-ui/react@1.8.0`**, unless another exact engine is written explicitly. Promote to an exact direct dependency; migrate behind the facade. U includes the generic machinery duplicated despite the available engine.
- **K** = **KEEP**, with rationale. Existing library-backed adapters are kept when already thin; they are not automatically called underused.
- **A** = **ADOPT `<package@exact-version>`**, a genuinely new library. No row needs A in this portfolio: the missing foundation is already transitive.

## 2. Exhaustive implementation-family inventory

### Overlays (10 families)

| ID | Implementation; N; source and LOC | C (symbol unless stated) | Evidence / user impact | Verdict |
|---|---|---:|---|---|
| LIB-001 | ConfirmDialog; N=1; `src/components/ui/ConfirmDialog.tsx:88` (314) | 58 | OK Cancel-first focus, restore fallback, real dialog/alertdialog, phone sheet. R document Escape at :88 and local trap at :140 duplicate stack ownership; a nested picker/form needs one topmost dismissal owner, not two handlers. | U — Dialog/AlertDialog; retain all decision/loading/phone contracts |
| LIB-002 | EntityFormModal; N=1; `src/components/ui/EntityFormModal.tsx:156` (431) | 47 | D Escape in its portalled Combobox bubbles to the document listener at :158–164, which does not check `defaultPrevented`; closing a picker also asks to discard/closes the form. R trap :257–274 scans only dialog descendants, while picker content lives in a body portal. OK submit-only focus and persistent save-error behavior :220–253 must survive. | U — Dialog, not a form redesign |
| LIB-003 | Drawer; N=1; `src/components/ui/Drawer.tsx:97` (269) | 8 | OK trigger return, nested suspension and tokened portal. R each consumer must correctly set `nestedOpen`; custom trap :146–168 and right-edge skin :179–200 duplicate engine and physical direction assumptions. | U — Dialog with current drawer skin |
| LIB-004 | ReceiptPreview; N=1; `src/components/ui/ReceiptPreview.tsx:35` (97) | 2 | OK named portal, Escape and restore, async stale-result guard, download fallback. R document-level keys :41–51 plus native PDF iframe :92 require browser proof; iframe key events do not bubble out of the document. | U — Dialog only; keep URL retrieval and fallback |
| LIB-005 | AIComposerModal; N=1; `src/components/builder/AIComposerModal.tsx:55` (233) | 3 | OK dialog naming and error status. R separate portal/focus/Escape lifecycle :55–83, :134–155; duplicated interaction ownership as parent dialogs are migrated. | U — Dialog shell; composer request state stays |
| LIB-006 | ImportWizard; N=1; `src/components/import/ImportWizard.tsx:59` (405) | 2 | OK scroll body/footer and committing lockout; R independent document keys/focus loop :59–103 plus portal :106 require nested-toolbar testing. | U — Dialog; preserve wizard state and progress |
| LIB-007 | ProcurementCycleImportWizard; N=1; `src/components/import/procurementCycle/ProcurementCycleImportWizard.tsx:78` (592) | 1 | R copies wizard modal ownership :78–125; product-specific grouping/commit UI is not generic widget debt. | U — Dialog shell only |
| LIB-008 | AppShell mobile rail; N=1; `src/components/shell/AppShell.tsx:151` (366) | 11 (AppShell references) | OK responsive dialog and focus return. R body overflow :181–186 unconditionally clears a shared global; closing one of two modal surfaces can unlock the other. Rail layer :314 is 60 versus form layer 800. | U — mobile Dialog; desktop rail remains layout |
| LIB-009 | Assistant mobile sheet; N=1; `src/components/panel/AssistantPanel.tsx:300` (720) | 13 (AssistantPanel references) | OK desktop complementary/nonmodal vs mobile dialog; keep-mounted transcript. R overflow :347–352 and manual background mutation :359–366 compete with shell/form modal owners. | U — mobile Dialog; never make desktop companion modal |
| LIB-010 | Inline Set-vendor dialog declaration; N=1; `pages/ProcurementDetails.tsx:1075` (1283) | internal=1 enclosing page | R inline editor is labelled `role=dialog` inside normal flow, not a popup; decide its actual region semantics in a regression before changing it. No library needed to render a small inline form. | K — product inline editor; do not convert it to a modal |

### Menus, search, popups and tooltips (8 families)

| ID | Implementation; N; source and LOC | C | Evidence / user impact | Verdict |
|---|---|---:|---|---|
| LIB-011 | AccountMenu; N=1; `src/components/shell/AccountMenu.tsx:49` (315) | 1 | OK Arrow/Home/End, Escape restore, Tab exit. R whole-document tab-stop scan :72–95; popup physical `right-0`, no portal :146–157; typing does not navigate menu items. | U — Menu; preserve navigation/theme/role-view callbacks |
| LIB-012 | ProjectStatusControl action picker; N=1; `components/ProjectStatusControl.tsx:70` (297) | 2 | R trigger unmounts when open :171–195; absolute right/z20 menu :190, plain buttons and custom return flags. Keyboard user has Tab but not conventional menu arrow/typeahead behavior. Preserve confirmation before transition and inline win form. | U — Menu for action list; domain win form stays |
| LIB-013 | NotificationBell inbox popup; N=1; `src/components/shell/NotificationBell.tsx:174` (356) | 1 | D focus a notification via Tab then Escape: :181 closes without a trigger focus restore; focused list button unmounts and focus falls out of the popup. R physical right/z50 popup :263–268. OK keyset load-more :144–167. | U — Popover, not Menu; paginated inbox stays |
| LIB-014 | Combobox; N=1; `src/components/ui/Combobox.tsx:193` (448) | 31 | D position captured only on open :195–200: scroll a containing form or resize viewport while open and popup stays at old coordinates. No flip/height collision response near bottom. D child Escape reaches form's document handler (LIB-002). OK stale-load token, clear, return focus, keyboard Home/End. R detached searchbox/trigger semantics, physical left :342 and fixed z820. | U — Combobox/Positioner/Portal; keep lazy source adapter |
| LIB-015 | Comment mention suggestions; N=1; `src/components/comments/CommentsSection.tsx:119` (158) | 2 | R listbox/options contain focusable buttons but textarea has no active-option linkage/arrow selection (:109–136); keyboard user must leave typing flow to choose. Parser :18 supports only trailing mention, intentionally plain text. | U — Autocomplete after multiline/caret compatibility pilot; no rich editor |
| LIB-016 | CommandPalette; N=1; `src/components/shell/CommandPalette.tsx:265` (486) | 9 | D Tab handler :285–289 always refocuses input although Retry is a real button at :364: keyboard cannot reach recovery. D input :324–335 lacks active-descendant linkage to selected option; a screen-reader user cannot identify the arrow-selected result via that relationship. R selected items do not scroll into view; fixed nonportal z950 :303. | U — Dialog + Autocomplete, not cmdk; preserve custom ranking/caps/Ask AI |
| LIB-017 | Tooltip; N=1; `src/components/ui/Tooltip.tsx:60` (108) | 6 (includes Recharts-name matches; verify imports) | D cloned trigger overwrites existing `aria-describedby` :61; prior field description disappears while tooltip opens. D Escape is not handled in :60–77; a focused user's tip remains visible. R pointer-events-none tip :92 and immediate mouseleave mean user cannot move pointer onto long explanation. OK portal, resize/scroll clamp. | U — Tooltip; merge caller description IDs; preserve dark skin |
| LIB-018 | RowMenu inside DataTable; N=1; `src/components/ui/DataTable.tsx:574` (901 whole file) | internal=1; callers use table's rowMenu prop | Already has portal, collision/focus/key machinery. Counted to avoid hiding a generic menu implementation, but **table lane owns it**. | K in this portfolio — excluded; coordinate foundation only after table lane, no table recommendation |

### Tabs, disclosures, notifications and checkbox (8 families)

| ID | Implementation; N; source and LOC | C | Evidence / user impact | Verdict |
|---|---|---:|---|---|
| LIB-019 | Tabs + IDs; N=1; `src/components/ui/Tabs.tsx:87` (169), `tabIds.ts:1` (3) | 6 | OK Home/End and DOM focus movement; route marker must survive. R physical Right/Left advancement :89–102 and right-edge mask :125 are not direction-aware; empty items would access undefined. | U — Tabs, preserve IDs/route navigation/scroll |
| LIB-020 | ViewToggle; N=2 modes; `src/components/ui/ViewToggle.tsx:66` (133) | 17 | D tab-mode arrows change value but never move DOM focus :66–76; after rerender selected tab is tabbable while focus remains on old tab. Hidden options can still participate in the options array. OK toggle mode uses pressed buttons with no invented panel. | U for tabs; K native toggle mode; row classified U |
| LIB-021 | MobileToolbarDisclosure; N=1; `src/components/ui/MobileToolbarDisclosure.tsx:1` (212) | 2 | OK inline region, enabled-first focus, Escape/return, sibling-click protection :133–154. R global active-dialog discovery :52–62 depends on visibility and role; preserve child wizard lifetime and do not make it an absolute popover. | K — product-specific flow/dismissal policy; vendor adoption is not automatically simpler |
| LIB-022 | TaxBasisLabel disclosure; N=1; `src/components/ui/TaxBasisLabel.tsx:43` (105) | 17 | OK stored tax facts/unknowns; expanded/controls, Escape restores and stops bubbling :66–72. Normal inline disclosure, no position/trap engine. | K — product money semantics and small native button/hidden span |
| LIB-023 | Native details; N=14 nodes in 12 files; full register §3 | 1 enclosing caller per site | OK native summary keyboard/expanded behavior, no portals or positioning. R controlled `open` in header and Approvals deserves existing regression retention, not wholesale replacement. | K — browser is the reliable library |
| LIB-024 | Other inline expansion buttons; N=16 sites in 15 files; register §3 | 1 enclosing caller per site | R repeated `aria-expanded` state is not itself a defect. Normal-flow evidence/history/row details are product composition; preserve named controls, hidden-panel relationship and 390px reflow. | K — no accordion exclusivity requirement exists |
| LIB-025 | ToastProvider/View/AutoDismiss; N=1; `src/components/ui/Toast.tsx:63` (278) | 59 (`useToast`, defining file excluded) | OK persistent warning/error, priority queue, pause on focus/hover, empty mounted live regions, modal-safe position. R queue/timer/live-region system :63–259 is a nontrivial generic engine with 59 caller candidates. Stock library queue semantics differ: do not lose remedies or double announce. | U — Toast engine only after compatibility proof; keep product queue policy |
| LIB-026 | Checkbox; N=1; `src/components/ui/Checkbox.tsx:1` (85) | 6 | R custom role/key handlers :50–76 require consumers to wire visible label clicks; DESIGN.md documents the burden. Mixed state is already rendered; native form association and label-click behavior remain caller-owned. Existing disabled/value API remains. | U — Checkbox; keep labels and footprint, test label activation |

### Forms and modal infrastructure (10 families)

| ID | Implementation; N; source and LOC | C | Evidence / user impact | Verdict |
|---|---|---:|---|---|
| LIB-027 | AdministrationFeatures switch; N=1; `pages/AdministrationFeatures.tsx:95` (152) | internal=1 | OK button switch has role/checked and native activation. R primitive ownership duplicated in a page rather than shared engine. | U — Switch when checkbox slice lands; no feature-policy change |
| LIB-028 | useEntityForm; N=1; `src/components/ui/useEntityForm.ts:83` (249) | 33 | OK pure controlled values, blur/submit timing, touched/dirty/reset and analytics. R shallow dirty comparison :205–208 assumes immutable nested values; validation runs for each value change :123. Neither demonstrates a need for RHF in today's small forms. | K — retain API/behavior, no React Hook Form/Formik dependency |
| LIB-029 | FormFields; N=10 exports (FieldError, FieldShell, TextField, NumberField, TextArea, SelectField, FormGrid, FormRow, FormSection, FormActions); `src/components/ui/FormFields.tsx:34` (526) | 76-file union; per export in listed order: 13, 1, 43, 15, 12, 40, 39, 0, 32, 2 (definition excluded) | OK native labels/error IDs, select semantics :378–425. R password reveal tabIndex=-1 :227 prevents keyboard activation; helper ID can remain in describedby while helper is hidden on error :97–103/:122. Keep skin wrappers; characterize these separately rather than replacing all fields. | K — thin native primitives; NumberField is a money draft, not generic spinbutton |
| LIB-030 | Money input mask; N=1; `src/components/ui/useMoneyInputMask.ts:1` (110) | 5 | OK caret-preserving grouping over format seam; no universal input mask library needed. R locale changes/partial decimal/caret are essential regression cases. | K — small product-specific money-draft adapter |
| LIB-031 | Domain forms; N=57 form sites: 48 EntityFormModal invocations plus 9 standalone native form nodes; standalone register §3 | internal=1 per form; 47 modal / 33 form-hook candidates | OK manual state is often staged mutation/line items, not duplicated generic validation. `RecordCaptureForm.tsx:361–408` (877), `PanelEditorForm.tsx:132` (540), `ProjectBudget.tsx:102–119` (1088) exemplify domain state. | K — do not rewrite forms to RHF or copy domain validation into a headless kit |
| LIB-032 | Runtime shape validation; N=2 Zod consumers in scope; `src/lib/agent/widgets/schema.ts:1` (76), `src/lib/db/fxRates.ts:1` (70); manual product parser `src/lib/financialStatements.ts:102` (864) | 4-file union of named value exports (definitions excluded) | OK Zod is already used for structural validation; statements parser checks domain/cross-field/order facts, not just generic object shape. No evidence that converting it reduces bugs without changing accepted inputs. | K — existing `zod@3.25.76` engine where appropriate, no schema rewrite in this lane |
| LIB-033 | Focus trap utility + local copies; N=1 reusable helper plus 7 local traps; `src/hooks/useFocusTrap.ts:23` (41); local source register §3 | 2 for hook; internal=1 per local copy | R selector-only edge wrapping does not model portalled descendants, hidden/inert elements, or focus moved externally. Hook comment claims use by Confirm/Form/Shell, but those implementations have local traps instead. | U — remove copies per migrated surface; no new focus-trap package |
| LIB-034 | Background inert; N=1; `src/components/ui/backgroundInert.ts:20` (32) | 3 (`acquireBackgroundInert`, defining file excluded) | OK idempotent refcount avoids prematurely releasing stacked forms. R shell-specific ownership is different from Base UI's isolation model; both cannot independently remove isolation. | K transitional — retain until full observable inert contract is proven, then remove unused helper |
| LIB-035 | Scroll lock; N=2 explicit body writers; `src/components/shell/AppShell.tsx:179` (366), `src/components/panel/AssistantPanel.tsx:344` (720) | internal=2 | R independent `overflow=''` cleanup can unlock an open sibling if modal owners overlap; no preserved previous value. Test two modal surfaces and close inner first. R body/safe-area/visual-viewport behavior needs real mobile browser proof. | U — modal engine owns locking; no separate react-remove-scroll |
| LIB-036 | Outside/Escape/portal ownership; N=7 outside-listener files, 14 document-key files, 10 portal files (overlapping); complete register §3 | 1 enclosing caller per site | R document listeners plus body portals need parent/child event ordering; per-widget `z` values 20/50/60/800/820/900/950/1000 do not form a shared layer contract. LIB-002/014 names the concrete nested Escape outcome. | U for popup/modal mechanics; K product hotkey and toolbar policy |

### Dates, formatting and language (8 families)

| ID | Implementation; N; source and LOC | C | Evidence / user impact | Verdict |
|---|---|---:|---|---|
| LIB-037 | StatementPeriodPicker; N=1; `src/components/financial-statements/StatementPeriodPicker.tsx:31` (85) | 2 | OK two native selects, allowed-period validation, empty/disabled state. Period catalogue is supplied, not invented by a calendar widget. | K — no datepicker/date-range dependency |
| LIB-038 | ProjectCalendarView/monthMatrix; N=1 calendar presentation plus 1 math module; `components/ProjectCalendarView.tsx:1` (315), `src/lib/calendar/monthMatrix.ts:13` (95) | 1 calendar; 2 `buildMonthMatrix` candidates | OK read-only project event calendar, date-fns parsing/month shifts; six-week grid is presentation :73–95, not an editable datepicker. | K — already library-backed math, product events |
| LIB-039 | Native date/month/datetime-local fields; N=31 nodes in 23 files; register §3 | 1 enclosing caller per site | OK native entry/browser mobile picker avoids building a calendar. R Safari month fallback, locale/calendar-day vs instant conversion and mobile keyboard remain test cases; do not change storage format to satisfy a widget. | K — native engine, no custom datepicker found in these roots |
| LIB-040 | UTC report month helpers; N=6 exports; `src/lib/reports/months.ts:13` (43) | 5-file union of six value exports | OK tiny ISO/UTC calendar helpers, month-end/inclusive domain conventions; blindly replacing Date.UTC with local date-fns calls changes TZ behavior. | K — reuse installed date-fns only where semantics match; no date library addition |
| LIB-041 | Money/number/percent/list display and draft parsing; N=1 seam; `src/lib/format.ts:24` (727) | 118 module-import candidates (includes date consumers) | OK cached Intl engines; exact-money string path :82; scale validation :203, neutral import parser :249–289, partial drafts :291, formatList :718. R unbounded locale/cache shapes :24 and JS number limits need existing precision tests, not a blanket decimal-library migration. | K — Intl/date-fns-backed facade, no numeral/accounting/mask dependency |
| LIB-042 | Date/time display + zone conversion; N=1 seam; `src/lib/format.ts:336` (same 727, not additional LOC) | shared 118 | OK date-only vs instant APIs and UTC labels. R bespoke two-pass wall-clock conversion :446–515 needs DST gap/fold tests before broader timezone support; date-fns alone does not resolve named-zone policy. | K — preserve timezone semantics; no speculative Luxon/Temporal rewrite |
| LIB-043 | Locale resolution/provider; N=6 modules; `src/lib/locale/activeLocale.ts:1` (114), `resolveLocale.ts:1` (66), `timezones.ts:1` (25), `src/hooks/useResolvedLocale.ts:1` (52), `src/lib/i18n/I18nProvider.tsx:1` (66), `src/lib/i18n/index.ts:72` (108) | 12-file union of value exports (all six definitions excluded) | OK profile/org preference resolution and Intl-supported zones; installed date-fns locale adapter, lazy catalogues. Keep interface/number/timezone choices distinct. | K — `i18next@25.10.10` + Intl/date-fns already supply engines |
| LIB-044 | Plural/count/relative-age construction; N=0 custom PluralRules engines; 9 source families enumerated in §3, including shared `src/lib/timesheet-edit.ts:90` (149) | 1 enclosing caller per inline source; 1 consumer of `saveToastForChangeCount` | D palette result announcement and unread accessible label assemble English text instead of localized count keys. Other sites include manual one/many translation-key branching (already translated, maintenance risk rather than untranslated defect). `ProjectGantt.tsx:200` correctly notes i18next already owns Intl plural rules. | U → **`i18next@25.10.10`**, count keys and existing relative-time seam; no i18next-icu or new helper |

### Import, export and files (8 families)

| ID | Implementation; N; source and LOC | C | Evidence / user impact | Verdict |
|---|---|---:|---|---|
| LIB-045 | Export UI orchestration; N=4 modules; `src/components/export/ExportButton.tsx:1` (56), `useExport.ts:1` (73), `withCurrencyColumn.ts:1` (29), `src/lib/export/buildExportRows.ts:30` (36) | 11 button; 2 hook; 4 currency helper; 3 row builder | OK descriptor/value projection, columns and typed values are product seams over writers. Error/busy/currency decisions belong here. | K — preserve generic adapter, no export framework |
| LIB-046 | CSV serialization; N=1; `src/lib/export/toCsv.ts:1` (20) | 1 | OK small quoting/escaping implementation; quotes delimiter/newlines/quotes. Existing contract tests are stronger reason to keep than importing a parser just for unparse. | K — bounded correct writer, no Papa Parse |
| LIB-047 | Excel writer and cell typing; N=2; `src/lib/export/toWorkbookBuffer.ts:31` (59), `cellType.ts:14` (18) | 3 writer; 1 cell type | OK lazy ExcelJS, typed numbers, date serial avoids host-TZ shift. R very large exports allocate rows+workbook+buffer; retain existing size conventions and profile before workers/streaming. | K — already thin `exceljs@4.4.0` adapter per ADR-0024 |
| LIB-048 | Blob download; N=1; `src/lib/download.ts:2` (12) | 3 `triggerBlobDownload` (defining file excluded) | OK anchor/object URL/revoke sequence, tiny native platform wrapper. | K — browser API, not file-saver |
| LIB-049 | Workbook reader, legacy projection and generic mapping/validation; N=6; `src/lib/import/readWorkbookGrid.ts:7` (51), `parseWorkbook.ts:9` (22), `autoMap.ts:1` (31), `validateRows.ts:1` (57), `refLookup.ts:1` (61), `src/components/import/useImportWizard.ts:1` (187) | 3 reader; 2 parser; 1 mapper; 1 validator; 2 wizard hook | OK lazy ExcelJS retains raw cell/formula/date metadata, bounded legacy import rows and descriptors; no hand-built OOXML parser. | K — library-backed data pipeline; modal engine counted separately |
| LIB-050 | Strict CSV reader; N=1; `src/lib/import/readCsvGrid.ts:13` (72) | 1 | OK explicit quoting state, BOM/newlines, rejects malformed quotes/column counts; trimmed text is intentional FX contract. A permissive parser can silently change accepted inputs. | K — small tested strict subset; reconsider only for signed dialect/scale needs |
| LIB-051 | Product import descriptors/pipelines; N=15 modules; `src/lib/import/{budget,company,contact,procurement,project}Descriptor.ts` (190/40/41/40/159), `fxRateParser.ts` (295), `fxRatePreview.ts` (54), `procurementCycle/{commit,dryRunConflictReport,group,importKey,types,validate}.ts` (564/86/72/19/129/238), `src/components/import/procurementCycle/useProcurementCycleImport.ts` (345), `src/components/fx/FxRateUpload.tsx` (389) | 11-file union of value exports (all 15 definitions excluded) | OK domain grouping/validation/conflict/retry decisions are not generic CSV work. See :1 of each named file for its contract. | K — no parser library replaces domain semantics |
| LIB-052 | File/image input pipeline; N=5 modules; `src/hooks/useFileUpload.ts:1` (137), `useAgentAttachments.ts:1` (72), `src/lib/validateFile.ts:1` (31), `uploadTransport.ts:1` (177), `fileConstants.ts:1` (78) | 2 upload hook; 2 attachment hook; internal helpers | OK progress/retry/file policy and native input integration; no custom file dialog. UI previews and file-drop gesture have their own rows. | K — native files + existing transport; no upload UI framework |

### Charts, boards and large rendering (11 families)

| ID | Implementation; N; source and LOC | C | Evidence / user impact | Verdict |
|---|---|---:|---|---|
| LIB-053 | ChartFrame; N=1; `src/components/dashboard/ChartFrame.tsx:1` (47) | 7 | OK consistent loading/empty/error shell over chart content. | K — product state wrapper, not chart engine |
| LIB-054 | Chart theme/chrome; N=2; `src/components/ui/chartTheme.ts:1` (54), `src/components/dashboard/chartChrome.ts:1` (26) | 9 `chartTheme` candidates | OK token seam and reusable Recharts styles; categorical literals already documented by DESIGN.md. Do not import another chart library to change a palette. | K — skin over installed Recharts |
| LIB-055 | Recharts/metric wrappers; N=7; `src/components/dashboard/StatusBarChart.tsx:5` (166), `ProjectedMarginBars.tsx:1` (92), `BvACard.tsx:1` (94), `WinRateCard.tsx:1` (166), `src/components/admin/AgentCostMetrics.tsx:1` (258), `src/components/ui/KPITile.tsx:1` (226), `StatTiles.tsx:1` (122) | 7 StatusBar; 1 margin; 5 BvA; 2 win; 14 KPI; 11 stats | OK charts use `recharts@3.8.1`; CSS bars are simple metrics, not custom chart systems. R keyboard equivalents/data summary and units remain chart-specific tests. | K — reuse chart engine; never replace calculation semantics with visualization defaults |
| LIB-056 | S-curve visualization/model; N=2; `pages/project-detail/ProjectSCurve.tsx:1` (198), `src/lib/delivery/sCurve.ts:1` (410) | 1 component; 3 `buildSCurve` candidates | OK Recharts numeric time axis + date-fns/date seam and product actual/planned model; axis bugs require geometry/date regressions, not another vendor. | K — ADR-0030/0032 ownership |
| LIB-057 | Gantt; N=3; `pages/project-detail/ProjectGantt.tsx:1` (812), `src/lib/gantt/ganttLayout.ts:1` (566), `ganttGeometry.ts:1` (74) | 2 component; 3 `buildGanttModel` candidates | OK ADR-0030/0031 explicitly chose owned milestone/dependency geometry; existing keyboard activation and one scroll unit :302. R many lanes enlarge SVG/DOM; profile, do not reverse prior library ruling. | K — existing architectural decision, not a new Gantt recommendation |
| LIB-058 | Kanban primitives; N=3 exports; `src/components/ui/Kanban.tsx:22` (117) | 4 column; 4 card; 7 Kanban candidates (includes names/comments) | OK CSS layout/card keyboard entry, no generic drag engine. | K — identity skin, no dnd-kit |
| LIB-059 | Product boards; N=3; `components/ProjectKanbanBoard.tsx:1` (286), `SalesKanbanBoard.tsx:1` (326), `ProcurementBoard.tsx:1` (146) | 3/3/1 | OK state grouping and route/actions, native status alternatives; all nodes render, so thousands of cards would need profiling/paging. Do not introduce drag transitions. | K — domain composition; no drag-and-drop implementation found here |
| LIB-060 | File drag/drop; N=1; `src/components/panel/Composer.tsx:151` (235) | 3 Composer candidates | OK only native file `onDragOver`/`onDrop`, existing picker alternative; not sortable items or card dragging. | K — browser file drop; no DnD kit |
| LIB-061 | Assistant resize; N=1; `src/components/panel/AssistantPanel.tsx:158–215` (same 720) | internal=1 | OK pointer capture and keyboard separator, bounded panel width; one axis/one pane, no general layout manager. R right-anchored arithmetic is physical-direction specific. | K — small product layout control; no resizable-panels dependency |
| LIB-062 | Virtualization; N=0 engines found in five roots; render risks at `Combobox.tsx:395`, `panel/Transcript.tsx:110`, `ProjectGantt.tsx:302` | 0 | R options/messages/lanes grow DOM; notification keyset loading and search caps already bound other surfaces. Virtualizing logs can hide announcements and change browser find/keyboard behavior. | K current bounded/paged rendering; profile before a separate TanStack Virtual evaluation, no dependency authorized |
| LIB-063 | Transcript scroll-to-end; N=1; `src/components/panel/Transcript.tsx:69` (130) | 1 | OK user-scroll suppression, role log, preserved history. R smooth scroll :80 lacks local reduced-motion gate; large streamed histories rerender entries. A virtualizer does not automatically preserve log announcements. | K — product chat semantics; characterize motion/size before optimization |

### Scheduling, state and browser utilities (9 families)

| ID | Implementation; N; source and LOC | C | Evidence / user impact | Verdict |
|---|---|---:|---|---|
| LIB-064 | UI debounce; N=3 non-table owners; `src/components/shell/CommandPalette.tsx:192` (486), `components/ProjectClassificationFilters.tsx:122` (162), `src/hooks/useListWorkingSet.ts:149` (157) | internal; 4 working-set-hook candidates | OK timers cleared on source changes; URL-write coalescing and composition events are domain timing. R source-change/unmount tests must prevent stale writes. DataTable search timer belongs separate lane. | K — tiny scoped debounce; no lodash/use-debounce dependency |
| LIB-065 | Provider throttling; N=1 queue module; `src/lib/adapterSeam/clickup/rateLimit.ts:35` (158) | 2-file union of value exports | OK provider Retry-After/pacing, not UI throttle; preserve deterministic injectable sleep semantics. | K — domain queue, do not substitute generic debounce |
| LIB-066 | Timeout/retry scheduling; N=2 generic seams plus product timers; `src/lib/withTimeout.ts:55` (74), `supabase/invokeWithTimeout.ts:78` (86); full timer register §3 | 5 withTimeout; 6 invokeWithTimeout candidates | OK Abort/timeout semantics and error classification differ per transport. Remaining UI timers are focus restoration/highlight, not missing debounce abstraction. | K — small native timer adapters; no scheduler/retry dependency |
| LIB-067 | Pagination; N=2 modules; `src/lib/pagination.ts:1` (42), `pagedRead.ts:78` (118) | 3 `fetchAllPages` candidates; internal keyset consumers | OK bounded/keyset reads; FE pagination is not virtualization. R fetch-all callers should retain caps; do not replace backend paging with client arrays. | K — product query seam over Supabase |
| LIB-068 | List URL/view working set; N=6; `src/lib/listWorkingSet.ts:459` (495), `src/hooks/useListWorkingSet.ts:1` (157), `useListSearchWorkingSet.ts:1` (30), `useListWorkingSet` view adapters `useProjectView.ts` (66), `usePipelineView.ts` (65), `useProcurementView.ts` (65) | 4 main hook; 3 search-hook; 6 parser candidates | OK URL/session compatibility and filters; native URLSearchParams already the generic engine. | K — no global-store/query-string library migration |
| LIB-069 | Return navigation/focus/scroll; N=3; `src/hooks/useListReturn.ts:1` (241), `src/lib/listReturnContext.ts:1` (262), `tabSwitchNav.ts:1` (28) | 16 hook candidates | OK validates route ownership, restores exact working set/scroll/focus; not generic overlay return focus. | K — product route contract |
| LIB-070 | Media queries; N=3 hooks; `src/components/ui/useIsDesktop.ts:1` (38), `useIsNarrow.ts:1` (42), `src/components/dashboard/usePrefersReducedMotion.ts:1` (21) | 15/3/5 | OK small cleanup-safe matchMedia adapters; preserve separate breakpoints for rail/panel/card reflow. | K — browser engine; no hook utility kit |
| LIB-071 | Theme preference; N=1; `src/hooks/useTheme.ts:1` (72) | 3 | OK class/storage adapter and existing account-menu integration. | K — small product preference, no theme provider dependency |
| LIB-072 | Search ranking and hotkey; N=4; `src/hooks/useRecordSearch.ts:268` (299), `useReferenceRecordSearch.ts:1` (32), `useCachedRecordLists.ts:1` (136), `useAssistantHotkey.ts:1` (30) | 2 rank hook; 1 cache hook; 1 hotkey | OK exact codes, cap/rank and query seams are product-specific. Hotkey listener is intentional, not modal dismissal. | K — Base UI owns list interaction, not data ranking or queries |

### Identity atoms, layout and remaining generic utilities (18 families)

| ID | Implementation; N; source and LOC | C | Evidence / user impact | Verdict |
|---|---|---:|---|---|
| LIB-073 | Button + classes; N=2; `src/components/ui/Button.tsx:1` (69), `buttonClasses.ts:1` (51) | 111 Button candidates | OK ref-forwarding native button, variants/loading; good vendor composition seam. | K — identity atom; no styled kit |
| LIB-074 | Cards/legacy wrapper; N=2 files; `src/components/ui/Card.tsx:29` (77), `components/Card.tsx:1` (16) | 56 Card candidates (both names combined) | OK Card/Head/Pad skin; legacy wrapper is duplicate vocabulary, not missing interaction. | K — reuse canonical facade in touched slices, no new library |
| LIB-075 | Status/badge authority; N=2 modules; `src/components/ui/StatusPill.tsx:79` (125), `src/lib/status/statusVariants.ts:1` (211) | 68 pill; 5 Badge candidates after defining file excluded | OK domain mapping + identity visuals; ADR-0029 owns variant authority. | K — library badge would not replace status semantics |
| LIB-076 | Simple gauges/stepper; N=5; `src/components/ui/ProgressBar.tsx:1` (92), `HoursBar.tsx:1` (75), `Funnel.tsx:1` (152), `LifecycleStepper.tsx:1` (174), `KanbanStageIndicator.tsx:1` (92) | 10 progress; 2 hours; 5 lifecycle; other product consumers | OK progress/Funnel/stage skin and domain labels; native semantics/keyboard alternatives matter, not complex widget engines. | K — product identity atoms; no chart/gauge kit |
| LIB-077 | Page/layout/action molecules; N=13 modules; `src/components/ui/{PageHeader,RecordHeader,SectionHeader,ListPage,RecordActionZone,MobileActionBar,MobileActionStrip,ApprovalRow,DecisionContextSummary}.tsx` (85/72/23/144/51/67/78/129/28), `src/components/shell/{BackBar,Breadcrumb,ContextBar,Rail}.tsx` (37/141/70/469) | 2 PageHeader; 9 RecordHeader; 5 SectionHeader; 14 ListPage; 3 action zone; 1 each mobile bar/strip; 3 ApprovalRow | OK route/product anatomy, safe-area/ResizeObserver reservation and responsive navigation; rail modal separately inventoried. Do not buy a layout engine. | K — DESIGN.md identity/composition |
| LIB-078 | Linked-record affordances; N=3; `src/components/ui/{CompanyNameLink,ContactNameLink,ProjectNameLink}.tsx` (57/57/54), each :1 | 11-file union; 3 company / 1 contact / 8 project | OK routing/access-aware record labels; plain link behavior, not generic menus. | K — domain links, ADR-0028 |
| LIB-079 | Icons/legacy aliases; N=3; `src/components/ui/icons.tsx:1` (35), `iconPaths.tsx:1` (438), `components/icons.tsx:1` (37) | 91 Icon candidates | OK already vendored licensed geometry through one facade, ADR-0068; no competing icon family needed. | K — keep provenance and monoline facade |
| LIB-080 | Classname utility; N=1; `src/components/ui/cn.ts:1` (10) | 58 | OK thin installed `clsx@2.1.1` wrapper. R it does not resolve conflicting Tailwind classes; `ViewToggle.tsx:16–25` deliberately uses wrappers. Installed tailwind-merge 2.x is not automatically Tailwind-v4-compatible. | K — do not silently change class precedence |
| LIB-081 | Loading/empty/error/guard shells; N=8; `src/components/ui/{ListState,ErrBanner,EntryList,AccessDenied,GateNotice}.tsx` (142/41/66/54/35), `src/components/ErrorBoundary.tsx` (91), `components/LoadingFallback.tsx` (41), `src/components/FeatureRoute.tsx` (39), each :1 | 85 ListState; 3 error banner; 1 EntryList; 1 boundary; 1 loading; 15 GateNotice | OK product states and recovery copy are not headless interactions. | K — native semantic presentation |
| LIB-082 | Rich editor and markdown; N=7 source modules; `src/components/meetings/{MinutesEditor,minutesSchema,ActionItemView}.tsx` (148/29/80), `{minutesDictionary,minutesSlashMenu,placeActionItem}.ts` (135/61/26), `src/components/panel/Markdown.tsx` (54), each :1 | 1 MinutesEditor; panel markdown consumers | OK BlockNote and react-markdown/remark-gfm already own generic editing/rendering. Keep product action-item nodes/dictionary and lazy editor. Do not copy internal shadcn implementation into app wrappers. | K — existing engines correctly used |
| LIB-083 | Filename/storage key helpers; N=3; `src/lib/storageKey.ts:19` (42), `invoicePdfFilename.ts:1` (16), `export/exportFilename.ts:6` (11) | 5-file union of value exports | OK bounded native filename/formatting policy; no generic slug utility needed. | K — small product naming seams |
| LIB-084 | Image resize/transcode; N=1; `src/lib/agent/transcodeImage.ts:45` (83) | 1 (`transcodeImage`, defining file excluded) | OK Canvas/createImageBitmap bounded dimension/quality, not a hand-built codec. R large-file memory and cancellation should be profiled, not assumed solved by a library. | K — browser-backed adapter |
| LIB-085 | Error classification/reload boundary; N=3; `src/lib/{appError,classifyMutationError,chunkReload}.ts` (92/357/56), each :1 | 181-file union of value exports; includes 104 classifier candidates | OK product error vocabulary and single recovery seam; vendor primitives cannot classify mutation outcomes. | K — domain policy and tiny native reload adapter |
| LIB-086 | Domain arithmetic/derived utility seams; N=9 named generic-looking families; `src/lib/{sumPerCurrency,itemsNet,taxNormalize,taxTreatment,vendorWithholding,progressBilling,workOrderBilling,projectFinances,fxEquivalent}.ts` (12/44/52/214/156/77/72/354/21), each :1 | 41-file union of value exports (all nine definitions excluded) | OK grouping/currency/tax/recognition are domain facts, not a reason to introduce a number/date kit. Preserve exact current contracts and authoritative inputs. Other DAL/adapter business rules are intentionally outside generic-widget replacement. | K — no money/decimal semantic change in this audit |
| LIB-087 | Native short selects; N=9 nodes in 7 files; full register §3 | internal per site; 40 external SelectField candidates counted LIB-029 | OK browser keyboard/typeahead/mobile picker; custom select is justified only by a signed requirement native select cannot meet. | K — browser library; standardize styling through SelectField when touched |
| LIB-088 | Native fiscal-year autocomplete; N=2 datalists; `pages/ProjectBudget.tsx:272,402` (1088) | internal=1 owner | OK free-text client-defined fiscal-year naming; a closed Select would change allowed input. | K — native datalist contract, no Combobox conversion without criteria |
| LIB-089 | Unsaved navigation guard; N=1; `src/hooks/useUnsavedChangesGuard.ts:32` (118) | 1 | OK plain/modified link distinction, beforeunload and replayed router state; not dialog dirty-discard or generic form state. R popstate/programmatic exits are a separate product scope, not solved by installing a modal kit. | K — retain tested route-exit semantics; no new routing framework |
| LIB-090 | Conversational choice/review/list atoms; N=5; `src/components/panel/{QuestionChips,ApprovalChip,FeedbackControl,ThreadList,ChatBubble}.tsx` (132/114/94/72/22), each :1 | per symbol: 4/3/2/2/1 | OK native buttons/inputs over product pending/resolved/approval states; `QuestionChips.tsx:55–132` is a labelled group, not a generic Listbox/radio rewrite. Preserve disabled/resolved transcript state and existing agent acceptance tests. | K — identity/domain controls; no new chip/list library |

## 3. Complete inline-site register

A separate AST caller census finds 48 EntityFormModal invocations in 40 source files, 76 ConfirmDialog invocations in 51 files, 39 Combobox invocations in 25 files, 5 MobileToolbarDisclosure invocations in 2 files, and 3 Drawer invocations in 3 files. These are actual JSX nodes, distinct from lexical C counts and from one reusable facade implementation. The raw native `<form>` count is 10 including EntityFormModal's own shared form; the standalone register below excludes that one.

These registers are part of the inventory, not examples. An entry is `source (whole-file LOC): implementation start lines`; all carry their family's verdict and `C=internal` (one enclosing source, unless multiple nodes are shown). Lines identify opening elements rather than the line holding a wrapped attribute. Table internals are only recorded to coordinate the separate lane.

### LIB-023 — all native `<details>` (14 nodes / 12 files)

| Source (LOC) | Lines | Count |
|---|---|---:|
| `components/ProjectCard.tsx` (260) | 188 | 1 |
| `components/SalesKanbanBoard.tsx` (326) | 134 | 1 |
| `pages/Approvals.tsx` (982) | 444 | 1 |
| `pages/BudgetProjection.tsx` (956) | 744 | 1 |
| `pages/Projects.tsx` (1413) | 461 | 1 |
| `pages/UserViewRenderer.tsx` (310) | 214 | 1 |
| `pages/admin/BudgetAccountMap.tsx` (560) | 297, 311 | 2 |
| `pages/project-detail/ProjectDetailHeader.tsx` (679) | 204, 555 | 2 |
| `pages/project-detail/ProjectDetailRail.tsx` (151) | 69 | 1 |
| `pages/project-detail/ProjectFinancesSection.tsx` (179) | 147 | 1 |
| `src/components/integrations/IntegrationsView.tsx` (1044) | 545 | 1 |
| `src/components/panel/ArtifactSlot.tsx` (255) | 141 | 1 |

### LIB-024 — other expansion buttons

| Source (LOC) | Lines | Count |
|---|---|---:|
| `src/components/reports/ManagementPositionSection.tsx` (338) | 313 | 1 |
| `src/components/import/procurementCycle/ProcurementCycleImportWizard.tsx` (592) | 396 | 1 |
| `src/components/history/HistorySection.tsx` (39) | 18 | 1 |
| `src/components/history/RecordHistory.tsx` (345) | 148, 182 | 2 |
| `pages/Procurement.tsx` (579) | 404 | 1 |
| `pages/approvals/ProcurementApprovalRow.tsx` (340) | 317 | 1 |
| `pages/approvals/SalesInvoiceApprovalRow.tsx` (169) | 145 | 1 |
| `pages/approvals/ExpenseClaimApprovalSection.tsx` (90) | 79 | 1 |
| `pages/procurement/ProcurementListRow.tsx` (288) | 211 | 1 |
| `pages/procurement/ProcurementProgressionTimeline.tsx` (150) | 139 | 1 |
| `pages/IncomingPayments.tsx` (873) | 808 | 1 |
| `pages/timesheets/ApprovalsQueue.tsx` (439) | 360 | 1 |
| `pages/ProcurementDetails.tsx` (1283) | 933 | 1 |
| `pages/project-detail/ProjectDetailHeader.tsx` (679) | 239 | 1 |
| `src/components/panel/AssistantPanel.tsx` (720) | 544 | 1 |

### LIB-039 — all native date/month/datetime-local fields

| Source (LOC) | Opening lines | Count |
|---|---|---:|
| `components/IncidentFormModal.tsx` (223) | 160 | 1 |
| `components/ProjectFormModal.tsx` (657) | 637, 644 | 2 |
| `components/ProjectStatusControl.tsx` (297) | 244 | 1 |
| `pages/IncomingPayments.tsx` (873) | 854 | 1 |
| `pages/ManagementPack.tsx` (348) | 238, 245 | 2 |
| `pages/MeetingDetail.tsx` (1004) | 825, 971 | 2 |
| `pages/Meetings.tsx` (526) | 492 | 1 |
| `pages/SalesInvoices.tsx` (1685) | 1266 | 1 |
| `pages/expenses/ExpenseClaimFormModal.tsx` (348) | 287 | 1 |
| `pages/expenses/ExpenseLinesCard.tsx` (217) | 204 | 1 |
| `pages/procurement/ProcurementDecisionZone.tsx` (635) | 545 | 1 |
| `pages/procurement/RecordCaptureForm.tsx` (877) | 612 | 1 |
| `pages/procurement/VendorWithholdingSlipDetails.tsx` (110) | 102, 103 | 2 |
| `pages/procurement/VendorWithholdingSlipModal.tsx` (137) | 116, 117 | 2 |
| `pages/project-detail/MilestoneFormModal.tsx` (245) | 181 | 1 |
| `pages/project-detail/PipelineLens.tsx` (484) | 384 | 1 |
| `pages/project-detail/WorkOrderFormModal.tsx` (353) | 268, 276, 284 | 3 |
| `pages/project-detail/tabs/DocumentsTab.tsx` (1160) | 1146 | 1 |
| `pages/project-detail/tabs/TasksTab.tsx` (1189) | 941, 949 | 2 |
| `src/components/EfakturModal.tsx` (123) | 112 | 1 |
| `src/components/NewRevisionModal.tsx` (125) | 114 | 1 |
| `src/components/fx/FxRateForm.tsx` (129) | 108 | 1 |
| `src/components/reports/RecordProgressModal.tsx` (105) | 84 | 1 |

### LIB-044 — manual count/plural/age source families (9)

| Source (LOC) | Lines | Construction / outcome |
|---|---|---|
| `src/components/shell/CommandPalette.tsx` (486) | 344 | literal English result/results |
| `src/components/shell/NotificationBell.tsx` (356) | 239–249 | English unread count label and announcement |
| `src/components/import/procurementCycle/ProcurementCycleImportWizard.tsx` (592) | 213, 345, 418 | record/records suffix and count captions |
| `src/lib/timesheet-edit.ts` (149) | 85–91 | shared save-toast change/changes helper |
| `pages/SalesPipeline.tsx` (778) | 366–371, 389 | age labels; translated branch plus separate literal English branch |
| `pages/approvals/ProcurementApprovalRow.tsx` (340) | 50–57 | local today/days-ago helper |
| `src/components/dashboard/ProjectedMarginBars.tsx` (92) | 53 | manual stage/stages translated noun selection |
| `src/components/dashboard/AwaitingApprovalTile.tsx` (101) | 74–84 | manual translated one/many key selection |
| `src/components/integrations/IntegrationsView.tsx` (1044) | 1014–1026 | manual translated pending/failure/quarantine/held one/many keys |

The last three already translate; consolidate only without changing meaning/urgency. English import/count strings and relative-age helpers are localization consumers, **not** evidence for a new plural/date engine. Literal singular/plural catalogue strings without runtime branching are not custom helpers.

### LIB-087 — all raw selects; LIB-088 datalists recorded above

| Source (LOC) | Lines | Count |
|---|---|---:|
| `pages/BudgetProjection.tsx` (956) | 547 | 1 |
| `pages/ProjectBudget.tsx` (1088) | 231, 366, 999 | 3 |
| `pages/SalesPipeline.tsx` (778) | 550 | 1 |
| `pages/procurement/ProcurementDecisionZone.tsx` (635) | 532 | 1 |
| `src/components/import/ImportWizard.tsx` (405) | 287 | 1 |
| `src/components/import/procurementCycle/ProcurementCycleImportWizard.tsx` (592) | 317 | 1 |
| `src/components/ui/FormFields.tsx` (526) | 403 | 1 |

### LIB-031 — all standalone native forms (outside EntityFormModal)

| Source (LOC) | Lines | Count |
|---|---|---:|
| `components/ProjectStatusControl.tsx` (297) | 215 | 1 |
| `pages/company/VendorTaxDefaultsCard.tsx` (131) | 69 | 1 |
| `pages/ContactDetail.tsx` (897) | 420 | 1 |
| `pages/CompanyDetail.tsx` (1337) | 743 | 1 |
| `pages/admin/OrgDownPaymentItem.tsx` (145) | 106 | 1 |
| `pages/admin/OrgWithholdingAccount.tsx` (155) | 116 | 1 |
| `pages/admin/OrgVendorTaxAccounts.tsx` (253) | 170 | 1 |
| `pages/procurement/RecordCaptureForm.tsx` (877) | 540 | 1 |
| `pages/procurement/ProcurementHeaderEdit.tsx` (184) | 123 | 1 |

### LIB-033/035/036 — complete interaction infrastructure register

- Shared focus hook: `src/hooks/useFocusTrap.ts` (41), selector :23. Used by `AppShell` and `AssistantPanel`; comments claiming Confirm/Form reuse are not the implementation.
- Local trap implementations: `ConfirmDialog.tsx:140` (314), `EntityFormModal.tsx:257` (431), `Drawer.tsx:146` (269), `ReceiptPreview.tsx:43` (97), `src/components/builder/AIComposerModal.tsx` (233), `src/components/import/ImportWizard.tsx` (405), `src/components/import/procurementCycle/ProcurementCycleImportWizard.tsx` (592). The latter three have their own querySelectorAll/Tab loops. CommandPalette's single-input Tab override :285 is an eighth local containment implementation, counted under LIB-016, not hidden as a shared hook use.
- Body overflow writers: `AppShell.tsx:181,183,186`, `AssistantPanel.tsx:347,349,352` (LOC in LIB-008/009).
- Outside pointer/mouse listener registrations (7 files): `components/ProjectClassificationFilters.tsx:51` (162); `components/ProjectStatusControl.tsx:89` (297); `src/components/shell/AccountMenu.tsx:107` (315); `NotificationBell.tsx:182` (356); `src/components/ui/Combobox.tsx:214` (448); `DataTable.tsx:676` (901, separate lane); `MobileToolbarDisclosure.tsx:158` (212).
- Document key registrations (14 files): `components/ProjectStatusControl.tsx:88`; `src/components/builder/AIComposerModal.tsx:65`; `src/components/import/ImportWizard.tsx:68`; `src/components/import/procurementCycle/ProcurementCycleImportWizard.tsx:87`; `src/components/panel/AssistantPanel.tsx:340`; `src/components/shell/AccountMenu.tsx:108`; `AppShell.tsx:199`; `NotificationBell.tsx:183`; `src/components/ui/ConfirmDialog.tsx:96`; `Drawer.tsx:106`; `EntityFormModal.tsx:164`; `MobileToolbarDisclosure.tsx:157`; `ReceiptPreview.tsx:51`; `src/hooks/useAssistantHotkey.ts:27` (30). LOC for all other files is in their inventory rows. Not every document key handler is dismissal: the assistant shortcut is intentionally kept.
- Body portal calls (10 files): `src/components/builder/AIComposerModal.tsx:134`; `src/components/import/ImportWizard.tsx:106`; `src/components/import/procurementCycle/ProcurementCycleImportWizard.tsx:128`; `src/components/ui/Combobox.tsx:339`; `ConfirmDialog.tsx:293`; `DataTable.tsx:731` (separate lane); `Drawer.tsx:178`; `EntityFormModal.tsx:279`; `ReceiptPreview.tsx:78`; `Tooltip.tsx:85`. Account/inbox/status popups are absolute nonportalled; palette is fixed but nonportalled.

### LIB-064/065/066 — complete `setTimeout` register (26 files, including table lane)

This register prevents counting every timeout as a hand-rolled debounce. LOCs already recorded in family tables are not summed again.

| Source | Lines | Purpose / verdict |
|---|---|---|
| `components/ProjectClassificationFilters.tsx` (162) | 122 | UI debounce K |
| `pages/AdminUsers.tsx` (866) | 169 | route/fragment focus timing K |
| `pages/project-detail/PipelineLens.tsx` (484) | 168 | focus timing K |
| `pages/project-detail/tabs/TasksTab.tsx` (1189) | 153 | highlight expiry K |
| `src/components/panel/AssistantPanel.tsx` (720) | 307 | focus timing, subsumed by its U overlay slice |
| `src/components/shell/AppShell.tsx` (366) | 163 | focus timing, subsumed by its U overlay slice |
| `src/components/shell/CommandPalette.tsx` (486) | 192, 246 | debounce K; focus handled by U engine |
| `src/components/ui/ConfirmDialog.tsx` (314) | 119 | return-focus scheduling, U engine |
| `src/components/ui/DataTable.tsx` (901) | 842 | search debounce; separate table lane |
| `src/components/ui/MobileToolbarDisclosure.tsx` (212) | 149 | sibling/outside focus policy K |
| `src/components/ui/ReceiptPreview.tsx` (97) | 55 | return-focus scheduling, U engine |
| `src/components/ui/Toast.tsx` (278) | 76, 161, 221 | announcement/timer engine U with policy retained |
| `src/components/ui/useEntityForm.ts` (249) | 112 | mount interaction timing K |
| `src/hooks/useAIComposer.ts` (118) | 60 | request deadline K |
| `src/hooks/useListReturn.ts` (241) | 218 | deferred list restoration K |
| `src/hooks/useListWorkingSet.ts` (157) | 149 | URL debounce K |
| `src/hooks/useTasks.ts` (195) | 118, 146 | coalesced domain push K |
| `src/lib/adapterSeam/clickup/client.ts` (133) | 27 | request deadline K |
| `src/lib/adapterSeam/clickup/rateLimit.ts` (158) | 76, 89 | provider throttle/backoff K |
| `src/lib/adapterSeam/erpnext/binding.ts` (307) | 281 | bounded domain operation K |
| `src/lib/adapterSeam/erpnext/client.ts` (737) | 247, 499 | backoff/deadline K |
| `src/lib/adapterSeam/erpnext/invoicePdf.ts` (143) | 110 | request deadline K |
| `src/lib/adapterSeam/erpnext/statementReportRefresh.ts` (620) | 584 | bounded refresh K |
| `src/lib/download.ts` (12) | 11 | object-URL cleanup K |
| `src/lib/supabase/invokeWithTimeout.ts` (86) | 78 | request deadline K |
| `src/lib/withTimeout.ts` (74) | 55 | generic deadline K |

**Negative findings are scoped:** the 742-file AST/source sweep found no custom date-grid picker, sortable/card DnD handler, general virtualizer, custom plural-rule engine, or standalone reusable throttle beyond the provider queue. It did find a read-only calendar, file-drop handlers, custom SVG Gantt, simple meter bars, native datalists and browser dates. Those are different things, all counted above. No conclusion is made about code outside the five inventory roots.

## 4. Counts and decision summary

| Category | Families | KEEP | ALREADY-INSTALLED-UNDERUSED | ADOPT new library |
|---|---:|---:|---:|---:|
| Overlays | 10 | 1 | 9 | 0 |
| Menus/search/popups/tooltips | 8 | 1 | 7 | 0 |
| Tabs/disclosures/toasts/checkbox | 8 | 4 | 4 | 0 |
| Forms/modal infrastructure | 10 | 6 | 4 | 0 |
| Dates/formatting/language | 8 | 7 | 1 | 0 |
| Import/export/files | 8 | 8 | 0 | 0 |
| Charts/boards/large rendering | 11 | 11 | 0 | 0 |
| Scheduling/state/browser utilities | 9 | 9 | 0 | 0 |
| Identity/layout/remaining utilities | 18 | 18 | 0 | 0 |
| **Total** | **90** | **65** | **25** | **0** |

Twenty-four U families point to Base UI; one (LIB-044) points to already-installed i18next. Infrastructure rows intentionally overlap widget rows: 25 U families do **not** mean 25 new packages or 25 independent rewrites. Native date/select/disclosure counts are 31/9/14 nodes; they are not hand-built calendar/select/accordion engines. The proposed migration portfolio contains **21 PR-sized slices**, including the conditional mention pilot and final cleanup. The first five prioritize reproducible interaction defects plus caller leverage, not LOC alone. Toast has 59 caller candidates but already has unusually strong timing/recovery contracts; a blind first-wave replacement is riskier than repairing the demonstrated picker/palette/tab failures.

## 5. Architecture, invariants and rollout gates

The library comparison, rejected alternatives, empirical React 19 probe and measured bundle envelope are in ADR-0089. Summary: Base UI is MIT, already locked at 1.8.0 and supports React 19/Tailwind 4; React Aria is broader for calendars but adds a second graph; current Radix is actively published but requires another search/combobox strategy; Ariakit is credible but gives no sufficient incremental coverage here. Exact metadata was inspected, not inferred from the word shadcn.

**Keep APIs:** `ConfirmDialogProps`, `EntityFormModalProps`, `DrawerProps`, `ComboboxProps`, `TooltipProps`, `ViewToggleProps`, `TabsProps`, `ReceiptPreviewProps` and `useToast(): ToastApi` remain caller-facing seams. Do not thread Base UI state or `org_id` into page props. Retain repository/query behavior. Vendor `render` composition must forward the real button ref and cannot create nested buttons. Use `@base-ui/react/<component>` public subpaths. No direct Floating UI/cmdk/RHF/date-picker dependency. No schema/RLS/API change; reversible DB migrations are not applicable because this portfolio changes no data.

**Keep domain policy outside the engine:** dirty-discard, loading close lockout, submit-only validation focus, failed-save focus, confirmation amounts/identity, queue urgency/dedup/cap, source loading/retry/create, record ranking, claim/tax/approval semantics, keep-mounted transcript, mobile breakpoints and safe-area action strips. Loading/empty/error states remain visible with the same recovery goal. Library defaults are not acceptance criteria.

**Preserve mixed-engine nesting:** first prove migrated ConfirmDialog above legacy EntityFormModal, then migrated form above legacy picker, then migrated picker inside migrated form. Only the top surface handles one Escape. Close one overlay without releasing its parent's isolation or scroll lock. A toast's live regions/remedy/dismiss remain operable while a modal is open. Never run a legacy trap and vendor trap on the same surface. Retain the inert helper until a complete call-site search and behavior proof permit deleting it.

**Layering:** preserve present visual order while testing portal ownership: base shell < menus/popovers < modal/backdrop < nested picker/confirmation < tooltip/palette < safe toast host. Do not merely assign every popup a bigger integer. Test clipped/scrolling ancestors, modal/picker nesting, two dialogs, 390px phone height, zoom, visual viewport and RTL start/end. Use logical alignment/DirectionProvider for engine positioning; visual shell physical edges need their own regression. Do not add swipe-to-dismiss, new drag behavior, focus-stealing hover, or new tab activation policy.

**Performance:** baseline/head same Linux build; React external in isolated envelope is not external in app build. Planning allowance: first Dialog slice 0–25 KiB initial gzip; entire chosen set 0–90 KiB before old engine removal. Track initial import closure and editor/route lazy chunks separately; deduplicate Base UI across BlockNote and shell. Director approval required above either allowance. Keep async option loading lazy; no cold-mount record fetches and no export/editor eager import. No blanket virtualization: first profile 100/1,000/10,000 option/card/message fixture sizes, then propose a separate signed cap/paging/windowing change if needed.

### Acceptance ownership and missing-spec boundary

This is an architectural census/decision portfolio requested directly by the Director, **not a behavior-build spec**. No new `AC-###` is fabricated. Existing canonical tests retain their existing AC IDs; the traceability below names IDs actually present in those tests. New maintenance regressions use a LIB identifier in the test title until the Director attaches them to a signed maintenance spec. **Before implementing a behavior change with no existing AC (for example changing multiline mentions, tooltip hover interaction, menu typeahead, or the public picker ARIA structure), stop at that slice and obtain its signed Given/When/Then criterion.** Do not invent a requirement from a library default. That boundary does not block this docs-only decision deliverable.

| Existing behavior / acceptance trace | Owning proof to retain | Slices |
|---|---|---|
| AC-CONFIRM-001/002/003/004/005/006/009/010/011; AC-A11Y-MODAL-001 | `src/components/ui/__tests__/ConfirmDialog.test.tsx` | 01, 02, 11, 16–17 |
| AC-A11Y-FORM-001/003; AC-ERR-001; AC-A11Y-MODAL-002 | `src/components/ui/__tests__/EntityFormModal.focus.test.tsx` | 02–03, 11–15 |
| AC-W6-G6 disabled reason and first-field/unmount focus | `src/components/ui/__tests__/EntityFormModal.a11y.test.tsx` | 02 |
| AC-SI-2 stable picker focus ID | `src/components/ui/__tests__/Combobox.test.tsx` | 03 |
| AC-PRJUX-003 inline toolbar region/focus/dismissal | `src/components/ui/__tests__/MobileToolbarDisclosure.test.tsx` | 02–03, 12–13, 21 |
| AC-UXS-012 preview retrieval/error/download/return | `src/components/ui/__tests__/ReceiptPreview.test.tsx` | 11 |
| AC-MOB-VT-002 hidden option wrappers; issue #879 focus-preserving tabs | `src/components/ui/__tests__/ViewToggle.test.tsx`, `Tabs.keyboard.test.tsx` | 05 |
| AC-CMDK-007 real record navigation; AC-S40-005 reference search goal | Existing curated e2e files named below (own cross-stack goal, not component focus details) | 04 |
| AC-OVERFETCH-001 closed palette does not read lists | `src/components/shell/ShellChrome.coldMount.test.tsx` | 04, 16 |

Unit/RTL owns widget state/focus/semantics. Real popup geometry, browser scroll locking and iframe behavior need the smallest rendered browser fixture; do not manufacture a DB-backed e2e for pure component logic. Existing cross-stack journeys stay intact. Any new e2e author reads `docs/e2e-parallel-conventions.md`; retain both browser lanes, isolation tags and no CI-based skip. This portfolio does not authorize weakening role/focus assertions to suit a vendor.

### Common exact verification commands

Run from repo root; all app paths below are relative to `pmo-portal/`. Define this convenience once, then use each slice's complete command:

```bash
vtest() { (cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run "$@"); }
```

Every code slice also runs the following local final gates, in addition to its listed owning/regression tests (do not run these heavy code gates just for this docs-only commit):

```bash
(cd pmo-portal && ../scripts/with-test-lock.sh npm run typecheck)
# Derive touched TS/TSX paths without ever passing Markdown into ESLint.
(cd pmo-portal && git diff --name-only --relative --diff-filter=ACMR origin/dev -- '*.ts' '*.tsx' \
  | xargs npx eslint --max-warnings=0)
(cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run --changed origin/dev)
git diff --check
```

PR-to-dev CI remains the normal four unit shards, verify and pgTAP. Browser integration is dispatched through `scripts/ci-e2e.sh <branch>` for lane closure/shared-code milestone under the current two-run cap; post-merge dev sweep follows every 2–3 merges. Touched existing journeys run with `scripts/e2e-local.sh <fragment>` (self-locking; no reset for this UI-only work). No production/main promotion is authorized. Never regenerate the lock on macOS: slice 01 uses `scripts/relock.sh` and a clean Linux install; do not mutate shared symlinked node_modules.

## 6. Ordered PR slices — red first, facade preserved

Each numbered slice is one reviewable PR, not a promise that a library migration takes five minutes. Inside each slice execute the listed **2–5-minute task units** in order: write the named regression first, show RED for the named outcome (or a deliberately failing new-engine assertion in a compatibility pilot), change only the named engine wiring, then show GREEN with the exact command. Large mechanical consumer moves are intentionally absent: facades protect callers. The source/test paths and concrete edits below are the task definitions; do not substitute “add error handling” or “migrate similarly.”

### 01 — Direct dependency + shared confirmation pilot (LIB-001/033/035/036)

1. **RED (2–5 min):** in `src/components/ui/__tests__/ConfirmDialog.test.tsx`, add a nested legacy-form confirmation test: open form, open destructive confirmation, Escape once cancels only confirmation; form remains open/isolated, focus returns inside it. Include conditionally removed opener/fallback and close-while-loading cases already tested. This pilot must also reject duplicate live confirm actions.
2. **Engine task (2–5 min):** set `dependencies['@base-ui/react']` to exact `1.8.0` in `pmo-portal/package.json`; regenerate via `scripts/relock.sh`, then prove clean Linux `npm ci`. No automatic upgrade and no copied BlockNote shadcn files.
3. **Shell task (2–5 min):** create `src/components/ui/OverlaySurface.tsx` as visual-only backdrop/container class exports using the current `confirm-scrim-anim`, desktop centering and mobile sheet classes. It must contain **no** document listeners, state, traps, or scroll writes.
4. **Engine task (2–5 min):** in `ConfirmDialog.tsx`, replace manual keys/trap/portal with public `Dialog`/`AlertDialog` parts, retaining `ConfirmDialogProps`. Controlled close calls `onCancel`; when loading, cancel the library's close event. AlertDialog's outside-dismiss default differs: explicitly wire the existing backdrop-click cancellation through the same loading gate so destructive confirmations retain AC-CONFIRM-004. Set initial focus to existing Cancel ref; final focus uses connected opener then caller fallback/main. Keep the actual decision fields in description and existing button classes. Delete that surface's old trap/listener, not the helper other callers still use. Keep the inert behavior until the mixed-stack test proves equivalent.
5. **GREEN (2–5 min):** `vtest src/components/ui/__tests__/ConfirmDialog.test.tsx src/components/ui/__tests__/EntityFormModal.focus.test.tsx src/components/ui/__tests__/ToastDialogGeometry.test.tsx`. Retain every AC-CONFIRM and modal test above. Measure Linux baseline/head initial/lazy gzip; exercise a phone-sized browser fixture and keyboard focus. The ADR's JSDOM probe is not this acceptance gate.

Concrete close-gate API (same shape for each selected namespace; this is plan code, not a source edit):

```tsx
onOpenChange={(nextOpen, details) => {
  if (nextOpen) return;
  if (loading) { details.cancel(); return; }
  onCancel();
}}
// Popup: initialFocus={cancelRef}; finalFocus uses current connected fallback.
```

### 02 — EntityFormModal (LIB-002)

1. **RED:** extend `src/components/ui/__tests__/EntityFormModal.focus.test.tsx`: open a dirty form containing a portalled picker; Escape from picker closes only picker and preserves draft. Add Tab/Shift+Tab through portalled picker and post-submit error focus without blur refocus.
2. **Engine task:** in `EntityFormModal.tsx`, compose `Dialog.Root/Portal/Backdrop/Popup/Title/Description`; keep the real `<form>`, current `handleFormSubmit`, `submitSeq`, `visibleSaveError`, sticky actions and `requestClose`. Initial focus uses the existing first-enabled-field query; close routes through dirty/loading state. Base UI owns containment/dismissal, remove `onTrapKeyDown` and document Escape listener. Keep nested ConfirmDialog and same discard copy; coordinate `confirmDiscard` isolation rather than double-trapping.
3. **GREEN:** `vtest src/components/ui/__tests__/EntityFormModal.test.tsx src/components/ui/__tests__/EntityFormModal.a11y.test.tsx src/components/ui/__tests__/EntityFormModal.focus.test.tsx src/lib/__tests__/entityFormModal.saveErrorCoverage.test.ts src/components/ui/__tests__/MobileToolbarDisclosure.test.tsx`. Retain AC-A11Y-FORM/ERR/MODAL and disabled reasons. Run `scripts/e2e-local.sh AC-A11Y-FORM-002` for the existing form journey.

### 03 — Async Combobox (LIB-014)

1. **RED:** extend `src/components/ui/__tests__/Combobox.test.tsx` with nested-form Escape and enabled/disabled/clear/retry/stale resolution behavior; add `src/components/ui/__tests__/Combobox.positioning.test.tsx` with controlled bounding-rect/viewport/scroll mocks for anchor updates; separately exercise the real Companies form in a browser for bottom flip, resize and RTL logical start. Assert popup remains anchored and every option/action is reachable; do not assert hardcoded pixel offsets.
2. **Data adapter task:** preserve `ComboboxProps` and the `loadIdRef` stale-load guard/load-on-open/error/create semantics in `Combobox.tsx`. Keep options/selectedOption/query source adapter separate from vendor highlight/navigation. Explicitly keep underscore/space matching and single-match Enter.
3. **Engine task:** use `Combobox.Root/Input/Trigger/List/Item/Portal/Positioner/Popup`, stable form field ID and forwarded labelled/error references. Remove `pos`, manual getBoundingClientRect effect, document mousedown and hand-coded key/highlight selection. Popup must participate in parent Dialog's focus tree. A public role-model change requires signed criterion before updating role-specific tests; goal assertions remain intact.
4. **GREEN:** `vtest src/components/ui/__tests__/Combobox.test.tsx src/components/ui/__tests__/Combobox.locale.test.tsx src/components/ui/__tests__/EntityFormModal.focus.test.tsx components/ProjectFormModal.locale.test.tsx pages/admin/OrgWithholdingAccount.test.tsx`. Existing picker creation/retry/selection and AC-SI-2/first-field focus remain green; browser fixture supplies geometry proof.

### 04 — Command palette (LIB-016)

1. **RED:** in `src/components/shell/__tests__/CommandPalette.test.tsx`, assert keyboard can reach and activate Retry after a read error, selected result has a real ID linked from the focused input, moving to last visible result scrolls it into view, Escape restores opener. Keep nav available during a reference request and exact-code rank.
2. **Engine task:** in `CommandPalette.tsx`, use Dialog around `Autocomplete` with externally supplied filtered/grouped items; disable vendor filtering where custom rank/caps already applied. Give retry/status/error UI a normal reachable focus path **outside listbox options**. Delete the unconditional Tab-to-input handler and custom selected-index key engine. Keep async hooks, caps, reference code tokens, debounce and Ask AI action; do not add cmdk or fuzzy-search package.
3. **GREEN:** `vtest src/components/shell/__tests__/CommandPalette.test.tsx src/components/shell/__tests__/CommandPalette.askAi.test.tsx src/components/shell/ShellChrome.coldMount.test.tsx`. Then `scripts/e2e-local.sh AC-CMDK-007` and `scripts/e2e-local.sh AC-S40-005`. These existing cross-stack goals remain canonical; component regressions stay unit/browser-fixture level.

### 05 — Tabs and ViewToggle tab mode (LIB-019/020)

1. **RED:** extend `src/components/ui/__tests__/ViewToggle.test.tsx` with a controlled rerender harness asserting ArrowRight changes selection **and actual DOM focus**, Home/End, and no keyboard landing on CSS-hidden options. Add RTL arrow fixture. Keep toggle-mode tab stops and pressed semantics unchanged.
2. **Engine task:** in `Tabs.tsx` and tab branch of `ViewToggle.tsx`, wire `Tabs.Root/List/Tab` and actual panel relationships without adding extra page panels. Preserve `tabIds.ts`, route callbacks/tab-switch marker and active scrolling. Do not pass hidden options to the keyboard collection. Leave toggle branch as native `aria-pressed` buttons; no unnecessary ToggleGroup dependency/semantics change.
3. **GREEN:** `vtest src/components/ui/__tests__/ViewToggle.test.tsx src/components/ui/__tests__/ViewToggle.groupRole.test.tsx src/components/ui/__tests__/Tabs.keyboard.test.tsx src/components/ui/__tests__/Tabs.a11y.test.tsx src/components/shell/__tests__/AppShell.tabFocus.test.tsx pages/__tests__/Projects.mobileViewToggle.test.tsx`. Retain AC-MOB-VT-002 and #879 actual-focus goal.

### 06 — Tooltip (LIB-017)

1. **RED:** extend `src/components/ui/__tests__/Tooltip.test.tsx` to preserve pre-existing description IDs, Escape-dismiss while trigger remains focused, hover across trigger-to-tip gap and portal positioning. New hover behavior needs signed maintenance criterion before implementation.
2. **Engine task:** replace local clone/state/geometry listeners in `Tooltip.tsx` with Tooltip Provider/Root/Trigger/Portal/Positioner/Popup; compose the existing child ref and event handlers, merge description IDs, retain `.tooltip-surface`, title/content and non-interactive content policy. Do not add focusable actions inside a tooltip.
3. **GREEN:** `vtest src/components/ui/__tests__/Tooltip.test.tsx src/components/dashboard/EngineerDashboard.test.tsx src/components/dashboard/PMDashboard.test.tsx`. Browser fixture verifies viewport clamp/hover and no tooltip over modal actions.

### 07 — Toast engine compatibility (LIB-025)

1. **RED:** extend `src/components/ui/__tests__/Toast.accessibility.test.tsx` with a nested modal/open/close sequence proving persistent remedy remains announced/dismissible and queued urgent items keep order, dedup and error priority. First prove Base UI Toast can satisfy the current policy in isolation; a fit failure keeps the facade implementation and returns to Director, not a weakened test.
2. **Policy task:** keep `ToastApi` overloads and existing priority/dedup/cap policy as a small explicit adapter. Preserve 4–10s text-length timing, infinite urgent lifetime, hover/focus pause and one visual toast. Configure Toast manager/provider timers/viewport; do not maintain two simultaneous expiry timers or two announcement sources.
3. **Engine task:** wire `Toast.Provider/Viewport/Root/Title/Description/Close` in `Toast.tsx`, preserve safe modal/mobile action-strip placement and the remedy queue; remove obsolete AutoDismiss/live-region scheduling only once equivalent announcements are demonstrated with the vendor owner.
4. **GREEN:** `vtest src/components/ui/__tests__/Toast.accessibility.test.tsx src/components/ui/__tests__/Toast.cap.test.tsx src/components/ui/__tests__/ToastDialogGeometry.test.tsx src/components/ui/__tests__/Tooltip.test.tsx`. Browser/screen-reader spot-check required; no claim that `role=alert` snapshots prove spoken timing.

### 08 — Account menu (LIB-011)

1. **RED:** create `src/components/shell/AccountMenu.test.tsx`: Arrow/Home/End, Escape return, Tab exit, radio state and keyboard item selection. Add typeahead only after signed criterion; existing behavior must not change silently.
2. **Engine task:** replace menuItems/whole-document focus scans and absolute popup in `AccountMenu.tsx` with `Menu.Root/Trigger/Portal/Positioner/Popup/Item/LinkItem/RadioGroup/RadioItem`; keep same callbacks, role-view policy inputs, theme and language choices. Use logical end alignment.
3. **GREEN:** `vtest src/components/shell/AccountMenu.test.tsx src/components/shell/__tests__/ContextBar.test.tsx src/components/shell/ContextBar.test.tsx src/components/shell/__tests__/ContextBar.touchTarget.test.tsx`. Test phone viewport and a scrolled shell.

### 09 — Inbox popover (LIB-013)

1. **RED:** extend `src/components/shell/__tests__/NotificationBell.test.tsx`: focus an inbox entry, Escape closes and returns to bell; outside activation does not steal intentional focus; load-more failure retains rows.
2. **Engine task:** wire Popover Trigger/Portal/Positioner/Popup in `NotificationBell.tsx`; keep a semantic list, named heading, keyset query/read callbacks and loading/retry states, not menuitems. Delete its document listeners and absolute positioning.
3. **GREEN:** `vtest src/components/shell/__tests__/NotificationBell.test.tsx src/components/shell/AccountMenu.test.tsx`. Browser fixture checks collision at phone width and nested modal open from a notification.

### 10 — Project action menu (LIB-012)

1. **RED:** extend `components/__tests__/ProjectStatusControl.popover.test.tsx` with keyboard select/cancel/return and retained confirmation-before-write; Escape from any nested form closes only the intended surface.
2. **Engine task:** replace only target selection popup with Menu parts in `components/ProjectStatusControl.tsx`; retain legal-target derivation, staged confirmTarget/pendingTarget and the inline win form. Keep trigger mounted while its menu is open; do not change transition mutations or allowed roles.
3. **GREEN:** `vtest components/__tests__/ProjectStatusControl.popover.test.tsx components/ProjectStatusControl.test.tsx`. This is a presentation migration, not permission or money-path redesign.

### 11 — Drawer and receipt preview (LIB-003/004)

1. **RED:** extend `src/components/ui/__tests__/Drawer.test.tsx` and `ReceiptPreview.test.tsx`: conditional unmount returns focus, nested confirmation owns Escape, PDF iframe exit has a working outside-frame Close and keyboard path. Use browser fixture for iframe behavior.
2. **Engine task:** replace Drawer trap/portal/document listener with Dialog parts, preserving record header/footer/width and nestedOpen interface during transition. Replace ReceiptPreview modal shell with Dialog; keep kind detection, active-request guard, URL callback, failure/unsupported download action and image/PDF rendering.
3. **GREEN:** `vtest src/components/ui/__tests__/Drawer.test.tsx src/components/ui/__tests__/ReceiptPreview.test.tsx src/lib/__tests__/DrawerActivation.guard.test.ts`. Keep AC-UXS-012 and drawer activation guard; do not alter authorized URL retrieval.

### 12 — Generic import modal shell (LIB-006)

1. **RED:** extend `src/components/import/__tests__/ImportWizard.test.tsx` with wizard opened from MobileToolbarDisclosure, Escape during committing, then normal close/focus restore. Preserve wizard mounted through its commit.
2. **Engine task:** replace only `ImportWizard.tsx` modal title/description/backdrop/portal/focus lifecycle with Dialog; keep steps, raw native mapping select, progress/results and close lockout. Do not force the wizard into EntityFormModal's single-submit contract.
3. **GREEN:** `vtest src/components/import/__tests__/ImportWizard.test.tsx src/components/import/__tests__/ImportWizard.overflow.test.tsx src/components/import/__tests__/useImportWizard.test.tsx src/components/ui/__tests__/MobileToolbarDisclosure.test.tsx`. Retain `scripts/e2e-local.sh AC-IMP-011` at this touched import journey.

### 13 — Cycle import modal shell (LIB-007)

1. **RED:** extend `src/components/import/__tests__/ProcurementCycleImportWizard.test.tsx`: Escape cannot interrupt committing, retry retains grouped preview, closing returns to surviving import opener.
2. **Engine task:** replace only Cycle wizard shell/local trap/document listener in `src/components/import/procurementCycle/ProcurementCycleImportWizard.tsx` with Dialog parts; keep grouped preview expansion, commit order, conflict results and hooks unchanged.
3. **GREEN:** `vtest src/components/import/__tests__/ProcurementCycleImportWizard.test.tsx src/components/ui/__tests__/MobileToolbarDisclosure.test.tsx`. Preserve `scripts/e2e-local.sh AC-IMP-CYCLE-001` cross-stack import goal.

### 14 — AI composition modal shell (LIB-005)

1. **RED:** create `src/components/builder/AIComposerModal.overlay.test.tsx`: named dialog entry/return, close during pending state follows current policy, error remains readable, nested form does not also dismiss.
2. **Engine task:** in `src/components/builder/AIComposerModal.tsx`, replace portal/Tab scan/document keys with Dialog parts and same title/error references. Keep text limit, request hook, cancellation semantics and result callback.
3. **GREEN:** `vtest src/components/builder/AIComposerModal.overlay.test.tsx src/hooks/useAIComposer.test.ts`. Read the agent-surface ADRs before implementing; no agent prompt/tool/model change is authorized by this modal slice.

### 15 — Inline disclosure/field polish, no new engine (LIB-010/021/024/029)

1. **RED:** extend `src/components/ui/__tests__/FormFields.test.tsx` to assert each emitted describedby ID exists when helper and error are both supplied; add keyboard-accessible reveal test without exposing any entered values in fixture logs. Extend `MobileToolbarDisclosure.test.tsx` for mixed vendor/legacy child modal and sibling trigger sequence.
2. **Field task:** in `FormFields.tsx`, include helper ID only while helper is rendered and preserve error ID; give reveal a reachable native keyboard path only after signed maintenance criterion (do not alter validation timing). No Formik/RHF/Field engine conversion.
3. **Disclosure task:** keep MobileToolbarDisclosure inline/focus policy. Replace its global dialog discovery only if a tested overlay-state seam can preserve child commit lifetime, sibling click and focus; otherwise leave it intact. Characterize Set-vendor inline editor naming in `pages/__tests__/ProcurementDetails.tabshell.test.tsx`, then correct semantics if Director confirms region rather than dialog. No accordion requirement invented.
4. **GREEN:** `vtest src/components/ui/__tests__/FormFields.test.tsx src/components/ui/__tests__/MobileToolbarDisclosure.test.tsx src/components/ui/__tests__/TaxBasisLabel.test.tsx pages/__tests__/ProcurementDetails.tabshell.test.tsx components/ProjectClassificationFilters.test.tsx`.

### 16 — Mobile rail modal owner (LIB-008)

1. **RED:** extend `src/components/shell/__tests__/AppShell.test.tsx`: rail open, nested confirmation open, close child and verify rail still traps/locks; close rail and verify former scroll value/focus restored. Desktop Tab remains free.
2. **Engine task:** replace mobile rail wrapper with Dialog; retain persistent desktop Rail instance semantics, breakpoint, route-focus logic and backdrop skin. Remove this surface's body overflow writes and useFocusTrap invocation only after vendor owns them.
3. **GREEN:** `vtest src/components/shell/__tests__/AppShell.test.tsx src/components/shell/__tests__/AppShell.tabFocus.test.tsx src/components/shell/ShellChrome.coldMount.test.tsx`. Browser fixture must test body scroll and visual viewport; no DB reset.

### 17 — Mobile assistant modal owner (LIB-009/035)

1. **RED:** extend `src/components/panel/AssistantPanel.mobile.test.tsx`: modal phone mode isolates/locks, child confirmation close does not release parent, close preserves transcript and returns opener. Desktop mode remains complementary with free Tab, and resizing does not make it modal.
2. **Engine task:** wire mobile Dialog with keep-mounted portal/content; preserve open state/runtime provider, composer, desktop resize and transcript nodes. Remove independent overflow/background writes and mobile manual trap. Do not duplicate mobile and desktop transcripts.
3. **GREEN:** `vtest src/components/panel/AssistantPanel.mobile.test.tsx src/components/panel/AssistantPanel.test.tsx src/components/panel/AssistantPanel.resize.test.tsx src/components/panel/AssistantPanel.dock.test.tsx src/components/panel/AssistantPanel.credits.test.tsx src/components/panel/Transcript.test.tsx`. Read agent ADRs first; this slice touches shell mechanics only.

### 18 — Checkbox and feature switch (LIB-026/027)

1. **RED:** extend `src/components/ui/__tests__/Checkbox.test.tsx`: visible label activation, Space/Enter per current contract, disabled no-change and controlled rerender. Create `pages/__tests__/AdministrationFeatures.switch.test.tsx` binding the real page's named switch and checked state.
2. **Engine task:** wire Base UI Checkbox behind current label/labelledBy/onChange contract, keep current tokens/size and explicit boolean values. Replace AdministrationFeatures' custom button switch with Base UI Switch while keeping policy, mutation and feature labels. Do not introduce native form submissions accidentally.
3. **GREEN:** `vtest src/components/ui/__tests__/Checkbox.test.tsx src/components/ui/__tests__/checkboxBorderContrast.test.ts pages/__tests__/AdministrationFeatures.switch.test.tsx`. Keep label-click compatibility with existing consumers, mixed-state support and all contrast geometry tests.

### 19 — Conditional multiline mention pilot (LIB-015)

1. **RED:** extend `src/components/comments/CommentsSection.test.tsx`: type trailing mention, ArrowDown/Enter inserts exactly selected plain-text name; Escape preserves comment; cap, disabled/empty/error and post/delete behaviors remain. Director must supply signed multiline/caret criteria first.
2. **Fit task:** prototype Base UI Autocomplete composition against the **real multiline textarea** contract. Do not replace textarea with single-line input to make the library fit. If fit fails, KEEP current suggestions pending a separate decision; no second library automatically approved.
3. **Engine task (only after fit):** in `CommentsSection.tsx`, vendor list interaction/active-option announcements while retaining activeMention/parser, picked IDs, five-item cap and post hook; no rich text, caret-position popup or data-model change.
4. **GREEN:** `vtest src/components/comments/CommentsSection.test.tsx`. This existing suite owns mention insertion and comment-post/delete goals; do not invent a drawer companion test as baseline evidence.

### 20 — Reuse installed plural engine (LIB-044)

1. **RED:** add Indonesian locale cases in `src/components/shell/__tests__/CommandPalette.test.tsx` and `NotificationBell.test.tsx` for 0/1/2 count announcements. Add `src/lib/i18n/pluralCallsites.test.tsx` importing the actual nine source-family exports in LIB-044 (render their public components with existing mocks; call the actual timesheet helper), proving zero/one/two preserve scope/meaning and localized age/count text. Do not copy count logic into a test helper.
2. **Catalogue task:** add literal plural-aware keys in `public/locales/en/common.json` and `public/locales/id/common.json`, using existing namespace convention and `count`. Do not add a second plural engine or dynamic computed translation keys.
3. **Call-site tasks (one 2–5-minute edit per listed source):** replace shell result/unread assembly and cycle-wizard record captions with literal `t(key, { count })` calls. In `timesheet-edit.ts`, import the default i18next instance from `./i18n` and `type TFunction` from `i18next`, then use `saveToastForChangeCount(changeCount: number, translate: TFunction = i18next.t): [title: string, sub: string, kind: 'info' | 'success']`; preserve zero-save semantics and pass the page's translator at its existing Timesheets call. In SalesPipeline/ProcurementApprovalRow, use the existing formatRelativeTime seam after a signed age/rounding criterion, not a second date engine. In ProjectedMarginBars/AwaitingApprovalTile/IntegrationsView, replace one/many key choice with a single literal count key preserving current zero/error/scope logic. Keep numeric badge cap, live priority and all mutation behavior.
4. **GREEN:** `vtest src/lib/i18n/pluralCallsites.test.tsx src/components/shell/__tests__/CommandPalette.test.tsx src/components/shell/__tests__/NotificationBell.test.tsx src/lib/i18n/i18n.test.ts src/lib/timesheet-edit.test.ts src/lib/__tests__/timesheet-edit.noop.test.ts pages/__tests__/SalesPipeline.bahasa.test.tsx pages/approvals/__tests__/ProcurementApprovalRow.test.tsx src/components/dashboard/ProjectedMarginBars.test.tsx src/components/dashboard/AwaitingApprovalTile.test.tsx src/components/integrations/IntegrationsView.health.test.tsx src/components/import/__tests__/ProcurementCycleImportWizard.test.tsx`; then `(cd pmo-portal && npm run check:i18n)`. Rebase catalogue changes immediately before the PR, per translation-file concurrency rule.

### 21 — Reference cleanup and lane closure (LIB-033/034/035/036)

1. **RED:** create `src/components/ui/__tests__/overlayOwnership.test.tsx` composing the actual form, picker, confirmation, toolbar and toast wrappers: one Escape -> one top surface; inner close preserves outer isolation/lock; last close restores trigger; persistent remedy remains reachable. This tests the shipped facades, not copied trap helpers.
2. **Cleanup task:** search all five roots **and** `App.tsx`/other app source for `useFocusTrap`, `acquireBackgroundInert`, manual overflow writes and per-migrated-surface document keys. Delete `src/hooks/useFocusTrap.ts` only at zero real imports. Delete `backgroundInert.ts` only if Base UI integration already preserves existing inert tests; otherwise keep the compatibility seam explicitly. Leave product shortcut, toolbar policy, timeout/debounce and DataTable lane code alone.
3. **GREEN:** `vtest src/components/ui/__tests__/overlayOwnership.test.tsx src/components/ui/__tests__/ConfirmDialog.test.tsx src/components/ui/__tests__/EntityFormModal.focus.test.tsx src/components/ui/__tests__/MobileToolbarDisclosure.test.tsx src/components/ui/__tests__/ToastDialogGeometry.test.tsx`. Full changed-importer local gate plus CI, lane-closing logged browser dispatch and rendered Discover on rich seed at 390/1440, both themes/languages. Graduate every finding into owning test + matrix + DESIGN/decisions note.
4. **Evidence task:** repeat Linux initial/lazy gzip comparison; record actual retired LOC without double-counting shared files, remaining compatibility helpers and any conditional KEEP outcome. Revert a failed individual slice, not all facades at once.

## 7. Risks, remaining decisions and handoff

- **Spec boundary:** Director approval of ADR-0089 and a signed maintenance spec/AC mapping for new behavior are needed before the corresponding build slice. This document does not turn a source risk into a signed requirement. In particular decide tooltip hover persistence, account-menu typeahead, picker role structure and mention multiline/caret support.
- **Vendor fit:** first-slice browser/a11y/themeability probe is a merge gate per ADR-0030. React 19 JSDOM open/close passed, not the entire feature matrix. Toast and mention pilots may legitimately conclude KEEP; do not import a second kit to rescue sunk work.
- **Source compatibility:** branch is a snapshot; rebase each new PR on dev and re-read touched facade/tests. Avoid the concurrent DataTable lane; row-menu internals are inventoried but not assigned to this portfolio. No hidden source edits in a docs commit.
- **Bundle/license:** exact direct Base UI pin and Linux lock regeneration; public subpaths, one installed version, no copied vendor internals. BlockNote's installed package license differs from Base UI's MIT license; this decision neither re-licenses nor re-evaluates the existing editor. Measure eager bytes rather than claiming transitive reuse is free.
- **Mixed overlays:** library isolation may not set the exact inert attribute current tests/users rely on; preserve observable contract explicitly. Mobile rail/assistant/form dialogs, tooltip/picker portals and toast host are the critical stack, not just centered-dialog screenshots.
- **Scaling:** picker lists, transcript, Gantt and full exports have different growth limits. Retain keyset loading and caps; profile realistic fixtures before adding windowing/workers or changing user-visible result completeness. No new DB table/cache layer is warranted by this census.
- **Release:** dev only, no push in this task. Future slices require three code reviewers and FE Discover/acceptance as applicable. No claim of production readiness is based on this static decision alone.

The handoff is the **90-family inventory, 21-slice portfolio and ADR-0089**, not executable application changes. Director's next executable step: accept/revise the foundation decision, attach the maintenance AC mapping, then dispatch slice 01 in a fresh isolated worktree.

## 8. Decision-deliverable verification

Executed in this docs-only worktree:

- `bash scripts/check-adr-collisions.sh`: PASS (no duplicate number; 0089 follows highest existing 0088).
- Inventory validation: PASS, LIB-001 through LIB-090 contiguous/unique, category totals agree with 65 K / 25 U / 0 A; complete inline registers total 14 details, 16 other expansions, 31 date fields, 9 raw selects and 9 standalone forms.
- Explicit single-source LOC citations and existing test/catalogue paths checked against the checkout: PASS. New test files in the migration plan are intentionally future artifacts, not existing evidence.
- Base UI React 19/JSDOM Dialog open/name/close/focus-return probe: PASS. In-memory minified gzip envelope probe: PASS; numbers in ADR-0089. No source/package changes or installed dependencies were made by these probes.
- Optional application baseline attempt: shared test slots stayed occupied; wrapper acquisition timed out (exit 75) **before typecheck or Vitest started**. Therefore no application baseline pass is claimed. Source/test lint, DB/e2e and a full application build are not docs-only gates. The migration instructions above still require all normal code gates when executed.
- `git diff --cached --check` after staging only the two requested Markdown files: PASS. Commit carries no attribution trailer; no push is authorized.
