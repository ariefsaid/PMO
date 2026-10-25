# Shell inventory and builder evidence — #806

Audited against `origin/dev` base `2c74a13f` on 2026-10-25. **Current facts** below are distinct from the **target proposal** in [shell.md](shell.md). Labels are literal catalogue values, including capitalization; user-authored view/record names remain user content. No live workspace data was used.

## Deciding artifacts

All paths below are relative to the repository root unless linked.

- [Rail.tsx](../../../pmo-portal/src/components/shell/Rail.tsx): `ALL_ITEMS`, `GROUP_ORDER`, filtering, saved views and utilities; [routeMatch.ts](../../../pmo-portal/src/components/shell/routeMatch.ts): `MODULES`, palette role set, parent mapping and breadcrumbs.
- [App.tsx](../../../pmo-portal/App.tsx): `appRouteConfig`, public routes, `ShellChrome` palette composition, real-role/operator handling, record identity and navigation callbacks.
- [AppShell.tsx](../../../pmo-portal/src/components/shell/AppShell.tsx), [ContextBar.tsx](../../../pmo-portal/src/components/shell/ContextBar.tsx), [Breadcrumb.tsx](../../../pmo-portal/src/components/shell/Breadcrumb.tsx), [BackBar.tsx](../../../pmo-portal/src/components/shell/BackBar.tsx): persistent rail, phone drawer, header and return controls. [index.css](../../../pmo-portal/index.css) decides the persistent rail's ≤920px hide/zero-column breakpoint; current desktop rail is 224px and header 56px. There is currently no user-toggleable compact desktop rail.
- [AccountMenu.tsx](../../../pmo-portal/src/components/shell/AccountMenu.tsx), [NotificationBell.tsx](../../../pmo-portal/src/components/shell/NotificationBell.tsx), [ApprovalsNavCount.tsx](../../../pmo-portal/src/components/shell/ApprovalsNavCount.tsx), [CommandPalette.tsx](../../../pmo-portal/src/components/shell/CommandPalette.tsx): menu, inbox, count and search behaviour.
- The rail's literal translation calls are in `src/components/shell/Rail.tsx`; actual catalogues live in [EN common.json](../../../pmo-portal/public/locales/en/common.json) and [ID common.json](../../../pmo-portal/public/locales/id/common.json), under `shell.nav`, `shell.rail`, `shell.contextBar`, `admin.nav` and `admin.access`. Cost attribution uses `public/locales/{en,id}/costAttribution.json`.
- [Administration.tsx](../../../pmo-portal/pages/Administration.tsx) decides section navigation; `src/auth/policy.ts` supplies its UX eligibility. `src/auth/impersonation.tsx` decides demo Admin preview availability. `src/lib/features.ts` and `src/hooks/useOrgFeatures.ts` decide feature resolution; `src/lib/viewspec/paletteItems.ts` supplies palette view shortcuts.
- Jobs: [PRODUCT.md](../../../PRODUCT.md), [ExecutiveDashboard.tsx](../../../pmo-portal/pages/ExecutiveDashboard.tsx), and `src/components/dashboard/{PMDashboard,FinanceDashboard,EngineerDashboard,MobileExecutiveDashboard}.tsx`. Admin uses the Executive body, not a separate Admin dashboard. Engineer's dashboard currently concentrates on hours/status; tasks, expenses and meetings are existing route jobs, not claimed dashboard widgets.

## Current shell inventory — one navigation/control table

Role columns describe an ordinary account with no preview. **R** = rail/drawer; **P** = palette Navigate; **V** = palette Views; **T** = top bar; **A** = Account menu; **S** = Administration section navigation; **B** = breadcrumb/Back; **—** = absent from that surface. A gate in parentheses applies only to that letter. This inventories discoverability, not a new permission contract. Record/action results still follow the existing viewer's data and action rules.

Rail gates: **c** CRM; **!c** CRM off; **p** procurement; **t** timesheets; **i** incidents; **r** revenue; **v** saved-views flag and at least one saved view; **a** Assistant flag; **m** personal-integration entitlement. Gates are runtime-dependent, not claims about a particular deployment. Revenue uses the existing ownership-derived default unless explicitly selected; unresolved defaults must retain the existing loading behaviour. Palette Navigate reads `MODULES`; its entries are marked independently from gated rail entries.

