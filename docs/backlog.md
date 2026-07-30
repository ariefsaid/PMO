# PMO Portal — live backlog (status + what's next)

**This is the living status doc — read it first.** Shipped-program *history* lives in
[`docs/history.md`](history.md) (don't read it for status). Locked owner-decisions are in
`docs/decisions.md` (OD-* lookup by id). Roadmap framing in `docs/roadmap-spines.md`.

### ⚑⚑⚑ CURRENT FOCUS — the WHOLE observability+analytics program is COMPLETE on `dev` (2026-07-28). Not promoted.

**All 11 PRs shipped to `dev`. Zero open PRs.** Spec `docs/specs/observability-analytics.spec.md`,
plan `docs/plans/2026-07-25-observability-analytics.md`, ADRs 0066/0067.

| PR | Slice | What it closed |
|---|---|---|
| #394 | NUL-byte gate | 3 source files were invisible to `grep`; one was deployed |
| #398 | E — signal config + consent | heatmaps/web-vitals on, opt-out + DNT, honest disclosure |
| #399 | F — friction, funnel, quota, tile gate | `save_failed` was inert; 2 tiles could never render |
| #400 | A — alerting | write-ahead `alert_send_log` — bounds the re-alert loop **without dropping alerts** |
| #401 | B — money & concurrency | rejects negatives **and `NaN`**; automation-cap race closed with a real 2-session `dblink` proof |
| #402 | C — edge coverage | **4 → 22** functions reporting through one choke point |
| #403 | D — self-report + retention | a failed `error_events` insert now reaches PostHog; 90-day purge with proof-of-run |
| #404 | quota parser | the alarm parsed `quota_limits` (an ARRAY); the API returns `limited` (an OBJECT). **It could never have worked** |
| #406 | spike deletion | `spike/agent-native-rls/` + its lane removed; supersedes FR-HRD-043 |
| #407 | vitest timeout 5s→15s | the default was a **contention** detector, not a hang detector |
| #408 | quota row validation | #404's fix still reported all-clear having checked nothing — found by the retrospective battery |

⚑ **#404 and #406 shipped WITHOUT a review battery** (Director judged them low-risk, merged on CI
alone). The retrospective battery run afterwards found a **Critical in #404** — both reviewers
independently. Verdicts: skipping it on **#404 was NOT defensible**, on **#406 it was**. The correct
trigger is not "does this touch the DB" but **"does this parse untrusted external data into a
privileged sink"** — #404 parsed a third-party HTTP response into CI stdout, which is a command
interpreter. See the lessons block below.

**⛔ OWNER ACTIONS OWED:**
1. ✅ **DONE 2026-07-28 — repo secrets `POSTHOG_API_KEY` + `POSTHOG_PROJECT_ID` are set** (piped from
   1Password vault `AS` item `posthog-personal-api` straight into `gh secret set`; the value was never
   read or displayed). Verified by `gh secret list`, not by an exit code.
   ⚑ **CORRECTION to an earlier claim in this file: the workflow does NOT "go red daily until they
   exist".** `.github/workflows/posthog-quota.yml` is only on `dev`, and GitHub fires `schedule:` and
   `workflow_dispatch` **exclusively from the DEFAULT branch** (`main`) — `gh workflow run` returns
   `HTTP 404: not found on the default branch`. So the alarm has never run and **is not protecting
   anything until `dev` is promoted.** Setting the secrets early means it works on its first real run
   rather than failing closed; there was no daily red to avoid.
   ✅ **Key VALIDATED live 2026-07-28** — `project:read` alone is sufficient for `/quota_limits/`
   (previously documented but never called). Live result: `✓ 14 PostHog allowance(s) checked`.
   Usage is nowhere near any ceiling: events 238/1M, exceptions 13/100k, recordings 25/5k,
   AI credits 32/500 (highest at 6.4%).
   ✅ **Least privilege DONE** — the secret was repointed to a dedicated `project:read`-scoped key
   (1Password item **`posthog-pmo-api`**, vault `AS`, field `credential`). The write-capable
   `posthog-personal-api` stays in 1Password for local `provision-dashboards.mjs` runs, which need
   `dashboard:write` + `insight:write`. ⚑ Don't export the CI key in a shell and then run
   `provision-dashboards.mjs`/`query.mjs` — they will fail on scope.
   *Transport is sound:* repo is PUBLIC but there is **no `pull_request_target`** anywhere in
   `.github/workflows/` (so fork PRs never receive secrets), triggers are `schedule`+`workflow_dispatch`
   only (not fork-reachable), `permissions: contents: read`, an explicit `::add-mask::` on top of
   GitHub's automatic masking, and `ariefsaid` is the only collaborator.
2. ✅ **DONE 2026-07-28 — `gordi-pre-test` stopped.** It was a Postgres 17 container for the *gordi*
   project running a **22-hour COGS aggregation with `SET statement_timeout=0`** — the timeout had been
   deliberately disabled after a 300s cancellation, and the query never finished. ~100–200% CPU
   (one full core), idle load 253 → **4** once stopped. It produced phantom ~5000ms test timeouts
   **three times**, each costing an isolation round to disprove.
   ⚑ It was **not** the sole cause: a full `npm run verify` alone drives this 10-core machine to
   load ~140, which is why #407 (timeout 5s→15s) was still needed.
3. ✅ **DONE 2026-07-28 (owner-approved) — `spike/agent-native-rls/` + `.github/workflows/spike-rls.yml`
   DELETED** (10 files, ~1,970 lines). It was retained only for ADR-0036's §8 SSO UX check, and **§8 was
   closed 2026-07-03** — so it was being kept for a check on an abandoned path. This **supersedes
   FR-HRD-043** (`spike-rls.yml` shall use `npm ci`): the requirement is satisfied by deletion rather
   than by the lockfile #401 committed — the lane no longer exists to install anything.
   ⚑ ADR-0036 §4–§7 shipped and are unaffected; the spike's three claims are recorded in the ADR and
   need no re-run. Recover from git history if §8 is ever revived.
4. **AS-1/AS-2 unconfirmed assumptions now shipped:** `error_events` retention = **90 days**; Telegram
   drain cadence stays **hourly**. Both one-value changes.

**🔴 Filed from this program, NOT fixed (live in production now):** `authenticated` holds **INSERT** on
`projects.contract_value` (UPDATE is correctly withheld). A Project Manager can create a project already
in a won status with an arbitrary contract value, a forged `decided_at` and a forged
`customer_contract_ref` — **no `audit_events` row**, because `log_audit` is wired to the RPC and to
AFTER DELETE, not INSERT. Bypasses ADR-0019 money SoD entirely. The client-side guard at
`src/lib/db/projects.ts:122-128` calls itself "defence in depth"; there is no server-side authority
behind it. Needs a BEFORE INSERT trigger restricting status to origination + nulling the win fields.

**Deferred, recorded, not done:** **FR-OBS-001 is PARTIAL, not closed** — `serveWithErrorReporting`
(ADR-0066) only reports errors that **throw** out of a handler; every deliberately-caught failure
that `return`s an error response produces **zero** `error_events` and zero PostHog `$exception`.
Verified: `clickup-sweep`'s `MISCONFIGURED`/`OWNERSHIP_READ_FAILED` 500s and its per-org `catch` that
`console.error`s and lets the function return HTTP 200 `{ok:true}`; `erpnext-sweep`'s `MISCONFIGURED`.
Exactly **1** call site outside `_shared` (`agent-chat`) calls `reportEdgeError` directly, against
dozens of `console.error` calls that return rather than throw — precisely the deploy-misconfiguration
class behind v0.8.0's 8-day-stale-deploy incident that motivated this spec. **New deferred item:**
wire `reportEdgeError` into handled-error return paths (not implemented here). · FR-OBS-003 (79
free-text `console.error` → enum sweep — error *coding* is not done either) · FR-HRD-042
(interactive-create idempotency, pulled to its own spec as unplannable) · the automation cap is still
bypassable by un-archiving (BEFORE INSERT only) · `changed-lines-coverage.mjs` diffs `-- pmo-portal/`
only, so the ≥80% DoD is **unenforceable for every `supabase/**` change** · `telegramNotify.test.ts`'s
AC-OF-005 reimplements the branch it tests and should migrate onto `runDrain`.

**Known limitations, deliberate and documented (do not "fix" without reading why):**
- `save_failed`'s `module`/`operation` are **constants** (`unknown`/`classify`) until call sites are
  threaded. No tile breaks down on them; `docs/analytics-events.md` says so. Do not break down by
  `module` in PostHog's explorer and read ~100% `unknown` as a fact.
- **`$current_url`/`$pathname` are denylisted** — they carried raw record UUIDs on every event
  (spec §6 forbids that). Cost: **PostHog's built-in path and web-analytics views are empty by
  design.** `app_route_viewed` still carries parameterised navigation.
- The **consent e2e lane first executes in CI at the `dev`→`main` promote** — all e2e lives in the
  `integration` job, which is `main`-only. Verified locally incl. `CI=true`; expect promote-time
  CI-env gaps there if any.
- Session replay + autocapture remain **demo-prospect only** (owner decision OD-OBS-1).

**Open owner question:** the analytics opt-out **fails open** if `localStorage` is evicted (Safari ITP
clears it ~7d; so does "clear site data"). Both our flag and PostHog's live there. A first-party
cookie mirror would fix it — a product decision about how durable a consent promise should be.

---

### ⚑ AGENT re-query-loop regression — FIX BUILT on `fix/agent-requery-loop` (2026-07-28), owner-gated deploy

