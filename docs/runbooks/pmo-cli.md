# PMO command-line client (`scripts/pmo.mjs`)

**Purpose:** read, create and update PMO records from a terminal — by the owner, or by Claude Code on
the owner's machine — signed in **as the owner**. Issue #728; decisions DD-API-1/2/3 in
`docs/decisions.md`.

**How it signs in:** through Supabase Auth's OAuth 2.1 server (authorization code + PKCE S256, a
pre-registered public client, loopback redirect). The token it holds is an ordinary user session
token, so row-level security treats every CLI call exactly like the same user in the browser. The CLI
never uses a service-role key.

**Requirements:** Node 22 (standard library only — no `npm install`).

---

## 1. One-time setup

### Local stack

`supabase/config.toml` enables the OAuth server (`[auth.oauth_server] enabled = true`, consent screen at
`/oauth/consent`). Register the CLI's client once:

```bash
eval "$(supabase status -o env | grep -E '^(API_URL|SERVICE_ROLE_KEY|ANON_KEY)=')"
SUPABASE_URL="$API_URL" SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" node scripts/register-oauth-client.mjs
# → { "created": true, "client_id": "…", "client_name": "PMO CLI", "redirect_uris": [ … ] }
```

It is idempotent (an existing "PMO CLI" client is reported, not duplicated). The client id is not a
secret — a public client has none.

### Hosted project — owner-gated

Enabling the OAuth server on the hosted project and registering the client there is an
**infrastructure change that needs the owner's explicit go-ahead** (DD-API-2). The steps, once approved:
enable the OAuth 2.1 server in the project's Auth settings with the authorization path
`/oauth/consent` (dynamic client registration stays off), deploy an app build that contains the
consent route, then run the registration script with the hosted URL and `--hosted`. The script refuses
a non-local URL without that flag, and refuses to reuse an existing client of the same name unless it
is the public client with exactly the CLI's loopback redirects.

Migration `0222` installs the API-client guard as PostgREST's pre-request function, as in-database
configuration on the `authenticator` role. After pushing it, confirm on the hosted project that the
setting took effect: with a CLI token, a request outside the surface (e.g. a `DELETE`) must answer
`403` / `42501`, and the app must work as before.

Recommended with it (owner-gated Auth setting): a session time-box and an inactivity timeout, so a CLI
sign-in that is no longer used expires on its own.

### Environment

| Variable | Meaning | Default |
|---|---|---|
| `PMO_SUPABASE_URL` | Supabase project URL (`--url`) | `http://127.0.0.1:54321` (local stack) |
| `PMO_SUPABASE_KEY` | the project's publishable (anon) key (`--key`) | the key saved by `pmo login` (set it once at login; later calls need no env var); secret keys (`sb_secret_…`, or a JWT with role `service_role`) are refused and never saved |
| `PMO_CLIENT_ID` | the registered client id (`--client-id`), needed for `login` | none |
| `PMO_CONFIG_DIR` | where credentials are stored | `~/.config/pmo` |

A remote URL must be `https`; plain `http` is accepted only for the local stack.

---

## 2. Sign in and out

```bash
node scripts/pmo.mjs login       # prints a sign-in URL and opens the browser
node scripts/pmo.mjs whoami      # → { id, email, full_name, role, status }
node scripts/pmo.mjs logout      # ends THIS session only; browser sessions stay signed in
```

Logout revokes the refresh token at once; an access token already issued expires within the hour
(standard token behaviour). If the stored access token has expired, logout refreshes it first so the
revoke is authenticated. If the server does not confirm the revoke, the credentials are kept and the
command fails — run it again.

`login` listens on `127.0.0.1` for the browser's return, on the first free port of a small fixed set
(Supabase matches redirect URIs exactly, so the ports are registered with the client). The browser
shows PMO's consent screen — the client's name and the account you are signed in as — and you choose
**Allow** or **Deny**. It times out after 5 minutes (`--timeout <seconds>`); `--no-browser` only prints
the URL.

If the browser is signed out, the consent screen sends you to the sign-in page and brings you back
after a **password** sign-in. Microsoft and magic-link sign-in leave the page, so the consent request
is lost: sign in to PMO in the browser first, then run `pmo login`.

