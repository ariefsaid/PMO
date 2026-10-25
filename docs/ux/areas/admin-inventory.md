# Administration and integrations — code inventory and builder evidence

Companion to [admin.md](admin.md), #806 phase 2. Code baseline `d18ba06b`; inventories describe current rendering, target sections describe builder decisions. No product code is changed by this brief. Read PA-00 before using current blocks as composition input.

## PA-00 route jobs

Persona table describes actual roles, not permission expansion. `PM` means Project Manager. `Denied` means no ordinary workspace job at that destination; show the access outcome and a named return, never manufacture an administrative task. An independently verified Operator can be any of these personas: its additional job is explicitly listed below. Real permissions and view-only preview remain binding.

| Current route | Persona | Arriving here I expect to see… | The job I finish here is… |
|---|---|---|---|
| `/administration/users` | Admin | workspace members, roles and status | invite, assign reporting lines or change permitted membership details |
| `/administration/users` | Executive | the read-only member directory | identify the responsible person and reporting line |
| `/administration/users` | Finance | an access explanation, not configuration controls | return to my permitted work; no ordinary-role job here |
| `/administration/users` | PM | an access explanation, not configuration controls | return to my permitted work; no ordinary-role job here |
| `/administration/users` | Engineer | an access explanation, not configuration controls | return to my permitted work; no ordinary-role job here |
| `/administration/integrations` | Admin | shared services and setup exceptions | connect a service once and resolve ambiguous setup |
| `/administration/integrations` | Executive | shared connection readiness | identify the administrator action needed to restore business work |
| `/administration/integrations` | Finance | an access explanation, not configuration controls | return to my permitted work; no ordinary-role job here |
| `/administration/integrations` | PM | an access explanation, not configuration controls | return to my permitted work; no ordinary-role job here |
| `/administration/integrations` | Engineer | an access explanation, not configuration controls | return to my permitted work; no ordinary-role job here |
| `/administration/accounting` | Admin | saved accounting choices and incomplete posting setup | configure posting accounts, tax defaults and spend rules |
| `/administration/accounting` | Executive | the read-only accounting basis and approval responsibility | understand which saved setup governs a purchase or receipt |
| `/administration/accounting` | Finance | an access explanation, not configuration controls | return to my permitted work; no ordinary-role job here |
| `/administration/accounting` | PM | an access explanation, not configuration controls | return to my permitted work; no ordinary-role job here |
| `/administration/accounting` | Engineer | an access explanation, not configuration controls | return to my permitted work; no ordinary-role job here |
| `/administration/projects` | Admin | future numbering and available classifications | set the numbering convention and project choices |
| `/administration/projects` | Executive | the saved project conventions | understand how new projects will be identified and classified |
| `/administration/projects` | Finance | an access explanation, not configuration controls | return to my permitted work; no ordinary-role job here |
| `/administration/projects` | PM | an access explanation, not configuration controls | return to my permitted work; no ordinary-role job here |
| `/administration/projects` | Engineer | an access explanation, not configuration controls | return to my permitted work; no ordinary-role job here |
| `/administration/credits` | Admin | the exact shared credit balance | check whether Assistant work has available credits |
| `/administration/credits` | Executive | the exact shared credit balance | understand available Assistant capacity |
| `/administration/credits` | Finance | an access explanation, not configuration controls | return to my permitted work; no ordinary-role job here |
| `/administration/credits` | PM | an access explanation, not configuration controls | return to my permitted work; no ordinary-role job here |
| `/administration/credits` | Engineer | an access explanation, not configuration controls | return to my permitted work; no ordinary-role job here |
| `/administration/exchange-rates` | Admin | dated reference rates and their sources | upload history or correct a permitted reference rate |
| `/administration/exchange-rates` | Executive | an access explanation, not configuration controls | return to my permitted work; no ordinary-role job here |
| `/administration/exchange-rates` | Finance | dated USD-to-IDR reference rates | upload the history needed for display equivalents |
| `/administration/exchange-rates` | PM | an access explanation, not configuration controls | return to my permitted work; no ordinary-role job here |
| `/administration/exchange-rates` | Engineer | an access explanation, not configuration controls | return to my permitted work; no ordinary-role job here |
| `/administration/cost-attribution` | Admin | rules, project shares and effective posting dates | maintain attribution of untagged ledger costs |
| `/administration/cost-attribution` | Executive | read-only cost attribution rules | understand which projects receive untagged costs |
| `/administration/cost-attribution` | Finance | rules, project shares and effective posting dates | preview, save or end an attribution rule |
| `/administration/cost-attribution` | PM | an access explanation, not configuration controls | return to my permitted work; no ordinary-role job here |
| `/administration/cost-attribution` | Engineer | an access explanation, not configuration controls | return to my permitted work; no ordinary-role job here |
| `/administration/usage` | Admin | an Operator access check; if verified, aggregated consumption and diagnostics | as Operator, inspect consumption and diagnose unusual cost or latency; otherwise return to my work |
| `/administration/usage` | Executive | an Operator access check; if verified, aggregated consumption and diagnostics | as Operator, inspect consumption and diagnose unusual cost or latency; otherwise return to my work |
| `/administration/usage` | Finance | an Operator access check; if verified, aggregated consumption and diagnostics | as Operator, inspect consumption and diagnose unusual cost or latency; otherwise return to my work |
| `/administration/usage` | PM | an Operator access check; if verified, aggregated consumption and diagnostics | as Operator, inspect consumption and diagnose unusual cost or latency; otherwise return to my work |
| `/administration/usage` | Engineer | an Operator access check; if verified, aggregated consumption and diagnostics | as Operator, inspect consumption and diagnose unusual cost or latency; otherwise return to my work |
| `/administration/features` | Admin | an Operator access check; if verified, workspace capabilities and their availability | as Operator, change supported capabilities and verify the outcome; otherwise return to my work |
| `/administration/features` | Executive | an Operator access check; if verified, workspace capabilities and their availability | as Operator, change supported capabilities and verify the outcome; otherwise return to my work |
| `/administration/features` | Finance | an Operator access check; if verified, workspace capabilities and their availability | as Operator, change supported capabilities and verify the outcome; otherwise return to my work |
| `/administration/features` | PM | an Operator access check; if verified, workspace capabilities and their availability | as Operator, change supported capabilities and verify the outcome; otherwise return to my work |
| `/administration/features` | Engineer | an Operator access check; if verified, workspace capabilities and their availability | as Operator, change supported capabilities and verify the outcome; otherwise return to my work |
| `/integrations` | Admin | my own Microsoft 365 status, independent of shared setup | connect or reconnect my account, or deliberately disconnect it |
| `/integrations` | Executive | my own Microsoft 365 status, independent of shared setup | connect or reconnect my account, or deliberately disconnect it |
| `/integrations` | Finance | my own Microsoft 365 status, independent of shared setup | connect or reconnect my account, or deliberately disconnect it |
| `/integrations` | PM | my own Microsoft 365 status, independent of shared setup | connect or reconnect my account, or deliberately disconnect it |
| `/integrations` | Engineer | my own Microsoft 365 status, independent of shared setup | connect or reconnect my account, or deliberately disconnect it |
| `/administration` | Admin | the Users destination | recover a valid destination without a duplicate page |
| `/administration` | Executive | the Users destination | recover a valid destination without a duplicate page |
| `/administration` | Finance | the exchange-rate destination | recover a valid destination without a duplicate page |
| `/administration` | PM | my access outcome, or permitted setup if independently an Operator | recover a valid destination without a duplicate page |
| `/administration` | Engineer | my access outcome, or permitted setup if independently an Operator | recover a valid destination without a duplicate page |
| `/administration/:unknown-section` | Admin | the Users destination | recover a valid destination without a duplicate page |
| `/administration/:unknown-section` | Executive | the Users destination | recover a valid destination without a duplicate page |
| `/administration/:unknown-section` | Finance | the exchange-rate destination | recover a valid destination without a duplicate page |
| `/administration/:unknown-section` | PM | my access outcome, or permitted setup if independently an Operator | recover a valid destination without a duplicate page |
| `/administration/:unknown-section` | Engineer | my access outcome, or permitted setup if independently an Operator | recover a valid destination without a duplicate page |

