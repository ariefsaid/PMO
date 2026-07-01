# FINDINGS: agent-native sidecar PILOT — run results

**Date:** 2026-07-01 · **Type:** pilot report (closes `docs/plans/2026-07-01-agent-native-sidecar-pilot.md`).
**Worktree:** `pilot/agent-native-sidecar` (off `dev` @ `7b4064d`). **Throwaway — NOT merged.** Extends
`docs/spikes/2026-07-01-agent-native-sidecar.md` + ADR-0040.

> **Ran locally on the owner's machine (VPS-shaped):** local Supabase up, Node 22.20, real
> `@agent-native/core@0.84.8` pinned exact. LLM stubbed (no `ANTHROPIC_API_KEY` — see §Caveats); the
> **security gate is real and reproducible without a key**.

---

## TL;DR — RECOMMENDATION

> **Gate GREEN. Churn tolerable (so far). Embed clean (coexists via composition, not capture).
> Recommendation: conditionally adopt-whole, pending owner sign-off on two real costs — (1) the
> static→server move for `pmo-portal` and (2) the second data layer + upgrade cadence.** See §Decision.

The deputy invariant — the entire point of the pilot — holds: agent-native's action path carries the
real caller identity and is **denied cross-tenant read AND write** by PMO's RLS, with no
`service_role` business path and full schema isolation. The framework gives **no clean
raw-credential seam to actions** (a material correction to the plan — §Findings F2), so the deputy is
hand-built on a host `AsyncLocalStorage`; that is the cost the spike warned about, and it is
buildable + testable.

---

## A. Deputy-invariant gate — ✅ GREEN (5/5)

`pmo/agent-native/test/deputy-invariant.gate.test.ts` — Vitest, drives the full deputy chain over
real HTTP (Nitro :8100, two real Supabase JWTs minted via the password grant for two orgs).

| # | Assertion | Result | Evidence |
|---|---|---|---|
| 1 | Cross-tenant READ denied | ✅ | user A `list_companies` → **11 rows (all org-1)**; the 1 org-2 company in the DB invisible. **0 leaks.** |
| 2 | Cross-tenant WRITE denied | ✅ | user A → org-2 contact insert: **`42501`** "new row violates row-level security policy for table crm_activities". **0 rows persisted.** |
| 3 | Intra-tenant WRITE succeeds (positive control) | ✅ | user A → org-1 contact insert: row returned, `org_id` stamped to org-1 by trigger. Proves #2 is a tenant guard, not a broken action. |
| 4 | No `service_role` business path | ✅ | static scan (comments stripped): business path uses `createCallerClient` only; `service_role` confined to `createVerifierClient`/`verifyJwt` (getUser + `profiles` identity read). |
| 5 | Cross-schema isolation | ✅ | **28 agent-native tables in `agent_native`; 0 leaked into `public`.** |

