⚠️ DEGRADED: single-context review, explicitly requested; no subordinate agents or independent reviewers.

# Area A — rendered UX discovery · 2026-10-10

## Five-line verdict

1. Preserve the PMO zinc/blue/Inter identity, familiar record pages, shared forms, and compact shell; this is not a redesign.
2. Real local sign-ins, company/contact creation, and an opportunity advancing to won succeeded; the core product is usable.
3. The highest-impact gaps are disconnected exception signals, PM personal-work discoverability, and navigation vocabulary that ignores the saved language.
4. Fix these before adding decoration; then repair pipeline scan density, metric definitions, and operational empty-state guidance.
5. **Fix-then-review; coverage BLOCKED for Assistant opening:** no panel could be opened in the supplied running configuration; external sign-in/email-link completion also remains unverified.

## Top 10 fixes — ranked by user impact

| Rank | Fix | Finding | Severity / effort |
|---|---|---|---|
| 1 | Give the phone Executive risk count its own adjacent, risk-specific doorway. | UXD-A-001 | High / M |
| 2 | Expose PM **own assigned work**, without replacing project-level oversight. | UXD-A-008 | High / M; owner decision |
| 3 | Make localized destinations searchable and keep rail/palette/breadcrumb terminology aligned. | UXD-A-002 | High / M |
| 4 | Turn Finance budget exceptions into canonical project-budget links. | UXD-A-006 | Med / S |
| 5 | Label realized margin explicitly and retain definitions on phone. | UXD-A-003 | Med / M |
| 6 | Fit the pipeline's decision fields into the desktop working width; restore a compact toolbar. | UXD-A-004 | Med / M |
| 7 | Finish localization of the role dashboards and their operational accessible names. | UXD-A-005 | Med / M |
| 8 | Use the same translated lifecycle labels in the pipeline list and record. | UXD-A-009 | Med / S |
| 9 | Replace the accounting empty state's unexplained infrastructure instruction with a role-appropriate next step. | UXD-A-007 | Med / S |
| 10 | Give KPI explanations a readable, viewport-clamped width. | UXD-A-010 | Med / S |

No Critical product defect is established by this bounded UX pass. High findings obstruct finding/choosing work; Med findings create recurring comprehension or navigation effort. S/M are relative implementation scopes, not delivery estimates.

## Method, deciding artifacts, and evidence

Reviewed the running app at `http://127.0.0.1:5200` using **only `disc-A`**, real local persona sign-ins, desktop **1440×900**, phone **390×844**, account theme controls, and saved language preferences. Read `DESIGN.md`, `docs/product-expectations.md`, `docs/jtbd.md`, `pmo-portal/App.tsx`, and `docs/reviews/2026-10-09-ui-polish-critique.md`; consulted agent-browser core/dogfood, impeccable critique/audit, taste, and UX-guideline references. Source reads below map rendered observations to owners; they are not substitutes for screenshots.

`SHOTS` means:

```text
/private/tmp/claude-502/-Users-ariefsaid-Coding-PMO/abd5a194-c2a4-469e-b763-f2a75f07ec08/scratchpad/disc-a/
```

All screenshot names below are relative to `SHOTS`. These are **private local evidence**, not repository attachments. Do not publish the images without sanitizing them. No demo identities, email addresses, or credentials are reproduced in document text. Evidence is **before-only**: no app-source fixes were made, so no after-image or passing regression result is claimed.

The brief specifies five lenses:

1. **Visual consistency** — DESIGN tokens, hierarchy, spacing, responsive coherence.
2. **Best practice / accessibility** — semantics, keyboard use, recognized conventions, recovery.
3. **Effort** — unnecessary screens, activations, re-entry, decisions, scanning.
4. **Intuitiveness / intent** — user mental model, canonical homes, adjacent action, JTBD.
5. **Guidance / labels** — names, explanations, bilingual instructions, state messages.

These also cover the design-review charter's Visual, IxD, IA, and Intent concerns. Financial arithmetic, authorization enforcement, and live-model quality are not assessed here.

### Coverage and limits

