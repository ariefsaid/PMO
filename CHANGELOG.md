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
on top of the SPA→Supabase base. Bundles the backlog unreleased since `0.1.0`. **MINOR** per
ADR-0042 (new modules **and** a new architectural tier).

> Deploy manifest (to fill at promote): app `<sha>` · DB migrations `→0045` ·
> edge functions `agent-chat`,`compose-view` @ `<sha>`.
> **Blocker before ship:** add `supabase functions deploy` + the `ANTHROPIC_API_KEY` prod secret
> (ADR-0042 consequences; `docs/environments.md`) — else the agent panel calls a missing endpoint.

### Added
- **Agent-native in-app assistant (ADR-0040/0041)** — the ⌘J `AssistantPanel`, a streaming
  `agent-chat` edge-function deputy (read-only `query_entity`, write actions with approve/deny
  SoD, compose-a-view), the `AgentRuntime` port + `PmoNativeRuntime` adapter. Feature-flagged
  off by default (`VITE_FEATURES_AGENT_ASSISTANT`).
- **User-composed views (ADR-0036)** — `/views` renderer, "Compose with AI" via the
  `compose-view` edge function, Save-to-My-Views (`user_views`, migration 0045).
- **CRUD/RBAC foundation (ADR-0016–0019)** — typed repository seam, `can()`/`<CanWrite>`
  authorization, server-enforced SoD + destructive-delete RPCs, shared form primitives.
- **Procurement records** — procurement record tables/files/RPCs (migrations 0035–0041).

### Notes
- The agent epic adds **no new tables** — the deputy acts over existing RLS-protected tables.
- Schema advances `0034→0045` over the `0.1.0` baseline.

## [0.1.0] — 2026-06-16 (production baseline)

The versioning baseline: the two-tier SPA→Supabase app as it stood live in production when this
convention was adopted. Not retroactively decomposed into earlier tags.

> Deploy manifest: app `main@a1e5115` · DB migrations `→0033` · no edge functions.

[Unreleased]: https://github.com/ariefsaid/PMO/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/ariefsaid/PMO/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/ariefsaid/PMO/releases/tag/v0.1.0
