# Full-codebase review — PMO dev tip (2026-07-04)

**Trigger:** owner asked for a full-codebase QA review beyond the per-issue + aggregate cross-family passes.
**Method:** 7 independent pi+gpt-5.5 sweeps over the whole `dev` tree (not just recent changes), each with a
role system-prompt + a method-driven brief. glm-5.2 was requested for reliability/test/observability but was
z.ai-rate-capped (~4h); ran on the sanctioned gpt-5.5 fallback (re-run on glm optional).
**Original verdict: NO-SHIP to prod until the HIGH/Critical items are fixed → now RESOLVED on `dev`.**
Most findings were pre-existing (not this session's agent-tier work); two were **live in production**.

**✅ UPDATE 2026-07-04 — full remediation + 5-wave hardening program shipped to `dev` (8 PRs, #221–#228):**
🔴 exploitable set FIXED (#221 RED-3/4, #222 RED-1/2); SEC-HIGH-1/2 (#223); 🟡 observability (#224);
🟠 reliability atomicity 5/6 (#225); 🟡 data-layer indexes+pagination (#226); 🟡 test-hardening + a new
`deno check` edge-fn CI gate + dependabot bumps (#227/#228). TDD-first + reviewed (opus / Director read where
external cross-family was rate-capped). **Remaining = the deferred items in the sequencing list — none
exploitable, all ledgered.**

---

## Severity-ranked ledger

### 🔴 Exploitable security — ALL FIXED on dev
| ID | Sev | Where | Hole | Status |
|---|---|---|---|---|
| RED-1 | Critical | `agent_usage` (mig 0047) | No `CHECK(cost>=0)`; direct PostgREST insert with negative cost forges unlimited credits | ✅ mig 0050 CHECK (PR #222) |
| RED-2 | High | `agent-chat/handler.ts` | #220 regression: decision/answer with no pending item → un-gated model call → zero-credit spend | ✅ `isCreditExhausted` gate (PR #222) |
| RED-3 | High **(WAS LIVE PROD)** | `procurements_insert` (0002/0010/0038) | Client-supplied `requested_by_id` → PM files a PR "as" another user + self-approves → SoD bypass | ✅ mig 0051 hard-pin (PR #221; cross-family CONFIRM-CLOSED). **⚠ EXPEDITE main→prod.** |
| RED-4 | High **(WAS LIVE PROD)** | `projects_write` (0002) | No restrictive admin-only delete → non-admin hard-delete (ADR-0019 gap) | ✅ mig 0052 admin-only delete (PR #221; CONFIRM-CLOSED). **⚠ EXPEDITE main→prod.** |
| SEC-HIGH-1 | High | `user_views_select` (0045) | Owner OR-branch omits `org_id` → stale/other-org saved views readable on org change (B2B-future) | ledger |
| SEC-HIGH-2 | High | `agent-dispatch/dispatcher.ts` | `service_role` reads `procurement_status_events`; JS org-gate mitigates but violates the invariant — correct fix is a security-definer RPC | ledger (owner/ADR call) |

### 🟠 Reliability (atomicity — non-atomic multi-step writes partial-commit)
- Critical: `useTimesheetEntries` week save; `ProcurementDetails` VI capture (transition then invoice as 2 FE writes); bulk procurement import (retry duplicates, no idempotency key); agent SSE failures swallowed → stuck `running`.
- Important: `useFileUpload` orphans storage on confirm-fail; `uploadTransport` no XHR timeout; **no React error boundary** (render throw white-screens SPA); last-write-wins concurrent edits (no `updated_at` CAS).

### 🟡 Observability (NOT prod-ready — "will we know it broke?")
- Critical: automations can silently never fire (pg_cron GUCs unset, `agent-dispatch` not in standard deploy path); no edge-fn alerting/aggregation; agent cancel-failure invisible.
- Important: missing `OPENROUTER_API_KEY` → 502 no-log; usage-insert failures logged-only; PostHog dashboards deferred (Sentry-substitute not built); app-wide analytics events (procurement/projects/CRM) not wired.

### 🟡 Data/schema & performance (scale, not correctness)
- RLS-predicate & hot-order columns lack composite indexes (notifications, agent_threads, projects `contract_value`, pipeline, procurement records, status-events, timesheets) — every RLS query scans; list APIs mostly unpaginated; widespread `.select('*')`; client money aggregation in JS `number`. Strong MVP integrity but not yet "scale to millions" on the data layer.

### 🟡 Test quality (false-green risk)
- WEAK: `0055` procurement-SoD positive transitions (`lives_ok`, no post-state); `AC-AW-012` agent-write e2e (mocked UI, no real write); `0100` minting gate (simulated claims, no owner-scoped-mint proof); MyTasks error-state ("some toast"); drawer-guard (vacuous when file missing).
- Coverage: `agent_dispatch_watermarks` no pgTAP; bulk-timesheet-approval journey `test.fixme`; incident e2es flag-skipped; reconcile the 44-via-regex vs "49" table inventory with a catalog-driven test.
- **Fast-follow (from the RED-3/4 re-confirm):** `0103` project-delete pgTAP should add explicit Finance/Executive/cross-org-Admin DELETE-denial cases (policy provably covers them; explicit assertions are belt-and-suspenders for a prod-bound fix).

### 🟢 Supply-chain (clear)
- Both open dependabot alerts NOT reachable: `drizzle-orm` (HIGH) unimported dead weight from the retired sidecar; `dompurify` (MED) transitive via posthog-js, no vulnerable call site. **Refresh deps to clear the alerts**; no live exposure.
- MED: edge-fn `deno.json` semver ranges, no `deno.lock` — pin for deploy determinism. LOW: `noApiKeyInBundle` gate covers only the two agent keys. Secrets/logging hygiene app-wide: clean.

---

## Recommended sequencing (owner decides promotion)
1. **Expedite RED-3 + RED-4 to `main`→`production`** — now on `dev`, cross-family CONFIRM-CLOSED. (Prod promote is the owner's per-instance call.)
2. RED-1 + RED-2 already on `dev` (agent tier flag-off) — normal promotion.
3. Reliability atomicity (transactional RPCs) + React error boundary — next hardening wave.
4. Observability: a prod-readiness check script + edge-fn error alerting — before enabling the agent tier in prod.
5. SEC-HIGH-1/2, data-layer indexes/pagination, WEAK-test hardening, dep refresh — backlog.