| Surface | Rendered evidence / exercised outcome | Limits |
|---|---|---|
| Executive dashboard | `executive-{1440,390}-{light,dark}.png` and corresponding `-id.png`; help, notifications, project search, risk-list drill | Phone exception drill required leaving the dashboard and selecting risk. Metrics vary as parallel local reviews add data; percentages are not reconciliation findings. |
| PM dashboard | `pm-{1440,390}-{light,dark}.png` and corresponding `-id.png`; canonical project open → Tasks | Own task list opened directly; palette lookup was also tested. No task statuses changed. |
| Finance dashboard | `finance-{1440,390}-{light,dark}.png` and corresponding `-id.png`; populated pay queue/budget review, accounting empties | No invoice, receipt, approval, or payment submitted. |
| Engineer dashboard | `engineer-{1440,390}-{light,dark}.png` and corresponding `-id.png` | Hours/status and logging doorway inspected; no hours or timesheet submission written. |
| Shell | `rail-390-dark.png`, `account-390-dark.png`, `search-1440-light.png`, `notifications-1440-light.png`, palette shots below | Drawer Escape, account menus, and project-name search/Enter worked. No exhaustive focus-order, zoom, contrast, or performance certification. |
| Companies / Contacts | English light/dark desktop/phone captures; Indonesian populated/empty/form/detail captures; `company-new-1440-light-id.png`, `company-empty-1440-light-id.png`, `company-contact-saved-1440-light-id.png` | One new local company and contact created. Company context correctly prefilled the contact form. Invalid email was tried, but blur-only feedback was inconclusive; not promoted into a defect. |
| Sales Pipeline | `sales-{board,table}-1440-{light,dark}-id.png`; phone Indonesian board/table; English desktop/light and desktop/phone dark; `pipeline-record-1440-light-id.png`, `pipeline-won-{confirm,failure,saved}-1440-light-id.png` | New local opportunity only: Leads → Pre-Qualification → Quotation → Tender → won, pending KoM. Empty contract submission produced localized required-field errors; valid contract reference/date succeeded. Remaining phone English light/state combinations need acceptance coverage. |
| Profile preferences | `profile-1440-light.png`, `profile-390-light.png`, light/dark Indonesian captures, `profile-{1440,390}-dark.png` | Language selection and explicit save exercised across roles; number-format examples inspected. Full timezone persistence, save-failure, and unsaved-navigation journeys not claimed. |
| Login | `login-{1440,390}-light.png`, `login-1440-dark.png`, `login-magic-sent-390-dark.png`, `login-microsoft-390-dark.png` | Persona sign-in succeeded. Magic-link request confirmed, not mailbox/link completion. Microsoft hand-off did not reach a usable sign-in screen in this fixture; no diagnosis or product defect inferred from the external response. |
| Assistant | `assistant-search-1440-light.png`, shell/account snapshots for Executive, Engineer, and Admin | No visible entry; ⌘J/Ctrl+J did not open a panel, and palette search had no result. Source flag-gates agree with this configuration. No feature/configuration changes attempted. This blocks panel/opening assessment, not a finding that the enabled product lacks an entry. |

Loading/fault coverage is **not exhaustive**. Genuine no-match, notification-empty, CRM-empty, accounting-empty, and contract-validation states were rendered. No deliberately injected network failure or all-route error-state clearance is claimed. Intermittent CLI click/fill timing required fresh snapshots/keyboard activation; those automation effects are not labeled app defects. Phone means viewport emulation, not a physical touch-device test.

## Job-effort table

**Counting rule:** clicks below mean deliberate navigation/submit/control activations in the observed logical journey, including equivalent keyboard activation. They exclude typing keystrokes, focus-placement clicks, theme/persona setup, unsuccessful CLI retries, and inspection screenshots. A modal counts as a screen/state. These are reproducible journey counts, **not recorded physical mouse-event telemetry**. Fields count data inputs, including accepted defaults where stated. Minimums retain necessary lifecycle, validation, and confirmation steps.

