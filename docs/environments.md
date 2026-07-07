# Environments & Supabase CLI hygiene

The binding rules live in `CLAUDE.md` (§ Supabase environments). This is the **full reference + registry**.
Mental model: **one source of truth = `supabase/migrations/` + `seed.sql` (in git); each environment is just a
different connection target** for that same schema.

## Topology (current)

- **`local`** = where you develop **and test** — the Docker stack (`supabase start` / `supabase db reset`).
  Its keys are the well-known local dev keys (not secret).
- **`prod`** = the **Supabase Cloud** project — **reclassified STAGING/DEMO (owner, 2026-07-04):** it is
  the demo/staging instance, NOT where paying clients will live. The env label + `db-push-prod.sh` script
  names are kept for continuity; treat "prod" in tooling as "the hosted staging project". Its DB connection
  string is a **secret, stored in 1Password** (vault `AS`).
- **Real production (GTM)** = per-client environments, topology being decided 2026-07-04 (candidates:
  per-client Supabase Cloud Pro projects + CF Pages, vs self-hosted VPS compose stacks). Recorded here +
  ADR once locked.
- **`selfhost`** (later) = a VPS Docker Supabase — a future target with the same schema.
- A separate **hosted `test`/staging** project is not used yet; `scripts/db-push-test.sh` + `supabase/op.test.env`
  are dormant forward-compat for when one is added.

## Registry (fill in as each env is created — refs/URLs/anon keys are public-safe; secrets are NOT)

