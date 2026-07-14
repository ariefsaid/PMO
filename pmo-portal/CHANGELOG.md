# Changelog

All notable changes to PMO Portal are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows
**ADR-0042** (SemVer, pre-1.0 while single-tenant MVP). A version is minted on **`main`** (the
release-please flow — amended 2026-07-08, was `main → production`) and git-tagged `vX.Y.Z` on the
`main` commit; `main → production` then deploys an already-tagged commit.

Each released section pins the full deploy manifest (app sha · DB migration high-water ·
edge-function state) so "what's in production" is unambiguous. The DB schema version (migration
high-water mark) moves independently of the product tag.

## [0.8.0](https://github.com/ariefsaid/PMO/compare/v0.7.0...v0.8.0) (2026-07-14)


### Features

* **views:** enable My Views + AI composer by default; stop assistant claiming a false save ([#328](https://github.com/ariefsaid/PMO/issues/328)) ([49222a8](https://github.com/ariefsaid/PMO/commit/49222a801d24d4721697d85f159565e7a95b6e80))

## [0.7.0](https://github.com/ariefsaid/PMO/compare/v0.6.0...v0.7.0) (2026-07-13)


### Features

* **analytics:** wire 10 engagement/friction events + PostHog query helper + 3 hardening fixes ([#324](https://github.com/ariefsaid/PMO/issues/324)) ([3a22bcf](https://github.com/ariefsaid/PMO/commit/3a22bcf86927767b0ce7ec341d374c5fc4ca51ed))
* **auth:** local JWKS caller-JWT verification — pilot on compose-view (ADR-0057 Tasks 1–2) ([#314](https://github.com/ariefsaid/PMO/issues/314)) ([dd86076](https://github.com/ariefsaid/PMO/commit/dd860769bc7559832f53cff80d79d4f2566af31b))


### Bug Fixes

* **e2e:** AC-JWT-005 skips when compose-view isn't served (CI edge_runtime off) ([#316](https://github.com/ariefsaid/PMO/issues/316)) ([b1742ae](https://github.com/ariefsaid/PMO/commit/b1742ae0ad40b5822123a72721c4ad11ebfa25ca))
* **e2e:** green the 3 promote-integration failures (AC-CUA-090 hard + AC-AAN-036/AC-AW-012 flaky) ([#326](https://github.com/ariefsaid/PMO/issues/326)) ([2eecc37](https://github.com/ariefsaid/PMO/commit/2eecc37c638a1a734ff840d1c49268ec90e4adfe))
* **e2e:** make AC-DEL-022 retry-idempotent + AC-AUTHF-005 redirect timeout (promote-integration greens) ([#318](https://github.com/ariefsaid/PMO/issues/318)) ([d0fad99](https://github.com/ariefsaid/PMO/commit/d0fad99f08ea94cc89a8e6ba20661738683eeff9))


### Performance

* **e2e:** reuse captured session storageState + retire per-spec bcrypt ([#306](https://github.com/ariefsaid/PMO/issues/306)) ([082f8fa](https://github.com/ariefsaid/PMO/commit/082f8faf23b9e7b3c2c942e2de36c1e24a15207e))

## [0.6.0](https://github.com/ariefsaid/PMO/compare/v0.5.0...v0.6.0) (2026-07-11)


### Features

* **adapter-seam:** external-system adapter seam P0 (ADR-0055) ([#299](https://github.com/ariefsaid/PMO/issues/299)) ([2cbacd5](https://github.com/ariefsaid/PMO/commit/2cbacd51ab7ccbd0ac7c6ccc0100a43a30aa387d))
* **admin:** agent cost dashboard in the operator layer ([#297](https://github.com/ariefsaid/PMO/issues/297)) ([16d07cb](https://github.com/ariefsaid/PMO/commit/16d07cbc1cafabb22d88b3c4e65edb1bf4ad36bd))
* **agent:** no-train fallback tier with only-restricted routing ([#292](https://github.com/ariefsaid/PMO/issues/292)) ([4111fbd](https://github.com/ariefsaid/PMO/commit/4111fbdcc532e4d72efe20644c7831d8f7a19797))
* **agent:** parallel reads / serial writes in the tool loop ([#5](https://github.com/ariefsaid/PMO/issues/5)) ([#294](https://github.com/ariefsaid/PMO/issues/294)) ([311cc71](https://github.com/ariefsaid/PMO/commit/311cc71f9bc28b16efbb9af240a557a3f7eea7a5))
* **agent:** privacy-first provider pinning for prompt-cache locality ([#291](https://github.com/ariefsaid/PMO/issues/291)) ([98e2974](https://github.com/ariefsaid/PMO/commit/98e2974de1eccd28ddfd560f9e005c669155e6dc))
* **agent:** token-budget transcript compaction (shrink the replayed miss) ([#293](https://github.com/ariefsaid/PMO/issues/293)) ([d34fb7b](https://github.com/ariefsaid/PMO/commit/d34fb7bd8d5764a03eb9665b9a0f20f31a98e652))
* **clickup-adapter:** ClickUp adapter P1 — tasks domain flip + change-feed + onboarding (ADR-0055/0056) ([#307](https://github.com/ariefsaid/PMO/issues/307)) ([a109c21](https://github.com/ariefsaid/PMO/commit/a109c21d91a7272be35936eda33ea1c0da8bd79d))
* **edge:** forward edge-fn errors into PostHog Error Tracking (IG-audit P2) ([#305](https://github.com/ariefsaid/PMO/issues/305)) ([c36b72c](https://github.com/ariefsaid/PMO/commit/c36b72c3dd367089b71f66c3b47b0f8836d205bc))
* **edge:** request-rate throttle on agent-chat (IG-audit P1) ([#302](https://github.com/ariefsaid/PMO/issues/302)) ([348f955](https://github.com/ariefsaid/PMO/commit/348f955f91acc3a1e9196a1cf299411d8a441cbd))
* **telemetry:** capture cached_tokens + reasoning_tokens in agent_usage ([#290](https://github.com/ariefsaid/PMO/issues/290)) ([4f53ead](https://github.com/ariefsaid/PMO/commit/4f53eaddbb24b4f5314de37bc63945b319f4e5ad))
* **ts:** enable strict mode (fix 94 latent errors, incl. 2 real null bugs) ([#300](https://github.com/ariefsaid/PMO/issues/300)) ([dbf902d](https://github.com/ariefsaid/PMO/commit/dbf902df713d9ffca05fc39bdf7f14ebee10356d))


### Bug Fixes

* **e2e:** AC-ACD-010 locator — scope to stat-tiles + exact match ([a43dcc7](https://github.com/ariefsaid/PMO/commit/a43dcc77c0b9001b136bd299ac060e8d4ed647ef))


### Performance

* **test:** split Vitest into node + jsdom projects ([#309](https://github.com/ariefsaid/PMO/issues/309)) ([2708b66](https://github.com/ariefsaid/PMO/commit/2708b66ba81d4845247776e8ec6fef83bb138e86))

## [0.5.0](https://github.com/ariefsaid/PMO/compare/v0.4.0...v0.5.0) (2026-07-09)


### Features

* **agent:** enable automations — fix owner-JWT mint + Vault/dispatch-secret + daily/weekly/dom schedules ([#285](https://github.com/ariefsaid/PMO/issues/285)) ([7bde543](https://github.com/ariefsaid/PMO/commit/7bde543641e934e1b14f8f26d4adb875630bec4c))


### Bug Fixes

* **ui:** remove client-facing repo links + edge-version label ([#282](https://github.com/ariefsaid/PMO/issues/282)) ([0dbf2f5](https://github.com/ariefsaid/PMO/commit/0dbf2f576fcd68278320653117c82209bc745089))

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