| Role / job | Actual screens and activations | Fields / decisions | Minimum sufficient effort | Avoidable effort / fix |
|---|---|---|---|---|
| Executive: identify and open the phone's flagged project | Dashboard → all ongoing projects → risk-filtered list → flagged record: **3 activations**, 4 states; the phone card's doorway actually opened `?filter=Ongoing`. | 0 fields; choose all-project doorway, recognize risk filter, choose record: **3 decisions**. | 1 direct activation for a single named risk; 2 for a multi-risk filtered list. | **1–2 activations plus unrelated scanning**; 001. A lower dashboard project link is another route, but requires scrolling/recognizing the flagged name. |
| Executive: open a known project by search | ⌘K → enter project name → Enter → canonical record: **2 activations**, 2 states. | 1 query; 1 result choice. | Same. | No finding; preserve code/name search and canonical URL. |
| PM: find own overdue work | Ordinary dashboard/rail/palette exposed no own-work destination. A supplied direct URL opened My Tasks with multiple overdue assigned rows: **1 address navigation**, 1 destination; this is an audit bypass, not a discoverable journey. Dashboard project → Tasks was separately walked: **2 activations**, 3 states, for one chosen project. | 0 fields; choose which project, tab, then relevant task; repeats across projects. | Own-work entry → assigned overdue list: **1 activation**; oversight remains project → Tasks. | Avoid remembering a URL or repeating project triage; 008. Do not invent a completed overdue-work discovery path. |
| Finance: investigate a high-utilization budget row | Dashboard budget row is static text/progress; **no adjacent open action**. Current alternative requires finding that project through Projects/search and then its Budget tab. | 0 input fields at the signal; project identity must be remembered. | Named budget row → canonical Budget tab: **1 activation**. | Task cannot continue from the signal; 006. Alternative route is proposed, not counted as an observed complete investigation. |
| Engineer: recognize this week's hours/status and start logging | Dashboard presents hours, week, Draft status, and a prominent log-hours link; **0 activations to understand**, 1 available to start. | 0 fields/decisions for scan; 1 action choice to log. | Same. | No navigation defect established; downstream entry not submitted. |
| CRM: create company, add contact in company context | Company list → New company → create → list → new company record → New contact → create → same company record: **5 activations**, 7 states. | Company: 1 typed name + accepted Client type; contact: name/email/role, company prefilled. **5 user-supplied/accepted values**, plus 1 inherited company value; 2 substantive choices (type, contact role). | **4 activations** if company success offers open-record directly; same data inputs. | Optional 1 activation reduction via an **Open company / Buka perusahaan** success action; enhancement, not a top-10 defect. Existing contact-context prefill is good. |
| Sales: create and progress the new opportunity to won | New project → create → find/open record → advance three times → Mark won → empty submit → valid submit: **9 activations**; list/modal/record/contract-form states. Search used 1 query. | Create: name, client, estimate, tax-rate input; defaults/generated identity retained. Win: contract reference/date. **6 supplied values + 1 search query**; 3 phase-advance decisions and 1 win decision. | **8 activations** for the same sequential journey without the deliberate empty-validation probe. | Empty probe is audit-only, **not UX waste**. Do not collapse required stages/contract evidence. Stage-label mismatch adds interpretation, not a fabricated click; 009. |
| Any role: change language | Account menu → Profile → select language → Save: **4 activations**, 2 screens + menu. Successful translation/save observed. | 1 field, 1 choice. | Same. | No need for an onboarding wizard or automatic unsaved preference writes. Incomplete downstream translation is 002/005/009. |
| Login: access by password / magic link | Password: fill 2 fields → Sign in, **1 submit**. Magic link: fill email → request, **1 submit** → confirmation. | 2 or 1 fields; choose method. | Same request effort. | External Microsoft hand-off and magic-link completion are unverified; no invented end-to-end success. |
| Any role: open Assistant | Rail/account/palette inspected; shortcut tried; **no reachable panel in this configuration**. | 1 palette query; no prompt entered. | With feature enabled: **1 visible action or shortcut** to panel. | Fixture/configuration blocker. Re-run enabled without changing feature settings during this review. |

## Findings

All component paths below are relative to `pmo-portal/`. Proposed tests are **not implemented or run**; route them to ui-implementer with these screenshot oracles.

### UXD-A-001 — Phone risk signal leads to unrelated work

- **Route / role / job:** `/`, Executive. When scanning portfolio exceptions, identify the project needing intervention and open it (`docs/jtbd.md` dashboard/project job, Q3/Q4).
- **Lenses:** 1, 3, 4, 5. **Severity:** High (Important). **Effort:** M.
- **Evidence:** `executive-390-dark.png`, `executive-risk-390-dark.png`, `executive-risk-list-390-dark.png`, `executive-risk-open-390-dark.png`. The mobile attention card reports a risk count but only offers all active projects. Actual doorway opens the ongoing filter, not risk. Desktop has a separate risk-filtered link.
- **Owner:** `src/components/dashboard/MobileExecutiveDashboard.tsx`; compare `pages/ExecutiveDashboard.tsx`.
- **What breaks:** the Executive must scan unrelated ongoing work or add a filter before acting on the exception just shown. This is viewport-specific loss of task actionability, not a request for more charts.
- **Fix / copy:** put a named risk link beside a single risk; for several, link to the existing risk-filtered list. **en:** “Review at-risk project” / “Review {count} at-risk projects”. **id:** “Tinjau proyek berisiko” / “Tinjau {count} proyek berisiko”. Keep all-project browsing secondary.
- **Graduate:** component test for zero/one/many risks and destination; phone e2e with more than one active project proves the actual flagged record is reached. Matrix: `/ × Executive × 390 × risk adjacency`; retain the mobile/desktop action-parity rule in DESIGN.

