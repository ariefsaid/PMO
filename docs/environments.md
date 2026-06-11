# Environments & Supabase CLI hygiene

The binding rules an agent must follow live in `CLAUDE.md` (§ Supabase environments). This file is the
**full reference + the environment registry**. Mental model: **one source of truth = `supabase/migrations/`
+ `seed.sql` (in git); each environment is just a different connection target** for that same schema.

## Registry (fill in as each env is created — refs/URLs/anon keys are public-safe; passwords are NOT)

| Env | Supabase project ref | API URL | Anon key | Frontend deploy | Seed |
|---|---|---|---|---|---|
| `local` | — (Docker, `supabase start`) | `http://127.0.0.1:54321` | local key in `pmo-portal/.env.local` | `npm run dev` | `db reset` (auto) |
| `test` | `<fill-in>` | `https://<ref>.supabase.co` | `<fill-in>` | Vercel **Preview** env | `seed.sql` (OK) |
| `prod` | `<fill-in>` | `https://<ref>.supabase.co` | `<fill-in>` | Vercel **Production** env | **NEVER** demo seed |
| `selfhost` (later) | n/a (VPS) | `https://<your-domain>` | `<fill-in>` | a `selfhost` host env | reference data only |

## Which command hits which target

| Command | Target | Notes |
|---|---|---|
| `supabase start` / `stop` | **local** Docker | dev DB on `127.0.0.1` |
| `supabase db reset` | **local** Docker | re-applies migrations **+ runs `seed.sql`** locally |
| `supabase login` | your **account** | token in `~/.supabase/` (global, shared). No DB touched. |
| `supabase link --project-ref X` | repo ↔ cloud pointer | writes `supabase/.temp/` (gitignored, **per-repo**). No DB touched. |
| `scripts/db-push-test.sh` | **test** cloud | explicit `--db-url`; `--seed` to also load `seed.sql` |
| `scripts/db-push-prod.sh` | **prod** cloud | explicit `--db-url` + typed `prod` confirm; **never seeds** |
| `supabase db push` (raw) | the **linked** cloud | avoid — use the scripts; if used, it hits whatever is linked |

`login`/`link` are account/cloud-side and **never** affect the local Docker stack. `db reset` = local; the
scripts = cloud. `config.toml`'s `project_id` is only the local stack name — it binds to no cloud project.

## Why this is safe (the design)

- **Per-project isolation is automatic.** The link lives in each repo's own `supabase/.temp/` (gitignored);
  the CLI resolves it by walking up to the nearest `supabase/config.toml`. So two repos on one device can't
  pollute each other — **as long as you run `supabase` from the repo root.**
- **Fail-safe default.** Keep the persisted link pinned to **test**. A forgotten flag then hits test, never
  prod. **Never leave the link pinned to prod.** Pin it with: `supabase link --project-ref <TEST ref>`.
- **Prod is gated.** `scripts/db-push-prod.sh` uses an explicit `--db-url` + a typed `prod` confirmation, so
  prod is never reachable by accident.
- **No drift.** All schema changes go through `supabase/migrations/*.sql`, applied test→prod via the scripts.
  Never hand-edit a cloud DB's schema in the SQL editor (data-only edits on test are fine). `supabase db diff`
  detects drift.
- **Seed policy.** `seed.sql` (demo users + fake data) → local + test only. Prod starts empty (real signups)
  or gets a separate `seed.prod.sql` (reference/lookup data only, no demo accounts).

## Secrets

Each env has its own: **anon key** (public — lives in the frontend host's env vars), **DB password** and
**service-role key** (SECRET — password manager only; never in the repo; service-role NEVER client-side).
`.gitignore` blocks `.env*`; the repo is public, so a committed secret is exposed instantly.

### `supabase/.env.test` / `supabase/.env.prod` (gitignored — create locally, never commit)

Connection string: Supabase dashboard → **Settings → Database → Connection string → URI** (use the pooler /
port `6543`).

```bash
# supabase/.env.test
SUPABASE_TEST_REF=your-test-project-ref
SUPABASE_TEST_DB_URL=postgresql://postgres.<ref>:<password>@<host>:6543/postgres
```

```bash
# supabase/.env.prod
SUPABASE_PROD_REF=your-prod-project-ref
SUPABASE_PROD_DB_URL=postgresql://postgres.<ref>:<password>@<host>:6543/postgres
```

## Frontend env binding (build-time)

The SPA inlines `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` at **build** time → each build is bolted to
one backend. Set these **per host environment** (Vercel Production env → prod Supabase; Preview env → test
Supabase) so PR previews auto-hit test and prod hits prod.

Also set **`VITE_APP_ENV`** per environment (`local` / `test` / `prod`): the `<EnvBadge>` renders a corner
ribbon naming the backend on every non-prod build (renders nothing when unset / `prod` / `production`), so a
deploy can never silently talk to the wrong backend. Add `VITE_APP_ENV=local` to `pmo-portal/.env.local` for
local dev.

## First-time test deploy (recap)

```bash
supabase login                                   # account auth (browser)
supabase link --project-ref <TEST ref>           # pin the link to TEST (safe default)
scripts/db-push-test.sh --seed                    # migrations + demo data + login users
```

Then in the dashboard: **Settings → API** → copy the URL + anon key into the host's `test`/Preview env vars.
The seeded users are pre-confirmed (`pm@acme.test` / `Passw0rd!dev`), so they log in without email confirmation.

## Self-hosted (Docker/VPS) later

Just a 4th target: `supabase db push --db-url postgres://…@your-vps`. Migrations + the auth seed are portable;
you own the JWT secret, backups, and upgrades. Add it as the `selfhost` row above with its own URL + anon key.