| Current surface/group | Label EN / ID | Destination or effect | Admin | Executive | Finance | PM | Engineer | Current phone equivalent |
|---|---|---|---|---|---|---|---|---|
| Pinned above groups | Approvals / Persetujuan | `/approvals`; pending count when complete/current | RP | RP | RP | RP | — | Same first drawer link/count |
| Overview / Ringkasan | Dashboard / Dashboard | `/`; role dashboard | RP | RP | RP | RP | RP | Same drawer link |
| CRM / CRM | Sales Pipeline / Pipeline Penjualan | `/sales` | R(c)P | R(c)P | R(c)P | R(c)P | — | Same drawer link |
| CRM | Companies / Perusahaan | `/companies` | R(c)P | R(c)P | R(c)P | R(c)P | — | Same drawer link |
| CRM | Contacts / Kontak | `/contacts` | R(c)P | R(c)P | R(c)P | R(c)P | — | Same drawer link |
| Delivery / Pelaksanaan | Projects / Proyek | `/projects` | RP | RP | RP | RP | RP | Same drawer link |
| Delivery | Procurement / Pengadaan | `/procurement` | R(p)P | R(p)P | R(p)P | R(p)P | — | Same drawer link |
| Delivery | Vendors / Vendor | `/companies?type=Vendor`; existing Companies filter | R(!c)P | — | R(!c)P | R(!c)P | — | Same drawer link when CRM off |
| Delivery | Incidents / Insiden | `/incidents` | R(i)P | R(i)P | R(i)P | R(i)P | R(i)P | Same drawer link |
| Delivery | Meetings / Rapat | `/meetings` | RP | RP | RP | RP | RP | Same drawer link |
| Finance / Keuangan | Sales Invoices / Faktur Penjualan | `/sales-invoices` | R(r) | R(r) | R(r) | R(r) | — | Same drawer link |
| Finance | Incoming Payments / Pembayaran Masuk | `/incoming-payments` | R(r) | R(r) | R(r) | R(r) | — | Same drawer link |
| Finance | Financial statements / Laporan keuangan | `/financial-statements`; real-role visibility even during preview | RP | RP | RP | — | — | Same drawer link |
| Finance | Revenue by Project / Pendapatan per Proyek | `/revenue-by-project` | R(r) | R(r) | R(r) | R(r) | — | Same drawer link |
| Finance | Management pack / Laporan manajemen | `/reports` | R(r) | R(r) | R(r) | R(r) | — | Same drawer link |
| Workforce / SDM | Timesheets / Timesheet | `/timesheets` | R(t)P | R(t)P | — | R(t)P | R(t)P | Same drawer link |
| Workforce | Expenses / Biaya | `/expenses` | RP | RP | RP | RP | RP | Same drawer link |
| Workforce | My Tasks / Tugas Saya | `/my-tasks` | RP | — | RP | RP | RP | Same drawer link |
| My Views / Tampilan Saya | `<saved name>` / `<saved name>` | `/views/:viewId`; rail first eight, palette all supplied views subject to result cap | R(v)V | R(v)V | R(v)V | R(v)V | R(v)V | Same drawer shortcuts; same search dialog |
| Rail utility | Assistant / Asisten | Open panel; pressed state reflects visibility; also Cmd/Ctrl+J | R(a) | R(a) | R(a) | R(a) | R(a) | Same drawer button closes drawer and opens panel |
| Rail foot | Administration / Administrasi | `/administration`; Finance → `/administration/exchange-rates` | RP | RP | RP | RP only if Operator | RP only if Operator | Same drawer link |
| Rail recovery / palette | Check Administration access / Periksa akses Administrasi | `/administration/users` when membership lookup errors for a non-Admin/non-Executive; Finance may also have ordinary entry | — | — | RP on error | RP on error | RP on error | Same drawer recovery link/search option |
| Top bar | Open navigation menu / Buka menu navigasi | Open phone drawer; close = Close navigation menu / Tutup menu navigasi | T | T | T | T | T | Phone-only menu trigger; desktop persistent rail |
| Top bar | Search or jump to… / Cari atau lompat ke… | Open command palette; accessible name Open command palette / Buka palet perintah; Cmd/Ctrl+K | T | T | T | T | T | Search icon with same accessible name/shortcut |
| Top bar | `Notifications, {{count}} unread` (literal English in EN/ID) | Open Notifications inbox / Kotak masuk notifikasi; zero live text No unread notifications / Tidak ada notifikasi yang belum dibaca | T | T | T | T | T | Same bell and inbox |
| Inbox | `<notification text>` / `<notification text>` | Mark read; entity → record, task/timesheet → owning queue, run-only → Assistant run; no target → mark read only | T | T | T | T | T | Same list, load more/retry and close behaviour |
| Top bar | Account menu / Menu akun | Open single responsive personal menu | T | T | T | T | T | Avatar-only trigger, same menu contents |
| Account | Profile & preferences / Profil & preferensi | `/settings/profile`; language, number format and timezone | A | A | A | A | A | Same menu link; no current inline language toggle |
| Account | My integrations / Integrasi saya | `/integrations` | A(m) | A(m) | A(m) | A(m) | A(m) | Same menu link |
| Account → Theme / Tema | Light / Terang; Dark / Gelap | Apply theme and selected radio state | A | A | A | A | A | Same radio choices |
| Account → View as role / Lihat sebagai role | Executive; Project Manager; Finance; Engineer (literal enum labels in both locales) | Preview one role; Return to Admin / Kembali ke Admin clears preview | A only for eligible demo Admin | — | — | — | — | Same choices, real identity and preview banner |
| Account → Legal & support / Legal & dukungan | Terms / Ketentuan | `/terms` | A | A | A | A | A | Same menu link |
| Account → Legal & support | Privacy / Privasi | `/privacy` | A | A | A | A | A | Same menu link |
| Account → Legal & support | Help / Bantuan | Configured support destination; new tab; only when supplied | A conditional | A conditional | A conditional | A conditional | A conditional | Same link |
| Account | Sign out / Keluar | Existing sign-out action | A | A | A | A | A | Same menu action |
| Palette → Records / Data | `<record name/reference>` / `<record name/reference>` | Search records/references; open canonical project, purchase, company, contact, incident, invoice or payment result supplied by existing searches | P | P | P | P | P | Same dialog; results viewer-scoped, eight/group |
| Palette fallback | `Ask AI: "{{query}}"` (literal English in EN/ID); subtitle Open the assistant with this draft / Buka asisten dengan draf ini | Open Assistant with draft query; never auto-send | P(a), no matches | P(a), no matches | P(a), no matches | P(a), no matches | P(a), no matches | Same dialog action |
| Record frame | `<parent>`; Back to {{label}} / Kembali ke {{label}} | Parent breadcrumb anchor / contextual collection return | B | B | B | B | B | Current crumb only in header; in-page BackBar on adopting records |
| Administration sections | Users / Pengguna | `/administration/users` | S | S | — | S if Operator | S if Operator | Same section links, two-column phone reflow |
| Administration sections | Organization integrations / Integrasi organisasi | `/administration/integrations` | S | S | — | S if Operator | S if Operator | Same section links |
| Administration sections | Accounting setup / Pengaturan akuntansi | `/administration/accounting` | S | S | — | S if Operator | S if Operator | Same section links |
| Administration sections | Project setup / Pengaturan proyek | `/administration/projects` | S | S | — | S if Operator | S if Operator | Same section links |
| Administration sections | Credits / Kredit | `/administration/credits` | S | S | — | S if Operator | S if Operator | Same section links |
| Administration sections | Exchange rates / Kurs mata uang | `/administration/exchange-rates` | S | — | S | S if Operator and permitted | S if Operator and permitted | Same section links |
| Administration sections | Cost attribution / Alokasi biaya | `/administration/cost-attribution`; Admin/Executive encounter embedded Accounting section instead of separate nav entry | Embedded Accounting | Embedded Accounting | S | — | — | Same role-specific placement |
| Administration → Platform / Platform | Usage / Pemakaian | `/administration/usage` | S if Operator | S if Operator | S if Operator | S if Operator | S if Operator | Same section link |
| Administration → Platform | Features / Fitur | `/administration/features` | S if Operator | S if Operator | S if Operator | S if Operator | S if Operator | Same section link |

