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
| `prod` (cloud) | `prwccpsiumjzvnwjlkwq` | `https://prwccpsiumjzvnwjlkwq.supabase.co` | anon key in CF env vars | **Cloudflare Pages** `production` branch → https://pmo-bfb.pages.dev | `scripts/db-push-prod.sh` | **never** demo seed (admin-only via `seed-admin.sql`) |
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
- **Production branch:** `production` (the live deploy). `main` + PRs → **preview** deploys. **Release by
  merging `main → production`.** (Set via the CF API; wrangler has no setter for an existing project.)
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

## Prod-pending migrations (action required)

> ⚠ **KNOWN ISSUE — migration 0023 immutability bug:** PR #79 edited migration 0023 (already live in
> prod) to add `committed_spend` to `get_projects_delivery`. Supabase will NOT re-apply it. Before the
> next prod push, restore 0023 to its #74 content and add a new **0026** migration that `CREATE OR
> REPLACE`s the RPC with the committed-spend version. Then push 0024 + 0025 + 0026 together.
> See `docs/backlog.md` KNOWN ISSUES for the complete fix procedure.

Migrations currently pending for prod (not yet pushed to cloud):
- **0024** — Superseded document status enum (PR #78)
- **0025** — Storage: org bucket + `storage.objects` RLS + auto-Supersede RPC (PR #78)
- **0026** *(to be created)* — `get_projects_delivery` RPC v2 with `committed_spend` (fixes #79 regression)

Push all three together once 0026 is in place: `scripts/db-push-prod.sh`.

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

## Self-hosted (Docker/VPS) later

Just another target: `supabase db push --db-url postgres://…@your-vps` (store that URL in 1Password too, add a
`supabase/op.selfhost.env` coordinate file + a push script mirroring the prod one). Migrations + the auth seed
are portable; you own the JWT secret, backups, and upgrades.
