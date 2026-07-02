# Deploy Runbook — agent-native whole-UI (Option B), prod enable

**Date:** 2026-07-02 · **Owner:** Platform / release-engineer · **Branch:** `feat/agent-native-adoption`
**Owning epic AC:** `AC-423` (Nitro on VPS + same-origin Pages Function proxy reaches it cleanly) — E8 task #4 of `docs/plans/2026-07-01-agent-native-adoption-epic.md`.
**Inputs:** `docs/adr/0040-…-pmo-native-vs-sidecar.md` (Decision 2026-07-01) · `docs/spikes/2026-07-01-agent-native-integration-api-reference.md` §1/§6 · `docs/spikes/2026-07-01-agent-native-sidecar-findings.md` §D · `pmo/agent-native/SECURITY.md` · `pmo/agent-native/scripts/create-agent-native-role.sql` · `pmo/agent-native/{package.json,nitro.config.ts,.env.example}` · `docs/environments.md`.

---

## Scope & intent (read first)

This is the **deploy design** for agent-native whole-UI (ADR-0040 Option B). It is a **runbook + design doc only — no execution here.**

- ✅ Covers: how Option B ships to prod behind the feature flag (`VITE_FEATURES_AGENT_NATIVE`) once gated.
- ⛔ **DEFERRED (not this doc, not now):** retirement of Option A (`supabase/functions/agent-chat/*`, `pmo-portal/src/components/panel/*`, `pmo-portal/src/lib/agent/runtime/*`). Retirement is the other E8 half (`AC-422`, E8 tasks #1–#2), **staged behind E5 live parity**. Option A stays live and is the active fallback while this runbook's flag is OFF. `compose_view` retention (`AC-421`) is likewise untouched — it stays authoritative until E7 records a retire/keep.
- ⛔ No code, no migration files, no CF Function files, no prod push. The proxy below is a **sketch in this doc** for E8-execution to materialize later.

**Single-load-bearing architectural fact (finding §D):** PMO today is **pure-static Cloudflare Pages + serverless Supabase Edge Functions** — there is **no always-on server process**. agent-native requires a **Nitro Node server** (Node ≥22.22, `better-sqlite3` native → Workers ✗). Adopting it whole therefore introduces **PMO's first self-operated always-on long-running server process** (a Node process on a VPS), fronted by a same-origin Cloudflare Pages Function proxy so the browser's bearer handoff stays on the Pages origin. This runbook is the design for that change.

---

## 1. Topology

```
┌───────────────────────┐      ┌───────────────────────────────┐      ┌──────────────────────────────────┐
│ Browser (PMO SPA)     │      │ Cloudflare Pages              │      │ VPS  — Nitro Node ≥ 22.22         │
│ pmo-bfb.pages.dev     │      │ project `pmo`, prod branch    │      │ pmo/agent-native                  │
│                       │      │ `production`                  │      │ .output/server/index.mjs (:PORT)  │
│ <AgentNativeEmbedded> │      │                               │      │                                   │
│  + ensureEmbedAuth    │ ──1▶ │  static SPA build (dist/)     │      │  global deputy middleware         │
│    FetchInterceptor   │      │  + Pages Function proxy:      │ ──2▶ │   → verifyJwt (service_role:      │
│  attaches             │      │    functions/_agent-native/   │      │     getUser + profiles ONLY)      │
│  Authorization:       │      │    [[path]].ts                │      │   → host AsyncLocalStorage        │
│  Bearer <PMO jwt>     │      │  forward method / body /      │      │   → PMO defineAction              │
│  on every             │      │  Authorization → VPS origin   │      │      (pmo_query / create_activity │
│  /_agent-native/*     │      │  (same-origin ⇒ interceptor   │      │       / update_task_status /      │
│                       │ ◀─4─ │   keeps working)              │ ◀─3─ │       query_entity)               │
└───────────────────────┘      └───────────────────────────────┘      └───────────────┬───────────────────┘
                                                                                      │ 5
                                                                                      ▼
                                                                  ┌──────────────────────────────────────┐
                                                                  │ Supabase Cloud (prod project)        │
                                                                  │  • public schema  — PMO business     │
                                                                  │    data, RLS resolves as the CALLER  │
                                                                  │    (anon key + caller JWT)           │
                                                                  │  • agent_native schema — framework   │
                                                                  │    OWN tables, reached via the       │
                                                                  │    agent_native_app role             │
                                                                  │    (search_path = agent_native,      │
                                                                  │     public). NEVER PMO business data │
                                                                  └──────────────────────────────────────┘
```

**Flow legend**

1. Browser calls **same-origin** `/_agent-native/<route>`; `ensureEmbedAuthFetchInterceptor` (`@agent-native/core/client`) attaches `Authorization: Bearer <PMO session JWT>` from `sessionStorage`. Same-origin is the whole point — it is what makes the bearer interceptor work without CORS.
2. The Cloudflare **Pages Function** at `pmo-portal/functions/_agent-native/[[path]].ts` forwards `method` + `body` + `Authorization` (+ content-negotiation headers) to the VPS Nitro origin `https://<vps-host>:<PORT>/_agent-native/<route>`.
3. Nitro's **global deputy middleware** (`server/middleware/deputy.ts`) runs before every `/_agent-native/**` handler: verifies the JWT via `service_role` (`auth.getUser` + `profiles` read, identity only) and enters a host `AsyncLocalStorage` carrying the raw caller JWT for the downstream async chain.
4. Response streams back browser-wards through the Function (status + headers preserved).
5. The PMO `defineAction` builds a **caller-scoped Supabase client** (`anon` key + caller JWT) → PMO `public` schema reads/writes resolve under the **caller's** RLS (org_id ceiling). The framework's **own** tables live in the isolated `agent_native` schema via the `agent_native_app` role's `search_path` (no PMO business data ever crosses this role). RLS is the enforcement ceiling; the FE/middleware may be stricter.

**Correctness notes**

- `FRAMEWORK_ROUTE_PREFIX = "/_agent-native"` (`@agent-native/core/server`, API-ref §6). The Function path mirrors it exactly so the interceptor's URL key matches.
- **CF Pages request order: Functions run *before* `_redirects`.** The SPA fallback `/* /index.html 200` (`pmo-portal/public/_redirects`) therefore does **not** swallow `/_agent-native/*` — the proxy handles those and only non-asset, non-Function paths fall through to the SPA shell.
- The VPS origin must serve **TLS** (the Pages Function `fetch` to it is a cross-origin server-to-server call). Same-origin is browser↔Pages; Pages↔VPS is origin-to-origin over HTTPS.

---

## 2. VPS Nitro process

### 2.1 Build & run

Run inside `pmo/agent-native/` (Node **≥ 22.22**, pinned via the package `engines` field — F6; enforce with `nvm use`/system Node on the VPS, **not** 22.20):

```bash
npm ci                 # exact pins; @agent-native/core@0.84.8, no ^/~/latest
npm run build          # nitro build  →  .output/server/index.mjs  (node-server preset)
npm start              # = node .output/server/index.mjs   (binds PORT / NITRO_PORT)
```

`PORT`/`NITRO_PORT` selects the listen port (local `.env` uses `8100`); `HOST`/`NITRO_HOST` selects the bind interface (bind to localhost + terminate TLS at the reverse proxy — see 2.3).

### 2.2 Process manager — systemd (recommended)

Systemd unit `/etc/systemd/system/pmo-agent-native.service`:

```ini
[Unit]
Description=PMO agent-native (Nitro) — Option B sidecar
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=agent-native
Group=agent-native
WorkingDirectory=/opt/pmo/agent-native
EnvironmentFile=/etc/pmo/agent-native.env          # secrets; chmod 600, root:root, NOT in git
ExecStart=/usr/local/bin/node .output/server/index.mjs
Restart=on-failure
RestartSec=5s
# Hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/opt/pmo/agent-native/.output /opt/pmo/agent-native/data
# Drop privileges; no network re-bind tricks needed
CapabilityBoundingSet=
AmbientCapabilities=

[Install]
WantedBy=multi-user.target
```

`pm2` (`pm2 start .output/server/index.mjs --name pmo-agent-native` + `pm2 save` + `pm2 startup`) is an acceptable alternative; prefer systemd on the VPS for fewer moving parts and native `journald` logging. Either way: **auto-restart on crash, restart-on-boot, single dedicated unprivileged OS user.**

### 2.3 Reverse proxy (TLS termination)

Terminate TLS at the VPS reverse proxy (Caddy is the low-ceremony choice; nginx fine) in front of Nitro:

- Caddy: `vps.example.com { reverse_proxy 127.0.0.1:8100 }` (auto-Let's-Encrypt). Nitro binds `HOST=127.0.0.1` only.
- Restrict `/` to the Cloudflare Pages egress IPs (or a shared secret header) so only the Pages Function can reach Nitro — Nitro is **not** a public origin.

### 2.4 Environment & secrets

**Secrets source:** 1Password vault `AS`, fetched at runtime via the sanctioned `op-get.sh <item> <vault> <field>` (same posture as the prod DB URL — never read `~/.op-token`; never commit a real key). The systemd `EnvironmentFile=/etc/pmo/agent-native.env` is written at deploy time from 1Password and is root-owned / `chmod 600` / gitignored.

| Variable | Secret? | Source | Used by | Notes |
|---|---|---|---|---|
| `ANTHROPIC_API_KEY` | **SECRET** | 1Password | `server/lib/model.ts` (E5) + framework `agent-chat-plugin` (confirmed in `dist/server/agent-chat-plugin.js`) | Server-only. NFR-406 / AC-415: must never reach the browser bundle. |
| `SUPABASE_URL` | public-safe | prod cloud API URL (`https://<ref>.supabase.co`) | `server/lib/supabase.ts` `supabaseUrl()` | |
| `SUPABASE_ANON_KEY` | public-safe | prod anon key | `createCallerClient` (anon + caller JWT) | Ships in the SPA bundle anyway; RLS is the authority. |
| `SUPABASE_SERVICE_ROLE_KEY` | **SECRET** | 1Password | `createVerifierClient` → `verifyJwt` (`auth.getUser` + `profiles` ONLY) | Single confined use; never the business path (AC-606 static-scan invariant). |
| `DATABASE_URL` | **SECRET** | 1Password | plugin `databaseUrl` → `agent_native_app` role | Must use the **agent_native_app role with a SECRET password** (see §2.5 + §4). Direct DB port 5432 (Session pooler) — same guidance as `docs/environments.md`. |
| `A2A_SECRET` | **SECRET** | 1Password (generate a strong random value) | framework A2A token sign/verify (confirmed in `dist/org/context.js`) | Required only if A2A is exercised; set it regardless so inbound tokens are verified (surface 3, `SECURITY.md`). |
| `BETTER_AUTH_SECRET` | **SECRET** | 1Password (generate a strong random value) | framework better-auth session crypto (`dist/secrets/crypto.d.ts`) | Framework session integrity. |
| `PORT` / `HOST` | non-secret | plaintext | Nitro listen | `PORT=8100`; `HOST=127.0.0.1` (behind reverse proxy). |

> **Framework-secret verification posture:** `A2A_SECRET` / `BETTER_AUTH_SECRET` / `ANTHROPIC_API_KEY` are read by `@agent-native/core` (confirmed present in the pinned `0.84.8` dist). The framework churns ~4×/day pre-1.0 — **on every pin bump, re-derive the exact secret set the new version reads** (re-run `grep -rln "<VAR>" node_modules/@agent-native/core/dist`) and update this table. `SECURITY.md` already mandates this re-derivation for the surface registry; extend it to the secret set.

### 2.5 The dedicated DB role — and the **secret-password hardening** (call this out)

`pmo/agent-native/scripts/create-agent-native-role.sql` creates the `agent_native_app` role with **a hardcoded password `agent_native_pw`** and sets its `search_path = agent_native, public`. That literal is **LOCAL-ONLY.**

> ⚑ **Prod hardening (binding):** the `agent_native_app` password in prod MUST be a **secret injected from 1Password**, never the committed `agent_native_pw` literal. The role-level `search_path` is the load-bearing schema-isolation seam (finding F3 / AC-403 gate-5) — keep it; only the **password** changes for prod.

Concretely, prod never runs `create-agent-native-role.sql` as-written. §4 specifies the prod provisioning path (committed migration creating the schema + role + grants; **secret password set separately** via an `ALTER ROLE … PASSWORD '<secret>'` step sourced from 1Password, owner-gated, per-instance).

---

## 3. Cloudflare Pages Function proxy (sketch — do NOT create yet)

The Pages project root is `pmo-portal/`. The proxy is a **filesystem-routed** Pages Function at `pmo-portal/functions/_agent-native/[[path]].ts` — the `[[path]]` optional catch-all maps `/_agent-native`, `/_agent-native/health`, `/_agent-native/mcp`, … all to this one handler. It runs on the Cloudflare Workers runtime (global `fetch`, no Node built-ins), so it is a thin streaming forwarder.

**Sketch (for E8-execution to materialize later — NOT created by this doc):**

```ts
// pmo-portal/functions/_agent-native/[[path]].ts
// Same-origin proxy: browser /_agent-native/* → VPS Nitro origin.
// Forwards method + body + Authorization so the deputy middleware receives the
// caller's PMO JWT. Runs BEFORE _redirects, so the SPA fallback does not swallow it.

interface Env {
  AGENT_NATIVE_ORIGIN: string; // e.g. https://vps.example.com:8100 (set in Pages dashboard)
  // Optional shared-secret header to restrict origin egress (recommended):
  AGENT_NATIVE_EGRESS_TOKEN?: string;
}

// Safe request headers to forward (whitelist, never forward everything — anti-smuggle).
const FORWARD_HEADERS = ["authorization", "content-type", "accept", "accept-language"];

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.AGENT_NATIVE_ORIGIN) {
    return new Response("agent-native origin not configured", { status: 502 });
  }

  const incoming = new URL(request.url);
  const upstream = new URL(env.AGENT_NATIVE_ORIGIN);
  upstream.pathname = incoming.pathname;          // preserves /_agent-native/...
  upstream.search = incoming.search;

  const headers = new Headers();
  for (const h of FORWARD_HEADERS) {
    const v = request.headers.get(h);
    if (v) headers.set(h, v);
  }
  // Optional: prove the request came from our Pages Function (origin egress gate).
  if (env.AGENT_NATIVE_EGRESS_TOKEN) {
    headers.set("x-agent-native-egress", env.AGENT_NATIVE_EGRESS_TOKEN);
  }

  // Stream the body for non-safe methods (Workers: duplex:"half" is required for a streamed body).
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const init: RequestInit = {
    method: request.method,
    headers,
    ...(hasBody ? { body: request.body, duplex: "half" } : {}),
    // Do NOT follow redirects; surface upstream status verbatim.
    redirect: "manual",
  };

  const upstreamRes = await fetch(upstream.toString(), init);

  // Pass status + a whitelisted subset of response headers back to the browser.
  const resHeaders = new Headers();
  for (const h of ["content-type", "cache-control", "x-request-id"]) {
    const v = upstreamRes.headers.get(h);
    if (v) resHeaders.set(h, v);
  }
  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    headers: resHeaders,
  });
};
```

**Binding & deploy notes (E8-execution):**

- Set `AGENT_NATIVE_ORIGIN` (= VPS origin) and `AGENT_NATIVE_EGRESS_TOKEN` as **Pages → Settings → Environment variables** on the **Production** environment.
- Pages Functions build automatically from `pmo-portal/functions/` (they are part of the Pages project, not the Vite SPA build). Confirm the project root + Functions directory are picked up by the existing Pages build (root dir `pmo-portal`, output `dist`).
- **Header whitelist** (request + response) is deliberate — never forward `cookie`, `host`, hop-by-hop, or `cf-*` headers either way; it prevents header-smuggling and keeps the VPS from seeing CF-internal headers.
- Streaming SSE (the agent chat stream) works because the response body is passed through unwrapped; Workers support streaming `ReadableStream` bodies.

---

## 4. Prod schema — `agent_native` schema + role provisioning

Two distinct schema concerns; do not conflate them:

| Concern | Schema | Who creates it | Auth/RLS |
|---|---|---|---|
| **Framework OWN tables** (28 today: sessions, threads, resources, …) | `agent_native` | agent-native's own boot-time raw DDL via the `agent_native_app` role | None needed — framework data, **not** PMO business data; isolated by role `search_path`. No `org_id` seam applies. |
| **PMO business data** | `public` | existing `supabase/migrations/` (already on prod) | **RLS by caller JWT** (deputy client). `org_id` seam + RLS already enforced. agent-native never owns these. |

### 4.1 Recommended path — promote the role/schema into a committed migration

The current `pmo/agent-native/scripts/create-agent-native-role.sql` is a **standalone script, not a committed migration**, and it hardcodes `agent_native_pw`. To honor the project's binding rule (**`supabase/migrations/` is the single source of truth; reversible migrations; never hand-edit a cloud schema**) the role + schema + grants should be promoted into a **new forward migration** (e.g. `supabase/migrations/0046_agent_native_schema.sql`) that is:

- **reversible** (`create schema` / `drop schema cascade`; `create role` / `drop role` — guarded with `do $$ … $$` existence checks like the existing script),
- **idempotent** (re-runnable on `db reset` and on `db push`),
- **password-less at migration time** (create the role `login` with no password, or a clearly-marked `!!replace-me!!` placeholder), and
- **grants identical** to the current script: `create schema if not exists agent_native; … grant usage, create on schema agent_native to agent_native_app; grant usage on schema public to agent_native_app; alter role agent_native_app set search_path = agent_native, public;`.

That migration then flows through the **documented `scripts/db-push-prod.sh` flow** (typed `prod` confirm, explicit `--db-url`, secret via 1Password) — owner-gated, per-instance, exactly as every other prod migration. *(Planning recommendation only — do not write the migration in this docs-only issue; flag it as an E8-execution task for the Director.)*

### 4.2 The secret password — owner-gated, per-instance, from 1Password

After `db-push-prod.sh` applies the migration, the role exists but has **no usable password**. The secret is injected as a **separate, one-time** step (the project's standard pattern for a secret that cannot live in a committed migration — same posture as the prod DB URL):

```bash
# Resolve a strong random secret from 1Password (or generate + store it there first).
PW="$(op-get.sh agent-native-db-password AS password)"   # example coordinates; confirm in supabase/op.prod.env
# Apply against prod with the secret as a psql variable (never on the CLI where it leaks via ps):
psql "$(scripts/db-push-prod.sh --print-url)" -v pw="$PW" -c "ALTER ROLE agent_native_app PASSWORD :'pw';"
# Then set DATABASE_URL on the VPS = postgresql://agent_native_app:<PW>@<prod-host>:5432/postgres
```

(If `db-push-prod.sh` has no `--print-url` today, resolve `SUPABASE_PROD_DB_URL` the same way the script does — `op-get.sh "$OP_PROD_ITEM" "$OP_PROD_VAULT" "$OP_PROD_FIELD"` per `supabase/op.prod.env` — and pass it to `psql`.)

### 4.3 Framework tables — created automatically at first boot

The 28 framework tables are **not** a migration: agent-native runs its own raw DDL on boot against `DATABASE_URL` (the `agent_native_app` role). Because the role's `search_path = agent_native, public`, the unqualified `CREATE TABLE` statements land in `agent_native` and **never leak into `public`** (proven: AC-403 gate-5, "0 leaked into public"). So once §4.1 + §4.2 are done, the first Nitro boot against the prod-shaped `DATABASE_URL` materializes the framework tables in the right schema. No manual DDL.

### 4.4 Rollback of the schema

- `drop schema agent_native cascade` removes all framework tables (no PMO data touched — they are in `public`).
- `drop role agent_native_app` (only after the schema drop + revoking grants) removes the role.
- Both belong in a paired **down** migration (or are applied manually if a forward-only posture is chosen). Because framework tables hold no irreplaceable PMO data, a clean drop/re-create on a Nitro restart is acceptable; thread/session history is framework-owned and disposable.

---

## 5. Go-live checklist — flag stays OFF in prod until ALL green

The feature flag `VITE_FEATURES_AGENT_NATIVE` (per E3) **stays OFF** in prod until every item below is signed off. Option A remains live and is the active fallback the entire time.

- [ ] **E5 live loop verified end-to-end** against a **prod-shaped** deploy (real `ANTHROPIC_API_KEY`): `AC-413` (prompt returns a model-authored answer + ≥1 tool-call card through the live server path), `AC-414` (owner smoke: panel answers, calls a PMO action, stays on-brand), `AC-415` (no `ANTHROPIC_API_KEY` literal in the built frontend bundle).
- [ ] **Rendered G1 QA passed** — `design-reviewer` renders the running app on rich seed, open-ended audit, **every finding graduated** to a test + `routes × oracles` cell + `DESIGN.md`/`docs/decisions.md` note; re-render until clean (ADR-0030 Discover step).
- [ ] **Deputy gate green against the prod-shaped deploy** — `AC-403` (5/5) **and** the expanded `AC-601…AC-607` surfaces gate (`test/deputy-invariant.gate.test.ts` + `test/deputy-surfaces.gate.test.ts`) re-run against the deployed Nitro + prod DB. Cross-tenant read/write still denied; `service_role` still off the business path; `agent_native` schema still isolated.
- [ ] **Secret-password hardening done** — `agent_native_app` password in prod is a 1Password secret, **not** `agent_native_pw`; `ALTER ROLE` applied; `DATABASE_URL` on the VPS uses it (§4.2).
- [ ] **Nitro healthy on the VPS + proxy reaches it** — `systemctl status pmo-agent-native` active/stable; `GET /_agent-native/health` (public, surface 8) returns 200 through the Pages Function; `AC-423` deploy-smoke green (same-origin `/_agent-native/*` reaches Nitro in the deployed env).
- [ ] **All secrets provisioned & server-only verified** — `ANTHROPIC_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `A2A_SECRET`, `BETTER_AUTH_SECRET` in the VPS `EnvironmentFile` from 1Password; bundle-leak guard (`pmo-portal/scripts/no-secret-leak.test.ts`) green.
- [ ] **Rollback drill passed** — flag-off confirmed to instantly disable with zero user impact (Option A still serving); Nitro-stop procedure rehearsed (§6).
- [ ] **Monitoring + alerting live** on the Nitro process (§7) before the flip.
- [ ] **Owner sign-off** to set `VITE_FEATURES_AGENT_NATIVE=true` on the Pages Production environment (this is the go-live gate).

---

## 6. Rollback

**Instant disable (primary lever): flag OFF.** Set `VITE_FEATURES_AGENT_NATIVE=false` (or unset) on the Cloudflare Pages **Production** environment and trigger a rebuild/promote. The embed host (`AgentNativeHost.tsx`, E3) gates on the flag; when off, the slot renders nothing and the browser issues **zero** `/_agent-native/*` calls. Because **Option A is NOT retired yet** (deferred), the existing `agent-chat` edge function / `AssistantPanel` / runtime port keep serving the assistant — **zero user impact, no data migration, no schema change.**

**Stop the Nitro process (secondary lever — belt-and-suspenders):**

```bash
sudo systemctl stop pmo-agent-native     # systemd
# or
pm2 stop pmo-agent-native                # pm2 alternative
```

With the process down, the Pages Function proxy returns 502 for any stray `/_agent-native/*` call; harmless while the flag is off (the embed isn't rendered). Optionally remove/disable the Function (`pmo-portal/functions/_agent-native/`) in the same deploy, but it is not required for rollback correctness.

**No data rollback is needed** — Option B wrote only (a) framework tables in the isolated `agent_native` schema (disposable) and (b) PMO business rows through RLS as the caller (identical authority to Option A's writes). Disabling the flag leaves PMO data exactly as any authorized assistant action would have left it.

---

## 7. Cost / ops

### 7.1 A new always-on process

PMO's current tier is **static Cloudflare Pages + serverless Supabase Edge Functions** — nothing always-on. The Nitro Node process is **PMO's first self-operated always-on long-running server process** (the brief/findings call it a "second long-running process"; operationally it is the *first* always-on process PMO must run, patch, and monitor — **open question Q1** for the Director to reconcile the framing). Real costs:

- **A VPS** to host it (RAM for Node + `better-sqlite3` native; the pilot ran comfortably on the owner's machine — size for peak concurrent agent turns + the framework's per-thread state).
- **Operational burden** — a second thing that can be down, OOM, or drift on deploys. systemd `Restart=on-failure` + the health endpoint are the floor; an external uptime monitor (see below) is required.
- **Egress** — Pages Function → VPS traffic (free tier covers it at PMO scale; watch if agent traffic spikes).
- **Anthropic spend** — per-turn LLM cost; set a budget alert (Q4).

### 7.2 Pre-1.0 upgrade cadence (pin + canary)

`@agent-native/core@0.84.8` churns **~4×/day pre-1.0** (9 patches in ~24h observed; `h3` is `2.0.1-rc`, `nitro` `3.0.260415-beta` — all pre-release). A bump is a **deliberate, reviewed act — never transitive, never `^`/`latest`**. Cadence (binding, from `SECURITY.md` + NFR-407):

1. **Bump the exact pin** in `pmo/agent-native/package.json`.
2. `npm ci && npx tsc --noEmit` — type surface intact.
3. **Re-derive the surface registry** in `pmo/agent-native/SECURITY.md` against the new `dist/**/*.d.ts` + a booted sidecar probe (`curl` every route: no-auth / fake-bearer / valid-PMO-jwt). Also re-derive the **secret set** (§2.4).
4. **Run both gate suites green**: `test/deputy-invariant.gate.test.ts` (AC-403, 5/5) + `test/deputy-surfaces.gate.test.ts` (AC-601…AC-607). **Any RED blocks the bump** — the canary is the gate, not human review.
5. **Canary before prod**: ship the bump to a staging-shape (or the owner's machine) first; confirm the live loop (E5) + deputy gate against the bumped pin; only then promote to the prod VPS.

Recommended cadence: bump on a **monthly deliberate schedule** (or on a needed feature/fix), not on every upstream patch. Pin `@agent-native/core` + `h3` + `nitro` together — they move in lockstep.

### 7.3 Monitoring

- **Liveness:** systemd `Restart=on-failure`; external uptime monitor pinging `GET /_agent-native/health` (public, surface 8) through the Pages origin every ~30s; page on 2 consecutive failures.
- **Readiness / correctness:** synthetic cross-tenant probe in monitoring (drive a PMO action as org-A, assert org-B rows invisible) — the deputy invariant as a live canary, not just CI.
- **Logs:** `journald` (systemd) / `pm2 logs`; watch the deputy middleware's `[deputy] verifyJwt threw — degrading request to anonymous` warning rate (a spike signals GoTrue/`profiles` reachability trouble).
- **Metrics/alerts:** process down; 5xx rate on `/_agent-native/*`; p95 latency per action; DB connection-pool exhaustion; Anthropic API error/quota/spend.
- **Security drift:** the `SECURITY.md` surface registry + the gate suites are the regression net for any pin bump or new PMO action — keep them mandatory in CI on every `pmo/agent-native/**` change.

---

## Open questions for the Director

- **Q1 — "second long-running process" framing.** Finding §D and the dispatch brief both say "second long-running process," but PMO runs **zero** always-on processes today (static CF Pages + serverless edge fns). This is the **first** always-on process PMO operates. Confirm the intended referent (second *compute tier* beyond CF? or anticipating another service?) so the cost framing in `docs/adr/0040-…` is precise.
- **Q2 — Promote `create-agent-native-role.sql` to a committed migration?** Recommended in §4.1 (matches "migrations are the single source of truth"). This is an E8-execution task (code), **not** this docs issue — flag it for the implementer. Decision needed: forward migration with `drop`/`create` + a separate secret-injected `ALTER ROLE`, vs. keeping the standalone script and documenting a manual psql step.
- **Q3 — Reverse proxy + origin egress gate.** Caddy vs nginx on the VPS, and whether to restrict Nitro ingress to CF Pages egress IPs (or the `AGENT_NATIVE_EGRESS_TOKEN` shared secret in §3). Confirm the VPS + TLS posture before E8-execution.
- **Q4 — Anthropic spend guard.** Budget cap / per-org quota policy before the public-prod flip (cost containment for an always-on agent surface). Out of scope for this runbook but required before go-live.

---

## Self-verification (confirm coverage before commit)

| Required (dispatch brief) | Covered? | Where |
|---|---|---|
| 1. Topology — CF Pages → Pages Function proxy `/_agent-native/*` → VPS Nitro (:PORT), forwarding `Authorization`; diagram | ✅ | §1 (+ ASCII diagram, flow legend) |
| 2. VPS Nitro process — build/run, Node ≥22.22, systemd/pm2, env/secrets (ANTHROPIC / SUPABASE_URL/ANON/SERVICE_ROLE / A2A_SECRET / BETTER_AUTH_SECRET), dedicated DB role | ✅ | §2 (2.1–2.5) |
| 2 (hardening) — secret-injected password, **NOT** the local `agent_native_pw` literal, called out explicitly | ✅ | §2.5 + §4.2 + §5 checklist |
| 3. CF Pages Function — `functions/_agent-native/[[path]].ts` proxy sketch (forward method/body/Authorization; same-origin), fenced code block, no real file created | ✅ | §3 (sketch only) |
| 4. Prod schema — `agent_native` schema + role provisioning via `db-push-prod.sh` flow; owner-gated, per-instance | ✅ | §4 (4.1–4.4) |
| 5. Gate before enable — flag OFF until E5 live loop + rendered G1 QA + deputy gate green vs prod-shaped deploy; go-live checklist | ✅ | §5 |
| 6. Rollback — flag-off = instant disable (Option A still live); stop Nitro | ✅ | §6 |
| 7. Cost/ops — always-on process, pre-1.0 pin+canary cadence, monitoring | ✅ | §7 |
| DO-NOT: no Option-A retirement, no execution, no real CF function file, no push/PR/merge | ✅ | Scope (top) + §3 is sketch-only |

E8-DEPLOY-DOCS-DONE