### UXD-A-002 — Saved language is not navigation vocabulary

- **Route / job:** shell, `/companies`, `/contacts`; find a destination using the displayed language.
- **Lenses:** 2, 3, 4, 5. **Severity:** High (Important). **Effort:** M.
- **Evidence:** `palette-1440-light-id.png`, `palette-no-match-1440-light-id.png`, `companies-1440-light-id.png`, `company-contact-saved-1440-light-id.png`. Palette destinations remain English; **perusahaan** finds no destination; the Companies breadcrumb remains English above a translated H1. Table “Open…”, “Row actions”, and “Actions” accessible names also remain English.
- **Owners:** `src/components/shell/CommandPalette.tsx`, `src/components/shell/routeMatch.ts`, `src/hooks/useRecordSearch.ts`, `src/components/ui/DataTable.tsx`.
- **What breaks:** an Indonesian user must recall another language to navigate; spoken labels and visible page vocabulary disagree. WCAG language/label semantics need acceptance testing, not an unsupported contrast claim.
- **Fix / copy:** one translated route-label registry; search translated labels **and** familiar aliases without changing URL/role/feature rules. **en / id:** “Companies / Perusahaan”, “Contacts / Kontak”, “Projects / Proyek”, “Sales Pipeline / Pipeline Penjualan”, “Open {name} / Buka {name}”, “Row actions / Tindakan baris”, “Actions / Tindakan”.
- **Graduate:** unit-test localized alias matching and accessible names; bilingual shell journey selects each eligible localized destination and asserts canonical route plus matching breadcrumb. Matrix: `shell × en/id × destination vocabulary`; retention: shared visible/spoken/search labels must come from one vocabulary.

### UXD-A-003 — Metric meaning changes with viewport

- **Route / job:** `/`, Executive; distinguish revenue from margin before deciding intervention.
- **Lenses:** 1, 4, 5. **Severity:** Med (Important). **Effort:** M.
- **Evidence:** `executive-1440-light.png`, `executive-390-light.png`, `kpi-help-1440-light.png`. Desktop's revenue footer says only “{percent} realized”; phone identifies realized margin, but its replacement cards omit the desktop KPI definition controls.
- **Owners:** `pages/ExecutiveDashboard.tsx`, `src/components/dashboard/MobileExecutiveDashboard.tsx`, `src/components/ui/KPITile.tsx`.
- **What breaks:** a first-time Executive can interpret the revenue footer as cash realization rather than margin; phone readers cannot obtain the same in-product definition. This is terminology/parity, **not a claim that calculations are wrong**.
- **Fix / copy:** **en:** “Realized margin: {percent}”; **id:** “Margin terealisasi: {percent}”. Provide tap/focus help on phone: **“About this metric / Tentang metrik ini”**. Keep definitions and source-of-truth values shared across layouts.
- **Graduate:** component parity test for labels/definitions; mobile keyboard/tap-help journey that does not navigate the containing KPI. Matrix: `/ × Executive × viewport × metric meaning`; DESIGN retention: responsive summaries may omit detail, not redefine metrics.

### UXD-A-004 — Pipeline decision fields spill outside desktop working width

- **Route / job:** `/sales`, sales-operating PM/Executive; compare opportunities, stage, owner, recency, and weighted value before choosing the next follow-up.
- **Lenses:** 1, 2, 3, 4. **Severity:** Med (Important). **Effort:** M.
- **Evidence:** `sales-table-1440-light-id.png`, `sales-table-1440-dark-id.png`, `sales-board-1440-dark-id.png`, `sales-table-390-light-id.png`. Desktop table viewport measured **1157px** versus **1756px** scroll width; owner/last-touch live offscreen. Toolbar still stacks search, Classification, and Export vertically on desktop. The phone table card devotes a whole tall row to one opportunity; secondary tax/reference metadata competes with follow-up fields.
- **Owner:** `pages/SalesPipeline.tsx`; shared layout in `src/components/ui/DataTable.tsx`.
- **What breaks:** comparing recency/ownership against a named deal requires horizontal scanning rather than one row glance; the toolbar delays the board. Merely having horizontal scrolling is not the defect—**decision-relevant fields are separated**.
- **Fix:** use one wrapping desktop toolbar row; dedicate stable width to the name, then stage/value/owner/last-touch. Disclose end-customer and verbose tax/reference details through existing detail/secondary disclosure, preserving export and full record data. Make phone follow-up information a compact named summary before expanded metadata. **en / id copy:** “Project details / Detail proyek”, “Last activity / Aktivitas terakhir”, “No activity recorded / Belum ada aktivitas tercatat”. Preserve Project as the product noun; add no entity or route.
- **Prior-fix boundary:** yesterday's UIP-004 **Classification disclosure is already present**; do not reopen it. This is remaining desktop toolbar composition/decision-column fit, not expanded filters or the old Projects name-clipping finding.
- **Graduate:** rendered long-name/wide-money visual test verifies name/stage/value/owner/last-touch simultaneously visible at 1440; phone visual/semantic test preserves those fields and detail access. Matrix: `/sales × table/board × decision scan`; retain decision-first columns in DESIGN.

