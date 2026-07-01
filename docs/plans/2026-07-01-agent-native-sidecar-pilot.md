# PLAN: agent-native sidecar PILOT (local/VPS execution)

**Date:** 2026-07-01 · **Type:** throwaway pilot (go/no-go gate before any adopt-whole decision).
**Reads first:** `docs/spikes/2026-07-01-agent-native-sidecar.md` (context + verdict). **Extends:** ADR-0040.

## HANDOFF — who runs this

A **local Claude Code / agent session on the owner's machine or VPS** — NOT the remote build container
(which has no `deno.land`/npm reachability for the Nitro runtime, no Docker-hostable Nitro, and no LLM key).
You need, locally:
- Docker + the PMO local Supabase stack up (`supabase start`) — Postgres at `127.0.0.1:54321`.
- Node ≥ 22, internet to npm.
- A real **`ANTHROPIC_API_KEY`** (or an OpenRouter key if you also pilot the provider swap — separate track).
- This repo checked out.

**Output:** a go/no-go on adopting agent-native "whole", backed by (a) a passing **deputy-invariant test**
and (b) a **measured churn/upgrade-toil** number. Keep everything **throwaway on a branch**; do NOT merge the
sidecar into `dev`/`main` until the owner approves adopt-whole. This plan doc + your findings note are the
only things that land.

## ⚠ Standing caveat — the API churns ~4×/day (0.x)

Every symbol below (`createAgentNativeEmbeddedPlugin`, the `auth(event)` shape, `defineAction`,
`ActionRunContext`, `<AgentSidebar>`, `@agent-native/core/client`) is a **2026-07-01 snapshot** of a
pre-1.0 project publishing multiple times per day. **Before coding each step, verify the real surface**
against the *installed, pinned* version — `node_modules/@agent-native/core/dist/*.d.ts`, its shipped
`docs/content/*.mdx`, and `packages/core/src/{action,server/embedded}.ts` on the matching git tag. If a name
moved, follow the installed types, not this doc. Treat drift as expected, not as a blocker.

## Pin, don't track

```bash
mkdir -p pmo/agent-native && cd pmo/agent-native
npm init -y
npm i @agent-native/core@0.84.7        # PIN EXACT. bump deliberately, never ^ / latest.
npm i @supabase/supabase-js@^2          # deputy client, mirrors PMO's edge fn
# record the exact resolved version + date in your findings note (churn baseline)
```
(If `@agent-native/core@0.84.7` is gone/yanked by the time you run this — likely — pin whatever is current,
and **note the version** so the churn measurement in Step 6 is anchored.)

## The deputy pattern to mirror (PMO already does this — `supabase/functions/agent-chat/index.ts`)

Two clients, exactly as the shipped edge fn:
```ts
// verify identity — service_role ONLY for auth.getUser, NEVER for business data (NFR-AR-SEC-002)
const verifier = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const { data: { user } } = await verifier.auth.getUser(jwt);           // → user.id, claims

// the DEPUTY client — RLS applies AS THE CALLER (this is the whole invariant)
const caller = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  global: { headers: { Authorization: `Bearer ${jwt}` } },
});
```
The pilot's job is to make agent-native's actions call domain data **through the `caller` client**, so RLS
stays the enforcement ceiling — never through agent-native's own Drizzle tables and never via `service_role`.

## Steps (2–5 min each; verify each API against the installed version first)

**Step 1 — dedicated schema for agent-native's own state.** It manages its own Drizzle tables and needs a
DB (spike §Data model). Point it at a **separate schema** in the local Supabase Postgres, not `public`:
```bash
psql "$LOCAL_DB_URL" -c 'create schema if not exists agent_native;'
# .env:  DATABASE_URL=postgresql://…@127.0.0.1:5432/postgres?search_path=agent_native
```
Keep PMO's `public` schema untouched — that isolation is a pilot requirement.

**Step 2 — mount the embedded plugin with BYOA.** Verify the `createAgentNativeEmbeddedPlugin` /
`agentNative()` signature against installed types, then wire `auth(event)` to **verify a Supabase JWT** and
map claims. Do NOT trust browser-sent identity (their docs say the same):
```ts
// verify the incoming Supabase JWT server-side; map to the framework identity shape
auth: async (event) => {
  const jwt = readBearer(event);                 // from Authorization header (proxied, below)
  const { data: { user } } = await verifier.auth.getUser(jwt);
  if (!user) return null;
  // stash the raw JWT for Step 3's caller-scoped calls (framework only hands you normalized identity)
  event.context.callerJwt = jwt;
  return { userId: user.id, email: user.email, orgId: user.app_metadata?.org_id, orgRole: user.app_metadata?.role };
}
```

**Step 3 — one deputy-bound action over PMO data.** A single `defineAction` whose `run(args, ctx)` builds
the **caller** client from the stashed JWT and calls an existing PMO surface (e.g. list companies/projects,
then a write). This proves domain access flows through PMO's RLS, not agent-native's DB:
```ts
defineAction({
  schema: z.object({ /* … */ }),
  run: async (args, ctx) => {
    const caller = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${ctx /* → the stashed raw JWT */}` } },
    });
    return caller.from('companies').select('*');   // RLS-scoped AS the caller
  },
});
```
Prove one **read** and one **write** (e.g. `create_activity`, mirroring A3).

**Step 4 — embed the panel + same-origin proxy.** Render `<AgentSidebar>` (from `@agent-native/core/client`
— in-tree React 19, NOT `code-agents-ui`) in a minimal shell (or a copy of the PMO shell). Front the Nitro
server same-origin: locally via the Vite dev proxy (`/agent/* → 127.0.0.1:<nitro>`), forwarding
`Authorization`. (Prod shape later = a CF Pages Function proxy → the VPS; not needed for the pilot.)

**Step 5 — THE GATE (required): deputy-invariant test.** Sign in as user A (org 1). Drive the agent to
read AND write a row owned by user B / org 2. **Both must be DENIED by RLS**, surfaced as a clean tool error,
with **no** service-role path anywhere in the action. Also assert an action cannot reach data via
agent-native's own Drizzle tables. Write this as an automated test in the pilot dir. **If this gate is red,
stop — the adoption is unsafe until it's green.**

**Step 6 — measure churn.** Note the pinned version + date. After ~a week (or bump to the newest release),
`npm i @agent-native/core@latest`, rebuild, and **count what broke** (types, API renames, behavior). Record
the toil. This number is half the adopt-whole decision.

## Decision (after Steps 5 + 6)

| Outcome | Pick |
|---|---|
| Gate green + churn tolerable + embed clean | **Adopt whole** — colocate pinned, own an upgrade cadence, plan the static→server change for `pmo-portal` (agent-native needs a Nitro server; PMO is static today — this is the real integration cost to design next). |
| Gate green but churn/second-DB too costly | **Cherry-pick** — borrow the `AgentChatRuntime` + `defineAction` shape into our existing edge-fn engine; skip the framework. |
| Gate red, or embed fights PMO's shell | **Stop** — keep the edge-fn deputy; revisit at their 1.0. |

## Report back (into a findings note + update `docs/backlog.md` "NEXT DECISION")

- Deputy-invariant gate: pass/fail + the denied read/write evidence.
- Churn number (versions bumped, breaks counted).
- Embed reality: does `<AgentSidebar>` coexist with PMO's nav, or does it want to own the frame?
- The static→server question for `pmo-portal` (does adopting it force PMO off pure-static Cloudflare Pages?).
- Recommendation: adopt-whole / cherry-pick / stop.
