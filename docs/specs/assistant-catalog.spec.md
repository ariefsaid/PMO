# Feature: Assistant catalog — `find`, `read` and `act` over one generated catalog

> **Supersedes** the help-corpus parts of [`deputy-help.spec.md`](deputy-help.spec.md) (FR-DH-001..003/011: the hand-written `HELP_CORPUS` in the prompt retires; "how do I" answers come from the user guide through `find`) and the per-tool entity list of [`agent-assistant-panel.spec.md`](agent-assistant-panel.spec.md) / [`assistant-accuracy.spec.md`](assistant-accuracy.spec.md) once the cutover gate (§9, RG-1) passes.
>
> **Issue:** #3084 (map #720). **Decided by the owner (2026-11-28, two grill rounds on the issue) and not reopened here:** three model tools; drafts and submits only; every role and area; guide search replaces the help text; the answer follows the user's app language; the whole panel re-matched to the beautifului.dev demo in PMO tokens; MCP moves after 15 Dec if time is short, nothing else drops. Director rulings of 2026-11-28 on the first draft's open points are in §11 (Decided).
> **Related:** DD-API-1/2/3 (`docs/decisions.md`), ADR-0016 (RLS is the authority), ADR-0017, ADR-0019 (server-enforced SoD), ADR-0036 (deputy), ADR-0039 (untrusted output), ADR-0045, ADR-0050 (layered prompt), ADR-0051 (approval materiality), ADR-0052 (eval harness), ADR-0127 (this feature's generation choice). **Plan:** [`docs/plans/2026-11-28-assistant-catalog.md`](../plans/2026-11-28-assistant-catalog.md).
> **Spec ID prefix:** `ACG` (`FR-ACG-###`, `NFR-ACG-###`, `AC-ACG-###`).

## 1. Overview and job stories

The assistant reads 27 record types through 11 model tools. The app has grown past that: the DAL reads
242 distinct tables, and work orders, daily site reports, material requests, expense claims, site cash,
equipment, crews, leave, billing steps and sales invoices are invisible to the assistant, which also cannot
start any of their jobs. Adding one hand-written tool per feature would put 50–100 tool definitions in every
turn.

This feature replaces the per-feature tools with three: **`find`** (search a generated catalog of record types,
actions and user-guide pages), **`read`** (today's `query_entity`, widened to the catalog) and **`act`**
(draft or submit one allow-listed action behind the existing confirm card). The catalog is generated from the
app's own data surface (DD-API-1), so the same catalog can back an MCP server later (phase 2). `ask_user` and
`compose_view` stay (§3).

Job stories (the role-job walks in `docs/jtbd.md` §6 are the oracle):

- **Site engineer.** When I am on site and need cement, I say "request 20 bags of cement for WO-0007, needed Friday"; I see a confirm card with the project, work order, item, quantity and date, and after I confirm the request is with its approver and I get a link to it (ENG-6, CF-FC-4).
- **Site supervisor.** When the day ends I say "submit today's site report for WO-0007"; the assistant saves what I tell it as a draft, shows the card, and the report goes to the next-day validator (CF-FC-1).
- **Any worker.** When I do not know how to do something I ask "how do I claim a taxi fare?" in Bahasa; the assistant answers from the guide page for my role, in Bahasa, with the page named (ENG-8).
- **Project manager.** When I ask "which work orders are over plan this month and what is waiting on me?" the assistant finds the record types, reads them under my own access and answers with a table I can sort (PM-1, PM-2, PM-9).
- **Finance.** When I ask "what is still unpaid on this project?" I get only what my role may read; when a colleague without money access asks, they are told the record is not available for their role (AP-1, AP-6).
- **Admin.** When our plan switches a module off, the assistant stops offering it, without a release (ADM-6).

## 2. Current state (measured 2026-11-28 on `origin/dev` e879385d3)

| Measure | Today | Method |
|---|---|---|
| Model tools per turn | 11 (`query_entity`, `query_stock`, `whats_overdue`, `create_activity`, `update_task_status`, `draft_invoice`, `remind_overdue`, `notify`, `create_automation`, `ask_user`, `compose_view`) | `buildTools(true, null)` in `supabase/functions/agent-chat/actionCatalog.ts`, all gates on |
| Tool definitions, JSON | 9,707 chars | same call, `JSON.stringify` |
| System prompt | 27,419 chars, of which the help text `HELP_CORPUS` is 5,995 | `buildPlanAwarePrompt(50, 'Finance', …)` with all gates on |
| Fixed context per model round | 37,126 chars ≈ **9,300 tokens** (chars ÷ 4; the provider's own `prompt_tokens` in `agent_usage` is the authority and S0 records it) | sum of the two rows above |
| Readable record types | 27 (`AGENT_READ_ENTITIES`) + 1 stock RPC read | `readEntities.ts` |
| Tables the DAL reads | 242 distinct (`.from('<table>')` in `pmo-portal/src/lib/db` and `src/lib/repositories`, non-test; 233 in `lib/db` alone) | `grep -rhoE` count, deduplicated |
| RPCs the app calls | 614 distinct (`.rpc('<name>')` in `pmo-portal/src`, non-test) | `grep -rhoE` count, deduplicated |
| Write actions | 5 (`create_activity`, `update_task_status`, `draft_invoice`, `remind_overdue`, `create_automation`) | `actionCatalog.ts` |
| User-guide pages on dev | 22 + README (165 KB, ≈ 41k tokens: too big to inject) | `docs/user-guide/` |
| Panel as rendered on dev | suggested questions are bordered boxes that only fill the input; the composer has a text "Send" button; no visible thinking steps or tool chips while working; answers are plain text with no source chips and no copy / retry / feedback row; a write proposal is not an approval card; an error is a full-width red box | Director's rendered review, 2026-11-28 (the component files named in `THIRD_PARTY_NOTICE.md` exist, the rendered panel does not match the demo) |
| Eval baseline | 86/90 case-runs (9 cases × 10 suite runs), every completed turn chose the correct tool, the 4 misses were truncated local streams; deployed model `deepseek/deepseek-v4.1-flash-1017` | #1596 result comment |

## 3. Scope

**In (15 Dec):** the generator and its checks; `find` (records, actions, guide pages, terms); `read` over the
catalog; `act` with the actions in §8; plan-switch and role handling; answer language; the whole-panel re-match to the beautifului.dev demo (FR-ACG-070..084); eval cases and the cutover gate; retirement of `helpCorpus.ts` and the per-feature tools.

**Stay as they are:** `ask_user` (a UI interaction that touches no data) and `compose_view` (it builds a
preview artifact on a different output path and has its own plan key `user_views`). `notify` stays registered
while automations are enabled because automation runs fire through the same handler (`agent-dispatch` calls
`agentChatHandler`); it is not a catalog entry. Chat turn tool set after cutover: `find`, `read`, `act`,
`ask_user`, `compose_view` (+ `notify` while automations are on) — 5, down from 11.

**Out:** model-written code execution (Cloudflare's full Code Mode; the model here is small and `read` already
filters, groups and sums); approvals, rejections and send-backs; money actions (payment, receipt, posting, release);
status transitions DD-API-3 keeps closed (project, work order, budget activation, contract value); deletes and
archives; users, roles and settings; ERP and integration actions; file and photo upload; clock-in (it needs the
phone's position, which the assistant does not have). The MCP server is phase 2 (§10). The user-guide pages
themselves are #3085 and are not built here.

## 4. Definitions

- **Catalog** — the generated module `supabase/functions/agent-chat/catalog/catalog.generated.ts`: entities, actions, recipes and guide chunks, each with a stable key, an English and an Indonesian description, search aliases, a plan-switch key (or none = core) and coarse role hints.
- **Entity** — a record type the model can `read`: a key, a table or view the caller's session reads, columns with types, and flags. (Not the operating-company Entity of `docs/glossary.md`.)
- **Action** — a named, schema-validated draft or submit that `act` can run: a target RPC or insert, fixed arguments the model cannot change, a role hint, a confirm-card summary template.
- **Recipe** — an entity whose read is served by an existing handler (`overdue_work`, `stock_on_hand`, `stock_movements`) so its role and cost rules are not re-implemented.
- **Fragment** — a curated JSON file in `supabase/functions/agent-chat/catalog.d/` that adds what the database cannot say (descriptions, aliases, roles, plan key, action arguments).
- **Preflight role hint** — a coarse list used to say "not available for your role" early and to keep `find` honest. It is never the authority; RLS, masked views and RPC checks are (ADR-0016).

## 5. Functional requirements (EARS)

### 5.1 Generation

- **FR-ACG-001** The assistant shall take every record type and action it offers from the generated catalog; after cutover no entity or action is registered by hand in `prompt.ts`, `schema.ts` or `actionCatalog.ts`.
- **FR-ACG-002** The generator shall read, from the local database after reset: tables, views, columns, types, primary keys, the columns the signed-in role may SELECT (`information_schema.column_privileges`), `COMMENT ON` text, and function argument names and types; and, from `catalog.d/*.json`, the fragments. Repeated runs shall write byte-identical output.
- **FR-ACG-003** When the data layer reads a table that the signed-in role may SELECT, the check shall fail unless a fragment classifies the table as `entity`, `recipe-source` or `skip` (with a reason code). This is the DD-API-1 allow-list made machine-checked: a new feature cannot reach the DAL without a decision about the assistant.
- **FR-ACG-004** An RPC or insert shall become an action only when a fragment names it. The check shall fail when a fragment names a function that does not exist, whose argument names or types differ, or that is not executable by the signed-in role.
- **FR-ACG-005** The generator shall refuse an action whose target is closed: names matching approve, reject, return, decide, post, pay, cancel, void, delete, archive, activate, release, reverse, `set_*`, `*_settings`, the project and work-order transitions, the contract-value RPC, the admin and operator RPC sets in `scripts/pmo.mjs`, and any `transition_*` target whose fixed target status is not `Submitted`.
- **FR-ACG-006** Each entity and action shall carry an English and an Indonesian description of at most 160 characters; generation fails on a missing one. A database `COMMENT ON` text may stand in for the English description only.
- **FR-ACG-007** An entity's columns shall be the columns the signed-in role may SELECT, minus the global deny patterns (tenancy column, import plumbing, storage paths and links, idempotency keys, e-mail, phone, tokens) and the fragment's `hidden` list. For the 27 current entities the result shall equal today's curated lists exactly.
- **FR-ACG-008** An entity shall name the table or **view** the app reads for that data (for example the masked procurement views), so price hiding stays in the database.
- **FR-ACG-009** The catalog shall carry a content hash; every turn's telemetry shall record it.
- **FR-ACG-010** A new feature shall join the catalog by adding or editing one fragment (about five lines per entity); no change to prompt, schema, tool registry or handler is needed. Fragment templates and the writing guide live in `catalog.d/README.md`.

### 5.2 `find`

- **FR-ACG-011** `find(query, kind?, limit?)` shall return at most 6 results (default 5, hard maximum 8) drawn from entities, actions, guide chunks and terms, ranked lexically over key, aliases and description in the user's language, with English as fallback.
- **FR-ACG-012** `find` shall return only entries visible for this request: plan switch on or core, and preflight role passing. A hidden entry shall not appear, be counted, or be hinted at.
- **FR-ACG-013** An entity result shall carry its key, one-line description, columns with types, which columns can be summed or grouped, and any required filter. An action result shall carry its name, description, arguments (type, required, allowed values), who may do it, and that it needs confirmation. A guide result shall carry the page title, section, an excerpt of at most 600 characters, the page path and the role hint.
- **FR-ACG-014** When nothing matches, `find` shall say so and return no results; it shall not suggest a record type or action that was not found.
- **FR-ACG-015** `find` shall run in the function's process with no database call and no model call.

### 5.3 `read`

- **FR-ACG-020** `read` shall accept today's `query_entity` parameters (`entity`, `columns`, `filter` of 1–3 ANDed filters, `order_by`, `group_by`, `sum`, `limit`, `as`) for any visible entity, with unchanged limits: 50 rows for a list, 5,000 rows and 200 groups for an aggregate, 5 s timeout, internal hard filters and required filters honoured.
- **FR-ACG-021** When the entity is unknown or hidden, `read` shall return an error with up to three visible suggestions from the catalog and no data.
- **FR-ACG-022** When the entity is off on the plan, `read` shall return `FEATURE_OFF`; when the role fails preflight, `NOT_AVAILABLE_FOR_ROLE`. Both are typed so the assistant tells the user plainly, never "there are none".
- **FR-ACG-023** `read` shall run only through the caller's own session; it shall never use a service role.
- **FR-ACG-024** The recipe entities `overdue_work`, `stock_on_hand` and `stock_movements` shall return what `whats_overdue` and `query_stock` return today, including the rule that unit cost appears only to roles that may see it.
- **FR-ACG-025** `as: "table"` shall continue to render an ordinary row list as a data table widget.

### 5.4 `act`

- **FR-ACG-030** `act(name, args)` shall be the only model-callable way to change data, and every call shall stop at the confirm card (a proposal event) before anything is written. The one carry-over is `update_task_status`, which keeps its current ADR-0051 materiality rule (decided, §11 D-5).
- **FR-ACG-031** The action name shall be a visible catalog action and the arguments shall validate against its schema (types, required, allowed values, lengths, no extra keys); otherwise `act` returns the list of problems and proposes nothing.
- **FR-ACG-032** The confirm card text shall be composed by the server from the action's template and resolved labels (project, work order, item names), in the user's language; model text shall never be the card.
- **FR-ACG-033** On approval the server shall re-derive the caller's role and organisation, re-check the plan switch (an unresolved plan refuses with `PLAN_UNVERIFIED`), and then run the action under the caller's own session.
- **FR-ACG-034** The runner shall call only the catalog's target. Fixed arguments shall be applied after the model's arguments and win; only declared argument names reach the database; a model-supplied table, RPC or status name shall never be used.
- **FR-ACG-035** Where the target takes a client request id, the server shall supply it from the approval, so a retried approval does not create a second record; the validated-argument journal replays a completed call.
- **FR-ACG-036** On success `act` shall return the new or changed record's id and its in-app link; on a database refusal it shall return the database's plain message so the assistant can say it did not happen.
- **FR-ACG-037** The catalog shall contain no approval, rejection, send-back, payment, receipt, posting, release, cancellation, deletion, archive, project or work-order transition, contract-value, budget-activation, user, role or settings action (FR-ACG-005 enforces it).
- **FR-ACG-038** `act` shall add no privilege: whatever the database refuses to the user's own session it refuses to `act`, including separation of duties, plan limits and light-account limits.

### 5.5 Guide and language

- **FR-ACG-050** The build shall index `docs/user-guide/**/*.md` (except `README.md`) into chunks, one per second-level section per language (the English sections, then the `Bahasa Indonesia` part), keeping page title, path and the "Who can do this" line as a role hint; the index shall be a generated TypeScript module in the same folder as the catalog.
- **FR-ACG-051** The README's "Words this guide uses" section and a curated `terms` fragment shall be indexed as terms, replacing the glossary part of the retired help text.
- **FR-ACG-052** The index shall be regenerated by one command, and a CI check shall fail when it differs from the pages.
- **FR-ACG-053** When the user asks how to do something, the prompt shall tell the model to call `find` with kind `guide`, answer from the returned steps, name the page, and describe only what the user's role may do (charter rule 9 carries over).
- **FR-ACG-054** The panel shall send the user's app language (`en` or `id`) in the run context; the server shall validate it, put "answer in that language" in the prompt, and `find` shall rank that language first. A missing value means English.
- **FR-ACG-055** When no page exists in the user's language, `find` shall return the English page and say so.
- **FR-ACG-056** `helpCorpus.ts` and its test shall be deleted at cutover; no hand-written help text remains in the prompt.

### 5.6 Plan switches and roles

- **FR-ACG-060** An entity or action with a plan key that resolves off for the caller's organisation shall be hidden from `find`, refused by `read` and `act`, and absent from the prompt, with no code change per feature; the "not on this organisation's plan" paragraph is built from the same switches as today.
- **FR-ACG-061** The money-read rule of migration 0350 shall hold for every entity that carries it: for roles outside Admin, Executive, Project Manager and Finance, `read` of vendor bills and payments (and the new money entities in §7 marked **$**) returns `NOT_AVAILABLE_FOR_ROLE`.
- **FR-ACG-062** A role shall read through `read` exactly the columns it reads in the app today: for every entity and role in the parity matrix (§9, AC-ACG-014/015) the column set and the value of every price column equal what the legacy `query_entity` returned for the same role.
- **FR-ACG-063** A price-hidden requester shall receive the same withheld values through `read` as through the app (the masked views stay the read path).

### 5.7 Panel (the whole panel re-matched to the beautifului.dev demo, in the same push)

The component files exist on dev, but the rendered panel does not look or behave like the demo (§2). This
section therefore re-matches the **whole panel** — layout, spacing, type scale, motion and every state — to the
demo at https://www.beautifului.dev (components, layout and motion from the library; colours, fonts and radii from
PMO's `DESIGN.md` tokens, in each theme the app ships). §5.7.1 lists, per demo component, what the panel must match
(read from the rendered demo on 2026-11-28).

- **FR-ACG-070** The panel shall match the demo's layout, spacing, type scale, motion and every state listed in §5.7.1, in PMO tokens and fonts; acceptance is the side-by-side rendered comparison RA-1 (§9) plus a clean `scripts/ux-proof.sh` on the touched routes.
- **FR-ACG-071** When the user clicks a suggested question, the panel shall send it at once; it shall no longer only fill the box. Suggested questions and follow-ups shall render as the demo's hairline-divided rows with a return glyph, not as bordered boxes.
- **FR-ACG-072** The panel shall not show "Answers are read-only for now."; the empty state shall say what the assistant can do (find, read, draft and submit with confirmation).
- **FR-ACG-073** The composer shall be the demo's Prompt Bar card: placeholder text, an attach button where attachments are enabled, and an icon-only circular send button (accessible name "Send", disabled until there is text, replaced by a stop control while a run is in flight); the text "Send" shall not be shown.
- **FR-ACG-074** While a run is working the panel shall show the demo's Loading State (shimmer label and elapsed seconds, announced once), an expandable Thinking trace ("Thought for N seconds" with the steps taken), and Tool Chips live (a "N tool calls" header and one row per call: icon, verb, object pill); a multi-step run shall show Task Rows (status circle, title, meta, status badge, expandable sub-rows).
- **FR-ACG-075** A finished answer shall render as Streaming Text: inline source chips, an action row (copy, retry, thumbs up, thumbs down), stacked source avatars with an "N sources" expander that lists each source, and a Follow-ups row (up to two, each sends on click) when the answer offers them. Sources shall come from the server (FR-ACG-085): the record types read and the guide pages found in the turn, never row data.
- **FR-ACG-076** A proposal from `act` shall render as an Approval Card: the server summary as the title, the key fields as label-value rows, Deny and Approve (the card's Skip and Continue positions), with the states pending, approving, approved, denied and refused, a dismiss control, and focus returned to the composer after a decision.
- **FR-ACG-077** An `ask_user` question shall render as the demo's Approval Card question form: option rows with radio marks, a free-text row, a question stepper when there is more than one, Skip, and Continue disabled until an answer is chosen.
- **FR-ACG-078** An error shall render as a compact error card inside the turn it belongs to, with a retry action and the plain reason; the panel shall no longer show a full-width red box.
- **FR-ACG-079** Record lists and record summaries shall render as Records Table (sortable columns, status as tag pills, row number, row link) and Context Cards (title, size or count meta, excerpt, source-type badge with the source name).
- **FR-ACG-080** The panel shall render the model's table or card answers through OpenUI (`@openuidev/react-lang`) from a closed component registry (Records Table, Context Card, KPI tile, chart); anything outside the registry shall fall back to text and no raw markup from the model shall be inserted (ADR-0039).
- **FR-ACG-081** The chat shell shall match the demo's Chat: header with thread tabs, new-thread, history and options controls; the user's message as a right-aligned rounded pill; each assistant turn opening with the line of tool label, source and duration, then the answer as plain flow without a bubble.
- **FR-ACG-082** The panel shall meet the #2047 acceptance checks: one "working" announcement per run, focus back in the composer after send, `focus-visible` rings only, no re-render of earlier transcript items per streamed frame.
- **FR-ACG-083** Tool activity shall carry the plain label of each step in the user's language (for example "Searching the catalog", "Reading work orders", "Preparing a material request").
- **FR-ACG-084** Every panel string shall exist in English and Bahasa.
- **FR-ACG-085** The final answer event shall carry a `sources` list (record-type keys read and guide pages found in the turn, with titles and paths) so the panel can draw source chips; it shall carry no row data.

#### 5.7.1 What the panel must match, per demo component

Read from the rendered demo (light and dark, 2026-11-28). "Panel must" is the requirement; the demo's variant
toggles (loader styles, rounded or pill bar, capsules or list) are demo switches: the panel picks one and keeps it.

| Demo component | The demo shows | The panel must |
|---|---|---|
| Loading State | pixel-grid loader with shimmer, a verb label ("Churning") and elapsed seconds, in a status region; four loader styles | one loader style, shimmer label, elapsed seconds, announced once (FR-074) |
| Thinking | collapsible "Thought for N seconds" with a sparkle icon and chevron; expanded: step lines, a count chip ("6 flavors"); Steps / Reasoning / Search / Coding views | collapsible trace with the run's steps and the search step (`find`); a Reasoning view only if the provider returns reasoning |
| Streaming Text | answer paragraphs with inline mono source chips; below: copy, retry, thumbs up, thumbs down, stacked source avatars, "N sources" expander with source cards; "Follow-ups" label with hairline return rows | all of it (FR-075, FR-085) |
| Approval Card | compact card: question title, dismiss ×, radio option rows, "Something else…" row, stepper "1/3", Skip, Continue (primary, disabled until a choice) | the `ask_user` form (FR-077) and, with label-value rows and Deny / Approve, the `act` confirm (FR-076) |
| Tool Chips | header "4 tool calls, 2 messages" with chevron; rows of icon + verb + mono object pill; diff chips with +n −n; "+2 more" | live rows per call, grouped under a collapsible header, "+N more" past four (FR-074) |
| Task Rows | capsule rows: status circle (number while running, check when done, failed state), title, meta, status badge, chevron to sub-rows; Capsules / List switch | rows for a multi-step run (FR-074); the switch is not built |
| Chat | tabbed header with new, history and options; right-aligned user pill; assistant turn opens with tool label, source and duration, then plain text; composer card at the bottom | the shell as shown (FR-081) |
| Prompt Bar | composer card with attach (+), textarea, model picker, dictation, circular send; `@` sources list with descriptions and a Connected badge; `/` commands | the card, attach and the icon send (FR-073); `@` sources, `/` commands, model picker and dictation are **not built** (no backing feature; assumed within D-1, vetoed or kept at the RA-1 review) |
| Context Cards | "All chunks 32" counter; cards with title, "290 characters", excerpt, type badge (PDF, CSV) and file name | cards for records and guide pages (FR-079) |
| Records Table | CRM-style grid: header with sort buttons, tag pills, relationship status, row numbers, view options | sortable columns, status tag pills, row number and link (FR-079); the view-options controls are not built |
| Recommendation Card, Diff Table, Filter Table, Sidebar Nav, Search, Flowchart, Insight Cards, Code Block, Fine-tune Card, Selection Actions, Agent Screen | other demo components | not used in this feature |

### 5.8 Rollout

- **FR-ACG-080** The server shall support a switch between `legacy`, `both` and `new` tool sets, changeable without a code release, so the old tools can be removed only after the gate and restored if a regression appears after.
- **FR-ACG-081** The old tools and `helpCorpus.ts` shall be deleted only after RG-1..RG-4 (§9) pass.

## 6. Non-functional requirements

- **NFR-ACG-001 (context per round).** Fixed context (tool definitions + system prompt, before conversation, page hint and tool results) shall be at most **12,000 characters** for a Finance user with every module on, against 37,126 today (−68%); the target in tokens is ≤ 3,000 against ≈ 9,300. It shall not grow with the number of catalog entries: the catalog is never in the prompt, only `find` results are.
- **NFR-ACG-002 (find result).** One `find` reply shall be at most 3,600 characters (≈ 900 tokens).
- **NFR-ACG-003 (rounds).** In the eval cases a record question shall complete in at most 3 model rounds (find, read, answer) for 90% of runs; a question about a record type named in the prompt's one-line list of common keys may skip `find`.
- **NFR-ACG-004 (latency).** `find` p95 ≤ 50 ms in the function; catalog and guide index load adds ≤ 100 ms to a cold start (measured in S2; the index is split by language if it does not); time to the first streamed word shall not increase against the S0 baseline by more than 10% (p50).
- **NFR-ACG-005 (cost).** Median cost per completed run on the eval suite shall be no higher than the S0 baseline measured the same way (`docs/runbooks/agent-cost-measurement.md` Q2), expected lower from the smaller fixed context even with one more round.
- **NFR-ACG-006 (security).** No catalog path adds privilege. The model never supplies a table, view, RPC or status name that reaches the database; arguments are validated twice (at proposal and at execution); record text stays data (charter rule 11).
- **NFR-ACG-007 (determinism).** Catalog and guide index output is byte-identical for identical inputs; CI fails on drift.
- **NFR-ACG-008 (public repo).** Fragments, guide index and docs contain no personal data, client names, secrets or environment names.
- **NFR-ACG-009 (a11y/i18n).** Every new panel state is keyboard-operable, announced once, and present in English and Bahasa.
- **NFR-ACG-010 (no migration).** The feature adds no migration and no table; if an action target lacks a database-side rule it needs, that is a separate defect handled in the private channel, not a catalog task.

## 7. Record types to add (read side)

The 27 current entities keep their keys and curated columns. The list below adds record types by area; **roles
are preflight hints**, to be confirmed in S1 against `role_table_grants` and `pg_policies` at head (the
deciding artifacts) before any entity ships. **$** = money entity (money-read roles only, FR-ACG-061). Plan key
"—" = core. **Wave 1** is needed for the 15 Dec go-live jobs; **Wave 2** follows in the same push if time allows
and is otherwise a fragment-only follow-up (no code).

| Area | Key (table or view, confirmed in S1) | Reads (preflight) | Plan key | Wave |
|---|---|---|---|---|
| Delivery | `work_orders` | all | — | 1 |
| Delivery | `work_order_lines` (scope and BOQ lines) **$** | Admin, Exec, PM, Finance | — | 1 |
| Delivery | `work_order_acceptances` **$** | Admin, Exec, PM, Finance | — | 1 |
| Delivery | `boq_items` **$** | Admin, Exec, PM, Finance | — | 2 |
| Delivery | `quantity_change_requests` | all (RLS) | — | 1 |
| Delivery | `daily_site_reports` | all (RLS) | — | 1 |
| Delivery | `material_requests` | all (RLS) | — | 1 |
| Delivery | `material_request_lines` | all (RLS) | — | 1 |
| Delivery | `meetings` | all (RLS) | — | 1 |
| Delivery | `project_stage_entries` (stage history) | Admin, Exec, PM | `sales_pipeline` | 2 |
| Safety | `safety_permits`, `safety_fitness_checks`, `safety_toolbox_talks`, `safety_days`, `site_checkpoints` | all (RLS) | `incidents` | 2 |
| Quality | `third_party_inspections`, `survey_records` | PM and above | — | 2 |
| Workforce | `crews`, `crew_members` | all (RLS) | — | 1 |
| Workforce | `attendance_days`, `headcount_days`, `absence_reports` | all (RLS: own, or supervisor scope) | — | 1 |
| Workforce | `leave_requests` | all (own; approvers see theirs) | — | 1 |
| Workforce | `manpower_needs` | PM, Exec, Admin | — | 2 |
| Workforce | `person_clearances` | Admin, PM | — | 2 |
| Equipment | `equipment_assets`, `equipment_usage_entries`, `equipment_status_days` | all (RLS) | — | 1 |
| Equipment | `equipment_plans` | PM, Admin | — | 2 |
| Stock | `stock_transfers`, `stock_reservations` | all (RLS) | `stock` | 1 |
| Stock | `client_requisitions` (owner-supplied material) | PM, Engineer (RLS) | — | 2 |
| Commercial | `sales_invoices` **$** | Admin, Exec, PM, Finance | `sales_invoices` | 1 |
| Commercial | `incoming_payments` **$** | Admin, Exec, PM, Finance | `revenue` | 1 |
| Commercial | `progress_claims`, `tm_claims` **$** | Admin, Exec, PM, Finance | `sales_invoices` | 1 |
| Commercial | `claim_retention`, `retention_releases` **$** | Admin, Exec, PM, Finance | `sales_invoices` | 2 |
| Commercial | `work_order_billing_steps`, `claim_billing_stages` | PM, Finance, Exec, Admin | — | 1 |
| Commercial | `subcontract_certificates`, `po_variations` **$** | Admin, Exec, PM, Finance | `procurement` | 2 |
| Expenses | `expense_claims`, `expense_claim_lines` **$** | own claims: all; others: approvers (RLS) | — | 1 |
| Expenses | `imprest_floats`, `imprest_plans` **$** | Admin, Exec, PM, Finance | `imprest` | 2 |
| Finance | `journal_entries` **$** | Admin, Exec, Finance | — | 2 |
| Finance | `vendor_withholding_slip_bills` **$** | Admin, Exec, Finance | `procurement` | 2 |
| Finance | `budget_versions` **$** | Admin, Exec, PM, Finance | — | 1 |
| Finance | `fx_rates` | all | `multi_currency` | 2 |
| Admin | `approval_chain_steps`, `spend_approvers` (who approves what) | all | — | 1 |
| Admin | `organizations` (name, base currency, fiscal start only) | all | — | 2 |
| Admin | `document_categories`, `cost_disciplines` | all | — | 2 |

Deliberately **not** catalog entities (reason code `skip`): the ERP mirrors and sync tables, agent and e-mail
settings, `*_erp_mirror`, outbox and watermark tables, per-organisation settings tables, personal directory
and rate tables, and file tables (the assistant reads metadata through the parent record only).

## 8. Actions in scope (`act`)

Rule: an action is a **draft** (create or update one of my own drafts) or a **submit** (hand my own record to
its approver through the RPC the Submit button calls, fixed to the `Submitted` target). Approvers, money and
closed transitions are out. Every target below exists on dev (read from `pmo-portal/src/lib/db/*`); S4 re-reads
each function's latest definition in `pg_proc` for argument names and role gate before the entry ships.

**Everyone (the database decides who may)**

| Action | Job | Target (exists on dev) |
|---|---|---|
| `update_task_status` | ENG-11 | `tasks` update (migrated from today's tool) |
| `create_task` | ENG-11, PM-9 | `tasks` insert via the app's insert (projects not mastered in an external task tool; otherwise refused with a pointer to the app) |
| `save_timesheet_week` | ENG-1 | RPC `save_timesheet_week` |
| `submit_timesheet` | ENG-1, ENG-2 | RPC `transition_timesheet`, fixed `p_to = Submitted` |
| `submit_leave_request` | CF-HR-8 | RPC `leave_request_submit` |
| `report_absence` | CF-FC-2 | RPC `report_absence` |

**Site: site engineer, site supervisor, foreman, storekeeper, material coordinator (base role Engineer)**

| Action | Job | Target |
|---|---|---|
| `save_material_request_draft` | ENG-6, CF-FC-4 | RPC `mrq_save_draft` |
| `submit_material_request` | ENG-6, CF-FC-4 | RPC `mrq_submit` |
| `save_site_report_draft` | CF-FC-1 | RPC `dsr_save_draft` |
| `submit_site_report` | CF-FC-1 | RPC `dsr_submit` |
| `create_incident` | ENG-9, CF-FC-3 | `incident_reports` insert (the app's create) |
| `save_equipment_usage` | ENG-10, CF-FC-5 | RPC `save_equipment_usage` |
| `submit_equipment_usage` | ENG-10 | RPC `transition_equipment_usage`, fixed `p_to = Submitted` |
| `save_stock_draft` | ENG-7, STO-1..4 | RPC `save_stock_draft` for an existing draft, and `create_stock_document` for a new one with fixed `p_post = false`; **never `post_stock_document`** |
| `raise_quantity_change` | quantity changes | RPC `qcr_raise` (creates the draft) |
| `submit_quantity_change` | quantity changes | RPC `qcr_submit` |
| `create_expense_claim_draft` | ENG-8 | `expense_claims` and `expense_claim_lines` inserts (receipt photo is added in the app; the assistant says so) |
| `submit_expense_claim` | ENG-8 | RPC `transition_expense_claim`, fixed `p_to = Submitted` |

**Project manager and office**

| Action | Job | Target |
|---|---|---|
| `create_meeting` | PM-10 | `meetings` insert |
| `create_phase` | PM-9 | `project_milestones` insert |
| `create_purchase_request_draft` | PM-4, ENG-3 | RPC `create_procurement_with_items`, in the state the app creates it |
| `log_crm_activity` | PM-11 | `crm_activities` insert (migrated from `create_activity`) |
| `remind_overdue` | PM-2 | existing action, unchanged behaviour (migrated) |
| `create_automation` | — | existing action, unchanged behaviour (migrated; stays behind the automations kill switch) |

**Finance**

| Action | Job | Target |
|---|---|---|
| `draft_invoice` | AR-1 | existing action with its prepare step, unchanged behaviour (migrated); saves a Draft only, a different user submits |

**Count: 25** (20 new, 5 migrated). No role-specific action is exclusive: the catalog's role hint says who is
offered the action, and the RPC decides who may run it.

**Held for an owner ruling (not built; each is one fragment away).** `submit_purchase_request` (RPC
`transition_procurement`; procurement transitions sit on the money path — `docs/money-path-primer.md`),
`save_journal_draft` and `submit_journal` (accounting entries), `request_imprest_replenishment` (a cash request),
`send_client_requisition` (`csr_send`: it sends outward to the client), billing claim drafts
(`create_progress_claim`, `assemble_tm_claim`), `resubmit_budget_version` (budget change), `record_project_progress`
(moves what can be billed), RFQ and quotation records.

**Out by rule (FR-ACG-005/037):** every approve, reject, return and decide call; `post_stock_document`;
payments and receipts; project and work-order transitions; budget activation and contract value; deletes and
archives; users, roles and `set_*` settings; ERP, ClickUp and Microsoft 365 actions; clock-in
(`phone_check_in` needs the phone's position); file and photo upload.

## 9. Acceptance criteria

Layers follow ADR-0010: **U** = unit (Deno edge test importing the shipped handler, or Vitest), **P** = pgTAP,
**E** = Playwright curated journey (the edge function is not served in CI, so the model frames are scripted as in
`e2e/JOB-A10-assistant-answers.spec.ts`; the model's own choices are held to the local eval, ADR-0052).
Each AC has exactly one owning layer.

### Generation and catalog

- **AC-ACG-001 (U)** *Given* the local database and fragments, *when* the generator runs twice, *then* the two outputs are byte-identical. (FR-002, NFR-007)
- **AC-ACG-002 (U)** *Given* a table the DAL reads and the signed-in role may SELECT with no fragment, *when* the check runs, *then* it exits non-zero naming the table and the fragment line to add. *Mutation:* removing the check makes this red. (FR-003)
- **AC-ACG-003 (U)** *Given* a fragment action naming a missing function, a changed argument name, or a function the signed-in role cannot execute, *then* the check fails with the reason. (FR-004)
- **AC-ACG-004 (U)** *Given* fragments whose action targets are `approve_*`, `post_stock_document`, `delete_*`, `transition_project`, `set_project_contract_value`, a `transition_*` target with a fixed status other than `Submitted`, or a name in the `scripts/pmo.mjs` admin sets, *then* the generator refuses each with a distinct message. (FR-005, FR-037)
- **AC-ACG-005 (U)** *Given* an entity or action without an English or Indonesian description, or over 160 characters, *then* generation fails. (FR-006)
- **AC-ACG-006 (U)** *Given* a column named `org_id`, an import column, a storage path or link, an idempotency key, an e-mail, a phone or a token, *when* an entity is generated, *then* it is absent from the entity's columns. (FR-007)
- **AC-ACG-007 (P)** *Given* every generated entity, *when* the column list is compared with `information_schema.column_privileges` for the signed-in role, *then* no catalog column is outside the role's SELECT grant, and no catalog column is `org_id`. (FR-002, FR-007)
- **AC-ACG-008 (U)** *Given* a plan with `stock` off, *when* the catalog is filtered, *then* `stock_*` entities, stock actions and their `find` results are absent, and a plan with the key on returns them. (FR-012, FR-060)
- **AC-ACG-009 (U)** *Given* a new fragment adding an entity with a plan key, *when* nothing else changes, *then* `find` returns it, `read` accepts it, and the prompt builder output is unchanged in size. (FR-001, FR-010, NFR-001)

### `find`

- **AC-ACG-010 (U)** *Given* the query "material request", *then* the first result is the `material_requests` entity or the `save_material_request_draft` action, results are at most 5 by default and 8 at most, and the reply is at most 3,600 characters. (FR-011, NFR-002)
- **AC-ACG-011 (U)** *Given* a Bahasa query "permintaan material" and language `id`, *then* the Indonesian description ranks first and is the one returned. (FR-011, FR-054)
- **AC-ACG-012 (U)** *Given* a query matching only hidden entries (role or plan), *then* `find` returns an empty list and says nothing matched, and the reply contains no hidden key. (FR-012, FR-014)
- **AC-ACG-013 (U)** *Given* an action result, *then* it lists every argument with type, required flag and allowed values, and states that it needs confirmation. (FR-013)

### `read` and roles

- **AC-ACG-014 (U)** *Given* the golden snapshot of today's `query_entity` for every current entity and each of the five roles (entity key, table or view, allowed columns, numeric and groupable columns, required filter, internal filters, money-read refusal), *when* the catalog is resolved the same way, *then* every snapshot cell is equal. The snapshot is committed before any change. (FR-007, FR-061, FR-062)
- **AC-ACG-015 (U)** *Given* the shipped handler driven with a signed JWT, a price-hidden requester and the mocked wire (the `hidePrices.requester.test.ts` pattern), *when* the model calls `read` on the purchase entity for the price column, *then* the request goes to the masked view, never the raw table, and the price comes back withheld. (FR-063)
- **AC-ACG-016 (U)** *Given* each money entity (current and §7 **$**) and a role outside Admin, Executive, Project Manager and Finance, *when* `read` is called, *then* the reply is `NOT_AVAILABLE_FOR_ROLE` and no database call is made; for a role inside the set the call proceeds. (FR-061)
- **AC-ACG-017 (P)** *Given* the money entities and a user of each base role, *when* the table the catalog names is selected under that user's own session, *then* the rows and columns returned match the role's rights in the app (the 0350 rule), and a second organisation's rows are never returned. (FR-023, FR-061, NFR-006)
- **AC-ACG-018 (U)** *Given* `read` with an unknown entity, *then* the reply carries up to three visible suggestions and no rows. (FR-021)
- **AC-ACG-019 (U)** *Given* the `read` limits, *then* a list is capped at 50, an aggregate pages to 5,000 rows and 200 groups, a fourth filter is refused, and a 5 s stall returns the timeout error — the existing `query_entity` tests re-pointed at `read` pass unchanged. (FR-020)
- **AC-ACG-020 (U)** *Given* the recipe entities, *when* `read` is called as a role that may not see unit cost, *then* the stock reply omits cost and the overdue reply omits invoices exactly as today. (FR-024)

### `act`

- **AC-ACG-021 (U)** *Given* `act` with a valid visible action, *then* the handler emits a proposal (confirm card) with the server-composed summary and writes nothing until approval. (FR-030, FR-032)
- **AC-ACG-022 (U)** *Given* arguments with an extra key, a wrong type, a value outside an allowed list or a missing required field, *then* `act` returns the problems and proposes nothing. (FR-031)
- **AC-ACG-023 (U)** *Given* an approved proposal, *when* the model's arguments include a fixed argument's name (for example the target status) with another value, *then* the fixed value is what the database call receives. *Mutation:* applying the model's value last turns this red. (FR-034)
- **AC-ACG-024 (U)** *Given* an approved `submit_*` action, *then* the call goes to the catalog's target only, with only declared argument names; a model-supplied table or RPC name in the arguments is rejected at validation. (FR-034, NFR-006)
- **AC-ACG-025 (U)** *Given* an approval after the user's role changed or the plan key turned off or could not be resolved, *then* nothing is written and the reply is the typed refusal. (FR-033)
- **AC-ACG-026 (U)** *Given* the same approval replayed, *then* the validated-argument journal returns the first result and the database receives one call. (FR-035)
- **AC-ACG-027 (U)** *Given* a database refusal (separation of duties, plan limit, wrong status), *then* the reply carries the database's message and the assistant's final text does not claim success. (FR-036, FR-038)
- **AC-ACG-028 (U)** *Given the full list of action names in the generated catalog*, *then* none matches the closed patterns and the count equals §8's 25. (FR-037)
- **AC-ACG-029 (P)** *Given each action in §8 and a user of each role the catalog offers it to, *when* the target RPC is called under that user's session with the arguments the catalog builds from a fixture, *then* it succeeds for the roles the app lets do it and is refused for the others; no action succeeds for a user the app would stop. One test file per area. (FR-038, role-job at the seam)
- **AC-ACG-030 (U)** *Given* every action's argument-builder and a fixture, *then* the produced RPC payload equals the golden payload recorded from the app's own call (the DAL wrapper's arguments). (FR-034)

### Guide, language

- **AC-ACG-031 (U)** *Given* the pages in `docs/user-guide`, *when* the index is built, *then* each non-README page yields chunks per section and language with title, path and role hint, and regenerating after a page edit changes only that page's chunks; CI fails when the committed index differs. (FR-050, FR-052)
- **AC-ACG-032 (U)** *Given* "how do I request materials" in English and in Bahasa, *then* `find` returns the request-materials page's steps in the respective language, with the title and path. (FR-053, FR-054)
- **AC-ACG-033 (U)** *Given* a request whose language is missing or invalid, *then* the server treats it as English; given `id`, *then* the prompt tells the model to answer in Bahasa. (FR-054)
- **AC-ACG-034 (U)** *Given* a page with no Bahasa section, *then* `find` returns the English page and says so. (FR-055)
- **AC-ACG-035 (U)** *Given the built prompt, then it contains no help text, no `HELP_CORPUS` and no glossary block, and `helpCorpus.ts` and its test do not exist. (FR-056)

### Prompt, tools, budget

- **AC-ACG-036 (U)** *Given* every gate on and a Finance user, *then* the tool set is `find`, `read`, `act`, `ask_user`, `compose_view` (+ `notify` while automations are on), and the sum of tool-definition and prompt characters is at most 12,000. (FR-001, NFR-001)
- **AC-ACG-037 (U)** *Given* adding 100 fixture entities to a test catalog, *then* the prompt and tool definitions are byte-identical. (NFR-001)
- **AC-ACG-038 (U)** *Given* `legacy`, `both` and `new`, *then* the registered tool names are the old set, old + new, and new only; switching needs no code change. (FR-080)

### Panel

- **AC-ACG-039 (E)** *Given* the empty panel, *when* the user clicks a suggested question, *then* it is sent at once and appears as the user's message, the suggestions are hairline rows (not bordered boxes), and the text "Answers are read-only for now." is nowhere on the panel. (FR-071, FR-072)
- **AC-ACG-040 (E)** *Given* a scripted proposal for `submit_material_request`, *when* an Engineer-role user approves, *then* the Approval Card shows pending → approving → approved, focus is back in the composer, and the result link opens the request; *when* the user denies, *then* the card shows denied and nothing is written. (FR-076, FR-082)
- **AC-ACG-041 (U)** *Given* an OpenUI answer containing a Records Table and a Context Card, *then* they render from the registry; an unknown component or raw markup renders as text and no script runs. (FR-080)
- **AC-ACG-042 (U)** *Given* a thread with five table widgets, *when* a new answer streams, *then* only the streaming item re-renders per frame and earlier widgets do not re-validate (React Profiler assertion). (FR-082)
- **AC-ACG-043 (U)** *Given* the panel in Bahasa, *then* every state in §5.7.1 (empty, composer, loading, thinking, tool chips, answer row, approval, ask_user, error, refused) is in Bahasa; the all-states test (#2430) is extended. (FR-083, FR-084)
- **AC-ACG-044 (E)** *Given* a scripted "refused" frame (the database said no), *then* the card shows the refusal in plain words and no success state. (FR-036, FR-076)
- **AC-ACG-045 (E)** *Given* scripted status and tool frames for a run, *when* the run is working, *then* before the answer arrives the panel shows the Loading State with elapsed seconds, a collapsed-then-expandable Thinking trace listing the steps, and Tool Chips rows for each call under an "N tool calls" header; "working" is announced once. (FR-074, FR-082)
- **AC-ACG-046 (U)** *Given* an answer frame with a `sources` list, *then* the panel shows source chips and an "N sources" expander listing each; copy puts the answer text on the clipboard; retry re-sends the previous user message; thumbs up and down call the existing feedback path. (FR-075, FR-085)
- **AC-ACG-047 (U)** *Given* the composer, *then* the send control is an icon button named "Send", disabled while the field is empty, replaced by Stop while a run is in flight, no visible "Send" text exists, and focus stays in the field after sending. (FR-073)
- **AC-ACG-048 (U)** *Given* an `ask_user` event with three options and two more questions, *then* the Approval Card form shows the options with radio marks, a free-text row and a "1/3" stepper; Continue is disabled until an option or text is given; Skip advances. (FR-077)
- **AC-ACG-049 (U)** *Given* a failed run, *then* the error is a compact card inside that turn with the plain reason and a retry action, no element spans the panel's full width as a red banner, and retry resends the failed message. (FR-078)

**Rendered acceptance (not a test):** **RA-1** Each panel state against the demo, same states (empty, typing, thinking, tools running, streaming, answered with sources, error, approval, ask_user, refused, long thread, phone width), side by side and judged by the Director at actual size, one review and one fix round (screen-owner runbook); `scripts/ux-proof.sh` clean on the touched routes. FR-ACG-070.

### Rollout gate (local eval, ADR-0052 — gates the cutover, not the merge)

- **RG-1** On the same dev head and model, the nine cases of the 10-run baseline, re-pointed at the new tools through the scorer that maps `read` + entity to the old tool, score **at least 86/90 with every completed turn on the correct tool**, and no case below its baseline pass rate.
- **RG-2** New cases pass at the same bar (≥ 9 of 10 internal runs per case, as the existing 10-run cases): find → read (work orders over plan; material requests waiting), find → act (material request draft; expense claim submit; each proposal checked with `proposesAction`), how-do-I from the guide in English and in Bahasa, role-restricted ask as a non-money role, plan-off entity.
- **RG-3** Median tokens and cost per completed run, and p50 first-word time, meet NFR-ACG-001/004/005 against the S0 baseline.
- **RG-4** Injection and plan-switch cases (`injection.eval.ts`, `plans-switch-off.eval.ts`) still pass.

If a re-pointed recipe case misses RG-1, that one old tool stays registered for one more release and nothing
else waits.

### Traceability (requirement → owning acceptance criterion; tasks are in the plan §4)

| Requirement | Acceptance criteria (owning layer) |
|---|---|
| FR-ACG-001, 009, 010 | AC-001 (U), AC-009 (U), AC-036 (U) |
| FR-ACG-002, 003, 004 | AC-001 (U), AC-002 (U), AC-003 (U), AC-007 (P) |
| FR-ACG-005, 037 | AC-004 (U), AC-028 (U) |
| FR-ACG-006, 007, 008 | AC-005 (U), AC-006 (U), AC-007 (P), AC-014 (U) |
| FR-ACG-011..015 | AC-010 (U), AC-011 (U), AC-012 (U), AC-013 (U) |
| FR-ACG-020..025 | AC-018 (U), AC-019 (U), AC-020 (U) |
| FR-ACG-030..036, 038 | AC-021..AC-027 (U), AC-029 (P), AC-030 (U) |
| FR-ACG-050..056 | AC-031..AC-035 (U) |
| FR-ACG-060 | AC-008 (U) |
| FR-ACG-061, 062, 063 | AC-014 (U), AC-015 (U), AC-016 (U), AC-017 (P) |
| FR-ACG-070..085 | AC-039 (E), AC-040 (E), AC-041 (U), AC-042 (U), AC-043 (U), AC-044 (E), AC-045 (E), AC-046 (U), AC-047 (U), AC-048 (U), AC-049 (U), RA-1 (rendered, Director) |
| FR-ACG-080, 081 | AC-038 (U), RG-1..RG-4 (local eval) |
| NFR-ACG-001, 002 | AC-036 (U), AC-037 (U), AC-010 (U) |
| NFR-ACG-003, 004, 005 | RG-2, RG-3 (local eval) and the S2 cold-start measure |
| NFR-ACG-006 | AC-017 (P), AC-023 (U), AC-024 (U), AC-029 (P) |
| NFR-ACG-007 | AC-001 (U), AC-031 (U) |
| NFR-ACG-009 | AC-040 (E), AC-043 (U), AC-045 (E) |
| NFR-ACG-008, 010 | review checklist (no test: public-repo and no-migration are reviewed in each PR) |

## 10. Phase 2 — MCP server (after 15 Dec if time is short)

A remote MCP server over the same catalog exposing `find`, `read` and `act`, in the shape of Cloudflare's
search/execute server (without code execution). Sign-in is DD-API-2 (Supabase OAuth 2.1, the caller's own token),
so every call runs under the caller's session. Preconditions are owner-gated infrastructure (enabling the OAuth
server on the hosted project) and a review of the act allow-list against DD-API-3's open set for outside callers.
Requirements, ACs and slice are in the plan's phase 2; nothing in phase 1 blocks it, because the catalog and the
runners are transport-free modules.

## 11. Decided (Director, 2026-11-28) and open points

### Decided

- **D-1 Panel baseline (was OP-1).** The rendered panel on dev does not match beautifului.dev, so the **whole panel** is re-matched to the demo (layout, spacing, motion, every state) in PMO tokens, plus Approval Card, Context Cards, Records Table and OpenUI. Acceptance adds the side-by-side rendered comparison RA-1 judged by the Director at actual size and a clean `scripts/ux-proof.sh`. The per-component list is §5.7.1, written from the rendered demo. Assumed within this ruling and open to veto at RA-1: the Prompt Bar's `@` sources, `/` commands, model picker and dictation are not built (no backing feature); the Approval Card shell serves both `ask_user` and the `act` confirm; follow-ups come from the OpenUI answer block; the demo's variant switches are not built.
- **D-2 Token numbers (was OP-2).** Accepted as written: characters ÷ 4 until S0 replaces them with the provider's `prompt_tokens`.
- **D-3 Roles and money columns (was OP-3).** Accepted as written: the §7 role cells are preflight until S1 confirms them against `role_table_grants` and `pg_policies` at head.
- **D-4 Guide coverage (was OP-4).** Accepted as written: `find` is only as good as the pages; the how-do-I eval cases name the pages they need; the index is rebuilt after the docs-site merge; page links use titles and paths until the public base URL is fixed.
- **D-5 `update_task_status` (was OP-5).** Keeps its current no-chip rule (ADR-0051 materiality parity). Every other `act` action stops at the confirm card.
- **D-6 Role-job test (was OP-7).** The on-screen job-role rule is met at three seams (scripted-frame journey as the job role, pgTAP as the job role on the target RPC, local eval as the job role through the real loop), **plus** a Director walk: before the cutover the Director walks each job role's assistant jobs on a served local bed (edge function served) and records it (plan task T8.4a).
- **D-7 Clock-in (was OP-8).** Stays out: the RPC needs the device position.
- **D-8 External task tool (was OP-9).** `create_task` on a project whose tasks live in an external tool is refused in the first release with a pointer to the app.
- **D-9 Deployed-model fallback (was OP-10).** If RG-1/RG-2 miss on the deployed model, name more common keys in the one-line list first, before considering a different model (OD-REEL-1 allows it on eval evidence).

### Open points

- **OP-6 Held actions (§8).** The eight held items — `submit_purchase_request`, `save_journal_draft` and `submit_journal`, `request_imprest_replenishment`, `send_client_requisition`, billing claim drafts, `resubmit_budget_version`, `record_project_progress`, RFQ and quotation records — need an owner ruling each. The Director has asked the owner; each is one fragment away.
