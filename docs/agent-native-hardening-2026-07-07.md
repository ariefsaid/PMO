# Agent hardening cross-check vs the agent-native battery catalog (2026-07-07)

**Goal:** make the PMO end-user agent production-ready on the *weak* `deepseek-v4-flash` (no model
swap), by making query behavior predictable and confirming the agent is hardened against the
batteries mined from Builder.io `agent-native` in `docs/spikes/2026-07-03-agent-native-battery-mining.md`.

## Method
- Read the battery catalog (the spike above) — the exhaustive mining of `@agent-native/core` +
  upstream docs, tiered by value.
- Built a **DB-free query-selection eval probe** (`evals/query-selection-probe.ts`) that runs the
  REAL system prompt + tools against `deepseek-v4-flash` on OpenRouter, N times per question, and
  reports the `query_entity` call rate + selected entity. This operationalizes "predictable queries."

## Measured result (the core hardening claim)
`deepseek-v4-flash`, current prompt, 6 common questions × N runs:
- **100% `query_entity` call rate** (18/18 then 24/24) — the model reliably tools rather than refusing.
- Entity selection correct for 5/6; the one miss ("open tasks *across my projects*" → `projects`) is a
  genuinely ambiguous phrasing the weak model over-anchors on. Fixed the general case with an explicit
  `tasks` recipe + a noun-match-first rule (commit b66ea64). The probe is retained as the standing gate.

## Battery-by-battery hardening status (catalog → PMO agent)
| Catalog battery | PMO state | Hardened? |
|---|---|---|
| Prompt architecture (layered charter + "Use when…" skills + anti-fabrication + verify-before-done) | `prompt.ts` charter rules 1–7 (deputy, anti-fabrication, verify-before-done, map-before-refuse) + skills (table/ask-user/writes/map-questions) | ✅ + tightened this session (noun-match + tasks recipe) |
| Typed generative-UI results (real tables/charts, not markdown) | `panel/widgets/` (`DataTableWidget`, `WidgetSlot`, `registry`) + `table-not-markdown` skill (`query_entity as:"table"`) | ✅ built; markdown fallback also fixed (`prose-pmo` CSS) |
| Persistence + durable resume (thread scope, tool-call journal) | `agent_threads/runs/events` (ADR-0043); **fixed a latent multi-tenancy persistence bug** — `org_id` default was seed-only so non-seed users' runs failed RLS silently (0 runs in prod). Mig `0061` → caller-org default; pgTAP `0113` | ✅ + real bug fixed this session |
| Broadened read-scope (the agent can answer about the app's data) | `query_entity` widened `projects/companies` → 8 RLS-bounded entities (`entityCatalog.ts`, mig-free — RLS is the ceiling); pgTAP `0114`; cross-family security review = SHIP | ✅ this session |
| Context-awareness, progress/stuck-run, notifications, automations, ask-user, attachments, Cmd+K, eval harness, conditional approvals | All built in prior programs (I1–I6, batteries-included-A) | ✅ (pre-existing) |
| Per-user credits / quota (catalog notes upstream has NONE) | `agent_usage` + credits (ADR differentiator) | ✅ (pre-existing) |
| Deferred by design | observational-memory/thread-compaction (I7), MCP-server exposure, messaging channels, voice | ⏸ (catalog Tier 2/3, owner-gated) |

## Verdict
The agent-native batteries relevant to the end-user agent are **built and, this session, hardened**
where it mattered for the weak model: predictable queries (eval-proven), honest broadened data access
(security-reviewed), a real persistence/tenancy bug fixed, and readable typed/markdown rendering. The
standing gate for query predictability is `evals/query-selection-probe.ts` (run it against any prompt
change). No catalog battery is missing that blocks production readiness; the remainder are deferred by
the catalog's own tiering.