Finance cannot open the rest of Accounting; its attribution destination remains independent. Exchange rates is Admin/Finance, not Executive. Operator status adds Usage/Features and the existing Users invite/status actions; do not infer that it adds every accounting or connection edit. These are FE visibility facts from `Administration.tsx`, `AdminUsers.tsx`, `src/auth/policy.ts` and the component permission predicates, not a new authorization design.

## Merge and retirement decisions

| Current route/block | Decision and canonical destination | PA-00 reason and retained reachability |
|---|---|---|
| Accounting's second `CostAttribution` body | MERGE into `/administration/cost-attribution`; Accounting gets a named link | One rule-maintenance job and one set of records. On the old Accounting hash, replace to the canonical route, preserving relevant query state; keep Finance's direct route and Executive read-only access. |
| Separate employed-information service cards | MERGE into the selected service's “Information updated automatically” detail | No separate job justifies repeating service identity, ownership and location after the connection card. Keep every configured information area visible in that service. |
| Two hosting-location notes per service | RETIRE the repeated note; keep service information once under Connection details | Location informs a setup decision, not a repeated page-wide warning. The detail remains readable; abnormal readiness caveats are separate and scoped. |
| Always-expanded untracked ClickUp list roll call | RETIRE as a top-level block; MERGE records into ClickUp → View configured connections / Unused lists | Admin needs to match or inspect a list, not scan an unrelated inventory after finishing setup. Preserve list names/context, search and explicit untracked state in the disclosure; no list deleted. |
| Completed business setup checklist | RETIRE from the action queue; MERGE saved defaults/matches into service details | A completed step asks for no decision. Keep a compact Ready state and an Edit setup entry. Only new/ambiguous/consequential work returns to the queue. |
| Accounting's nine simultaneous setup bodies / anchor wall | MERGE into four named task sections on the same route | One selected task, not nine competing saves. Preserve every setting and old hash, automatically opening its owning section. |
| “Administration” h1 + generic governance subtitle + section h2 | RETIRE duplicate page introduction; route job becomes h1 | The shell already names the area. Users need the selected job immediately; the area breadcrumb and section navigation preserve location. |
| Features' always-on core list as peer toggle rows | MERGE into “Always included” disclosure | Core features have no configuration decision. Their availability remains inspectable, without competing with editable capabilities. |
| `/administration/:unknown-section` | RETIRE standalone fallback concept; replace URL to role-appropriate entry | Nobody has a job in a nonexistent section. Existing fallback already redirects; preserve recovery without mounting an invented page. |
| `/administration` | KEEP redirect, no landing dashboard | Admin/Executive arrive at Users, Finance at Exchange rates, as current code; retain the budget-map hash and numbering compatibility paths. |

All other named routes have a concrete persona job above and stay. No record, schema, financial rule or permission is retired. These decisions override “keep every route” wording in earlier area documents where it conflicts with amended OD-ROUTE-JTBD.

## Current inventory

Paths below are relative to `pmo-portal/`. Ordered numbers are current render order, not the proposed order. `A/E` = Admin/Executive; `O` = verified Operator; `F` = Finance. The enclosing shell admits A/E/O, with the two narrow Finance doorways. Individual components can further restrict actions. Personal integration is available to active members, with its entitlement state.

### Label sources

`T` means `public/locales/{en,id}/common.json`, with inline English defaults in the named component (`useTranslation()` default namespace). `P` means `public/locales/{en,id}/procurement.json`; `CA` means `public/locales/{en,id}/costAttribution.json`; `RF` means `public/locales/{en,id}/recordFolders.json`. Keys below identify EN and ID sources together; do not translate stored role values, account names, service names, user data or project identifiers. `Literal` means the current JSX/registry supplies English for both locales; the target must add equivalent EN/ID labels under L-02. Current missing translation is a language/comprehension observation, not a rendered audit claim.

| Shared frame / branch | Current blocks in order and the fact/action carried | Who sees it | EN/ID source |
|---|---|---|---|
| `pages/Administration.tsx` settled route | 1 Administration h1; 2 governance description; 3 section navigation; 4 selected panel heading/body | Enclosing access predicates; Finance nav = Exchange rates, Cost attribution; A/E organization sections; O additionally Usage/Features | T `admin.nav.*`, `admin.nav.platform`; CA `title` |
| Access pending/error/denied | After heading: checking message, or nav when allowed plus retry, or access notice. Exchange-rate denial and Operator-only denial have their own branches; selected panel stays unmounted | Role/Operator-dependent | T `admin.access.*`, `fx.denied` |
| Entry / fallback | No content: replace to Users or Finance's Exchange rates. Entry budget-map hash goes to Accounting; Accounting's numbering hash goes to Project setup | Any direct entrant; destination retains own access result | Destination labels above; no separate fallback copy |

### Current EN/ID destination labels

| Key in common.json | EN | ID |
|---|---|---|
| `admin.nav.title` | Administration | Administrasi |
| `admin.nav.users` | Users | Pengguna |
| `admin.nav.integrations` | Organization integrations | Integrasi organisasi |
| `admin.nav.accounting` | Accounting setup | Pengaturan akuntansi |
| `admin.nav.projects` | Project setup | Pengaturan proyek |
| `admin.nav.credits` | Credits | Kredit |
| `admin.nav.exchangeRates` | Exchange rates | Kurs mata uang |
| `admin.nav.usage` | Usage | Pemakaian |
| `admin.nav.features` | Features | Fitur |
| `integrations.personal.title` | My integrations | Integrasi saya |
| `costAttribution:title` (CA namespace) | Cost attribution | Alokasi biaya |

### Users — `pages/AdminUsers.tsx`

Current table order is User → Role → Status → Manager; the target deliberately moves Manager before Role. Current render order below remains distinct from the target contract.

| Order / conditional block | Fact or action | Viewer/action | EN/ID source |
|---|---|---|---|
| 1 embedded PageHead | Users section heading; Invite user opens capture | A/E/O read; Admin or O invite | T `admin.nav.users`, `admin.users.invite` |
| 2 Executive read-only notice | Directory readable, writes reserved | Executive without O | T `admin.users.execReadOnly` |
| 3 toolbar, absent during loading | All users count then name/email search | A/E/O | T `admin.users.allUsers`, `admin.users.search.*` |
| 4 mutually exclusive body states | Loading skeleton; error/Retry; no users guidance; or table with no-match text | A/E/O | T `admin.users.error.*`, `.empty.*`, `.noMatch.*`, `admin.retry` |
| 4a table columns | User initials/name/email → Role → Active/Disabled → Manager (desktop only); manager button scrolls to that member | A/E/O; directory names have no detail route | T `admin.users.columns.*`, `.status.*`, `.noManager`, `admin.roles.*` |
| 4b row menu | Edit role, Change manager; Disable or immediate Re-enable | Admin edits other users; Admin/O status; existing self/sole-admin safeguards retained | T `admin.users.menu.*` |
| 5 conditional role form | User context, role select, submit/cancel; followed by consequential role confirmation | Permitted edit only | T `admin.users.roleForm.*`, `.roleConfirm.*`, `admin.roles.*` |
| 6 conditional manager form | User context, manager choice, save/cancel | Permitted edit only | T `admin.users.managerForm.*` |
| 7 role confirmation | Named user and new role, immediate workspace consequence, confirm/cancel | Permitted edit only | T `admin.users.roleConfirm.*` |
| 8 disable confirmation | Named user, sign-in consequence, confirm/cancel | Admin/O | T `admin.users.disableConfirm.*` |
| 9 invite modal | Invite context → email → role/helper → submit; inline persistent rejected-save error | Admin/O; current workspace only | T `admin.users.inviteForm.*`, `.inviteError.*` |

### Organization integrations — `src/components/integrations/IntegrationsView.tsx`

