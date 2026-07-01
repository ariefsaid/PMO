# Environments & Supabase CLI hygiene

The binding rules live in `CLAUDE.md` (§ Supabase environments). This is the **full reference + registry**.
Mental model: **one source of truth = `supabase/migrations/` + `seed.sql` (in git); each environment is just a
different connection target** for that same schema.

## Topology (current)

- **`local`** = where you develop **and test** — the Docker stack (`supabase start` / `supabase db reset`).
  Its keys are the well-known local dev keys (not secret).
- **`prod`** = the **Supabase Cloud** project (functionally staging, treated as prod). Its DB connection
  string is a **secret, stored in 1Password** (vault `AS`).
- **`selfhost`** (later) = a VPS Docker Supabase — a future target with the same schema.
- A separate **hosted `test`/staging** project is not used yet; `scripts/db-push-test.sh` + `supabase/op.test.env`
  are dormant forward-compat for when one is added.

## Registry (fill in as each env is created — refs/URLs/anon keys are public-safe; secrets are NOT)

| Env | Supabase project ref | API URL | Anon key | Frontend | Migrations | Seed |
|---|---|---|---|---|---|---|
| `local` | — (Docker) | `http://127.0.0.1:54321` | local key in `pmo-portal/.env.local` | `npm run dev` | `supabase db reset` | `seed.sql` (auto) |
| `prod` (cloud) | `prwccpsiumjzvnwjlkwq` | `https://prwccpsiumjzvnwjlkwq.supabase.co` | anon key in CF env vars | **Cloudflare Pages** `production` branch → https://pmo-bfb.pages.dev | `scripts/db-push-prod.sh` | **demo-deploy posture:** full demo seed via `scripts/db-seed-prod.sh` (see below). For a *real* tenant: never seed. |
| `selfhost` (later) | n/a (VPS) | `https://<domain>` | `<fill-in>` | a `selfhost` host env | `db push --db-url …@vps` | reference data only |

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
server-side tier** — everything else is SPA → Supabase REST. Both hold `ANTHROPIC_API_KEY` and act
under the **caller's JWT** (deputy auth; RLS is the ceiling). Registered in `config.toml` as
`[functions.agent-chat]` / `[functions.compose-view]` with `verify_jwt = false` (the handler
verifies the JWT itself to return a typed 401). Logic is unit-tested via the pure `handler.ts`
(importable in Vitest); `index.ts` is integration-only (ADR-0039).

**They do NOT run in CI or in this remote container.** `config.toml` has `[edge_runtime] enabled =
false` — the local Deno image can't reach `deno.land` in the CI/container env and its failed health
check tears down the whole stack. So the agent e2e specs **mock** `agent-chat` via `page.route`
(no live LLM). Live end-to-end testing must happen on a real local machine with internet.

### Local dev (real LLM, on your machine)

Prereqs: Docker + local stack up, internet to `deno.land`/npm, a real Anthropic key.

```bash
cp supabase/functions/.env.example supabase/functions/.env   # fill ANTHROPIC_API_KEY (gitignored)
supabase start                                                # local stack
supabase functions serve agent-chat compose-view \
  --env-file supabase/functions/.env --no-verify-jwt          # standalone Deno runtime, hot-reload
```
`functions serve` runs its own edge runtime on demand, so you do **not** flip the committed
`[edge_runtime] enabled=false` (which would break CI/this container). The SPA already targets
`${VITE_SUPABASE_URL}/functions/v1/<name>`, so with `.env.local` pointing at the local stack and
`VITE_FEATURES_AGENT_ASSISTANT=true`, `npm run dev` → ⌘J drives a real agent against your local DB.
`SUPABASE_URL`/`SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY` are auto-injected by the runtime;
only `ANTHROPIC_API_KEY` must be supplied.

### Prod deploy (⚠ gap — required before `v0.2.0` can ship)

The promote path (below) currently deploys **only DB + frontend** — there is **no
`supabase functions deploy` step and no prod `ANTHROPIC_API_KEY` secret**. Until added, a prod that
includes the agent panel calls a missing endpoint. The owner-gated release step is:

```bash
supabase functions deploy agent-chat compose-view          # deploy the Deno functions
supabase secrets set ANTHROPIC_API_KEY=sk-ant-…            # set the prod function secret (once)
```
This runs **as part of a `v0.2.0` promote**, ordered with the DB push (below). Tracked in
`docs/backlog.md` (edge-function operationalization).

## Prod migration state

**Prod is CURRENT at migration 0041** (`fc312eb`, the procurement case-folder record model pushed
2026-06-21 via owner-direct "push to prod"; migs 0035–0041). This is the **`v0.1.0` versioning
baseline** (ADR-0042). `main` is now well ahead (migs 0042–0045 + the agent-native edge-function
tier); a prod promote of that = `v0.2.0` and needs a **direct per-instance owner instruction**.
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

## Self-hosted (Docker/VPS) later

Just another target: `supabase db push --db-url postgres://…@your-vps` (store that URL in 1Password too, add a
`supabase/op.selfhost.env` coordinate file + a push script mirroring the prod one). Migrations + the auth seed
are portable; you own the JWT secret, backups, and upgrades.