### UXD-A-005 — Role dashboards ignore the saved interface language

- **Route / job:** `/`, PM/Finance/Engineer; understand daily work and operational decisions in the selected language.
- **Lenses:** 1, 2, 4, 5. **Severity:** Med (Important). **Effort:** M.
- **Evidence:** `finance-1440-light-id.png`, `finance-390-light-id.png`, `pm-1440-dark-id.png`, `engineer-390-light-id.png`, `executive-1440-dark-id.png`. Indonesian shell/preferences coexist with “Finance Dashboard”, English intro/KPIs/ledger headings, “My Dashboard”, and English operational status/help labels. Executive approval/win-rate controls also retain English.
- **Owners:** `src/components/dashboard/PMDashboard.tsx`, `FinanceDashboard.tsx`, `EngineerDashboard.tsx`, `AwaitingApprovalTile.tsx`, `WinRateCard.tsx`, `pages/ExecutiveDashboard.tsx`; locale catalogs in `public/locales/en/common.json` and `public/locales/id/common.json`.
- **What breaks:** users must mentally translate the decision surface after explicitly saving Indonesian; partially translated shell suggests the preference was applied while the core job language was not.
- **Fix / copy:** localize headings, region names, KPI definitions, empty/error text, and control labels; do **not** translate customer-entered project names, accounting account names, or stored enum values. **en / id:** “Finance dashboard / Dashboard keuangan”, “My dashboard / Dashboard saya”, “Ready to pay / Siap dibayar”, “Budget review / Tinjauan anggaran”, “Awaiting your approval / Menunggu persetujuan Anda”, “Log this week's hours / Catat jam kerja minggu ini”.
- **Graduate:** per-role component tests in id including populated/empty/error branches and aria names; one saved-language cross-route journey. Matrix: `/ × role × en/id × operational vocabulary`; keep this distinct from shell registry work in 002 and lifecycle vocabulary in 009.

### UXD-A-006 — Finance budget insight has no adjacent lever

- **Route / job:** `/`, Finance; identify a budget approaching its limit and investigate the project (`docs/jtbd.md` spend-control job, Q4/Q5).
- **Lenses:** 2, 3, 4. **Severity:** Med (Important). **Effort:** S.
- **Evidence:** `finance-1440-dark.png`, `finance-ledger-1440-dark-id.png`. Budget review shows named projects, variance, and a high-utilization warning, but project cells are static. In the same dashboard, Ready to pay rows have a named open button. The a11y tree confirms the budget names have no link/button; source confirms no row-open handler on this table.
- **Owner:** `src/components/dashboard/FinanceDashboard.tsx` (`budgetColumns`, budget-review DataTable).
- **What breaks:** Finance can identify the project requiring investigation but must leave the signal and locate it again. This is **not** yesterday's UIP-011 PM-row finding; the PM canonical links are already present.
- **Fix / copy:** make the project name a semantic link into the canonical project **Budget** tab, preserving any valid return context. **en:** “Review {project} budget”; **id:** “Tinjau anggaran {project}”. Do not make every numeric cell an ambiguous action or alter amounts/ranking.
- **Graduate:** component test for named link/destination; Finance journey opens the high-utilization project's Budget tab from the signal and returns coherently. Matrix: `/ × Finance × budget insight → lever`; retain adjacent-action parity for reviewable summaries.

### UXD-A-007 — Accounting empty-state instruction is not executable by its reader