| Order / nested render order | Fact or action | Viewer/action | EN/ID source |
|---|---|---|---|
| 1 scope paragraph | Organization-owned setup, personal-integration link, separation explanation | A/E/O admitted; view permission also checked in component | T `uxs07.organizationScope`, `.personalConnections`, `.scopeTail` |
| 2 optional status-load error | Unknown connection status and Retry | Readers | T `integrations.organization.readiness.bindUnavailable*`, `.retry` |
| 3 first service block: `M365OrgApprovalCard` | Microsoft 365 + Organization approval badge → purpose → optional error → Approve in Microsoft 365 / opening state | Current `integration.manage` predicate (Admin), not all readers | T `integrations.m365OrgApproval.*`, `uxs07.m365ApprovalDescription`; `src/lib/m365/errorCopy.ts` |
| 4 `M365DefaultLibraryCard` | Heading/purpose → loading/error/current site+library/none → Choose library, Clear default, Link existing folders → disconnected explanation | Current document permission predicates; library status readable to admitted viewers | T `m365Documents.defaultLibrary.*` |
| 4a choose/clear/batch disclosures | Choose modal: site then library then save/error; clear confirmation; existing-folder scan has Start/Stop/Continue, progress/interruption and categorized outcome, follow-up record links | Permitted manager; choosing uses own personal connection | T `m365Documents.defaultLibrary.*`, `m365Documents.backfill.*`; RF `backfill.*` through `components/m365/LinkExistingRecordFolders.tsx` |
| 5 ClickUp card; 6 ERPNext card (same structure) | Service name/readiness → incomplete-setup count + Finish setup when applicable → connector identity and dates → binding retry if unknown → health → company activation if ERP connected without company → Connect or Connection options/Disconnect → ERP checklist when applicable → hosting note | Readers see state; `CanWrite integration.manage` controls edits; ERP checklist is within that write gate | T `integrations.organization.readiness.*`, `uxs07.*`; `integrationLabels.ts` supplies literal service/domain labels (English domain words in both locales; localize domain labels under L-02) |
| 5/6 health subpanel | Loading/check failure+Retry, or pending outbound count, positive failed/quarantined/held counts with recovery links, then not-yet-verified reminder + Review connected records; each service resolves independently | Connected/activated service readers | T `integrations.organization.readiness.health.*`, `uxs07.pending*`, `.failedAttention*`, `.quarantinedAttention*`, `.heldAttention*`, `.review*`, `.liveRecordCheck` (HealthPanel at end of file) |
| 6a ERP `ErpSetupChecklist` | Business setup review heading/explanation → information heading → missing-only rows: information areas, company defaults, activity defaults, budget map link, employee links, project matches → complete message if clear → company-connections review, Companies link, Refresh checklist → outcome notice | Admin integration manager | T `uxs08.*`, `uxs07.*`, `integrations.erpSetup.*` |
| 6b ERP checklist overlays | Defaults fields (activity/receivable) or information-area selection → save; company review/start confirmation and result; `ProjectMatchReview`: search, proposals with selected candidates, review/confirmation, per-row outcomes | Admin integration manager | T `integrations.erpSetup.*`, `uxs08.*`; project review uses `uxs09.*` |
| 7 ClickUp binding map, when visible | Title → source-specific lists/bindings/projects loading/error+Retry → no bindings note → active-project table: PMO project, ClickUp list, status, Review → one-project `TaskListMatchReview` selection then confirmation → untracked lists heading/list/context | Readers; Review only for manager | T `integrations.organization.readiness.map.*`, `uxs21.*` |
| 8 employed-information panel | Heading → loading/error/empty or cards grouped ClickUp then ERPNext → information chips → area count → repeated hosting notes | Readers | T `uxs07.ownership*`, `integrations.organization.readiness.*`; `integrationLabels.ts` literal English domain names (no ID map) |
| 9 connect modal | Service-specific required connection fields → inline failure → Connect; values retained on error | Manager | T `integrations.organization.readiness.connect.*` |
| 10 ERP company modal | Loading/error/empty or company selection → activation refusal guidance if returned → Activate | Manager; company not chosen automatically when ambiguous | T `integrations.organization.readiness.erpActivation.*` |
| 11 disconnect confirmation | Named service and consequences, confirm/cancel with mutation outcome | Manager | T `integrations.organization.readiness.disconnect*` |

### Accounting — `pages/Administration.tsx` selected Accounting panel

All nine bodies currently appear sequentially below SectionHeader and a nine-anchor navigation. A/E/O can enter; actions follow each component's `orgAccounting` or specific permission predicate, primarily Admin. Read-only values replace editors for other viewers; no new Finance access to this page is proposed.

| Body order / source `pages/admin/` | Within-body blocks in render order; fact/action | EN/ID source |
|---|---|---|
| 0 `Administration.tsx` AccountingSectionNavigation | After Accounting setup title: anchors Default tax treatment → Spend approvers → Receipt withholding → Vendor bill tax accounts → Down payments → Purchase rules → Budget account map → Expense account map → Cost attribution; each targets its body hash | T `uxs31.accounting.*`; P `gates.heading`; CA `title` |
| 1 `OrgTaxDefault.tsx` | Heading → what new records inherit → existing-record treatment explanation → loading/error or immediate inclusive/exclusive select; read-only value + role explanation | T `admin.taxDefault.*`; shared `useTaxTreatmentOptions` labels |
| 2 `SpendApprovers.tsx` | Heading/help → loading/error → overhead/over-budget approvers + Add → project approvers + Add → read-only note; groups show names or effective fallback/escalation; add modal selects project when needed then person; remove confirmation | T `admin.spendApprovers.*`, `uxs32.*`, `admin.roles.*` |
| 3 `OrgWithholdingAccount.tsx` | Receipt withholding heading/intro → loading/error or saved-value conflict notice → tax-prepaid Asset account picker → setup/catalogue availability and saved-choice guidance → field error → Save account; read-only saved value alternative | T `uxs11.withholding*`, `.receiptWithholdingContext`, `.savedChoiceUnavailable`, `.reloadSaved`, `.onlyAdmin`, `.account*`; `v024Polish.accountDraftUnavailable` |
| 4 `OrgVendorTaxAccounts.tsx` | Vendor bill tax heading/intro → loading/error or conflict notice → setup/catalogue status → Input VAT, PPh 23 payable, PPh 4(2) payable pickers and candidate guidance → error → Save accounts; read-only named values alternative | T `uxs11.vendorTax*`, `.inputVat*`, `.pph23*`, `.pph42*`, shared account/reload/availability keys |
| 5 `OrgDownPaymentItem.tsx` | Down payment heading/intro → loading/error or conflict notice → item picker → liability-posting guidance → connection/item availability → error → Save item; read-only saved value alternative | T `uxs11.downPayment*`, `.saveDownPaymentItem`, `.item*`, shared setup/reload keys |
| 6 `OrgProcurementGates.tsx` | Purchase rules heading/intro → loading/error or four immediate switches: request before order, approval before order, receipt before invoice, approval before payment → read-only note → Saving/Saved/error | P `gates.*` |
| 7 `BudgetAccountMap.tsx` | Heading → map purpose → posting-vs-actuals explanation → multi-account explanation → suggested posting-account review with chart loading/error/fallback/ambiguity feedback → category/account/action table → add/edit editor, posting-target, removal and proposal confirmations | T `admin.budgetMap.*`, `uxs10.*`; category labels via `src/lib/i18n/budgetCategoryLabel.ts` |
| 8 `ExpenseAccountMap.tsx` | Heading/purpose → one readiness notice or unmapped count → posting-purpose/account rows with Map/Change and Clear → account editor → clear confirmation; loading/error earlier branches | T `admin.expenseMap.*`, `uxs12.expensePosting.*` |
| 9 `CostAttribution.tsx` | Entire same rule-maintenance body as the standalone route below | CA namespace; not a distinct record set |

### Other routes