The current rail display order is pinned Approvals → Overview → CRM → Delivery → Finance → Workforce → My Views → Assistant → Administration → build version; rows within each group follow the table. The palette's Navigate order is Dashboard → Sales Pipeline → Procurement → Projects → Timesheets → Companies → Vendors → Contacts → Incidents → Meetings → Expenses → My Tasks → Approvals → Financial statements → Administration, filtered by its role set. Records appear only with a query; Views is a separate group whose heading is the literal English `Views` in both locales. `/views` itself is currently reached outside the rail's saved shortcuts. Build version is non-interactive text.

Current active-state facts: `deriveRailActiveOverride` selects Sales Pipeline for pipeline/lost project records, Projects for delivery/internal records; `breadcrumbForPath` roots all canonical project records at Projects. `/erp-purchases` highlights Procurement. The target deliberately replaces stage-derived active ownership with canonical Projects ownership (N-01/N-04); named source-list return is independent.

## Target role order and movement rationale

These are proposed placements, not permission changes. Read each row left to right; Dashboard precedes all groups. Apply the current role and feature conditions from the inventory, omit empty groups, and retain the verified Operator Setup exception. The labels below are current EN item labels; use their ID catalogue partners above. Views follows the job groups; Assistant, Administration and build version occupy the utility foot.