- **Route / job:** `/`, Finance; understand why aging is unavailable and what to do next.
- **Lenses:** 2, 3, 4, 5. **Severity:** Med (Important). **Effort:** S.
- **Evidence:** `finance-snapshots-1440-dark.png`; rendered AP/AR empty states say “Refresh the ERPNext binding to populate this snapshot.” No adjacent action or recognizable destination is supplied.
- **Owner:** `src/components/dashboard/AccountingSnapshotsSection.tsx` (`SnapshotBlock`).
- **What breaks:** a Finance reader is directed to an unfamiliar technical operation without knowing who can perform it or where. Empty aging must not be mistaken for zero outstanding debt. The instruction's wording, not the absence of data, is the defect.
- **Fix / copy:** separate unavailable snapshot from zero-balance data and route to the real existing integration owner only when permitted. **en:** “No aging data has been synced yet. Ask your administrator to sync accounting data.” **id:** “Data umur utang/piutang belum disinkronkan. Minta administrator menyinkronkan data akuntansi.” For an eligible operator, optional action **“Open accounting connection / Buka koneksi akuntansi”** must lead to an existing actionable destination; do not add a cosmetic Refresh button that only refetches the empty cache.
- **Graduate:** unit tests for absent snapshot versus valid zero rows, role-appropriate copy/action, and distinct fetch-error retry; applicable action journey if a permitted destination exists. Matrix: `/ × Finance × accounting unavailable → guidance`; retain actionable empty-state ownership in DESIGN/decisions.

### UXD-A-008 — PM own assignments are visible by URL but not discoverable

- **Route / job:** `/` → `/my-tasks`, PM; find assigned overdue work across projects, then choose what to do first.
- **Lenses:** 2, 3, 4, 5. **Severity:** High (Important). **Effort:** M; **owner decision required**.
- **Evidence:** `pm-1440-light.png`, `pm-my-tasks-1440-light.png`, `pm-task-search-settled-1440-light.png`, `pm-project-task-work-1440-dark-id.png`. PM has actual assigned/overdue rows on My Tasks. Neither rail nor settled “My Tasks” palette search exposes that destination. Dashboard presents projects/financial health/approvals, not own overdue assignments. Project → Tasks works for individual-project work.
- **Owners:** `src/components/shell/Rail.tsx`, `routeMatch.ts`, `src/components/dashboard/PMDashboard.tsx`; destination `pages/MyTasks.tsx`.
- **What breaks:** a PM with personal assignments must know the URL or inspect projects separately; own work has no visible starting point. The fix is **not** to replace project oversight with an assignee-only list.
- **Prior-art boundary:** Rail/routeMatch explicitly cite OD-W2-4's Engineer/Admin-only personal navigation and managers' project oversight. `scripts/prior-art.sh 'My Tasks'` also points to DD-TASK-4's assignee-scoped surface. Treat this as a demonstrated job-fit tension requiring an explicit ruling, **not a silent permission/navigation expansion**.
- **Fix / copy:** if PM personal assignments are supported, add the assignee-only destination consistently to rail/palette or an equivalent prominent dashboard doorway. **en:** “My assigned tasks”, “My overdue tasks: {count}”. **id:** “Tugas yang ditugaskan kepada saya”, “Tugas saya yang terlambat: {count}”. Preserve project Tasks for oversight and all current enforcement boundaries. If owner intentionally excludes PM personal work, document how such assignments are to be handled instead.
- **Graduate:** PM fixture with own overdue assignment and another assignee's task; journey discovers own list without typing a URL and reaches only appropriate work. Component tests bind rail/palette/dashboard to the accepted ruling. Matrix: `/ × PM × own-work discovery`; retain own-assignment versus oversight distinction in decisions/JTBD.

### UXD-A-009 — Lifecycle vocabulary changes between list and record

- **Route / job:** `/sales` → `/projects/:id`, PM/Executive; advance the same opportunity with confidence.
- **Lenses:** 1, 2, 4, 5. **Severity:** Med (Important). **Effort:** S.
- **Evidence:** `sales-board-1440-light-id.png`, `pipeline-record-1440-light-id.png`, `pipeline-won-confirm-1440-light-id.png`, `pipeline-won-saved-1440-light-id.png`. List stages translate to Prospek/Pra-kualifikasi/Penawaran/Negosiasi, while the record stepper/status and embedded advance-target strings retain Leads/Pre-Qualification/Quotation/Negotiation/Won. Localized actions mix languages.
- **Owner:** `pages/project-detail/PipelineLens.tsx`, `pages/project-detail/ProjectDetailHeader.tsx`, `pages/SalesPipeline.tsx`, shared stage/status display-label helpers.
- **What breaks:** users must determine whether two labels represent the same stage before advancing. One entity/lifecycle should not need a bilingual mapping exercise (`docs/jtbd.md` §3 Name/Advance).
- **Fix / copy:** shared localized display labels, while preserving stored enums and transition rules. **en / id:** “Leads / Prospek”, “Pre-Qualification / Pra-kualifikasi”, “Quotation / Penawaran”, “Negotiation / Negosiasi”, “Won / Menang”; “Advance to Quotation / Lanjutkan ke Penawaran”; “Won — pending kickoff / Menang — menunggu rapat awal”. Use the domain-approved kickoff wording consistently.
- **Not a finding:** the record's **Projects** ancestry and canonical `/projects/:id` are deliberate in current `routeMatch.ts` (FIX-2); explicit Back to Sales Pipeline exists. Do not split record URLs or restore stale stage-ancestry prose merely because an older ADR/comment says so.
- **Graduate:** component test uses the same localized label for list/stepper/pill/advance target; Indonesian create→advance→win journey asserts coherent vocabulary and unchanged contract-validation requirements. Matrix: `/sales → /projects/:id × id × lifecycle consistency`; retain one label per enum across surfaces.