| Route / exact source | Current blocks in render order and fact/action | Visibility/action | EN/ID source |
|---|---|---|---|
| projects: `pages/admin/OrgProjectNumberPattern.tsx` then `OrgProjectClassificationOptions.tsx` | 1 Project setup section title; 2 numbering heading/purpose/future-only explanation; 3 loading/error or pattern field/helper, organization-year preview pending/error/retry or preview+illustrative note, Save pattern, read-only explanation; 4 classification help; 5 service-lines then sectors textareas (one per line) and Save options, or read-only lists/Not set and Admin note | A/E/O; current Admin management predicates for each edit | T `admin.projectNumberPattern.*`, `uxs31.projectNumberPattern.*`, `uxCorrectness.projectNumberPattern.*`, `projectClassification.*` |
| credits: `pages/AdministrationCredits.tsx` | 1 Credits heading + Operator Grant credits; 2 loading/error; 3 exact Org balance + credits unit; 4 grant modal: immediate-effect context → positive amount/unit guidance → optional note → submit/cancel and retained error | A/E/O reads; O grant | T `admin.nav.credits`, `admin.credits.*`, `admin.retry` |
| exchange-rates: `pages/AdministrationExchangeRates.tsx` | 1 title, Upload rates (unless list empty), secondary New rate (Admin); 2 USD→IDR/JISDOR/display-only description; 3 organization-day loading/error, rates loading/error, or empty + role-aware Upload; 4 populated date-range/count/gaps/earlier-pages summary; 5 table: publication date, exact rate, source + Admin Edit; 6 Previous/Next; 7 upload overlay, manual overlay, overwrite confirmation | Admin/Finance; upload both; manual create/edit Admin; view-only suppresses writes | T `admin.nav.exchangeRates`, `fx.*`, `uxs38.*`; `src/components/fx/FxRateUpload.tsx`, `FxRateForm.tsx` |
| cost-attribution: `pages/admin/CostAttribution.tsx` | 1 title + Add rule when populated; 2 untagged-cost effect explanation; 3 loading/error/empty or Rule → Match → Goes to → Posting dates → Version → Edit/End table; 4 rule modal; 5 End rule confirmation | Admin/Finance manage; Executive reads; other admitted viewers retain predicate results | CA `title`, `description`, `add`, `list.*`, `empty.*`, `end.*` |
| attribution modal: `pages/admin/CostAttributionRuleForm.tsx` | Rule name/account or group → optional cost centre/party narrowing → applies-from/until posting dates → project percentage splits and Add project → Effect: Preview, validation/failed/none/stale/result table (month/project/category/amount), total and unmapped-category explanation → Save rule | Same manage gate; form uses organization currency, not fabricated currency | CA `form.*`, `preview.*`; category labels use `budgetCategoryLabel` |
| usage: `pages/Administration.tsx` UsagePanel, `src/components/admin/AgentCostMetrics.tsx`, `pages/AdministrationUsage.tsx` | 1 Usage section title; 2 metrics loading/error/empty or Agent cost overview + all-actions/months caption; 3 five metrics (cache hit rate, reasoning share, weighted p50 cost/run, max p95 cost/run, max p95 latency); 4 cache-hit monthly line figure or insufficient-data frame; 5 usage loading/error/empty or Month → Action → Runs → input/output tokens → conditional Provider cost → Credits spent → conditional Margin; 6 pricing note when no margin | Route O only; column presence follows returned aggregate shape; never add private conversations to this page | T section title only; metrics/usage headings, states, columns and pricing note are current English Literals |
| features: `pages/AdministrationFeatures.tsx` | 1 Features section title; 2 toggleable registry rows; 3 remaining registry rows labelled Preview on/off; 4 always-on core rows. Current component also has read-only Included/Hidden branch, although shell denies this route without O | O route; effective editable set comes from `FEATURE_KEYS_TOGGLEABLE`; do not invent switches for preview/core entries | T section title; registry names from `src/lib/features.ts` `FEATURE_LABELS`, status/error copy current English Literals |
| personal: `pages/Integrations.tsx`, `src/components/integrations/M365ConnectionCard.tsx` | 1 My integrations h1; 2 personal-account scope and shared-setup distinction; 3 feature-disabled message or Microsoft 365 card; 4 connected/date, org-approved, expired, revoked, unknown, checking, callback/connect error or not-connected status; 5 Connect/Reconnect or Disconnect; 6 disconnect confirmation with persistent failure and Cancel | Every active persona; entitlement/loading and view-only behavior retained; own account only | T `integrations.personal.*`, `integrations.personalM365.*`; `src/lib/m365/errorCopy.ts` resolves errors |

### Supporting capture details in current render order

| Component | Current inner blocks, before recomposition | Label source |
|---|---|---|
| `src/components/fx/FxRateUpload.tsx` | Upload title/display-reference subtitle → choose supported workbook/CSV → reading state → file/error or existing-rate lookup Retry → new/changed/unchanged summary → duplicate and rejected-row explanations → normalized publication-date/rate table → review submit/Cancel; separate Save rates confirmation carries replacement consequences and persistent error | T `fx.*` |
| `src/components/fx/FxRateForm.tsx` | New/Edit rate modal → publication date (fixed when editing) → exact IDR-per-USD input → validation/error summary → Save rate/Cancel | T `fx.*`, `common.cancel` |
| `pages/admin/ExpenseAccountMap.tsx` row purposes | Employee payable → Employee advance → project direct cost → Travel → Accommodation → Meals → Local transport → Other, each with saved account or Not mapped, then allowed Map/Change/Clear controls; exact ordered set is `EXPENSE_ACCOUNT_KEYS` in `src/lib/adapterSeam/erpnext/expenseAccountRules.ts` | T `admin.expenseMap.*`; shared expense category labels |

## Target page contracts and sketches

All sketches inherit shell.md; they show content-track topology, not new tokens or pixel commitments. At 1440, `Sections` is the compact named navigation beside the content, never a wide empty card. At 390, `Sections v` is one collapsed disclosure, not a wall of links. Each phone sketch's `---- fold ----` denotes the intended first 390×844 screen; tolerate translated wrapping without hiding the named action. URL stores selected section/service/search/filter/sort/period and preserves canonical deep links (N-04). Forms open in the same job context; keyboard/focus order follows reading order. No sticky action covers the last field.

### Users

Settings with a directory body. Order: title/scope → toolbar Search, status filter, Name A–Z sort, Invite user → directory. Columns: User identity → Manager → Role → Status → actions; add a named Details disclosure per user, not an invented user-detail route, for manager and full identity on phones. Invite is the sole primary in collection state. Opening a form transfers primary to its submit; role/status confirmation retains named consequence. Do not add bulk role changes just to fill a toolbar (A-01/02, C-01/03/04/05).

No users: Invite user once in empty content, toolbar primary stands down. No matches: Clear search/filters, no invite repetition. Missing directory/manager read: Unavailable + retry; a known absent manager is “No manager”. Executive has one read-only explanation, no disabled edit controls (C-02/06, S-03/04).

```text
1440 [Sections | Users / workspace                                ]
     [         | Search | Status | Name A-Z |        [Invite user] ]
     [         | User        Manager      Role       Status  ...  ]
390  [Menu | Administration | Account]
     [Back / Workspace setup] [Sections v]
     [Users] [workspace]
     [Search users___________________]
     [Status v] [Name A-Z v] [Invite user]
     [User identity / Role / Active / ...]
     ---- fold ----
     [Details: full identity / Manager]
```

Phone first screen answers “Who is here and can they work?” with search, invite if permitted and at least the first identity/status row or the actionable empty/error state. No top count tile.

### Organization integrations

Settings; title → shared scope + quiet My integrations link → service rows → selected service decision → configured details. Order services ERPNext, ClickUp, Microsoft 365: financial-work readiness first, then task links, then document setup. Each row names current state and one next step; selected service carries the only filled action. Healthy services have no mandatory action. Never treat Microsoft organization approval or a default library as proof that a member is connected.

Connect → choose company when necessary → propose mappings and initial-source basis → one batch consequence review → Accept all clear matches. Proposals include existing account/project/list identity and target context, reason/status, then override action; clear matches preselected, ambiguous rows unselected. Search → status (Needs decision/Configured/Unused) → Name A–Z sort. One aggregate confirmed/failed outcome preserves unresolved selections; repeating the flow never asks for already-confirmed matches. Keep advanced connection fields behind “Connection details”; only genuinely required fields appear when connecting. Existing-folder scan keeps Stop/Continue and truthful progress in Microsoft document setup. Approve at Microsoft remains conditional help when Microsoft requests it, never a repeated readiness checkbox (E-03, PA-03/04).

