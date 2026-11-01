# Pipeline stage history (CRM-grade stage dates) — spec

- **Issue:** #1638
- **Ruling:** `docs/decisions.md` → OD-GRILL-20261101, bullets **"Pipeline dates (CRM-grade history)"** and
  **"Reel differences (#1593)"** (the "Signed" pill with its date).
- **Status:** draft for owner sign-off
- **ID prefix:** `PSH` (`FR-PSH-###`, `NFR-PSH-###`, `AC-PSH-###`, `OQ-PSH-#`)
- **Plan:** `docs/plans/2026-11-01-pipeline-stage-history.md`

## 1. Job story

> **When** I look at a deal on the Sales Pipeline, **I want** to see when it entered its current stage and how
> long it has sat there, and on the deal page every stage it has been through with the real date of each —
> including going back for a re-tender or re-quote — **so that** I can chase the right deals, report honest
> stage ages, and correct the record when a stage was moved late or skipped.

## 2. Today (grounded in shipped code)

| # | Fact | Where |
|---|---|---|
| T1 | A deal is a `projects` row; its stage is `projects.status` (Postgres enum `project_status`, created in 0001; `Declined` added by 0235). There is **no** stage-history table — only the current status. | `supabase/migrations/0001_init_schema.sql:13` (enum); `0235_project_status_declined.sql`; `pmo-portal/src/lib/db/projectTransitions.ts:9` (`ProjectStatus = ProjectRow['status']`) |
| T2 | Every status change goes through one security-definer RPC, `transition_project(p_id, p_to, p_customer_contract_ref, p_contract_date)`. Latest body is 0236. It locks the row (`for update`), re-asserts org, requires an active member, applies a coarse role gate (Admin · Executive · Project Manager · Finance), checks the legal map, then branches. | `supabase/migrations/0236_project_status_declined_rules.sql:10` (def), `:40` (lock), `:58` (role gate), `:20` (legal map) |
| T3 | Going back is already legal: Quotation → PQ, Tender → Quotation, Negotiation → Tender; Loss Tender / Declined → Negotiation (revival). The TS mirror is `LEGAL_PROJECT_TRANSITIONS`. | `0236…sql:20-34`; `projectTransitions.ts:36-49` |
| T4 | Key dates stored today: winning stamps `contract_date = p_contract_date` and `decided_at = p_contract_date`; a loss/decline stamps `decided_at = now()`; every other move stamps only `last_update`. A revived deal keeps its old `decided_at`. | `0236…sql:159-175`; `pmo-portal/pages/project-detail/PipelineLens.tsx:288` |
| T5 | Each transition is written to the audit trail: `log_audit('project.transition', …, {from, to, contract_value…, contract_date})`. | `0236…sql:182`; `log_audit` signature `supabase/migrations/0076_audit_events.sql:80` |
| T6 | Generic field-level history exists: `record_changes` (append-only, FORCE RLS) populated by the `record_change_capture()` AFTER trigger on every table registered in `record_history_config`. `projects.status` and `contract_date` are captured; `decided_at` is omitted. | `supabase/migrations/0260_record_change_history.sql:46-53` (projects row), `:111` (table), `:215-218` (attach loop); registration pattern for a new table `supabase/migrations/0281_vendor_withholding_slips.sql:216-224` |
| T7 | "Days in stage" today is **derived**, not recorded: `get_sales_pipeline()` and `get_win_rate()` compute `stage_started_at` = the latest `record_changes` row whose `changes ? 'status'`, falling back to `projects.created_at`. It is a recording time, never a business date, and cannot be corrected. | `supabase/migrations/0385_dashboard_open_bids_and_stale_win_rate.sql:48-60` (`get_win_rate`), `:135`, `:159-173` (`get_sales_pipeline`) |
| T8 | The board card (`DealCard`) shows value, tax basis, win % and a "Stale bid · stage unchanged for 90+ days" badge driven by `isStaleBid(stage_started_at)`. It shows **no** stage date and **no** contract date; won cards look like open cards. | `pmo-portal/components/SalesKanbanBoard.tsx:42-93` (`DealCard`), `:97-150` (`CompactDealCard`); `pmo-portal/components/salesPipeline.ts:103-119` (`isStaleBid`, `daysSince`) |
| T9 | Won and lost columns are read through `repositories.project.list` and projected by `toPipelineProject`, which drops `contract_date` and `decided_at`. | `pmo-portal/src/hooks/useDashboard.ts:78-105`, `:131-145` (lost), `:152-167` (won) |
| T10 | The deal page (`PipelineLens`, rendered only for pipeline + lost records) shows a stepper of the canonical journey (`dealJourneySteps(liveStatus)`) and a single "Decision" date — not what actually happened. Won projects open the canonical project page with no lens. | `PipelineLens.tsx:300-310`; `pmo-portal/pages/project-detail/ProjectDetail.tsx:92`, `:191` |
| T11 | The in-app Projects import only creates rows at an origination status (`Leads` / `Internal Project`) and has no date-per-stage columns. The operator historical importer writes terminal rows by raw insert under the service role. | `pmo-portal/src/lib/import/projectDescriptor.ts:34-80`; `pmo-portal/src/lib/db/projects.ts:99-102`; `scripts/import-historical.mjs:1-28` |
| T12 | FE gate for moving a stage: `project.transition: allow(MASTER_DATA)` = Admin · Executive · Project Manager · Finance. Role rank (the one server definition): Admin 50 > Executive 40 > Finance 30 > Project Manager 20 > Engineer 10. There is no role literally named "Project admin" in `user_role`. | `pmo-portal/src/auth/policy.ts:223`; `pmo-portal/src/auth/coarseRoles.ts` (`MASTER_DATA_ROLES`); `supabase/migrations/0178_sod_class_completeness.sql:638-653` (`role_rank`) |
| T13 | No outbound client **quotation document** exists. Scope searched: `supabase/migrations/`, `pmo-portal/src/`, `pmo-portal/pages/` for `sales_quotation|client_quotation|issue_quotation|quotation_document`. The `quotation` entity in `policy.ts` is the procurement **vendor** quotation. | `pmo-portal/src/auth/policy.ts:55` |
| T14 | Org-local "today" helper exists: `native_org_today(p_org)` reads `organizations.default_timezone`. | `supabase/migrations/0275_native_revenue.sql:113-118`; column `0198_locale_preference_columns.sql:24` |
| T15 | Day-month display helper exists and renders "12 Oct". It formats in the **browser's** timezone (no `timeZone` option), so a calendar date must be passed as a local-midnight `Date`, never `T00:00:00Z`. | `pmo-portal/src/lib/format.ts:767-772` (`formatDayMonth`) |
| T16 | "Advance to <stage>" on the deal page is a **single click with no confirm** (write policy OD-UX-1); only Mark lost / Declined confirm and Mark won has its inline capture. | `pmo-portal/pages/project-detail/__tests__/PipelineLens.writePolicy.test.tsx:97` (AC-IXD-WP-004) |
| T17 | Shipped tests and flows win deals with a contract date **earlier than the day the deal was created or moved** (e.g. `0029_project_win_path.test.sql:29`, `0170_…test.sql:604`, `client_starting_data_sequence.test.sql:24`, `e2e/serial/AC-1011-win-project.spec.ts:73`). Onboarding a client's existing deals does the same. | as cited |
| T18 | Drag-and-drop on this board (#1637, ruling #1593) moves stages through the same `transition_project` path; it adds `pages/sales-pipeline/DraggableSalesBoard.tsx` and an optional `drag` prop on `SalesKanbanBoard`, and leaves the card body unchanged. | `docs/plans/2026-11-01-board-drag-drop.md` §1.1, S3-T1 |

## 3. Terms

- **Stage entry** — one row recording that a deal entered a stage: *stage*, *entered on* (a calendar date — the
  stage's key date), *recorded by*, *recorded at*, *source*. A deal's entries form its **journey**, ordered by
  journey position (not by date).
- **Key date** — the business date a stage entry stands for. Display labels:

  | `project_status` | Key-date label (card + history) |
  |---|---|
  | Leads | Lead |
  | PQ Submitted | Pre-qual sent |
  | Quotation Submitted | Quoted |
  | Tender Submitted | Tender sent |
  | Negotiation | Negotiation |
  | Won, Pending KoM | Signed (= `contract_date`) |
  | Loss Tender | Lost (= `decided_at` date) |
  | Declined | Declined (= `decided_at` date) |
  | Ongoing Project / On Hold / Close Out / Internal Project | Started / On hold / Closed out / Internal |

  "Quoted", "Tender sent", "Signed", "Lost" are the ruling's words; the rest are recommended defaults (OQ-PSH-1).
- **Stage-date editor** — a user whose role rank is **≥ Project Manager (20)**: Admin, Executive, Finance,
  Project Manager. This is how "Project admin and above, including PMs" maps onto the shipped role set (T12) and
  is the same set that may move a stage today (OQ-PSH-2).

## 4. Functional requirements (EARS)

### History record
- **FR-PSH-001 (ubiquitous)** The system shall keep, for every project, an append-ordered journey of stage
  entries, each holding stage, entered-on date, recorded-by user, recorded-at time and source.
- **FR-PSH-002 (event)** When a project is created, the system shall record one stage entry for its starting
  status, dated the project's creation date in the org's timezone — or, for a row created already won or lost
  (seed / historical import), dated its `contract_date` / `decided_at`.
- **FR-PSH-003 (event)** When a project's status changes by any path, the system shall append a stage entry for
  the new status at the end of the journey, including moves back to an earlier stage (re-quote, re-tender) and
  revivals; earlier entries are never overwritten or removed.
- **FR-PSH-004 (event)** When a deal is won, the system shall date the "Signed" entry with the contract date
  captured at the win; when a deal is lost or declined, the system shall date the entry with `decided_at` in the
  org's timezone. When `contract_date` (or a current loss's `decided_at`) changes by any path, the matching entry
  shall follow it, so Signed always equals the contract date.
- **FR-PSH-004a (conditional)** While earlier entries are dated after the contract date of a win (T17), when the
  deal is won, the system shall move every such entry that the **system** dated (origination / transition /
  backfill, never re-dated) back to the contract date and mark it re-dated; if any such entry was dated by a
  **person** (re-dated, added, imported), the system shall refuse the win with `23514` and change nothing.
  (OQ-PSH-9.)
- **FR-PSH-005 (event)** When a stage moves by any path (deal page, status menu, drag-and-drop), the system shall
  date the new entry with the org's today. Moves stay single-click (T16); backdating is done afterwards with
  "Change date" in the history (FR-PSH-006).

### Correction (backdate / add a skipped stage)
- **FR-PSH-006 (event)** When a stage-date editor re-dates an existing stage entry, the system shall change its
  entered-on date and keep the entry's stage and journey position.
- **FR-PSH-007 (event)** When a stage-date editor adds a skipped stage, the system shall insert a new entry for a
  pre-award stage (Leads … Negotiation) at a chosen journey position before an existing entry.
- **FR-PSH-008 (ubiquitous)** The system shall refuse any write that would leave an entry dated earlier than the
  entry before it in the journey, or dated after the org's today. (Ruling: "a new entry is never dated before the
  previous one.") The ordering half binds every write; the "not after today" half binds every date a person
  picks (re-date, add, import). A win's Signed date is the contract date the win RPC accepts (FR-PSH-004).
- **FR-PSH-009 (conditional)** While the entry being re-dated is a "Signed" entry, when it is re-dated, the system
  shall set the project's `contract_date` and `decided_at` to the new date in the same transaction; while the
  entry is the project's current Loss Tender / Declined entry, when it is re-dated, the system shall set
  `decided_at` to the new date.
- **FR-PSH-010 (conditional)** While a user's role rank is below Project Manager, or the user is not an active
  member of the project's org, when they attempt to re-date or add an entry, the system shall refuse with
  `42501` and change nothing.
- **FR-PSH-011 (ubiquitous)** The system shall refuse every direct client INSERT/UPDATE/DELETE on stage entries;
  writes happen only through the trigger and the security-definer RPCs.

### Audit
- **FR-PSH-012 (ubiquitous)** The system shall audit every stage-entry write: each insert and each re-date lands in
  `record_changes` under the project (field-level old/new), and each correction RPC writes an `audit_events` row
  (`project.stage_entry.redate` / `project.stage_entry.add`) naming actor, entry, stage and old/new date.

### Read surfaces
- **FR-PSH-013 (ubiquitous)** The Sales Pipeline card shall show exactly one concise line for the latest entry:
  `<key-date label> <dd Mon> · <n> d`, e.g. "Quoted 12 Oct · 20 d", where *n* is whole days from the entered-on
  date to today.
- **FR-PSH-014 (state)** While a deal is won (on-hand), its card shall show a "Signed" pill carrying the contract
  date (e.g. "Signed 03 Sep") in place of the stage line.
- **FR-PSH-015 (ubiquitous)** The stale-bid rule and the open-bid stage age shall be computed from the latest stage
  entry's entered-on date (the business date), not from the record-change time.
- **FR-PSH-016 (ubiquitous)** The deal page shall show the full journey — every entry with key-date label, date,
  recorded-by, recorded-at, and a marker when the entry was added or re-dated after the fact. For a won project
  the same history shall appear on the project page.
- **FR-PSH-017 (state)** While the viewer is a stage-date editor, the history shall offer "Change date" on each
  entry and "Add skipped stage" between entries, with the date picker bounded by the neighbouring entries and
  today; other viewers see the history read-only.
- **FR-PSH-018 (ubiquitous)** Any user who can read the project shall be able to read its stage entries; no one
  else shall.

### Proposal from a quotation document
- **FR-PSH-019 (optional, deferred)** Where a quotation document has been issued for the deal, when a user moves
  the deal to Quotation Submitted (or re-dates its Quoted entry), the system shall propose the document's issue
  date as the entered-on date; the user may accept or change it. No such document ships today (T13), so this
  FR is built by the issue that adds the outbound quotation document, on the "Change date" dialog's
  `initialDate` (OQ-PSH-4). Nothing in this issue implements it.

### Import
- **FR-PSH-020 (event)** When a Projects import row carries one or more stage dates (one optional column per
  pre-award stage, Lead date included), the system shall create the project, record one entry per dated stage in
  canonical stage order, and land the project at the latest dated stage. The Leads entry takes the Lead date when
  given; otherwise the earlier of the creation date and the first imported date (so a just-created lead can carry
  past stage dates without breaking FR-PSH-008).
- **FR-PSH-021 (conditional)** While an import row's stage dates are out of canonical order, in the future, or
  given for a row whose status is Internal Project, the import preview shall reject that row with zero writes.

### Existing data
- **FR-PSH-022 (event)** When the feature ships, the system shall backfill a journey for every existing project
  from its recorded status changes (`record_changes`), its creation date, `contract_date` and `decided_at`, and
  mark those entries `source = backfill`.

## 5. Non-functional requirements

- **NFR-PSH-001 (security, ADR-0016/0019)** The editor-rank rule, the ordering rule, org isolation and the
  no-direct-write rule are enforced server-side (security-definer RPC + constraint trigger + RLS + grants) and
  each is proven by pgTAP; the FE gate is a UX projection only.
- **NFR-PSH-002 (money-path safety)** The body of `transition_project` (win SoD, 0236) is **not** modified. Stage
  entries are appended by an AFTER trigger on `projects`; there is no wrapper RPC and no session flag that can
  switch the trigger off.
- **NFR-PSH-003 (tenancy)** Every stage entry carries `org_id`, stamped server-side from the project; never sent by
  the client.
- **NFR-PSH-004 (performance)** The card line and stage age come from the existing pipeline read (one indexed
  lateral lookup per row on `(project_id, position desc)`); no extra request per card. The won/lost columns use
  `contract_date` / `decided_at` already on the project row.
- **NFR-PSH-005 (reversibility)** One forward migration and a rollback script that restores 0385's two functions
  and 0281's `record_history_visible` verbatim and drops the new objects.
- **NFR-PSH-006 (i18n)** All new copy goes through `react-i18next` with English defaults and Bahasa keys; the
  date chip uses `formatDayMonth` (T15).
- **NFR-PSH-007 (a11y)** The card line is text (not colour-only); the history is a semantic ordered list; the date
  dialogs are labelled and keyboard-operable.

## 6. Acceptance criteria (Given / When / Then)

| AC | Owning layer | FR |
|---|---|---|
| AC-PSH-001 | pgTAP | 002, 003 |
| AC-PSH-002 | pgTAP | 004, 004a |
| AC-PSH-003 | pgTAP | 005, 006, 008 |
| AC-PSH-004 | pgTAP | 006, 008, 009 |
| AC-PSH-005 | pgTAP | 007, 008 |
| AC-PSH-006 | pgTAP | 010, 011, 018, NFR-001/003 |
| AC-PSH-007 | pgTAP | 012 |
| AC-PSH-008 | pgTAP | 015 |
| AC-PSH-009 | pgTAP | 022 |
| AC-PSH-010 | pgTAP | 020 |
| AC-PSH-011 | Vitest | 013 |
| AC-PSH-012 | Vitest | 014 |
| AC-PSH-013 | Vitest | 016, 017 |
| AC-PSH-014 | — (deferred with FR-PSH-019) | 019 |
| AC-PSH-015 | Vitest | 021 |
| AC-PSH-016 | Playwright | 005, 006, 013, 016, 017 (cross-stack journey) |

- **AC-PSH-001 — every entry kept, including going back.**
  Given a Leads project, When a PM moves it Leads → PQ Submitted → Quotation Submitted → Tender Submitted →
  Quotation Submitted, Then the project has five entries in that order with sources `origination, transition ×4`,
  and the first four are unchanged by the re-quote.
- **AC-PSH-002 — key dates for Signed and Lost.**
  Given a deal at Tender Submitted, When it is won with contract date D, Then the newest entry is
  `Won, Pending KoM` dated D; and Given another deal, When it is moved to Loss Tender, Then its newest entry is
  dated `decided_at` in the org's timezone; And When a won deal's `contract_date` is changed server-side, Then its
  Signed entry carries the new date; And Given a deal whose system-dated entries are all today, When it is won with
  a contract date 10 days ago, Then the win succeeds, the Signed entry is dated 10 days ago and the earlier entries
  are moved back to it and marked re-dated; And Given an earlier entry a person dated after that contract date,
  Then the win raises `23514` and the deal is still open.
- **AC-PSH-003 — a move is dated today; backdating is bounded by both neighbours and today.**
  Given a Leads deal created 60 days ago, When a PM moves it to PQ Submitted, Then the new entry is dated the org's
  today; When they re-date it to 20 days ago, Then it reads 20 days ago; When they re-date the Leads entry to 10
  days ago (after PQ), Then `23514` and nothing changes; And a date after the org's today raises `23514`.
- **AC-PSH-004 — re-date an entry; Signed syncs contract date.**
  Given a won deal whose journey is Tender 2026-09-01 → Signed 2026-09-20, When an Executive re-dates the Signed
  entry to 2026-09-15, Then the entry, `projects.contract_date` and `decided_at` all read 2026-09-15; And
  re-dating it to 2026-08-31 (before Tender) raises `23514` and changes nothing.
- **AC-PSH-005 — add a skipped stage between neighbours.**
  Given a journey Leads 2026-08-01 → Tender Submitted 2026-09-01, When a PM adds Quotation Submitted dated
  2026-08-20 before the Tender entry, Then the journey reads Leads → Quotation Submitted → Tender Submitted with
  source `added`, the project's status is unchanged; And adding it dated 2026-09-02 raises `23514`; And adding a
  `Won, Pending KoM` entry raises `P0001`.
- **AC-PSH-006 — who may write and read.**
  Given org-A and org-B projects, When an org-A Engineer re-dates an org-A entry, Then `42501`; When an org-A PM
  re-dates an org-B entry, Then `42501`; When a disabled PM re-dates an own-org entry, Then `42501`; When any
  authenticated user inserts/updates/deletes `project_stage_entries` directly, Then `42501`; When an org-A user
  selects stage entries, Then they see org-A's rows only.
- **AC-PSH-007 — every change audited.**
  Given a re-date and an added stage, Then `record_changes` holds an `update` (entered_on old/new) and an
  `insert` event for the stage-entry entity with `parent_type = 'project'`, and `audit_events` holds
  `project.stage_entry.redate` and `project.stage_entry.add` rows with the actor and old/new dates.
- **AC-PSH-008 — stage age is the business date.**
  Given an open deal whose latest entry is re-dated to 100 days ago, When `get_sales_pipeline()` is read, Then its
  `stage_started_at` is that date and `get_win_rate()` counts it in `stale_count`.
- **AC-PSH-009 — backfill.**
  Given a project created before the migration with two recorded status changes and a contract date, When the
  migration has run, Then it has three entries (start, two changes) with source `backfill`, the Signed entry dated
  `contract_date`, and dates non-decreasing along the journey.
- **AC-PSH-010 — import with stage dates.**
  Given a Leads project created today with only its origination entry, When `import_project_stage_history` is
  called with PQ 2026-07-01 and Quoted 2026-07-15, Then the journey is Leads (2026-07-01) → PQ → Quotation with
  source `import` on the two imported entries, the status is Quotation Submitted, and a second call raises
  `P0001` (idempotent refusal).
- **AC-PSH-011 — the card's one line.**
  Given an open deal whose latest entry is Quotation Submitted dated 12 Oct and today is 1 Nov, When the card
  renders, Then it shows exactly one stage line "Quoted 12 Oct · 20 d".
- **AC-PSH-012 — Signed pill.**
  Given a won deal with contract date 3 Sep, When its card renders in the Won column, Then it shows a "Signed
  03 Sep" pill and no stage line; And a won deal with no contract date shows "Signed" with no date.
- **AC-PSH-013 — deal page history + edit affordances.**
  Given a deal with a re-quote in its journey, When a PM opens the deal page, Then the history lists every entry
  newest-first with label, date and recorder, a re-dated entry shows "Date changed", and "Change date" / "Add
  skipped stage" are offered; When an Engineer opens it, Then the same list shows with no edit affordances; And
  in the date dialog nothing is written until the user presses "Save date", and a date outside the neighbouring
  entries or after today cannot be saved.
- **AC-PSH-014 — quotation proposes the Quoted date (deferred with FR-PSH-019).**
  Given an issued quotation document dated 10 Oct, When a PM opens "Change date" on the Quoted entry, Then the
  date field is pre-filled with 10 Oct and labelled as proposed from the quotation. Owned by the outbound
  quotation issue; no test in this issue.
- **AC-PSH-015 — import preview refusals.**
  Given an import row with Quoted 2026-07-01 and PQ 2026-07-15, Then preview rejects the row ("stage dates must
  not go backwards"); Given a row dated tomorrow, Then rejected; Given an Internal Project row with a stage date,
  Then rejected; zero writes in each case.
- **AC-PSH-016 — journey (e2e).**
  Given the PM signs in and an open deal is at PQ Submitted, When they click "Advance to" Quotation Submitted on
  the deal page, Then the history's newest entry is Quoted dated today; When they change that entry's date to 12
  days ago and save, Then the history shows it marked "Date changed", and the board card reads
  "Quoted <that date> · 12 d".

## 7. Open questions (with recommended defaults — the default applies unless the owner rules otherwise)

- **OQ-PSH-1 — labels for stages the ruling did not name.** *Default:* the table in §3.
- **OQ-PSH-2 — "Project admin and above, including PMs."** No role of that name exists (T12). *Default:* role
  rank ≥ Project Manager (Admin, Executive, Finance, PM) — identical to who may move a stage today; a PM is not
  limited to own projects, matching `transition_project`.
- **OQ-PSH-3 — re-dating the Signed entry moves `contract_date`.** It is the deal's key date and the ruling says
  Signed = contract date, so they must not diverge. The ERP revenue dispatch reads `contract_date` at dispatch
  time (`pmo-portal/src/lib/adapterSeam/erpnext/dispatchRevenue.ts:44-56`), so documents already sent keep the
  old date. *Default:* allowed for stage-date editors, audited; no Finance-only gate.
- **OQ-PSH-4 — quotation document.** None ships (T13). *Default:* nothing built here; the outbound-quotation
  issue adds the proposal on the "Change date" dialog's `initialDate` (FR-PSH-019, AC-PSH-014). A proposal seam
  with no document behind it would always propose today, which the dialog already does.
- **OQ-PSH-5 — removing a wrong entry.** *Default:* not in this issue; correct by re-dating. An Admin-only
  "remove added stage" can follow if asked.
- **OQ-PSH-6 — import of won/lost dates.** *Default:* the in-app import takes dates for pre-award stages only
  (won needs the contract SoD + client reference); won/lost history comes from the win RPC or the operator
  historical import, whose rows get their entry from the insert trigger (FR-PSH-002).
- **OQ-PSH-7 — re-quote in a flat import row.** One date per stage cannot express a back-and-forth. *Default:*
  accepted limitation; correct afterwards on the deal page.
- **OQ-PSH-8 — "· n d" on lost cards.** *Default:* lost cards show "Lost 03 Sep · 58 d" from `decided_at`.
- **OQ-PSH-9 — a win dated before earlier stage dates (owner).** The ruling says a new entry is never dated before
  the previous one, but a win's date is the contract date the user enters, and deals are routinely recorded after
  they were signed (T17). Refusing would break the shipped win flow and client onboarding. *Default:*
  FR-PSH-004a — entries the system dated are moved back to the contract date and marked "Date changed"; entries a
  person dated are never moved silently, so the win is refused until that date is corrected.

## 8. Out of scope

- Changing the legal transition map, the win SoD, or the body of `transition_project`.
- Drag-and-drop on the board (#1637, ruling #1593) — it calls the same move path and so records entries (dated
  today) automatically; any date is correctable from the history. This issue builds on top of #1637.
- A date picker on "Advance to" (T16 keeps it single-click); a dated-move RPC.
- A new outbound quotation document type (OQ-PSH-4).
- Deleting stage entries (OQ-PSH-5); per-stage notes; stage-duration analytics or reports beyond the existing
  stale-bid rule.
- Changing `get_win_rate`'s period logic (it keeps using `decided_at`, which FR-PSH-009 keeps in sync).
