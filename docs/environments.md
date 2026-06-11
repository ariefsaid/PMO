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
| `prod` (cloud) | `<fill-in>` | `https://<ref>.supabase.co` | `<fill-in>` | Vercel Production env | `scripts/db-push-prod.sh` | **never** demo seed |
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

## Secrets via 1Password (`op-get.sh`)

The cloud DB connection string is a secret. It is **never** stored in a file in the repo. Instead it lives in
1Password (vault `AS`) and is fetched at runtime by the sanctioned host tool **`op-get.sh <item> <vault>
<field>`**, which loads the 1Password **service-account token itself** (from `~/.op-token`). Scripts call
`op-get.sh`; nothing here ever reads the token file.

What's committed is only the **coordinates** (item / vault / field — not secret): `supabase/op.prod.env`.

**One-time setup (you):** in 1Password vault `AS`, create an item `pmo-supabase-prod` with a field labelled
`db_url` = a **session-mode** connection URI (dashboard → Settings → Database → Connection string). Use the
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

**Cloudflare Pages project settings** (dashboard → Workers & Pages → create → connect this repo):
- **Root directory:** `pmo-portal`  ·  **Build command:** `npm run build`  ·  **Build output directory:** `dist`
- **Node:** pinned via `pmo-portal/.node-version` (22) — no env var needed.
- **SPA routing:** `pmo-portal/public/_redirects` (`/*  /index.html  200`) is copied into `dist/` by Vite, so
  deep links (`/projects/:id`) resolve client-side instead of 404ing. (Already in the repo.)
- **Environment variables** (set on the **Production** environment — and Preview if you want PR previews):
  - `VITE_SUPABASE_URL` = `https://<project-ref>.supabase.co` (Supabase → Settings → API)
  - `VITE_SUPABASE_ANON_KEY` = the **anon / public** key (Settings → API) — NOT the service_role key
  - `VITE_APP_ENV` = `prod` (hides the env badge; use `test`/`local` elsewhere to show it)

**Local dev** points at the local stack: `pmo-portal/.env.local` with `VITE_SUPABASE_URL=http://127.0.0.1:54321`,
the local anon key, and `VITE_APP_ENV=local` (the `<EnvBadge>` then shows a "LOCAL" ribbon — non-prod builds badge
the backend so a deploy can never silently talk to the wrong one).

## First-time prod (cloud) deploy

```bash
# 1. Store the secret in 1Password (vault AS, item pmo-supabase-prod, field db_url = Direct or Session-pooler URI, port 5432 — NOT 6543).
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