Unknown sources keep the last confirmed state explicitly stale, or Unavailable if none; one scoped caveat collects affected service/source remedies, with local Retry controls. Zero exceptions requires a successful check, not an empty default array. No services set up: Connect service; no matching proposals: Clear filters; no clear proposal: choose only unresolved items. “View configured connections” contains saved defaults, information-area ownership, identity/date, unused lists and one location note per service. Those are details, not a second readiness dashboard.

```text
1440 [Sections | Organization integrations / shared workspace              ]
     [         | ERPNext: Needs decision | ClickUp: Ready | Microsoft: ... ]
     [         | Selected service / required business choice               ]
     [         | Search | Needs decision | Name A-Z                        ]
     [         | [x] PMO project -> suggested match | Why / Status         ]
     [         | [Accept all clear matches]   View configured connections  ]
390  [Menu | Administration | Account]
     [Back / Workspace setup] [Sections v]
     [Organization integrations] [Shared]
     [ERPNext: Needs decision / Open]
     [Selected service: next required step]
     [Proposed matches + consequence]
     [Accept all clear matches]
     ---- fold ----
     [ClickUp / Microsoft service rows]
     [View configured connections >]
```

Phone first screen shows the service requiring judgment and its next business choice, not consent, library, hosting and metadata prose ahead of readiness. On first use show Connect service; settled state shows Ready + details. Bulk acceptance is available on phone without opening each row. Financial matches and task-source choices retain consequence review; bulk does not mean blind acceptance.

### Accounting setup

Settings. Four task sections (named links/selector, not tabs): Posting accounts; Tax and advances; Purchase rules; Spend approvers. Default Posting accounts; direct hashes open their owning section. Current tax/withholding/vendor-tax/down-payment anchors all resolve to Tax and advances; budget/expense anchors resolve to Posting accounts; approvers and procurement-rules anchors retain focus; attribution hash redirects to its independent route. No global Save across independent mutations. Show saved summaries first; one editor open at a time.

Posting accounts combines budget and expense account setup into one task, preserving their different purposes and actuals-only vs budget-posting distinction. Table: purpose/category → existing/proposed account → coverage/status → actions, Name A–Z within purpose group; search then purpose/status filters then sort then secondary Edit setup. Batch proposals are the sole filled Accept all clear matches action when pending, with one consequence review; no per-category modal requirement. Ambiguous or exceptional accounts get explicit overrides. Existing saved choices stay intact. Advanced actuals-only accounts disclose under each category; exactly one budget-posting target remains distinguishable.

Tax and advances groups default tax treatment, receipt withholding, vendor input VAT/payable accounts and down-payment item by their financial effect. Purchase rules retains four immediate switches and outcome; Spend approvers keeps overhead then project lists, effective fallback/escalation, person/project inputs and consequential removal. No fake Save for immediate mutations. Save accounts only after an editor's evidence; approver add only in active context. Cost attribution is one named link, not a tenth setting. No values: Set up posting accounts for Admin; no matching rows: Clear filters; unavailable chart/connection/saved values: one scoped remedy; absent mapping is “Not configured”, not an empty currency value. Keep field-specific validation and saved-value conflicts (E-04, S-03/04).

```text
1440 [Sections | Accounting setup / workspace                         ]
     [         | Posting accounts v | Cost attribution ->             ]
     [         | Search | Purpose/Status | Name A-Z                    ]
     [         | Purpose/category | Account | Coverage | Edit          ]
     [         | proposals + consequence [Accept all clear matches]    ]
390  [Menu | Administration | Account]
     [Back / Workspace setup] [Sections v]
     [Accounting setup] [workspace]
     [Posting accounts v]
     [Search] [Purpose/Status] [Name A-Z]
     [Purpose / Account / Needs decision]
     [Accept all clear matches]
     ---- fold ----
     [Configured details >] [Cost attribution ->]
```

Phone first screen shows the selected accounting task, current/proposed account evidence and one next action. For direct tax/approver/rule hashes, that specific saved setting and allowed action take the body slot immediately; no forced scroll through other tasks.

### Project setup

Settings. Future-project scope → saved numbering pattern and illustrative current-year preview → saved service-line/sector choices. “Edit numbering” and “Edit classifications” are quiet named entry points; one editor open at a time, Save pattern or Save options after fields. Keep future-only semantics and existing project classifications. No table toolbar/sort: these are two settings, not collections. Empty choices say Not set and Edit classifications if permitted; no-match applies only inside any searchable choice picker, never a fabricated empty-project state. Preview year failure is Unavailable + Retry preview; one abnormal scoped explanation, not a guessed year (E-02–04, S-03/04).

```text
1440 [Sections | Project setup / applies to future projects          ]
     [         | Number pattern | Preview | Edit numbering           ]
     [         | Service lines / Sectors | Edit classifications       ]
     [         | active editor fields                 [Save options] ]
390  [Menu | Administration | Account]
     [Back / Workspace setup] [Sections v]
     [Project setup] [Future projects]
     [Number pattern / Preview]
     [Edit numbering]
     [Service lines / Sectors]
     [Edit classifications]
     ---- fold ----
     [Open editor: fields -> Save / Cancel]
```

Phone first screen identifies both future-project conventions and saved values, rather than opening on two tall textareas. Each edit preserves values through failed save. No primary until a setting is being edited.

### Credits

Settings. Workspace scope → exact balance and credits unit → Operator Grant credits. Avoid a full-width mostly empty balance card or repeated usage totals (PA-04). Grant editor: amount in credits → optional note → immediate-effect explanation → Grant credits/Cancel; retains field values and failure message. No toolbar/search/sort. Known zero is “0 credits”; read failure is Balance unavailable + Retry, never a zero. One abnormal caveat with remedy. Read-only users see balance without a disabled grant button.

```text
1440 [Sections | Credits / workspace             ]
     [         | Available balance: <n> credits  ]
     [         | [Grant credits] (Operator)     ]
390  [Menu | Administration | Account]
     [Back / Workspace setup] [Sections v]
     [Credits] [workspace]
     [Available: <n> credits]
     [Grant credits] (Operator)
     ---- fold ----
     [Grant editor: amount / note -> Grant / Cancel]
```

Phone first screen answers “How many credits remain?” and shows the allowed next step; the form never labels credits as dollars. No no-match state because there is no collection.

### Exchange rates

Settings with dated reference history. Scope names USD→IDR, JISDOR and display-equivalent purpose once; it is stable context, not an abnormal warning. Toolbar: publication-date descending sort → secondary New rate (Admin) → Upload rates. Columns publication date (identity) → Source → exact IDR per USD → Admin Edit; retain pagination. No arbitrary search or project filter. Known empty moves Upload rates to empty content and suppresses competing creation. Uploaded file preview is its own review state: valid/rejected/unchanged/replacement groups, exact dates/rates, affected counts, one overwrite consequence confirmation, Save rates after evidence. Preserve return to editor on cancel/error; don't silently replace historical rates.

Organization-day or rate-fetch failure means unavailable with Retry; gaps identify the viewed date range and a single upload remedy, never invented zero rates. File row filtering with no matches offers Clear filter; an actually empty file asks for a different file. No line chart needed for a maintenance decision (C-01–04, S-03–05).

```text
1440 [Sections | Exchange rates / USD -> IDR / display references       ]
     [         | Publication date newest | New rate | [Upload rates]   ]
     [         | Publication date | Source | IDR per USD | Edit         ]
     [         | Previous / Next                                      ]
390  [Menu | Administration | Account]
     [Back / Workspace setup] [Sections v]
     [Exchange rates] [USD -> IDR]
     [Publication date newest v]
     [New rate] [Upload rates]
     [Date / Source / exact IDR per USD]
     ---- fold ----
     [Previous / Next]
```

