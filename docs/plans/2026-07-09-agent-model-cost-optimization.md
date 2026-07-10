# Agent model-cost optimization — plan + decisions (2026-07-09)

Owner: arief.said@gmail.com · Director-orchestrated. Lands on `dev` (→`main` gated). Never prod.

Goal: cut the agent's per-run model spend and hold a **no-training** data-privacy guarantee, without
degrading agent quality or latency past the edge wall-clock budget. PMO's agent workload is ~94%
**input** tokens (D8 stateless transcript replay), so the dominant lever is the shared static prefix —
system prompt + tool schemas — replayed on every round and every user.

## Empirical grounding (why this plan exists)

- Telemetry (`agent_usage`) showed **actual cost ≥ the no-cache list estimate** — i.e. prompt caching was
  **not** discounting spend. Root cause in code: the model request sent `provider: { sort: 'throughput' }`,
  which lets OpenRouter route across backends per request → the shared prefix never stays warm on one
  backend, and pricing/caching differ per host (a documented real-world bill-spike failure mode).
- The ledger never recorded `cached_tokens` / `reasoning_tokens`, so cache hit-rate was **unmeasurable**.

## Cross-user caching — the question answered

> "If multiple users send similar data as input, does it count as a cache hit on the shared tokens?"

**Yes — on the *shared prefix*, not the per-user data.** DeepSeek/OpenRouter provider-side prefix caching
is **content-addressed, not identity-addressed**: it matches the longest contiguous prefix (from token 0)
already persisted within the API-key's cache namespace, regardless of which user sent it. So under our one
server-side key, an identical `[system prompt + tool schemas]` prefix caches **once** and is hit by every
user's request; each user's divergent tail (their question/data) is always a fresh miss. Conditions:
1. **Pin a caching-capable backend** (else routing defeats cache locality — the fix below).
2. **Static content first, volatile last** (prefix matches from token 0; 64-token minimum unit).
3. **Warmth = traffic** — a cold prefix (low traffic) yields no benefit; at multi-user scale the shared
   prefix stays hot. This is why the single-chat sample showed nothing; the win scales with concurrency.

## Provider selection — decision (the attached OpenRouter provider table)

Constraint (owner): **avoid providers that train on / retain request data.** Of the backends serving
`deepseek/deepseek-v4-flash`, only **DeepInfra** and **DigitalOcean** carry the clean (no-train) data
policy; DeepSeek-direct, Baidu Qianfan, GMICloud, StreamLake, Alibaba all flag training/retention.

The owner noted DeepSeek's cache-read rate ($0.0028/M) is far below the no-train hosts'
(DeepInfra $0.018/M, DigitalOcean $0.028/M) and worried the switch is costly. **It is not, materially** —
cache reads are a tiny *absolute* share of the bill, so base input/output rates dominate at realistic
cache ratios. Worked estimate for a real multi-round run (~104.8k input, ~6.8k output, 80% prefix-cache):

| Provider (policy) | cached-in | fresh-in | output | **total/run** |
|---|---|---|---|---|
| DeepSeek (⚠ trains) — $0.0028 / $0.14 / $0.28 | $0.00024 | $0.00294 | $0.00191 | **~$0.00508** |
| **DeepInfra (✓ no-train)** — $0.018 / $0.09 / $0.18 | $0.00151 | $0.00189 | $0.00123 | **~$0.00463** |

DeepInfra is **~9% cheaper total** despite the higher cache-read rate, because its base rates are lower.
DeepSeek only edges ahead above ~88–90% cache-hit — which we'll now *measure*, not assume. **The real cost
of choosing no-train is latency**, not dollars: DeepInfra ~17 tps / DigitalOcean ~12 tps are the slowest
in the table (DeepInfra is the backend we previously un-pinned for ~15–30s/round). We accept that, measure
p95 via telemetry, and attack it with transcript compaction + parallel tools (deferred items below).

