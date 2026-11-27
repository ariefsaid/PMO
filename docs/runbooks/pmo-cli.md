# PMO agent operator runbook

> **Audience:** an agent operating PMO for the owner. Read this page before preparing client data.
> The commands use the signed-in user's permissions. They do not bypass PMO role checks.

## Read this first

### What the CLI can and cannot do

`node scripts/pmo.mjs --help` is the command reference. The CLI supports bounded reads, selected record writes, a starting-data loader, previewed corrections of loaded records, stage-date correction, recording a bid's win, loss or decline, ERP checks, purchase-document linking, document-reference linking, document register entries and uploads, goods-receipt recording, account maps, cost-attribution rules, T&M rate cards, assignments, claim assembly and sign-off preparation, and adding an organisation as the platform Operator (`org add`). It is not a general database console: there is no delete command, no arbitrary RPC, and some writes remain app-only, including every change to an existing organisation. Do not invent flags or call database tables directly.

Use Node 22 or newer. Sign in with `node scripts/pmo.mjs login`, then confirm the identity and role with `node scripts/pmo.mjs whoami`. The CLI stores an ordinary owner session and applies the same row-level permissions as the app. Use a real, active Admin account for loading client data and other Admin-only commands.

`pmo load`, `pmo correct`, `pmo stages`, `pmo stage-date`, `pmo bid`, `pmo accounts map set`, and ERP setup checks require an active Admin. Purchase reads/links and `pmo purchases receive` (a procurement money write) are for active Admin, Executive, Project Manager, or Finance members; the `--include-set-aside` read and setting documents aside are Admin/Finance only. Attribution preview/set/end are Admin/Finance; `pmo attribution list` also serves Executive and Project Manager. T&M reads are for Admin, Finance, Executive, or the project's Project Manager. T&M writes (rates, assignments, claims, sign-off preparation) are for an active Admin or Finance member; a Project Manager uses the app for the same steps. Other writes remain subject to the signed-in member's normal app permissions.

### Data ownership when an ERP is connected

PMO is the app and canonical workflow. When ERPNext or Odoo is connected, the ERP owns its native accounting ledger, procurement chain, party master, sales money documents, and timesheet records; PMO reads synchronized data and sends supported writes through the adapter. Projects, milestones, tasks, CRM and the documents register remain PMO-owned. Budgets combine ERP objects with PMO versions. PMO provides the weekly timesheet entry and approval surface. For a live standalone organization that connects an ERP later, the ADR-0055 §5A Posture B crossing keeps PMO entry/approval as the source of truth and side-mirrors the approved result.

For a new **Client** company when an ERP owns companies, use `pmo load` with the company in its `companies` list. The loader creates the ERP-owned Client through the same synchronous adapter command as the app and uses the returned PMO company id for the project in that load; do not create a duplicate in the ERP and wait for the hourly sweep. If a command refuses or reports an ambiguous/archived party, resolve it in **Companies**; **Companies → New** remains the immediate app fallback for an approved Client creation. A new **supplier** (Vendor) is created the same way: see recipe 2a. Other party types stay in their supported ERP/app flow.

> **Updated after merge:** the fix from `fix/cli-create-erp-owned-company` is on `dev`; a missing ERP-owned Client can now be created synchronously by `pmo load`. Revisit this note if that loader behavior changes.

For a project that names a new Client, include the company in the load file's `companies` list so the loader can create it before creating the project. Never create a second copy to resolve a matching error.

### Timing: what is immediate and what waits

- App writes to ERP-owned domains are synchronous: PMO waits for the ERP response and returns the result. The app-created Client company is available immediately.
- CLI writes such as `pmo load`, purchase links, and budget/account-map operations make their supported calls in the current command. A successful command reports the applied/skipped rows; no hourly refresh is needed for those writes.
- Changes made directly in ERPNext or Odoo arrive in PMO through webhooks and reconciliation. ERPNext reconciliation may take up to an hour outside its initial collection window. Avoid waiting when the operation is a PMO-supported synchronous command or app action. If an external edit has not appeared, use **Administration → Integrations** and the relevant read checks below before retrying anything.

### Safety and reruns

1. Confirm the target organization, signed-in user, and role with `node scripts/pmo.mjs whoami` before any write.
2. Run the command's `--dry-run` first, inspect every planned action/refusal, and only then rerun without `--dry-run`. Do not assume every command has a dry-run flag. For a write that has no preview mode (for example `stage-date` or the organization-creation RPC), stop before writing unless the owner has approved the exact target and values; inspect its current state first.
3. Never run a command against production, create a production organization, or change hosted setup without the owner's explicit go for that instance. A local dry-run does not authorize a hosted write.
4. `pmo load` is idempotent for the same source after a completed write: re-running resumes, skips already-loaded rows, and reports conflicts instead of overwriting. If a write's result is unknown because the connection failed, inspect PMO and ERP first. Correct a wrong loaded value with `pmo correct` (recipe 11) or in the app. Do not edit a source row in the hope that an existing project, contract line, or budget line will be overwritten.
5. Keep source files outside the repository and do not include client names, personal details, access tokens, credentials, or live ERP links in public issues or tracked documentation.

Roles below mean an active organization member with that role. Admin-only commands are stated explicitly. Other commands still enforce the signed-in user's own RLS permissions; a CLI success does not grant app permissions.

### When a command refuses

Read the complete JSON error on stderr and its `details`; exit `2` means the CLI stopped before sending a request, exit `1` means the server refused or a remote operation failed.

| Refusal or result | Next action |
|---|---|
| `Not signed in` / session could not be refreshed | Run `node scripts/pmo.mjs login`, complete sign-in as the intended user, then rerun `whoami`. |
| Login asks for a registered client id or consent is unavailable | Ask the owner to complete the approved CLI setup; do not use a service key or copy credentials into a file or issue. If the public client id was provided through the approved setup, `node scripts/pmo.mjs login --client-id <registered-client-id>` is supported. |
| `pmo … is for an active Admin` | Sign in as the active Admin for the target organization. Do not work around the role check. |
| `… is read-only from the CLI` / `only pmo load writes it` | Use the app screen named in the recipe and file the enhancement issue linked there. |
| `contract_value cannot be set`, project status cannot change, or `archived_at cannot be set` | Use the project or record workflow in the app; these fields are deliberately not generic CLI writes. |
| ERP-owned company creation is refused or the command loses its connection during the write | Inspect **Companies** and the ERP party list before retrying; the request may have completed. If the party is absent, correct the cause and use the app's **Companies → New** flow for an approved Client. Never create a duplicate directly in ERPNext. |
| Company is ambiguous or archived | Resolve the duplicate or restore the company in **Companies**; rerun the same load after checking the dry-run. |
| Project / contract-line / budget conflict, or `short_name_conflict` | Compare the source with the existing record. Correct it with `pmo correct` (recipe 11) or in the app, or choose a unique alias; rerun the unchanged source first to confirm the skip/conflict. |
| `42501`, row-level-security refusal, or `Not allowed` | Check the active role, organization context, and whether the operation is app-only. Use the named app workflow; do not retry with broader credentials. |
| `budget activation from the CLI is not enabled yet — activate in the app` | Open **Project → Budget**, review the draft and activate there. |
| `No '<stage>' stage entry was found` | Run `pmo stages <project-uuid>` and use the exact stage label from its output. |
| Purchase/document report has `refused` rows or a failed row | Do not repeat the entire batch blindly. Inspect each row result and existing link, correct only the refused source rows, dry-run the corrected file, then rerun. |
| `No row was updated` | Check the UUID/filter and current record in the app. The command did not confirm a changed row. |
| Unknown command, option, table, or RPC | Run `node scripts/pmo.mjs --help`; use only the listed surface. |

## One-time setup and sign-in

### OAuth client

The CLI signs in through Supabase Auth's OAuth 2.1 server (authorization code + PKCE) as a pre-registered public client with loopback redirects, and holds an ordinary user session — row-level security treats every CLI call exactly like the same user in the browser. It never uses a service key. `login` needs that registered client id, passed as `--client-id <registered-client-id>` (or the `PMO_CLIENT_ID` environment variable).

On a fresh **local stack**, the client is registered once with `scripts/register-oauth-client.mjs`. It is idempotent — an existing `PMO CLI` client is reported, not duplicated — and a public client id is not a secret. On a **hosted project**, enabling the OAuth server and registering the client there is an owner-gated infrastructure change (DD-API-2 in `docs/decisions.md`): ask the owner, and never register a hosted client or change hosted auth setup without that explicit go.

### Environment variables

The CLI reads these names (the owner or the login flow supplies the values):

| Variable | Feeds |
|---|---|
| `PMO_SUPABASE_URL` | the Supabase project URL (`--url`) |
| `PMO_SUPABASE_KEY` | the project's publishable key (`--key`); secret keys are refused and never saved |
| `PMO_CLIENT_ID` | the registered OAuth client id (`--client-id`) |
| `PMO_CONFIG_DIR` | the directory that holds the stored credentials |

### Sign in and out

```bash
node scripts/pmo.mjs login --client-id <registered-client-id>   # prints a sign-in URL and opens the browser
node scripts/pmo.mjs whoami                                     # confirm identity, role, and organization before any write
node scripts/pmo.mjs logout                                     # ends THIS session only; browser sessions stay signed in
```

The browser shows PMO's consent screen — the client's name and the signed-in account — and you choose **Allow**. If the browser is signed out it sends you through a **password** sign-in and back; Microsoft and magic-link sign-ins lose the consent request, so sign in to PMO in the browser first, then run `login`. `login` times out after 5 minutes (`--timeout <seconds>`); `--no-browser` only prints the URL.

Tokens are stored owner-only under the config directory, keyed by Supabase URL. An expired access token is refreshed automatically; if a refresh is refused (signed out elsewhere, account disabled), the CLI says so — run `login` again. `logout` revokes the stored refresh token at once; if the server does not confirm the revoke, the credentials are kept and the command fails — run it again.

## Recipes

All write files below are illustrative JSON shapes. Replace placeholders in a private working file with approved source data. First run the listed dry-run. If a command has no dry-run option, the recipe says how to inspect it and the write remains subject to the safety rule above.

### 1. Seed a new client organization

**Goal:** create an organization, its operating currency, assigned plan, and its first Admin together in the shared project.