Phone first screen places date, source and exact rate together, or Upload rates in the known-empty state. Finance sees upload; manual New/Edit remain Admin-only. No technical setup paragraph before the first rate.

### Cost attribution

Settings with rule collection. Scope describes assignment of untagged cost without rewriting the ERP. Toolbar Search → Active/Ended/All → Rule name A–Z → Add rule. Columns Rule identity → projects/percent shares → effective posting dates/status → account/group match → actions; version moves into Details. Phone retains rule, destination shares, active/ended and dates; Match/Version disclose. Named rule opens its same-page details; separate Edit/End controls. Empty collection offers Add rule; no matches offers Clear filters. Unavailable target/project or preview is explicit, not zero or a raw identifier substituted as a business label.

Editor groups rule and account/group → optional narrowing disclosure → posting dates → project shares → effect preview → Save rule/Cancel; preview money retains currency and exact values. Preserve stale-preview indication, current validation, concurrency outcome and end-rule confirmation. Preview remains a secondary action; do not invent a mandatory-preview gate beyond current behavior. One abnormal caveat combines stale/unmapped affected scope and remedy as applicable, without repeating the normal business effect (PA-03, E-03/04, S-03–05).

```text
1440 [Sections | Cost attribution / untagged cost basis                 ]
     [         | Search | Active/Ended | Rule name A-Z | [Add rule]     ]
     [         | Rule | Projects / shares | Dates/status | Match | ... ]
390  [Menu | Administration | Account]
     [Back / Workspace setup] [Sections v]
     [Cost attribution] [Untagged cost]
     [Search] [Active/Ended] [Name A-Z]
     [Add rule]
     [Rule / Projects + shares / Active / Dates]
     ---- fold ----
     [Details: Match / Version / Edit / End]
```

Phone first screen answers “Where is this cost going, and for which dates?” rather than leading with account syntax. The Finance route and redirected Accounting hash open the same records; Admin and Executive can find the route through Accounting's link.

### Usage

Operator settings inspection; retain the job of diagnosing unusual cost/latency but subordinate it to consumption. Operator scope explicitly states workspace or returned aggregate scope, never a fictitious organization picker. Toolbar period → action filter → Month newest sort; omit irrelevant search/create. Consumption table: action identity → month/scope context → runs/tokens → exact credits spent → provider cost/margin only when that returned aggregate supports them. No user transcripts or new per-user browsing. Do not relabel current monetary `cost` as a numeric credit count without a verified unit; preserve formatter and make credits charged vs provider-money basis explicit.

Diagnostics disclosure contains the existing five derived metrics with exact aggregation names, then monthly cache-hit line figure. Do not duplicate totals in overview tiles and table. Period/action controls affect a single shared scope, keep chart type/axes/legend/footprint stable (S-02); one or zero usable months is an insufficient-data state in that same footprint. Missing denominator/pricing/provider cost is Not available, never 0; display one scoped caveat naming missing basis and Operator remedy. Known zero usage has a real empty explanation; filtered no-match restores period/action; loading retains geometry and errors retry only affected reads.

```text
1440 [Sections | Usage / Operator / aggregate scope                   ]
     [         | Period | Action | Month newest                       ]
     [         | Action | Month | Runs/tokens | Credits | Cost/margin  ]
     [         | Diagnostics > (metrics, stable monthly line figure)   ]
390  [Menu | Administration | Account]
     [Back / Workspace setup] [Sections v]
     [Usage] [Operator / scope]
     [Period v] [Action v] [Month newest]
     [Action / Month / Runs / Credits spent]
     ---- fold ----
     [Diagnostics >]
```

Phone first screen answers “What consumed capacity in this period?” and exposes unknown pricing honestly. No five-tile band ahead of consumption. No primary in settled inspection; Retry is the only next action on failure.

### Features

Operator settings. Workspace scope → editable capability rows in localized name order → Preview disclosure → Always included disclosure. Each editable row has name, human consequence, current On/Off and immediate switch; Saving/Saved/error sits beside the changed row. No creation toolbar, filter or sort control for this short fixed registry, and no Save button for immediate writes. Core and preview entries stay read-only, accurately named, never decorative disabled switches. Loading/unknown is not Off; one scope-level failure with Retry, retain last confirmed values and pending state honestly. There is no no-match state without search. Entitlement, preview and core behavior stay as shipped; this is a composition/language task, not a capability redesign.

```text
1440 [Sections | Features / Operator / workspace                       ]
     [         | Capability | Consequence | On/Off switch | Saved/error ]
     [         | Preview >             Always included >                ]
390  [Menu | Administration | Account]
     [Back / Workspace setup] [Sections v]
     [Features] [Operator / workspace]
     [Capability / consequence]
     [On | switch] [Saved]
     ---- fold ----
     [Preview >] [Always included >]
```

Phone first screen answers which capability is enabled and what changing it does; switches retain ≥44×44 targets and accessible labels. No artificial filled primary.

### Personal integrations — `/integrations`

Settings. Account-menu parent/return → My integrations h1 → personal scope → Microsoft status/date → Connect/Reconnect primary when applicable → quiet Connection options/Disconnect confirmation. Shared organization setup is a quiet link only for someone entitled to open it, never proof of personal readiness. Feature unavailable shows a concise explanation and return; organization approval requested by Microsoft explains next step without sending ordinary members into forbidden administration. Unknown status offers Retry, not connect-as-if-disconnected. Preserve callback outcomes, safe localized errors, own-account scope, focus restoration and duplicate-submit behavior.

No directory toolbar, sort or invented empty table. Not connected is the first-use state with Connect; no-match is inapplicable. One abnormal caveat states the affected personal connection and remedy. Connected status and date appear once.

```text
1440 [My integrations / personal account                               ]
     [Microsoft 365: status / date] [Connect or Reconnect Microsoft 365 ]
     [Connection options > Disconnect / consequence review              ]
390  [Menu | My integrations | Account]
     [Back to account settings]
     [My integrations] [Personal account]
     [Microsoft 365 / Status / Date]
     [Connect Microsoft 365]
     ---- fold ----
     [Connection options >]
```

Phone first screen answers whether my account works and gives the one next step; description never precedes state by several screens. Already connected has no invented primary.

### Entry, unknown section and legacy hash transitions

These are redirects, not pages. Preserve named back/focus after replacement. No toolbar, amount, chart, empty/no-match body or action is appropriate. Record the resulting destination URL in evidence; source query/filter state survives when meaningful. Unauthorized destination renders its own named return/access state, never a Users directory masquerading as a Finance page.

```text
1440 [/administration or unknown section] -> [Sections | Users or Exchange rates]
390  [/administration or unknown section]
                  -> [Menu / destination h1]
                     [permitted content or access outcome]
                     ---- fold ----
legacy accounting#cost-attribution -> [Cost attribution / same rules]
legacy #budget-account-map        -> [Accounting / Posting accounts]
legacy numbering hash             -> [Project setup / Numbering]
```

Phone first screen is the destination's screen above, with no transitional landing dashboard. Unknown section cannot strand a user or erase browser Back history.

## Builder screenshot matrix

Each row requires 1440×900 and 390×844 × EN/ID × light/dark, with synthetic records/amounts only. Capture every listed state, not just one representative happy path. Expand the cross-product for each actual control value (period, information area, filter, active section, switch); a control that changes evidence needs before/after captures. Record exact URL, persona plus Operator flag, feature state, fixture/state and result. Documented source inspection and static detector results are not rendered approval.