Tokens are stored in `~/.config/pmo/credentials.json`, keyed by Supabase URL, owner-only (file `0600`,
directory `0700`). An expired access token is refreshed automatically; each refresh issues a new
refresh token, which replaces the old one. If a refresh is refused (signed out elsewhere, account
disabled), the CLI says so — run `pmo login` again.

---

## 3. Commands

Output is JSON on stdout. Errors are JSON on stderr: `{"error":{"message", "code", "status", …}}`.
Exit `0` = done, `1` = the server refused or failed, `2` = the CLI refused before sending anything.

```bash
# read
pmo get projects --select id,name,status --filter status=eq.Leads --limit 20
pmo get companies --select id,name --filter name=ilike.*Steel*
pmo get tasks --filter project_id=eq.<uuid> --filter archived_at=is.null
pmo get profiles --filter role=eq.Engineer      # people, for project_manager_id / assignee_id
pmo get budget_line_items --filter budget_version_id=eq.<uuid>   # read-only: ids for re-categorising; also budget_versions, budget_category_account_map, erp_gl_entry_mirror, project_documents
pmo rpc project_mapped_actuals '{"p_project_id":"<uuid>"}'      # read-only, Admin/Executive/PM/Finance tokens

# create — inline JSON, @file, or - for stdin; one object or a list
pmo create companies '{"name":"Solaris Grid EPC","type":"Client"}'
pmo create projects '{"name":"Depot Expansion","status":"Leads","client_id":"<company uuid>"}'
pmo create project_milestones @milestones.json
cat tasks.json | pmo create tasks -

# update — at least one --filter; one object
pmo update projects --filter id=eq.<uuid> '{"name":"Depot Expansion Phase 1"}'

# rpc — allow-listed read helpers, plus the active-Admin tier
pmo rpc get_project_milestones '{"p_project_id":"<uuid>"}'
pmo rpc recategorise_budget_lines '{"p_line_ids":["<line uuid>","<line uuid>"],"p_category":"Vehicle"}'
```

(`pmo` = `node scripts/pmo.mjs`.) Filters are PostgREST filters: `col=op.value` with `eq neq gt gte lt
lte like ilike match imatch is isdistinct in cs cd ov fts plfts phfts wfts`, optionally `not.`-prefixed.
`--select` takes `*` or plain column names (no embedded tables). `update` reports an error when no row
changed — none matched, or the database did not let you change it.

**What the CLI offers (DD-API-3):**

- Tables: `projects`, `project_milestones`, `tasks`, `meetings`, `crm_activities`, `companies`,
  `contacts`.
- Read-only: `profiles`, limited to `id, full_name, role, title, status` (the default `--select`; a
  narrower one is allowed, and filters are limited to the same columns). Change people in the app.
  Also read-only: `external_domain_ownership` (`domain, external_tier`).
