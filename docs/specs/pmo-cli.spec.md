# Spec: PMO command-line client, signed in as the user (issue #728)

> **Status:** Built — 2026-09-30. Extended by `client-starting-data-cli.spec.md` (#796, `pmo load`). Decisions: DD-API-1 (the existing REST + RPC surface is the API),
> DD-API-2 (Supabase OAuth 2.1 server, PKCE, pre-registered public client, loopback redirect), DD-API-3
> (what outside callers may write first; seeding order). Runbook: `docs/runbooks/pmo-cli.md`.
>
> **Scope:** OAuth server enabled locally; the app's consent route `/oauth/consent`; a one-time client
> registration script; the CLI (`scripts/pmo.mjs`); the REST-API guard for OAuth client tokens
> (migration `0222`). **Out of scope:** spreadsheet parsing and matching (Claude does that), deletes,
> contract values, status transitions, budget activation, money RPCs, an MCP server, and enabling the
> OAuth server on the hosted project (owner-gated).

## 1. Job story

When I prepare a client's starting data, I want Claude on my machine to read and write PMO records
**as me**, so nothing is retyped and nothing bypasses the permissions a normal user has.

## 2. Functional requirements (EARS)

- **FR-CLI-001** When the user runs `pmo login`, the CLI shall sign in through Supabase's OAuth 2.1
  server using the authorization-code grant with PKCE S256, a random `state`, and a loopback redirect to
  `127.0.0.1` on one of the registered ports.
- **FR-CLI-002** The CLI shall call PMO only with the user's own session token and never with a
  service-role key.
- **FR-CLI-003** The CLI shall store tokens in `~/.config/pmo/credentials.json`, keyed by Supabase URL,
  with file mode `0600` in a `0700` directory.
- **FR-CLI-004** When the stored access token is expired or rejected, the CLI shall refresh it and
  persist the rotated refresh token before continuing.
- **FR-CLI-005** When the user runs `pmo logout`, the CLI shall revoke this session on the server (after
  refreshing an expired access token) and then remove it locally; if the server does not confirm the
  revoke, the CLI shall keep the credentials and fail.
- **FR-CLI-006** The CLI shall offer `get`, `create`, `update` and `rpc` only on the DD-API-3
  allow-lists: tables `projects`, `project_milestones`, `tasks`, `meetings`, `crm_activities`,
  `companies`, `contacts`; read-only `profiles` limited to `id, full_name, role, title, status`; RPC
  `get_project_milestones`. It shall offer no delete.
- **FR-CLI-007** If a write payload sets `contract_value` or `archived_at`, changes a project's `status`,
  or creates a project in a status other than `Leads` / `Internal Project`, then the CLI shall refuse it
  before sending anything.
- **FR-CLI-008** The CLI shall print results as JSON on stdout and errors as JSON on stderr, passing the
  database's refusal through verbatim.
- **FR-CLI-009** When Supabase sends the browser to `/oauth/consent`, the app shall show the requesting
  client's name and the signed-in account, in English and Bahasa Indonesia, and relay Allow / Deny.
- **FR-CLI-010** While the browser is signed out, the consent route shall send the user to `/login` and,
  after a password sign-in, back to the consent screen.
- **FR-CLI-011** While a REST request's token carries a `client_id` claim, the database shall allow only
  GET on the allow-listed table endpoints, POST/PATCH on the writable ones and POST on the allow-listed
  RPCs, in the `public` schema, and refuse every other endpoint or method with `42501`. Requests without
  `client_id` shall be unaffected. (Embedded reads follow RLS, as in the browser. The guard covers the
  REST API only; edge functions and Storage are to be closed before any non-owner or MCP client.)
- **FR-CLI-012** The app shall refuse to be displayed inside a frame on any page.
- **FR-CLI-013** When the CLI handles a loopback sign-in callback, it shall render a static English PMO-styled HTML page with inline CSS; the success page shall identify the signed-in account by email and explain that the page is served by the PMO command-line tool on this computer, while denied, expired or incomplete, and state-mismatch callbacks shall show a clear error; every dynamic value inserted into the page shall be HTML-escaped.

## 3. Acceptance criteria (Given / When / Then)

- **AC-CLI-001** Given a registered CLI client and a signed-in user, when they run `pmo login` and
  approve, then `whoami` reports that user and role, and a project + milestone created with the CLI land
  in the database in the user's organization.
- **AC-CLI-002** Given a user whose role may not write milestones, when they create one with the CLI,
  then the database refuses it (`403` / `42501`) and no row exists.
- **AC-CLI-003** Given a signed-in CLI user who is then banned, when they write, read or refresh, then
  the write is refused (`42501`), the read returns nothing, and the refresh is refused (`user_banned`).
- **AC-CLI-004** Given a signed-in CLI user with an expired access token, when they run `pmo logout`,
  then the CLI refuses further calls ("not signed in"), the old refresh token is refused (`400`) and the
  old session is refused (`403`).
- **AC-CLI-005** Given a stored session whose access token has expired, when any command runs, then it
  succeeds after a transparent refresh and the rotated refresh token is saved (file still `0600`).
- **AC-CLI-006** Given a consent request, when the consent screen loads, then it shows the client name,
  the signed-in account, Allow and Deny (and, for a loopback redirect, that the answer returns to a
  program on this computer), in `en` and `id`; loading, already-approved, error and incomplete-link
  states behave, and each request is read exactly once.
- **AC-CLI-007** Given the CLI, when the user asks for any delete verb, then it refuses with "offers no
  delete" and sends no request.
- **AC-CLI-008** Given `pmo login`, when the browser returns, then only a callback to the exact loopback
  host with the matching state completes the login (others get `400` and are ignored); the code is
  exchanged with the PKCE verifier; the login times out if nothing returns; remote URLs must be https;
  redirects are never followed; the registration script creates or reuses only the public loopback client.
- **AC-CLI-009** Given the CLI, when a table or RPC outside the allow-lists is named, then it is refused
  before any request.
- **AC-CLI-010** Given a write payload with `contract_value`, `archived_at`, a project status change or a
  non-origination project status, when it is sent, then the CLI refuses it before any request.
- **AC-CLI-011** Given the CLI writes credentials, then the file is `0600` and its directory `0700`, even
  if they existed with looser modes.
- **AC-CLI-012** Given a signed-out browser at `/oauth/consent?authorization_id=…`, when the user signs in
  with a password, then they return to that exact consent URL; unsafe return targets fall back to `/`.
- **AC-CLI-013** Given `--select`, `--filter` and `--limit`, when `get` / `update` run, then they become
  the matching PostgREST query; malformed filters, embeds in `--select` and reserved parameters are
  refused; `update` without a filter is refused and a zero-row update is an error.
- **AC-CLI-014** Given `profiles`, when read with the CLI, then only `id, full_name, role, title, status`
  can be selected or filtered on, and create / update are refused.
- **AC-CLI-015** Given a REST request whose token carries `client_id`, when it calls an endpoint or
  method outside the surface (incl. DELETE, PUT, other schemas), then the database refuses it with
  `42501`; the same request without `client_id` passes; the CLI's lists equal the migration's.
- **AC-CLI-016** Given the deployed app, when any page is requested, then it carries
  `Content-Security-Policy: frame-ancestors 'none'` and `X-Frame-Options: DENY`.
- **AC-CLI-017** Given a user completing `pmo login`, when the loopback callback succeeds, then its static PMO-styled page names the signed-in email and explains that it is served by the command-line tool on this computer; when sign-in is denied, expired or incomplete, or the callback state mismatches, then the page clearly explains the error; query and account values are rendered as escaped text so script-shaped input remains inert.

## 4. Traceability

| AC | Owning layer | Owning test |
|---|---|---|
| AC-CLI-001 | E2E | `pmo-portal/e2e/AC-CLI-001-cli-oauth-login.spec.ts` › AC-CLI-001 |
| AC-CLI-002 | E2E | same file › AC-CLI-002 (unit: `scripts/pmo.test.mjs` passthrough) |
| AC-CLI-003 | E2E | same file › AC-CLI-003 |
| AC-CLI-004 | E2E | same file › AC-CLI-004 (unit: `scripts/pmo.test.mjs` logout cases) |
| AC-CLI-005 | E2E | same file › AC-CLI-005 (unit: `scripts/pmo.test.mjs` refresh cases) |
| AC-CLI-006 | Unit (Vitest) | `pmo-portal/src/auth/OAuthConsentPage.test.tsx`, `oauthConsent.test.ts` |
| AC-CLI-007 | Unit (node:test) | `scripts/pmo.test.mjs` |
| AC-CLI-008 | Unit (node:test) | `scripts/pmo.test.mjs`, `scripts/register-oauth-client.test.mjs` |
| AC-CLI-009 | Unit (node:test) | `scripts/pmo.test.mjs` |
| AC-CLI-010 | Unit (node:test) | `scripts/pmo.test.mjs` |
| AC-CLI-011 | Unit (node:test) | `scripts/pmo.test.mjs` |
| AC-CLI-012 | Unit (Vitest) | `pmo-portal/src/auth/RequireAuth.test.tsx`, `LoginPage.test.tsx` |
| AC-CLI-013 | Unit (node:test) | `scripts/pmo.test.mjs` |
| AC-CLI-014 | Unit (node:test) | `scripts/pmo.test.mjs` (real-schema read in the AC-CLI-001 e2e) |
| AC-CLI-015 | Integration (pgTAP) | `supabase/tests/api_client_request_guard.test.sql` (list sync: `scripts/pmo.test.mjs`; live check in the AC-CLI-001 e2e) |
| AC-CLI-016 | Unit (Vitest) | `pmo-portal/test/securityHeaders.test.ts` |
| AC-CLI-017 | Unit (node:test) | `scripts/pmo.test.mjs` |

CI: the node tests run in `verify` ("PMO CLI tests"); Vitest in `verify`; pgTAP and e2e in their lanes.