| Env | Supabase project ref | API URL | Anon key | Frontend | Migrations | Seed |
|---|---|---|---|---|---|---|
| `local` | — (Docker) | `http://127.0.0.1:54321` | local key in `pmo-portal/.env.local` | `npm run dev` | `supabase db reset` | `seed.sql` (auto) |
| `prod` (cloud) | `prwccpsiumjzvnwjlkwq` | `https://prwccpsiumjzvnwjlkwq.supabase.co` | anon key in CF env vars | **Cloudflare Pages** `production` branch → https://pmo-bfb.pages.dev | `scripts/db-push-prod.sh` | **demo-deploy posture:** full demo seed via `scripts/db-seed-prod.sh` (see below). For a *real* tenant: never seed. |
| `selfhost` (later) | n/a (VPS) | `https://<domain>` | `<fill-in>` | a `selfhost` host env | `db push --db-url …@vps` | reference data only |
| _(one row per real client, appended by `scripts/provision-client.sh`'s registry-row emit at the end of a provisioning run — never a secret)_ | | | | | | |

### Per-client provisioning (real production, GTM — ADR-0047)

Each paying client gets its OWN Supabase Cloud Pro project + Cloudflare Pages project (never the
legacy `prod` cloud project above, which is reclassified staging/demo per the Topology section).
Provisioned via `scripts/provision-client.sh <slug>` (typed-confirm + `op-get.sh` + `--check`
read-only mode, mirrors `db-push-prod.sh`) — this **is** the Operator's "add org" operation at the
<~5-deployment scale (no in-app UI). Coordinates for a new client live in `supabase/op.<slug>.env`
(copy `supabase/op.CLIENT-SLUG.env.template`, gitignored per-client secrets file convention already
used by `op.*.env` files). Readiness is verified by `scripts/check-client-readiness.mjs` (sibling of
`scripts/check-agent-prod-readiness.mjs` — same presence-only-secrets / SKIPPED-not-FAILED
philosophy). Manual-vs-CLI split + full runbook: `docs/plans/2026-07-04-onboarding-tooling.md`
§Slice 5 + `docs/specs/onboarding-tooling.spec.md` §"Deliverable 1". The registry row above is
appended automatically at the end of a successful provisioning run (public-safe fields only — ref/
URL/anon key/frontend/migrations/seed — never a secret).

### Onboarding scripts have their own dependencies (`scripts/package.json`)

`scripts/import-historical.mjs` needs `@supabase/supabase-js` and `scripts/lib/provisionOrgAdmin.mjs`
needs `pg`, but the repo has **no root `node_modules`** (the app's deps live under `pmo-portal/`). The
`scripts/` directory therefore carries its own `package.json`. Run this **once** before invoking any
onboarding script:

```bash
npm --prefix scripts install
```

Then run the scripts from the repo root, e.g.:

```bash
SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=$(scripts/op-get.sh …) \
  node scripts/import-historical.mjs --org-id <uuid> --file scripts/templates/procurement_cases.csv [--dry-run]
```

`scripts/node_modules/` is gitignored; `scripts/package-lock.json` is committed (pins mirror
`pmo-portal/package.json`). `--dry-run` performs zero writes (skips the typed-org-name confirm) and is
the safe way to preview a load.

## Which command hits which target

| Command | Target | Notes |
|---|---|---|
| `supabase start` / `stop` | **local** Docker | dev + test DB on `127.0.0.1` |
| `supabase db reset` | **local** Docker | re-applies migrations **+ runs `seed.sql`** locally |
| `supabase login` / `link` | account / repo↔cloud pointer | `link` writes `supabase/.temp/` (gitignored, **per-repo**). No DB touched. |
| `scripts/db-push-prod.sh` | **prod** (cloud) | secret via 1Password; explicit `--db-url`; typed `prod` confirm; **never seeds** |
| `scripts/db-push-prod.sh --check` | **prod** (cloud) | resolve secret + `select 1`, **no push** — the "is prod usable?" check |
| `scripts/db-push-test.sh` | future hosted test | **dormant** — today test = local Docker |
| `supabase db push` (raw) | the **linked** cloud | avoid — use the scripts (they pass an explicit `--db-url`) |

`login`/`link` are account/cloud-side and **never** affect the local Docker stack. `config.toml`'s
`project_id` is only the local stack name — it binds to no cloud project.

## Local stack hygiene — parallel / multi-worktree development (binding)

Multiple agents/worktrees develop this repo at once. The local Supabase stack is **one shared
Docker stack keyed by the `config.toml` `project_id` (`pmo-portal`)** — **every PMO worktree drives
the SAME stack.** This is the #1 parallel-dev footgun; the rules below are binding.

- **`db reset` is global, not per-worktree.** Running `supabase db reset` from worktree A re-applies
  **A's** migrations + seed to the single shared DB, clobbering whatever schema/state worktree B left.
  → **Serialize all DB-driving work** (migrations, `supabase test db`/pgTAP, Playwright e2e) across
  worktrees. Before trusting a DB result, know **which worktree's migrations are currently applied** —
  if unsure, `db reset` from *your* worktree first. (Real incident 2026-06-12: a pgTAP run launched
  from the `main` worktree silently reset the shared DB to main's schema mid-feature.)
- **Never run two DB-driving tasks concurrently** (even across worktrees) — they corrupt each other.
  Two `db reset`s, or a pgTAP run racing an e2e run, is the failure. FE-only work (vitest is mocked,
  `typecheck`, `lint`, `build`) needs **no** stack and may run in parallel freely.
- **pgTAP needs a pristine base; e2e mutates and persists.** Running `supabase test db` right after a
  Playwright e2e run gives **false pgTAP failures** — e2e mutations (e.g. winning a deal) persist and
  skew count/aggregate assertions. Always `db reset` **between** an e2e run and pgTAP. (Real incident:
  test 0044 "failed" only because an AC-1011 e2e had moved a pipeline deal first.)
- **`fullyParallel` e2e flakes under local resource pressure.** On a loaded machine you'll see spurious
  "element should be visible / observed none" timeouts; the same specs pass `--workers=1` in isolation.
  Don't treat a local full-parallel e2e run as a gate signal — re-run suspects serially, and trust **CI**
  (clean env) as the authority.

### CI is the isolated-DB-per-PR pool — parallelize verification THERE, not locally

> This is the **parallel-mode** verification path (`docs/kanna-program.md` §1 — an opt-in transient mode). The
> **series-default SOP** just uses the single local stack; reach for the pattern below only during a parallel push.

The local stack is ONE shared lock; **CI is not.** PMO is a **public repo ⇒ unlimited free GitHub-Actions
minutes**, and each PR's `integration` job spins up its **own** Postgres + pgTAP + full e2e on a clean
runner. So parallel PRs verify **in parallel, in isolation, at zero local RAM** — CI is effectively the
"multi-branch database" that free Supabase doesn't give you (Supabase Branching is **paid**; and you must
never `db reset` the single cloud/prod DB).

**The parallel-build pattern (binding for parallel work):**
- Build N independent features in **N worktrees** — FE/logic is cheap RAM; the DB is the only local lock.
- Push **a PR per feature** → CI runs each one's isolated DB verification concurrently.
- The Director verifies from **CI** (`gh pr checks <n>`) + light local checks (unit / typecheck / a
  targeted run); merge **serially**. The local stack comes up only for **interactive DB debugging** —
  `supabase stop` otherwise (it's the biggest persistent RAM chunk; see RAM levers below).
- **Re-run a confirmed-flake integration job** (`gh run rerun <id> --failed`) rather than fighting it
  locally — CI flakes (Supabase container-restart 502s, mutation-spec retry-pollution) are routine, not
  signal. Diagnose the failing spec first; only re-run if it's unrelated to the diff.

Render / Cloudflare-free do **not** substitute for the Supabase test stack (a bare Postgres lacks
Supabase's auth/RLS/storage/pgTAP). Full parallel/serialized-owner operating model: `docs/kanna-program.md` §1.

### RAM / disk cleanup (the stack + browsers are the hogs)

- **Stop the stack when not DB-testing.** It's multi-GB and the biggest persistent chunk. **`supabase
  stop` is a *partial* stop** — it leaves the core `db` container UP (observed). To fully release RAM use
  **`supabase stop --no-backup`** (or `docker stop $(docker ps -q --filter name=pmo-portal)`). Bring it
  up only for migration/pgTAP/e2e phases; down otherwise.
- **Close browsers after every rendered check** — `agent-browser close` / kill stray Chromium and
  `@playwright/mcp` servers immediately; they accumulate and (with the stack + the Electron app's
  context) have crashed the Claude app at >20 GB, killing in-flight agent runs. See `docs/pi-delegation.md`
  §3c for the pi process-tree detail (pi + everything it spawns lives under the app's process tree).
- **Reclaim Docker disk periodically.** Stopped containers + dangling images pile up fast (seen: ~40 GB
  reclaimable). **`docker container prune` + `docker image prune`** are safe — they touch only *stopped*
  containers / *dangling* images, never a running stack or its **volumes** (Supabase data lives in volumes,
  which survive). ⚠ This host also runs **other projects' stacks** (e.g. `gordi-mos`) — `docker container
  prune` spares their *running* containers, but **never** `docker volume prune` or `docker system prune
  --volumes` (that destroys other projects' DB data).
- **Prune merged worktrees promptly.** After a squash-merge, remove the issue worktree
  (`git worktree remove --force <path>` then `git worktree prune`) — each stale worktree carries a
  `node_modules`/test-artifact footprint and is another accidental `db reset` surface.

## Secrets via 1Password (`op-get.sh`)

The cloud DB connection string is a secret. It is **never** stored in a file in the repo. Instead it lives in
1Password (vault `AS`) and is fetched at runtime by the sanctioned host tool **`op-get.sh <item> <vault>
<field>`**, which loads the 1Password **service-account token itself** (from `~/.op-token`). Scripts call
`op-get.sh`; nothing here ever reads the token file.

What's committed is only the **coordinates** (item / vault / field — not secret): `supabase/op.prod.env`.

**One-time setup (you):** in 1Password vault `AS`, create an item `pmo-supabase-prod` with a field labelled
`URL` (the field is labelled `URL`, matching `supabase/op.prod.env`) = a **session-mode** connection URI (dashboard → Settings → Database → Connection string). Use the
**Direct connection** (port 5432; IPv6 — or the IPv4 add-on) or the **Session pooler** (port 5432,
`postgres.<ref>` user — IPv4-friendly). **Not** the **Transaction pooler (6543)** — its transaction mode lacks
session features (prepared statements, advisory locks) and breaks `supabase db push` / DDL. (6543 is for
serverless *app* runtime; the app here uses the HTTPS REST API + anon key, not a Postgres socket, so it's
irrelevant.) Adjust `supabase/op.prod.env` if you name the item/field differently.

**Confirm prod is usable (one command):**
```bash
scripts/db-push-prod.sh --check      # → "✓ PROD is usable (1Password resolved + DB reachable)."
```

**Fallback (no 1Password):** the gitignored `supabase/.env.prod` may hold `SUPABASE_PROD_DB_URL=…` instead;
the script uses it only when `op-get.sh` is unavailable. Never commit it.

Other secrets: the **service-role key** is SECRET (1Password only; NEVER client-side). The **anon key** is
public-safe — it ships in the frontend bundle, so it lives in the host's env vars / `.env.local`, not 1Password.

## Frontend on Cloudflare Pages (build-time env binding)

The SPA inlines `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` at **build** time → each build is bolted to one
backend. The **anon key is public-safe** (it ships in the bundle; RLS is the authority), so it lives in the host's
plaintext build env vars — no 1Password needed for the frontend.

**Cloudflare Pages project settings** (project `pmo`, account `2484…1bbf`):
- **Production branch:** `production` (the live deploy). **Preview deploys are OFF** (`preview_deployment_setting: none`,
  CF API) — `main`/`dev`/feature branches/PRs do NOT build, to conserve the 500-builds/month free quota; only a push to
  `production` builds. **Release by merging/pushing `main → production`.** (Set via the CF API; wrangler has no setter for
  an existing project. Re-enable previews only if PR preview URLs are worth the build spend.)
- **Root directory:** `pmo-portal`  ·  **Build command:** `npm run build`  ·  **Build output directory:** `dist`
- **Node:** pinned via `pmo-portal/.node-version` (22) — no env var needed.
- **SPA routing:** `pmo-portal/public/_redirects` (`/*  /index.html  200`) is copied into `dist/` by Vite, so
  deep links (`/projects/:id`) resolve client-side instead of 404ing. (Already in the repo.)
- **Environment variables** (set on the **Production** environment — and Preview if you want PR previews):
  - `VITE_SUPABASE_URL` = `https://<project-ref>.supabase.co` (Supabase → Settings → API)
  - `VITE_SUPABASE_ANON_KEY` = the **anon / public** key (Settings → API) — NOT the service_role key
  - `VITE_APP_ENV` = `prod` (hides the env badge; use `test`/`local` elsewhere to show it)
  - `VITE_DEMO_MODE` = `true` **(client demo only)** — surfaces the demo-login panel on the login page
    (shows `admin@acme.test / Passw0rd!dev` + a "Use demo login" fill button). **Omit it on a real prod
    deploy** so the credential never shows. The demo admin user is created by `supabase/seed-admin.sql`
    (admin-only, no business data — run it once against the cloud).
  - `VITE_POSTHOG_KEY` = the public PostHog project key for the owner's US Cloud project.
  - `VITE_POSTHOG_HOST` = `https://us.i.posthog.com` unless the project settings provide a more specific
    ingestion host.
  - `VITE_ANALYTICS_ENABLED` = `false` for the deployed client demo unless running non-demo analytics.
    Analytics still initializes when `VITE_DEMO_MODE=true`.
  - **Legal pages (set per client at provisioning, FR-LEG-006/007):** every value has a
    presentable default so an unset var never renders a bracket placeholder (I6).
    - `VITE_LEGAL_ENTITY_NAME` = the legal entity name shown on Terms/Privacy (default `PMO Portal`).
    - `VITE_LEGAL_DOMAIN` = the public domain (default `pmoportal.app`).
    - `VITE_LEGAL_CONTACT_EMAIL` = the contact/support email (default `support@pmoportal.app`).
    - `VITE_HELP_WHATSAPP` = E.164 WhatsApp support number, e.g. `6281234567890` (default empty → Help link omitted entirely, FR-LEG-010).
    - `VITE_HOSTING_LOCATION` = the data-residency location disclosed on Privacy (default `Singapore`; per-client per ADR-0047; staging is Sydney).

### PostHog demo analytics flags

PostHog is gated by `VITE_DEMO_MODE=true || VITE_ANALYTICS_ENABLED=true`.

- Deployed demo with no URL flag defaults to `demo_audience=prospect` and `demo_account=default`.
- Local/dev defaults to `demo_audience=internal` and `demo_account=local`.
- `?da=internal` marks deployed internal testing and disables replay/autocapture.
- `?da=prospect` marks a prospect demo as `demo_account=default`.
- `?da=comp1` marks a prospect demo as `demo_account=comp1`; use any safe slug for separate client
  showcase sessions.
- `?demo_account=<safe-slug>` may override the account label when needed.

Session replay and click-only autocapture run only for deployed prospect demo sessions. Internal,
local/dev, and analytics-only sessions keep route tracking and explicit safe events but disable replay
and autocapture. PostHog dashboards are a required follow-up after this instrumentation emits data;
dashboard setup is not part of the first instrumentation PR.

**Local dev** points at the local stack: `pmo-portal/.env.local` with `VITE_SUPABASE_URL=http://127.0.0.1:54321`,
the local anon key, and `VITE_APP_ENV=local` (the `<EnvBadge>` then shows a "LOCAL" ribbon — non-prod builds badge
the backend so a deploy can never silently talk to the wrong one).

## Edge Functions (local dev + prod deploy)

Two Deno **Supabase Edge Functions** live in `supabase/functions/`: **`agent-chat`** (the A1–A4
agent-native LLM deputy — streaming SSE, read-only `query_entity` + approve-gated write actions +
compose-a-view) and **`compose-view`** (the AI view-composer). They are the app's **first
server-side tier** — everything else is SPA → Supabase REST. Both hold `OPENROUTER_API_KEY` and act
under the **caller's JWT** (deputy auth; RLS is the ceiling). Registered in `config.toml` as
`[functions.agent-chat]` / `[functions.compose-view]` with `verify_jwt = false` (the handler
verifies the JWT itself to return a typed 401). Logic is unit-tested via the pure `handler.ts`
(importable in Vitest); `index.ts` is integration-only (ADR-0039).

**They do NOT run in CI or in this remote container.** `config.toml` has `[edge_runtime] enabled =
false` — the local Deno image can't reach `deno.land` in the CI/container env and its failed health
check tears down the whole stack. So the agent e2e specs **mock** `agent-chat` via `page.route`
(no live LLM). Live end-to-end testing must happen on a real local machine with internet.

### Local dev (real LLM, on your machine)

Prereqs: Docker + local stack up, internet to `deno.land`/npm, a real OpenRouter API key
(`https://openrouter.ai/keys`).

```bash
cp supabase/functions/.env.example supabase/functions/.env   # fill OPENROUTER_API_KEY (and optionally AGENT_MODEL_DEFAULT / AGENT_MODEL_COMPOSE)
supabase start                                                # local stack
supabase functions serve agent-chat compose-view \
  --env-file supabase/functions/.env --no-verify-jwt          # standalone Deno runtime, hot-reload
```
`functions serve` runs its own edge runtime on demand, so you do **not** flip the committed
`[edge_runtime] enabled=false` (which would break CI/this container). The SPA already targets
`${VITE_SUPABASE_URL}/functions/v1/<name>`, so with `.env.local` pointing at the local stack and
`VITE_FEATURES_AGENT_ASSISTANT=true`, `npm run dev` → ⌘J drives a real agent against your local DB.
`SUPABASE_URL`/`SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY` are auto-injected by the runtime;
only `OPENROUTER_API_KEY` must be supplied. `supabase/functions/.env.example` now documents
`OPENROUTER_API_KEY` / `AGENT_MODEL_DEFAULT` / `AGENT_MODEL_COMPOSE` in place of `ANTHROPIC_API_KEY`.

### Prod deploy (⚠ gap — required before `v0.2.0` can ship)

The promote path (below) currently deploys **only DB + frontend** — there is **no
`supabase functions deploy` step and no prod `OPENROUTER_API_KEY` secret**. Until added, a prod that
includes the agent panel calls a missing endpoint. The owner-gated release step is:

```bash
supabase functions deploy agent-chat compose-view          # deploy the Deno functions
supabase secrets set OPENROUTER_API_KEY=sk-or-…            # set the prod function secret (once)
supabase secrets set AGENT_ALLOWED_ORIGIN=https://pmo-bfb.pages.dev  # AUDIT-M4: narrow CORS to the SPA origin (unset ⇒ '*' for local dev)
```
**Migration note (this issue):** the prod Supabase Cloud project currently has NO
`ANTHROPIC_API_KEY` secret set (never deployed — see the ⚠ gap this section already documents) —
so there is nothing to unset/rotate on the cloud side. The only action needed at prod-deploy time
is setting `OPENROUTER_API_KEY` (new) instead of the old name; no live-secret rotation is required
because the old secret was never live.

This runs **as part of a `v0.2.0` promote**, ordered with the DB push (below). Tracked in
`docs/backlog.md` (edge-function operationalization).

### Agent prod-readiness check (`scripts/check-agent-prod-readiness.mjs`)

Before enabling the agent tier against a real deployment (or as a periodic health check),
run the read-only checklist script:

```bash
PMO_READINESS_BASE_URL=https://<ref>.supabase.co/functions/v1 \
PMO_READINESS_BEARER=<a real user JWT, or the service-role key for agent-dispatch> \
OPENROUTER_API_KEY=<already in your shell if you sourced the prod secrets> \
node scripts/check-agent-prod-readiness.mjs           # add --live to fire one real agent-chat call
```

It checks, and reports SKIPPED (not FAILED) when an input is not supplied:
- **(a) Reachability** — an unauthenticated probe to each of `agent-chat` / `compose-view` /
  `agent-dispatch` expects **401** (the function is deployed and enforcing auth); an authenticated
  probe (with `PMO_READINESS_BEARER`) expects **2xx**. A `404` means "not deployed"; a network
  error means "unreachable"; a `5xx` with auth means "deployed but erroring" — the script reports
  which, so a failure is diagnosable without opening a dashboard.
- **(b) Required secrets** — presence-only (never the value) of `OPENROUTER_API_KEY` in the
  **invoking shell's** own environment. This is NOT a remote check of the deployed project's
  secrets (no Supabase Management API token is wired) — confirm those separately with
  `supabase secrets list` against the linked project.
- **(c) pg_cron GUCs** — `app.settings.dispatch_url` / `app.settings.service_role_key` (migration
  0048's per-minute tick) are **not remotely checkable** from this script; it prints the exact
  `SHOW app.settings.…;` command to run against the deployed Postgres to confirm they are set.
- **(d) Synthetic dry-run** (opt-in, `--live`) — fires one real `agent-chat` POST (spends a token/
  model call) to confirm the full request path works end-to-end. Off by default so a plain
  `--check`-style run never spends anything.

It **never reads `.env` files or 1Password** — every input is a plain env var the operator's own
shell already has (e.g. from `op-get.sh`, per the Secrets section above). This does **not**
automate the live-mint verify (minting a real owner JWT and firing a real automation against prod
data stays a manual, owner-instructed step) — it only enumerates and checks what is safe to check
mechanically. Unit tests for its pure classification logic:
`scripts/check-agent-prod-readiness.test.mjs` (`node --test`).

**Next step not yet built (flagged, not implemented here):** a durable error-events table /
webhook alert so a production failure (missing secret, dispatch-tick failure, automation
mint/audit/fire failure) is pushed to the owner instead of only sitting in Supabase Edge Function
logs — see the structured `errorCode`s now emitted (`supabase/functions/_shared/errorLog.ts`) as
the ready-made hook point for that future alerting layer.

## Prod migration state

**Prod is CURRENT at migration 0057** (pushed 2026-07-04 via owner-direct "push to prod"; migs
0042–0057 = the never-shipped pre-agent 0042–0045 + the full agent tier 0046–0057, incl. the
RED-3/RED-4 tenant-security fixes 0051/0052). The **`v0.2.0` agent-tier promote is LIVE**: CF Pages
`production` = `8e4998e` → https://pmo-bfb.pages.dev with the AssistantPanel flag ON; `agent-chat` +
`compose-view` edge functions deployed with `OPENROUTER_API_KEY` set; live end-to-end verified.
> **Prior baseline:** migration 0041 (`fc312eb`, procurement case-folder records, migs 0035–0041) was
> the `v0.1.0` baseline (ADR-0042), pushed 2026-06-21.
> **History:** …0028–0033 pushed 2026-06-16 (procurement-files, calendar-milestone RPC, CRM,
> vendor idx, top-projects spent, at-risk budget); **0035–0041 pushed 2026-06-21** (procurement
> case-folder records). `docs/backlog.md` "Current state" is the live tracker; this section trails it.

The migration-0023 immutability bug (PR #79 edited an already-prod-live migration) was **fixed in PR #80**:
0023 restored byte-identical to its #74 content, the committed-spend RPC moved to a new **0026**, plus
**0027** (dashboard at-risk `>=` boundary). **Rule going forward (binding):** once a migration is pushed to
prod it is IMMUTABLE — any later change to a function/view/policy goes in a NEW forward migration (RPCs are
`create or replace`, so trivially re-appliable). Push order: **DB first (`db-push-prod.sh`), then promote the
FE** (`git push origin main:production`) — the old FE ignores new RPC columns, so DB-ahead-of-FE is safe.

## First-time prod (cloud) deploy

```bash
# 1. Store the secret in 1Password (vault AS, item pmo-supabase-prod, field URL = Direct or Session-pooler URI, port 5432 — NOT 6543).
scripts/db-push-prod.sh --check                  # confirm 1Password + DB reachable
# 2. Apply the schema:
supabase login
supabase link --project-ref <cloud ref>          # links this repo to the cloud project
scripts/db-push-prod.sh                           # typed 'prod' confirm → migrations applied
# 3. (cloud = prod, so NO demo seed.) For a clickable demo with login users, test on LOCAL instead:
#    supabase start && supabase db reset
```
Then dashboard → **Settings → API** → copy the URL + anon key into the frontend host's env vars (+ `VITE_APP_ENV=prod`).

## Seeding prod — demo-deploy posture (`scripts/db-seed-prod.sh`)

> The default rule is **never seed prod**. It is overridden *only* while the Cloud project is a **public
> demo showcase** (`VITE_DEMO_MODE=true`; the login page already advertises the `acme.test` creds). When
> prod becomes a real tenant with real data, **delete `db-seed-prod.sh`** and never demo-seed again.

The standard promote (owner-gated). Per ADR-0042 a promote also **cuts a version** — bump
`CHANGELOG.md`/`package.json`, then tag `vX.Y.Z` on the promoted commit with the deploy manifest:
```bash
# 0. RELEASE: pick the bump (ADR-0042 §2), update CHANGELOG.md + pmo-portal/package.json
scripts/db-push-prod.sh            # 1. DB: apply pending migrations (typed 'prod')
supabase functions deploy agent-chat compose-view   # 1b. edge functions (v0.2.0+; secret set once)
scripts/db-seed-prod.sh            # 2. demo data (typed 'prod-seed') — demo-deploy only
git push origin main:production    # 3. FE: Cloudflare builds the production branch
git tag -a vX.Y.Z <sha> -m "…" && git push origin vX.Y.Z   # 4. tag the release
```
**`seed.sql` conflict gotcha (binding):** the seed's inserts are `on conflict (id) do nothing`, which does
**not** catch a `(org_id, code)` unique-key collision. If prod already holds demo data from an **older
seed with a different id scheme** (real incident 2026-06-16: prod had `d0…`-id projects, current seed uses
`41…`), a re-seed errors mid-run and leaves a **partial overlay**. The clean fix is a **truncate + fresh
reseed** (only demo data is touched; `organizations` + `pipeline_stage_config` + doc counters + the demo
`auth.users` are migration-/stable-id-owned and preserved):
```sql
TRUNCATE budget_line_items, budget_versions, companies, contacts, crm_activities, incident_reports,
  procurement_documents, procurement_invoices, procurement_items, procurement_quotations,
  procurement_receipts, procurements, profiles, project_documents, project_milestones, projects,
  task_dependencies, tasks, timesheet_entries, timesheets RESTART IDENTITY CASCADE;
-- then re-run scripts/db-seed-prod.sh
```

## Provisioning an Operator (per client) — ADR-0049 / FR-OPR-003

The **Operator** is a platform-level grant (the vendor operating PMO), NOT a 6th `user_role`. It
lives on `platform_operators(user_id)` (RLS forced; one SELECT policy, no write policy —
append-only-by-omission). There is no in-app Operator-of-Operators affordance in v1; an Operator is
provisioned against a real project's cloud DB via service-role `psql` (the same path the local
`seed.sql` §U uses for the staging/demo Operator `arief.said@gmail.com`). Out-of-band, set a strong
password for the auth user after creating it.

```sql
-- 1. auth user (GoTrue). Set email_confirmed_at so they can sign in; set a bf password out-of-band.
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
   confirmation_token, recovery_token, email_change, email_change_token_new,
   email_change_token_current, reauthentication_token)
values
  ('00000000-0000-0000-0000-000000000000', '<a fresh uuid>',
   'authenticated','authenticated','<operator@example.com>',
   crypt('<strong-password>', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now(),
   '', '', '', '', '', '');
-- 2. a profiles row (role 'Admin' for shell access; org_id = the client's single org).
insert into profiles (id, org_id, full_name, email, role, title)
  values ('<same uuid>', '<the client org id>', '<Name>', '<operator@example.com>', 'Admin', 'Platform Operator');
-- 3. the platform grant (service-role/psql ONLY — never any client API).
insert into platform_operators (user_id) values ('<same uuid>');
```

`is_operator()` (plain `SECURITY INVOKER`) resolves `true` only under an Operator's own JWT (their own
`platform_operators` row is visible via the SELECT policy); every Operator power is re-asserted
server-side by the security-definer RPCs (`admin_set_user_status`, `operator_grant_credits`,
`operator_toggle_feature`, `operator_usage_summary`, `operator_list_orgs`).

## Production auth configuration (per-client Supabase Cloud project — owner-gated)

> Binding source: `docs/specs/auth-production-floor.spec.md` §7 (NFR-AUTHF-CONF-001…008). This is a
> **runbook**, not code — it mutates a live Supabase Cloud project per client (ADR-0047) and is an
> **owner checkpoint at client provisioning**. The Operator completes 7.1–7.6 as the final auth step of
> "add org"; record completion against the client's registry row below. **No domain or secret is
> committed** (D-AUTHF-2). Cloud SMTP is configured differently from local (§7.1a local TOML `env()`
> vs §7.1b cloud dashboard literal key).

### 7.1 SMTP via Resend
The Resend API key lives in the 1Password client vault (vault `AS` pattern); the sender domain is
**verified in Resend**, not in this repo (D-AUTHF-2). **Never commit the key.**

- **7.1a Local dev** — `supabase/config.toml` `[auth.email.smtp]` supports `env(RESEND_API_KEY)`
  substitution. Kept commented in the committed template so local dev keeps using the Inbucket testing
  server on :54324 (the auth e2e depends on it). To test real SMTP delivery locally: uncomment the block,
  set `RESEND_API_KEY` in `.env`, `supabase stop && supabase start`.
- **7.1b Cloud project — dashboard Auth → SMTP Settings (LITERAL key, NOT `env()`).** GoTrue SMTP on a
  Supabase Cloud project is configured in the dashboard; the dashboard does NOT accept the `env(...)`
  form — the **literal** API key goes in the SMTP password field. `supabase secrets set RESEND_API_KEY=…`
  configures **edge-function** secrets and does NOT configure GoTrue SMTP; do not use it for this step.
  1. Retrieve the key from 1Password (vault `AS`): the `re_…` secret for this client.
  2. Dashboard → **Authentication → SMTP Settings** → enable **Custom SMTP**.
  3. Enter: Host `smtp.resend.com`; Port `465` (or `587` per Resend docs); Username `resend`;
     **Password = the literal `re_…` API key from 1Password** (paste directly — no `env()` wrapping);
     Sender email = `<sender-address>@<verified-domain>`; Sender name = `<Product or Org name>`;
     Minimum interval per the project's needs.
  4. **Save**, then send the dashboard **test email** and confirm receipt.

### 7.2 Redirect allowlist (Auth → URL configuration)
- `site_url` = the client's deployed **HTTPS** Cloudflare Pages URL (e.g. `https://<client>.<host>`).
- `additional_redirect_urls` = the same HTTPS origin (covering `/login`, `/update-password`).
- No `localhost`, no `http`, no wildcard, no second origin (NFR-AUTHF-CONF-003).

### 7.3 Auth toggles
(source list: `docs/specs/auth-production-floor.spec.md` §7.3)
- `enable_confirmations = true` (email confirmation required) — NFR-AUTHF-CONF-004.
- `enable_signup = false` (invite-only — GTM item 1a issues all users) — NFR-AUTHF-CONF-004.
- `enable_anonymous_sign_ins` stays `false`.
- `minimum_password_length` / `password_requirements` ≥ local template (`>=10`, `lower_upper_letters_digits`).
- `secure_password_change = true` — does not affect the recovery/invite flow (those sessions are freshly token-authenticated).

### 7.4 Rate-limit & captcha (Auth → Rate limits / Auth → Captcha)
The reset/confirm/invite endpoints this issue exposes are the primary abuse surface. Two distinct knobs
(both verified against the committed `supabase/config.toml` comments):
- `[auth.rate_limit] email_sent = 2` — **per-hour email count cap** (the `config.toml` comment reads "Number
  of emails that can be sent per hour"). Intended production value **`2`** (mirrors the committed template;
  tune per client). Bounds overall volume from the reset/confirm/invite endpoints.
- `[auth.email] max_frequency = "60s"` — **per-address minimum-seconds throttle** (the `config.toml` comment
  reads "Controls the minimum amount of time that must pass before sending another signup confirmation or
  password reset email"). Intended production value **`"60s"`** — one reset/confirm/invite email per address
  per minute, tighter than the dev template's `"1s"`; the **primary per-address** abuse lever (tune per
  client).
- `[auth.captcha]` — enable (hCaptcha / Cloudflare Turnstile per the project) for production once the
  provider keys are provisioned; `enabled = true` + `provider` + the secret/site-key pair is a per-client
  provisioning value (**no key committed**). Intended production value: **enabled**.
- **Rate-limit-vs-enumeration interaction (D-AUTHF-7, NFR-AUTHF-SEC-001):** a sender who is rate-limited
  learns the endpoint was hit repeatedly for that address — a side channel distinct from the client-rendered
  message parity the app controls. The app cannot eliminate this (server-side), so the client keeps the
  rendered notice constant (FR-AUTHF-013) and treats a rate-limit response the same as other transient
  errors from the user's point of view; `email_sent` (hourly cap) + `max_frequency` (per-address throttle)
  + captcha bound the leakage rate.

### 7.5 Seed-credential hygiene (real client projects only — not staging/demo)
- Rotate or disable the `Passw0rd!dev` / `admin@acme.test` user.
- **Do not run** `scripts/db-seed-prod.sh` or `supabase/seed-admin.sql`.
- **Do not set** `VITE_DEMO_MODE=true` on the client's CF Pages environment (the login demo panel must not
  appear) (NFR-AUTHF-CONF-005, FR-AUTHF-060).

### 7.6 Table exposure

> **⚠ BLOCKING FINDING (2026-07-04, implementer — auth-production-floor Slice 5, NOT yet resolved).**
> `auto_expose_new_tables=false` is the correct target state (NFR-AUTHF-CONF-006), but **activating it
> locally (`supabase/config.toml`, then `supabase db reset`) strips every DML grant
> (SELECT/INSERT/UPDATE/DELETE) for `authenticated`/`anon` on ALL 44 `public` tables** — confirmed via
> `docker exec supabase_db_pmo-portal psql … information_schema.role_table_grants`: 0/44 tables retain
> any `authenticated` DML grant with the flag active vs 44/44 with it left at the (soon-retired) implicit
> default. Root cause: **no migration in this repo issues an explicit `GRANT`** on any `public` table to
> `authenticated`/`anon` — every table has always relied on the implicit auto-expose default that this
> NFR turns off. Reproduced end-to-end: `e2e/AC-AUTH-005.spec.ts` (pre-existing, unrelated to this issue)
> passes with the flag commented and fails with `permission denied for table profiles` with it active, on
> an otherwise-identical `db reset`.
>
> **This means activating `auto_expose_new_tables=false` — locally OR on any Supabase Cloud project,
> including via this exact runbook step — breaks the ENTIRE app** (every table read/write) until a
> companion migration explicitly `GRANT`s the needed DML to `authenticated` (and `anon` where relevant)
> per table. That is a cross-cutting, security-relevant schema change requiring per-table review (some
> tables may deliberately want narrower grants than a blanket `GRANT ALL`) — **out of scope for a single
> implementer task; needs Director/security-auditor design.** `supabase/config.toml`'s
> `auto_expose_new_tables = false` line is committed **commented** (not activated) pending that follow-up;
> see the implementer's final report for the reproduction steps. **Do not activate this line — locally or
> on a client project — until the companion GRANT migration ships and is verified.**

- `auth.auto_expose_new_tables=false` on the cloud project (Data API settings) — opted-in in the committed
  `supabase/config.toml` (NFR-AUTHF-CONF-006) **once the companion GRANT migration above ships**.

### 7.7 Provisioning sign-off
The Operator (glossary) completes 7.1–7.6 as the final step of new-client provisioning (ADR-0047: this *is*
the "add org" operation's auth step). Recorded against the client's registry row in `## Registry` above.

## Self-hosted (Docker/VPS) later

Just another target: `supabase db push --db-url postgres://…@your-vps` (store that URL in 1Password too, add a
`supabase/op.selfhost.env` coordinate file + a push script mirroring the prod one). Migrations + the auth seed
are portable; you own the JWT secret, backups, and upgrades.