### UXD-A-010 — Help tooltip becomes a thin column instead of readable explanation

- **Route / job:** `/`, Executive/Admin-rendered Executive view; understand the projected-margin definition.
- **Lenses:** 1, 2, 3, 5. **Severity:** Med (Important). **Effort:** S.
- **Evidence:** `kpi-help-1440-light.png`, `kpi-margin-help-1440-light.png`. Actual tooltip DOM measured **96.7px wide × 258.6px high**, font **12.5px**. The explanation wraps into one/two words per line and overlaps the surrounding dashboard despite ample desktop space.
- **Owner:** `src/components/ui/Tooltip.tsx`, consumed by `src/components/ui/KPITile.tsx`.
- **What breaks:** the user requested help but receives a needlessly difficult-to-read paragraph. `max-width:280px` alone is not a readable preferred width; source confirms shrink-to-fit absolute positioning inside a small inline trigger wrapper.
- **Fix / copy:** give explanatory tooltips a sensible preferred width, capped to viewport minus gutters; position/flip or portal so clipping ancestors do not trap them. Keep the DESIGN tooltip surface/type/elevation. Start with plain meaning; formula may be secondary. **en:** “Expected margin across open opportunities, adjusted for each stage's chance of winning.” **id:** “Perkiraan margin peluang aktif, disesuaikan dengan peluang menang di setiap tahap.” Preserve the complete domain definition rather than replacing it with inaccurate simplification.
- **Graduate:** browser visual/geometry test for short/long English/Indonesian definitions at both breakpoints; keyboard focus announces the description and help remains inside the viewport. Include hover/focus/dismissibility checks; Escape behavior was not conclusively verified here. Matrix: `shared Tooltip × long copy × viewport/locale`; retain preferred-width plus viewport-clamping rule in DESIGN.

## Five-lens synthesis

| Lens | Strengths actually observed | Issues / assessment |
|---|---|---|
| 1 — Visual consistency | Zinc surfaces, blue actions, hairlines, shared modal/table anatomy, stable typography, and the updated monoline navigation identity are recognizable in both themes. No gradient/new-aesthetic proposal is warranted. | Important: 003/004/005/009/010. Preserve tokens while correcting information layout and responsive meaning. |
| 2 — Best practice / accessibility | Skip link and semantic regions exist; account/drawer Escape and palette Enter-to-record worked; new-contact company context is prefilled; contract required-field feedback is localized and recoverable. | Important: 002/004/005/006/007/008/009/010. Named links/actions and localized spoken labels need acceptance proof. This is not an axe/contrast/all-keyboard pass. |
| 3 — Effort | Project-name search efficiently reaches the canonical record; CRM context prevents company re-entry; advancement stays on the same record. | Important: 001/002/004/006/007/008/010. Prioritize removing recall/rehunting over reducing legitimate contract/lifecycle steps. |
| 4 — Intuitiveness / intent | One canonical record home; explicit lifecycle actions; Engineer logging doorway; unified approval destination; stage-aware content is not a duplicate opportunity entity. | Important: 001/002/003/004/005/006/007/008/009. Highest concern: seeing an exception without its lever, or having assigned work without a visible home. |
| 5 — Guidance / labels | Preference fields show examples/effective settings; forms explain generated identity and required contract information; clear/no-match states are real rather than placeholder lorem. | Important: 001/002/003/005/007/008/009/010. Localize operational vocabulary and say who can execute recovery instructions. |

### IxD heuristic calibration

0 = no issue established in observed scope; 1 = cosmetic; 2 = recurring friction; 3 = serious discovery obstruction; 4 = demonstrated task failure. This is a sequential assessment, not independent scored reviewers.