Gate re-run independently by the Director (not just the subagent's word): 5/5 green on the final
exact pin.

## B. Churn measurement — tolerable today, structurally risky

- **Pinned anchor:** `@agent-native/core@0.84.8` (exact — `package.json` has no `^`), 2026-07-01 09:41 UTC.
- **Bump `0.84.8 → 0.84.9`** (1 patch, ~2h apart): **zero breakage** — `tsc --noEmit` clean, all 5
  gate tests still green, every watched symbol intact (`createAgentNativeEmbeddedPlugin`,
  `defineAction`, `getRequestContext`, etc.).
- **Cadence context (the real signal):** **9 patch releases in ~24h**, all within the 0.84.x minor —
  **no semver-major break yet**. `h3` is on a release candidate (`2.0.1-rc`), `nitro` on a beta
  (`3.0.260415-beta`), `zod@^4`, `drizzle@^0.45`. The velocity is high but currently non-breaking at
  the *surface we depend on*; the risk is that any patch could shift behavior (their semver doesn't
  promise stability pre-1.0).
- **One-week leg:** deferred — the "bump a week of releases, count breaks" measurement runs itself
  later (it's time-bound, not work-bound). Today's delta is already the anchor.

## C. Embed reality — coexists via composition, not capture

`<AgentSidebar>` from `@agent-native/core/client` renders the host as a **flex sibling** (desktop),
inside `.agent-sidebar-main-surface` (`flex-1 overflow-auto`) — **NOT a `position:fixed` overlay**
as both the spike and the plan hypothesized (overlay semantics hold only for mobile ≤767px +
fullscreen). Concretely:

- Host content keeps its own scroll container; nav clicks + scroll work with the panel open.
- **No z-index fight** on desktop (normal flow).
- Open/close animates the panel width; the host is not reflowed into the panel.
- **Implication for real PMO wiring:** `AgentSidebar` wraps the host in an `h-screen overflow-hidden`
  flex shell, so a host that relied on being the document's top-level scroller would have scroll
  delegated to `.agent-sidebar-main-surface`. **For PMO's `App.tsx` `assistant` slot (a
  `position:fixed` overlay per `AppShell`) this is a non-issue — the finding transfers.**

**Same-origin proxy works:** Vite dev proxy `/_agent-native/* → 127.0.0.1:8100` (forwarding
`Authorization`). The panel reached the deputy action through the proxy — `pmo_query list_companies`
returned 11 companies RLS-scoped as `admin@acme.test`; without the token → 401.

**Bonus discovery (lowers integration cost):** agent-native ships a built-in
`ensureEmbedAuthFetchInterceptor()` that auto-injects `Authorization: Bearer <token>` on every
same-origin `/_agent-native/*` call from a `sessionStorage` token. The JWT handoff to the sidecar is
**native, not hand-built** — better than the plan assumed.

## D. The static→server question (the real adopt-whole cost)

PMO is **pure-static Cloudflare Pages today**; `pmo-portal` builds to a static SPA and the agent tier
is Supabase Edge Functions. agent-native **requires a Nitro server** (Node ≥22.22, `better-sqlite3`
native — Workers ✗). Adopting it whole means **operating a second long-running process** (Node on
the VPS) fronted by a CF Pages Function proxy (`/agent/*` → VPS, forwarding `Authorization`). This is
a real architectural change — not a config tweak — and the single biggest integration cost to design
next if adopt-whole is chosen. (The current Edge-Function deputy needs no server.)

## Findings (decision-relevant corrections to the plan)

- **F1 — Drift confirmed, snapshot was 1 version stale.** Plan said `0.84.7`; latest at run time was
  `0.84.8` (now `0.84.9`). Pinned `0.84.8`. The ~4×/day churn estimate is, if anything, conservative.
- **F2 — No clean raw-credential seam to actions (material).** `ActionRunContext` exposes only
  resolved scalars (`userEmail`, `orgId`, `caller`, `signal`, …); `RequestContext` (via
  `getRequestContext()`) is a fixed interface with no index signature; `AuthSession.token` is the
  framework's *own* session-cookie token, not a passthrough. **So the plan's "stash JWT on
  `session.token`, read in `run()`" does not work.** Fix: a **host-owned `AsyncLocalStorage`**
  populated by a Nitro middleware (`server/middleware/deputy.ts`) that verifies the JWT and stashes
  the raw token; actions read it via `getCallerJwt()`. This is the hand-built deputy the spike warned
  about — it is buildable and it is exactly what the gate proves correct.
- **F3 — Schema isolation is NOT via `?schema=`.** agent-native runs raw unqualified DDL (postgres-js)
  and ignores the `?schema=` query param. The only clean isolation is a **dedicated DB role**
  (`agent_native_app`) with `ALTER ROLE … SET search_path = agent_native, public`. Verified: 0 tables
  leaked into `public`.
- **F4 — Embed mechanism (material).** Desktop coexistence is flex-composition, not fixed-overlay
  (§C). The spike's "in-tree React, embeds cleanly" verdict holds; the *mechanism* it assumed was off.
- **F5 — `@tanstack/react-query` + `react`/`react-dom` must be installed explicitly** at the embed
  site (they're peers/transitive, not auto-hoisted). Minor; noted for productization.
- **F6 — Node engines `>=22.22.0`; we ran on `22.20.0`.** Advisory (`engines`), not enforced by npm
  unless `engine-strict`; the native `better-sqlite3` loaded fine on 22.20. A real deploy should pin
  Node ≥22.22.

## Caveats

- **LLM stubbed.** No real `ANTHROPIC_API_KEY` was available in the session, so the agent's *model
  loop* was not exercised (the panel loads; the deputy action is reachable; the model call would
  502). **This does not affect the gate** — the deputy invariant is about identity + RLS, not model
  behavior. Driving the live loop end-to-end (the panel actually answering) waits on a real key in a
  follow-up; it's a productization check, not a security one.
- **Churn is a 1-patch sample.** Tolerable today; the week-long leg will firm it up. Treat the
  pre-release `h3`/`nitro` core deps as the dominant reproducibility risk.

## Decision matrix

| Outcome (per plan) | Result here | Pick |
|---|---|---|
| Gate green + churn tolerable + embed clean | **all three** | → **conditionally adopt-whole** (below) |
| Gate green but churn/2nd-DB costly | churn is *currently* tolerable but structurally risky; 2nd-DB is a real cost | (partial — informs the condition) |
| Gate red or embed fights PMO | neither | (n/a) |

**Recommendation: conditionally adopt-whole**, gated on owner sign-off of:
1. **The static→server move** (§D) — operating a Node/Nitro process on the VPS + a CF Pages Function
   proxy. This is the real cost; if the owner doesn't want a second long-running service, **fall back
   to cherry-pick** (borrow the `AgentChatRuntime` + `defineAction` shape into the existing edge-fn
   engine; skip the framework).
2. **The second data layer + upgrade cadence** — the `agent_native` schema (28 tables) is a real
   thing to migrate/back up/secure, and the pin needs a deliberate upgrade cadence (pre-1.0, ~4×/day).

If both are acceptable → colocate pinned `pmo/agent-native/`, own the upgrade cadence, and design the
static→server change for `pmo-portal`. If not → cherry-pick the deputy-action shape into the edge-fn
engine (the gate proves the pattern is sound either way).

---

## How to re-run

```bash
cd /Users/ariefsaid/Coding/PMO-sidecar/pmo/agent-native
npx tsc --noEmit                          # clean
npx vitest run test/deputy-invariant.gate.test.ts   # 5/5 GREEN (boots Nitro in globalSetup)
```

For the embed (visual): `npm run dev` (Nitro :8100) + `npx vite --config embed/vite.config.ts`
(:5173), open `http://localhost:5173`, sign in `admin@acme.test` / `Passw0rd!dev`.

## File map (all under `pmo/agent-native/` in the worktree)

- `server/middleware/deputy.ts` + `server/lib/{deputy-store,supabase}.ts` — the deputy ALS seam +
  caller-JWT client (anon + caller JWT; `service_role` confined to verifier).
- `server/plugins/agent-native.ts` — `createAgentNativeEmbeddedPlugin({ databaseUrl, auth, actions })`.
- `server/actions/pmo-query.ts` — the one deputy action (`list_companies` + `create_activity`).
- `test/deputy-invariant.gate.test.ts` (+ `fixtures.ts`, `global-setup.ts`) — the gate.
- `embed/` — the minimal standalone shell mounting `<AgentSidebar>` + the Vite proxy.
- `nitro.config.ts`, `tsconfig.json`, `vitest.config.ts`, `package.json` (exact pin).

---

**Handoff:** the pilot is complete and the gate is the proof. Owner decision required on adopt-whole
(§Decision) vs cherry-pick. The `pilot/agent-native-sidecar` branch stays unmerged until that call.