| Route | Decision-relevant role coverage | States and action/navigation pairs |
|---|---|---|
| `/administration/users` | Admin; Executive read-only; non-Admin Operator; denied PM/Engineer and Finance direct entry | populated/long names and managers; known empty; name/email no-match + Clear; loading; failed read + Retry; active/disabled; invite valid/invalid/pending/retained rejection/success; role edit→confirmation→cancel/commit/error; manager select/save/error; disable/re-enable and existing lockout outcomes; self row; manager jump/details; Back restores search/status/sort. |
| `/administration/integrations` | Admin manager; Executive reader; independently Operator with its actual predicates | feature enabled/disabled variants; each service unconfigured/connected/incomplete/ready/unknown/stale/failed; one service slow or failed while another ready; connect pending/rejected/success; company choice loading/error/empty/activation refusal/success; ERP defaults and information choices; auto-proposed/ambiguous/missing candidates/incomplete search; accept-all confirmation/cancel/partial failure/retry/success; task-source batch choice and exception override; configured/unused/no-match views; Microsoft approval opening/error; library absent/current/unavailable/choose/clear failure; folder-scan idle/running/stopping/interrupted/continue/completed outcomes; disconnect cancel/error/success. |
| `/administration/accounting` | Admin editor; Executive read-only; Finance direct-denial; Operator reflects current permissions | all four task sections; every legacy hash lands/focuses correctly; all mapping purposes; saved/proposed/ambiguous/no candidates; accept-all/cancel/partial failure; actuals-only vs budget-target; current/saved choice unavailable; stale saved-value conflict; field validation and failed save preserve draft; chart/connection unavailable; missing setup; zero rows vs no-match; tax inclusive/exclusive; four purchase switches off/on/pending/failure; overhead/project approvers populated/empty/effective fallback/unavailable/add/remove confirmations. |
| `/administration/projects` | Admin; Executive reader | saved/empty classifications; numbering preview ready/year loading/unavailable/retry; Edit numbering/classifications; dirty/invalid/duplicate/long options; pending/save-error/success/cancel; existing project labels unaffected; direct numbering hash. |
| `/administration/credits` | non-Operator Admin/Executive readers; Operator writer; denied ordinary roles | positive/fractional/known-zero/unavailable/loading balance; grant valid/invalid/nonpositive/pending/rejected with values retained/success/cancel; credits unit remains visible. |
| `/administration/exchange-rates` | Admin; Finance; Executive/PM/Engineer denied | empty/upload; known dates and gaps; loading/currency-day failure/list failure; pagination; upload file choice/parsing/unsupported/empty/rejected/mixed/new/changed/unchanged/duplicate rows; preview→confirmation→cancel/save/error/success; manual new/edit invalid/future/overwrite/cancel/failure; exact long rate; view-only preview. |
| `/administration/cost-attribution` and old Accounting hash | Finance/Admin editor; Executive reader; denied ordinary PM/Engineer | list empty/populated/active/ended/long names/no-match; loading/error; canonical redirect; new/edit; one/multiple project splits; totals validation; optional narrowing; effective windows; preview zero/result/unmapped/error/stale; stale-version save rejection retains draft; End confirmation/cancel/error/success keeps historical attribution. |
| `/administration/usage` | Operator; non-Operator direct denial; Operator membership pending/failed/retry | all period/action controls; populated/no usage/no matches; summary and run-stat reads independently loading/error/partial; pricing/provider/margin unavailable vs known zero; returned scope; diagnostics closed/open; figure zero/one/multiple valid months; period/action before/after keeps line form and axes/legend/footprint. |
| `/administration/features` | Operator; non-Operator denial; membership pending/error/retry | every toggleable capability on/off/pending/success/failure; previews on/off read-only; core always-included disclosure; load unavailable vs last confirmed; long EN/ID labels and translated consequences; verify capability navigation responds as currently intended. |
| `/integrations` | all five personas, own account; entitled/not entitled; view-only preview | checking/not connected/connected with and without date/org-approved/expired/revoked/unknown; connect/reconnect callback success/error; disconnect open/cancel/pending/failure/success; keyboard focus return; retry preserves personal vs shared distinction; denied shared-setup link omitted. |
| `/administration`, `/administration/:unknown-section`, legacy hashes | all five personas, plus Operator variants | replace→role destination; budget-map→Posting accounts; numbering→Projects; attribution→canonical rules; Back/Forward; reopen selected section/service/filter/sort URL; no extra landing screen or prematurely mounted panel. |

For every row verify PA-00/01/02, N-01–04, A-01–04, E-02–04, C-01–06 where collections occur, S-01/03/04 and L-01/02. PA-03/04: count each fact and its caveat once. S-02: compare diagnostics figure across its controls; other routes have no new chart. S-05: compare exact currency/units in preview, rates and consumption. Run axe, target-size and document-overflow checks on dialogs/disclosures as well as the settled page, one h1 and existing tokens only. `scripts/ux-proof.sh` owns rendered machine evidence; owner judges composition from screenshots. Where the target adds a filter or batch flow, add behavior proof before implementation, do not substitute a screenshot oracle for a money/role rule.

## Test disposition

This docs task changes no tests. Builder deletes only look-pinning assertions when recomposing; adapting selectors or steps for this deliberate IA change must preserve the goal and all permission/money/error oracles. Paths below are relative to `pmo-portal/`.