**Exact commands:** use `pmo org add`. Run without `--confirm` first to preview the planned steps (dry run), then re-run with `--confirm`.

**Who:** `pmo org add` works with a command-line sign-in as the platform Operator and no other. It only adds: a command-line sign-in cannot change an existing organisation's plan, features or state, and suspending or closing an organisation is app-only.

```bash
# Preview the numbered actions (dry run — zero writes):
node scripts/pmo.mjs org add \
  --name "<organization display name>" \
  --admin-email "<admin@example.test>" \
  --admin-name "<Admin display name>" \
  --currency IDR \
  --locale id-ID \
  --timezone Asia/Jakarta \
  --plan <plan-id> \
  [--number-locale <locale>] \
  [--feature <key>=on|off ...] \
  [--state live|demo|test]

# Execute with confirmation:
node scripts/pmo.mjs org add \
  --name "<organization display name>" \
  --admin-email "<admin@example.test>" \
  --admin-name "<Admin display name>" \
  --currency IDR \
  --locale id-ID \
  --timezone Asia/Jakarta \
  --plan <plan-id> \
  --confirm
```

**Flags:**
- Required: `--name`, `--admin-email`, `--admin-name`, `--currency` (ISO-4217, e.g. IDR, USD), `--locale`, `--timezone`, `--plan`. Missing any required flag produces a usage error naming it.
- Optional: `--number-locale`, repeatable `--feature <key>=on|off`, `--state live|demo|test` (default `live`).
- Safety: `--confirm`. Without this flag, the command prints the planned numbered sequence with given values, makes zero writing requests, and prints `Dry run. Add --confirm to run.`

**Workflow when confirmed:**
1. Calls edge function `operator-org` (`action: "create"`) with the plan, features and state. The server invites the first Admin and creates the organization, its plan, its features and its starting state in one transaction: all of it, or nothing.
2. Reads status via `operator-org` (`action: "status"`). An existing organization is never changed from the command line: if its plan, a requested feature or its state differs from what was asked, the command stops and says so (change it in the app).
3. Classifies organization readiness (`organization`, `plan`, `admin`, `stage-config`). If unhealthy, reports failed checks and exits non-zero.
4. Prints the summary: organization id, plan, Admin active/pending counts, and state.

**How to verify:** the command prints the organization UUID, plan, Admin status, and lifecycle state. Verify via `node scripts/pmo.mjs whoami` after signing in as the invited Admin.