**Decision (initial, PR #291):** default `provider = { data_collection: 'deny', order:
['deepinfra','digitalocean'], allow_fallbacks: true }` — green-only, cache-stable.

**Decision (refined, owner 2026-07-10 — the fallback tier):** the shield tiers are **green** = no
prompt retention (DeepInfra, DigitalOcean), **orange** = retains prompts but does NOT train on them
(GMICloud, Baidu, StreamLake, Alibaba, DeepSeek-direct), **red** = trains (avoid). The owner accepts the
orange (retain-not-train) hosts as a *fallback* tier, ordered by jurisdiction then speed. New default:
```
provider = {
  order: [deepinfra, digitalocean, gmicloud, baidu, streamlake, alibaba, deepseek],
  only:  [<same set>],          // HARD allow-list — a fallback can never reach a training host
  allow_fallbacks: true,
}
```
Green first (no-retention + cache locality); then US GMICloud; then the fastest CN hosts (Baidu 81 /
StreamLake 42 / Alibaba 39 tps); DeepSeek-direct last. `only` replaces `data_collection:'deny'` as the
safety mechanism (the latter would exclude the retain-not-train fallbacks); `AGENT_PROVIDER_DATA_COLLECTION=deny`
re-imposes green-only on demand. **⚠ Provider slugs must be verified against OpenRouter before prod** — a
wrong slug in `only` silently drops that host; all are overridable via `AGENT_PROVIDER_*` secrets (no
redeploy). Every knob stays an `AGENT_PROVIDER_*` secret so the owner re-trades privacy↔latency↔cache
without a code deploy.

## Prompt-ordering audit (cache-locality invariant)

Audited `buildAgentSystemPrompt` + the handler's message assembly. **Finding: already cache-optimal** — the
large static body (charter + tool index + skills + entity schema + HELP_CORPUS) is first and byte-identical
across users/requests; the only volatile bits are the per-user **role sentence** (near the top) and the
per-request **grounding hint** (appended at the tail). The system prompt is built once per run and reused
across rounds. No reorder is made: moving the role sentence off the top would fragment nothing meaningful
at scale (per-role prefixes stay warm) while reducing role-grounding salience — a bad trade. **Invariant
recorded for future changes:** keep fully-static content first; never inject a timestamp / session id /
per-request token ahead of the static body; append volatile grounding at the tail.

## Slices

| # | Slice | Status |
|---|---|---|
| 1 | **Telemetry hardening** — `agent_usage.cached_tokens` + `reasoning_tokens` capture chain (migration 0084, capture in openRouterModelClient/usage, pgTAP 0139 + Vitest) | ✅ PR #290 → `dev` |
| 2 | **Provider pinning** — green-only no-train default (`data_collection:'deny'` + DeepInfra→DigitalOcean), env-overridable (`AGENT_PROVIDER_*`) | ✅ PR #291 → `dev` |
| 2b | **Fallback tiering** — `only`/`ignore` support + the owner's 7-tier no-train fallback order (green → US → CN → DeepSeek), `only`-restricted | ✅ this PR |
| 3 | **Prefix-order audit** — confirmed cache-optimal; invariant documented (above) | ✅ PR #291 (doc) |
| 4 | **Tool-result compaction + transcript pruning** — shrink the *miss* portion of the 94%-input replay | ⏳ next |
| 5 | **Parallel tool calls** — execute all tool_calls per round (loop currently runs only tool_calls[0]); cuts rounds + wall-clock | ⏳ next |

## Verification / rollout

- **Measure before committing the tradeoff:** after #1+#2 deploy, watch `agent_usage.cached_tokens` hit-rate
  + cost/run + p95 latency for a representative window. If DeepInfra latency is unacceptable, the decision
  re-opens (relax to a faster no-train option, or `AGENT_PROVIDER_SORT=throughput` within `data_collection:'deny'`)
  — all via secrets, no redeploy.
- Gates: `npm run verify` (local) + CI `verify`; edge-fn TS via CI `deno check` + boot-smoke; DB via pgTAP
  on the `dev`→`main` promotion.