| Role | Ordered groups and items after Dashboard |
|---|---|
| Admin | My work: Approvals → My Tasks → Timesheets → Expenses; Deliver projects: Projects → Meetings → Incidents; Manage money: Sales Invoices → Incoming Payments → Procurement → Revenue by Project → Financial statements → Management pack; Work with partners: Sales Pipeline → Companies → Contacts (or Vendors when CRM off); Workspace setup: Administration. |
| Executive | My work: Approvals → Timesheets → Expenses; Deliver projects: Projects → Meetings → Incidents; Manage money: Sales Invoices → Incoming Payments → Procurement → Revenue by Project → Financial statements → Management pack; Work with partners: Sales Pipeline → Companies → Contacts; Workspace setup: Administration. No My Tasks or Vendors item, as today. |
| Finance | My work: Approvals → My Tasks → Expenses; Manage money: Sales Invoices → Incoming Payments → Procurement → Revenue by Project → Financial statements → Management pack; Deliver projects: Projects → Meetings → Incidents; Work with partners: Sales Pipeline → Companies → Contacts (or Vendors when CRM off); Workspace setup: Administration → Exchange rates → Cost attribution inside that area. No Timesheets item, as today. |
| PM | My work: Approvals → My Tasks → Timesheets → Expenses; Deliver projects: Projects → Meetings → Incidents; Work with partners: Sales Pipeline → Companies → Contacts (or Vendors when CRM off); Manage money: Sales Invoices → Incoming Payments → Procurement → Revenue by Project → Management pack. No Financial statements or ordinary Administration item, as today. |
| Engineer | My work: My Tasks → Timesheets → Expenses; Deliver projects: Projects → Meetings → Incidents. No ordinary approval, purchasing, financial, partner-directory or Administration items, as today. |

| Move or merge | Why / retained home |
|---|---|
| Overview group → ungrouped Dashboard | Start with the role's priorities; remove an uninformative one-item heading. |
| Workforce → My work; My Tasks before Timesheets/Expenses | Complete work before recording it; expenses are personal work across roles. |
| Approvals → first My work link, no duplicate pinned link | Decisions are actionable work; Dashboard, Work heading and its single Approvals row remain above the scrolling destinations. |
| Procurement: Delivery → Manage money | Purchase evidence belongs beside spending and payment work; `/erp-purchases` remains its named child, not a second purchase feature. |
| CRM → Work with partners | Opportunities, companies and contacts support winning/coordinating work; keep distinct collection destinations. When CRM is off, Vendors keeps the existing purchasing-directory route and filter. |
| Delivery → Deliver projects | Projects first; Meetings and Incidents stay alongside delivery context. |
| Saved views → permanent Views collection entry plus saved shortcuts | Empty and ninth-view cases still have a visible home at `/views`; creation/edit stay in that collection. Proposed group label Views / Tampilan. |
| Administration → utility foot under Workspace setup | Infrequent shared setup remains separate from daily work; Finance keeps its existing two section destinations. |
| Header breadcrumb → content-track ancestry/return | Keep identity and navigation beside the page they describe; top bar carries the area and global utilities. |
| Language preference → direct Account choices, full preferences retained | Switch EN/ID in place without losing the current job; use the existing saved preference. |
| Canonical project active item → Projects for every stage | Stable object identity; source-aware Back still restores the Sales Pipeline lens. |