**Failure codes:**
- `OPERATOR_ONLY`: The caller is not an active platform Operator.
- `ORG_NAME_REQUIRED`: The `--name` flag value is missing.
- `BAD_ORG_NAME`: The `--name` contains a character that is not allowed (an asterisk).
- `BAD_EMAIL`: The `--admin-email` is malformed or uses wildcard characters.
- `ADMIN_NAME_REQUIRED`: The `--admin-name` flag value is missing.
- `CURRENCY_REQUIRED`: The `--currency` flag value is missing.
- `LOCALE_REQUIRED`: The `--locale` flag value is missing.
- `TIMEZONE_REQUIRED`: The `--timezone` flag value is missing.
- `PLAN_REQUIRED`: The `--plan` flag value is missing.
- `UNKNOWN_PLAN`: The specified plan identifier does not exist in the database.
- `ORG_NAME_TAKEN`: Another organization already has this name, and the given Admin is not its Admin. Names match ignoring letter case and spacing (any run of whitespace counts as one space; leading and trailing whitespace is ignored), and the database holds one organization per name (#2264).
- `ADMIN_HAS_PROFILE`: The specified email address already belongs to an existing organization profile.
- `ADMIN_ACCOUNT_EXISTS`: An auth account exists for this email with a profile or has signed in.
- `RATE_LIMITED`: The operator has exceeded the allowed rate of organization creation.
- `ORG_CREATE_FAILED`: Server-side organization creation (with its plan, features and state) failed; nothing was created.
- `BAD_FEATURES`: A `--feature` entry is malformed (each needs a key and on or off).
- `BAD_STATE`: `--state` is not `live`, `demo` or `test`.
- `INVITE_FAILED`, `LOOKUP_FAILED`: The invitation or a server-side lookup failed; nothing was created by the failed step, retry.
- `UNAUTHORIZED`, `MISCONFIGURED`, `BAD_REQUEST`, `BAD_ACTION`, `BAD_ORG_ID`, `METHOD_NOT_ALLOWED`: The sign-in is missing or the request is malformed or the server is not set up for this; check the sign-in and the flags.
- `org_differs`, `plan_conflict`, `live_org_terminal` (raised by the command itself): the organization already exists with a different plan, feature or state, or is live. The command never changes an existing organization; change it in the app.
- `unhealthy_org` (raised by the command itself): a readiness check failed; the failed checks are named.
- Function errors report the code (and step if present) in the JSON error on stderr and exit non-zero.

### 2. Add a new client company

**Goal:** add one Client party exactly once and have it available to project loading.

**Exact commands:** include the legal company name under `companies` in the private load file. The loader creates it as a Client when missing and, if ERP owns companies, sends the create through the synchronous ERP adapter. Prepare and preview the full load:

```bash
node scripts/pmo.mjs load <load-file.json> --dry-run
```

Review the plan. For a new ERP-owned Client, a planned company creation will complete in the current `pmo load` invocation; the project load then uses the canonical company id returned by the adapter. Apply only after the full plan is correct:

```bash
node scripts/pmo.mjs load <load-file.json>
```

Do not create that Client directly in ERPNext and wait for the hourly sync. If the command refuses because the company is ambiguous, archived, or another party type, resolve the case in **Companies** or use its **New company** action for the Client, then rerun the load dry-run. If the command ends without a clear result, inspect both Companies and the ERP before retrying.

**How to verify:** confirm the company appears once in **Companies**, then run the same load dry-run again. It should report the company as existing/skipped and the intended project actions without proposing a duplicate.

**Common errors:** if the load reports multiple matching companies, resolve the duplicate in **Companies**; if archived, restore it there before rerunning. If ERP creation is refused or the command ends without a clear result, inspect whether the company exists in **Companies** and the ERP before trying again. Use the app's **Companies → New** action only when the approved Client is absent on both sides; do not create a second party in ERPNext.

### 2a. Add a new supplier company

**Goal:** add one supplier (Vendor) party exactly once when the ERP owns companies, so a purchase, or journal-cost history such as recipe 6's journal capture, can name it.

**Exact commands:** a load file with only a `companies` list, each supplier entry carrying `"type": "Vendor"` (default is Client): `{"companies":[{"name":"<legal name>","type":"Vendor","short_name":"<optional>"}]}`. Preview, then apply the identical file:

```bash
node scripts/pmo.mjs load <suppliers.json> --dry-run
node scripts/pmo.mjs load <suppliers.json>
```

The dry run lists `company.create` and sends nothing. The apply uses the same synchronous ERP adapter command as **Companies → New**, as a supplier; no second path. A supplier entry matches only Vendor companies, so a Client with the same name does not block it. A supplier entry is never used as a project's client.

**How to verify:** the company appears once in **Companies** with type Vendor; re-run the dry run and it reports the company as skipped.

**Common errors:** `more than one company has this legal name` or `is archived — restore it in the app first`: nothing is written; resolve it in **Companies** (merge the duplicate or restore the archived supplier), then rerun.

### 3. Load projects with their stage dates

**Goal:** load projects at the correct stage, set contract details, and correct the recorded date of the latest matching stage.

**Exact commands:** prepare the private load file with `projects` entries. Required fields include `name`, `client` (the company's exact legal name), and `stage`. A won-stage project also needs `contract_value`, `tax_treatment`, `tax_amount`, `customer_contract_ref`, and `contract_date` (`YYYY-MM-DD`). An optional `currency` (three capitals, e.g. `USD`) sets a new project's currency; left out, the project takes the organization's. A project that already exists in another currency is reported as `project.currency_conflict` (both values shown) and never changed; the other fields still apply and the run exits 0, so read the report. Optional contract quantities use `contract_lines` with stable `key`, `item_code`, `description`, `unit`, `quantity`, and `rate`; `basis` may be `unit_rate` or `lump_sum`.

```bash
node scripts/pmo.mjs load <load-file.json> --dry-run
node scripts/pmo.mjs load <load-file.json>
node scripts/pmo.mjs get projects --select id,name,status,client_id --filter name=eq.<project-name>
node scripts/pmo.mjs stages <project-uuid>
```

`pmo load` walks the legal path from `Leads` to the requested stage and writes the contract value through the guarded app RPC. The pipeline order is `Leads` → `Quotation Submitted` → `PQ Submitted` → `Tender Submitted` → `Negotiation`; a won project goes `Leads` → `Quotation Submitted` → `Won, Pending KoM`, then on to `Ongoing Project`, `On Hold` or `Close Out`. A rerun of a project already part-way continues from its current stage. The load's transition dates are load/audit time, not historical pipeline dates. To correct one, inspect the history, then set the date of the most recent matching stage entry:

```bash
node scripts/pmo.mjs stages <project-uuid>
node scripts/pmo.mjs stage-date <project-uuid> "Quotation Submitted" <YYYY-MM-DD>
node scripts/pmo.mjs stages <project-uuid>
```

`stage-date` has no dry-run flag; verify the project and entry first. It selects the latest occurrence of the exact stage label. Older system-dated entries can move with a backdated stage; if the next earlier entry was person-dated and is now after the target date, correct that earlier stage first, then retry. This matches the shipped #1835 command behavior.

**How to verify:** the load output lists created/skipped/conflicting actions. Re-run `pmo stages` after any date change and check stage order and entered dates against the approved chronology.

**Common errors:** a project already moved away from the load file's stage is not moved backward by rerunning the load; use `stages` and the controlled date correction instead. A missing stage label must be copied from `stages` exactly. A win without its contract value, tax treatment/amount, client contract reference, or contract date fails preflight.

### 3a. Record a win, loss or decline on an existing bid

**Goal:** a bid that is already in PMO was won, lost or declined. Record it from the CLI with the same details the app's win and lost dialogs ask for.

**Exact commands:** find the project and check its stage and contract value first:

```bash
node scripts/pmo.mjs get projects --select id,name,status,contract_value --filter name=eq.<project-name>
```

Then preview the outcome. Without `--apply` the command reads the project, runs every check and prints what it would record; it writes nothing. Run the same command again with `--apply` to record it.

```bash
# Won: the client's order number, the date on the order, and the project's contract value
node scripts/pmo.mjs bid win <project-uuid> --ref <client order number> --date <YYYY-MM-DD> --value <contract value>
node scripts/pmo.mjs bid win <project-uuid> --ref <client order number> --date <YYYY-MM-DD> --value <contract value> --apply

# Lost or declined: a reason, and a note when the reason is other
node scripts/pmo.mjs bid lose <project-uuid> --reason <reason> [--note <text>] --apply
node scripts/pmo.mjs bid decline <project-uuid> --reason <reason> [--note <text>] --apply
```

Reasons: `price`, `competitor`, `scope_fit`, `timing`, `capacity`, `relationship`, `client_cancelled`, `no_decision`, `other`. A note is at most 500 characters.

`--value` is a check, not a change: it must equal the contract value already on the project. If the project has no contract value, set it first with `pmo load` or in the app, so its approval rule applies. The command is for an active Admin. It uses the same database step as the app, so the app's rules still apply, including which stages can move to won.

**How to verify:** the `--apply` output says `"applied": true` with the old and new stage. Read the project again with `get projects` and check `status`, `customer_contract_ref` and `contract_date` (or `lost_reason`). If ERPNext is connected, open the project page to link its ERP project; the CLI does not do that step.

**Common errors:** a missing order number, date or value, a date in the future, or a value that differs from the project's is refused before anything is sent. A project that is already won, lost or declined is refused; change it in the app. A refusal from the database (for example a stage that cannot move straight to won) is printed as it is and nothing changes.

### 4. Budgets and account maps

**Goal:** import a Draft budget, map each category to ERP expense accounts, and route activation to the app.

**Exact commands:** put budget lines in each project's `budget` array. Each line has `category`, `budgeted_amount` and optional `description`, `fiscal_year`, and `reference`. Supported categories are `Labor`, `Materials`, `Subcontractors`, `Equipment`, `Permits & Fees`, `Overheads`, `Contingency`, `Special expenses`, `Travel & accommodation`, and `Vehicle`.

```bash
node scripts/pmo.mjs load <budget-load.json> --dry-run
node scripts/pmo.mjs load <budget-load.json>
node scripts/pmo.mjs get budget_versions --select id,project_id,version,name,status --filter project_id=eq.<project-uuid>
node scripts/pmo.mjs get budget_line_items --select id,budget_version_id,category,description,budgeted_amount,fiscal_year --filter budget_version_id=eq.<draft-version-uuid>
node scripts/pmo.mjs accounts map set Labor '<push account>' '<count-only account>' --dry-run
node scripts/pmo.mjs accounts map set Labor '<push account>' '<count-only account>'
```

The first account is the push account. The dry-run checks that each named account is an enabled Expense ledger account, that the push account is eligible for direct-cost posting, and that it is not already mapped to another category. It leaves unmentioned existing map rows in place. `pmo budgets activate` is deliberately disabled in the CLI; review and activate from **Project → Budget**. The CLI also has `pmo budgets link <draft-version-uuid> --source <json|@file|->` for attaching a source file; its source object has `drive_id`, `item_id`, `web_url`, `name`, and `kind` (`file` or `folder`). That command has no dry-run, so for this runbook use **Project → Budget** to attach the source unless the owner has approved that exact action and source.

**How to verify:** inspect the load output and read back the Draft version and lines. For maps, inspect the dry-run's `actions`, `push_account`, and `left_in_place`, then verify the saved map with `pmo get budget_category_account_map --select category,erp_account --filter category=eq.Labor`. Confirm the expected Draft is Active in **Project → Budget** after an authorized app activation.

**Common errors:** fix invalid category/amount in the private file and dry-run again. If an identical budget line is skipped, do not change its amount in the file expecting an overwrite; correct it with `pmo correct budget-line` (recipe 11). If an account map refuses, use **Administration → Accounting setup → Budget account map** to inspect the chart and mappings. Never map a category before reviewing the Draft split: `Special expenses` may be classified into Travel & accommodation or Vehicle by the loader based on its description.

### 5. Cost attribution rules

**Goal:** route ERP ledger lines that carry no ERP project (payroll, overhead) to projects through a rule, and preview the attributed amounts before saving anything.

**Exact commands:** the file holds one rule or an array of them (shape below).

```bash
node scripts/pmo.mjs attribution preview <rules.json> --json
node scripts/pmo.mjs attribution set <rules.json> --dry-run
node scripts/pmo.mjs attribution set <rules.json>
node scripts/pmo.mjs attribution list
node scripts/pmo.mjs attribution end <rule-key> --to <YYYY-MM-DD> --version <n>
```

`preview` shows the amount per project, month, and category (`--json` for rows) and writes nothing. `set --dry-run` validates against the saved rules and saves nothing; apply only after reviewing its output. `set` saves each rule in order — a new rule, or a new version when the file names a `rule_key`. `list` shows the current rules; `--history` adds past versions. `end` saves a new version with that end date.

A rule matches exactly one account or account group (`account` or `account_group`), optionally narrowed by `cost_center`, `party_type`, or `party`, and applies from `effective_from` to the inclusive `effective_to`:

```json
{ "name": "Engineer payroll to anchor project",
  "account": "Salary - RIS",
  "cost_center": null, "party_type": null, "party": null,
  "effective_from": "2025-01-01", "effective_to": null,
  "targets": [{ "project_id": "<project-uuid>", "percent": 100 }] }
```

Target percentages need at most 4 decimals and must total exactly 100. To edit a rule, add `rule_key` and `expected_version` (the current version from `list`); a stale `expected_version` is refused. The most specific current rule takes a line — each narrowing field (cost centre, party) outweighs a named account, which outweighs an account group — and a save that would leave two current rules with equal specificity and overlapping windows is refused: narrow the rule or change its dates. `--dry-run` checks each rule against the saved rules only, so two new rules in one file that tie each other pass the dry run and the second is refused at the real save. To void a mistaken rule, end it the day before it starts. PMO reads and attributes only; nothing is written to ERPNext or to the ledger mirror. Attributed cost counts in project actuals and budget vs actual through the same account → category map as tagged cost, and is reported apart from it (recipe 4 maps the accounts). Roles: Admin and Finance preview, set and end; Executive and Project Manager can list.

**How to verify:** rerun `attribution preview` on the same file and compare the project/month/category amounts; confirm the saved version and dates with `attribution list`, and `--history` after an edit or end.

**Common errors:** a conflicting-rule refusal means an existing current rule ties the new one — read `list`, then narrow the match or change the dates. A stale-version refusal means someone edited the rule since your read — re-read `list` and retry with the current `expected_version`. A preview category shown as unmapped means the account is missing from the budget category account map, so the attributed cost cannot reach actuals until it is mapped. Contract: `docs/specs/cost-attribution.spec.md`.

### 6. Purchase history

**Goal:** reconcile already-existing ERP purchase documents to PMO purchases without duplicating a purchase.

**Exact commands:** read the orphan list and filter to the known project if useful:

```bash
node scripts/pmo.mjs purchases orphans --limit 100
node scripts/pmo.mjs purchases orphans --project <project-uuid> --limit 100
```

Prepare a private JSON array or CSV of existing ERP document references and intended PMO procurement links using the field format shown by the orphan results and the CLI help. Preview, inspect per-row decisions, then apply:

```bash
node scripts/pmo.mjs purchases link <links.json> --dry-run
node scripts/pmo.mjs purchases link <links.json>
```

If a document is organization overhead, an active Admin or Finance can preview and mark it aside with `pmo purchases set-aside <rows.json> --dry-run` followed by the same command without `--dry-run`. Undo a mistaken set-aside with `--undo` after verifying the row.

If the journal's supplier is not yet a PMO company, create it first with recipe 2a. Costs the ERP booked as journal entries (no supplier invoice) are listed per project and can be attached to an existing PMO purchase of the same project. Attaching lowers that purchase's open commitment and never changes project spending; nothing is sent to the ERP. Roles: Admin, Executive, Project Manager, Finance. Only lines tagged to the project are listed; a journal PMO posted itself is not. A wrong attach is undone in the app by an Admin or Finance member (no CLI command deletes records).

```bash
node scripts/pmo.mjs purchases journals --project <project-uuid>
node scripts/pmo.mjs purchases attach-journals <rows.json> --dry-run
node scripts/pmo.mjs purchases attach-journals <rows.json>
```

Each row names one line returned by `journals` plus the purchase: `{"voucher_no":"<journal number>","project_id":"<project-uuid>","account":"<ledger account>","procurement_id":"<purchase-uuid>"}`. The dry run reports `attach`, `skip` (already on that purchase) or `refused` with a reason per row and writes nothing.

An active Admin can create a historical purchase directly from journal cost lines. Preview first, then apply the identical file. A title and vendor are required; reference is optional. If the ledger does not identify a vendor, explicitly confirm the selected vendor with `vendor_confirmed: true`. The server computes the ledger-currency amount. Negative and cancelled lines are refused; no accounting-system write occurs and existing project actuals stay unchanged.

```bash
node scripts/pmo.mjs purchases record-only <history.json> --dry-run
node scripts/pmo.mjs purchases record-only <history.json>
node scripts/pmo.mjs purchases undo-record-only <purchase-uuid> --reason "Incorrect link" --dry-run
node scripts/pmo.mjs purchases undo-record-only <purchase-uuid> --reason "Incorrect link"
```

For a capture report that names a purchase requiring undo, use the displayed `undo-record-only` command with a reason; after undo, start a fresh capture request with a new request ID.

### Import purchase history into a client with no accounting system (`purchases import-history`)

Who: an active Admin, in an organization whose purchasing PMO owns (an organization whose accounting system owns purchasing is refused with `procurement_externally_owned`; it uses capture below). What it does: turns each row of a private JSON file into an ordinary PMO purchase that starts at its furthest document (order, receipt, vendor invoice, payment), counts toward actual spend, and never writes to an accounting system. The importing Admin is recorded as requester. No approver or approved amount is invented, so an unpaid purchase is paid later by a real approver. Each row must say who approved it outside PMO; that note goes to the audit trail. A row whose project or vendor does not exist is refused: create the company first (recipe 2a) and read project ids with `pmo get`.

```bash
node scripts/pmo.mjs purchases import-history <history.json> --dry-run   # preview: writes nothing
node scripts/pmo.mjs purchases import-history <history.json>             # apply the identical file
```

Row shape (one JSON array, at most 200 rows per call; larger files are sent in pages):

```json
{ "import_key": "H-0001", "title": "Pump spares",
  "project_id": "<project-uuid>", "vendor_id": "<vendor-company-uuid>",
  "approved_outside_pmo_by": "<name>, <date>",
  "budget_category": "Materials",
  "lines": [{ "name": "Pump", "quantity": 2, "rate": 500 }],
  "order":   { "number": "PO-9", "date": "2025-02-01", "amount": 1000 },
  "receipt": { "number": "GR-1", "date": "2025-02-10", "status": "Complete" },
  "invoice": { "number": "INV-2", "date": "2025-02-20", "amount": 1000, "tax_treatment": "exclusive", "tax_amount": 110 },
  "payment": { "number": "PAY-1", "date": "2025-03-01", "amount": 1110 } }
```

Give at least one of `order`, `receipt`, `invoice`, `payment`; the purchase takes the furthest one. A payment must equal the invoice's gross (amount plus exclusive tax) and marks it paid; leave `payment` out for an unpaid invoice. A part payment is refused; record it in the app. A payment with no invoice is refused (`payment_needs_invoice`: a payment needs its invoice). `import_key` is your own stable id for the row: sending the same row again reports `skip` and creates nothing, so a rerun after a failure is safe; the same key with a changed row is refused (`import_key_payload_changed`).

The result lists every row as `create`, `skip` or `refused` with a reason, plus `status` and `payable`. Exit 1 when an apply refused a row or the call failed (after a failure, `not_saved_import_keys` may include rows that were saved when the reply was lost; rerunning the same file is safe); exit 2 when the caller is not an Admin or the file is malformed (nothing sent). If the organization requires approval before payment, an unpaid row is imported but the preview and the report warn `not_payable:gate_approval_before_payment` and count it (`counts.not_payable`): it cannot be paid until that setting is turned off. A row with a payment is refused while that setting is on (`approval_before_payment_on`: "approval before payment is on: record an approved amount or turn it off for the import"); an Admin turns it off for the import and back on afterwards. Check the preview carefully: an applied row can only be corrected in the app, or taken back whole with `purchases undo-import` (below) and imported again. Imported purchases carry no ERP link; correct one in the app.

**How to verify:** the purchase shows in **Procurement** at its step with its documents; the project's actual spend includes it; a second run of the same file reports every row `skip`.

#### Take back an imported purchase (`purchases undo-import`)

Who: an active Admin. Use it for a valid but wrong imported row (wrong project or vendor, a duplicate under another key). It previews unless `--confirm` is given:

```bash
node scripts/pmo.mjs purchases undo-import <import-key> --reason "<why>"             # preview: lists what would be removed, writes nothing
node scripts/pmo.mjs purchases undo-import <import-key> --reason "<why>" --confirm   # apply
```

Applying removes only that import's purchase, items, order, receipt, invoice, payment and import record, and frees the key, so a corrected row with the same `import_key` imports as new. Every other import and every purchase entered by hand is unchanged. The audit trail keeps the reason and the imported row. It is **refused** (`has_later_records`, exit 1, with `blocked_by` naming what is in the way) once anything outside the import exists against the purchase: a payment, receipt or invoice recorded later, an added item, a status change made later, an attachment or any other record pointing at it. Undo that later work first if it is wrong, or correct the purchase in the app. Exit 2: not an Admin, or the key or `--reason` is missing (nothing sent). `import_not_found`: the key is unknown in your organization, or was already undone.

### Capture existing purchases from the connected accounting system (`purchases capture`)

Who: an active Admin on an organization with one active accounting-system connection. What it does: reads the connected system's purchase orders, supplier invoices and cost journals, matches them to projects, and records the matched ones in PMO as captured purchases with their cost lines. It never writes to the accounting system (every result carries `erp_write: false`) and never approves or pays anything. Scope is `--all` or one `--project <project-uuid>`; if `--all` is too large the preview says `run_per_project`, so run it per project.

```bash
node scripts/pmo.mjs purchases capture --all --dry-run                      # preview: writes nothing
node scripts/pmo.mjs purchases capture-report --project <project-uuid>      # read the reconciliation for one scope
node scripts/pmo.mjs purchases capture --project <project-uuid> --apply --revision <revision> --request <new-uuid>
node scripts/pmo.mjs purchases undo-record-only <purchase-uuid> --reason "<why>"
```

1. **Preview.** The output lists `proposals`, `reports` (per project), `unassigned` lines and documents, `other_unassigned`, `missing`, and a `revision`. Read it before applying. `unassigned` holds ledger lines of purchase documents that carry no project, and any line that belongs to another company: these stop `complete`. `other_unassigned` counts the remaining ledger lines that have no project (journals, payments, sales, bank), per kind with a net total. It is information only and never stops `complete`. The command exits 0 when `complete` is true and 2 when it is false.
2. **Apply** with the `revision` from that preview and a new request UUID you generate (for example `uuidgen | tr A-Z a-z`). Keep the pair. Apply records only when the preview is complete and the data has not changed since the revision; it then prints the batch result and a fresh report.
3. **Retry safely.** If apply ends with an unknown result (a network or server error), run the identical command again with the same `--revision` and `--request`; the request id makes the retry safe. A request that already finished returns its stored result even when the ERP cannot be read (`already_completed: true`, the same `results` and `next_index`, and `proposals` listing every source it covered with the purchase it became; the report may then show `report_unavailable`), unless the ERP precision changed (`precision_changed`) or the procurement feature is off; if the organisation's ERP connection is gone or ambiguous, the retry is refused with `binding_unavailable` (409) and shows no stored result until it is restored. After an undo, or when you want a different pass, use a new request UUID with a new preview.
4. **Undo** a wrongly captured purchase with `undo-record-only <purchase-uuid> --reason "<why>"` (add `--dry-run` to preview). The report's `needsUndo` entries name the purchases that need it.

Common refusals (exit 2) and what to do:

| Output | Meaning | Do |
|---|---|---|
| `403 FORBIDDEN` | not an active Admin | sign in as an active Admin (`whoami` shows the role) |
| `binding_unavailable` | no single active accounting-system connection | finish the connection in **Administration → Integrations** |
| `feed_not_current` | the accounting-system sync is running, or has not finished within the last two hours | read `feed`: `sync_running_retry_in_minutes` means run the preview again in a few minutes; `erpnext_sync_stopped_check_integrations` means check the sync in **Administration → Integrations** (`feed.last_synced_at` is the start time of the last completed sync) |
| `generation_changed` | the mirrored data changed while reading | run a new preview and use its revision |
| `ledger_currency_mismatch` | the currency read from the accounting company differs from the organization's currency | correct the currency in one of the two before capturing |
| `source_settings_unreadable`, `source_settings.cause` = `refused` | the accounting system refused to return its System Settings (HTTP 401 or 403), so the amount scale is not known | give the integration user read access to System Settings (`guidance`: `grant_integration_user_read_system_settings`), then preview again |
| `source_settings_unreadable`, `source_settings.cause` = `not_found` | the accounting system's site answered but has no System Settings document at that address (HTTP 404) | check the integration's site address and that it is the supported accounting system (`guidance`: `check_erp_site_address_and_product`), then preview again |
| `source_settings_unreadable`, `source_settings.cause` = `unreachable` | the accounting system did not answer usably: unreachable, timed out, a redirect, rate-limited or a server error | check the accounting system is reachable and healthy (`guidance`: `check_erp_reachable_then_retry`), then preview again |
| `source_settings_unreadable`, `source_settings.cause` = `malformed_reply` | the accounting system answered with something else: another 4xx, or a reply that is not a System Settings record (including one over the size limit) | check the integration's site URL points at the accounting system's API (`guidance`: `check_erp_system_settings_reply_then_retry`), then preview again |
| `source_settings_unreadable`, `source_settings.cause` = `version_unknown` | the accounting system's major version is not recorded on the integration, or is one PMO does not support, so PMO cannot tell which precision rule applies | ask the platform owner to run the integration's version check again (`guidance`: `rerun_integration_version_check`), then preview again |
| `source_precision_unknown` | System Settings has a Currency Precision PMO cannot read as a whole number, or leaves it blank and its Number Format is not one PMO knows (or, on version 16, the "use number format from currency" value cannot be read), so the amount scale is not known | in the accounting system's System Settings, set Currency Precision (1 or 2, or 0 on version 16) or choose a standard Number Format, then preview again |
| `source_precision_per_currency` | on version 16, Currency Precision is blank and the "use number format from currency" switch is on, so each currency's own format decides the decimals; capture does not read per-currency formats | in the accounting system's System Settings, turn that switch off or set an explicit Currency Precision, then preview again |
| `source_precision_exceeds_mirror` | the accounting system keeps more than 2 decimals for amounts (from Currency Precision or the Number Format) | PMO holds at most 2 decimals; these purchases cannot be captured |
| `source_limit_exceeded`, `ledger_limit_exceeded`, `run_per_project` | scope too large | repeat per `--project` |
| `precision_changed`, `ledger_currency_unknown`, `ledger_scope_unknown`, `project_unmapped` | the data cannot be matched safely | read the `missing` and `unassigned` entries; fix the mapping in the app or accounting system, then preview again |
| `42501 ... not available to OAuth API clients` | the database has not been updated for this command | ask the platform owner to apply the pending migration |

`purchases capture` and `purchases capture-report` also print one line on stderr naming the cause and what to do, for example `System Settings could not be read (not_found): the ERP site answered but has no such document at that address; ...`. The JSON reply on stdout is unchanged.

Currency Precision `0` depends on the accounting system's version: on version 16 and later it is a real setting (amounts are whole numbers); on version 15 it behaves like blank and the Number Format's decimals apply. On version 16 the number format can also come from the saving user's own language settings rather than System Settings; a document whose amount then does not fit the scale PMO read is refused (`source_precision_mismatch`), never rounded.

#### Place invoices that carry no ERP project

**What it does:** an active Admin decides where a supplier invoice that carries no ERP project belongs. Either place it on a PMO project (PMO records a purchase for it and counts its ledger cost on that project) or set it aside as overhead. It never writes to the accounting system, never creates an ERP document and never sends anything to the dispatch queue. Every result says `erp_write: false`.

**Find the invoices:** `node scripts/pmo.mjs purchases capture-report --all` lists them as `unassigned_documents`; each entry's `id` is the `source_id` below. Use `purchases orphans` for the UUIDs of projects and vendors the same way as the link recipe above.

**File shape:** a JSON array of 1 to 500 rows. Give every row its own `request_id` UUID and keep it: the same file with the same ids can be run again without doing anything twice.

```json
[
  {"request_id": "<new uuid>", "source_id": "<invoice uuid>", "decision": "project", "project_id": "<project uuid>"},
  {"request_id": "<new uuid>", "source_id": "<invoice uuid>", "decision": "project", "project_id": "<project uuid>", "accept_set_aside": true},
  {"request_id": "<new uuid>", "source_id": "<invoice uuid>", "decision": "set_aside", "allow_capital_as_overhead": true}
]
```

`accept_set_aside` is needed only to place an invoice that is currently marked as overhead; `allow_capital_as_overhead` is needed only to mark an invoice whose lines are capital spending. Both default to false and are never assumed. More than 500 rows, a repeated `request_id` or `source_id`, a missing decision, a malformed UUID or a non-true/false flag is refused on your machine before anything is sent.

**Preview, then apply:**

```bash
node scripts/pmo.mjs purchases assign <assignments.json>
node scripts/pmo.mjs purchases assign <assignments.json> --apply --revision <revision>
```

The first command is only a preview: it writes nothing and prints `revision`, one row per decision (what would be created, the ledger amount and currency that would be placed, the project a rule or equipment setting currently places that cost on and which loses it (`loses_cost`), whether an overhead mark will be cleared, any capital lines left out, or the reason for a refusal) and the exact next command. Read every row, fix refused rows, preview again, then run the apply command it prints with the same file. Apply needs that revision: if the source data changed since the preview it is refused as `source_stale` and nothing is applied; preview again. Each row is applied on its own, so a refused row does not stop the others. Exit code 2 means at least one row was refused or the whole run was refused; the output names which.

Common reasons: `source_tagged` (the ERP already gives the invoice a project; it is not unassigned), `snapshot_refresh_required` (retry after the next ledger refresh, then preview again), `capital_spending_not_assignable`, `set_aside_confirmation_required`, `duplicate_lineage`, `source_already_decided` (the invoice already has an active decision; undo it first), `family_incomplete` (on a `project` row: the invoice bills an ERP order, so it must become one purchase together with that order; placed alone it would leave the order's amount counted elsewhere. Place the order and its invoices together with an `order_family` row, below).

**Placing an order and its invoices (an order family):** an invoice that bills an ERP purchase order is placed together with that order and every other invoice billing it, as one purchase. Find the order in `purchases capture-report`: each unassigned invoice that bills exactly one order lists that order's id as `order_source_id`. Write one row per order, naming every submitted invoice of the order that is not yet in a purchase:

```json
[{"request_id": "<new uuid>", "source_id": "<order uuid>", "decision": "order_family", "project_id": "<project uuid>", "invoice_ids": ["<invoice uuid>", "<invoice uuid>"]}]
```

`invoice_ids` lists 1 to 50 invoices, each once, and no invoice may also be another row's `source_id`; `accept_set_aside` works as on a project row; `allow_capital_as_overhead` is refused. Preview and apply exactly as above. The preview prints one line per family, for example `PO-1 → <project>: create, PI-1 600 (pmo_assignment), commitment 0 → 400.00, erp_write: false`: `create` makes one new record-only purchase holding the order and its invoices; `attach to <purchase>` adds the invoices to the purchase the order was already captured as. Each invoice with no ERP project gets an ordinary placement (its ledger amount moves to the project, as for a project row); an invoice the ERP already tags with the same project is linked without one, shown as `(tagged in the ERP)`. The commitment is the order's value less the linked invoices, never below zero; amounts are printed exactly as the ledger and the commitment readers give them. Reasons a family row is refused: `family_incomplete` (the row lists `missing_invoice_ids` and `extra_invoice_ids`; name exactly the order's open invoices, the ones not yet in a purchase and not yet placed; an invoice already placed or linked is extra), `family_ambiguous` (an invoice bills more than one order), `family_has_return` (a return invoice bills the order), `family_project_conflict` (the order or an invoice carries another ERP project), `supplier_mismatch`, `currency_mismatch`, `ordinary_purchase_requires_decision` (the order is in a purchase run in PMO; family placement attaches only to a captured purchase), `family_conflict` (the order's captured purchase is on another project, vendor or currency, or closed), plus every project-row reason for an invoice. To undo a whole family purchase use `undo-record-only <purchase-uuid> --reason "<why>"`; to undo only the invoices one row attached, add `--attach <request_id of that row>`: the purchase keeps its order; once no invoice is left on it, it returns to the stage, status and invoiced date it had before its first attachment. A request id belongs to one kind of row: reusing a family row's id on a project row, or the reverse, is refused `request_conflict`. Either undo is refused while a payment or later step exists, or if an invoice's overhead mark changed since the placement.

If the result of an apply is unknown (timeout, dropped connection), run the identical command again with the same file and revision: rows already applied are reported as `skip`. After a run in which some rows were applied and others refused, do not rerun the same apply command: preview again, then apply with the new revision it prints; rows already applied are skipped.

**Undo:** a placed invoice has a PMO purchase; the apply output prints its id. Undo it with `node scripts/pmo.mjs purchases undo-record-only <purchase-uuid> [--attach <request>] --reason "<why>"` (add `--dry-run` first; `--attach` only for an order family, above). The decision is deactivated, the invoice's earlier overhead mark comes back as it was, and the audit record stays. It is refused if the mark was changed after the placement or if a payment or any later step exists on the purchase. A set-aside decision has no purchase. To reverse it, clear the invoice's overhead mark in the app, which ends the decision, or place the invoice on a project with a row that has `"accept_set_aside": true`, which replaces the decision in the same step.

**When an ERP project tag appears later:** the ERP's tag wins. The placement stops counting the moment the ledger carries the tag, and the decision is kept for the audit trail. Until the next ledger refresh after the ERP retags an invoice, it can show on both projects or on neither; the totals settle at that refresh. A placement waits for a refresh (`snapshot_refresh_required`), but that does not close the window.

**What it never does:** write to or call the accounting system, place an invoice that already has an ERP project, place capital spending on a project, use an invoice's face amount (only ledger amounts count) or run for anyone but an active Admin. If the connected accounting tier does not support it, the command exits 2 with `invoice_assignment` under `missing`; use the app instead.

**Reversing the database change** needs the reviewed down file `supabase/migrations/rollback/0882_capture_invoice_assignment_down.sql` run in one transaction with writes paused, as for the capture migration above. It refuses while any assignment decision exists, because dropping the table would erase the audit record; never delete decisions to force it.

For release operations, apply migrations `0866`, `0873` and `0874` before deploying either `erpnext-sweep` or `purchase-capture`. Follow the target-specific approval, deployment and verification procedure in [Environments](../environments.md); the migration source alone does not show what is deployed. For production, check the actual migration ledger with:

```bash
scripts/prod-read.sh -c "select version from supabase_migrations.schema_migrations where version in ('0866','0873','0874') order by version"
```

Stop if the target or its migration state cannot be verified. After the database is ready, deploy the approved function builds and verify the actual versions and hosted grants using the environment procedure.

Before reversing this migration, pause capture writes and restore the approved preceding function builds. With the target independently confirmed, run these counts through its approved read-only connection (for production, pass the query to `scripts/prod-read.sh`):

```sql
select count(*) filter (where undone_at is null) as active,
       count(*) filter (where undone_at is not null) as undone
from public.erp_purchase_captures where kind in ('order', 'supplier_invoice');
select count(*) as batches from public.erp_capture_batches;
```

If any count is nonzero, **stop**: retain the schema and roll the functions forward, or obtain a separately approved retention plan. Undo alone does not permit a database rollback; never delete history to force it. If all counts are zero, keep writes paused. From the approved checkout, using a privileged connection configured by the target's approved change procedure, execute the reviewed down file in one transaction:

```bash
psql -X --single-transaction --set ON_ERROR_STOP=1 --file supabase/migrations/rollback/0866_erp_purchase_capture_down.sql
```

Its guard must pass. Verify restored function bodies, owner, search path and grants against the target's recorded predecessor. If down fails, it rolls back; stop and restore the compatible function builds. If down committed and rollforward is required, with writes still paused use the same controlled connection to reapply the reviewed forward file before deploying the compatible function builds:

```bash
psql -X --single-transaction --set ON_ERROR_STOP=1 --file supabase/migrations/0866_erp_purchase_capture.sql
```

Reconcile the migration ledger through the approved change procedure; a ledger entry alone does not reapply a reversed schema. Production changes require their own explicit approval.

`history.json` is an array of groups, each with a stable `request_id` UUID, `project_id`, `vendor_id`, `title`, optional `reference`, and `journal_lines`. Each line carries the `erp_doctype`, `voucher_no`, `project_id`, and `account` returned by `purchases journals`. A file may contain at most 500 lines. Keep the same request IDs and payloads on retries, including when the response is unknown. The report identifies created, skipped, and refused groups. Undo unlinks the source and cancels the historical wrapper; it does not delete the purchase or change the ERP ledger.

Pay a captured unpaid supplier invoice through the connected accounting system. Use the captured invoice's PMO mirror UUID, the purchase UUID, a positive amount in the invoice currency, the business date and a new intent UUID for each distinct payment. Active Admin, Executive, Project Manager and Finance users may request payment, subject to the purchase's approval and separation-of-duties rules. The server checks the invoice, current mirrored balance, currency and supplier before sending the payment.

```bash
node scripts/pmo.mjs purchases pay-captured <purchase-uuid> --invoice-document <mirror-uuid> --amount 25.00 --date 2026-11-15 --intent <intent-uuid>
node scripts/pmo.mjs purchases pay-captured <purchase-uuid> --invoice-document <mirror-uuid> --amount 25.00 --date 2026-11-15 --intent <intent-uuid> --confirm
```

The first command prints the exact request without sending it; review it, then add `--confirm` to send once. Keep the same intent and request if the result is unknown; inspect the purchase and payment status before deciding on any further action. For a definitive rejection, refresh the invoice balance and use a new intent for a new payment. A partial payment leaves the purchase invoiced until the invoice is fully settled and the mirrored balance is zero.

Refusals and next steps:

- `step_already_recorded`: the requested step is already linked; inspect its existing document instead of creating another.
- `history_complete`: the captured history is already settled; inspect the invoice and payment history.
- `capture_lines_required`: the earlier step needs source lines; inspect the linked documents and use the supported purchase workflow.
- `capture_invoice_unavailable`: the linked invoice is missing, ambiguous, cancelled, has no usable positive balance or has a currency mismatch; check the link, capture the invoice if it is not actively captured, and refresh or correct the source before retrying.
- `capture_tier_unsupported`: this connected accounting tier does not support captured-invoice payment; use its accounting system to settle the invoice and refresh the mirror.
- `captured_invoice_payment_rejected`: the accounting system refused the allocation; refresh the outstanding balance, correct the amount, and use a new intent for a new request.
- Approval or role refusal: ask an authorized active user to complete the required approval and payment; the approver cannot pay their own approved purchase. If a ceiling or currency check refuses, resolve the invoice or approval first.

Record a goods receipt for a purchase (same command the app sends; connected organisations send the app's accounting-system command; a PMO-only organisation, with no accounting system, records it through the app's own receipt function). Roles: Admin, Executive, Project Manager, Finance on a connected organisation; **Admin and Project Manager only** on a PMO-only one.

```bash
node scripts/pmo.mjs purchases receive <procurement-uuid> --dry-run                      # whole purchase, everything open
node scripts/pmo.mjs purchases receive <procurement-uuid> [--date 2026-11-06] [--status Partial|Complete]
node scripts/pmo.mjs purchases receive <procurement-uuid> --line "Pump=3" --line "Valve=1.5"   # line quantities (Full plan, Odoo tier)
```

Whole-purchase receipts work on Basic and on every connected tier: leave `--line` out and the server receives everything still open. `--line <item>=<quantity>` (repeat per item, item exactly as the purchase order shows it) needs the Full plan **and an Odoo-tier organisation**; on a tier whose receipt is built from the purchase order itself the CLI refuses it (exit 2, nothing sent) rather than receive the whole purchase, so use the app there.

On a PMO-only organisation the receipt is always for the whole purchase (`--line` is refused with exit 2, nothing sent; enter line quantities in the app), and the intent is stored on the receipt, so re-running with the same `--intent` is refused as already recorded instead of recording twice. Only the purchase's own organisation can receive.

Each run prints an `intent` before it sends anything, so a run that hangs still leaves the uuid to retry with. **If the outcome is unknown (the command hangs, or the ERP could not be reached), re-run the identical command with `--intent <that uuid>`**: the same intent never records twice. Do not reuse an intent for a different receipt. Defaults: date today in **UTC** (the CLI does not read the organisation's time zone, so pass `--date` when the local business date differs), status Complete (Partial with `--line`). Refusals carry a hint: plan off, line quantities on a non-Odoo tier, nothing left to receive, quantity above the open quantity, no sent purchase order, ordered before the connection.

**How to verify:** linked documents leave the default orphan list; a receipt shows under the purchase in **Procurement**. Read `pmo purchases orphans --include-set-aside` to confirm overhead rows are marked; compare the link command's `link`, `skip`, and `refused` counts with its row details.

**Common errors:** an unknown ERP document or an invalid project/procurement reference is refused by the server. Correct the row using the read result and inspect the existing procurement in **Procurement** before rerunning. In a client with no ERP, import purchase history with `purchases import-history` (above) or create single purchases through **Procurement → New**.

### 7. Time and materials

**Who:** reads for Admin, Finance, Executive or the project's Project Manager; every write for an active Admin or Finance
member (a Project Manager does the same steps in the app).

**Every write previews first.** Without `--apply` a command reads, prints what it would do and every problem it sees, and
writes nothing. With `--apply` it writes once and prints what the server now holds. A preview is advice: the server
re-checks everything. If a write's outcome is unknown (`outcome_unknown`), run the read it names; never rerun blindly.

**Claim commands take `--project`.** `claim deselect|withdraw` and `signoff prepare` need `--project <id>`: the CLI finds
the claim in that project's list and refuses (exit 2, nothing sent) a claim that is not on it. `claim sources` needs only
the claim id.

```bash
node scripts/pmo.mjs tm rates list --project <project-uuid> --assignees --json
node scripts/pmo.mjs tm rates set rates.json            # preview; then again with --apply
node scripts/pmo.mjs tm assign set assignments.json --apply
node scripts/pmo.mjs tm claim preview --project <project-uuid> --from <YYYY-MM-DD> --to <YYYY-MM-DD>
node scripts/pmo.mjs tm claim assemble --project <project-uuid> --from <YYYY-MM-DD> --to <YYYY-MM-DD> --apply
node scripts/pmo.mjs tm claim sources <claim-uuid>
node scripts/pmo.mjs tm claim deselect <claim-uuid> <source-uuid>... --project <project-uuid> --apply
node scripts/pmo.mjs tm signoff prepare <claim-uuid> --project <project-uuid> --document <document-uuid> --apply
node scripts/pmo.mjs tm claim withdraw <claim-uuid> --project <project-uuid> --apply
node scripts/pmo.mjs tm claim list --project <project-uuid> --json
```

**Rates file:** a JSON array of `{project_id, kind, label, unit, rate, currency, effective_from}` (optional
`effective_to`, `asset_id` + `standby_rate` for equipment, `sales_item_code`). To change a line, add its `line_key` and
`expected_version` from `rates list`. The whole file saves or none of it does; the preview marks each row create, new
version, unchanged or refused. A new line's key is printed by `--apply`; running the same file again refuses it as a
duplicate label. **Assignments file:** `{project_id, line_key, user_id, effective_from}` (optional `effective_to`); each
row is saved on its own, an identical row is skipped.

**Reruns are safe:** an overlapping Draft claim is reported `already_assembled`, a withdrawn claim `already_withdrawn`;
nothing is sent.

**Stays in the app:** entering and approving time (**Timesheets**), issuing the signed document (**Project →
Documents**; `pmo documents create|upload` registers a Draft and its file), confirming the client's sign-off,
creating, raising and approving any invoice (**Project → Contract & billing**), and ending a rate line or an
assignment.

**How to verify:** after each `--apply`, the printed state is the server's; compare `claim list` with the app's T&M panel.

**Common errors:** `tm_role_refused` (sign in as Admin or Finance); a refused rates row (fix the file; nothing was saved);
`Changed since it was read` (re-read `rates list`); `Refused in the claim's current state` (the claim is no longer Draft,
or an hour in it is no longer approved).

### 8. Documents

**Goal:** inspect the project register, create a register entry and upload its file, or attach an existing Microsoft 365 item to the right PMO record.

**Exact commands:**

```bash
node scripts/pmo.mjs documents list --project <project-uuid>
node scripts/pmo.mjs m365 status
node scripts/pmo.mjs documents link <document-links.json> --dry-run
node scripts/pmo.mjs documents link <document-links.json>
node scripts/pmo.mjs documents create --project <project-uuid> --category <category> --title <title> [--code <code>] [--revision <rev>] [--date <YYYY-MM-DD>] [--file <path>]
node scripts/pmo.mjs documents create ... --confirm
node scripts/pmo.mjs documents upload <document-uuid> <path>
node scripts/pmo.mjs documents upload <document-uuid> <path> --confirm
```

Each JSON row names exactly one `project_id`, `budget_version_id`, or `procurement_id`, plus `drive_id`, `item_id`, `web_url`, `name`, and `kind` (`file` or `folder`). `documents create` and `documents upload` are for active Admin, Executive, Project Manager and Finance members, as in the app. Without `--confirm` each prints a preview and writes nothing. `--category` is one of the register's categories: Drawing, Specification, Report, Transmittal, Submittal, Certificate, Other. A new entry starts as Draft; `--file` uploads the file to it in the same run. `documents upload` attaches a private file to a Draft entry that has no Microsoft reference. Only the entry's author or an Admin can upload to it; the preview warns when you are not its author. A new upload replaces the entry's previous file when its name differs; a file with the same name as the current one is refused, so rename it first. Files follow the app's rules: PDF, PNG/JPG/WebP images, Word, Excel or PowerPoint (`.docx`, `.xlsx`, `.pptx`), DWG/DXF, CSV or text, up to 5 MB. A command-line sign-in does not set, change or clear a Microsoft reference on a register entry; use `documents link` or the app. Status changes (Issue, Approve) stay in **Project → Documents**.

**How to verify:** read the register again with `documents list` and confirm the expected row and source (`upload` after an upload); confirm `m365 status` reports the expected connection before linking.

**Common errors:** the link must target exactly one record type and identify a file or folder. If the M365 item does not exist or is in the wrong library, correct it in **Project → Documents** or the library before rerunning. Same-item links are idempotent. `document_not_draft` or `document_has_microsoft_reference`: the entry cannot take a file; use the app. `document_upload_unconfirmed`: the record step's reply was lost and the entry could not be read back; the file is kept, so check the entry in the app and run the upload again. When the reply is lost but the entry is read back naming the new file, the upload is reported complete with a note saying so. `document_not_updated`: the entry was not changed, and the stored file was removed so the command can be rerun; if the message says the file is still stored, remove it in the app first. `document_created_file_not_stored`: `create --file` made the entry but could not store the file; finish it with `documents upload <document-uuid> <path> --confirm` rather than rerunning `create`. `document_file_name_in_use`: the entry already holds a file with that name; upload it under a new name. A permission error from the file store on `--confirm` means you are neither the entry's author nor an Admin.

### 9. ERP checks

**Goal:** confirm the ERP connection and project mapping without changing data.

**Exact commands:**

```bash
node scripts/pmo.mjs erp readiness
node scripts/pmo.mjs erp list-projects
node scripts/pmo.mjs erp verify-links
node scripts/pmo.mjs get external_domain_ownership --select domain,external_tier
node scripts/pmo.mjs get erp_gl_entry_mirror --select project,account,cost_center,fiscal_year,posting_date,debit,credit --limit 100
```

**How to verify:** `readiness` reports setup checks, `list-projects` reports mapped ERP projects, and `verify-links` reports PMO-to-ERP project-link status. For accounting evidence, inspect the GL mirror read output with an Admin, Executive, Project Manager, or Finance account. These commands are reads; they do not repair mappings or force a sync.

**Common errors:** if the ERP is disconnected or a mapping is absent, use **Administration → Integrations** to correct setup. If a change made directly in ERPNext has not arrived yet, wait for the reconciliation window or use the immediate PMO command when one exists; do not create a duplicate record.

### 10. Match stock items and warehouses to Odoo

**Goal:** match PMO stock items and warehouses to Odoo products and internal locations for an organization whose active binding is Odoo.

**When to use:** run this setup after activating an Odoo organization binding with a chosen company, before stock documents are posted to Odoo.

**Before this:** the warehouse-transfer operation type (an internal operation type of the Odoo company) is set only when the Odoo binding is activated, together with the issue operation type. Employing the inventory domain for the organisation is an operator step (`operator_set_domain_ownership`, see the operator runbook); an Admin cannot do it from the app or this CLI.

**Exact commands:**

```bash
# 1. Propose matching pairs: reads PMO masters and stages Odoo products and locations
node scripts/pmo.mjs connect stock propose --tier odoo

# 2. List proposed pairs, counts, and open rows with reasons and next actions
node scripts/pmo.mjs connect stock list --tier odoo
node scripts/pmo.mjs connect stock list --tier odoo --json

# 3. Accept all unambiguous stock matches. Without --confirm it only reads and prints what would be linked;
#    with --confirm it applies stock items, then stock warehouses, and nothing else
node scripts/pmo.mjs connect stock accept --tier odoo
node scripts/pmo.mjs connect stock accept --tier odoo --confirm

# 4. Resolve a contested proposal to a chosen PMO and ERP pair (dry run by default)
node scripts/pmo.mjs connect stock resolve --tier odoo --proposal <id> --pmo <id> --external <id>
node scripts/pmo.mjs connect stock resolve --tier odoo --proposal <id> --pmo <id> --external <id> --confirm

# 5. Dismiss an ambiguous or unneeded proposal (dry run by default)
node scripts/pmo.mjs connect stock dismiss --proposal <id>
node scripts/pmo.mjs connect stock dismiss --proposal <id> --confirm
```

**What "left open" means:** `accept` links unambiguous `link` outcomes. Rows left open are proposals marked for `review`: contested ones (several candidates, name/code divergence) and PMO records with no matching Odoo record. Counts cover the whole run; `list` pages through every row. Left-open rows remain open for operator inspection via `pmo connect stock list --tier odoo` and can be resolved or dismissed individually.

**Nothing is created in Odoo:** stock matching is strictly a linking workflow. It queries existing Odoo storable products and internal warehouse locations, compares them against active PMO stock items and warehouses, and records confirmed links in `external_refs`. It never creates, updates, or deletes records in Odoo. Unmatched PMO records are listed with their reason and are not errors.

**What the value covers:** a posted stock document shows its value on the document. PMO project cost and work-item consumption do not include it yet.

**A held post that cannot be released:** if a document is held with a cause that cannot be cleared, cancel it and create it again.

### 11. Correcting data after a load

**Goal:** fix one wrong loaded value, with a preview, without creating duplicate projects, lines, or versions.

`pmo load` never overwrites: a matching project, contract line or budget line is skipped and a differing value is reported (`…_differs`, `…_conflict`, `contract_line.skip`). `pmo correct` is the separate, explicit way to change a loaded value. It is for an active Admin, changes one record per command, finds it by the loader's own key, and makes the same plain table update the app makes, so row-level security, column grants and database triggers decide exactly as they do for the app. Always preview first.

```bash
# Project header: --code <code>, or --name <name> --client <legal name>
node scripts/pmo.mjs correct project --code <code> --set end_date=2026-12-31 --dry-run
node scripts/pmo.mjs correct project --name "<name>" --client "<legal name>" --set short_name=<alias> --set sector=<value> --dry-run
# Contract line (bill-of-quantities item): the line `key` from the load file
node scripts/pmo.mjs correct contract-line --code <code> --line-key <line-key> --set rate=1500.50 --set quantity=12 --dry-run
# Budget line item of a Draft budget: the row exactly as it is in the load file (JSON or @file)
node scripts/pmo.mjs correct budget-line --code <code> --line '{"category":"Labor","description":"Site crew","fiscal_year":"2026","budgeted_amount":1000}' --set budgeted_amount=1200 --dry-run
```

The preview prints the record `id` and, for each field, its `before`, `after` and `status` (`changed`, or `unchanged`, which is not sent), plus a `next` line; it writes nothing. Re-run the identical command without `--dry-run` to apply: it prints the same `fields` (without `next`). Text is trimmed as the app trims it, so the `after` shown is what is stored; `award_type` takes `tender` or `direct`, `bidding_entity` takes `alone` or `consortium`.

| Command | Fields | The app screen it matches |
|---|---|---|
| `correct project` | `name`, `short_name`, `start_date`, `end_date`, `project_manager_id`, `service_line`, `sector`, `location`, `award_type`, `bidding_entity` | Project header → Edit |
| `correct contract-line` (a bill-of-quantities item) | `description`, `unit`, `quantity`, `rate`, `basis` (`unit_rate` or `lump_sum`; a lump-sum line has quantity 1) | Project → Contract & billing |
| `correct budget-line` (a budget line item) | `budgeted_amount`, `description`; only while the budget is a Draft per-year version | Project → Budget |

Not available here, by design: a project's code, client, currency, stage or status, contract value and tax (use the app, and `pmo stage-date` for a stage date), a budget line's category, fiscal year or import identity, a contract line's `key` and item code, companies (use **Companies**), clearing a value, and any delete. A refused field names where to change it.

**What a correction does and does not touch.** A budget line keeps the identity it was loaded with, and so does a contract line (its `key` never changes). Re-running the original load file therefore still reports the line as already loaded. Do **not** put the corrected budget amount back into the load file: its identity would then differ and the loader would add a second line. Address the line again by its original row if it needs another correction. Claims already created keep the rate, quantity and amount they were created with (a claim line is a snapshot and cannot be edited); a later claim, and the contract's earned-value position, use the corrected line. The app lets an Admin correct a line that a claim already uses, and `pmo correct` does the same: preview first.

**How to verify:** read the record back (`pmo get projects --filter code=eq.<code>`, `pmo get budget_line_items --filter budget_version_id=eq.<draft-uuid>`), then re-run the original load file with `--dry-run`: it must plan no creation.

**Common errors:** `no project / contract line / budget line` or `more than one`: the key matched zero or several records; fix the key and read the record first. `line-items can only change while the owning version is Draft`: the budget is Active or Archived, so its lines cannot change. `a lump-sum line must have quantity 1`: send `--set basis=lump_sum --set quantity=1` together. `No row was updated`: row-level security hid the record; check the role and organization with `whoami`. A server refusal is shown with its own message; do not retry with broader credentials. If the historical stage date is wrong, use the stage-date sequence in recipe 3.

### 12. Opening balances at go-live

**Goal:** at go-live, load where each running work order stands and what each stock location holds, so progress, billing and stock continue from there instead of from zero (#2588, `docs/specs/opening-balances.spec.md`).

**Who:** an active Admin. **When:** after the projects, contract lines, work orders (Issued, with their lines allocated), stock items and locations are loaded, and **before** any real acceptance, claim, invoice or stock movement on that work order or location; the server refuses an opening once one exists. Finished (Closed or Cancelled) work orders carry no opening balance. Every opening uses the one go-live date (`p_as_of`); a different date is refused.

```bash
# Per running work order: per allocated contract line, the quantity certified (accepted) and the quantity already claimed.
node scripts/pmo.mjs rpc load_work_order_opening '{"p_work_order_id":"<uuid>","p_as_of":"<go-live date>","p_note":"source sheet row 12","p_lines":[{"boq_item_id":"<uuid>","certified_quantity":4,"claimed_quantity":3}]}'
# Per stock location: the counted quantity of each item and its unit cost (a cost is required above 0).
node scripts/pmo.mjs rpc load_stock_opening '{"p_warehouse_id":"<uuid>","p_as_of":"<go-live date>","p_lines":[{"item_id":"<uuid>","counted_quantity":10,"unit_cost":5}]}'
# Reconcile: one row per live opening (certified value, claimed value, stock quantity and value). Compare with the source totals.
node scripts/pmo.mjs rpc opening_balance_report '{}'
# Undo a wrong opening (only while nothing real has happened on it since), then load it again.
node scripts/pmo.mjs rpc reverse_opening_balance '{"p_id":"<opening id>"}'
```

**What it writes:** the certified part becomes a confirmed acceptance marked `opening`, dated at go-live; the next real acceptance (cumulative) replaces it. The claimed value (claimed quantity × line rate) counts as already invoiced on the work order, so what is left to invoice and the next claim's cap start from it; it is never a claim or an invoice and nothing is sent to an accounting system. The stock part is an `Opening balance` stock document (number `OPN-…`) posted at go-live. Each load and reversal is in the audit trail. These calls have no `--dry-run`: run the report after each batch and reverse any row that does not match.

**Only for billing PMO will not also read from the accounting system:** load a work order's claimed quantity only for invoices that are not brought in from the connected ERP under that work order. If the ERP's invoices for the work order are mirrored into PMO, leave the claimed quantity at 0 and let the mirror carry them; loading both counts the billing twice. A corrected opening may follow a reversal on the same work order or location.

### 13. Owner-supplied material workbook load (`material load`)

**Goal:** load owner-supplied material opening stage totals (planned, requested, set-aside, received, issued, returned, transferred, owner return) and verbatim evidence from a client workbook once, with preview by default and repeatable reruns (#3010, Contract v2).

**Who:** an active Admin. The command uses the signed-in Admin's ordinary OAuth session; it never uses a service credential and never modifies existing unrelated work orders or stock ledger rows.

**One-time isolated Python setup:** the loader spawns an isolated Python interpreter (`-I`) with `openpyxl` pinned in `scripts/requirements-owner-material.txt` so untrusted workbooks are read without executing formulas, macros, or external links. The CLI never auto-installs packages.

```bash
python3 -I -m venv /tmp/owner-material-loader-venv
/tmp/owner-material-loader-venv/bin/pip install -r scripts/requirements-owner-material.txt
```

Set `PMO_OWNER_MATERIAL_PYTHON` (or pass `--python <path>`) if your venv lives elsewhere.

**Private mapping file (keep outside the repository):**

```json
{
  "source_key": "stable-source-id-v1",
  "as_of": "2026-11-27",
  "zero_cost_tag_name": "Owner Supplied Material",
  "reconciliation_scale": [
    { "name": "Prepared", "position": 1, "percentage": 20 },
    { "name": "Closed", "position": 2, "percentage": 100 }
  ],
  "policy": { "closing_conflict": "refuse", "duplicate_items": "refuse" },
  "work_order_defaults": {
    "tax_treatment": "exclusive",
    "tax_amount": "0",
    "order_value": "0",
    "currency": "IDR"
  },
  "owner_warehouses": {
    "WH NORTH": { "code": "WH_NORTH", "name": "North Owner Warehouse" }
  },
  "workbook": {
    "item_list_sheet": { "name": "ITEMS", "header_contains": ["ITEM_CODE"], "columns": { "item_code": "ITEM_CODE", "description": "DESC", "unit": "UNIT" } },
    "validation_only_sheets": [],
    "excluded_sheets": [],
    "template_sheets": [],
    "location_sheet": {
      "header_contains": ["PART_NO", "DESC"],
      "warehouse_band": { "single_row_after_fields": ["reservation_date"], "end_field": "total_set_aside", "required": true },
      "columns": { "item_code": ["PART_NO"], "description": ["DESC"], "unit": ["UNIT"], "planned": ["PLAN_QTY"], "order_number": ["ORDER_NO"], "total_set_aside": ["SET_ASIDE_TOTAL"] },
      "evidence_columns": { "reservation_date": ["SET_ASIDE_DATE"] },
      "field_presence": { "item_code": "required", "description": "required", "unit": "required", "planned": "required", "order_number": "required", "total_set_aside": "required", "reservation_date": "required" }
    }
  },
  "sheets": {}
}
```

- `source_key`: stable logical source identity (never a file digest). Keep the same `source_key` across retries and reruns so identical records skip safely.
- `as_of`: required ISO date (`YYYY-MM-DD`) for the loaded opening position (overridable per sheet under `sheets.<name>.as_of`).
- `zero_cost_tag_name`: required name of an existing zero-cost stock tag in the organisation (resolved via `om_material_config().zero_cost_tags`; never created by the loader).
- `reconciliation_scale`: optional ordered scale (`[{ name, position, percentage }]`, ending at 100). Compared against `om_material_config().steps` before loading sections; skipped if identical, previewed as before/after, and applied via `om_material_set_scale` on `--confirm`. If refused by the server, sections are not sent.
- `policy.closing_conflict`: `"refuse"` (default) refuses any line where workbook closing/stage totals disagree with component columns or where computed closing is negative; `"movements_win"` lets component column sums win over stale totals, accepts negative closing, and flags every affected row in the report.
- `policy.duplicate_items`: `"refuse"` (default) skips repeated item rows within a location at line level (marking the section partial); `"sum"` consolidates repeated rows for the same item into one planned line with summed quantities, agreed category (or none), and all source rows preserved verbatim in `evidence.rows`, flagged in the report.
- `work_order_defaults`: explicit commercial inputs (`tax_treatment`, `currency`, optional `order_value` / `tax_amount`) required when the workbook contains owner order numbers not yet in the project. Missing work orders are created first via `import_work_orders` in `Draft` status (requires organisation setup workflows enabled). Never guessed or defaulted.
- `workbook`: defines every workbook-specific sheet name, header marker, column heading/alias, excluded column, and warehouse band so the tracked parser stays generic.
- `workbook.location_sheet.field_presence`: required map declaring every mapped field (every key of `columns`, `sub_header_columns`, and `evidence_columns`) as `"required"` or `"optional"`; where the layout variants differ, declare per variant with `{ "two_row": "...", "single_row": "..." }`. A sheet whose headers match no column for a `required` field is refused whole before any row is read, with the reason naming the field and the header aliases looked for (under every policy, including `movements_win`); an absent `optional` column stays zero. A mapping that does not declare every field is rejected before anything is parsed or sent.
- `workbook.location_sheet.warehouse_band.required`: required boolean declaring whether every location sheet must carry at least one owner-warehouse column; when `true`, a sheet whose band matches no warehouse column is refused whole (`missing_required_column`).
- `owner_warehouses`: maps every normalized owner-warehouse column header discovered inside the configured `workbook.location_sheet.warehouse_band`. Unknown headers are refused, never guessed.
- `units`: optional map of upper-case unit code -> `{ name, whole_only }` used when creating missing units (defaults to `name = code`, `whole_only = false`; unit chunks are sent before items and preview lists every unit it would create).

**Exact commands:**

```bash
# 1. Confirm signed-in identity, role and target URL
node scripts/pmo.mjs whoami

# 2. Preview (default — writes nothing; writes full JSON report outside the repo)
node scripts/pmo.mjs material load /private/material.xlsx \
  --project <project-uuid> \
  --map /private/material-map.json \
  --report /private/material-load-report.json

# 3. Inspect refused_sections, work_orders, policy_flagged_sections, and suggested_stock_openings.
#    Re-run with --confirm to apply accepted records:
node scripts/pmo.mjs material load /private/material.xlsx \
  --project <project-uuid> \
  --map /private/material-map.json \
  --report /private/material-load-report.json \
  --confirm
```

**Prerequisites & reruns:**
- Setup-workflow opt-in: a run that would create missing work orders needs the organisation's setup-workflow opt-in turned on ("Enable setup workflows", which an organisation Admin turns on in the app, Finance hub). Every preview that lists work orders to create prints this as `work_orders.prerequisite`; if the opt-in is off, `--confirm` stops at the work-order import with error `setup_workflows_disabled` (exit 1) and nothing is written — turn the setting on, then re-run the identical command.
- Project, units, zero-cost tag, and receiving locations must already exist. If an earlier estimated demo load posted overlapping stock documents or requisitions, reverse/cancel them through supported workflows first.
- A second confirmed run with the identical workbook and mapping creates zero new work orders and skips every unchanged catalogue and section row. Changed planned quantities or opening totals update with `before`/`after` reported.
- If a network failure leaves a section's write outcome unknown (`outcome_unknown`), do not change `source_key`; re-run the identical command to resume safely.
- Exit `0` means complete (zero refused sections); exit `1` means partial/incomplete (accepted sections loaded, refused sections unwritten and listed with exact sheet/row/column coordinates) or a confirmed run stopped before any write (`setup_workflows_disabled`); exit `2` means usage, role, or mapping error before sending anything.

## Command scope and current constraints

The full shipped command list and flags are printed by `node scripts/pmo.mjs --help`. Generic `get`, `create`, `update`, and `rpc` are constrained by closed table/RPC allow-lists; do not treat them as arbitrary access. Generic `create` and `update` do not offer `--dry-run`; use an app workflow for a write that must be previewed first. `pmo load`, `pmo correct`, `pmo bid`, `purchases link`, `purchases set-aside`, `purchases attach-journals`, `purchases record-only`, `purchases undo-record-only`, `purchases import-history`, `purchases undo-import`, `purchases receive`, `purchases pay-captured`, `documents link`, `documents create`, `documents upload`, `accounts map set`, `attribution set`, every `tm` write (a preview unless `--apply`), and `org add` do support previews. The only command that deletes records is `purchases undo-import`, for the rows of one import.

The CLI does not create an ERP company directly as a separate ad hoc step, activate a budget, enter or approve time, confirm a sign-off, create or approve an invoice, or change a loaded project's stage, contract value or currency (`pmo correct`, recipe 11, changes the other loaded fields). Use the recipes above for their app screens and tracked enhancements: [budget activation](https://github.com/ariefsaid/PMO/issues/1859) and [T&M operations](https://github.com/ariefsaid/PMO/issues/1856).

**Contract-line and budget-line corrections: what the database allows (known limit).** A command-line sign-in may change an existing contract line (`boq_items`) or budget line (`budget_line_items`) only as an active Admin, and `pmo correct` sends `Prefer: return=representation,handling=strict,max-affected=1` (the database accepts the request only when `handling=strict` and `max-affected=1` each appear once, spelled exactly). Whatever the header says, the database refuses a command-line request that changes more than one row. Which row it is comes from the caller's own `id=eq.<uuid>` filter, which the database's request check cannot see: a wrong id changes one wrong row, never several. The only columns a command-line sign-in may change are, on contract lines: description, unit, quantity, rate, earning basis; on budget lines: amount, description. Every other column is refused by the database; the app screens stay the place for them. `pmo correct contract-line` and `pmo correct budget-line` (recipe 11) send only columns from those lists; `pmo update` still refuses both tables.

### Account request reconciliation

For an unresolved account request, an active Admin can inspect and dispose of a request after independently checking the connected ERP company.

1. Run `node scripts/pmo.mjs whoami` and confirm the organization, environment and active Admin identity. Production requires the owner's explicit approval for that instance; no other instruction implies it.
2. Run `node scripts/pmo.mjs rpc list_account_reconciliation '{}'` and identify the request by its category, account name and state; copy its `id`. The list includes unresolved requests in open or dismissed state.
3. Check the connected ERP company for the requested account. Proceed only after confirming it is absent and record a meaningful reason of 10–1000 characters.
4. Run `node scripts/pmo.mjs rpc dispose_account_reconciliation '{"p_id":"<request-id>","p_reason":"Verified account absent in the connected company","p_absent":true}'`, replacing the ID and reason with the actual values. `p_absent: true` is an explicit attestation of absence.
5. Check the list again. A request that is not eligible remains listed; the server refuses missing attestation, insufficient reason, a different organization, non-Admin or inactive members, an active or recoverable send, or a recorded external identity. Resolve the underlying condition instead of retrying with broader credentials.