**Symptom (found in prod agent transcripts):** "Which of my projects are behind schedule?" answered
cleanly on Jul 8 (`run f4b8609d`), but on Jul 16 (`run ebe98163`) it dumped raw tables into the chat,
re-queried data it already had 8×, hit `MAX_TOOL_ROUNDS`, and returned **no answer** ("reached step
limit"). Spec: [`docs/specs/agent-requery-loop-regression.spec.md`](specs/agent-requery-loop-regression.spec.md).

**Root cause:** PR #293 (Jul 10) token-budget compaction. Its marker told the weak `deepseek-v4-flash`
*"Re-run the tool if you still need this data"* — and the 24k trigger fired MID-TURN, compacting the very
rows needed to synthesize. The model obeyed, re-queried, and exhausted its step budget.

**Fix (built, verified — `npm run verify` green, agent-chat + _shared Deno tests green, boot-smoke OK):**
1. Compaction marker no longer invites re-run — states "already retrieved, do NOT call again", carries
   tool name + rowCount (`_shared/transcriptCompaction.ts`). `triggerChars` 24k→80k, `recentMessages`
   6→12 so a single analytical turn stays intact (env-tunable via `AGENT_COMPACTION_*`).
2. Forced tools-disabled synthesis round on non-malformed step-cap exhaustion — guarantees a final
   answer, never a bare dead-end (`agent-chat/handler.ts`; AC-RQL-010). Malformed exhaustion unchanged.
3. `as:"table"` prompt-steered to final-presentation only, not intermediate reads (`prompt.ts`) —
   **eval-gated per ADR-0052, NOT unit text-presence** (still owed: run the eval).
**Owner action owed:** review + approve PR to `dev`; deploy is agent-surface + owner-gated. Run the
ADR-0052 eval for AC-RQL-020/021 (prompt-steer effect on the live model) before trusting fix #3.

### ⚑ RESEARCH-FIRST — agent harness: vendor vs build (owner-requested 2026-07-28, NOT yet spec'd)

The re-query fix exposed how much agent-loop plumbing we hand-roll. Web-checked: only ~300–400 of the
~4,600 `agent-chat` lines are commodity (tool loop, SSE stream, model-client port); the rest is our moat
(RLS deputy reads, SoD approvals, typed widgets, credits, tenancy, audit) that **no framework provides**.
**Owner steer:** lock-in-averse — do NOT default to Vercel AI SDK; evaluate **LangChain/LangGraph and
the `pi` substrate as the harness**, with battery inclusion (guardrails, evals). Since the commodity core
is small, "build the missing bits as our own features" is on the table too. **Research FIRST (vendor vs
build, lock-in, Deno/Supabase-Edge fit, guardrails libs, migration cost) BEFORE writing a spec.** Keep
this fully decoupled from the re-query fix above (that ships on its own). No ADR yet — research → recommend → owner picks.

---

### v0.8.0 IN PRODUCTION (2026-07-25)
`production` == `main` == **`0079bcc9`**, tagged **v0.8.0**. The ERPNext program is
closed, promoted, released and deployed.

⚑ **`dev` is 4 commits AHEAD of `main`** — CI-only work that landed after the promote (#393
`RELEASE_PLEASE_TOKEN`, #392 docs-deadlock fix) plus two docs/chore commits. All non-releasable
types, so release-please will not cut a tag for them; they ride along with the next promote.
*(An earlier revision of this line claimed `dev` == `main` == `0079bcc9`. It was wrong — verify with
`git log --oneline origin/main..origin/dev`, not by recalling what was promoted.)*

**What went live (all verified, not assumed):**
- **DB** — prod migrated through `0166`; `scripts/db-push-prod.sh --pending` reports "up to date".
- **Edge functions** — **22/22** deployed from v0.8.0 source. `adapter-dispatch` had been stuck at a
  **07-13 build for 8 days**, predating the entire P3 money program; `erpnext-*`, `external-*` (7) and
  `clickup-webhook-worker` had **never been deployed at all**.
- **FE** — CF Pages serving v0.8.0; confirmed by reading `0.8.0` out of the served bundle, not by a
  green build badge.

**⚑ A live security defect was found DURING the deploy — by a migration refusing to apply.**
`0151_m365_ciphertext_envelope_check.sql` failed with `23514`: a real `ms_graph_connections` row held
an M365 token whose envelope was JSON-stringified ASCII (14,709 bytes starting `{`) instead of raw
bytes — the HIGH-A1 defect the constraint exists to prevent. It could never be decrypted, so
`disconnect` would delete the local row and audit `m365.connection.revoked` **while the refresh token
stayed live at Microsoft for ~90 days**. Owner's own account (`arief@gordi.id`), connected
2026-07-24 02:20. **Closed:** revoked in Entra → row deleted → constraint applied and now enforcing.
⚑ The earlier "revoke sessions during implementation" did NOT cover it — Entra only invalidates
tokens issued *before* the revoke, and this one was minted afterwards. Check timestamps, don't assume.

**Release/versioning:** `v0.8.0` tagged. `bump-minor-pre-major: true` was added first — without it the
`chore(deps)!: react-router 7→8` commit would have tagged **v1.0.0**, a GA claim off a dependency
upgrade. Next `fix:` → 0.8.1, next `feat:` → 0.9.0, next `!` → 0.9.0 (not 1.0.0).
⚑ Only `feat`/`fix`/`deps` are releasable — `ci`/`chore`/`docs` produce **no release PR at all**.

**New tooling shipped this session** (all self-tested in CI — the gates are themselves gated):
- `scripts/check-e2e-skips.mjs` — a skipped test is not a passing one. Justified allowlist + a
  `restore` path; a **stale** entry fails too. Enforcement detail: [`docs/qa-portfolio.md`](qa-portfolio.md).
- `scripts/check-e2e-isolation.sh` — no e2e spec may gate on `process.env.CI`; gate on the DEPENDENCY.
- `scripts/db-push-prod.sh --pending` — read-only "what would a prod push apply?".
- `scripts/ci-integration-order.test.mjs` — locks CI step ORDER and the reporter wiring.

### ✅ Shipped programs — moved to history
P3a Sales/AR write-through · H4 grants hardening · ClickUp integration + integration enablement ·
the 3 audit HIGHs. All merged to `dev` and promoted; full detail in
[`docs/history.md`](history.md). Do not re-plan these — read history if you need the why.

### ⚑⚑⚑ BACKLOG STALENESS AUDIT (2026-07-23) — READ BEFORE ACTING ON ANY OLDER ENTRY

A read-only agent verified 24 long-running entries **against `origin/dev` by CONTENT** (never by branch
name — that is exactly how these rotted). **6 entries name branches that no longer exist while their work
is already on `dev`.** Where an older entry below conflicts with this block, **this block wins.**

**✅ ALREADY DONE — do not rebuild (older text says otherwise):**
- **ClickUp live smoke + `CLICKUP_API_BASE_URL` seam** — `scripts/clickup-live-smoke.{ts,sh}`; seam at
  `clickup-live-smoke.ts:19` + `adapter-dispatch/index.ts:170`; ran 2026-07-17
  (`docs/spikes/2026-07-17-clickup-live-smoke.md`). *(Also stale in `docs/plans/2026-07-10-clickup-adapter.md:740`.)*
- **agent-chat rate-limit** — mig `0091`, `_shared/requestRateGuard.ts`, wired `agent-chat/index.ts:124`.
- **S-curve today-position deterministic test** — `sCurve.test.ts:126` (`AC-SC-AXIS-002`), fixed `asOf`.
- **OpenRouter fallback chain** — `_shared/openRouterModelClient.ts:57-76`. ⚑ It is a **provider** chain
  (which host serves one model), NOT a model chain — if a model fallback was wanted, that is still owed.
- **Bulk-import idempotency** — migs `0072`/`0073`, `procurementImportSkip.ts`, pgTAP `0129`/`0130`.
- **PostHog dashboards** — `scripts/posthog/provision-dashboards.mjs` (PR #303).
- **H4 grants** (migs `0104`/`0105`) · **#14 supply-chain/CI** (21 `deno.lock`, 18 SHA-pinned actions,
  `--frozen` gate `ci.yml:132`, PR→dev pgTAP `ci.yml:183`). Only `release-please.yml:17/34` stays unpinned.
- **`procurement_items` INSERT** — a CLOSED binding ruling (`OD-ENA-ITEMS-INSERT`), never owed work.

**⚠️ STALE BRANCH CLAIMS — branch GONE from the remote, work IS on `dev`:**
`feat/ops-admin` (⚑ `org_features` is mig **`0070`**, not `0068` as the entry says) · `harden/supply-chain-ci` ·
`feat/clickup-adapter-p1` · `chore/test-infra-parallelism` · `codex/agent-attachments-track-a` (its
"REFRESH draft PR #239" instruction points at a long-resolved PR) · `feat/task-model-fields` (exists but
BEHIND `dev`, content identical).

**🔴 GENUINELY STILL OWED (verified absent, with the search that proved it):**
- ~~**`error_events` coverage** — only 4 of 22 edge fns produce events~~ ✅ **CLOSED #402/#403 for
  the wiring gap; FR-OBS-001 is still PARTIAL, see below** — **22/22** functions now route through
  the `serveWithErrorReporting` choke point (ADR-0066), enforced by
  `scripts/check-edge-fn-error-reporting.mjs`, and a failed insert now reaches PostHog rather than
  dying in a function log (#403). 90-day retention purge with heartbeat proof-of-run.
  🔴 **Reporting is NOT universal — the choke point only catches THROWN errors.** A deliberately-caught
  failure that `return`s an error response (e.g. `clickup-sweep`'s `MISCONFIGURED`/
  `OWNERSHIP_READ_FAILED` 500s, and its per-org `catch` that logs then returns HTTP 200 `{ok:true}`;
  `erpnext-sweep`'s `MISCONFIGURED`) produces **zero** `error_events` and zero PostHog `$exception`.
  Only 1 non-`_shared` call site (`agent-chat`) calls `reportEdgeError` directly. This is the largest
  remaining blind spot — larger than the three already named in ADR-0066 — and is not yet closed;
  wiring `reportEdgeError` into handled-error return paths is a new deferred item (see CURRENT FOCUS).
  ⚑ **Also still open:** FR-OBS-003 — the 79 free-text `console.error` calls are NOT yet an enum.
  Error *coding* is not done. All four blind spots (streaming, module-init, missing `Deno`, and
  handled-and-returned errors) are documented in the module header and ADR-0066 — read them before
  trusting the net.
- ~~**PostHog consent-gate**~~ ✅ **CLOSED #398** — disclose + in-app opt-out + `respect_dnt`, no banner
  (OD-OBS-2). ⚑ Two non-obvious defects were found and fixed: logging out wiped PostHog's consent key
  and silently resumed capture, and DNT users still hit the remote-config endpoint because only
  `capture` was gated, not `init`. ⚑ **Open owner question:** the opt-out **fails open** if
  `localStorage` is evicted (Safari ITP ~7d) — a first-party cookie mirror would fix it.
- ~~**Two analytics tiles can never render data**~~ ✅ **CLOSED #399** — `save_failed` now fires from
  `classifyMutationError` (~161 call sites, the single point where "the user was shown an error" is
  knowable) rather than the inert `useEntityForm` path; `permission_denied_seen` and its tile removed.
  `scripts/check-dashboard-tiles.mjs` now fails CI on any tile whose event has no call site.
  ⚑ `module`/`operation` are still CONSTANTS until callers are threaded — do not break down on them.
- ~~**Raw NUL bytes in 3 source files make them invisible to `grep`**~~ ✅ **CLOSED #394** — all three
  replaced with the `\u0000` escape, plus `scripts/check-nul-bytes.sh` wired into `verify` + 3 CI jobs
  (0.44s, after a review cut it from 57s). ⚑ The gate initially reported **green over an empty file
  list** — a gate that can scan nothing is worse than none; now guarded and self-tested.
  ⚑ **Authoring hazard remains real:** writing that escape *through an editing tool* can emit a real
  NUL. It happened 4× in one session — to me twice, to an implementer, and to the harness. The CI
  gate is what makes the class self-detecting; `file docs/backlog.md` should say "text", not "data".
- **interactive-create idempotency** — idempotency exists ONLY on the bulk-import path (`0072`).
- ~~**telegram-notify dup alerts**~~ ✅ **CLOSED #400** — write-ahead `alert_send_log`. ⚑ The root cause was
  deeper than "the stamp result is discarded": the cooldown derived from `error_events.notified_at`, the
  very column the failing stamp writes, so a failure erased the evidence that would have suppressed the
  resend. The first fix then traded spam for silent LOSS (a failed send still stamped rows notified) —
  closed by gating the stamp on a `delivered_at` witness.
- ~~**`notifyOwner` swallows errors**~~ ✅ **CLOSED #400** — it was *doubly* silent (a bare catch AND an
  un-destructured resolve-with-`error`, supabase-js's ordinary failure mode). Failures now reach
  `error_events`, and therefore Telegram, rather than a console line nobody reads.
- ~~**`enforce_automation_owner_cap` race**~~ ✅ **CLOSED #401** — per-owner `FOR UPDATE` + `SECURITY DEFINER`,
  proven by a real two-session `dblink` test (`55P03` under a short `lock_timeout`). ⚑ Still bypassable by
  UN-ARCHIVING (the trigger is BEFORE INSERT only) — that half is open.
- ~~**`set_project_contract_value` accepts negative**~~ ✅ **CLOSED #401** — RPC guard + column CHECK.
  ⚑ `>= 0` alone was NOT enough: **`NaN >= 0` is TRUE in Postgres** and PostgREST coerces `"NaN"` from a
  quoted string, poisoning `sum()` org-wide. Shipped as `>= 0 and < 'Infinity'::numeric`.
  🔴 **The INSERT-side gap is still OPEN and live in prod** — see the CURRENT FOCUS block.
- ~~**`spike-rls.yml`** — only `npm install` → `npm ci` remains.~~ ✅ **CLOSED BY DELETION 2026-07-28** —
  the workflow and `spike/agent-native-rls/` no longer exist (owner-approved; ADR-0036 §8, its only
  reason to exist, closed 2026-07-03). Do not go looking for this file.
- **3 runbooks** — prod-deploy / secret-rotation / agent-LLM-outage absent under any name.
- **credit-race wiring — NOT a small defect; DEFERRED Director-scoped work (re-verified 2026-07-27).**
  ⚑ **2** `check()` sites (`agent-chat/handler.ts:1301`, `:1710`), not 3; `release_credits` has ZERO
  callers outside generated types. But this is the **deliberately-deferred half of the audit-CRITICAL
  race fix** (PR #257 / `#15` below), not an oversight: `creditRateGuard.ts:77-79` + the `RESERVE_UNIT`
  comment explicitly defer call-site wiring to the Director with a documented residual-overspend
  tradeoff. The reserve path EXISTS (`reserve_credits` under `pg_advisory_xact_lock`, mig `0077`,
  pgTAP `0134`) and `check(orgId, runId?)` accepts a runId — the missing piece is threading runIds
  at the 2 call-sites + calling `release_credits(runId)` after the model turn lands. That changes
  agent/LLM credit behavior (`AGENT_CREDITS_ENFORCED` is OFF today) and is a Director decision,
  not a wiring tick. Don't pick this up as "small debt."
- **contacts-inbound — NOT a defect; UNBUILT FEATURE (re-verified 2026-07-27).** There is no `contact`
  kind in the ERPNext feed registry (`doctypeRegistry.ts`: 14 kinds; the only party kinds are
  `supplier` + `customer`) because **inbound contact sync was never specced**. `feedKinds.ts` routes
  money/company kinds only. Adding `contact` means a new mirror table + adoption path + ADR — that's
  a feature (spine-5 CRM territory, see the candidate program's D-batch), not a fix. Reclassify:
  this is a demand-gated feature, not owed debt.
- **`entry_date` week-range — addressed in PR #396 (2026-07-27).** `0055:70-76` inserted entry
  dates unbounded by the sheet's week. Fixed in migration **0168**: a `v_bad_date` preflight in
  `save_timesheet_week` rejects any `entry_date` outside `[p_week_start_date, +6]` (errcode 23514,
  before any write). pgTAP **0161** proves red→green + atomicity. 3-reviewed (security SHIP,
  spec/code-quality APPROVE-WITH-FIXES→fixed).
- **`.select('*')` trim** — ⚑ **Re-counted 2026-07-27; the old "31 / 15 modules" was a scope mix-up.**
  Actual: **8 occurrences across 3 modules** in `supabase/functions/` (`adapter-dispatch`,
  `agent-dispatch`, `m365-token-custody`) and **32 occurrences across 15 files** in `pmo-portal/src/`
  (mostly `src/lib/db/*`). The earlier number described the portal, not the edge fns. Both are real
  trim candidates — over-fetching is over-fetching — but cite the right count per location.
  ⚑ **Status 2026-07-27:** the **8 edge-fn sites** are addressed in **PR #397** — 7 trimmed to
  explicit column lists, **1 left wide by design** (`proxy.ts:61`, the Graph proxy legitimately
  holds the access-token secret; documented in-code). The **32 portal sites** in `pmo-portal/src/`
  remain a separate, larger sweep — not started.
- **org-seam pgTAP cross-org SWEEP** — the `stamp_org_id()` trigger landed (`0074`), but ADR-0047's
  catalog-driven sweep does not exist; coverage is per-feature spot tests only.

**🟡 PARTIAL / needs a ruling:**
- **agent-persistence stuck `running`** — the `errored` path shipped; missing is a reaper for crash/
  disconnect rows, and `setRunStatus` (`persistence.ts:279-295`) swallows its own failure.
- **per-org webhook secret** — ✅ shipped for **ERPNext** (`erpnext-webhook/index.ts:265` + Vault);
  ⛔ still global for **ClickUp** (`clickup-webhook/index.ts:67`). OD-INT-14 scopes the deferral to ClickUp.
- **health endpoint checks zero deps** — this is a *written NFR* (NFR-OF-REL-003), not an oversight.
  Reclassify as a decision, or raise it as a real issue — it is not a bug today.
- **F4 mobile assistant entry** — ⚑ **OWNER CALL.** The assistant IS reachable on mobile (`AppShell.tsx:262-310`
  drawer + `Rail.tsx:258-273` toggle + a mobile panel path). No spec defines "F4". If it means *reachable*,
  it is DONE; if it means a dedicated affordance (FAB / bottom-nav), it is owed.

### ⚑ ERPNEXT FOLLOW-UPS (2026-07-23) — spec'd, in build; + one PRE-EXISTING defect found in passing
- **FU-1a — timesheet `Approved → Draft` re-open, UN-PUSHED sheets only.** Branch `feat/timesheet-reopen`,
  migs **0151/0152**. Pure PMO transition, zero ERP I/O. Spec `docs/specs/timesheet-correction-path.spec.md`.
  ⚑ The hard part is the race-safe "no confirmed ERP document" predicate (mirror state AND every
  non-terminal outbox state, serialized by a named advisory lock) — Luna findings 1+2 apply HERE, not
  only to the cancel path. Fails closed on any doubt; that refusal is FU-1b's entry point.
- **FU-1b — the ERP cancel path for PUSHED timesheets. ⛔ DEFERRED, own issue.** The `tsc:` cancel
  operation: correction intent, operation-aware finalizer, reconcile pass, cancel recovery probe, origin
  CAS, server-resolved target, intent-bound authority. **Specced in full** (same spec file, 1167 lines);
  Luna returned **NO SHIP with 9 BLOCKs** — `docs/reviews/2026-07-23-luna-fu1-timesheet-correction-spec.md`.
  Root cause: the cancel cannot reuse the push machinery — finalizer, backstop, target guard and recovery
  probe are all create-shaped. Needs machinery P3b never shipped. ⚑ The spec's Approved-terminal sweep
  found **8 shipped sites** whose safety argument rests on `Approved` being terminal — re-read that
  before building.
- **FU-2 — budget fiscal-year / phasing dimension (OQ-BUD-3c) + closes FR-BUD-152.** Branch
  `feat/budget-fiscal-year`, migs **0153/0154**. Spec `docs/specs/budget-fiscal-year-phasing.spec.md`
  (1242 lines), Luna NO SHIP r1 (10 BLOCKs + 1) answered by the §1.1 **four-fact fence**: F-A push
  succeeded · F-B attempt exists · F-C PMO's own phased line · F-D attribution known. **Bare
  mirror-existence is never a money-attribution test** — the shipped refusal writer stamps a `failed`
  mirror row with the START FY, so "a mirror row exists" was true for a year PMO explicitly refused.
- **⚑ PRE-EXISTING MONEY DEFECT (ships TODAY, not introduced by the above) — `budget_category_account_map`
  has NO fiscal-year history.** `0137:90-91` is unique on (org,category)/(org,erp_account) with no FY or
  effective-date dimension, and `0149:184-194` joins the **current** map when summing GL actuals per PMO
  category. **An Admin editing the map silently re-interprets PRIOR years' actuals.** Single-FY today
  makes it one year per edit; FU-2's phasing makes it N. Ruled a **named non-goal** of FU-2 (spec §2,
  risk 11, OQ-BFY-5) — a real fix reworks the map subsystem, not a line-item change. Candidates:
  effective-dated map rows; per-FY map rows; or snapshot the category attribution alongside the actuals
  in `erp_actuals_snapshot` so a taken reading is immutable. **Must preserve the bijection (FR-BUD-111)
  per year, or state why not.** Priority: real but not urgent — Admin-only, deliberate, and it corrupts
  reporting truth rather than moving money.

### ✅ RESOLVED — the create-path SoD class, slices 1–5 (`0173`–`0177`, 2026-07-29)
Branch `fix/project-create-sod` / PR #411. Spec `docs/specs/create-path-sod-class.spec.md` (§8 = slice
4, §9 = slice 5). **Nothing here was a regression — every item was pre-existing and live in production.**

The class: **SoD is enforced on the TRANSITION, so the attacker never transitions — they put the row
into (or out of) the protected state by a path the transition does not own.** There are exactly THREE
such paths and all three are now closed:

| slice | migration | path | proof |
|---|---|---|---|
| 1 | `0173` | INSERT on `projects` | `0166` |
| 2 | `0174` | INSERT on five more tables | `0167` |
| 3 | `0175` | UPDATE | `0168` |
| 4 | `0176` | the residuals (blanket grant / wrong column / RPC parameter / NULL fall-through) | `0169` |
| **5** | **`0177`** | **DELETE + the `projects` money SoD** | **`0170`** (62 assertions, 24/24 mutations killed) |

**Slice 5 closed:**
- **`budget_versions` DELETE — the cascade (was MEDIUM-HIGH).** A plain PM deleted the **Active**
  version and `budget_line_items_budget_version_id_fkey` (`ON DELETE CASCADE`) took every line item
  with it, **straight past `budget_line_items_draft_guard`**, with 0 audit rows. `budgets.ts:392`
  documented a trigger that **did not exist**; `0177` §A1 creates it (non-Draft = **Admin-only**, the
  ADR-0019 shape, which also keeps an Admin's project hard-delete cascading correctly) plus a
  `budget_version.delete` audit row, and the DAL comment is corrected.
- **`sales_invoices` / `incoming_payments` / `procurement_invoices` / `procurement_receipts` /
  `procurement_quotations` DELETE (was MEDIUM).** All five had a table DELETE grant to `authenticated`;
  a PM erased a Paid invoice, a Paid payment, a Paid vendor invoice, a Complete goods receipt and the
  selected quotation, all with 0 audit rows. `0177` revokes DELETE from `authenticated`/`anon` with no
  re-grant (the caller survey found zero client deletes; the service-role mirror writer keeps its
  grant) and adds an AFTER DELETE audit to each. That also closes two cascade families:
  `sales_invoice_authors` + `sales_invoice_submit_authorizations` (the submit-SoD oracle) and the
  `procurement_*_files_delete_admin_only` file tables.
- **`projects` — the money SoD (was HIGH).** ⚑ **Owner ruling, 2026-07-29: approver ≠ author, on the
  money.** Both shapes `0176` named were rejected — gating pipeline→Won on Admin/Exec/Finance removes
  "win the deal" from the role that owns the pipeline (a product regression), and a blanket re-approval
  taxes every win. Instead `0177` §B adds `contract_value_set_by` / `contract_value_set_at` (witness
  columns, trigger-stamped, withheld from the client INSERT **and** UPDATE grants) and refuses the win
  when the winner is the person who last set a non-zero `contract_value`, unless they are
  Admin/Executive/Finance (`set_project_contract_value`'s own on-hand gate). A **NULL** witness
  timestamp (pre-`0177` rows — not backfillable) **fails CLOSED**; a NULL *actor* with a non-NULL
  timestamp means a server-side authority set it and is allowed, which is what keeps every seeded /
  imported / service-role row winnable.

The pins that asserted the vulnerable state were rewritten, as they were written to be: `0168`
**AC-UPS-080**, `0169` **AC-RES-019** + **AC-RES-032** (+ its companion audit assertion), and the
`lives_ok` DELETE probe in `ap_invoices_payments_offboarded_rls.test.sql` (which now re-grants DELETE
inside its own transaction, the same device that file already uses for INSERT, so it keeps proving
`0110`'s POLICY rather than `0177`'s grant).

**⚑ STILL OPEN, deliberately, and NOT closed by slice 5:**

1. **Goods-receipt self-attestation (MEDIUM, a ratified contract).** `create_procurement_receipt` is
   role-gated to Admin OR PM OR **the requester**, so the Engineer who raised the request records their
   own `Complete` delivery — an input to the 3-way match. NOT this class (`Partial`/`Complete` are both
   origination values) and the carve-out is asserted **on purpose** by
   `supabase/tests/0055_authz_hardening.test.sql` **AC-AUTHZ-007**. Narrowing it is a product decision.
   Pinned by `0169` **AC-RES-053**.
2. **`incoming_payments` INSERT/UPDATE — mirror integrity, not SoD (MEDIUM).** Slice 4 judged this a
   different class and **slice 5 re-judged it and agrees**: `incoming_payments` has no transition RPC,
   so there is no SoD rule to bypass — a client-inserted `Paid` receipt is a *false mirror row*, not a
   defeated approval. Slice 5 closed only its **destructive-delete** half (which IS this slice's
   subject: erasing a Paid payment with no audit). The remaining blanket `insert`/`update` grant, the
   `Scheduled|Paid` status set and the client-writable `erp_*` feed columns are `0123`'s flip-design
   question and need their own slice — the fix is almost certainly the `sales_invoices` treatment from
   `0176` §1 (narrow the INSERT re-grant to body columns, revoke UPDATE, add an origination guard and a
   create audit), but that is a mirror-integrity slice with its own caller survey. **Not pinned by a
   test.**
3. **The `is_active_member()` gap across 17 RPCs.** A different class, tracked separately; explicitly
   out of scope for slices 1–5.
4. **`contract_value` witness backfill.** Pre-`0177` rows keep NULL witnesses and are fail-closed for a
   non-Admin/Exec/Finance winner. `0177` raises a WARNING with the affected count at migration time.
   Disposition (leave them to be re-set one by one, or run a one-off attribution) is an owner call —
   **it must be decided before the prod deploy**, together with OD-PCS-1 (slice 1's retro-remediation
   question, still open).

### ✅ RESOLVED — ADR id collisions 0058/0059 (fixed by #387, 2026-07-25)
The `0058`×2 and `0059`×3 collisions were fixed in **PR #387**: the duplicate M365/external docs were
renumbered to **0063** (`microsoft-365-integration-architecture`), **0064** (`entra-app-registration-topology`),
**0065** (`external-admin-connect`), each carrying a redirect note. `0058` (`erpnext-money-idempotency-outbox`)
and `0059` (`pmo-sot-with-external-side-mirror`) kept their ids. Verified 2026-07-27: `ls docs/adr/0058*`
and `0059*` each return exactly ONE file. (The ADR-0037 mis-cite — same class, a citation resolving to
the wrong doc — was fixed separately in #395, landing the real write-up as 0068.)

### ✅ RESOLVED — ADR-0037 mis-cite (fixed 2026-07-27)
The monochrome-calm write-up landed on `dev` as **ADR-0068** (`docs/adr/0068-monochrome-calm-design-language.md`)
with a provenance note explaining the id-history, and `DESIGN.md` + the three component comments
(`StatusPill.tsx`, its test, `NotificationBell.tsx`) repointed to **0068**.
⚑ **#395's repoint was PARTIAL — completed 2026-07-27.** It enumerated *components* and missed three
page-level tests carrying the same design rule: `pages/Companies.test.tsx:121`,
`pages/Incidents.test.tsx:160`, `pages/__tests__/Projects.deliveryBudget.test.tsx:121`, each citing
`S1 (ADR-0037)` for "status is a quiet dot + label, no filled slab" — which is ADR-0068 §43, not the
compiler DSL. A fix that repoints *some* citations of a mis-cite leaves the same defect behind, so
**verify a citation sweep by meaning, not by the file list the fix enumerated**: search the rule
vocabulary (`S1`, `dot`, `slab`, `tint`), not just the component names. `dev`'s `0037`
(*View-Composition compiler DSL*) is untouched — the viewspec/compiler citations that legitimately
mean 0037 still resolve correctly. Same class as the `0058`/`0059` collisions fixed in #387.
⚑ **Branch-deletion caveat:** the `redesign/design-system` branch holds the **exploration artifacts**
0068 references (the `design-mockups/redesign/{diverge,converge,reskin}/` sketches + 3 port plans) —
those were NOT promoted (deliberate: exploration trail, not current truth; `DESIGN.md` is the in-tree
source). The branch may now be deleted **if** losing those sketches is acceptable; it is no longer
load-bearing for any *citation*. Owner call to delete.

### ⚑⚑ LESSONS — 2026-07-27/28, the observability + analytics program (read before building any check)

**Eleven PRs. Every one passed its own tests and a first read. Every one had a defect only an
adversarial pass found — and three of them were introduced BY the fix for the previous one.**
That is the finding, more than any individual bug. Organised by what to *do*, not by which PR found it.

#### 1. A test only counts if you know what would make it fail

- **Assert emitted output, not configuration.** A test asserting an init option against a *mocked*
  SDK proves you called a function. The real-SDK version found a live data leak in minutes.
- **A fixture for an external contract must be captured FROM the contract.** The quota alarm parsed
  `quota_limits` (an array); the API returns `limited` (a resource-keyed object). **Eight tests,
  three of them security tests, passed** — the fixture had been invented from the same misreading as
  the parser. One of those tests literally asserted *"a payload with no `quota_limits` array does not
  report all-clear"*, i.e. it certified the real API response as malformed.
- **Any AC asserting an ABSENCE needs a positive control** proving it can fail. "No requests to
  PostHog" passed before any work existed, because analytics was off entirely.
- **A test that never runs == a test that cannot fail.** The consent Playwright project was absent
  from `ci.yml`'s explicit `--project=` list. Check the invocation, not just that the file exists.
- **A red test can be red for the WRONG reason.** A drain test failed because its mock reset
  heartbeat state between ticks, not because the cooldown was broken. Diagnose before "fixing".
- **Mutation-test the proof, not just the code.** Two of four pgTAP "proofs" didn't bind: deleting an
  entire RPC guard left its test 4/4 green (the CHECK raised the *same* errcode and the test passed
  `null` for the message), and re-opening a race left its test green (the regex matched the phrase in
  a **comment**). Assert the message, anchor the order, strip comments.

#### 2. A gate that can silently not run is worse than no gate

- **Guard the empty case, the unreadable case, AND the never-ran case.** The tile gate had three
  empty-input guards sitting *below* an entrypoint check that skipped `main()` entirely on any path
  needing percent-encoding (`file://${argv1}` vs `pathToFileURL`). Found by copying the repo into a
  directory with a space in the name.
- ⚑ **A fix can silently DISARM a neighbouring gate.** Replacing every `Deno.serve(` with
  `serveWithErrorReporting(` made `check-edge-fn-test-binding.mjs` — which matched on that string —
  match nothing, while still reporting green. **When you change the shape a gate matches on, check
  what else matches on that shape.** Every gate here is a regex over source.
- **Count what you actually evaluated, not what was present.** `entries.length === 0` failed closed
  ("we checked zero allowances") while *every row skipped* reached the identical state unguarded.

#### 3. Fail-open is the default failure mode; hunt it deliberately

- **`NaN >= 0` is TRUE in Postgres** — a non-negative CHECK is the one predicate that cannot exclude
  `NaN`, and PostgREST coerces `{"p_value":"NaN"}` from a quoted string. It poisons `sum()` org-wide
  and emits a JSON *string* where the types declare `number`. Use `>= 0 and < 'Infinity'::numeric`.
- **`Number('abc')` is NaN and `ratio >= NaN` is always false** — the JS analogue. One typo in
  `QUOTA_THRESHOLD` silently disabled an alarm forever.
- **A fix can trade one failure mode for a worse one.** The write-ahead log correctly bounded alert
  *spam* and introduced alert *loss*: a failed send still recorded the attempt, so the next tick
  suppressed the rows **and stamped them notified**. Production's own unset-secrets state was the
  trigger. **Fixing "X happens too often"? Ask what happens when X now never happens.**
- **The fix for an unbounded loop introduced an unbounded loop** — a liveness ping unbounded when its
  own heartbeat write failed (~720 messages/day at the real cadence).
- **Distinguish "breach" from "could not check".** A network blip exiting 1 rendered as a
  PERMANENT-DATA-LOSS banner; that is how an operator learns to ignore the banner.

#### 4. Bounding untrusted data

- **Key-based redaction does not bound VALUES.** `FORBIDDEN_PROPERTY_KEYS` filters *names*; anything
  inside an allowed key ships verbatim. Bound with an allowlist + shape check; **never truncate** —
  a truncated customer name is still a customer name.
- **Make the leak unrepresentable, not merely absent.** `module: string` type-checked with a customer
  name in it; a union makes that a compile error.
- **Third-party response data reaching CI stdout is a privileged sink.** GitHub Actions parses
  workflow commands from every output line; a newline-bearing resource name emitted live
  `::add-mask::` (which redacts the rest of the job log — anti-forensics against the alarm's own
  evidence), `::error::` and `::stop-commands::`.
- **A control believed stronger than it is, is its own defect.** A host check validated only the
  *scheme* while its docblock claimed it stopped "sending the key to an arbitrary origin";
  `https://evil.com`, the userinfo trick, an IDN homograph and a host carrying its own path all passed.
- **An undocumented blind spot gets trusted beyond its reach.** `agent-chat` streams its response, so
  a throw after headers gave a truncated SSE and ZERO `error_events` — in the highest-traffic function.

#### 5. Process

- ⚑ **Review-battery trigger is NOT "does this touch the DB".** It is **"does this parse untrusted
  external data into a privileged sink"**. #404 was skipped on a low-risk judgement and the
  retrospective battery found a Critical that two reviewers identified independently.
  **A self-assessment of risk is the weakest evidence available.**
- ⚑ **Read the failure DURATION.** ~5000ms = the vitest timeout under machine load; **18ms is REAL**.
  A heuristic right four times running nearly merged a genuine regression on the fifth.
- **A wrapper's exit code is not the command's.** A harness reported "completed exit 0" for a run that
  had exited **143 (SIGTERM)**. Check the log body, always.
- **Never run a second `verify` in a worktree an agent is using** — contending vitest runs fabricate
  failures that are artifacts of the interference.
- **Sweep a fix by MEANING, not by the file list you know.** Three instances: an ADR citation repoint
  missed 3 page tests, the consent lane missed CI, a widened return type missed a pre-existing
  exact-shape assertion.
- **A multi-slice plan's later snippets are hostages to the earlier slices' reviews** — PR-1's review
  changed a schema and PR-4's plan text still named the old column. Re-read the plan against reality
  at each slice boundary.
- **Squash-merge breaks stacked rebases** — cherry-pick the stacked branch's OWN commits.
- **A "known limitation" note can be FALSE.** "No `dblink` in this stack" — it is there, and
  `0151_timesheet_fence_concurrency.test.sql` already uses it; the claim came from the plan, which
  cited that very file as evidence. **A note asserting an absent capability is worse than no note:
  nobody re-checks it, and the real proof never gets written.**

#### 6. Open, deliberately unproven

- **The vitest 15s timeout (#407) is corroborated, not demonstrated.** Three deliberate experiments
  failed to reproduce a >5s sample *passing* under the new limit. What IS established: inflation of
  2.4–9.6× under real suite contention, three observed failures above 5s (5046 / 5255 / 5593ms), and
  arithmetic — a test measured at 5255ms fails a 5000ms limit and passes a 15000ms one.
  **Falsification: if any test ever exceeds 15s, the diagnosis is wrong — revert, do not raise again.**

### ⚑⚑ LESSONS — 2026-07-24/25 (read before the next promote or deploy)
Every defect this session was a **silent false signal**, not a loud failure. None were caught by
`verify` or e2e. Grouped by what to *do differently*:

**State: never infer it from the wrong source.** I got this wrong four times in one session.
- A **branch file-diff is not database state.** "68 migration files differ between `production` and
  `main`" ≠ 68 pending on the cloud. The real answer was on the cloud: `db-push-prod.sh --pending`.
- **A stale checkout under-reports.** That same tool then said "1 pending" while the working tree was
  **196 commits behind**; the true number was 16. `git status` before trusting any tool that compares
  against the tree.
- **`git fetch` moves refs, not your checkout.** I deployed 8 edge functions from a 196-commit-old
  tree and would have reported them as shipped. Only a "file not found" on 4 others exposed it.
- **A two-dot `git diff A B` renders B's newer content as "removals"** and reads like a regression a
  3-way merge would never produce. Use `git merge-tree --write-tree` to ask what a merge would do.
  Likewise a squash-merged branch shows commits "not in dev" — verify via PR state + `headRefOid` +
  merge-commit reachability, never ancestry.

**Gates are code. Writing one is not verifying it.**
- `check-e2e-skips.mjs` failed twice for its OWN bugs (per-report staleness; then first-match instead
  of longest-match on overlapping entries) — both found by running it, not by its self-test.
- My first fix for the docs-only PR deadlock (a second workflow publishing the same check names) was
  **wrong**: GitHub path filters are OR-based, so a MIXED docs+code PR triggers BOTH, letting a
  passing stub mask a failing real job. One workflow must own a required check name.
- **A rule that trips on its own documentation is a rule nobody keeps** — happened 3× (the
  `process.env.CI` guard, the reporter-redirect guard). Strip comment lines first.
- **Static checks confirm SHAPE, not BEHAVIOUR.** All three e2e gates passed a spec that could not
  even import after a `git mv`.

**Tests that don't bind.**
- `withTimeout`'s deadline mutated to `0` left **all 7 tests green** — the one behaviour it exists for
  was untested (`Promise.race` against an already-resolved literal always wins). Use a settlement latch.
- An assertion on a **random** value (`bytes[0] !== 0x7b`, the first byte of a random IV) reddened ~1
  run in 256 and read as an unrelated regression on whichever branch drew it.
- A **quarantine note is a hypothesis, not a finding**: AC-IXD-PROC-W5-3 blamed a parallel-worker race
  for weeks; at `--workers=1` it still failed. Re-verify the reason before trusting it.

**Environment.**
- ⚑ **This shell is zsh: `for f in $VAR` does NOT word-split.** A 22-item deploy loop ran once with
  one concatenated argument. Use a literal list or an array.
- **Never `>/dev/null 2>&1` a command whose failure mode you have not already seen** — I did it twice
  and both times learned nothing from the failure.
- `[edge_runtime] enabled = false` in `supabase/config.toml` applies to **CI and local alike**; only
  `scripts/serve-functions.sh` serves functions (it exports `SUPABASE_FUNCTIONS_URL`, the real signal).
- **Never regenerate `package-lock.json` on macOS** — it prunes linux-only optional deps and CI
  `npm ci` fails. Use `scripts/relock.sh` (container).

**Process.**
- **PR only after the full battery** (owner rule, 2026-07-02). I opened #381/#383/#384 on "verify +
  e2e green" and review then found a stale-cache-on-timeout bug with a confidentiality payload, a
  vacuous test, a `set -e` regression I wrote, and a vendor-chunk predicate that had silently
  mis-chunked the router for the whole v7 era.
- **Don't spend a promote on `ci:`-only commits** — `integration` runs once per PR→`main`; batch them
  with the next substantive change instead (it runs anyway).

### ⚑ DEBT — AC-ERR-001 (persistent in-dialog save error) is wired on 2 of 18 forms (2026-07-28)
The 2026-07-28 Discover pass found that a rejected save left **no persistent evidence** — the only
feedback was a toast that auto-dismisses after 4s, ~700px from the dialog the user is looking at, after
which the modal is indistinguishable from a pristine form with data in it. Focus was also dumped to
`<body>`, outside the dialog. Both are fixed **in the primitive** and every consumer inherits them:
the keyboard trap (blur no longer drives focus) and background `inert`.

**But the persistent error region needs an opt-in** — the consumer must pass `submitError` and catch its
own mutation rejection (~3 lines: state + `classifyMutationError(…, {suppressCapture:true})` in the
existing catch + the prop). Wired today: `pages/Companies.tsx`, `pages/Contacts.tsx`. **Not wired (16):**
`IncomingPayments` · `SalesInvoices` · `CompanyDetail` · `ContactDetail` · `AdministrationCredits` ·
`AdminUsers` · `project-detail/MilestoneFormModal` · `project-detail/tabs/DocumentsTab` ·
`project-detail/tabs/TasksTab` · `admin/BudgetAccountMap` · `procurement/NewProcurementModal` ·
`NewRevisionModal` · `projects/ProjectIntegrationsCard` · `integrations/IntegrationsView` ·
`builder/PanelEditorForm` · `import/ImportWizard`.

⚑ **Why this is written down rather than left implicit:** `DESIGN.md` §Overlays originally stated all
three modal rules as "binding on every dialog". That was true of two and false of the third, and the
step-7 acceptance pass caught it. **A design-system rule stated as universal, with no rollout tracker,
reads to the next person as a completed fact** — the same shape as an AC whose title claims more than
its test proves. `DESIGN.md` now names the 2-of-18 scope and points here.

### ⚑ DEBT — AC-IXD-PROC-W5-3 is stale against a UI redesign (diagnosis CORRECTED 2026-07-25)
The spec was `test.fixme`d with the note *"parallel-worker shared-DB race — un-skip when e2e runs
serially"*. **That was a misdiagnosis.** I moved it to the serial lane and ran it at `--workers=1`:
it still fails (13 passed, this one failed), so contention was never the cause.

**Real cause:** `pages/Approvals.tsx` renders **two layouts**. The stacked fallback contains
`<section aria-label="Timesheets awaiting you">`; the master-detail **split inbox** (`QueueGroup` +
"Approval preview" pane, `Approvals.tsx:690-733`) does not. The app renders the split inbox, so the
spec's locator can never match. It is **stale against a deliberate UI change, not flaky.**

**Do:** rewrite the journey steps against the split inbox (`QueueGroup` → `selectedKey` → approve in the
preview pane) while keeping the **same goal oracle** — the PM approves and the queue count settles.
Per the BDD rule in `CLAUDE.md`, never weaken the assertion to "an element exists". Then delete its
entry from `ALLOWED_SKIPS` in `scripts/check-e2e-skips.mjs` (a stale entry fails the gate, so this
cannot be left half-done). It stays in `e2e/serial/` either way — it mutates the org-shared queue.

⚑ **Lesson worth keeping:** the quarantine note asserted a cause nobody re-tested for weeks. When its
stated restore condition was finally met, the condition was satisfied and the test still failed. A
quarantine reason is a hypothesis — re-verify it before trusting it.

### ⚑ OPEN QUESTION (owner) — was dropping bulk-approve from the main approvals view a regression? (2026-07-27)
The approvals-screen redesign (`Approvals.tsx` master-detail split inbox, large screen) renders
timesheets **one-at-a-time** in the preview pane — there is **no "select several → Approve All"**
affordance on the primary view. The bulk-approve UI (Select toggle + per-row checkboxes + "Approve N")
now lives **only on the small-screen stacked fallback** (`ApprovalsQueue`, shown when `!isLargeScreen`).
The bulk *behavior* is still proven at the unit level (`ApprovalsQueue.expand-bulk.test.tsx`, 8 tests).

**The question for the owner:** was dropping bulk-approve from the main view **deliberate** (a manager
approves one sheet at a time anyway), or an **accidental regression** in the redesign (the layout work
focused on the two-pane triage and the bulk affordance fell out unnoticed)? Approving a whole week's
timesheets one at a time is a real PM annoyance if it was unintentional.

**Decision taken 2026-07-27 (option 1):** keep bulk-approve covered end-to-end by having the e2e
(`AC-IXD-TS-W5-3`) drive the **stacked fallback layout** (small viewport) — the feature still exists
there, so the test finds it and keeps the goal-oracle intact. This does NOT close the regression
question; it keeps coverage while the question stays open. **If the owner later rules this was an
accidental regression**, the follow-up is a UI task: restore a bulk affordance to the split inbox
(e.g. a "Select" toggle over the Timesheets `QueueGroup` + an "Approve N" control in the preview),
at which point the e2e can be re-pointed at the primary view. Logged here so it is not lost.

### ⚑ OPEN QUESTION (owner) — the approvals queue and the approval AUTHORITY disagree about "awaiting you" (2026-07-29)
**Filed, not fixed — this is a product decision about which side is right, not a bug fix.**

`listTimesheetsAwaitingApproval` (`src/lib/db/timesheetTransition.ts:173-181`) selects **every**
`Submitted` timesheet in the org except the viewer's own — no manager filter at all; RLS-visibility is
the only scoping. `transition_timesheet`'s approve arm (`supabase/migrations/0164_...sql:303-328`)
authorises the **assigned line manager EXCLUSIVELY** (Admin/Exec fallback only when `manager_id` is
null). So a privileged viewer is shown a row, a Select checkbox and an **Approve** button for a week
the server will **always** refuse.

**Observed end-to-end (2026-07-29, full serial lane):** AC-AU-001 re-pointed Tomas Beck's
`manager_id` from Diego (pm@) to Mara (exec@). pm@'s queue still listed Tomas's week as "awaiting
you"; the bulk approve raised `42501 not authorized` on it; `ApprovalsQueue.commitBulk`
(`pages/timesheets/ApprovalsQueue.tsx:323-343`) folded that into a **"Partially approved — 1 approved,
1 failed (separation of duties or stale)"** warning toast, closed the dialog, and left the row in the
queue. The PM has no way to tell from that message that the row is *permanently* un-approvable by him,
not transiently stale.

**The question:** which side is authoritative for "awaiting you"?
- **(a) The RPC is right** → the queue should filter to weeks the viewer can actually approve
  (`manager_id = auth.uid()`, plus the null-manager Admin/Exec fallback). A PM then sees only his own
  reports. Risk: an author whose manager is inactive/unset drops off every queue — needs a
  deliberate "unassigned" lane.
- **(b) The queue is right** (org-wide visibility is intentional for privileged roles) → then the
  affordance must be honest: no checkbox/Approve on rows the viewer cannot approve, and the error
  copy must name the real reason ("Mara Lindqvist is the line manager for this week"), not the
  ambiguous "separation of duties or stale".

**Not blocking anything today:** `AC-IXD-TS-W5-3` now seeds and asserts only weeks it owns
(authors line-managed by pm@), so the acceptance layer no longer depends on the answer.

### ⚑ PARKED — mutation testing (StrykerJS) for the "green test that doesn't bind" class (2026-07-25)
**Why:** coverage proves a line RAN; it does not prove its behaviour is asserted. 2026-07-25 found a
`withTimeout` test suite at 100% coverage of the timer line where mutating `setTimeout(…, ms)` →
`setTimeout(…, 0)` left **all 7 tests green** — the one behaviour the wrapper exists for was untested.
That class is invisible to `verify`, to e2e, and to review-by-reading. Mutation testing is the only
mechanism that finds it systematically. (Same family: the eleven ways a green test failed to fail,
`docs/reviews/2026-07-23-p3bc-audit-program.md`.)

**Shape if adopted** (NOT scheduled — spike first):
- `@stryker-mutator/core` + `@stryker-mutator/vitest-runner` as devDeps; runs locally (`npx stryker run`)
  AND in Actions. It is a dev-dependency, not a hosted service.
- **Nightly `schedule:` only, never per-PR** — it runs the suite once per mutant; even with
  coverage-based filtering a 6.7k-test suite is hours on a 4-core runner.
- **Scope to files where a hollow test is dangerous**, not the repo: `src/lib/withTimeout.ts`,
  `src/lib/supabase/invokeWithTimeout.ts`, `src/lib/budget/budgetGate.ts` + the money classifiers,
  `src/auth/policy.ts` (`can()`).
- **Gate on "zero surviving mutants in that set", not a percentage** — a score invites gaming; the set
  is small enough that every survivor is worth reading.
- ⚑ **Do NOT enable the hosted Stryker dashboard** (`dashboard.stryker-mutator.io`) — this repo is
  public and results would leave the org. Local/artifact reporters only.

**Spike first (the real risk):** measure runtime and the *equivalent-mutant* rate on ONE file. Mutants
that cannot be killed become noise, and a gate people learn to ignore is worse than no gate — the exact
failure mode this whole class is about.

### ⚑ ERPNext operational-completeness slate — the "PMO is the ONLY UI" gaps (2026-07-24, NOT scheduled)
**Framing (owner, locked `OD-SAR-PMO-IS-THE-UI`): ERPNext runs HEADLESS — the user never opens it, PMO is
the sole surface.** That inverts the usual read-vs-write cost logic here: a *read* the user needs isn't a
"nice enhancement", it's the **only way anyone can see that number at all** (no one can log into ERP to
check) → mandatory-visibility, and cheap. A *write* the user must do isn't optional either — if ERPNext's
own form is invisible, PMO must carry the entry surface. Today the adapter **writes** budget / timesheet-hours /
sales-invoice / payment-entry, but pulls almost **no cost back** — so the headless user is blind to their own
actuals. Effort S/M/L; priority reframed for headless. **None scheduled — this is the demand-ordered slate
after P3.** ADR-0055 authority (PMO = operational read-layer + additive enhancement over the ERP SoT).

- **G1 · Project actuals / cost-to-complete pull** — *read, **S**, priority ⭐⭐ (was "nice", headless makes it
  near-mandatory).* Pull ERPNext's posted per-project cost (costed timesheets, booked PIs, expense claims)
  into the project view. **Without it the budget-variance feature we just hardened compares plan against a
  largely PMO-typed `actual_amount` — and no one can open ERP to see the real figure.** Highest value for
  least risk (read-model, no money-write review). Do this first.
- **G2 · Expense claims** — *entry+read, **M**, priority ⭐⭐ (headless upgrades this from read to a PMO entry
  surface — ERP's claim form is invisible).* PMO-side claim capture → write-through → rolled to project cost
  (completes G1's cost picture). Field/travel-heavy contract orgs live on this.
- **G3 · AP / subcontractor cost** — *sync+read, **M** (UI mostly exists), priority ⭐.* The ADR-0033
  procurement case-folder is PMO-native already; the gap is wiring PO/PI/retention to ERP write-through **and
  reading committed (open PO) + actual (booked PI) cost back** into the project cost view. ~half a project
  org's spend. Cost-half of G1.
- **G4 · Cash / collections** — *read, **S**, priority ⭐.* AR aging exists; extend to collected-vs-outstanding
  + overdue nudges (pull payment status). Headless = the only cash view the user gets.
- **G5 · Milestone / progress billing + retention** — *write-through, **L**, priority: demand-gated but
  NON-optional when a client needs it (PMO is the only billing UI).* Progress claims, retention withheld %,
  milestone-triggered SIs (ERPNext payment schedules); ties CRM contract value → the SI schedule. Highest
  *segment* value, most expensive to build safely (full money-path adversarial review). **Build when a client
  who bills on milestones/retention signs — not speculatively.**
- **G6 · CRM won-deal → Quotation/Sales Order** — *write, **M**, priority ◦.* Won pipeline deal auto-creates
  the ERP Quotation/SO so a won contract is billable without re-keying (quotation kind already partly wired).
- **Tier-4, defer until a client asks:** multi-currency billing · tax templates · fixed assets/equipment ·
  material-to-project stock · change-orders/variations.

**Director's rec:** G1 + G4 (both read-model, S, no money-write review) are the cheapest way to make the
headless user *see their own money* — do them as a "P3.5 read-model" pair before any new write-through. G2/G3
complete the cost picture at M effort. G5 stays demand-gated. Sequencing/effort revisited when a real client's
segment is in front of us.

### ⚑ CANDIDATE PROGRAM (2026-07-22) — RIS-parity + CRM-v2 (analysis done, GRILLED, NOT scheduled)
Source: [`docs/reviews/2026-07-22-competitive-refresh-ris-cicle.md`](reviews/2026-07-22-competitive-refresh-ris-cicle.md)
(four-way comparison: PMO main+dev vs our own RIS-portal-2 vs KANNA-recheck vs Cicle; moat thesis §1).
**Prereq: land the `dev` integrations program on `main` first** — no new program starts before it ships.
Then, per the standard series loop (grill → spec → …), the candidate queue:
- **Batch A — approvals governance (spine 2, RIS parity):** A1 value-threshold **approval limits**
  (high-value → Executive, Admin-config, server-enforced) [M] · A2 **mandatory rejection comment** +
  submitter notification (timesheets + procurement; verified absent) [S] · A3 **bulk procurement
  approve/reject** (timesheets already bulk) [S] · A4 **edit-and-approve** (audited) [S–M].
- **Batch B — finance depth (spine 4, rides ERPNext P3 read-backs):** B1 **AP aging** (symmetric to
  P3a AR) [M] · B2 **cash-flow forecast** card (overlaps OD-W5-5 cash-position domain — spec together)
  [M] · B3 **budget baseline/version comparison** (variance vs original) [M].
- **Batch C — timesheet ergonomics:** copy-last-week + recent-projects quick-add [S].
- **Batch D — CRM v2 (spine 5 as the front of the thread, NOT horizontal CRM):** D1 ⭐ **M365
  email/meeting capture → CRM activities** (rides `dev` Graph token custody; flagship) [M–L] ·
  D2 **next-action/follow-up reminders** → notification inbox + agent automations [M] · D3 **weighted
  pipeline forecast** (stage-probability × value; verified absent) [S] · D4 **win/loss reasons +
  analytics** (verified absent) [S–M] · D5 **tender/bid tracking** on the pipeline lens [M–L] ·
  D6 **agent CRM assists** (draft follow-ups, account summary; after D1/D2) [S].
- **✅ GRILLED (owner, 2026-07-22) — locked decisions:**
  - **[OD-CR-1] Order = quick wins → CRM → remainder:** first the S-effort wins (D3 weighted
    forecast · D4 win/loss · A2 rejection comments · A3 bulk procurement approve), then **Batch D
    CRM v2 as the main track**, then A/B remainder + C.
  - **[OD-CR-2] D1 M365 capture v1 = manual log-to-CRM** (user picks an email/meeting to log
    against a contact/deal). No background auto-sync in v1; design the data model so auto-sync can
    ship later as a per-org opt-in flag.
  - **[OD-CR-3] Localization = FULL id-ID in this program** (i18n framework + full Bahasa
    translation + IDR first-class). Sequencing (Director): the **i18n seam + locale/currency
    formatting land EARLY** — before new UI batches build on it (retrofit is the expensive part);
    translation content lands last.
  - **[OD-CR-4] Locale model (Director default, revisable at spec grill): per-org default
    language + per-user override** — fits the org_id seam, covers mixed teams.
  - **[OD-CR-5] Currency (owner-revised 2026-07-22): start single currency per org, but
    ARCHITECT FOR MULTI-CURRENCY — fast follow-up is a real need** (even RIS has overseas
    clients). v1 behavior: org setting picks the currency (IDR/USD/…), all org amounts display in
    it (`Rp 1.500.000.000`, no decimals for IDR). **v1 architecture MUST carry the multi-currency
    seam:** a `currency` column on every money table (defaulted to org currency by trigger, like
    `org_id`), all formatting keyed off the record's currency (never a global constant), and
    rollup/aggregation code written to group-or-convert by currency — so the fast-follow
    (per-record currency + FX table for rollups, mixed-currency contracts) is additive, not a
    migration rewrite. **The ERPNext adapter gets the same seam in v1 (owner directive):** every
    money doc written through (SI/PE/PO/PI/quotes) sets `currency` EXPLICITLY from the PMO record
    — never relies on the ERPNext company default — and read-backs (AR/AP aging, actuals) preserve
    the source doc's currency. v1 still pins org currency == ERPNext company currency at connect
    (one currency in practice), but with the field threaded end-to-end the fast-follow (per-record
    currency + FX; ERPNext's native multi-currency + exchange-rate docs) is config, not adapter
    rework.
  - **[OD-CR-6] Parked set confirmed parked:** in-house chat/video (Cicle turf — stays Big-track),
    field photos/forms (KANNA turf), offline/native mobile.
  - **Resulting sequence:** dev-integrations promote → i18n seam (OD-CR-3) → quick wins
    (D3·D4·A2·A3) → CRM v2 (D1 manual capture → D2 → D6, D5 own spec) → B1–B3 + A1/A4 + C →
    Bahasa translation pass.

### ⚑⚑ ADAPTER PROGRAM — P2 ERPNext money core ✅ MERGED to dev (#315 squash `b549d06`, 2026-07-14)
### ⚑⚑ M365 INTEGRATION — RESUME HERE (updated 2026-07-29) — ✅ MERGED to `dev`; **connect leg PROVEN live, `graph_proxy` NEVER proven**

> **📌 RESUME HERE — cold-start block. A new agent needs nothing but this.**
>
> **State:** everything is **merged to `dev`** and green. There is **no in-flight M365 branch or worktree** —
> nothing half-done to recover. Read the doc-map table below in order.
>
> **⚑ CORRECTION 2026-07-29 — this entry said "the runtime has NEVER contacted Microsoft". That is FALSE.**
> Microsoft **is provisioned** and a **real live connect completed on 2026-07-24 02:20** (owner's own
> account, `arief@gordi.id`): real consent, real code exchange, a real `ms_graph_connections` row holding
> genuine AES-GCM ciphertext. The ADR-0060 **live `security-auditor` gate also ran** on 2026-07-24 and
> found **HIGH-A1** — evidence is the header of `supabase/migrations/0151_m365_ciphertext_envelope_check.sql`.
>
> **Split the runtime into two legs — they have very different status:**
>
> | Leg | Status | Evidence |
> |---|---|---|
> | **Connect** (consent → code exchange → encrypt → store) | ✅ **proven against real Microsoft** | the 2026-07-24 02:20 row |
> | **Live security-auditor gate** (ADR-0060, old TBD-2) | ✅ **ran; found HIGH-A1; closed** | `0151` header |
> | **Use** (decrypt → Graph call, i.e. `graph_proxy`) | ❌ **never once succeeded** | see below |
>
> **Why the use leg is still unproven:** the one live token we ever held was **structurally undecryptable**.
> `#333` shipped `callback.ts` passing a raw `Uint8Array` as a `bytea` RPC arg; supabase-js JSON-encodes RPC
> args, so it was stored as the ASCII of `{"0":12,…}` and `deserializeEnvelope` read `{"0":123,"1` as the IV.
> The row was revoked in Entra and **deleted**, not re-minted. `#365` (2026-07-24 11:23, ~9h later) landed the
> fix — `toByteaParam`/`fromByteaValue` in `crypto.ts` plus `0151`'s CHECK constraints as a loud backstop —
> **but that fix has only ever run against mocked `fetch`.** No post-fix reconnect exists in git or docs.
> ⚑ This was a **real defect in merged code, not a stale deploy** — check the commit dates before re-diagnosing.
>
> **HIGH-A1 class re-check (2026-07-29, owner-requested): CONTAINED — exactly one site, and it is fixed.**
> `bytea` appears in the whole schema only as the params of `m365_upsert_connection` / `m365_refresh_connection`
> (`0115`). Every other `Uint8Array` in `supabase/functions/` is local (hashing, random bytes, stream chunks,
> blob reads) and never crosses a supabase-js RPC boundary. There is no second instance to find.
>
> **Your FIRST action:**
> 1. Verify what is actually **deployed** — `supabase functions list` — and confirm `m365-token-custody` is at
>    or past `#365` (and ideally `#397`). A deploy predating `#365` will reproduce HIGH-A1 on the next connect.
> 2. Re-run **Connect once** (secrets and admin consent are already provisioned — no new Entra setup) and make
>    **one `graph_proxy` GET against `/me/drive`**. Record it as a spike doc. That closes the use leg.
> 3. *Then* build OneDrive doc-linking. Its browse step **is** `graph_proxy` — the one path the live run
>    never reached — so building first risks reworking both layers, which is what its gate was written to avoid.
>
> **Prove the surface still works before you change anything** (all four; the machine is shared, so wrap DB
> work in the lock and chain reset+test as ONE hold):
> ```
> scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db'   # expect Result: PASS
> bash scripts/m365-race-probe.sh        # expect: TOCTOU CLOSED in BOTH interleavings
> bash scripts/m365-deadlock-probe.sh    # expect: legacy REPRODUCED + fixed RESOLVED, both targets
> cd pmo-portal && npm run verify        # full suite + build
> ```
> ⚠️ If the Supabase stack wedges, `supabase stop` then
> `supabase start -x vector,imgproxy,studio,realtime,logflare,supavisor`.
> ⚠️ Unrelated tests failing on **5s timeouts** are almost certainly another worktree running vitest
> concurrently — re-run the named failures in isolation before believing them (backlog track **T2**).
>
> ~~**Do NOT touch**~~ **(SUPERSEDED 2026-07-23 — both are MERGED; `feat/task-model-fields` is BEHIND `dev`
> with byte-identical content. Treat neither as live work.)** the ERPNext P3 branch, `feat/task-model-fields`,
> PR #346, and the ~15 `agent-*`/`wf_*` worktrees. M365 owns only `supabase/functions/m365-token-custody/`,
> `pmo-portal/src/lib/m365/`, `components/integrations/`, migrations `0106–0117`, pgTAP `0144–0154`, and
> `scripts/m365-*-probe.sh`.
>
> **Before you touch the write-guard, the cascade, or the lock order:** the two probes are NOT optional and
> pgTAP cannot replace them (it runs in a single transaction and cannot express a two-session race).

**Status in one line: the whole backend + the connect UI are on `dev` and green, and a real Microsoft connect
completed 2026-07-24 proving the connect mechanics — but `graph_proxy` has never decrypted a real token, so no
Graph data has ever reached PMO, and the code still collapses operator and client into one role, so there is no
client-side path to exercise in any tenant.**

> **⚑⚑ OWNER RULING 2026-07-30 — the connection belongs to the CLIENT's Microsoft 365, and client users make it.**
> Full reasoning: the second amendment in [ADR-0063 §3](adr/0063-microsoft-365-integration-architecture.md).
> Four layers, four owners: Operator entitles the org · the **client's Microsoft admin** consents to the app in
> their tenant · **any client user** who browses grants their own delegated token · the **client PM** binds a
> project to a SharePoint document library (`can('edit','project')`, no approval step — they can only bind a
> library their own Microsoft account can already read).
> **Forced, not preferential:** `callback.ts:123` asserts `id_token.tid === env.m365TenantId`, so pointing that
> secret at a client's tenant makes an Operator connect impossible. Operator-gating and client-tenant connection
> cannot both hold. **`graph_proxy` must de-gate from Operator to "member of an entitled org"** — it already
> loads the caller's own connection row (`proxy.ts:69`), so per-user permissions are plumbed; only the gate
> blocked them. This widens a security-audited boundary → needs its own `security-auditor` pass, and
> `AC-M365-131` (which asserts the OLD rule) must be re-specified, not deleted.

**Doc map (every M365 doc, so none orphan — read in this order):**
| Doc | What it is |
|---|---|
| [`docs/microsoft-365-integration.md`](microsoft-365-integration.md) | The vision / capability map. Start here. |
| [ADR-0063](adr/0063-microsoft-365-integration-architecture.md) | Integration architecture (auth≠authz, two-switch, Graph-follows-ADR-0055) |
| [ADR-0064](adr/0064-entra-app-registration-topology.md) | Entra app topology — **Option C**, per-client app in the vendor tenant |
| [ADR-0060](adr/0060-microsoft-graph-token-custody.md) | The 10 binding token-custody controls + the mandatory live security gate |
| [Phase-0 spec](specs/m365-phase0-foundation.spec.md) · [plan](plans/2026-07-14-m365-phase0-foundation.md) | SSO + entitlement + the card |
| [Phase-1 spec](specs/m365-phase1-graph-token-custody.spec.md) · [plan](plans/2026-07-15-m365-phase1-token-custody.md) | The token-custody runtime |
| [**OneDrive doc-linking spec**](specs/m365-onedrive-doc-linking.spec.md) | ⏸️ **NOT BUILT** — the next feature; 22 ACs, `AC-M365DOC-0xx` |
| [Security audit record](spikes/2026-07-15-m365-phase1-security-audit.md) | All 4 adversarial rounds, verbatim |

**Shipped (merged to `dev`):** PR **#333** (Phase-0 + Phase-1 custody) · **#337** (connect wiring +
`connection_status`). Branches/collector deleted. Migrations **`0106–0117`**, pgTAP **`0144–0154`**, edge fn
`supabase/functions/m365-token-custody/`, FE `pmo-portal/src/lib/m365/` + `components/integrations/`.
- **✅ Phase-0** — Sign in with Microsoft (`azure` OAuth; auth-only, authz stays invited-`profiles`+RLS),
  provisioning hardening (graceful not-provisioned state), `m365_integration` entitlement (Operator switch,
  default-off) + `M365ConnectionCard` (two-switch gate, disabled stub). Battery green (spec APPROVE ·
  security SHIP-WITH-FIXES · quality APPROVE-WITH-FIXES → fixes applied).
- **✅ Phase-1 token-custody runtime** — edge fn `supabase/functions/m365-token-custody/` (ADR-0039 pattern:
  Node-testable DI handlers + thin `Deno.serve` index): PKCE initiate → callback code-exchange →
  AES-256-GCM encrypt → store → Graph proxy (server-side decrypt, data-only responses) → refresh rotation +
  reuse-detection → revoke → audit via the `audit_m365_event` SD wrapper. Store `ms_graph_connections`
  (RLS forced, zero policies, ciphertext-only) + `m365_pkce_states` (single-use, TTL, swept).
- **⚑ SECURITY: 4 Luna (gpt-5.6-luna:max) rounds → `SHIP-WITH-FIXES`, all fixes applied.** Full record:
  `docs/spikes/2026-07-15-m365-phase1-security-audit.md`. R1 BLOCK (Critical: cross-account consent-phishing
  harvest; cascade wired to nothing) · R2 BLOCK (Critical: **empirically reproduced** MVCC callback/lifecycle
  race) · R3 BLOCK (**reproduced a real deadlock**, disproving the Director's "deadlock-free" claim; + a
  regex-escape bug that would have installed NONE of the hardening) · **R4 SHIP-WITH-FIXES** (no High/Critical;
  disabled-user + disentitled-org bypass rejected LIVE with 42501). Controls: id_token `tid` assertion,
  **TOFU + enforce-on-reconnect `oid` binding (owner 2026-07-17)** with a write-once DB trigger, a locked
  write-guard (resurrection structurally impossible), ONE global lock order (profiles→org_features→connection)
  via SD RPCs with `service_role` direct-DML revoked, offboard/disentitlement cascade + triggers + one-time
  audited scrub. Probes: `scripts/m365-{race,deadlock}-probe.sh` (two-session, fail-before/pass-after).
  **⚑ Lesson: every defect across all 4 rounds passed the happy-path pgTAP AND the full verify — tests alone
  would have shipped all of them.**
- **⚑ Migrations RENUMBERED TWICE onto dev (2026-07-17):** M365 was cut from a stale base and numbered
  0096–0107, colliding with dev's ERPNext 0096–0103 → renumbered to 0104–0115. Then the **H4 grants work
  merged to `dev` (#336)** taking migrations `0104`/`0105` + test `0142` — the exact numbers — so M365 was
  renumbered AGAIN to **`0106–0117`**, test `0142`→**`0154`** (`0143–0153` were already unique; note
  `0034/0052/0066` duplicate pgTAP prefixes pre-exist on dev, so test numbers are not ordering-critical —
  migrations are). **⚠️ Lesson: GitHub reported PR #333 `MERGEABLE`/`CLEAN` the whole time — git only sees
  different FILENAMES, so a green mergeable status does NOT catch migration-number collisions. Check
  `ls supabase/migrations | sed -E 's/^([0-9]{4})_.*/\1/' | sort | uniq -d` before merging any branch that
  adds migrations.** Cross-refs rewritten in M365 files only; non-M365 refs (0064/0070/0075/0076/0079/0080)
  + the 32 `AC-M365-1xx` ids verified untouched; `docs/spikes/` deliberately left as the historical record.
- **✅ Connect UI wired (#337)** — `M365ConnectionCard` is no longer a stub: Connect → `initiate_connect` →
  **top-level** redirect to Microsoft consent → callback consumed once + query-param cleared → Disconnect
  behind a destructive `ConfirmDialog`; the whole `M365ErrorCode` taxonomy mapped to human copy; in-flight
  guard; **no token/`oid`/raw error ever reaches the DOM**. Client transport `src/lib/m365/connectClient.ts`.
- **✅ `connection_status` action (#337)** — wiring exposed a real defect: `ms_graph_connections` is RLS-forced
  with ZERO client policies (by design), so the browser could never learn a connection existed and a connected
  user was permanently shown "Not connected". Added a **read-only** action reusing the identical gate chain
  (verifyCallerJwt → RLS-scoped org → real-JWT Admin → entitlement), own-row scoped, **explicit column
  allowlist** `status, connected_at, last_refresh_at, scopes` — ciphertext/`key_id`/`oid`/tenant are never even
  *read from the DB*, so a future schema column cannot leak by default. No writes, no RPCs, **no locks** (so it
  cannot perturb the global lock order).

#### ✅ CLOSED 2026-07-24 — was TBD-2, kept for provenance
- **`security-auditor` pass on the LIVE flow** — DONE 2026-07-24, ADR-0060 gate. It **found HIGH-A1** (the
  mis-marshalled `bytea` envelope), which was then fixed in `#365`. The gate paid for itself on its first run.
- **Live deploy + ONE proven connection** — the connect *mechanics* are proven and remain proven: a real connect
  completed 2026-07-24 02:20 and Microsoft is provisioned (KEK, client secret/id, a concrete tenant GUID,
  allowlisted redirect URI). ⚑ **Do not read the test tenant as a design signal (owner, 2026-07-30):** the vendor
  tenant (`gordi`) is the natural place to test mechanics — idle, owner-controlled, and where the app
  registrations live — and a client tenant (`RIS`) is the natural place to test the real shape. Both are
  legitimate and both have been used. What remains open is *not* the tenant choice: it is `graph_proxy` (never
  exercised) and the operator/client separation the **code** does not yet express. See TBD-2/TBD-3.

#### ⏸️ TBD — what is NOT done, in dependency order
1. **Confirm the DEPLOYED `m365-token-custody` is at or past `#365`** (`supabase functions list`). Anything
   older still contains HIGH-A1 and will corrupt the next connect. Cheap, and it must precede everything.
2. **⭐ Make the code express the operator/client split** — the standing intention throughout, which the shipped
   gate does not implement (owner, 2026-07-30). `graph_proxy` + `initiate_connect` de-gate from Operator to
   "member of an entitled org"; Operator keeps entitlement. **This is the priority item and it is independent of
   which tenant anything connects to** — today there is no client-side path to exercise in *any* tenant, so it
   blocks TBD-3. Requires a `security-auditor` pass (it widens an audited boundary) and `AC-M365-131` must be
   **re-specified**, not deleted (it asserts the old rule). Mutation-check: a disentitled org or a non-member is
   still rejected. Reasoning: ADR-0063 §3, second amendment.
3. **Add the SharePoint scopes, get client tenant admin consent, then ONE reconnect as a NON-Operator user +
   ONE `graph_proxy` GET against a real SharePoint library.** The real remaining gate. Three parts, all needed:
   - `M365_PHASE1_SCOPES` (`initiate.ts:17`) gains `Sites.Read.All` + `Files.Read.All`. `Files.Read` alone
     cannot read a SharePoint library — Microsoft 403s, and our path gate already permits `/sites`, so it fails
     at Microsoft rather than at our door (the confusing kind).
   - Those are delegated permissions **requiring tenant admin consent**; a PM cannot grant them. One-time, per
     client tenant. This is the price of SharePoint-primary (owner 2026-07-29), not an implementation detail.
   - The connect must be made by a **non-Operator** user — that is the path no run has ever exercised, and it
     only becomes possible after TBD-2. Which tenant it runs in is the owner's call per test (`gordi` for
     mechanics, `RIS` for the real shape); the *actor* is what matters here, not the tenant. Record it as a spike doc.
   - **While you are there, also `GET …/versions` on a real item** — ADR-0071 §9 needs to know whether Graph
     exposes a browser-openable URL per version or only version *content*. Answer it before the data model is fixed.
4. **M365 document linking** — [spec written, NOT built](specs/m365-onedrive-doc-linking.spec.md), and now
   **materially out of date**: it is OneDrive-only, drift-free, and assumes an Admin/PM can call `graph_proxy`.
   Needs a revision for SharePoint-primary + site/library browse + the ADR-0071 drift model + version pinning +
   the project↔library binding. **Build follows (3)**: its browse step *is* `graph_proxy`, the one path no live
   run has ever reached.
5. **An M365 e2e is OWED.** `docs/specs/m365-phase0-foundation.spec.md` §5 deliberately shipped no Phase-0 e2e
   and promised the entitle → card → connect journey would "graduate to one e2e in Phase 1 when the live connect
   ships". Live connect shipped 2026-07-24; `pmo-portal/e2e/` still contains **no M365 spec**. Not doc rot — a
   real coverage debt. Note the journey's *actor* changes with the 2026-07-30 ruling.
6. Later (vision §3.3+): Teams, Outlook/Calendar, in-app browse/preview, Entra-group→role provisioning.

#### ⚑ GOTCHAS — hard-won, do not rediscover
- **The runtime HAS contacted Microsoft — but only on the connect leg** (2026-07-24; see the correction at the
  top of this entry). Every Phase-1 test still mocks `fetch`, and `graph_proxy` has **never** decrypted a real
  token. 4 security rounds + 1,600 pgTAP + 5,400 unit tests prove the custody *model* (encryption, RLS, races,
  deadlocks, lifecycle deletion); they prove **nothing** about real Graph responses. Expect surprises on the
  first real `graph_proxy` call — that is exactly what gate (2) buys.
- **A green suite shipped HIGH-A1 to a live tenant.** The mis-marshalled `bytea` passed 4 adversarial security
  rounds, the full pgTAP suite and the full verify — because every test mocked the boundary where it broke.
  It was caught by a **migration refusing to apply** against real data. Corollary: a constraint that fails loud
  on production data is worth more than another test against a mock.
- **`common`/`organizations` will silently never work** — see TBD-1. Use a concrete tenant GUID.
- **Tests alone would have shipped every one of the 4 security defects** (two Criticals, a reproduced deadlock,
  and a wrong "deadlock-free" claim by the Director). They ALL passed the happy-path pgTAP *and* the full
  verify. Adversarial review is what caught them — budget for it on any security-critical surface.
- **A green "mergeable" does NOT catch duplicate migration numbers** (git compares filenames). Bit this
  program **twice**. See backlog track **T1** for the proposed CI gate.
- **A linked OneDrive doc will be a URL, not a token-mediated stream** — Microsoft stays the permission
  authority, so a linked row must stay visible even when the connection is stale/revoked (spec §3.4).
- **Our scope gate permitting a Graph path ≠ Microsoft granting it.** `scopeCoversPath` allows GET under
  `/me/drive`,`/drives`,`/sites` with `Files.Read`; SharePoint libraries still need admin-consented
  `Files.Read.All`/`Sites.Read.All` or Microsoft 403s (surfaced as `GRAPH_ERROR`).
- **Two probes exist and must stay green** — `scripts/m365-{race,deadlock}-probe.sh` are two-session concurrency
  probes with fail-before/pass-after semantics. pgTAP runs in ONE transaction and **cannot** express these races;
  if you touch the write-guard, the cascade, or the lock order, run the probes, not just the suite.
- **⚠️ ADR NUMBER COLLISION (debt, not M365-specific):** three ADRs are numbered **0059**
  (`entra-app-registration-topology`, `external-admin-connect`, `pmo-sot-with-external-side-mirror`) and two are
  **0058** (`microsoft-365-integration-architecture`, `erpnext-money-idempotency-outbox`) — same root cause as
  the migration collisions (parallel agents numbering off stale bases). So a bare "ADR-0059" is **ambiguous**;
  always cite ADRs by *filename* in M365 docs. NOT renumbered here: 0058 is cited in ~55 files and 0059 in ~21,
  spanning other programs' work — that is an owner-level call, not a side effect of an M365 doc pass.

### ⚑⚑ ADAPTER PROGRAM (2026-07-14) — P2 ERPNext money core MERGING (#315, owner go; CI green)
- **✅ P2 BUILT + FULL BATTERY CLOSED + POST-OPEN HARDENING** (branch `feat/erpnext-adapter-p2`,
  migs `0093/0094 + 0096–0103`, 5 edge fns, live-bench-proven): 9 slices (served-fn e2e infra ·
  fenced money outbox · tier core · parties · MR/RFQ/SQ · PO/GR · PI/PE full AP surface ·
  aging/actuals · change-feed). Battery: Luna money audit ×2 (build round: double-pay C-1 → PE
  composite probe + `held`; finalization TOCTOU → fenced RPC; post-open round: 3 BLOCK + 2 SF all
  fixed — 0097 Internal-exemption bypass, webhook shared-secret ambiguity → 401, future-due aging
  leftover → `current` invariant, fencing-loss re-read, per-currency aging rows) · quality/spec ·
  Discover. **Post-open (2026-07-14): EDGE_JWT_ISSUER (SUPABASE_ env prefix platform-rejected —
  dev's override was dead) · aging parser rewritten for the real per-voucher v15 report ·
  PostgREST NULL-composite in claim/quarantine RPCs · 3s bounded committing-wait · INBOUND FEED
  ARMED LIVE (Frappe Webhook + HMAC → full-fidelity party adopt; sweep GL/PLE mirror; field-level
  inbound re-sync of linked rows deliberately out of P2 scope — lifecycle+adopt only).** Gates:
  verify 5,325 · pgTAP 166/1,458 · serial battery 21/21 + smokes 16/16 (zero skips, live bench).
  Residuals (decisions.md `OD-ENA-*`): contacts-inbound deferred · procurement_items INSERT open
  by design · VendorQuotesTab badge slot · e2e-cleanup un-flips manual fixtures (ops note) ·
  OD-ENA-VAULT-SEAM + OD-ENA-SHARED-BINDINGS (coordination with the OD-INT admin-connect layer).
  **Activation checklist (owner-gated):** per-org `external_org_bindings` + secret_ref fn-secrets ·
  Vault `erpnext_sweep_url/secret` · webhook secret per instance · Frappe Webhook doctype config
  (local demo of ALL of it ran 2026-07-14 on the owner's machine — 2-way sync verified).

### ⚑⚑ SHIPPED TO PROD — v0.7.0 (2026-07-14, owner-instructed full release)
`main`→`production` promoted; release-please cut **v0.7.0** (PR #319 admin-merged). Prod state: **DB at
mig `0095`** (`db-push-prod.sh` applied `0084–0095` — agent_usage cols, external adapter seam, rate-limit,
ClickUp flip/sweep, is_active_member banned_until; all additive/flag-off), **all 10 edge fns deployed at
`99df5fc`** (health reports it), **FE `production`=`99df5fc`** (pmo-bfb.pages.dev). Contents = **ADR-0057
JWT Task 3** (compose-view/adapter-dispatch/agent-chat → local ES256 JWKS caller-JWT verify, dropping
`auth.getUser`; is_active_member also checks `banned_until`) + analytics #324 + e2e-isolation #317/#326.
Plan + prod runbook: [`docs/plans/2026-07-12-jwt-signing-keys.md`](plans/2026-07-12-jwt-signing-keys.md).
- **Deploy gotchas learned (see `deployment.md` memory):** `stamp-edge-fns.sh`/`supabase functions deploy`
  ship the WORKING-TREE code at the CURRENT `HEAD` — `git reset --hard origin/main` BEFORE deploying (a
  stale local `main` briefly regressed prod fns this release, corrected). Docker Desktop file-sharing
  breaks under heavy load → restart Docker if the bundler mount-fails. `db-push-prod` is all-or-nothing
  sequential — check the `--dry-run` list before confirming.
- **Pending (owner, none blocking):** (1) valid-token end-to-end smoke = a live-app login → Assistant
  answers (couldn't mint a prod token safely; reject-path + JWKS(ES256) already green); (2) ClickUp sweep
  cron `0094` idle until Vault secrets (`clickup_sweep_url`/`clickup_sweep_secret`) + fn env set;
  (3) PostHog events need `POSTHOG_PROJECT_KEY` in prod.

### ⚑ prior program block (2026-07-10) — P0 seam SHIPPED to dev; P1 ClickUp shipped (#307)
- **✅ P0 external-adapter seam MERGED to `dev`** (PR #299, `2cbacd5`; ADR-0055): migrations
  `0087–0090` (ownership switch + refs + watermarks + reference read-model w/ RLS write-flip),
  `adapterSeam` pure core, `adapter-dispatch` edge fn, read-only Integrations section on
  Administration. Full battery (spec APPROVE · quality/design APPROVE-WITH-FIXES→applied ·
  security SHIP); gates Director-run. Deferred: error-passthrough + payload-bound (security
  L2/L3), display-label map (`OD-EAS-LABELS`), `executeWrite` wiring into real repos (P1).
- **✅ P1 ClickUp adapter (tasks domain) — BUILT, battery-green, PR pending** (branch
  `feat/clickup-adapter-p1`; spec signed off + ADR-0056): 6 slices (schema flip 0093 + Vault-cron
  0094 · adapter module · repo wiring + byte-for-byte net · change-feed webhook/sweep · onboarding
  both directions · view/labels), 35/35 ACs proven, 2 e2e (AC-CUA-090/091, page.route pattern,
  serial-only — shared seed org). Battery: spec/quality/Discover APPROVE-W-F → all applied;
  security SHIP-W-F → HIGH-1 (sweep-cron Vault regression) FIXED + cross-family CONFIRMED-SHIP.
  Gates Director-run: verify 4906 · pgTAP 157/1291 · 4× deno · e2e 2/2. **Mocked-only: live
  ~~ClickUp smoke deferred until a token exists~~ **✅ DONE 2026-07-23 audit — the smoke RAN 2026-07-17
  (`docs/spikes/2026-07-17-clickup-live-smoke.md`) and the `CLICKUP_API_BASE_URL` seam is in two places.**
  Activation checklist (owner-gated): 2 Vault secrets (clickup_sweep_url/secret) + fn envs
  (CLICKUP_API_TOKEN/WEBHOOK_SECRET/SWEEP_SECRET, 1P vault-AS items clickup-api-token/-webhook-secret).
  B2B note: per-org webhook secret before >1 employing org shares a deployment (security LOW-1).
  **P2 prereq (Director): served-edge-fn e2e infra — money commands get the real boundary, not
  page.route.** Next: P2 ERPNext money core, P3 width, P4 Odoo (ADR-0055 §8).

### ⚑⚑ RESUME HERE (2026-07-09) — agent experience SHIPPED to prod; automations HELD for prod
Full detail in memory `agent-multiround-handoff-20260708.md` (loaded each session). Snapshot:
- **⚑ BINDING: agent model = `deepseek/deepseek-v4-flash` — NEVER change without a DIRECT per-instance owner instruction. Browser tests via a Playwright CLI script / `agent-browser`, NEVER the Playwright MCP (it leaks node servers).**
- **✅ SHIPPED TO PROD — `v0.4.0`** (`production` == `main` content; edge fns redeployed to `prwccpsiumjzvnwjlkwq`; verify: `curl .../functions/v1/health` reports the git SHA): run-persistence fix (#271), **multi-turn follow-ups**, **adoptRun** (follow up on a History-loaded convo), **latency ~19s→~6s** (`provider:{sort:'throughput'}` + temp 0.8, model unchanged), **ThinkingBubble interactivity**, **edge-fn versioning** (baked per-fn SHA + `x-deploy-version`), **client-facing cleanup** (removed the `edge·sha` panel label + the GitHub commit link — repo is public). Proven via Playwright-CLI: 8/8 multi-round turns, history persist+reload, follow-up-from-history.
- **⏸️ HELD FOR PROD (owner "hold for productions" 2026-07-09): automation enablement — MERGED to `main` (`d5e97d0`), NOT deployed.** The e2e uncovered + FIXED that automations NEVER fired: `agent-dispatch/mint.ts` read `data.properties.access_token`, which Supabase `admin.generateLink({type:'magiclink'})` NEVER returns (it returns `hashed_token`) → every fire threw `mint failed`. Fixed to the correct **generateLink → verifyOtp(token_hash) → owner session** flow (proven e2e locally: real notification written). Plus: dedicated `AGENT_DISPATCH_SECRET` in **Vault** replaces the master service_role key for the cron→fn auth (mig `0082` — master key no longer in the DB); schedules restricted to **daily/weekly/day-of-month** (minute-0); tick → **hourly**. Security-auditor: **SHIP** (no High/Critical; deputy invariant intact).
- **HELD prod-enablement checklist (owner-gated, on GO):** (1) apply mig `0082` to prod DB (`db-push-prod.sh`; prod at `0081`, `0082` is the only pending, additive); (2) create 2 Vault secrets (`agent_dispatch_url`=fn URL, `agent_dispatch_secret`=fresh `openssl rand`); (3) set `AGENT_DISPATCH_SECRET` fn env = SAME value; (4) redeploy `agent-dispatch`+`agent-chat`; (5) prod fire-test (due automation → notification + confirm NO owner email). **No owner secret input needed** (service_role auto-injected; dispatch secret self-generated).
- **Agent write set** = 4 RLS-scoped, approval-gated actions: `create_activity` (CRM), `update_task_status`, `create_automation`, `notify`. Base agent is read-only; no general "edit project" action yet (would be a new can()+RLS+SoD+approval action). **Audit trails:** `audit_events` (0076, immutable, who/what/from→to for money/transitions/deletes/credits), `procurement_status_events` (0038), `agent_events` (0046, every agent tool call), `0079` agent-denial audit; business tables carry created_at/updated_at.
- **Specs (dev):** ARH/ARM/ATO/ALR/AMT (agent gap-analysis do-now/do-next) — planning docs, NOT built. Token streaming still queued.

### 2026-07-10 — IG backend-checklist audit (@web_pros "Vibecoding a Backend?") → 2 findings
Audited the PMO backend against the post's 15-item shipping checklist + security/scale/production slides.
Result: **12/15 solid, exceeds on authz/secrets/testing**; 3 deliberate skips (Redis cache, ORM, Docker —
YAGNI at single-tenant scale). Two real gaps, prioritized:

- **P1 — request-rate limiting on public/expensive edge fns. ✅ PR'd to `dev` (feat/edge-request-rate-limit).**
  `creditRateGuard` bounds SPEND but there was **no request-FREQUENCY limit** on the public edge fns beyond
  Supabase platform defaults — a burst can't drain credits (reserve_credits closes that) but CAN burn
  invocations + upstream OpenRouter latency; admin-invite abuse can email-bomb. Fixed-window limiter —
  mig `0091_request_rate_limit.sql` (`request_rate_counters` unlogged + RLS force/no-policy;
  `rate_limit_hit(key,limit,window)` SECURITY DEFINER, service-role grant) + shared
  `_shared/requestRateGuard.ts` (fail-OPEN — availability defense, opposite of the credit guard) + wired
  into `agent-chat/index.ts` (post-JWT, keyed `agent-chat:<userId>`, 20/min default via
  `AGENT_RATE_LIMIT_PER_MIN`, 429 + Retry-After). Tests: pgTAP `0140` (9 assert, AC-RL-002..006) +
  `requestRateGuard.test.ts` (6, AC-RL-001). Verified: pgTAP 9/9, vitest 6/6, full `npm run verify` green,
  `deno check` clean. **Supersedes the older scattered "agent-chat rate-limit" Med.** Fast-follows
  **✅ DONE** (PR #304): `compose-view` (model spend, `COMPOSE_RATE_LIMIT_PER_MIN` def 20) +
  `admin-invite-user` (email/user abuse, `INVITE_RATE_LIMIT_PER_MIN` def 10, throttle placed AFTER
  authorization so FR-INV-004 holds — service_role never exercised for an unauthorized caller).
  `health` left unthrottled deliberately (cheap, no spend). Cron fns (`agent-dispatch`,
  `telegram-notify`) are secret-gated, not public — out of scope.
- **P2 — error monitoring: PostHog Error Tracking (NOT Sentry — correction 2026-07-10).** The earlier
  "needs a Sentry-class tracker" framing was WRONG: PostHog *is* the error tracker, already integrated,
  and the **frontend already runs it** — `window.onerror`/`unhandledrejection` (`AnalyticsProvider`) +
  React `ErrorBoundary` → `posthog.captureException`, privacy-redacted (`before_send`), `safeTrack`-wrapped.
  So no Sentry, no new dep, no external account. **✅ Server-side half wired (PR #305):** the universal
  edge-fn logger `logStructuredError` now fire-and-forget fans every error into PostHog Error Tracking via
  `_shared/posthogError.ts` (guarded no-op outside Deno / without `POSTHOG_PROJECT_KEY`; sends only the
  error CODE + fn + non-secret contextId/orgId). Client + server errors now share one issues view.
  **Deploy step (owner, on GO):** set `POSTHOG_PROJECT_KEY` (the phc_ ingestion key, 1Password
  `pmo-posthog-token`) as an edge-function secret in the Cloud project — until then the forward is a
  silent no-op (error_events + Telegram unaffected). `error_events` retention/completeness remains a
  minor separate Med.
- **Plus — PostHog dashboards BUILT (separate deferred item, done this session).** ✅ 3 dashboards /
  19 insights live in project `465502` (Agent adoption+reliability · Auth login health · Product
  usage+friction), provisioned **as code** from the typed event catalog. PR #303
  (`feat/posthog-dashboards`), script `scripts/posthog/provision-dashboards.mjs` (idempotent,
  upsert-by-name), docs `docs/posthog-dashboards.md`. Write-scoped key = 1Password `posthog-personal-api`
  (`phx_`). Partly addresses the GTM observability-floor "PostHog dashboards" line below.

### ⚑ CURRENT STATUS (2026-07-07 late) — read first; trust git over memory

**Branches:** `origin/dev` == `origin/main` == **`c0b0081`** (RECONCILED 2026-07-07 — two parallel agents' work unified: the GTM hardening wave + agent-prod-readiness; only `backlog.md` conflicted, resolved by union). `origin/production` == **`94ce615` (UNTOUCHED — prod NOT deployed** with any of the below; still the OLD prompt/schema, Cloud DB at mig ~`0060`). Migrations → `0075`, pgTAP top `0133`.

**On dev/main now:**
- **7-issue GTM wave** (ops-admin #243 · legal #247 · obs-floor #248 · onboarding #249 · auth #235 · deputy-help #233 · DR #230), each full-loop.
- **org_id-seam hardening** (#250, mig `0074`): `stamp_org_id()` trigger on 42 tables (narrow variant — stamp when null/seed-default, forged foreign org → 42501; `credits`/`org_features` excluded); security SHIP, pgTAP 1119.
- **Agent prod-readiness** (other agent): mig `0061` persistence-for-all-orgs (fixed the real prod bug — `org_id` seed-only default made non-seed users' runs fail RLS silently), 8-entity read-scope (`entityCatalog.ts`), deterministic query-skills (`agent-chat/prompt.ts`), skill-creator vendored, query-selection eval probe (deepseek-v4-flash 100% call rate), CRM flag enabled. Component-verified; the live answer→render→persist loop NOT proven-in-prod (browser harness failed).
- **Deep multi-auditor audit (2026-07-07): GO-WITH-CAVEATS** — foundation is ship-grade (RLS 48/48, org_id seam, SoD RPCs all pgTAP-proven, money uniformly `numeric`, `npm audit` clean, no Critical *security* hole); the blockers cluster in **agent-subsystem reliability + supply-chain + no audit-trail**, not the CRUD/RBAC/RLS foundation. (Full audit body in the 2026-07-07 session transcript.)

**Audit fixes SHIPPED to dev/main:** auth-floor pre-flight enforcement (#251, `check-auth-floor.mjs` gates `provision-client.sh`) · avatar AA-contrast (#252, `--avatar-1..5` tokens) · `auto_expose_new_tables=false` + explicit-grants mig `0075` (#255, column-level-aware mirror) · CORS fail-closed + `||true`-test fix + ADR-0049→0054 (#254) · production-auth-config deploy checklist codified (`environments.md`).

### ⚑ CRITICALS + AUDIT-GAP FIXES LANDED (2026-07-07 — all merged to `dev`, prod untouched) ⚑
Substrate: glm-5.2 (opus alt) + glm-4.7 (sonnet alt) built; Director security-reviewed every diff + verified pgTAP serially. `origin/dev` tip carries ALL of the below; `origin/production` == `94ce615` (UNTOUCHED). **NOT yet promoted to `main`** — see "Next" below.

**MERGED to dev (audit's 3 Criticals + 4 top gaps):**
- **#16 automation double-fire (Rel-Crit)** — PR merged. Mig `0078_automation_fire_claim.sql` (per-`(automation_id,event_id)` PK claim, service-role-only) + `claimTriggerFire` in `dispatcher.ts` + pgTAP `0135`. *(Director fixed glm-4.7's hallucinated `.on().ignore()` supabase-js API + `has_table`/`trigger_on` pgTAP bugs.)*
- **#17 audit_events + log_audit() (Obs-Crit)** — PR #256. Mig `0076_audit_events.sql` (append-only, FORCE RLS, one SELECT policy own-org Admin/Operator, `log_audit()` postgres-owned definer sole writer; wired into `operator_grant_credits`/`set_project_contract_value`/`transition_document_status` + companies/projects AFTER-DELETE triggers) + pgTAP `0133` (28). *(Director caught: transition copied from STALE 0017 → dropped 0025's auto-Supersede → `0066` regressed → re-based on 0025; hardened append-only to privilege-denied; fixed non-runnable frozen-test SQL.)*
- **#15 reserve_credits (Rel-Crit) — DORMANT primitive** — PR #257. Mig `0077_reserve_credits.sql` (`credit_reservations` hold-ledger + `reserve_credits()` under `pg_advisory_xact_lock` + `release_credits()`) + guard `check(orgId, runId?)` + pgTAP `0134`. Director-reviewed (advisory-lock accounting closes the race). **⚠️ DORMANT: no call-site passes a runId + `AGENT_CREDITS_ENFORCED` OFF → reserve/release never invoked → changes no live behavior.** **Deferred wiring (the actual race-closer, tracked below).**
- **#18 agent SoD-refusal audit (Obs-High, gap #1)** — PR #259. Mig `0079_audit_agent_denial.sql` — `authenticated`-callable SECURITY DEFINER wrapper stamping action/org/actor server-side (non-forgeable) → `log_audit`; wired into the 2 `can()`-preflight refusal sites in `agent-chat/handler.ts` (fail-open). pgTAP `0136` (19).
- **#19 agent-dispatch reliability (gap #3) + #16-regression fix** — PR #258. `advanceWatermark` now surfaces `WATERMARK_ADVANCE_FAILED` (was swallowed). **AND fixes a vitest regression #16 landed on dev**: `claimTriggerFire` hit `dispatcher.deputy-invariant.test.ts`'s mock default-throw → AC-AAN-024 failed; taught the mock the `agent_automation_fires` claim. *(gap #4 select_trigger_events org-constraint = NO-OP by design: 0054 is service_role-only + its (org_id,to_status) filter-join IS the tenancy authority; no automation context in the RPC to constrain further. Not changed.)*

**Migrations now `0076–0079`; pgTAP `0133–0136`.** *(Op-lessons this wave: glm agents copy the STALE migration body for `create or replace` RPCs — grep ALL defs, use latest. Frozen RED tests carried non-runnable SQL — non-hex UUIDs, `is(numeric,integer)`, `table_exists`→`has_table`, `profile_status` enum is `active`/`disabled` not `inactive`. Merging on pgTAP-ONLY verify let a VITEST regression reach dev — run BOTH pgTAP + `npm run verify` before merge for anything the dispatcher/handler touch. AC-AUTHF-036 timed out only under heavy concurrent-agent load = flake; CI (isolated) is the reliable gate. A live pi run collides with `db reset` on the shared stack — `pgrep -fl "pi --provider"` before resetting.)*

### Status
- **✅ PROMOTED `dev`→`main`** (PR #261, `e4fc018`) — `main` == `dev` content; `production` UNTOUCHED (`94ce615`). All audit Criticals + gaps + supply-chain/CI + the service_role regression fix are on `main`. Integration lane (full e2e + visual) GREEN.
- **✅ service_role grants regression FIXED** (PR #262, mig `0080` + pgTAP `0137`) — **the promote's e2e caught it**: `0075`'s auto-expose lockdown re-granted `authenticated`/`anon` per-table but **never re-granted `service_role`** → service_role lost DML on all tables → would 42501 `admin-invite-user` + agent persistence IN PRODUCTION. 0080 restores service_role's full DML + `ALTER DEFAULT PRIVILEGES`. **Op-lesson: PR→dev skips e2e, so a service_role/grant regression is invisible until the promote's `integration` lane — pgTAP runs as the superuser migration role (bypasses grants) and cannot catch it. The integration gate earned its keep.**
- **✅ `main`→`production` DEPLOYED (owner-instructed 2026-07-07)** — holistic: prod Cloud DB migrated `0061→0080` (`db-push-prod.sh`, all additive, ✓ applied, dry-run clean) · all 6 edge fns redeployed to `prwccpsiumjzvnwjlkwq` · **`SITE_URL=https://pmo-bfb.pages.dev` set** (was MISSING — would have 500'd admin-invite-user + blocked agent-chat CORS) · FE pushed `git push origin main:production` (`94ce615..e4fc018`, CF Pages build). Smoke: health fn 200 `{ok:true}`, DB at 0080, pages.dev 200. **`production` == `e4fc018` == `main` content.** ⏭ Still to verify: a live login→agent-answer browser smoke (needs prod creds). Auth-floor dashboard config (signup-off/confirmations/Resend) remains the owner-only manual step.

### ⚑ GTM BUILD — HANDOFF STATE (2026-07-05, for the resuming agent — READ THIS to continue)

**What this is:** the GTM MVP program (the 8 rows above) is mid-build. **Build ≈ 72% done** (2026-07-05):
3 issues merged to `dev` (auth #235, deputy-help #233, DR #230), ops-admin built+verified awaiting
rendered-pass+PR, legal code-complete awaiting rendered-pass+PR, observability + onboarding
signed-but-not-built, Entity dimension deferred-conditional (Entity #7 excluded from the denominator
until a group client signs). **Build% ≠ ready-for-first-client%** — the gap also needs the owner-side
wiring + promote gates listed at the bottom of this block. Every issue has a signed **spec + plan**
authored via the full 2-model review battery (author → cross-model REVISE review → fix round →
Director commit; plan reviews caught real defects — a disabled-user write hole, two would-be-regressed
security fixes, 7 ACs excluded from CI). SDD docs by issue below — **read the spec then the plan
before touching any issue.** Process is unchanged: `CLAUDE.md` per-issue loop +
`docs/director-playbook.md`; `docs/pi-delegation.md` for GLM dispatch; the **binding
`pr-after-review-battery` rule — full battery (3-lens code review + rendered/Discover pass for UI +
e2e/BDD) green LOCALLY before any PR**; branch flow work→`dev`→`main` (`main` = autonomous ceiling).

**Per-issue status (branch `feat/<name>` in `../PMO-worktrees/<name>`):**
| # | Issue | Spec | Plan | Extra | State |
|---|---|---|---|---|---|
| 1 | Auth floor | `docs/specs/auth-production-floor.spec.md` | `docs/plans/2026-07-04-auth-production-floor.md` | — | ✅ **MERGED to `dev` (PR #235)** — full battery passed |
| 7 | Deputy-help | `docs/specs/deputy-help.spec.md` | `docs/plans/2026-07-04-deputy-help.md` | live-verify = `docs/qa-portfolio.md` (AC-DH-005) | ✅ **MERGED to `dev` (PR #233)** |
| 4 | DR runbooks | — | — | `docs/runbooks/{incident-response,restore-drill}.md` | ✅ **MERGED to `dev` (PR #230)** |
| 2 | Ops-admin | `docs/specs/ops-admin-surface.spec.md` | `docs/plans/2026-07-04-ops-admin-surface.md` | `docs/adr/0049-ops-admin-surface.md` | 🟢 **ALL 7 SLICES BUILT + 3-lens battery hardening VERIFIED — needs only rendered pass + PR** (branch `feat/ops-admin` @ **`e4e135b`, pushed; NO PR yet**). Slices: S1–S5 (`8cd0faa`), **S6** (`eae9d47` — `org_features` mig **0068**, `useFeature`/`FeatureGate`, Features/Credits sections, a11y capstone; pgTAP **0122/0123**), **S7** (`9c978c2` — 3 curated e2e: AC-INV-001 invite, AC-CRE-004 grant, AC-ENT-005 toggle). Migrations **0060–0068**, pgTAP through **0123**. **3-lens review battery ran (spec+code+security)** → hardening applied in `e4e135b` (sec M1 disabled-Operator RPC entry-guards, M2 invite redirectTo from `SITE_URL` not Origin header, L1/L3 credit-attribution + entitlement-probe close, L4 TOCTOU sole-admin `SHARE ROW EXCLUSIVE` lock, L5, code I1/I2/I3, spec I1). **Verified: pgTAP 1041/1041 green + typecheck/lint clean.** ⏭ **RESUME:** rendered Discover pass (AdminUsers/Usage/Features UI) → open PR to `dev`. **Deviations to carry:** CI extended for `admin-invite-user` deno-check/boot-smoke; `errorLog.ts` `EdgeFunctionName` widened; `classifyMutationError` `overrides` param; `AdminUsers.mailto.test.tsx` deleted (FR-INV-006); `deno.lock`s untracked per repo pattern. |
| 5 | Legal pages | `docs/specs/legal-pages.spec.md` | `docs/plans/2026-07-04-legal-pages.md` | — | 🟡 **CODE-COMPLETE** (branch, unpushed) — 2-lens SHIP, e2e 70/70. **NEEDS: rendered Discover pass** (stack) → PR. |
| 3 | Observability | `docs/specs/observability-floor.spec.md` | `docs/plans/2026-07-04-observability-floor.md` | no ADR (uses ADR-0046/0048 precedents) | ⏳ **SIGNED, NOT BUILT** (stack-bound). Renumber migration/pgTAP vs then-current `dev` max at build time. |
| 6 | Onboarding | `docs/specs/onboarding-tooling.spec.md` | `docs/plans/2026-07-04-onboarding-tooling.md` | `OD-ONB-1` in `docs/decisions.md` (on branch) | ⏳ **SIGNED, NOT BUILT** (stack-bound). Renumber at build time. |

**Cross-issue contracts already wired (don't re-derive):** ops-admin's `admin-invite-user` edge fn
passes `redirectTo:<origin>/update-password` + stamps `user_metadata.invite_pending=true` — the
auth-floor invite-accept gate consumes these (in the ops-admin plan).

**Two hard constraints for whoever resumes:**
1. **Single local Supabase stack = serial lock.** `db reset` is global across worktrees, so only
   **ONE stack-driving task at a time** (build with migrations/pgTAP/e2e, or a rendered pass). Order
   the remaining stack work: finish ops-admin build → its rendered pass → legal rendered pass →
   observability build → onboarding build. FE-only/unit/typecheck/lint/build + no-stack reviews may
   run in parallel.
2. **Migration/pgTAP numbers keep moving** as parallel sessions merge to `dev`. **Before building #3
   or #6, `git merge origin/dev` into its branch and re-check `ls supabase/migrations | tail` +
   `ls supabase/tests | tail`, then renumber that plan (+offset) to the next-free numbers.** (ops-admin
   was already shifted +2 → 0060–0068 for exactly this reason.)

**Executor at handoff:** GLM (pi) rate-limited until **~12:04** (2026-07-05); **Claude subagents
available** (reset 03:20). Route per `docs/pi-delegation.md` (glm-5.2 default) when GLM returns;
else Claude implementer/reviewer agents. The ops-admin completion is currently a **Claude sonnet**
agent (owns the stack).

**Owner-pending (not the build agent's to do):** wire `RESEND_API_KEY` + real DNS/sender + domain
decision (deferred); Supabase Pro billing at first client; take `docs/legal/2026-07-04-msa-brief.md`
to counsel; provide the OpenRouter fallback chain. **Deferred tech follow-up:** `auto_expose_new_tables`
GRANT migration (see the "Deferred follow-up" note above).

### ⚑ OPEN feature tracks (owner-scope-gated — NOT started)
> Rescued 2026-07-25: these were buried inside a 383-line section titled *"AGENT EXPERIENCE LAYER —
> HANDOFF STATE"*, so nothing about the heading suggested live feature work was inside. They are
> open items, not history.

- **Feature entitlements / per-org gating (owner-decided 2026-06-15, BACKLOGGED)** — deactivate features per
  org ("not every company needs Incidents") on the *same axis* that later becomes paid tiers. **Decision of
  record (owner):** build the **entitlement seam + per-org toggles**; **UI-hide now, server-enforce later**
  (defer RLS per feature until it becomes a paywall); **NO billing/Stripe** yet. **First build:** `org_features`
  table (`org_id`,`feature_key`,`enabled`) + a feature registry (`incidents`,`crm`,`procurement`,`timesheets`,
  `import_export`,…; core never-gated = Projects/Dashboard/Approvals/Admin) + `org_has_feature(key)` SQL fn
  (ships now, *unused by gated tables* — the later-enforcement hook); FE `useFeature()`/`<FeatureGate>` mirroring
  `usePermission`/`<CanWrite>` gating **rail item + route (redirect, not just hidden nav) + affordances**; an
  Admin `/administration` "Features" toggle section. **Hold-the-line even in UI-first:** `org_features` itself
  gets real RLS (read-own-org, **admin-only write**); disable = **hide, never destroy** (re-enable restores).
  **Deferred:** `plans`/`plan_features`, billing, and the `AND org_has_feature(...)` RLS on each gated module.
  Orthogonal to RBAC (entitlement = per-*org* feature; RBAC = per-*role* action) — both UX-gate + (eventually)
  RLS-enforce. **Own issue via full loop** (grill → spec → **ADR-00NN** [pre-assign] + plan → TDD → 3 reviewers →
  mockup+design-review for the Admin toggle/gated nav → ship). The ADR must record the UI-first bypass risk
  explicitly. May expand the registry once the owner's broader app feedback lands.
- **Commitment-governance (OD-W5-5)** — (a) a server-enforced **PO-commitment approval gate** (distinct
  authority signs off the order commitment vs budget+cashflow before PO): new state-machine state + RPC +
  ADR; (b) a **cash-position/cashflow data domain** (opening balance, in/out-flows, runway — none exists
  today). Spec together.
- **Admin RBAC config engine (OD-PROC-6)** — configurable roles + access; re-enables Engineer-as-manager
  approvals (OD-W2-2, currently FE-off / RPC-dormant). Also the home for per-category document access
  (OD-DOC-4). The B2B-multitenancy bridge.
- **Reports module** — `/reports` is a placeholder; needs owner definition (read-only dashboards/exports).
  Export affordances (Sales, board pack) route here.
- **Design-system normalization (H2/H4)** — full arbitrary-px-spacing sweep + off-scale-font normalization
  (only a scoped subset done in the coherence wave); touches dozens of components → own track with a rendered diff audit.
- **Later spines:** Revenue/AR (progress billing, retention, change orders — spine 4; ties into milestones),
  Resources/Assets (spine 8), Service/O&M (spine 9). See `docs/roadmap-spines.md`.


## ▶ OPEN debt / follow-ups (tracked, none mandate-blocking)

### Edge-function operationalization + versioning (from the agent epic + ADR-0042)
- **Edge-function prod deploy step** [Medium, OWNER-GATED — blocks `v0.2.0` to prod]: the promote path
  (`docs/environments.md`) deploys only DB+FE. Add `supabase functions deploy agent-chat compose-view` +
  set the prod `ANTHROPIC_API_KEY` secret (`supabase secrets set`, once). Without it a prod with the agent
  panel calls a missing endpoint. Runbook + local-dev already documented in `docs/environments.md` → Edge Functions.
- **Local edge-function dev enablement** [Low, done — scaffolding]: `supabase/functions/.env.example` +
  the `functions serve` runbook (`docs/environments.md`). Live end-to-end agent testing needs a **local
  session** (this container has `[edge_runtime] enabled=false` + no `deno.land`/API key). Not automatable here.
- **`release-please` automation** [Low, ADR-0042 adoption]: GitHub Action on `main` to maintain
  `CHANGELOG.md` + compute the next `vX.Y.Z` from Conventional Commits, so the version is never hand-argued.
- **`VITE_APP_VERSION` in-app surfacing** [Low, ADR-0042 adoption]: inline the version at build, show it
  next to `<EnvBadge>` (`vX.Y.Z · <sha>`) so a running instance reports exactly what it is.

### Deferred-debt ledger from the 2026-06-14 `dev` burst (fold in before promote where noted)
- **Procurement attachments — 2 LOW pgTAP regression assertions** [Low, security-acked on #94]: add (a) an explicit
  `org_id=B` override-insert test (caller in org A supplies `org_id=B` → expect `42501` from WITH CHECK) and (b) an
  anon-read=0 assertion on the three `procurement_*_files` metadata tables. Code is provably safe (stamp-trigger guard
  mirrors 0015 + force-RLS); these only pin the regression. **Migration 0028 is unshipped to prod — fold in before promote.**
- **Projects xlsx Export opt-in** [Low]: the Export button was wired to Companies/Incidents/Procurement/SalesPipeline but
  **deliberately skipped on `pages/Projects.tsx`** (collision-avoidance with the Calendar/Kanban view-mode stream). Add the
  one-line `<ExportButton entity=…>` to the Projects toolbar now that those merged.
- ~~**B-MIN-1 noun consistency**~~ — **RESOLVED by CW-1** (one noun "Project" + one create-verb, coherence wave).
- **Detail-page metric-tile strip clips a tile @390** [Low, pre-existing]: project/procurement detail metric tiles render
  as a horizontal-scroll strip with the right-edge tile cut (no page overflow, no content loss). Pre-existing; surfaced by
  Wave-0 audit, outside its scope.
- **S-Curve actual model = single as-of-today point** (OBS-SC-001 / ADR-0025) [Low, by design]: no per-date actual history
  exists; a future `project_milestones.completed_on` (or progress-history) migration upgrades the actual to a stepped curve
  with **no FE rewrite** (`buildSCurve` already consumes a `{date, cumulativePct}` list).
- **Procurement attachments v1 scope** [Low]: quotation/GR/VI phases only; **PR/PO-header attachments + legacy
  `procurement_quotations.file_url` backfill** deferred (ADR-0023).
- **Kanban status-dot color reuse** [Minor]: Won + Close Out share the green status dot (disambiguated by label) — assign
  distinct DESIGN.md status tokens.
- **Coherence wave minor follow-up** [Low]: two residuals to land in a follow-up PR — sticky action zone + procurement
  header Edit button; "No deals in <stage>" → "No projects" copy leak.
- **Pre-existing TZ flake** [Low, known]: `src/lib/db/procurementLifecycle.test.ts` AC-803 fails under a behind-UTC TZ
  (e.g. UTC-8 local); passes in CI/UTC. Fix: use UTC-fixed date construction in the test.

### ⚑ TEST + BRANCH INFRA UNDER PARALLEL AGENTS (2026-07-22, Director — evidence from the M365 session)
**Why this is its own track:** the repo went from a handful of worktrees to **~15 concurrent agent worktrees**
during one session. Every item below cost real time, produced a *false* signal (a green that lied or a red that
lied), and **will recur** — they are all consequences of parallelism, not of any one branch. Ordered by how
badly each misleads.

> **STATUS 2026-07-22 (branch `chore/test-infra-parallelism`).** Shipped: **T1 complete**
> (`check-migration-collisions.sh` CI gate already existed; **`scripts/renumber-migration.sh`** added —
> auto-rewrites filename-form refs, **hard-fails if the sweep silently no-ops**, lists bare-form refs for
> manual review rather than corrupting unrelated 4-digit numbers) · **T2** (**`scripts/with-test-lock.sh`** —
> a machine-global lock so only one full vitest suite runs at a time; the three lock wrappers now share
> **`scripts/lib/flock-run.sh`** instead of being three copies, with a documented **`erpnext → db → test`**
> acquisition order) · **T4** (**`scripts/supabase-start-lean.sh`**) · **T3 mitigation only** — the chained
> one-hold recipe is now the documented default in CLAUDE.md.
> Proof: `node --test scripts/parallel-infra.test.mjs` (8 tests), **mutation-checked in both directions** —
> swapping `LOCK_EX`→`LOCK_SH` makes the serialisation test interleave, and sabotaging the sed sweep makes
> the renumber guard fail.
>
> **STILL OPEN — T3's real fix: give each worktree its OWN database** (per-worktree Supabase port/project id).
> The lock only *serialises* access to one shared Postgres; it cannot stop schema drift between two agents'
> resets. That single change retires T3 outright and takes most of T2's pressure with it. Deliberately out of
> scope here — it is an environment change affecting every agent at once.
> **T5/T6 stay as written**: they are judgement lessons (verify-by-content-diff; the zsh no-op sweep) — though
> T6's trap is now encoded in `renumber-migration.sh` rather than left to memory.
>
> **Cross-family review (gpt-5.6-luna, `--thinking max`, 2026-07-22) — no Criticals; 3 confirmed defects FIXED:**
> (a) the sweep matched the bare prefix `NNNN_`, so renumbering migration 0052 would have rewritten **7
> unrelated `supabase/tests/0052_*.test.sql`** references — prefix reuse in pgTAP is *deliberate and tolerated*.
> It now matches the full basename `NNNN_<slug>`. (b) `git mv` staged the rename while the `sed` edits stayed
> **unstaged**, so a plain `git commit` shipped a half-applied renumber; everything is staged now. (c)
> `supabase-start-lean.sh` was committed non-executable. Both (a) and (b) have regression tests, each
> mutation-checked. Also: the documented lock order was **flipped to `erpnext → db → test`** to match the live
> P3c runbooks, which already nest erpnext outermost — a documented order that contradicts real call sites is a
> deadlock waiting to happen. The infra tests now run in CI's `verify` job.
>
> **Accepted / still open from that review:** bare `npm run verify` stays lock-free (CI is a single dedicated
> runner); **`npm run verify:locked` is the shared-machine entry point**, so the lock is opt-in *by design* and
> relies on agents following CLAUDE.md · the renumber remote-safety check is prefix-based, so it can
> false-refuse when another branch holds the same prefix (override `RENUMBER_FORCE=1`) and cannot detect a
> migration applied only to a local DB · the lock tests use fixed 150/300 ms settle waits, which could flake
> under extreme load · `with-erpnext-lock.sh` and `supabase-start-lean.sh` have no direct test coverage.

- **T1 — `MERGEABLE`/`CLEAN` does NOT catch migration-number collisions** [High, BURNED US TWICE].
  Git compares *filenames*, so two branches adding `0104_a.sql` and `0104_b.sql` merge "cleanly" and leave
  duplicate numeric prefixes in `supabase/migrations/`. Hit twice in one session: M365 vs dev's ERPNext
  (`0096–0103`), then M365 vs the merged H4 grants work (`0104`/`0105`) — GitHub reported CLEAN throughout
  **both** times. Detection today is a manual command; it should be a **CI gate on every PR that adds a
  migration**:
  `ls supabase/migrations | sed -E 's/^([0-9]{4})_.*/\1/' | sort | uniq -d` → fail if non-empty.
  (Note pgTAP duplicates are tolerated — `0034/0052/0066` pre-exist — because test files have no ordering
  semantics. Migrations do. Gate migrations only.)
  **Bonus fix:** renumbering is currently hand-rolled `git mv` + a cross-reference sweep (comments cite
  migrations by number, and a stale reference in a *reversibility* note actively misleads a rollback). A
  `scripts/renumber-migration.sh` would make this safe and repeatable.
- **T2 — the unit suite is not parallel-safe: 5s timeouts + a shared machine** [High, recurring, produces
  FALSE REDs]. `npm run verify` is ~5,400 tests with 5s per-test timeouts. When another worktree runs vitest
  concurrently, **unrelated** tests fail on timeout — observed 4× in one session, a *different* test set each
  time (`authFloorAnalytics`+`PanelEditorForm`, then `ProjectFormModal`, then `Companies.pushRouting`+
  `authFloorAnalytics`), **every one passing in isolation**, with run timings blowing out to
  `environment 1541s / import 1774s`. The tell that it is contention and not a regression: **a real regression
  fails the same test deterministically; contention moves.** Options: raise the timeout for render-heavy
  jsdom tests, cap `poolOptions` threads, or (best) a machine-level **test lock** mirroring
  `scripts/with-db-lock.sh` so only one full suite runs at a time. Until then the rule is: *re-run the named
  failures in isolation before believing them* — and CI on a clean runner is the authoritative answer.
- **T3 — the shared local Supabase DB can drift mid-run even under the lock** [High, produces FALSE REDs
  *and* FALSE GREENs]. `with-db-lock.sh` serialises commands, but a reset in worktree A between worktree B's
  `db reset` and its `supabase test db` leaves B testing a **different schema than it migrated**. Observed:
  the grants agent's suite failed against a schema missing its own migration (82 aborted tests) and passed
  once re-run as a single lock hold. Mitigations: always chain as ONE hold —
  `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db'` (make this the documented
  default everywhere, incl. CLAUDE.md) — and longer-term give each worktree its **own DB** (per-worktree
  port/project) so agents stop sharing one Postgres at all. That single change would retire T3 outright.
- **T4 — heavy concurrent runs OOM the machine** [Medium]. A full `verify` + a pi build + other worktrees'
  vitest exhausted RAM and killed the session mid-build (work was recovered from disk, uncommitted). Related:
  the Supabase stack's `analytics`/`vector` containers wedge under load and block `db reset`; the reliable
  recovery is `supabase stop` then
  `supabase start -x vector,imgproxy,studio,realtime,logflare,supavisor` (worth documenting, or excluding
  those containers locally by default since CI already skips them).
- **T5 — stale worktrees/branches accumulate silently** [Medium]. Squash-merges leave branches looking
  "unmerged", so dead and live work are indistinguishable at a glance; two 12-day-old local-only ClickUp
  branches sat around until audited (both superseded — see the Slice E/F notes in
  `docs/plans/2026-07-10-clickup-adapter.md`). **Never delete on appearance:** verify by *content diff* and
  check each branch-only line, not line counts — line counts would have reached the right answer by luck
  and would have missed genuinely dropped work. A periodic `git worktree prune` + a "verify-then-delete"
  checklist would keep this cheap.
- **T6 — a `sed`/glob loop that silently does nothing** [Low, but it faked a clean result]. In zsh an
  unquoted file-list variable does not word-split, so `for f in $FILES; sed -i '' … "$f"` passed the whole
  list as one filename ("File name too long") and changed **nothing** — while the follow-up grep, mangled the
  same way, reported "clean". Use `while IFS= read -r f; do … done < filelist` for repo-wide sweeps, and
  always re-grep for the *old* value afterwards to prove the rewrite happened.

### ⚑ PER-USER CREDIT ALLOCATION (owner decision 2026-07-24) — NOT BUILT, needs its own slice
**The three-layer credit model, settled. The boundary between layers is what keeps revenue safe:**

| # | Layer | Who | Effect on the org total | Status |
|---|---|---|---|---|
| 1 | **Grant** credits to the org pool | **Operator** | **increases** it | ✅ built (ADR-0049 §3) |
| 2 | **Allocate** the pool among users | **org-Admin** | **cannot change** it | ⏸️ **this item** |
| 3 | **Buy** more credit | org-Admin | increases it | 🔮 deferred (owner: "future feature later") |

**Why layer 2 is safe when layer 3 is not.** ADR-0049 §3 flipped `credits` INSERT from
`auth_role()='Admin'` → `is_operator()` as an explicit **revenue-hole fix**: any client org-Admin
could previously mint credits of any amount. Allocation *divides* an amount the Operator already
granted and can never raise the org total, so it does not reopen that hole. **When layer 3 (buying)
arrives it MUST go through a payment flow — never a raw `credits` INSERT, and never by relaxing the
layer-1 RLS.** That relaxation is exactly the defect ADR-0049 closed; do not undo it.

**What must be built (none exists — ADR-0049 §2 explicitly dropped per-user balances):**
1. A per-user allocation record (org- + `user_id`-scoped), Admin-writable within their own org only.
2. The invariant **`Σ allocations ≤ org pool balance`**, enforced **in the database** (CHECK/trigger
   or a security-definer RPC, not FE validation). Concurrent allocations must not oversubscribe the
   pool — the same TOCTOU class the M365 write-guard hit, so it needs a row lock and a **two-session
   probe** (pgTAP runs in ONE transaction and cannot express a race).
3. Metering (`creditRateGuard`) checks the **user's allocation** on top of the org ceiling, without
   regressing the org-level cap (ADR-0049 §3 changed `check(userId)` → `check(orgId)`).
4. UI: `AdministrationCredits` gains an Admin allocation surface. Grant stays Operator-only.
5. FE `can()` gating is **UX only**; RLS is the authority (ADR-0016).

**Do this as a proper slice** — spec → plan → TDD → 3 reviewers. Money path touching RLS + metering,
the category that earned 4 adversarial rounds on M365 token custody. **2026-07-24 lesson: every M365
defect passed happy-path pgTAP AND full verify — and three tests actively asserted the bug as the
contract. Tests alone would have shipped all of them.**

**Operator vs org-Admin surface split (as-built + owner-directed 2026-07-24 — verified in code):**
| Surface | Operator | org-Admin |
|---|---|---|
| Assistant cost / usage | ✅ all orgs | ❌ **hidden — not rendered, not even fetched** (`useUsage`/`useAgentRunStats` gate on `isOperator`) |
| Features / entitlements | ✅ write (toggles) | ❌ **hidden** (panel gated on `isOperator`; `org_features` SELECT stays widened for `useFeature()`) |
| Credits | ✅ "Grant credits" | 👁 read-only balance (+ allocation, once built) |
| M365 connect | ✅ | ❌ (ADR-0063 §3 — vendor owns the Entra app) |
| ClickUp / ERPNext connect | ✅ | ✅ own org (client supplies the credential) |

The rule that generates the last two rows: **whoever owns the credential owns the activation switch.**
> ⚠️ **Server-enforcement follow-up (own item):** the Usage/Features hiding above is **UX only** —
> `org_usage_summary()` remains callable by any org member. If "org-Admin never sees platform cost"
> must hold against a determined Admin with devtools, the usage RPCs need an `is_operator()` gate.

### Standing debt
- **Signed-URL TTL hardening** [Medium, owner-acked on #78] — client can mint long-TTL download URLs; move
  signing to a server/Edge Function with a hard max TTL. Own issue.
- ~~**Prod migration push**~~ — **DONE 2026-06-13** (0024–0027 applied to prod; `production` promoted; FE redeployed).
- ~~**At-risk classification consolidation**~~ — **DONE (PR #82).** One shared rule in `dashboardConstants`
  (private predicate; `isAtRisk`/`isAtRiskByCommitted` delegate), all surfaces (PMDashboard/Projects/OverviewTab)
  call it; server `projects_at_risk` reconciled `>`→`>=` via new migration 0027 (0009 untouched); dead
  `calculatedPct` prop removed; pgTAP 0069 drift-guard pins the three committed-spend definitions in agreement;
  fixed a latent bug (PMDashboard counted inactive projects as at-risk). `budgetUtilPct` dead export left
  (unrelated pre-existing). Reviewed SHIP; 2214 unit + 459 pgTAP green.
- **Vite 8 upgrade (real esbuild remediation)** [Medium, from PR #80] — esbuild GHSA-gv7w-rqvm-qjhr (build-time
  devDep, not shipped) has no in-range fix; the blocking CI audit was scoped to prod deps (`--omit=dev`, clean)
  with a non-blocking full audit (`.github/workflows/ci.yml`). The actual patch is the Vite 6→8 major (moves to
  patched esbuild); requires the legacy-browser-target check (esbuild 0.28 dropped destructuring downlevel for
  chrome87/safari14). Own track.
- **e2e mutation-spec isolation** [Minor→Medium, recurring] — mutation specs (AC-PROC-001 just flaked in CI with
  a strict-mode duplicate; AC-DEL-022 hit it too; prior AC-1011/AC-816/AC-911) create rows that persist across
  Playwright *retries* on the shared DB → duplicate-element / dirty-precondition failures on retry. Harden with
  dedicated per-spec seed rows / unique-named fixtures (the P011/P013 pattern) so a flaked attempt-1 doesn't
  poison the retry.
- **Document query-key consistency** [Minor] — document React-Query keys are project-only (pre-existing
  across all document hooks); align to the org-scoped key convention in a consistency pass.
- **Per-role sub-dashboards real data (OD-D3)** — Engineer/PM/Finance views still carry some hard-coded
  figures; wire to real per-role queries.
- **Auth prod cutover** — email confirmations + real SMTP; `site_url`/redirect allowlist to HTTPS prod only;
  replace dev seed password; `auto_expose_new_tables=false`. (Cloud is demo/staging-grade today.)
- **JWT role fast-path** — `auth_role()` reads `profiles.role` (authoritative); re-introducing an
  `app_metadata.role` JWT claim needs GoTrue signing + an audited sync trigger.
- **Transition-map drift guard** — `transition_procurement`'s SQL legal-map/role-matrix and
  `procurementLifecycle.ts` (TS, cosmetic) are hand-maintained duplicates; add a sync test before the
  matrix grows.
- **SQL helper extraction** — dashboard on-hand/pipeline status-set literals duplicated across the 3 RPCs in
  `0009_dashboard_margin.sql`; extract a shared helper before the taxonomy changes.
- **e2e seed-coupling** — a few mutation specs (AC-1011/AC-816/AC-911) share seeded entities → can fail in
  some *local* full-suite orderings (CI passes); harden with dedicated per-spec seed rows (the P011 pattern).
- **Shared `<ListState>`** — loading/empty/error markup duplicated across list pages; extract + memoize
  list filters consistently. Minor.
- **Admin user disable/invite** — needs a `profiles` status column + server-side Supabase auth-admin API.
- **Monitoring** (Sentry/uptime) — deferred. Optional CF API token in op vault `AS` for non-interactive CI.
- **Automated a11y gate (charter Gap 4)** [Medium] — WCAG-AA is a charter DoD but enforced only by the
  manual design-review 4-lens battery (review-time). No `axe-core` in CI/e2e, so a11y regressions between
  reviews can slip. Add axe assertions at the e2e/component layer as a regression net. (Charter Gaps 1–3
  closed: coverage gate now CI-enforced via `scripts/changed-lines-coverage.mjs`; Part B synced to
  3-reviewer + twice-design-review; DB-index review assigned to code-quality.)
- **Lens D — Product / Intent (JTBD) codified + first pass run, 2026-06-14** — `docs/jtbd.md` is the
  role × job-story oracle (Lens D grades every FE screen against it); wired into
  `docs/design-workflow.md` §2.3(d), `design-reviewer` agent, `docs/director-playbook.md` intake hook,
  `DESIGN.md` §7, and Part C of `docs/product-expectations.md`. **(b) DONE:** the dual-substrate
  (Opus + gpt-5.4) JTBD walkthrough on `dev` → [`docs/reviews/2026-06-14-jtbd-walkthrough.md`](reviews/2026-06-14-jtbd-walkthrough.md):
  3 anchors re-confirmed (a HOLDS·Critical, b HOLDS, c PARTIALLY-RESOLVED+re-appears-pre-win), **9
  confirmed intent gaps** (1 Crit / 6 Imp / 2 Min) clustering in 2 classes (dead-display, preview-asymmetry).
- **✅ intent-fix wave — DELIVERED** (branch `intent-fix-wave` → PR to `main`, 2026-06-14; plan
  `docs/plans/2026-06-14-intent-fix-wave.md`). Closed **all 9 JTBD gaps + all 3 anchors** (render-verified):
  (1) procurement **preview-in-place** in `/approvals` (the Critical — inline budget preview + Approve/Reject,
  no drill-in); (2) **dead-display sweep** (exec BvA rows + at-risk link, calendar milestone chips,
  S-curve→tabs + overdue lever); (3) **pre-win record layout** (sales levers first, S-curve hidden pre-win);
  (4) company-detail related objects + My-Tasks urgency/log-time; (5) **seed** contacts+activity.
  Gap #8 (incident→project link) deferred — needs a `project_id` FK (schema), tracked below.
  Full battery: spec ✅ · security ✅ (RPC+RLS authority intact) · code-quality ✅ (incl. new
  `procurements_vendor_idx`, **migration 0031**) · rendered Lens-D ✅. **All review Minors fixed (none backlogged)**
  per owner directive. 10 commits, gates green (2721 tests).
- **✅ Wave-0 mobile audit (`review/mobile-audit/`) — RECONCILED + CLOSED, 2026-06-14.** 13/18 findings FIXED
  (render-verified @390), 2 SUPERSEDED by the coherence wave (noun-soup, approvals-duplication), 2 adjudicated
  non-defects (A-MIN-3, B-MIN-2). The 3 that were "outstanding": **A-MIN-1** (Projects no-op view-toggle
  visible @390 — a cw5 regression masked by a class-string-only test) **FIXED** in the intent-fix wave
  (wrapperClassName + test hardened to computed-visibility); **A-MIN-2** (kanban first-scroll affordance)
  **ADDED** (owner ruling); **B-IMP-3** (timesheet approve confirm on mobile) **kept by design** (owner
  ruling — consistent with procurement approvals + SoD gravity; thumb-zone already fixed by S5). Ledger now zero-open.
- **▶ Deferred (small, tracked):** gap #8 — link an incident's `location`/project to `/projects/:id` needs an
  `incident_reports.project_id` FK + migration; do as a tiny schema issue when convenient.

## Run locally
- One-time: `claude plugin install superpowers@claude-plugins-official --scope project`;
  `scripts/vendor-skills.sh` (vendored skills, gitignored); `cd pmo-portal && npm install`;
  `npx playwright install chromium`.
- Backend: `supabase start && supabase db reset` (seeds professional-services data + credentialed users,
  password `Passw0rd!dev`). Put the printed URL/anon key in `pmo-portal/.env.local`.
- App: `cd pmo-portal && npm run dev`. Gates: `npm run typecheck` · `npm run lint:ci` · `npm test` ·
  `npm run build` · `npx playwright test` (stack up, from `pmo-portal/`) · `supabase test db` (pgTAP).
- **Parallel-worktree caution:** one shared local Supabase stack — serialize DB-driving work; `db reset`
  between an e2e run and pgTAP. See `docs/environments.md` "Local stack hygiene".
- **Worktree e2e caution:** worktrees lack `.env.local` (gitignored) — copy it from the main checkout and
  use a fresh port to avoid auth failures.
