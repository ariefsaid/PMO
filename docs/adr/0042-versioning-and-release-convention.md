# ADR-0042 — Versioning & release convention

- **Status:** Accepted
- **Date:** 2026-07-01
- **Deciders:** Owner (Arief), Director
- **Supersedes / relates to:** ADR-0010 (test pyramid), branch-flow rules in `CLAUDE.md`,
  `docs/environments.md` (promote runbook, prod migration state).

## Context

PMO is a **continuously-deployed web SaaS**, not a published library. It has no external
consumers pinning a version, so classic SemVer's "protect downstream pinners" contract does
not directly apply. But we still need a version to:

1. Answer **"what exactly is live in production?"** — the app frontend, the DB schema
   (migration high-water mark), and the edge functions can each lag independently
   (`docs/environments.md`: prod frontend `main@a1e5115`, DB at migration 0033, edge functions
   not deployed at all). A single release identity must pin all three.
2. Signal **change impact** to the team and (eventually) to B2B tenants — is this release new
   capability, a contract change, or just fixes?
3. Be **mechanically derivable** by agents from the commit history, so releases are automatable
   and never a judgement call at promote time.

The release event is already well-defined and owner-gated: **`main → production`** (see
`CLAUDE.md` branch flow). That, and only that, is when a version is minted.

## Decision

### 1. Scheme — SemVer, pre-1.0 while single-tenant MVP

Versions are **`MAJOR.MINOR.PATCH`**, git-tagged **`vMAJOR.MINOR.PATCH`** on the exact `main`
commit promoted to `production`.

We are **pre-1.0** (`0.MINOR.PATCH`) for as long as PMO serves no real external tenant. In this
phase `MAJOR` stays `0`, and the honest meaning is: *"single-client MVP; a minor bump may carry
a breaking data-model change."* The jump to **`1.0.0` is GA** — the first release served to a
real external tenant, i.e. the moment the multi-tenant / `org_id` contract becomes externally
binding. After `1.0.0`, standard SemVer semantics resume (MAJOR = breaking).

### 2. When to bump — the pre-1.0 rule (binding for future agents)

At each production promote, choose the bump from the Conventional-Commits history **since the
last `v0.*` tag**:

| Bump | `0.x.0 → 0.(x+1).0` — **MINOR** | `0.x.y → 0.x.(y+1)` — **PATCH** |
|---|---|---|
| **Trigger** | the release contains **any** of the below | the release contains **only** fixes/hardening |
| New user-facing feature, page, entity, or module | ✅ minor | — |
| A new **architectural tier or external integration** (e.g. the edge-function/LLM-deputy tier, a new third-party service) | ✅ minor | — |
| A **backward-incompatible** data-model / RLS / RPC / API change (in 0.x, breaking rides a minor — there is no major yet) | ✅ minor | — |
| A notable UX overhaul a tenant should be told about | ✅ minor | — |
| Only bug fixes, perf, security patches, copy/telemetry/tooling, or internal refactors with **no** user-facing change and **no** schema/contract break | — | ✅ patch |

**Mechanical rule (automatable):** map Conventional-Commit types across the release range —
any `feat:` **or** any `!`/`BREAKING CHANGE:` footer ⇒ **MINOR**; if the range is exclusively
`fix:` / `perf:` / `chore:` / `docs:` / `ci:` / `refactor:` / `test:` ⇒ **PATCH**. This is
exactly what a `release-please`-style tool computes, so the number is never argued at the gate.

> **One-liner for future agents:** *pre-1.0, a MINOR (`0.x → 0.x+1`) means "this release does or
> changes something new — a feature, a tier, or a contract"; a PATCH means "this release only
> fixes or hardens what `0.x.0` already shipped." MAJOR is reserved for GA (`1.0.0`) = first real
> external tenant.*

### 3. Two orthogonal version streams

- **Product version** — the `vX.Y.Z` git tag (this ADR). Human-facing "what's live."
- **Schema version** — the monotonic migration numbers (`0001…`) already in `supabase/migrations/`.
  Kept as-is; it is the DB's own version and moves independently of the product tag.

Each release's notes **must** pin the full manifest so "what's in prod" is unambiguous:

