# PMO agent operator runbook

> **Audience:** an agent operating PMO for the owner. Read this page before preparing client data.
> The commands use the signed-in user's permissions. They do not bypass PMO role checks.

## Read this first

### What the CLI can and cannot do

`node scripts/pmo.mjs --help` is the command reference. The CLI supports bounded reads, selected record writes, a starting-data loader, stage-date correction, ERP checks, purchase-document linking, document-reference linking, goods-receipt recording, account maps, cost-attribution rules, and read-only T&M inspection. It is not a general database console: there is no delete command, no arbitrary RPC, and some writes remain app-only. Do not invent flags or call database tables directly.

Use Node 22 or newer. Sign in with `node scripts/pmo.mjs login`, then confirm the identity and role with `node scripts/pmo.mjs whoami`. The CLI stores an ordinary owner session and applies the same row-level permissions as the app. Use a real, active Admin account for loading client data and other Admin-only commands.

`pmo load`, `pmo stages`, `pmo stage-date`, `pmo accounts map set`, and ERP setup checks require an active Admin. Purchase reads/links and `pmo purchases receive` (a procurement money write) are for active Admin, Executive, Project Manager, or Finance members; the `--include-set-aside` read and setting documents aside are Admin/Finance only. Attribution preview/set/end are Admin/Finance; `pmo attribution list` also serves Executive and Project Manager. T&M reads are for Admin, Finance, Executive, or the project's Project Manager. Other writes remain subject to the signed-in member's normal app permissions.

### Data ownership when an ERP is connected

PMO is the app and canonical workflow. When ERPNext or Odoo is connected, the ERP owns its native accounting ledger, procurement chain, party master, sales money documents, and timesheet records; PMO reads synchronized data and sends supported writes through the adapter. Projects, milestones, tasks, CRM and the documents register remain PMO-owned. Budgets combine ERP objects with PMO versions. PMO provides the weekly timesheet entry and approval surface. For a live standalone organization that connects an ERP later, the ADR-0055 §5A Posture B crossing keeps PMO entry/approval as the source of truth and side-mirrors the approved result.

For a new **Client** company when an ERP owns companies, use `pmo load` with the company in its `companies` list. The loader creates the ERP-owned Client through the same synchronous adapter command as the app and uses the returned PMO company id for the project in that load; do not create a duplicate in the ERP and wait for the hourly sweep. If a command refuses or reports an ambiguous/archived party, resolve it in **Companies**; **Companies → New** remains the immediate app fallback for an approved Client creation. Vendors and other party types stay in their supported ERP/app flow.

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
4. `pmo load` is idempotent for the same source after a completed write: re-running resumes, skips already-loaded rows, and reports conflicts instead of overwriting. If a write's result is unknown because the connection failed, inspect PMO and ERP first. Correct conflicting data in the app, then make a deliberate corrected source file. Do not edit a source row in the hope that an existing project, contract line, or budget line will be overwritten.
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
| Project / contract-line / budget conflict, or `short_name_conflict` | Compare the source with the existing record in the app. Correct there, or choose a unique alias; rerun the unchanged source first to confirm the skip/conflict. |
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

**Goal:** create an organization, its operating currency, and its first Admin together.

**Exact commands:** organization creation is not a `pmo` CLI command. For a deployment that already has an active platform Operator, use the guarded `operator_create_org` RPC. There is no dry-run variant; do not run it until the owner has approved the target and values. The request shape is:

First create the intended Admin's auth user through the approved Auth Admin process, for example `supabase auth-admin invite <admin-email> --project-ref <project-ref>`, and obtain that user's UUID through the authorized admin path. The user must not already have an organization profile.

```bash
curl --fail-with-body -X POST '<approved PMO API URL>/rest/v1/rpc/operator_create_org' \
  -H 'apikey: <publishable key>' \
  -H 'Authorization: Bearer <active Operator session token>' \
  -H 'Content-Type: application/json' \
  --data '{"p_name":"<organization display name>","p_admin_user_id":"<existing auth user UUID>","p_admin_full_name":"<Admin display name>","p_default_currency":"IDR"}'
```

Use the supported provisioning procedure for the first organization on a new deployment; the Operator RPC cannot bootstrap an Operator that does not exist. The intended first Admin's auth user must exist and have no organization profile. Follow [Creating an org (Operator)](../environments.md#creating-an-org-operator--operator_create_org-dd-org-1--484) for prerequisites and companion setup; do not run SQL inserts.

**How to verify:** the RPC returns the new organization UUID. Confirm its Admin membership and currency through the authorized operator read path, then sign in as that Admin and run `node scripts/pmo.mjs whoami`.