No entity feature is merged or removed. Existing creation, review, export, configuration and Assistant actions stay within their owning screens/panel. The palette should expose the same permitted destination vocabulary as navigation, retaining English aliases in ID, record/reference search, result limits, retry, keyboard operation and Ask AI draft behaviour; it is an accelerator, never the only route home.

## Every route retains a reachable home

This table covers the route patterns in [areas.md](../areas.md) and `App.tsx`, including conditional surfaces. Parameters below are placeholders for synthetic records, not literal navigation URLs. Keep current access/feature outcomes and redirects. Named project/procurement section navigation preserves every existing `:tab` deep link; it is not a new global rail list.

| Routes / variants | Target home and way in | Return / reason |
|---|---|---|
| `/*` | Authenticated shared frame wrapping operational routes | Keep global navigation and recovery available throughout. |
| `/` for all five roles | Dashboard first link | Role priorities; no forced new landing page. |
| `/projects`; `/projects/new`; `/projects/:projectId`; `/projects/:projectId/:tab` | Deliver projects → Projects; permitted New project action; record name links; named record sections | Collection return with scope/sort/scroll; `overview`, `budget`, `procurement`, `tasks`, `work-orders`, `billing`, `documents`, `history` all retained. |
| `/sales`; `/sales/:opportunityId` | Work with partners → Sales Pipeline; existing compatibility link redirects to `/projects/:projectId` | Back to Sales Pipeline restores its lens; canonical project ancestry/active item remains Projects. |
| `/sales-invoices`; `/sales-invoices/:invoiceId` | Manage money → Sales Invoices; existing inline create and invoice links | Same scoped invoice list; invoice scope links its project/customer. |
| `/incoming-payments`; `/incoming-payments/:receiptId` | Manage money → Incoming Payments; existing inline capture and payment links | Same scoped receipts list and associated invoice/project. |
| `/revenue-by-project` | Manage money → Revenue by Project | Preserve period/project scope in URL. |
| `/financial-statements` | Manage money → Financial statements for its current roles | Selected statement/period stays in URL. |
| `/reports` | Manage money → Management pack, when enabled | Period and report controls retained. |
| `/procurement`; `/procurement/new`; `/procurement/:procurementId`; `/procurement/:procurementId/:tab` | Manage money → Procurement; New purchase action; record links and named sections | `overview`, `items`, `documents`, `quotes`, `history` retained; return to source purchase list. |
| `/erp-purchases` | Procurement → named ERP purchase-evidence link | Parent Procurement stays visible; retain existing attribution/evidence actions. |
| `/expenses`; `/expenses/new`; `/expenses/:claimId` | My work → Expenses; permitted claim/advance creation; claim link | Return to source claims list; preserve project and claim identity. |
| `/timesheets` | My work → Timesheets for its current roles | Week/project scope and existing submission outcomes retained. |
| `/approvals` | My work → Approvals for its current roles | Request opens its existing evidence/record; return restores queue. |
| `/my-tasks` | My work → My Tasks for its current roles | Assigned work across projects; record opens existing project/task context. |
| `/meetings`; `/meetings/new`; `/meetings/:meetingId` | Deliver projects → Meetings; create action; meeting links | Contextual source list return; preserve minutes and unsaved-edit guard. |
| `/incidents`; `/incidents/:incidentId` | Deliver projects → Incidents when enabled | Existing create flow and record links; source incident list return. |
| `/companies`; `/companies/:companyId`; `?type=Vendor` | Work with partners → Companies or conditional Vendors; company links | Same canonical Companies directory/filter; retain customer/vendor roles and detail. |
| `/contacts`; `/contacts/:contactId` | Work with partners → Contacts when enabled for role | Source directory return; company parent visible in scope. |
| `/views`; `/views/new`; `/views/:viewId`; `/views/:viewId/edit` | Views collection link when enabled; create/edit actions; saved shortcuts/name links | `/views` is the named parent even with zero or more than eight saved views; no Dashboard-labelled return substitute. |
| `/administration` | Workspace setup utility → Administration | Keep existing role redirect and recognized legacy hashes. |
| `/administration/users`; `/administration/integrations`; `/administration/accounting`; `/administration/projects`; `/administration/credits` | Administration → existing named section links | Shared setup grouped separately from personal integrations; retain read/write distinctions. |
| `/administration/exchange-rates`; `/administration/cost-attribution` | Finance Administration → Exchange rates / Cost attribution; Admin retains Exchange rates and embedded Accounting cost attribution | Existing permitted controls and direct bookmarks retained. |
| `/administration/usage`; `/administration/features` | Administration → Platform section for verified Operators | Conditional navigation remains conditional, not a new base role. |
| `/administration/:section` | Existing Administration fallback/legacy bookmark resolution | Normalize to Users as today; keep recognized fragments and their destinations. |
| `/integrations` | Account → My integrations when entitled | Personal connection context; separate from organization setup. |
| `/settings/profile` | Account → Profile & preferences | Full preference form retained alongside in-place language choices. |
| `/terms`; `/privacy` | Account → Legal & support and existing entry-page legal links | Public reading outside operational shell; no forced authentication. |
| `/login`; `/reset-password`; `/update-password` | Existing sign-in, recovery and recovery-message flows | Keep standalone entry frame and existing success/return behaviour. |
| `/oauth/consent` | Existing authorization entry link/redirect | Retain consent allow/decline flow outside normal job navigation. |
| `*` | Unknown-URL recovery offers a named Dashboard home | Recovery state stays reachable without inventing a collection. |