| Nielsen heuristic | Score | Evidence |
|---|---:|---|
| System-status visibility | 2 | Margin meaning and unavailable-snapshot explanation (003/007). |
| Match with users' world | 2 | Mixed lifecycle vocabulary and infrastructure instruction (009/007). |
| Control/freedom | 0 | Drawer Escape, canonical record and explicit pipeline return observed. |
| Consistency/standards | 2 | Visible/spoken/search language mismatch (002/005/009). |
| Error prevention | 0 in tested win-form scope | Required contract data prevented empty win submission; no broad write-path certificate. |
| Recognition over recall | 3 | PM own-work destination and localized route discovery (008/002). |
| Efficiency | 2 | Phone risk detour and Finance rehunting (001/006). |
| Minimal presentation | 2 | Pipeline decision-column separation/toolbar stacking (004). |
| Error recovery | Pending overall | Localized win validation recovered; network/external sign-in recovery not verified. |
| Help/documentation | 2 | Narrow tooltip, absent phone definitions, unexplained binding instruction (010/003/007). |

Five-role walkthrough scope: Executive exception/search; PM portfolio→project Tasks and direct own-task list; Finance budget/payment-queue/snapshot interpretation; Engineer weekly-hours/status/logging entry; Admin shell/CRM/preferences and Assistant search. Do not mistake read-only Finance/Engineer inspection for completed monetary or timesheet writes.

## Cross-area patterns and graduation handoff

1. **Insight → adjacent lever:** 001 and 006 share the same defect class. Areas B/C should verify every exception count, warning row, and unavailable-data message has a contextual next action—not just a general module link.
2. **One vocabulary through every representation:** 002/005/009 span rail, palette, breadcrumb, list, record, accessible names, and help. Translation must follow the user job through a route transition; a translated H1 alone is not completion. Keep data labels distinct from user-entered names.
3. **Responsive meaning, not merely fit:** 003 shows a metric gaining clarity but losing help on phone. 004 shows metadata expanding while follow-up fields separate. Test the same decision at both sizes, not only screenshot dimensions.
4. **Own work versus oversight:** 008 should inform meeting actions/tasks elsewhere. Managers can also be assignees; adding a personal starting point must not turn oversight into an assignee-only view or expand authority.
5. **Empty-state ownership:** 007 illustrates a system-operation instruction presented to an operational reader. Distinguish zero data, not synced, loading, denied, and failed; only display actions the current reader can actually execute.
6. **Entitlement visibility is a fixture condition, not automatically a redesign:** CRM rail entries were absent while these routes were inspectable; `Rail.tsx` intentionally gates CRM. Do not propose always-on CRM navigation from this pass. Assistant was likewise unavailable. Re-run those entry-point checks with an owner-provided enabled fixture, without altering this shared app/configuration.
7. **No repeat of completed polish:** new icon semantics, Classification disclosure, compact clear queues, canonical PM links, and routable CRM records are present. Do not reopen yesterday's UIP-001/002/004/010/011 as though their prior state still ships. Pipeline scan-fit (004) and Finance budget links (006) are scoped residual/new problems, not those old findings.

For each accepted UXD item, ui-implementer should add the proposed lowest-layer test, the corresponding `routes × oracles` cell, and a DESIGN/decisions retention note in the implementation issue. This review itself edits **only this document**; it does not create tests/matrix/KB files or claim their graduation is complete. Render the fixes again against these before-images. PM navigation needs the owner ruling first.

## Operational closeout and completion limits

No app code, commits, server lifecycle changes, seeded-record deletion, feature toggles, or destructive actions were performed. New local review company/contact/opportunity were retained; the new opportunity is won, pending KoM. Locale preferences were exercised through the app; no number/timezone values were deliberately changed. Parallel local data may change; screenshot values are observations, not stable financial oracles.

`agent-browser --session disc-A close` completed successfully. No other browser sessions were closed. Only this review document is this reviewer's repository deliverable. Other concurrently produced Area documents are not edited.

**Overall assessment: fix-then-review.** The report is sufficient to route the established findings, but is not complete enabled-Assistant acceptance or a merge/ship clearance. To finish: supply an enabled Assistant fixture and verify a visible doorway, ⌘J, phone drawer entry, panel close/focus return, and bilingual states; separately complete the external sign-in/email-link round trips and untested state/phone combinations listed above.

DISCOVER-A-BLOCKED: Assistant could not be opened in the provided running configuration; enabled-panel discovery and interaction coverage remains unverified.
