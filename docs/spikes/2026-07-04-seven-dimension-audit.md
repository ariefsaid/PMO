# 2026-07-04 — Seven-dimension audit of `dev` (post-promote) + same-day hardening wave

**Audited at:** `dev` HEAD `8869145` (content == `main` at the time; read-only Explore agents ×7:
security, adversarial, data/schema, supply-chain, reliability, test-quality, obs/maintainability).
**Verified-fixed by the audit:** RED-1..4 + SEC-HIGH-1/2 all genuinely closed at HEAD.
**This doc is the deduped ledger + disposition.** The same-session hardening wave (commit on `dev`,
2026-07-04 late) fixed the rows marked ✅.

## Prod exposure at audit time
- Prod DB at migration 0057 → **H-1 was LIVE in prod** (PostgREST reachable).
- `production` = `8e4998e` with `agent-chat` + `compose-view` deployed → **C-1/H-5/M-4 live in prod**.
- `agent-dispatch` not deployed (automations idle) → M-1/M-2 latent until that deploy.

## Ledger (deduped across the 7 audits)

| # | Sev | Finding | Disposition |
|---|-----|---------|-------------|
| C-1 | 🔴 | No retry/backoff on the OpenRouter model call — one transient 5xx/429/network blip ends the turn | ✅ **FIXED** — bounded retry ×3, exp backoff+jitter, 429/5xx/network only (timeouts + 4xx terminal); `openRouterModelClient.ts` + 6 AUDIT-C1 Vitest tests |
| H-1 | 🟠 | Procurement record tables (PR/RFQ/PO/Payment): bare 4-role `for all` policies → amount forgery / status flip / evidence hard-delete via raw PostgREST, bypassing the 0037 RPCs; `*_files` ×7 non-admin hard-delete | ✅ **FIXED** — migration `0058`: client write grants REVOKED on the 4 record tables (all legit writes were already RPC-only), `amount >= 0` CHECKs, restrictive Admin-only DELETE on all 7 files tables; pgTAP `0110` (9 proofs). **Prod DB needs 0058 pushed (owner gate).** |
| H-2 | 🟠 | `AGENT_CREDITS_ENFORCED` default OFF → RED-1/2 gate nothing by default | ⏸ **OWNER DECISION, not a defect** — GTM plan: launch un-enforced, price after pilot-margin data (backlog "Credits enforcement"). Revisit at pricing. |
| H-3 | 🟠 | Credit preflight TOCTOU → concurrent overspend | ⏸ **ACCEPTED v1 tradeoff** (spec NFR-AUC-PERF-002, code-comment + backlog "TOCTOU preflight revisit at ADR-0044-scale"). Bounded transient overspend; revisit when automations raise concurrency. |
| H-4 | 🟠 | Retry/resume can double-charge (no idempotency on the model call) | ⏸ **ACCEPTED v1** (audit itself offered "accept & document"). A retry is a new run by design; usage rows stay per-model-call-resolution. |
| H-5 | 🟠 | `agent_usage` insert failure swallowed → unbounded free model calls if persistently failing | ✅ **FIXED** — fail-closed after 3 CONSECUTIVE failures (`UsageMeteringUnavailableError` → errored turn; single blips still swallowed per NFR-AUC-SEC-006); `usage.ts` + AUDIT-H5 tests |
| H-6 | 🟠 | TS `strict` OFF in pmo-portal | ⏳ **DEFERRED — own issue.** Incremental-migration-sized; not a this-wave edit. |
| M-1 | 🟡 | Automation cost amplification (unbounded prompt, unbounded timeout_s, no per-owner cap) | ✅ **FIXED** — migration `0059`: prompt ≤ 4000, timeout_s ∈ [10,900], ≤ 25 active/owner (trigger); action `validate` mirrors; pgTAP `0111` + Vitest |
| M-2 | 🟡 | Dispatcher tick no mutual exclusion → overlapping ticks double-fire schedules | ✅ **FIXED** — atomic claim-then-fire: conditional `last_fired_at` UPDATE keyed on minute-floor; exactly one overlapping tick wins; fail-closed on claim error; `dispatcher.ts` + `dispatcher.claim.test.ts` |
| M-4 | 🟡 | CORS `Access-Control-Allow-Origin: '*'` on agent fns | ✅ **FIXED (seam)** — `AGENT_ALLOWED_ORIGIN` env narrows origin; `'*'` fallback for local dev. **Set the secret at next edge-fn deploy.** |
| M-11 | 🟡 | `AuthProvider` `getSession().then()` without `.catch` → app stuck on loading forever on rejection | ✅ **FIXED** — rejected session ⇒ signed-out + loading resolves; test added |
| M-17 | 🟡 | No global mock hygiene in Vitest config | ✅ **FIXED** — `clearMocks: true` (4301/4301 still green) |
| M-3 | 🟡 | Dispatcher uses long-lived service_role key for event selection | ⏳ deferred (already quarantined to metadata + SEC-HIGH-2 RPC; least-priv role = own issue) |
| M-5 | 🟡 | Minted owner-JWT TTL not bounded to timeout_s | ⏳ already tracked (ADR-0044 short-TTL mint) |
| M-6 | 🟡 | `procurement_status_events` append-only by policy omission, not trigger | ⏳ deferred (mirror `agent_events_feedback_only` trigger — small own slice) |
| M-7 | 🟡 | Duplicate pgTAP file numbers (0034×2, 0052×6, 0066×2) | ⏳ deferred (harness globs filenames, no collision in execution; renumber = churn-only) |
| M-8 | 🟡 | Unindexed audit-stamp/settlement FKs | ⏳ deferred (additive index slice; hot paths were covered by 0042/0057) |
| M-9/M-10 | 🟡 | Unbounded list reads / unbounded transcript DOM | ⏳ deferred (pagination slice; #226 covered the worst) |
| M-12 | 🟡 | Drain-loop catch swallows non-abort errors as "Stopped" | ⏳ deferred (panel UX slice, pairs with the live 406/duplicate-bubble chips) |
| M-13 | 🟡 | No client error monitoring sink | ⏳ **already planned** — GTM MVP item 3 (PostHog error tracking) |
| M-14 | 🟡 | God components (CompanyDetail 1167 &c.) | ⏳ deferred (refactor program, not a hardening edit) |
| M-15 | 🟡 | ADR-0017 hooks-consume-repositories vs DAL-direct reality | ⏳ deferred (docs/decision reconciliation) |
| M-16 | 🟡 | 44 fixed waits in e2e | ⏳ deferred (test-hardening slice; pattern exists in `e2e/helpers.ts`) |
| Lows | 🟢 | Root `package.json`/lockfile stray; stale root screenshots | ✅ **FIXED** (removed). Rest (jszip MIT election note, `classifyMutationError` detail leak, tautological assertion in ProcurementTab test, deno.lock pin) ⏳ ledgered. |

## Post-merge prod actions (owner-gated, per branch-flow rules)
1. `scripts/db-push-prod.sh` → migrations **0058–0059** (both additive/revoke-only; legit flows unaffected — all record writes already go via RPCs).
2. Redeploy `agent-chat` + `compose-view` (picks up C-1 retry, H-5 fail-closed, M-4 seam) and set `AGENT_ALLOWED_ORIGIN=https://pmo-bfb.pages.dev`.
3. When `agent-dispatch` first deploys, M-1/M-2 ship with it automatically.