## Screenshot checklist

- [ ] Build a manifest from **every route pattern in the route-home table**, including every project/procurement section, create/edit mode, Finance record, Administration section and public/recovery route. Instantiate synthetic records; do not use private data. For conditional routes, capture the enabled reachable state and the existing disabled-feature/access outcome.
- [ ] Each instantiated route/state gets **390×844 and 1440×900 × light/dark × EN/ID** (eight captures). For `/`, capture all five role bodies. On `/projects`, capture navigation for all five roles and verified Operator variants; exercise every permitted link once so hiding/group omission never strands an existing feature. Feature variants: CRM on/off, procurement/time on/off, revenue native/ERP/explicit selection/loading, incidents on/off, saved views zero/one/eight/nine/disabled, Assistant on/off, personal integrations on/off.
- [ ] On `/projects`, pair desktop expanded/compact navigation and phone drawer open/closed; capture long ID labels, keyboard focus and utility-foot reachability. Verify consistent responsive behaviour at 920/921px by interaction as well, without substituting these for requested 390/1440 captures.
- [ ] At both requested widths/themes/languages, capture Account open, Language selection, theme change and eligible role preview/banner; sign-out/legal/profile/integration doors still work. Screenshot synthetic identity only. Capture Assistant overlay/docked/closed states when enabled, preserving content width, keyboard operation and route context.
- [ ] On `/projects` and a synthetic record, capture palette empty query, localized/English-alias match, exact reference match, no results, loading and failure/retry; notification zero/unread, loading/empty/error and paginated results; Approvals known zero/nonzero/unavailable totals. Loading/error must keep global navigation usable.
- [ ] Pair filtered/sorted `/projects`, `/sales`, `/procurement`, `/companies`, `/contacts`, `/meetings`, `/sales-invoices` and `/incoming-payments` lists with open-record → named return and browser Back. Record before/after URL, period/filter/sort and scroll. Direct deep links, pending identity, missing record and dirty-edit Stay/Leave get their own captures. Use stable parent names rather than raw identifiers.
- [ ] Verify PA-01/02/04 (page type, alignment, no repeated summary chrome), N-01–04 (location, return, sections, canonical URL), A-01–04 (single primary, placement, naming, disabled reason), E-01 (inherited scope), C-01 (toolbar order), S-01/03 (named honest counts) and L-01/02 (plain matched vocabulary). Preserve existing colours/fonts/radii. Mechanical evidence: one h1, no document overflow, every phone target ≥44×44, zero axe serious/critical and empty Impeccable detector findings. Owner approves rendered screens, not this document as visual proof.

## Test disposition

**No tests are deleted in this docs task.** On recomposition delete assertions whose only oracle is a particular arrangement, class, glyph, size, tint or shadow; retain each independent behavioural oracle in a mixed test. A class currently used to approximate accessibility is not proof of actual touch size, no clipping or a visible selection: retain that requirement, prove it in the browser, and remove the obsolete class pin. Do not delete whole suites merely because they appear in the first table.

Paths in these two tables start at `pmo-portal/src/components/shell/__tests__/`.

