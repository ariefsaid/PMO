# Changelog

All notable changes to PMO Portal are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows
**ADR-0042** (SemVer, pre-1.0 while single-tenant MVP). A version is minted on **`main`** (the
release-please flow — amended 2026-07-08, was `main → production`) and git-tagged `vX.Y.Z` on the
`main` commit; `main → production` then deploys an already-tagged commit.

Each released section pins the full deploy manifest (app sha · DB migration high-water ·
edge-function state) so "what's in production" is unambiguous. The DB schema version (migration
high-water mark) moves independently of the product tag.

## [Unreleased]

_release-please accrues entries here from Conventional Commits landing on `main`._

## [0.2.0] — 2026-07-08 (current production baseline)

The first **three-tier** release: adds the app's first server-side tier (Deno edge functions) on
top of the SPA→Supabase base. **MINOR** per ADR-0042 (new user-facing modules **and** a new
architectural tier).

> Deploy manifest: app `1f68058` · DB migrations `→0081` · edge functions `agent-chat`,
> `compose-view`, `agent-dispatch`, `admin-invite-user`, `health`, `telegram-notify` deployed to
> the prod Cloud project (`prwccpsiumjzvnwjlkwq`).
> **Known gap (the ADR-0042 blocker, now realised):** the promote deployed DB + frontend but a
> stale `agent-chat` (the 2026-07-08 promote did not actually redeploy it — caught 2026-07-08 via
> `supabase functions list`). An edge-function deploy + a post-deploy version check are being added
> so this cannot recur silently.

### Added
- **Agent-native in-app assistant (ADR-0040/0041)** — the ⌘J `AssistantPanel`; a streaming
  `agent-chat` **edge-function deputy** (read-only `query_entity`; write actions `create_activity`
  /`update_task_status` with approve-deny SoD; compose-a-view); the `AgentRuntime` port +
  `PmoNativeRuntime` client adapter. Feature-flagged (`VITE_FEATURES_AGENT_ASSISTANT`).
- **Broadened agent read scope** — the deputy now reads the full business surface (procure-to-pay
  lifecycle, CRM activities, budget line items, docs, team, notifications), each RLS-scoped with a
  curated column allowlist (the `org_id` seam is never surfaced).
- **Live step trail** — the assistant panel shows the current action present-tense while the agent works.
- **User-composed views (ADR-0036 I3–I5)** — `/views` renderer, "Compose with AI" via the
  `compose-view` edge function, Save-to-My-Views (`user_views`, migration 0045).
- **DB hardening** — FK hot-path indexes (0042), incident→project FK (0043), dashboard status
  helpers (0044), auth-floor + org-seam + feature-flag server-enforcement (migs through 0081).

### Notes
- The agent tier adds **no new business tables** — the deputy acts over existing RLS-protected tables
  under the caller's JWT (RLS is the enforcement ceiling).
- The CRUD/RBAC foundation (ADR-0016–0019) and the procurement case-folder records (migs 0035–0041)
  are **already in 0.1.0** (shipped to prod 2026-06-21) — they are not part of this release.

## [0.1.0] — 2026-06-21 (production baseline)

The versioning baseline: the two-tier SPA→Supabase app as it stood live in production when this
convention was adopted (ADR-0042). Not retroactively decomposed into earlier tags. Encompasses the
full pre-agent product — backend foundation, write MVP, CRUD/RBAC foundation, UI/UX programs,
deployment, analytics, and the procurement case-folder record model.

> Deploy manifest: app `fc312eb` · DB migrations `→0041` · no edge functions.

[Unreleased]: https://github.com/ariefsaid/PMO/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/ariefsaid/PMO/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/ariefsaid/PMO/releases/tag/v0.1.0
