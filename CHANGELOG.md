# Changelog

All notable changes to PMO Portal are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning per [ADR-0042](docs/adr/0042-versioning-and-release-convention.md) (SemVer, pre-1.0). Product version is git-tagged `vX.Y.Z` on the `main` commit; the DB schema version is the migration high-water mark, tracked separately.

## [Unreleased]

_release-please accrues entries here from Conventional Commits landing on `main`._

## [0.2.0] — 2026-07-08

The current production baseline. Adds user-composed views (ADR-0036) and the agent-native in-app assistant (ADR-0040/0041) — the app's first server-side architectural tier (the Deno edge-function LLM deputy) — plus the broadened agent read scope, the live step trail, and DB hardening.

**Manifest:** app `1f68058` · DB migrations `→0081` · edge functions `agent-chat`, `compose-view`, `agent-dispatch`, `admin-invite-user` deployed.

## [0.1.0] — 2026-07-01

Versioning baseline (ADR-0042). The full pre-agent product: backend foundation, write MVP, the CRUD/RBAC foundation (ADR-0016–0019), UI/UX programs, deployment, analytics, and procurement case-folder records.

**Manifest:** app `fc312eb` · DB migrations `→0041` · edge functions not deployed.
