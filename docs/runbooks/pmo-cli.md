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
| `PMO_SUPABASE_KEY` | the project's publishable (anon) key (`--key`) | none — required |
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

# create — inline JSON, @file, or - for stdin; one object or a list
pmo create companies '{"name":"Solaris Grid EPC","type":"Client"}'
pmo create projects '{"name":"Depot Expansion","status":"Leads","client_id":"<company uuid>"}'
pmo create project_milestones @milestones.json
cat tasks.json | pmo create tasks -

# update — at least one --filter; one object
pmo update projects --filter id=eq.<uuid> '{"name":"Depot Expansion Phase 1"}'

# rpc — allow-listed read helpers only
pmo rpc get_project_milestones '{"p_project_id":"<uuid>"}'
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
- **`pmo load`** (active Admin only, ADR-0074): companies, projects at their real stage with contract
  value, and draft budgets from one JSON file. It alone uses `set_project_contract_value`,
  `transition_project`, `budget_versions`, `budget_line_items`; `rpc` / `create` refuse them.
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
3. `node scripts/pmo.mjs load <file.json> --dry-run` — fix every problem it lists; read the plan.
4. `node scripts/pmo.mjs load <file.json>` — companies → projects (Leads → value → stage) → draft
   budgets. On exit 1, read `details.failed`, fix the cause, run it again: it resumes.
5. In the app: review and activate each draft budget; link each project to its ERP project (#772);
   work orders are created by the client's users.

Re-runs never overwrite: a different stored value, stage or short name is reported, not changed.
Milestones, tasks, meetings and CRM activities still use `create` (§3).

---

## 5. For Claude Code

- Run `node scripts/pmo.mjs whoami` first; if it says "Not signed in", ask the owner to run
  `node scripts/pmo.mjs login` — never try to sign in on their behalf.
- Read before you write: `get` with a name filter, and skip rows that already exist.
- Create in the order above; use the ids returned by `create` (it echoes the created rows).
- Do not create companies or contacts for an organization whose ERP owns them (RIS): look them up
  with `get` and use their ids; if one is missing, tell the owner — it comes from ERPNext.
- Treat exit `1` as the database's answer — report it, do not retry around it. Treat exit `2` as a
  closed door: the action belongs in the app.
- There is no delete. If something was created by mistake, tell the owner.