**Common errors:** `42501` means the caller is not an active Operator; `23503` means the auth user is unknown; `23505` means the organization name already exists or the user already has a profile; blank required fields and malformed currency are rejected. Each refusal leaves no partial organization. A new deployment without an Operator must use the controlled provisioning procedure.

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

### 3. Load projects with their stage dates

**Goal:** load projects at the correct stage, set contract details, and correct the recorded date of the latest matching stage.

**Exact commands:** prepare the private load file with `projects` entries. Required fields include `name`, `client` (the company's exact legal name), and `stage`. A won-stage project also needs `contract_value`, `tax_treatment`, `tax_amount`, `customer_contract_ref`, and `contract_date` (`YYYY-MM-DD`). Optional contract quantities use `contract_lines` with stable `key`, `item_code`, `description`, `unit`, `quantity`, and `rate`; `basis` may be `unit_rate` or `lump_sum`.

```bash
node scripts/pmo.mjs load <load-file.json> --dry-run
node scripts/pmo.mjs load <load-file.json>
node scripts/pmo.mjs get projects --select id,name,status,client_id --filter name=eq.<project-name>
node scripts/pmo.mjs stages <project-uuid>
```

`pmo load` walks the legal path from `Leads` to the requested stage and writes the contract value through the guarded app RPC. The load's transition dates are load/audit time, not historical pipeline dates. To correct one, inspect the history, then set the date of the most recent matching stage entry:

```bash
node scripts/pmo.mjs stages <project-uuid>
node scripts/pmo.mjs stage-date <project-uuid> "Quotation Submitted" <YYYY-MM-DD>
node scripts/pmo.mjs stages <project-uuid>
```

`stage-date` has no dry-run flag; verify the project and entry first. It selects the latest occurrence of the exact stage label. Older system-dated entries can move with a backdated stage; if the next earlier entry was person-dated and is now after the target date, correct that earlier stage first, then retry. This matches the shipped #1835 command behavior.

**How to verify:** the load output lists created/skipped/conflicting actions. Re-run `pmo stages` after any date change and check stage order and entered dates against the approved chronology.

**Common errors:** a project already moved away from the load file's stage is not moved backward by rerunning the load; use `stages` and the controlled date correction instead. A missing stage label must be copied from `stages` exactly. A win without its contract value, tax treatment/amount, client contract reference, or contract date fails preflight.

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

**Common errors:** fix invalid category/amount in the private file and dry-run again. If an identical budget line is skipped, do not change its amount in the file expecting an overwrite; correct it in the app. If an account map refuses, use **Administration → Accounting setup → Budget account map** to inspect the chart and mappings. Never map a category before reviewing the Draft split: `Special expenses` may be classified into Travel & accommodation or Vehicle by the loader based on its description.

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

Costs the ERP booked as journal entries (no supplier invoice) are listed per project and can be attached to an existing PMO purchase of the same project. Attaching lowers that purchase's open commitment and never changes project spending; nothing is sent to the ERP. Roles: Admin, Executive, Project Manager, Finance. Only lines tagged to the project are listed; a journal PMO posted itself is not. A wrong attach is undone in the app by an Admin or Finance member (no CLI command deletes records).

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

`history.json` is an array of groups, each with a stable `request_id` UUID, `project_id`, `vendor_id`, `title`, optional `reference`, and `journal_lines`. Each line carries the `erp_doctype`, `voucher_no`, `project_id`, and `account` returned by `purchases journals`. A file may contain at most 500 lines. Keep the same request IDs and payloads on retries, including when the response is unknown. The report identifies created, skipped, and refused groups. Undo unlinks the source and cancels the historical wrapper; it does not delete the purchase or change the ERP ledger.

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

**Common errors:** an unknown ERP document or an invalid project/procurement reference is refused by the server. Correct the row using the read result and inspect the existing procurement in **Procurement** before rerunning. In a client with no ERP, create purchases through **Procurement → New**; the CLI does not import PMO-native purchase history yet. Enhancement: [CLI purchase history import](https://github.com/ariefsaid/PMO/issues/1855).

### 7. Time and materials

**Goal:** inspect the rate card, estimate the approved unclaimed hours, and review existing claims.

**Exact commands:**

```bash
node scripts/pmo.mjs tm rates list --project <project-uuid> --assignees --json
node scripts/pmo.mjs tm claim preview --project <project-uuid> --from <YYYY-MM-DD> --to <YYYY-MM-DD> --json
node scripts/pmo.mjs tm claim list --project <project-uuid> --json
```

The preview is read-only and shows priced hours, unrated hours and the total. The CLI cannot author timesheets, change rates, prepare/sign off a T&M claim, or invoice one. Use **Timesheets** for time entry and approval, then open **Project → Contract & billing → Time and materials** for claim preparation, review and invoicing.

**How to verify:** confirm the preview's dates and project, resolve every unrated row in the rate card, then compare `claim list` with the app's T&M panel. After a user completes an app action, rerun the relevant read command.

**Common errors:** the range must be valid and no longer than two years. A rate-card read refusal means the current role or CLI API-client tier does not allow that read; use the app with an authorized role. Enhancement: [CLI T&M entry and claim workflow](https://github.com/ariefsaid/PMO/issues/1856).

### 8. Documents

**Goal:** inspect the project register and attach an existing Microsoft 365 item to the right PMO record.

**Exact commands:**

```bash
node scripts/pmo.mjs documents list --project <project-uuid>
node scripts/pmo.mjs m365 status
node scripts/pmo.mjs documents link <document-links.json> --dry-run
node scripts/pmo.mjs documents link <document-links.json>
```

Each JSON row names exactly one `project_id`, `budget_version_id`, or `procurement_id`, plus `drive_id`, `item_id`, `web_url`, `name`, and `kind` (`file` or `folder`). The CLI links an existing Microsoft 365 item; it does not create a document-register entry or upload the file. Create/upload/register it in the relevant **Project → Documents** screen, or use the matching Procurement or Budget source-link action. Enhancement: [CLI document register and upload](https://github.com/ariefsaid/PMO/issues/1857).

**How to verify:** read the register again with `documents list` and confirm the expected row and source; confirm `m365 status` reports the expected connection before linking.

**Common errors:** the link must target exactly one record type and identify a file or folder. If the M365 item does not exist or is in the wrong library, correct it in **Project → Documents** or the library before rerunning. Same-item links are idempotent.

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

### 10. Correcting data after a load

**Goal:** repair a specific mismatch without creating duplicate projects, lines, or versions.

**Exact commands:** first repeat the original source file as a dry-run and save the output privately:

```bash
node scripts/pmo.mjs load <original-load.json> --dry-run
node scripts/pmo.mjs get projects --select id,name,short_name,status,contract_value --filter id=eq.<project-uuid>
node scripts/pmo.mjs stages <project-uuid>
node scripts/pmo.mjs get budget_versions --select id,project_id,version,name,status --filter project_id=eq.<project-uuid>
node scripts/pmo.mjs get budget_line_items --select id,budget_version_id,category,description,budgeted_amount,fiscal_year --filter budget_version_id=eq.<draft-version-uuid>
```

`pmo load` intentionally skips matching rows and never overwrites project fields, contract lines, or loaded budget lines. Use **Project header → Edit** for editable project fields, **Project → Contract & billing** for contract quantities, **Project → Budget** for Draft line corrections, and **Companies** for party corrections. If the historical stage date is wrong, use the stage-date sequence in recipe 3. If an already loaded contract-line value must be changed, use **Project → Contract & billing** and file [CLI correction of loaded records](https://github.com/ariefsaid/PMO/issues/1858).

After the app correction, rerun the original load with `--dry-run`; verify it plans no duplicate and reports existing rows as skipped. Do not delete and reload records to force a correction.

**How to verify:** inspect the repaired record in the named app screen and compare the new `pmo load --dry-run` output to the original input. Verify the affected version/project IDs, values, and stage history.

**Common errors:** if the dry-run still reports a different stored value, check that the app save completed and that you selected the correct record ID. A contract-line `skip` means the stable key already exists; it does not mean the line's amount or rate was updated. A budget-line identity conflict needs review of both source and Draft in **Project → Budget** before any further import.

## Command scope and current constraints

The full shipped command list and flags are printed by `node scripts/pmo.mjs --help`. Generic `get`, `create`, `update`, and `rpc` are constrained by closed table/RPC allow-lists; do not treat them as arbitrary access. Generic `create` and `update` do not offer `--dry-run`; use an app workflow for a write that must be previewed first. `pmo load`, `purchases link`, `purchases set-aside`, `purchases attach-journals`, `purchases record-only`, `purchases undo-record-only`, `purchases receive`, `documents link`, `accounts map set`, and `attribution set` do support previews. No command deletes records.

The CLI does not create an ERP company directly as a separate ad hoc step, activate a budget, author T&M data, upload a document, or overwrite a loaded project/contract/budget line. Use the recipes above for their app screens and tracked enhancements: [budget activation](https://github.com/ariefsaid/PMO/issues/1859), [T&M operations](https://github.com/ariefsaid/PMO/issues/1856), [document register and upload](https://github.com/ariefsaid/PMO/issues/1857), [purchase history import](https://github.com/ariefsaid/PMO/issues/1855), and [loader corrections](https://github.com/ariefsaid/PMO/issues/1858).
