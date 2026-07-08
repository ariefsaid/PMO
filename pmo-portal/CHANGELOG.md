# Changelog

All notable changes to PMO Portal are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows
**ADR-0042** (SemVer, pre-1.0 while single-tenant MVP). A version is minted on **`main`** (the
release-please flow — amended 2026-07-08, was `main → production`) and git-tagged `vX.Y.Z` on the
`main` commit; `main → production` then deploys an already-tagged commit.

Each released section pins the full deploy manifest (app sha · DB migration high-water ·
edge-function state) so "what's in production" is unambiguous. The DB schema version (migration
high-water mark) moves independently of the product tag.

## [0.4.0](https://github.com/ariefsaid/PMO/compare/v0.3.0...v0.4.0) (2026-07-08)


### Features

* **agent:** follow-up multi-turn fix + live interactivity + latency + edge versioning ([#277](https://github.com/ariefsaid/PMO/issues/277)) ([d2148bf](https://github.com/ariefsaid/PMO/commit/d2148bfdfb743ecb4c903e2d8589ef1a57ddb8b3))


### Bug Fixes

* **agent:** follow-up on a History-loaded conversation (adoptRun) ([d73bfde](https://github.com/ariefsaid/PMO/commit/d73bfdee99607ca3a7a30100e7a5b654c61960df))

## [0.3.0](https://github.com/ariefsaid/PMO/compare/v0.2.0...v0.3.0) (2026-07-08)


### Features

* **agent:** persistent activity trail + reassuring long-run copy ([f0f3766](https://github.com/ariefsaid/PMO/commit/f0f3766ccd1197cf4b9b78b32be929301b31ddc5))
* **agent:** persistent activity trail + reassuring long-run copy ([c31b40e](https://github.com/ariefsaid/PMO/commit/c31b40e880e138f84c76a33eae6f158e230567c6))
* automatic versioning — release-please on main + in-app version/sha (ADR-0042 adoption) ([6896e9a](https://github.com/ariefsaid/PMO/commit/6896e9a405b083c5450c7d7d8d1fa0d22ae5fdfc))
* **version:** show app version + sha in-app (ADR-0042 §2) ([60985fd](https://github.com/ariefsaid/PMO/commit/60985fd2253fe83f4ad824e9b05212b8f1393e4a))


### Bug Fixes

* **agent:** align stuck-banner fallback copy with the Stop/Retry buttons ([8a869f1](https://github.com/ariefsaid/PMO/commit/8a869f19c4068000e64372502f2576111218287c))
* **agent:** create the run when it doesn't exist, not when runId is absent — fixes browser-run 42501/errors ([fd62df5](https://github.com/ariefsaid/PMO/commit/fd62df5798ddc65abd9154e7e94d1145bceb2c7a))
* **agent:** persist the run when it doesn't exist (not when runId absent) — fixes multi-round errors + empty usage ([f730b72](https://github.com/ariefsaid/PMO/commit/f730b728b729e53c0333f0774f7e82942161590e))
* **release:** co-locate CHANGELOG under pmo-portal (release-please rejected ../ path) ([a2f94c3](https://github.com/ariefsaid/PMO/commit/a2f94c31c6f811525f270659cfef9ac06cb15572))
* **release:** move CHANGELOG under pmo-portal + drop illegal ../ changelog-path ([b911c34](https://github.com/ariefsaid/PMO/commit/b911c3447932dad4798fd16f372381a6157f4d1f))

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