| Existing test file | Look assertions to delete on recomposition; retained goal where mixed |
|---|---|
| `Rail.iconSemantics.test.tsx` | Exact per-item glyph mapping, 17px SVG and 11px overline assertions. Keep accessible destination names and decorative-icon `aria-hidden` semantics. |
| `Rail.approvals.test.tsx` | Pinned-strip/scroll-region DOM placement. Keep reachable Approvals, Sales link, correct count, navigation callback, Engineer absence and unknown-not-zero oracle. |
| `Rail.test.tsx`; `Rail.stage-aware.test.tsx` | `bg-primary/10`/active-class matching. Keep one identifiable current destination; update stage cases to canonical Projects ownership for this intentional IA change. |
| `AppShell.test.tsx` | Exact two-row grid/area/column strings, `.rail-persistent` wrapper shape, no-tabstrip grid-area layout pin, no-viewport-width class check. Keep no extra workspace-tab job, responsive access, actual no-overflow, main-scroll return contract, landmarks/focus/skip link, Assistant open/dock/overlay reflow and persistence. |
| `AppShell.mobile.test.tsx` | Exact `100dvh` spelling, 20ch clipping, paired breakpoint classes, `px-4` gutter and style/class safe-area checks. Keep usable viewport, named return at every width, drawer modal/trap/inert/scroll-lock/focus/Escape/scrim and safe-area clearance; browser evidence replaces geometry proxies. |
| `BackBar.test.tsx` | Exact `flex`, `hidden`, `max-[920px]:flex` assertions. Keep named contextual return and activation; verify actual availability at both layouts. |
| `CommandPalette.test.tsx` | Shadow/backdrop and selected/non-selected tint classes; `truncate`, `break-words`, `break-all`, `whitespace-nowrap` class pins. Keep modal semantics, visible/current selection, readable complete identifier/context, ranking, filtering, limits, retries and focus. |
| `ContextBar.test.tsx`; `ContextBar.touchTarget.test.tsx` | Exact menu glyph, 220px width, `truncate` and `touch-target` classes. Keep recognizable named menu, identity fit/no overflow, actual ≥44×44 target, single personal menu and all keyboard/action tests. |
| `NotificationBell.test.tsx` | F1/F2/F3 colour-class assertions and severity-dot composition pin; exact Load more `touch-target` class. Keep non-colour severity words, count semantics, actual target size, live region, polling, paging/retry, mark-read and destination actions. |

| Behaviour suites to keep | What they prove |
|---|---|
| `Rail.rbac.test.tsx`, `Rail.finance-approvals.test.tsx`, `Rail.financialStatements.test.tsx`, `Rail.operator.test.tsx`, `Rail.features.test.tsx`, `Rail.odnar2.test.tsx`, `Rail.vendorsWithoutCrm.test.tsx`, `Rail.managementPack.test.tsx`, `Rail.reports.test.tsx` | Existing destination visibility, conditional routes, role/Operator distinctions and revenue resolution; adapt named group selectors only. |
| `Rail.assistant.test.tsx`, `ApprovalsNavCount.keys.test.tsx`, `AccountMenu.integrations.test.tsx`, `FeatureGate.route.test.tsx` | Assistant toggle/gate, count-source scope and freshness, personal integration doorway and gated deep-link outcomes. |
| `AppShell.tabFocus.test.tsx`, `AppShell.test.tsx`, `AppShell.mobile.test.tsx`, `ContextBar.test.tsx`, `ContextBar.honesty.test.tsx`, `ContextBar.touchTarget.test.tsx`, `NotificationBell.test.tsx` | Route focus versus same-record section change, scroll return, modal/background isolation, personal controls, honest live counts and touch accessibility; preserve goals when replacing class proxies. |
| `Breadcrumb.test.tsx`, `breadcrumb.locale.test.tsx`, `breadcrumb-nav.test.ts`, `BackBar.test.tsx` | Parent links, native modified-clicks, localized named return and identity; adapt to content-track placement. |
| `routeMatch.test.ts`, `routeMatch.rbac.test.ts`, `routeMatch.operator.test.ts`, `routeMatch.approvals.test.ts`, `routeMatch.stage.test.ts`, `railActiveOverride.test.ts` | Canonical route/parent/name resolution and role matching; change stage-active expectations to Projects, preserving source-list return and all name/loading/missing-record cases. |
| `CommandPalette.test.tsx`, `CommandPalette.askAi.test.tsx` | Keyboard selection/Enter/Escape, focus restore, localized and English aliases, exact-reference ranking, duplicate suppression, bounded results, loading/error and draft-only Assistant fallback. |