- RPCs: `get_project_milestones`.
- **Active Admin RPCs** (#1326): `recategorise_budget_lines` moves Draft "Special expenses" budget lines to
  `Travel & accommodation` or `Vehicle`, one or many per call, all or nothing. It refuses a line on an
  Active or Archived budget, and returns how many lines moved. It takes line ids; `pmo get` does not list
  budget lines (AC-CSD-016), so the ids come from outside the CLI.
- **`pmo load`** (active Admin only, ADR-0074): companies, projects at their real stage with contract
  value, draft budgets and contract lines from one JSON file. It alone uses `set_project_contract_value`,
  `transition_project`, `budget_versions`, `budget_line_items`, `boq_items`; `rpc` / `create` refuse them.
- **`pmo purchases`** (active Admin, Executive, Project Manager or Finance; #1319, migration `0363`): reads
  the ERP orphan list (`erp_purchase_orphans`) and links ERPNext purchase documents and SharePoint items
  into purchases through `link_erp_purchase_documents` and `link_procurement_sharepoint_item` (§5).
  Unlinking stays in the app. Admin and Finance tokens also set documents aside as overhead with
  `mark_erp_purchase_documents` and read `erp_purchase_orphans_all` (migration `0364`, §5).
- **No delete.** Archive or delete in the app.
- **No `contract_value`** in any payload, **no project status change**, **no `archived_at`** (archive and
  restore in the app), and a project can only be created as `Leads` or `Internal Project`. Moving a project through its stages, contract values, work orders,
  budget activation and every money action stay in the app.

⚑ **What the database enforces, and what it does not.** A token issued to an OAuth client carries a
`client_id` claim. On the **REST API**, PostgREST's pre-request guard (`public.api_client_request_guard`,
migration `0222`) restricts which endpoints and methods such a token may call: GET on the table
endpoints above, POST/PATCH on the writable ones, POST on the RPCs. Any other endpoint or method is
refused with `42501`. The guard governs the endpoint called, not what a read returns: an embedded read
(`select=id,related(...)`) follows row-level security exactly as it does in the browser. Browser
sessions carry no `client_id` and are unaffected. Row-level security, column grants and the
security-definer RPCs decide every read and write exactly as in the app.

**The guard covers the REST API only.** Edge functions and Storage accept a client token with the
user's normal permissions. That is acceptable for this tool, which the owner runs as the owner. It must
be closed before any client used by someone other than the owner, or an MCP client, is offered. The CLI checks the same lists first, so it can
explain a refusal before anything is sent; `scripts/pmo.test.mjs` fails if the CLI's lists and the
migration's drift apart. The field-level refusals (`contract_value`, project status, `archived_at`)
are checked by the CLI; contract value and status are also column-restricted in the database. A refusal from the database comes back verbatim (e.g. `42501`, "new row
violates row-level security policy").

---

## 4. Seeding a client's starting data — `pmo load`

1. In the app (Admin): configure classification options (service lines, sectors). If ERPNext owns
   companies, create every missing company first — in the app (Companies → New, pushed to ERPNext)
   or as a Customer in ERPNext — and wait for it to appear in PMO.
2. Claude writes the load file (spec §2) **outside the repository** from the client's spreadsheets.
   For contract quantities, convert each project's price sheet or SPK (the contractual service list)
   into `projects[].contract_lines[]`: one row per item with a stable `key` (e.g. the sheet's row id),
   the ERP service `item_code` (required), `description`, `unit`, `quantity`, `rate`, optional `line_no`
   and `basis`. Lump-sum units (`lot`, `ls`, `lump sum`) default to `lump_sum` and need quantity 1.
   Generic shape: `{"key":"L-001","item_code":"SVC-001","description":"Survey service","unit":"m2","quantity":100,"rate":25000}`.
3. `node scripts/pmo.mjs load <file.json> --dry-run` — fix every problem it lists; read the plan
   (`contract_line.create` / `contract_line.skip` per line).
4. `node scripts/pmo.mjs load <file.json>` — companies → projects (Leads → value → stage) → draft
   budgets → contract lines. On exit 1, read `details.failed`, fix the cause, run it again: it resumes.
   Since #1326, a `Special expenses` line whose description names travel, hotel, tickets or per diem is
   written as `Travel & accommodation`, and one naming a vehicle (or fuel with a vehicle or rental) as
   `Vehicle` (a line naming both travel and a vehicle or fuel stays `Special expenses`). Its key still uses the file's category, so re-running an older file over a
   Draft it already loaded adds nothing; move those older lines with `recategorise_budget_lines`.
   Fuel with no vehicle word (e.g. "BBM genset") stays `Special expenses`; the output lists every line whose
   category the loader decided (`budget.category`: row, from, to).
   ⚑ Order of the switch-over: activate the split Draft budget (with its Travel & accommodation and Vehicle lines) before the new accounts are mapped or posted to. Otherwise budget-vs-actual shows the reclass window as unbudgeted: actuals land in the new categories while the Active budget still holds that money under Special expenses.
5. In the app: review and activate each draft budget; link each project to its ERP project (#772);
   work orders are created by the client's users.

Re-runs never overwrite: a different stored value, stage or short name is reported, not changed. A
contract line whose `key` already exists is skipped even if its quantity or rate in the file differs
(`contract_line.skip`): correct it in the app (Billing). The load never creates work-order allocations
or acceptances (BAST) — those are made in the app.
Milestones, tasks, meetings and CRM activities still use `create` (§3).

---

## 5. Loading purchase history — `pmo purchases`

ERPNext purchase documents (Purchase Order, Purchase Receipt, Purchase Invoice, Payment Entry) reach PMO
through the sweep and appear as **orphans** until linked to a purchase. Linking writes nothing to
ERPNext; a linked document is never pushed. Documents authored in PMO (which push to ERPNext) are made in
the app, not here.

```bash
node scripts/pmo.mjs purchases orphans [--project <project id>] [--limit n]   # unlinked, submitted ERP documents (set-aside ones hidden)
node scripts/pmo.mjs purchases orphans --include-set-aside                    # the same list with the set-aside ones, flagged
node scripts/pmo.mjs purchases set-aside overhead.csv --dry-run               # Admin/Finance: mark documents as not a project purchase
node scripts/pmo.mjs purchases set-aside overhead.csv [--undo]                # the same checks, for real; --undo brings them back
node scripts/pmo.mjs purchases link history.csv --dry-run                     # ALWAYS first: what would happen
node scripts/pmo.mjs purchases link history.csv                               # the same checks, for real
node scripts/pmo.mjs purchases link-file '{"procurement_id":"…","item":{…}}'  # one SharePoint item on a purchase
```

**The link file** is JSON (a list of row objects) or CSV (`.csv`, or `--csv` for stdin `-`) with this header:

```
erp_doctype,erp_name,procurement_id,project_id,group,title,budget_category,sp_drive_id,sp_item_id,sp_web_url,sp_name,sp_kind
```

- `erp_name` (required): the ERPNext document number. `erp_doctype` is needed only when two document types
  share the number.
- `procurement_id` **or** `project_id`, not both. A row naming a purchase links into it. A row naming a
  project (or nothing) creates a new Draft purchase from the document (title = `title`, else
  "<supplier> <document number>"); rows sharing a `group` and project go into one new purchase.
- `sp_*` (optional, all five together): a SharePoint item the operator already has the ids for — drive id,
  item id, web URL, name, and `sp_kind` `file` or `folder`. It is attached to that document on the purchase.
  A folder is linked as a folder. The CLI does not resolve URLs.
- In JSON the SharePoint item is `"sharepoint": {"drive_id","item_id","web_url","name","kind"}`.

**Dry run first, always.** `--dry-run` sends the identical rows to the same database function with
`p_dry_run = true`: every check runs and each call is rolled back, so nothing is written. The report lists
every row as `link`, `skip` or `refused` with a reason, plus counts; a new purchase shows
`procurement_id: null` in a dry run. Fix the refused rows, dry-run again, then run without `--dry-run`. The
real run reports the same outcomes.

**Batches and groups.** Rows go to the database in calls of at most 500. Rows that make one new purchase (same
project and `group`) always travel in the same call, so **one group must have 500 rows or fewer**; a larger
group is refused before anything is sent. Row numbers in the report are always the file's.

**The CLI refuses the file, sending nothing (exit 2), when:** a CSV column is not one of the header names above
(a misspelt `procurement_id` would otherwise create a new purchase); a CSV row has more cells than the header;
a quote is not closed; a JSON row has a field not in the header; `erp_name` is missing; a row names both
`procurement_id` and `project_id`; a SharePoint item is incomplete; **the same ERP document is listed twice**;
or a group exceeds 500 rows. Every problem is listed.

**Exit codes.** Exit 0: every row linked or skipped (or any dry run that completed). Exit 1: a real run refused at
least one row, or a call failed. The report is printed either way. When a call fails, the report holds what the
earlier calls saved, plus `failed_at_row` (the first row of the failed call), `not_saved_rows` and `error`; the
failed call itself saved nothing.

**Re-running is safe.** After fixing refused rows (or after a failed call), run the whole file again: rows already
linked report `skip` / `already_linked` with their purchase id, and only the rest are linked.

**Reason codes** (`refused`):

| Reason | Meaning |
|---|---|
| `erp_name_missing` | the row has no document number |
| `document_not_found` | no such ERP document mirrored in PMO for your organisation |
| `document_ambiguous` | the number matches more than one document type — add `erp_doctype` |
| `document_cancelled` | the document is cancelled in ERPNext |
| `document_recorded_by_pmo` | PMO pushed it; it is already a PMO record |
| `document_linked_to_another_purchase` | it already belongs to a different purchase |
| `purchase_not_found` / `purchase_closed` | the purchase does not exist in your organisation, or is Cancelled / Rejected |
| `project_not_found` | the project does not exist in your organisation |
| `invalid_id` | an id is not a valid uuid |
| `supplier_mismatch` / `project_mismatch` / `currency_mismatch` | the document's supplier, project or currency differs from the purchase |
| `gate_request_before_order`, `gate_approval_before_order`, `gate_receipt_before_invoice`, `gate_approval_before_payment` | an organisation procurement gate refuses that step |
| any other sentence | a guard refused the resulting status (e.g. "separation of duties: approver cannot pay own procurement") |


**Setting overhead aside** (Admin and Finance only). Rent, insurance, cloud and similar invoices never join a
project purchase; set them aside so the orphan list shows only what still needs a home. The file is JSON or CSV
with the header `erp_doctype,erp_name,note` (`erp_doctype` and `note` optional; `note` is up to 500 characters and
is kept when a document is set aside or brought back). Setting aside changes nothing in ERPNext or in actuals, can
be undone (`--undo`; a note is refused with `--undo`), and a document that is later linked leaves the set-aside
list. `--dry-run` runs the same checks and writes nothing. The file is refused (exit 2) for the same reasons as a
link file: unknown column or field, a ragged CSV row, an unclosed quote, a missing `erp_name`, a document listed
twice. Extra reason codes: `document_linked` (already in a purchase; unlink it in the app first), `note_too_long`,
`note_invalid`; a row that changes nothing is reported `skip` / `no_change`. Counts are `apply`, `skip`, `refused`.
A note without setting aside is a screen feature (the database function supports it); the CLI sets notes only with set-aside.

---

## 6. ERP setup reads — `pmo erp`

```bash
node scripts/pmo.mjs erp readiness
node scripts/pmo.mjs erp list-projects
node scripts/pmo.mjs erp verify-links
```

These call the existing `external-set-company` ERP setup actions using the signed-in user token (Admin only, as in the app); no ERP credentials are read or printed by the CLI. `readiness` reports setup gaps, `list-projects` lists active ERP projects for the connected company, and `verify-links` compares PMO project names/codes against that list and prints mismatches. Exit 0 means the call completed (mismatches are report data); a server refusal exits 1.

## 7. Project documents — `pmo documents`

```bash
node scripts/pmo.mjs documents list --project <project-id>
node scripts/pmo.mjs documents link links.json --dry-run
node scripts/pmo.mjs documents link links.csv
```

Link input is a JSON array or CSV with columns `project_id,budget_version_id,procurement_id,drive_id,item_id,web_url,name,kind`. Each row names exactly one target id; `kind` is `file` or `folder`. `--dry-run` uses the same org-, role- and reference-validation RPC as a real run and returns its validation plan without writes. Active Admin, Executive, Project Manager and Finance memberships can link; unlinking stays in the app. Every `web_url` must be on the organisation's own SharePoint host (taken from its default library); an organisation with no default library is refused with `m365_not_configured`. A folder already linked to another project or purchase is refused. Link files are limited to 500 rows per call.

## 8. Microsoft 365 setup — `pmo m365 status`

```bash
node scripts/pmo.mjs m365 status
```

Reports the configured default library, the caller's Microsoft connection status, and the latest `Link existing folders` sweep state, counts and unmatched record ids. Sweep summaries accumulate across pages and are scoped to the organization; the stored unmatched list is de-duplicated and capped at 500 (`unmatched_truncated` says when it was cut). A page whose summary could not be saved still succeeds and carries `summary_warning`.

## 9. For Claude Code

- Run `node scripts/pmo.mjs whoami` first; if it says "Not signed in", ask the owner to run
  `node scripts/pmo.mjs login` — never try to sign in on their behalf.
- Read before you write: `get` with a name filter, and skip rows that already exist.
- Create in the order above; use the ids returned by `create` (it echoes the created rows).
- Do not create companies or contacts for an organization whose ERP owns them (RIS): look them up
  with `get` and use their ids; if one is missing, tell the owner — it comes from ERPNext.
- Treat exit `1` as the database's answer — report it, do not retry around it. Treat exit `2` as a
  closed door: the action belongs in the app.
- There is no delete. If something was created by mistake, tell the owner.