> **v0.2.0** — app `<sha>` · DB migrations `→00NN` · edge functions `agent-chat`,`compose-view` @ `<sha>` (or "not deployed")

### 4. Where the number lives

- **Git tag** `vX.Y.Z` on the promoted commit — the source of truth.
- **`CHANGELOG.md`** (repo root, *Keep a Changelog* format) — human notes per release +
  an `[Unreleased]` section that accrues during development.
- **`pmo-portal/package.json` `version`** — tracks the **in-development** target (the version the
  next promote will mint). Bumped when a release is cut.
- **(Adoption follow-up)** `VITE_APP_VERSION` inlined at build and shown next to `<EnvBadge>`, so a
  running instance always reports its exact `vX.Y.Z · <sha>`.

## Baseline & first application

- **`0.1.0`** = the **current production baseline** — `fc312eb`, Cloud DB at migration `0041`,
  two-tier SPA→Supabase, **no edge functions** (per `docs/backlog.md` living status; the older
  "migration 0033" in `docs/environments.md` predated the 2026-06-21 procurement prod push and is
  corrected in this change). This encompasses the full pre-agent product — backend foundation,
  write MVP, the CRUD/RBAC foundation (ADR-0016–0019), UI/UX programs, deployment, analytics, and
  the procurement case-folder records (migs 0035–0041). Versioning starts here; we do not
  retroactively decompose older prod pushes into earlier tags.
- **`0.2.0`** = the **next** production release = the current `main`/`dev` content over `0.1.0`. It
  adds **user-composed views (ADR-0036)** and the **agent-native in-app assistant (ADR-0040/0041)** —
  i.e. the app's first server-side **architectural tier** (the Deno edge-function LLM deputy) — plus
  DB hardening (migs 0042–0045). Unambiguously a **MINOR**: new user-facing modules **and** a new
  tier. Because versions mark *releases* (not internal milestones), had composed-views and the agent
  epic shipped separately they'd have been `0.2.0` then `0.3.0`; unreleased, they collapse into one
  minor. `pmo-portal/package.json` is set to `0.2.0` (in development).

## Consequences

- A promote is now a two-part act: **cut the release** (bump `CHANGELOG`/`package.json`, tag
  `vX.Y.Z`) **then** run the owner-gated `db-push-prod` → deploy edge functions → `main→production`.
  The promote runbook in `docs/environments.md` is updated to include the tag + the release manifest.
- **`0.2.0` surfaces a gap:** it is the first release containing edge functions, but the tooling has
  **no `supabase functions deploy` step** and prod has no `ANTHROPIC_API_KEY` secret
  (`docs/environments.md`). That step must be added before `0.2.0` ships, or the agent panel calls a
  non-existent endpoint. Tracked as an edge-function-operationalization follow-up.
- Adopting `release-please` (or equivalent) is a follow-up that makes §2's mechanical rule fully
  automatic; until then the Director applies §2 by hand at promote time.

## Adoption plan (follow-ups, not blocking this ADR)

1. `release-please` GitHub Action on `main` → maintains `CHANGELOG.md` + proposes the next
   `vX.Y.Z` from Conventional Commits; merged before a promote, it creates the tag + GitHub Release.
2. `VITE_APP_VERSION` build injection + `<EnvBadge>` surfacing.
3. `supabase functions deploy` step + `ANTHROPIC_API_KEY` prod secret in the promote runbook.

## Amendment (2026-07-08, owner-directed)

The product version is now **minted on `main`** via the release-please flow
(adoption plan §1, now implemented in `.github/workflows/release-please.yml` +
`release-please-config.json`), **not at `main → production`** as the body above
states. A push to `main` lets release-please accrue Conventional Commits into a
release PR; merging that PR bumps `pmo-portal/package.json`, appends to the
root `CHANGELOG.md`, and mints the git tag `vX.Y.Z` + a GitHub Release on the
`main` commit. A prod promote therefore deploys an **already-tagged** `main`
commit, and the in-app version label reports the deployed build's
`vX.Y.Z · <sha>` on every environment (incl. prod). The §2 bump rule (any
`feat:`/`!` ⇒ MINOR, else PATCH) and the §3 release-manifest requirement are
unchanged.
