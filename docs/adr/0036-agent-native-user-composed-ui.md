# ADR-0036 — Agent-native, user-composed UI: the deputy authorization model + declarative hydration over the existing primitive kit

- **Status:** Accepted (owner-approved 2026-06-29; §9 spike gate green — claims #1/#2/#3-core all PASS).
  **§8 sidecar path CLOSED 2026-07-03** — the live pilot found the sidecar UI builder/admin-grade, not
  app-user-grade; verdict **cherry-pick**, batteries rebuilt PMO-native on the Option-A panel. Binding
  record: ADR-0040 addendum 2026-07-03. §4–§7 (trusted core, `user_views`, coexistence) are unaffected and shipped.
- **Date:** 2026-06-29
- **Deciders:** Owner, Director
- **Related:** ADR-0001 (org_id seam), ADR-0005 (TanStack Query), ADR-0008 (view-only impersonation), ADR-0010 (test pyramid), ADR-0016 (FE authz primitive + real-JWT), ADR-0017 (repository/API seam), ADR-0018 (soft-archive), ADR-0019 (server-enforced SoD + delete gating), ADR-0030 (QA portfolio + build-vs-buy vendoring policy).
- **External:** Builder.io `agent-native` (<https://github.com/BuilderIO/agent-native>); "Designing Generative UI in an Agent-Native World" (builder.io/blog).

## Context

We want PMO users to have an **agent as a same-class citizen** of the app: the user can ask their
agent to explore their data and to **build new UI — dashboards/views — at runtime**, which they can
then open inside PMO like any native page. Builder.io's open-source `agent-native` framework codifies
this "agent + UI are equal citizens" pattern, with a few documented conventions:

- **One action, defined once** (`defineAction({ schema, run })`) usable from UI click, agent tool, HTTP, MCP, A2A, CLI.
- **One SQL state, bidirectional** — UI and agent read/write the same database; changes reflect both ways.
- **UI/agent parity** — anything the UI can do, the agent can do, through the *same* capability.
- **"Text-to-hydration" over "elastic primitives"** — the agent does **not** generate code; it *arranges, toggles, and pipes data into* a pre-built, hyper-modular "kit of parts."
- It is a **framework you scaffold an app *from*** (`npx @agent-native/core create`), server-first on **Nitro**, DB-agnostic via **Drizzle**. It is *not* a library you drop into an existing SPA.

PMO is a shipped React 19 + Vite SPA on **Supabase (Postgres + Auth + RLS + Storage)**, with a mature
repository seam, an `org_id` tenancy seam, `can()`-gated affordances, and **RLS as the single
enforcement authority** (ADR-0016/0017/0018/0019). Critically, `agent-native` is **backend-agnostic
and supplies no tenancy/authorization** — it provides *parity*, not *security*. Any safety guarantee
is ours to build.

Two technical points were checked and matter:

1. **Drizzle can honor Supabase RLS** — officially, via `createDrizzle(...).rls()`, which wraps each
   query in a transaction that sets `request.jwt.claims` + `SET LOCAL ROLE authenticated`, so PMO's
   existing `org_id` policies fire identically to `supabase-js`. **Caveat:** RLS applies **only** on
   `.rls()` queries; a plain Drizzle query connects privileged and **bypasses RLS**. This requires a
   hard discipline (and a test/lint guard) if Drizzle is ever introduced.
2. **Nitro is not Supabase's Deno.** Supabase uses Deno only for Edge Functions; its DB/Auth/Storage
   are separate services. An `agent-native` app would be a **separate Nitro service** beside Supabase,
   not layered onto it — a second deployable to operate and secure.

This ADR records how we adopt the *idea* without detonating the security foundation, what PMO must
build itself, and under what gate (if any) the `agent-native` runtime earns a place.

## Decision

Each sub-decision is tagged **[AN]** = adopt an `agent-native` convention as-is, or **[PMO]** = our
addition/extension beyond what `agent-native` provides.

### 1. Adopt the *pattern*, not the framework as host. **[PMO]**
PMO will **not** be migrated onto `agent-native` (that inverts ownership — `agent-native` becomes the
host app and Supabase degrades to "just Postgres," discarding Supabase Auth, the repository seam, and
RLS-via-PostgREST). We adopt its **principles** (UI/agent parity; action-defined-once; text-to-hydration
over a primitive kit; one shared SQL state) on top of the **existing Supabase stack**. Full-framework
adoption is rejected (see Alternatives). This is consistent with **ADR-0030**'s build-vs-buy posture.

### 2. The **deputy authorization model** is the core security invariant. **[PMO]**
The agent runs **as the user's own JWT**, scoped to the user's real role and `org_id`. It is a *deputy
carrying the user's badge, never a master key.* Its maximum reach is, by construction, the user's reach,
because every query/write it issues is subject to the same **RLS** (and security-definer RPCs) the user
is. This is enforcement-by-database, not by prompt — so prompt injection becomes a *nuisance, not a
breach* (an injected "show all orgs" can at most make the agent *try*; RLS still blocks cross-tenant
reads).

> **The one rule that can never bend:** the agent runtime must **never** be handed `service_role` or any
> privileged/BYPASSRLS connection. It binds to the **real** authenticated JWT (`realRole`, not the
> impersonated `effectiveRole` — ADR-0008/0016). If acting under impersonation, the agent is read-only,
> exactly like the human.

### 3. The **four ceilings** that bound a user's agent. **[PMO]** (uses **[AN]** parity at the action layer)
1. **Data ceiling — RLS.** Every read flows through the user's JWT; `org_id = auth_org_id()` is the wall. (Existing — ADR-0001/0016.)
2. **Action ceiling — `can()` + RLS write policies + SoD RPCs.** Agent writes go through the **same repository methods/RPCs** the UI uses, inheriting SoD (approver≠author, contract-value-on-won) and Admin-only delete gating. (Existing — ADR-0017/0019; the "one action, both surfaces" idea is **[AN]**.)
3. **Tool ceiling — curated catalog, not raw SQL.** The agent's tools are the typed repositories / a constrained read tool — **not** an open SQL console. Free-form exploration, if offered, uses a **read-only, RLS-scoped** query path with statement timeout + row cap (RLS bounds *data*; this bounds *resource abuse* and *schema probing*).
4. **Artifact ceiling — declarative specs, never executable code** (see §5).

### 4. PMO owns the **trusted core**, and builds it regardless of `agent-native`. **[PMO]**
The valuable, security-sensitive layer is ours and is worth building on its own (a manual builder UI
alone delivers user value). It comprises:
- **(a) Primitive registry/manifest** — each kit primitive (`DataTable`, `KPITile`, `StatTiles`, `Funnel`, `StatusBarChart`, …) described machine-readably (name → prop schema → data contract). Today these are typed React props (great for devs, opaque to an agent); the registry exposes them as a catalog to arrange.
- **(b) Query-spec layer + compiler** — a declarative, **whitelisted** query DSL (entity/columns/aggregations/filters/time-range, with `$current_*` tokens) that compiles to **RLS-scoped** supabase-js/PostgREST calls. No raw SQL.
- **(c) Spec renderer** — a generic engine that takes a composition spec and hydrates the real primitives via the existing `ChartFrame`/`DashGrid` patterns. (Today dashboards are hand-coded; this generalizes `PMDashboard`'s compose pattern.)
- **(d) Action exposure** — the repository seam surfaced as agent/MCP tools (the bridge to **[AN]**'s "one action, both surfaces").
- **(e) View persistence** — the `user_views` entity (§6).

This decoupling is deliberate: the **risky** part (a young agent runtime) is isolated from the
**trusted** part (our renderer/compiler). `agent-native` (or our own agent) is *only* a spec-author
against this core.

### 5. **Declarative-artifact rule: text-to-hydration over the existing kit.** **[AN]** principle, **[PMO]** implementation
When the agent "builds UI," it emits a **validated declarative spec** that the trusted renderer
interprets into PMO's *existing* primitives + `DESIGN.md` tokens — it **never** emits code/SQL that
runs. Three storage-form rules:
1. The spec stores **queries, not results** (never cache rows).
2. On render, queries **re-execute under the *current viewer's* JWT → RLS**. A private view runs only as its owner; a **shared** view returns each viewer *their own* authorized data — sharing can never leak rows.
3. The spec is **schema-validated** on save (and render) against the registry — only known primitives/fields are accepted. This is the line between "agent-generated" and "arbitrary code."

Live composition (agent arranges real primitives in the moment) **[AN]** and a persisted spec document
**[PMO]** coexist: compose live, then save to `user_views`.

> Generated executable components (JSX/SQL that runs) are **out of scope** for this ADR. If ever
> pursued, they require a separate ADR and a real sandbox (iframe `sandbox`, strict CSP, no network,
> server-side query allowlist).

### 6. `user_views` is an ordinary tenant entity — agent-built UI is **a row, not a migration**. **[PMO]**
Saving an agent-built view = inserting a row through the **existing repository seam** (org_id stamped
by default/RLS, not the client). **No runtime DDL, no code-gen, no deploy.** Proposed shape (final
columns/policies belong in the implementing plan + a migration):

```
user_views
  id          uuid pk default gen_random_uuid()
  org_id      uuid not null references organizations(id) default <org-1>   -- tenancy seam
  owner_id    uuid not null default auth.uid()                              -- "user level"
  name        text not null
  spec        jsonb not null      -- the validated declarative composition (primitives + query-specs + layout)
  scope       text not null default 'private'   -- 'private' | 'shared_org' | 'shared_roles'
  created_at  timestamptz not null default now()
  updated_at  timestamptz not null default now()
  archived_at timestamptz          -- soft-archive (ADR-0018), never hard-delete by default
```

- **RLS:** `SELECT` = owner (`owner_id = auth.uid()`) ∪ shared-within-`org_id` per `scope`; `INSERT/UPDATE/DELETE` = owner (+ Admin). Mirror the `auth_org_id()`/`auth_role()` pattern from `0002_rls.sql`, with a pgTAP proof (ADR-0010/0019).
- **"At the user level"** = the default (`scope='private'`, `owner_id=auth.uid()`): a user's agent-built views are theirs alone until explicitly shared.
- Add a `user_views` repository to `src/lib/repositories` + a `src/lib/db/userViews.ts` DAL module, consumed via a `useUserViews()` TanStack hook (orgId in key) — exactly the Companies reference slice.

### 7. **Coexistence:** built-in UI (code) and user-owned UI (data) share one design system, separate namespaces. **[PMO]**

| | Built-in PMO UI | User-owned UI |
|---|---|---|
| Defined in | **code** — static `<Route>`s in `App.tsx`; `MODULES`/`ALL_ITEMS` | **data** — `user_views` rows |
| Route | `/projects`, `/companies`, … | **one** route: `/views/:viewId` |
| Rendered by | a page component each | **one** generic `<UserViewRenderer>` (loads row → spec renderer §4c) |
| Nav | `Rail` + ⌘K, role-filtered | a dynamic "My Views" `Rail` group + a "Views" `CommandPalette` group, from `useUserViews()` |
| Visibility | `modulesForRole` (role) | `user_views` RLS (owner/scope) |
| Look | kit + `DESIGN.md` | **the same** kit + tokens → visually native |

Integration is small and additive: **one** static route (`<Route path="/views/:viewId" …>` in
`App.tsx`), and **one** data-driven nav source (`useUserViews()` appended to `Rail` and the `paletteItems`
merge in `App.tsx`'s `ShellChrome`, which already merges `recordSearch.records` + `modulesForRole`).
No collision: user views live **only** under `/views/*` (cannot shadow `/projects` etc.); code-routes
and rows never overwrite; role-gating vs ownership-gating are independent. Optional later: a "promote a
popular user view to a coded module" product path. Gate the whole capability behind a new
`FEATURES.userViews` flag + `FeatureRoute` for UI-hide-first rollout (`src/lib/features.ts`).

### 8. If — and only if — `agent-native`'s runtime is adopted, run it as a **config-over-fork sidecar**. **[PMO]**
To honor "don't pick it apart **and** don't restructure PMO": keep `agent-native` **whole** as its own
scaffolded service (its Nitro server + Drizzle), **configured** (never source-edited) to (i) point
Drizzle at PMO's Supabase Postgres via `.rls()` (Decision §2's rule), (ii) trust PMO's Supabase JWT, and
(iii) treat **Supabase migrations as the single schema source of truth** — Drizzle runs
**introspect-only** (`drizzle-kit pull`), never `push`. PMO's SPA embeds only the **assistant/conversation
panel** (prefer subdomain + shared-cookie SSO over iframe); **artifacts render natively in PMO** via the
trusted renderer (§4c), not inside the panel. Staying config-over-fork preserves upstream
upgradability. **Supabase remains the authority**; `agent-native` supplies runtime + spec-authoring only.

### 9. **Spike gate** — the decision in §8 is contingent; this gate decides it. **[PMO]**

> **Spike result — 2026-06-29: automated claims PASS** (CI run [`28351347117`](https://github.com/ariefsaid/PMO/actions/runs/28351347117), `spike/agent-native-rls/` on a GitHub runner against the real migrated schema + RLS).
> - **Claim #1 — Drizzle `.rls()` RLS parity: PASS.** The `.rls()` wrapper (`set local role authenticated` + `set_config('request.jwt.claims', …, true)`) enforced PMO's `org_id` policies identically to `supabase-js`: own-org read returned the row, cross-org read returned 0, in-org default write succeeded, cross-org write was rejected `42501`, and the kill-test confirmed a non-`.rls()`/privileged connection **bypasses** RLS (the failure mode the deputy-model guard prevents).
> - **Claim #2 — `drizzle-kit pull` introspect-only: PASS.** Mirrored 35 tables / 82 policies into types read-only; Supabase migrations remain the single schema source of truth.
> - **Claim #3 — assistant-panel SSO (no second login): core PASS** (CI run [`28353978109`](https://github.com/ariefsaid/PMO/actions/runs/28353978109), `claim3-sso.mjs`). Proved **session portability**: a second, independent supabase-js client handed PMO's session via `setSession` authenticated as the **same `auth.uid()`** and read the **same RLS-scoped data** with no re-login; a no-session control returned 0 rows. *What "SSO" means here:* PMO has **no IdP-SSO** (email/password + magic-link only) — claim #3 is purely *session sharing*. The JWT carries only `auth.uid()` (role/org come from `profiles`), so any app holding the same session gets identical RLS. **Still manual (lowest-risk):** the browser cookie-`Domain` *auto-share* UX, which needs a real parent domain (prod is on `*.pages.dev` today) and is a §8 build-time step (switch supabase-js to a cookie storage adapter with `Domain=.<parent>`).
> - **Fidelity caveat:** the harness proves the *SQL binding* `.rls()` emits, not Drizzle's own code path (see the spike README).
>
> **Conclusion:** the §9 gate is green (claims #1, #2, and the #3 portability core all PASS) → the §8 config-over-fork sidecar path is **viable**, and this ADR is **Accepted** (owner, 2026-06-29). The only deferred item is the browser cookie-`Domain` SSO *UX* check, which belongs to §8 implementation (needs a real domain). The throwaway spike + CI lane (`.github/workflows/spike-rls.yml`) are **retained for now** (reusable for the §8 SSO UX check) and deleted once §8 build begins.

Before any `agent-native` adoption, a time-boxed, throwaway spike (no prod touch) must prove:
- Drizzle `.rls()` pinned to `authenticated` + per-request JWT **blocks a cross-`org_id` read and allows a legit read — identically to `supabase-js`** (assert with a pgTAP-style proof on both paths);
- `drizzle-kit pull` mirrors the existing schema **without wanting to own/migrate it**;
- the assistant panel embeds with shared-session SSO and **no second login**.

**Pass** → proceed with §8 (sidecar, config-over-fork). **Fail** (RLS leaks through Drizzle, or schema
ownership conflicts, or SSO is unworkable) → **do not fork to force it**; build the agent spec-author on
PMO's own stack against the §4 trusted core. Either way, §4–§7 (the trusted core + `user_views` +
coexistence) proceed, because they stand alone.

### 10. **Build sequence — renderer-first.** **[PMO]**
1. **`user_views` entity** — migration (table + RLS + pgTAP), `db/userViews.ts`, repository, `useUserViews()` (the Companies slice pattern). (ADR-0010/0017/0018/0019.)
2. **Primitive registry + query-spec DSL + compiler** (§4a/b) — the trusted, RLS-scoped core, with deterministic Layer-1 gate-tests (ADR-0030 §C: chart-position/money/dates/derived/a11y).
3. **`<UserViewRenderer>` + `/views/:viewId` route + dynamic nav** (§7), behind `FEATURES.userViews`.
4. **Manual view builder UI** (no agent) — proves the core end-to-end and ships user value alone.
5. **Agent spec-author** — via the §9 sidecar **or** PMO-native, per the gate. Tools = curated repositories + read-only RLS-scoped query tool.
6. (Deferred, separate ADR) sharing UX hardening; generated executable components.

## Consequences

**Positive**
- Users get an agent that is a true same-class citizen — explore data, compose dashboards — **provably bounded by their own access** (deputy + RLS), with prompt-injection reduced to a nuisance.
- The security guarantee is **by construction** (DB-enforced), reusing the foundation PMO already paid for (RLS, repository seam, `org_id`, `can()`), not bolted on.
- The trusted core (registry/compiler/renderer/`user_views`) delivers value **with or without** `agent-native` — a manual builder alone is shippable; agent adoption is decoupled and reversible.
- User UI and built-in UI coexist cleanly (separate namespace + source of truth) yet look native (shared kit + tokens). Adding a user dashboard needs **no deploy**.
- Config-over-fork keeps any `agent-native` dependency **upgradable**.

**Negative / costs**
- Real net-new surface: a primitive registry, a query-spec DSL + compiler, a spec renderer, and `user_views` — and these are **security-sensitive** (the compiler must never emit non-RLS-scoped or raw SQL; the spec validator is a trust boundary).
- If §8 is taken: a **second deployable** (Nitro service), a **JWT bridge**, **SSO embedding**, and the **`.rls()` discipline** (+ a guard so no raw Drizzle query ships) and **introspect-only** schema discipline.
- **Maturity risk:** `agent-native` is **v0.x, weeks old** — API churn/abandonment risk if placed in a production, tenancy-sensitive path. (The §4 decoupling + §9 gate are the mitigations.)
- Shared views add re-execution-under-viewer complexity that must be tested (a leak here is a tenancy breach).

## Alternatives considered

- **Full-framework adoption (migrate PMO onto `agent-native`).** Rejected: inverts ownership; discards Supabase Auth, the repository seam, RLS-via-PostgREST, ADR-0016/0017/0018/0019; a v0.x framework owning a production tenancy app. Highest disruption, not lowest.
- **Strangler / run `agent-native` against the same Postgres with a privileged connection.** Rejected: a privileged/`service_role` Drizzle connection **bypasses RLS** → destroys the `org_id` tenancy seam. Two state authorities over one DB.
- **Pick apart / vendor pieces into PMO (a permanent fork).** Rejected by owner preference and on merit: forfeits upstream upgradability; we'd own the maintenance of someone else's young framework.
- **Agent generates executable React/SQL at runtime.** Rejected for now: arbitrary code execution in a multi-tenant app; needs heavy sandboxing. Declarative specs (§5) deliver most of the value safely. Revisit only via a dedicated ADR.
- **Do nothing / no agent-composed UI.** Rejected: forgoes a strategic capability the existing architecture is unusually ready for (primitive kit + RLS + repository seam).

## Verification

- **Decision-level (this ADR):** owner sign-off on Status → Accepted; `docs/README.md` ADR range/Latest updated; cross-refs to ADR-0016/0017/0018/0019/0030 resolve.
- **Spike (§9):** pgTAP-style proof that Drizzle `.rls()` blocks cross-`org_id` SELECT and permits the in-org SELECT, byte-for-byte matching `supabase-js` behavior; `drizzle-kit pull` is non-destructive; SSO embed shows no second login. Documented pass/fail in the spike's plan.
- **Trusted core (when built):** Layer-1 deterministic gate-tests for the compiler (RLS-scoping, money/date/chart-position correctness, a11y via axe-core) per ADR-0030 §C; pgTAP for `user_views` RLS (owner isolation, scope sharing returns viewer-scoped rows, cross-org blocked) per ADR-0010/0019; the curated e2e journey "user composes → saves → reopens a private dashboard; a second user cannot see it" (one cross-stack AC per ADR-0010).
- **Deputy invariant:** a test proving the agent path carries `realRole`/user JWT and is denied a cross-tenant read; a guard proving no privileged/`service_role` or non-`.rls()` query path exists for the agent runtime.
