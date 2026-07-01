# Changelog

All notable changes to PMO Portal are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows
**ADR-0042** (SemVer, pre-1.0 while single-tenant MVP). A version is minted only at a
`main → production` promote and git-tagged `vX.Y.Z` on the promoted commit.

Each released section pins the full deploy manifest (app sha · DB migration high-water ·
edge-function state) so "what's in production" is unambiguous.

## [Unreleased]

_Accrues on `dev`/`main` until the next promote cuts it into a release._

## [0.2.0] — Unreleased (next production release)

The first **three-tier** release: adds the app's first server-side tier (Deno edge functions)
on top of the SPA→Supabase base. **MINOR** per ADR-0042 (new user-facing modules **and** a new
architectural tier).

> Deploy manifest (fill at promote): app `<sha>` · DB migrations `0041 → 0045` ·
> edge functions `agent-chat`,`compose-view` @ `<sha>`.
> **Blocker before ship:** add a `supabase functions deploy` step + set the `ANTHROPIC_API_KEY`
> prod function secret (ADR-0042; `docs/environments.md` → Edge Functions) — the current promote
> path deploys only DB + frontend, so without this the agent panel calls a missing endpoint.

### Added
- **Agent-native in-app assistant (ADR-0040/0041)** — the ⌘J `AssistantPanel`; a streaming
  `agent-chat` **edge-function deputy** (read-only `query_entity`; write actions `create_activity`
  /`update_task_status` with approve-deny SoD; compose-a-view); the `AgentRuntime` port +
  `PmoNativeRuntime` client adapter. Feature-flagged off by default (`VITE_FEATURES_AGENT_ASSISTANT`).
- **User-composed views (ADR-0036 I3–I5)** — `/views` renderer, "Compose with AI" via the
  `compose-view` edge function, Save-to-My-Views (`user_views`, migration 0045).
- **DB hardening** — FK hot-path indexes (0042), incident→project FK (0043), dashboard status
  helpers (0044).

### Notes
- The agent epic adds **no new tables** — the deputy acts over existing RLS-protected tables under
  the caller's JWT (RLS is the enforcement ceiling).
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