Additional shell tests **outside** `__tests__`: keep `pmo-portal/src/components/shell/Rail.test.tsx`, `ContextBar.test.tsx`, `ShellChrome.test.tsx` and `ShellChrome.coldMount.test.tsx` for real-role visibility, shared menu routing, view shortcuts and cache-only cold-mount behaviour.

| Existing e2e path (from `pmo-portal/e2e/`) | Disposition |
|---|---|
| `AC-1201-responsive-rail.spec.ts` | Keep persistent/drawer navigation reachability and Approvals visibility within available height; replace implementation-specific wrapper/duplicate-nav selectors as needed. Its bounding checks prove access, not a chosen decoration. |
| `UIP-002-navigation-polish.spec.ts` | Keep actual no-overflow, route navigation, drawer closing and focus return; delete the exact menu glyph assertion. |
| `AC-1202-token-utilities-paint.spec.ts` | Delete the active-tint/blue-channel/selection presentation pins; retain the computed-token-paint regression oracle using token swatches independent of shell composition, and verify accessible current/selected state. No old composition golden is authoritative. |
| `UXS-006-shell-vocabulary-bahasa.spec.ts`; `UXS-007-pm-my-tasks-discovery.spec.ts`; `AC-CMDK-007-cmdk-record-search.spec.ts`; `AC-S40-005-search-finance-reference.spec.ts`; `AC-AT2-007-askai-prefill.spec.ts` | Keep shared language/aliases, task discovery, canonical record/reference opening and no-auto-send Ask AI journey. |
| `AC-LRC-003-projects-return.spec.ts`; `AC-LRC-004-sales-return.spec.ts`; `AC-LRC-005-procurement-return.spec.ts`; `AC-LRC-006-companies-return.spec.ts`; `AC-LRC-007-contacts-return.spec.ts`; `AC-LRC-008-meetings-return.spec.ts`; `AC-LRC-009-browser-back.spec.ts`; `serial/AC-LRC-013-locale-phone-return.spec.ts` | Keep source-list filters/sort/scroll, locale-aware phone return and browser Back goals; adapt steps for new breadcrumb/Back placement. |
| `AC-LEG-024-mobile-account-menu.spec.ts`; `serial/AC-PLC-007-personal-locale-preferences.spec.ts`; `AC-AUTH-010-demo-admin-view-role.spec.ts` | Keep legal menu links, saved language/number/timezone and view-only role preview with real identity; add direct Account-language interaction without losing full preference coverage. |
| `AC-ADMIA-001-administration-navigation.spec.ts`; `AC-ADMIA-005-administration-mobile.spec.ts`; `AC-RAM-001-ris-admin-first-project.spec.ts`; `AC-MTG-300-unsaved-minutes.spec.ts` | Keep Administration links/legacy hashes, phone reachability/overflow, setup → project → return and dirty-edit Stay/Leave. |

The full e2e suite still gates route journeys beyond this shell-focused list; only the explicitly named appearance assertions are disposable. Behaviour/a11y/role/money expectations remain oracles, not obstacles to weaken for green.

## Applied design references

The worktree did not contain generated `.claude/skills`; read the primary checkout's vendored `impeccable`, `taste` and `ui-ux-pro-max` copies. Impeccable context plus `reference/shape.md`, `operate.md` and `layout.md` informed predictable task order, proximity and structural phone adaptation. Taste informed consistent left alignment, complete states and restrained containers; its optional font/colour/radius/motion recipes are superseded by this brief's fixed tokens.

Ran UI UX Pro Max `scripts/search.py` with `--domain ux` for `navigation grouping`, `app shell sidebar` (no match; retried `sidebar navigation`), `breadcrumb hierarchy`, `mobile navigation drawer` and `command palette keyboard`. Applicable matches covered visible keyboard navigation, predictable Back, breadcrumb hierarchy, skip links and non-obscuring navigation. There was no specific app-shell, drawer or command-palette recipe: those details above are PMO proposals grounded in current code and UX-STANDARD, not database-backed prescriptions.