| Existing path | Disposition and preserved obligation |
|---|---|
| `pages/__tests__/Administration.sectionHeaders.test.tsx` | DELETE the exact h2/SectionHeader/header-row placement assertions on recomposition: route job becomes h1 and grant placement changes. Preserve the grant availability/action behavior in Credits tests; don't keep an otherwise empty look-only file. |
| `pages/__tests__/AdminUsers.heading.test.tsx` | DELETE the literal “Administration, never Users h1” composition assertion. Replace its accessibility/location intent with one route-job h1 agreeing with breadcrumb, not a ban on the selected job title. |
| `pages/AdministrationShell.test.tsx` | DELETE DOM heading→nav→panel order pin and exact eight-destination/class-name assertions (`touch-target`, `min-w-0`). KEEP native named navigation, active destination, URL/deep-link/Back/Forward, lazy mounting, Finance narrow access, Operator pending/error/denial, no fake tab semantics and keyboard reachability. Update steps for section disclosure and canonical attribution redirect; prove ≥44×44 and no overflow on rendered controls, not class presence. |
| `pages/__tests__/Administration.locale.test.tsx`, `pages/AdminUsers.bahasa.test.tsx`, `pages/AdministrationCredits.bahasa.test.tsx` | KEEP translated job/action/status meaning, validation and number conventions. Update heading level/selector only for new hierarchy. Add coverage for current literal Usage/Features copy as translated. |
| `pages/AdminUsers.test.tsx`, `pages/__tests__/AdminUsers.disable.test.tsx`, `pages/__tests__/AdminUsers.selfedit.test.tsx` | KEEP invite/search, role/manager mutations, classified errors, self-edit/status and lockout contracts; adapt directory/details navigation. Add filter-clear and restoration proof; no pixel oracle replaces these. |
| `pages/__tests__/AdminUsers.avatarContrast.test.ts` | KEEP token-derived contrast calculations; this is accessibility, not a composition lock. |
| `pages/__tests__/Administration.a11y.test.tsx`, `pages/admin/OrgProjectClassificationOptions.a11y.test.tsx` | KEEP axe, native switch, modal focus/cancel and permitted-role checks; update route heading/section steps and add newly disclosed states. |
| `pages/__tests__/Administration.operatorGate.test.tsx`, `pages/__tests__/Administration.fxAccess.test.tsx`, `pages/__tests__/Administration.features.readonly.test.tsx` | KEEP role/capability separation and denied panels staying unmounted; do not expose Features to non-Operators because its component has a read-only branch. |
| `pages/__tests__/AdministrationCredits.states.test.tsx`, `pages/__tests__/AdministrationCredits.saveError.test.tsx`, `pages/__tests__/AdministrationCredits.balanceUnit.test.tsx` | KEEP loading/error/retry, persistent rejected-save evidence, exact/fractional credit units and Operator-only grant behavior. |
| `pages/__tests__/Administration.usage.margin.test.tsx`, `pages/__tests__/Administration.usage.providerCost.test.tsx` | KEEP unavailable-vs-known amounts and aggregate column contracts; update steps to reach the same evidence, not lower the oracle. |
| `src/components/admin/AgentCostMetrics.test.tsx` | KEEP aggregation, UTC month, unknown denominator, precise formatter, insufficient data, retry and axe tests. Adapt only reachability into Diagnostics. Add period/action form-invariance proof if adding those controls. |
| `pages/admin/OrgTaxDefault.test.tsx`, `OrgTaxDefault.bahasa.test.tsx`, `SpendApprovers.test.tsx`, `OrgWithholdingAccount.test.tsx`, `OrgVendorTaxAccounts.test.tsx`, `OrgDownPaymentItem.test.tsx`, `OrgProcurementGates.test.tsx` (all under `pages/admin/`) | KEEP saved-value semantics, Admin mutation gates, fallback authority explanations, tax basis, catalogue eligibility, stale edits, inline errors, all four immediate purchase rules and confirm/cancel outcomes. Update selected task/disclosure steps; don't delete business rules as “old layout”. |
| `pages/admin/BudgetAccountMap.test.tsx`, `BudgetAccountMap.bahasa.test.tsx`, `ExpenseAccountMap.test.tsx` (same directory) | KEEP category coverage, direct-cost eligibility, one posting target vs actuals-only accounts, clear/remove consequences, readiness and retained save errors. Replace per-item setup steps with batch review while retaining explicit override behavior for exceptions. |
| `pages/admin/OrgProjectNumberPattern.test.tsx`, `OrgProjectClassificationOptions.test.tsx` (same directory) | KEEP organization-year preview, future-only numbering, classification parsing and preservation of existing values; update editor entry steps only. |
| `pages/admin/CostAttribution.test.tsx`, `pages/admin/costAttributionDraft.test.ts`, `src/lib/repositories/costAttribution.test.ts` | KEEP splits/effective dates/preview/unknown/stale-version/end/history and repository behavior. Add old hash→same rules redirect proof in shell tests; don't copy tests for a second body. |
| `src/components/integrations/IntegrationsView.connections.test.tsx`, `.companyPicker.test.tsx`, `.setup.test.tsx`, `.health.test.tsx`, `.bindingMap.test.tsx`, `.identity.test.tsx`, `.ownership.test.tsx`, `.readinessCopy.test.tsx` (full prefix `IntegrationsView`) | KEEP connection, company activation, readiness, independent service reads, unknown-vs-disconnected, identity/date, ownership, safe retry and purpose/copy behavior. Move ownership and list assertions behind configured details. Delete only assertions requiring duplicated cards/notes or exact order; preserve their information/action goals once. |
| `src/components/integrations/ProjectMatchReview.test.tsx`, `TaskListMatchReview.test.tsx` (same directory); `src/lib/repositories/projectMatchReview.test.ts`, `taskListMatchReview.test.ts` (same repository directory) | KEEP deterministic proposals, ambiguity/incomplete-source handling, uniqueness, preserved existing links and consequential source confirmation. Update ordinary setup steps to accept-all; retain single-exception override proof and add batch partial-failure/idempotent-repeat outcomes. |
| `src/components/integrations/__tests__/M365OrgApprovalCard.test.tsx`, `M365DefaultLibraryCard.test.tsx`, `M365ConnectionCard.test.tsx` (same test directory); `src/components/m365/LinkExistingRecordFolders.test.tsx`; `pages/Integrations.test.tsx` | KEEP shared approval vs personal connection separation, default-library meaning, existing-folder batch outcomes/Stop/Continue, safe error localization, callback states, disconnect confirmation and focus. Move UI entry points only. |
| `pages/__tests__/AdministrationExchangeRates.test.tsx`, `src/components/fx/FxRateForm.test.tsx`, `FxRateUpload.test.tsx` (same fx directory); `src/hooks/useFxRates.test.tsx`; `src/lib/repositories/fxRates.test.ts` | KEEP exact decimal/date/source and pagination, file validation/normalization/duplicate counts, overwrite confirmation, retained drafts and atomic outcome. Keep parser/preview tests under `src/lib/import/` unchanged. |
| `e2e/AC-ADMIA-001-administration-navigation.spec.ts`, `AC-ADMIA-005-administration-mobile.spec.ts` (same e2e directory) | KEEP canonical navigation, correct selected panel, keyboard reachability, dark mode and actual overflow/target-size proofs; replace old nav/count and h1 assumptions with new task/section steps. |
| `e2e/serial/AC-AU-001-admin-users-crud.spec.ts`, `e2e/AC-M365SEP-018-integrations-route.spec.ts`, `e2e/AC-FX-015-jisdor-upload-equivalents.spec.ts` | KEEP real invite/member journey, personal Microsoft route and cross-stack upload→display equivalents. Update deliberate editor/toolbar steps, never weaken the goal. |
| `e2e/AC-RAM-004-ris-admin-axe.spec.ts`, `e2e/m365-discover-geometry.spec.ts` | KEEP accessibility, legible full identities, unclipped focus and no-overflow goals where touched. Delete only obsolete geometry placement pins, not readable/tappable/focus-visible outcomes. `AC-RAM-004-ris-admin-geometry.spec.ts` actually checks project-stage/milestone geometry: leave it alone in this area. |

Untouched data/permission/money integration proofs remain binding. No test deletion in this documents-only delivery. For builder changes run the repository local gates under the documented locks and the rendered ux-proof checks; CI remains its required gate. No screenshot suite, full test suite or production access was run for this source/spec task.

## Method and static detector

- `/shape`: discovery resolved from the owner's explicit brief, PRODUCT and the five role predicates; the outcome is connect-once and exception-only maintenance, without a new visual system. Questions skipped: the user supplied deliverables, constraints and decision authority, and requested immediate docs delivery.
- `/critique`: separate source assessment A (`admin_source_critique`) completed before detector assessment B (`admin_detector`). A identified duplicate Accounting/attribution bodies, repeated service information and phone hierarchy competing with the job. B measured static findings only. Neither claimed browser inspection. Source findings drive the merge decisions; zero detector findings do not prove usable composition.
- `/layout`: one named route job, one reading edge, dense table evidence where comparison matters; phone moves navigation into one disclosure and retains identity/status/exact figures. `/distill`: named retirements above remove duplicate bodies and completed-work noise. `/onboard`: known-empty content offers the actual permitted first step; mapping suggestions and batch confirmation get to first usable setup, without a tour or repeated per-item clicks.
- Taste v1: applied hierarchy, repetition, legible full identity, anti-card-noise and complete loading/empty/error cycles. Its font/palette/motion suggestions yield to ADR-0068 and the owner's fixed tokens. No new colours/fonts/radii or animation system is proposed.
- Requested UI/UX Pro Max searches ran through `.claude/skills/ui-ux-pro-max/scripts/search.py`, `--domain ux`: `settings page` (2 results; Active State relevant, image result discarded); `integration setup` (0); `mapping table` (1, Table Handling); `feature toggles` (0); `user management` (2, breadcrumb/stacking results not a membership design). Narrow follow-ups: `navigation hierarchy` (breadcrumb/heading hierarchy, applicable); `progressive disclosure` (heading-balance result off-topic, discarded); `toggle switch` (0); `bulk actions` (bulk edit and confirmation, applicable to match review). No verified integration-setup or switch-specific database match: disclosure and switch guidance comes from PRODUCT, UX-STANDARD and the skill's built-in defaults, not a claimed search match.
- `scripts/vendor-skills.sh` was run because skills were absent; upstream Taste's v1 source path had moved and the script stopped. Impeccable had been installed by then. Required Taste/UI UX Pro Max copies were recovered from the existing `redesign-dashboards` worktree into ignored skill directories. No tracked skill, package or app file changed.
- Static command: `.claude/skills/impeccable/scripts/impeccable detect --json pmo-portal/pages pmo-portal/src/components/integrations pmo-portal/src/components/admin`; output `[]`: **0 findings** total and per directory/rule. `pages` is intentionally broader than these routes and includes unrelated page files. Follow-up for referenced supporting components: `.claude/skills/impeccable/scripts/impeccable detect --json pmo-portal/src/components/fx pmo-portal/src/components/m365`; also `[]`, **0 findings**. Combined measured total: **0**. This is a static-source result only; no browser, axe, contrast or phone-layout pass is asserted.
- `gh repo view --json visibility` returned PUBLIC before writing public content. Inventory uses no client names, real figures, credentials or deployment coordinates. Local detector JSON is temporary evidence outside the repo; only the two area documents are delivered.
