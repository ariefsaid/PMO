# PostHog for operations and product demos — implementation plan

Issue #1532. Spec: `docs/specs/posthog-operations.spec.md` (prefix `PHO`; signed off, Director answers in the spec §0).
Plan date 2026-10-31. Planned against `origin/dev` `1ccadb793`. Migration policy: **none needed** (NFR-PHO-MIG-001); last shipped is 0409.

> **Brief mismatch, noted once.** The brief says `gh issue view 1471`. #1471 is "billing vs other billing"
> (a different build). This plan follows #1532 and its spec; #1532 has no decision tickets.

> **Public repo.** Nothing here names a credential value, vault item or hostname. Vendor-documented variable
> names already present in tracked code (`POSTHOG_PROJECT_KEY`, `POSTHOG_HOST`, `POSTHOG_API_KEY`,
> `POSTHOG_PROJECT_ID`) may be reused. Anything new goes in the Director's private memory.

---

## 0. Open questions (for the Director; each has the default the builders take)

**Director, 2026-10-31 — owner rulings override spec defaults.** The owner's two comments on #1532 (2026-10-31) are binding and widen the spec:
- **S1 AI traces is first** and grows to: one trace per run (chat assistant + agent dispatcher, every model call and tool step); **demo org captures prompt and response text** linked to the session replay; real orgs numbers only; thumbs feedback attached to its trace; **online evaluations** on real traces (LLM judge: "picked the right tool", "answered the question" — judge model must not be a Claude model via OpenRouter); dashboard incl. **cost per user** (opaque user id, and the server event honours the user's analytics opt-out via a flag the client sends; update `/privacy`); alert on assistant error rate or daily cost over a threshold. This replaces OQ-2 / OQ-7 for the demo org.
- **New slice S9 feedback + surveys** (owner comment 2): always-available PostHog feedback widget (user-initiated, linked to replay and, in the assistant, to the trace); thumbs-down asks one optional "what went wrong?"; at most one survey per user per 30 days, never during a write/form, never in the first week; first-core-flow 1–5 question and quarterly NPS for active users; answers carry no record contents; demo org on, real orgs Admin can switch off; dashboard next to usage and AI quality. The S9 builder writes its task list into this plan first. Replaces OQ-6.
- OQ-P1 resolved by the two bullets above. **OQ-P2:** zero bound orgs → `status: skipped` (standalone is legitimate, ADR-0094), never `failed`. OQ-P3..P10: defaults taken. S8 flags still held.

| # | Question | Default taken |
|---|---|---|
| **OQ-P1** | **Owner's #1532 comments are wider than the signed spec.** Comment 1 (AI first) adds: prompt/response text for the **demo org**, an **online LLM-judge** eval, a **cost/error-rate alert**, per-user cost. Comment 2 adds: a feedback widget, a "what went wrong?" follow-up, **surveys** (1 per 30 days, NPS). The spec rules prompt text out (OQ-7), per-user out (OQ-2), surveys out (OQ-6). | Plan **the spec as signed** (S1–S7). Not planned: demo-org text capture, online evals, surveys, feedback widget. Each needs its own spec + privacy review; file as follow-ups. The AI cost/error **alert** *is* covered: S1 runbook configures it as a PostHog trend alert (§S1-T9). |
| **OQ-P2** | **`erpnext-sweep` with zero bound orgs.** AC-PHO-021 says "no bound orgs → `failed`". A deployment with no ERP (standalone, ADR-0094) legitimately has none and ticks every minute → permanent failure signal. | Follow the spec: zero orgs → `status: failed`, `error_code: NO_ORGS_BOUND`. The **alert** for `erpnext-sweep` is only configured on environments that have an ERP binding (runbook step). Dashboard shows `org_count` so the cause is visible. |
| **OQ-P3** | **Source-map upload credential names.** NFR-PHO-SEC-001: no new credential name in the repo. The upload tool (PostHog's own CLI) reads its own documented variables. | The build script writes the **vendor-documented CLI variable names** only (an interface of a third-party tool, no value, no vault path). The key itself is set in the Cloudflare Pages build settings by the owner. Confirm in S2-T1; if the CLI needs more than key + project id, stop and ask. |
| **OQ-P4** | **FR-PHO-024 asks `job_run` to carry held / quarantined counts.** `ReconcileOrgOutboxResult` (`erpnext-sweep/index.ts:~498`) returns only `{reconciled, errors}`; the held/quarantined transitions happen deep in `dispatchMoneyWrite`, not in the sweep. Counting them in the job would need a second DB query per minute tick or a cross-slice counter. | `job_run` for `erpnext-sweep` carries `recovered` (Σ reconciled), `reconcile_errors` (Σ errors) and `org_error_count`. **Held / quarantined are counted from the S4 `erp_push_outcome` stream** (dashboard FR-PHO-034 already shows them). Ask to amend FR-PHO-024 to say so. |
| **OQ-P5** | **Test layer for the agent-chat ACs.** Spec §6 labels AC-PHO-001..004 as `[D]` (Deno). Every existing agent-chat **handler** test is Vitest (`pmo-portal/src/lib/agent/handlerCredits.test.ts` imports `supabase/functions/agent-chat/handler` and a `Deno` stub is the shipped pattern, `pmo-portal/src/lib/agent/posthogError.test.ts`). There is no Deno harness for the handler. | Own AC-PHO-001..004 in **Vitest against the shipped handler + mocked `globalThis.fetch`** (same ADR-0010 rule: real handler, no DI). Deno stays the layer for job and outbox tests (those functions already have Deno suites). |
| **OQ-P6** | **Strict mode for the server allowlist.** "Dropped in prod, thrown in test" needs a way to tell. Inventing an env var is exactly what NFR-PHO-SEC-001 discourages. | `sanitizeServerProps(event, props, strict)` takes `strict` as an argument; `emitServerEvent` passes `strict = (Deno global absent)`, i.e. true under Vitest, false on the edge. Deno tests pass `{ strict: true }` through the same option. No env var. |
| **OQ-P7** | **`EdgeRuntime.waitUntil`.** Supabase Edge exposes `EdgeRuntime.waitUntil(promise)` to keep a fire-and-forget fetch alive after the response is sent. The shipped `capturePosthogException` uses a bare floating promise. | Emitter registers its promise with `waitUntil` when present (a strict improvement, no behaviour change otherwise). **Confirm at S0-T2** against the live runtime docs; if absent in this deployment keep the floating promise. |
| **OQ-P8** | **ADR number.** Highest ADR on `dev` is 0095; no other branch claims 0096. | ADR-0096, `docs/adr/0096-server-operational-telemetry-vs-consent-gated-analytics.md`. `npm run check:adrs` verifies. |
| **OQ-P9** | **Where does the S2 fire-drill run?** The spec says "non-production environment". Cloudflare previews are off and only `production` builds (`docs/environments.md:192-205`); the PostHog project is single. | Run the drill from a **scratch local checkout** with an uncommitted throw in app code, a deploy-style build, and release name `fire-drill-<date>` (S2-T5). Discard afterwards. A standing staging deploy would be a separate infra decision. |
| **OQ-P10** | **S7 only:** the Logs enable switch is a new non-secret env var. | `POSTHOG_LOGS_ENABLED`, unset = off. Confirm the name before S7-T2. |

Other "confirm at build" items from the spec are explicit first tasks: S1-T1 (AI property names), S2-T1 (alerts,
source-map CLI), S4-T1 (quarantine RPC semantics), S6-T1 (funnel filter shape), S7-T1 (Logs allowance).

---

## 1. Facts verified at `origin/dev` (so the builders do not re-derive them)

| Fact | Where (verified by reading) |
|---|---|
| Server forwarder pattern: Deno guard → key → `fetchBounded` → swallow; distinct id `edge:<fn>` | `supabase/functions/_shared/posthogError.ts` |
| Bounded fetch with deadline, default 20 s, 4th arg overrides | `supabase/functions/_shared/fetchWithDeadline.ts` (`fetchBounded`) |
| Error choke point: `logStructuredError` → `capturePosthogException`; `reportEdgeError` fans to console + PostHog + `error_events` | `_shared/errorLog.ts`, `_shared/reportEdgeError.ts` |
| Every function serves through `serveWithErrorReporting(fn, handler)`; it catches, reports, returns 500 | `_shared/serveWithErrorReporting.ts` (`wrapWithErrorReporting`) |
| `EDGE_FUNCTION_NAMES` union (25 names) | `_shared/errorLog.ts` |
| One usage choke inside the agent loop: `recordModelUsage` (3 callers: answer-check, main round, step-cap synthesis) | `supabase/functions/agent-chat/handler.ts:672` (calls at :708, :775, :1213) |
| Tool dispatch sites: parallel reads `:847`, auto-approved write `:1134`, plain read `:1163`, compose branch `:918`, decision continuation `:1754`; helpers `dispatchAction` `:513`, `dispatchActionForced` `:528` | `agent-chat/handler.ts` |
| Terminal status passes through `withPersistence` (`status` events with `completed`/`errored`); `UPSTREAM_ERROR` catch at `:1232` | `agent-chat/handler.ts:~470-504`, `:1232` |
| Automation runs reuse `agentChatHandler` with `usageAction: 'automation'`; agent-dispatch has no model call of its own | `agent-dispatch/dispatcher.ts:521`, `agent-dispatch/index.ts:39` |
| compose-view records usage once, after `composeSpec` resolves, `action: 'compose'` | `supabase/functions/compose-view/handler.ts:198-215` |
| `agent_usage` writer clamps values; `UsageAction = 'chat'|'compose'|'automation'` | `_shared/usage.ts` |
| Five jobs: `erpnext-sweep/index.ts:3231`, `clickup-sweep/index.ts:265`, `clickup-webhook-worker/index.ts:354` (inside `import.meta.main`), `agent-dispatch/index.ts:47`, `telegram-notify/index.ts:174` (inside `import.meta.main`, handler exported) | each `index.ts` |
| Outbox write-backs all go through one factory used by BOTH `adapter-dispatch` and `erpnext-sweep`: `createDbMoneyOutboxDeps` (`confirmOutbox`, `markOutboxHeld`, `markOutboxFailed` return affected-row counts; `quarantineCommitting` returns the row) | `supabase/functions/adapter-dispatch/moneyOutboxDeps.ts:178-325`; callers `adapter-dispatch/index.ts:364`, `erpnext-sweep/index.ts:3533` |
| Outbox failure text is `redactErrorForOutbox` → `"<code>: <message>"` for adapter errors; held reasons are `recovery-probe-failed: …`, `recovery-inconclusive-absence: …`, `recovery-reissue-unauthorized: …` | `pmo-portal/src/lib/adapterSeam/dispatch.ts:228, 346, 377, 417, 468, 561` |
| Browser facade: typed builders → `TrackedEvent`; wrappers in `index.ts`; producer registry `EVENT_PRODUCERS` (`Record<AnalyticsEventName,…>`); `safeTrack`; forbidden-key denylist | `pmo-portal/src/lib/analytics/{events,index,eventCallSites,safeTrack}.ts` |
| Tile ↔ call-site gate parses `provision-dashboards.mjs` text and `eventCallSites.ts` text; unit-tested in Vitest | `scripts/check-dashboard-tiles.mjs`, `pmo-portal/src/lib/analytics/checkDashboardTiles.test.ts` |
| Provisioning script runs `main()` on import, SPEC inline, upsert by name | `scripts/posthog/provision-dashboards.mjs` |
| Quota evaluator fails closed on shape; live-captured fixture has 7 resources (`events`, `exceptions`, `recordings`, `survey_responses`, `ai_credits`, `api_queries_read_bytes`, `workflow_push`) | `scripts/posthog/quota.mjs`, `pmo-portal/src/lib/analytics/quota.test.ts:24-32` |
| Edge-function "wired" gate + its Vitest suite | `scripts/check-edge-fn-error-reporting.mjs`, `pmo-portal/src/lib/agent/checkEdgeFnErrorReporting.test.ts` |
| Test-binding gate lists required handlers | `scripts/check-edge-fn-test-binding.mjs` |
| Deno suites run per function dir; `_shared` run from `erpnext-sweep` cwd; pre-commit runs changed ones | `scripts/deno-test-edge-fns.sh`, `.githooks/pre-commit` |
| Existing Deno tests stub `Deno.serve` before `await import('./index.ts')` | `supabase/functions/erpnext-sweep/moneyCadence.test.ts:1-5` |
| **Front end builds on Cloudflare Pages** (`npm run build`, root `pmo-portal`, only `production` branch builds); git sha already inlined as `__GIT_SHA__` | `docs/environments.md:192-205`, `pmo-portal/vite.config.ts:11-24,151` |
| FE exception path: `analyticsClient.captureException` + `before_send: redactExceptionProperties` | `pmo-portal/src/lib/analytics/client.ts:78-110, 317-325` |
| Feedback control has no `runId` today; `TranscriptItem` renders it with `event.id` and the event has `runId` | `pmo-portal/src/components/panel/FeedbackControl.tsx:25-52`, `TranscriptItem.tsx:80` |
| Business-event success paths: budget `useBudgetMutations().activate` (`src/hooks/useBudget.ts:104`); invoice `submitInvoice` and payment `createPayment` (`src/hooks/useRevenue.ts:145-160, 196-209`); purchase approve via `transition` mutations (`src/hooks/useProcurementDetail.ts:94-103`, `src/components/procurement/ProcurementBlock.tsx:369-375`) | files named |
| Real role for event props: `useEffectiveRole().realRole` | `pmo-portal/src/auth/impersonation.tsx:16` |
| Privacy copy | `pmo-portal/pages/Privacy.tsx:48-66` |
| Opt-out e2e that stays green | `pmo-portal/e2e/AC-CON-003-analytics-opt-out.spec.ts` |

---

## 2. Slice map, ownership and order

```
                       ┌── Q  (quota fixture + fail-closed names)         independent
S0 foundation ─────────┼── S1 AI traces + dashboard ───────────────┐
 (lands FIRST,         ├── S2 alerts + source maps                  │ all disjoint after S0
  small, Director      ├── S3 job health                            │
  reviews)             ├── S4 push outcomes   (money path: ALONE)   │
                       ├── S5 business events ──► S6 demo funnel    │ (S6 merges after S5)
                       └── S7 logs (conditional; T1 is a decision gate)
S8 flags: NOT PLANNED (held, OQ-4).
```

**Why S0 exists.** Five slices would otherwise all edit `provision-dashboards.mjs`, `check-dashboard-tiles.mjs`,
`events.ts`, `eventCallSites.ts`, `analytics/index.ts` and the three docs files. S0 pre-creates one file per slice
for every shared seam; after S0, **no two slices edit the same file** (table below). S0 is ~2 h of work; S1, S2,
S3, S5, S6 builders can branch from the S0 branch, or from `dev` once S0 has merged.

### Shared-file ownership (after S0)

| File | Owner | Others |
|---|---|---|
| `scripts/posthog/provision-dashboards.mjs` (thin CLI) | S0 | read-only |
| `scripts/posthog/provision.mjs`, `queryBuilders.mjs`, `dashboardSpec.mjs` | S0 | read-only |
| `scripts/posthog/spec/ai.mjs` | S1 | |
| `scripts/posthog/spec/jobs.mjs` | S3 | |
| `scripts/posthog/spec/pushes.mjs` | S4 | |
| `scripts/posthog/spec/usage.mjs` | S5 | |
| `scripts/posthog/spec/demo.mjs` | S6 | |
| `scripts/check-dashboard-tiles.mjs`, `pmo-portal/src/lib/analytics/checkDashboardTiles.test.ts` | S0 | read-only |
| `supabase/functions/_shared/serverEventProducers.ts` (registry rows for all server events, **all pre-registered by S0**) | S0 | read-only |
| `supabase/functions/_shared/posthogServer.ts` (generic emitter + per-event allowlists, **all pre-declared by S0**) | S0 | read-only |
| `pmo-portal/src/lib/analytics/events.ts` — `AnalyticsEventName` union (four business names added) | S0 | S1 edits only `buildAgentFeedbackRatedEvent` |
| `pmo-portal/src/lib/analytics/eventCallSites.ts` (four rows added) | S0 | read-only |
| `pmo-portal/src/lib/analytics/index.ts` (one `export * from './business'` line + S1's `trackAgentFeedbackRated`) | S0 / S1 (different lines) | |
| `pmo-portal/src/lib/analytics/business.ts`, `events.business.ts` (new) | S5 | |
| `supabase/functions/agent-chat/handler.ts`, `compose-view/handler.ts`, `agent-chat/aiTelemetry.ts` (new), `_shared/posthogAi.ts` (new) | S1 | |
| `pmo-portal/src/components/panel/{FeedbackControl,TranscriptItem}.tsx` | S1 | |
| `pmo-portal/pages/Privacy.tsx`, `Privacy.test.tsx` | S1 | |
| `supabase/functions/_shared/jobRun.ts` (new), the five job `index.ts` files, `scripts/check-edge-fn-error-reporting.mjs`, `checkEdgeFnErrorReporting.test.ts` | S3 | |
| `supabase/functions/adapter-dispatch/moneyOutboxDeps.ts` (+ new test) | S4 | S4 does **not** touch `erpnext-sweep/index.ts` |
| `pmo-portal/vite.config.ts`, `pmo-portal/package.json` (`postbuild`), `scripts/upload-sourcemaps.mjs` (new), `pmo-portal/src/lib/analytics/client.ts` (release super property) | S2 | |
| `pmo-portal/src/hooks/{useBudget,useRevenue,useProcurementDetail}.ts`, `src/components/procurement/ProcurementBlock.tsx` | S5 | |
| `supabase/functions/_shared/errorLog.ts` (forward hook), `_shared/posthogLogs.ts` (new) | S7 | |
| `scripts/posthog/quota.mjs`, `check-quota.mjs`, `quota.test.ts` | Q | |
| `docs/runbooks/posthog-operations.md` | S0 creates one H2 per slice; each slice edits **only its own H2** | |
| `docs/analytics-events.md`, `docs/posthog-dashboards.md` | S0 creates one H2 per slice; same rule | |

**Dispatch (CLAUDE.md § Operating model).** S0, S1, S2, S3, S5, S6, S7, Q: bounded code → Orca workers
(`docs/orca-dispatch.md`). **S4 is money path: Director-dispatched, alone in its PR, security reviewer, existing
money tests unmodified** (AC-PHO-033). Workers push branches only; Director batches (S1+S2+S3, S5+S6, S7+Q) with
`--no-ff`; S4 ships alone. Docs-only commits (runbook, `docs/*.md`) push direct to `dev`.

**Gate for every slice** (CLAUDE.md local final gate): `npm run check:guards`, `npm run typecheck`,
`npx eslint --max-warnings=0 <touched>`, directly touched vitest files, `bash scripts/deno-typecheck-edge-fns.sh`
when `supabase/functions/**` changed, touched Deno suites via
`(cd supabase/functions/<fn> && deno test . --config deno.json --allow-env --allow-net --allow-read)`.
No migration, so no `with-db-lock.sh`.

---

## 3. Slice S0 — foundation (owner: the S1 builder, first PR)

Goal: make every later slice a disjoint-file change. No behaviour change in the product.

### S0-T1 — Extract the dashboard script into testable modules (AC-PHO-050 groundwork)
Files: create `scripts/posthog/queryBuilders.mjs`, `scripts/posthog/dashboardSpec.mjs`, `scripts/posthog/provision.mjs`;
create empty `scripts/posthog/spec/{ai,jobs,pushes,usage,demo}.mjs`; modify `scripts/posthog/provision-dashboards.mjs`.

1. **Failing test first** — `pmo-portal/src/lib/analytics/provision.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { provision } from '../../../../scripts/posthog/provision.mjs';
import { SPEC } from '../../../../scripts/posthog/dashboardSpec.mjs';

function fakeIo() {
  const dashboards: { id: number; name: string }[] = [];
  const insights: { id: number; name: string }[] = [];
  let next = 1;
  return {
    dashboards, insights,
    io: {
      listDashboards: async () => dashboards.map((d) => ({ ...d, deleted: false })),
      listInsights: async () => insights.map((i) => ({ ...i, deleted: false })),
      createDashboard: async (b: { name: string }) => { const d = { id: next++, name: b.name }; dashboards.push(d); return d; },
      createInsight: async (b: { name: string }) => { const i = { id: next++, name: b.name }; insights.push(i); return i; },
      refreshInsight: async () => undefined,
      log: () => undefined,
    },
  };
}

describe('AC-PHO-050 provision is idempotent', () => {
  it('second run creates nothing', async () => {
    const f = fakeIo();
    const first = await provision(SPEC, f.io);
    expect(first.created.insights).toBeGreaterThan(0);
    const second = await provision(SPEC, f.io);
    expect(second.created).toEqual({ dashboards: 0, insights: 0 });
    expect(second.skipped.insights).toBe(first.created.insights);
  });
  it('two spec entries with one dashboard name share ONE dashboard (S6 adds to the Demo dashboard)', async () => {
    const f = fakeIo();
    const spec = [
      { dashboard: '[PMO] D', description: 'd', insights: [{ name: 'a', query: {} }] },
      { dashboard: '[PMO] D', description: 'd', insights: [{ name: 'b', query: {} }] },
    ];
    await provision(spec, f.io);
    expect(f.dashboards).toHaveLength(1);
    expect(f.insights).toHaveLength(2);
  });
});
```
2. Run `cd pmo-portal && npx vitest run src/lib/analytics/provision.test.ts` → red (module missing).
3. Implement. `queryBuilders.mjs` = the existing `trend` and `funnel` bodies moved verbatim from `provision-dashboards.mjs:62-98`, plus optional `properties` (array of PostHog property filters) on both, passed as `source.properties` when given:
```js
export const DATE_FROM = '-30d';
export function trend(series, { breakdown, interval = 'day', display, properties } = {}) { /* body moved verbatim */ }
export function funnel(events, { interval = 'day', properties, breakdown } = {}) { /* body moved verbatim */ }
```
`NS = '[PMO]'` (provision-dashboards.mjs:100) is exported from `queryBuilders.mjs` so the per-slice fragments import it without a cycle. `dashboardSpec.mjs` = the existing `SPEC` array (provision-dashboards.mjs:101-217, moved verbatim as `LEGACY_SPEC`, importing `NS`), then:
```js
import ai from './spec/ai.mjs';
import jobs from './spec/jobs.mjs';
import pushes from './spec/pushes.mjs';
import usage from './spec/usage.mjs';
import demo from './spec/demo.mjs';
export const SPEC = [...LEGACY_SPEC, ...ai, ...jobs, ...pushes, ...usage, ...demo];
```
Each `spec/*.mjs`: `export default [];` with a header comment naming its owning slice.
`provision.mjs`: `export async function provision(spec, io)` is the existing `main()` body (lines 223-274) with the four `api(...)`/`listAll(...)` calls replaced by `io.*`, returning `{ created, skipped, provisionedIds }`; no `process.exit`. **One fix beyond the move:** after creating a dashboard add `dashByName.set(spec.dashboard, dash);` (the shipped code never did, so a second entry with the same name would create a duplicate dashboard).
`provision-dashboards.mjs` keeps only env validation, `api`, `listAll`, builds the real `io`, calls `provision(SPEC, io)`, then the refresh loop and `View:` line.
4. Green: same vitest command. Also run `node --check scripts/posthog/provision-dashboards.mjs`.
5. Verify the dry shape against the live project **only by the Director** (needs the key): `node scripts/posthog/provision-dashboards.mjs` reports `+0 / =all` (no dashboard changed).

### S0-T2 — Generic server emitter with per-event allowlists (NFR-PHO-PRIV-001/002, REL-001; OQ-P6, OQ-P7)
Files: create `supabase/functions/_shared/posthogServer.ts`; test `pmo-portal/src/lib/agent/posthogServer.test.ts`.

**Confirm first (5 min):** WebFetch Supabase's Edge Functions docs for `EdgeRuntime.waitUntil` (background tasks); record the answer in the S0 PR description. If unavailable, delete the `waitUntil` line below and keep everything else.

1. **Failing test first** (`posthogServer.test.ts`, Vitest, `Deno` stubbed like `posthogError.test.ts`):
```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { emitServerEvent, sanitizeServerProps } from '../../../../supabase/functions/_shared/posthogServer';

type DenoStub = { env: { get(k: string): string | undefined } };
const setDeno = (env: Record<string, string | undefined> | null) => {
  if (env === null) delete (globalThis as { Deno?: DenoStub }).Deno;
  else (globalThis as { Deno?: DenoStub }).Deno = { env: { get: (k) => env[k] } };
};
afterEach(() => { setDeno(null); vi.unstubAllGlobals(); });

describe('sanitizeServerProps (FR-PHO-004 allowlist)', () => {
  it('drops an unknown key when not strict', () => {
    expect(sanitizeServerProps('job_run', { job: 'x', status: 'ok', $ai_input: 'secret' }, false)).toEqual({ job: 'x', status: 'ok' });
  });
  it('throws on an unknown key when strict', () => {
    expect(() => sanitizeServerProps('job_run', { job: 'x', $ai_input: 'secret' }, true)).toThrow(/\$ai_input/);
  });
  it('drops objects, arrays and over-long strings even for allowed keys', () => {
    expect(sanitizeServerProps('job_run', { job: { a: 1 } as never, status: 'x'.repeat(200) }, false)).toEqual({});
  });
});

describe('emitServerEvent', () => {
  it('is a no-op without Deno or key, never fetches', async () => {
    const f = vi.fn(); vi.stubGlobal('fetch', f);
    await emitServerEvent('job_run', 'erpnext-sweep', { job: 'erpnext-sweep', status: 'ok' });
    setDeno({});
    await emitServerEvent('job_run', 'erpnext-sweep', { job: 'erpnext-sweep', status: 'ok' });
    expect(f).not.toHaveBeenCalled();
  });
  it('posts a person-less event with a synthetic distinct id', async () => {
    setDeno({ POSTHOG_PROJECT_KEY: 'phc_test' });
    const f = vi.fn().mockResolvedValue({ ok: true }); vi.stubGlobal('fetch', f);
    await emitServerEvent('job_run', 'erpnext-sweep', { job: 'erpnext-sweep', status: 'ok', items_processed: 3 });
    const body = JSON.parse((f.mock.calls[0][1] as { body: string }).body);
    expect(body).toMatchObject({ event: 'job_run', distinct_id: 'edge:erpnext-sweep' });
    expect(body.properties).toMatchObject({ job: 'erpnext-sweep', items_processed: 3, $process_person_profile: false });
  });
  it('swallows a rejected fetch and a hung fetch (deadline)', async () => {
    setDeno({ POSTHOG_PROJECT_KEY: 'phc_test' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    await expect(emitServerEvent('job_run', 'erpnext-sweep', { job: 'x' })).resolves.toBeUndefined();
    vi.stubGlobal('fetch', vi.fn((_u: string, init: RequestInit) => new Promise((_r, rej) => init.signal?.addEventListener('abort', () => rej(new Error('abort'))))));
    await expect(emitServerEvent('job_run', 'erpnext-sweep', { job: 'x' }, { timeoutMs: 20 })).resolves.toBeUndefined();
  });
});
```
2. Red: `cd pmo-portal && npx vitest run src/lib/agent/posthogServer.test.ts`.
3. Implement `posthogServer.ts`:
```ts
import { fetchBounded } from './fetchWithDeadline.ts';
import type { EdgeFunctionName } from './errorLog.ts';

export type ServerEventName =
  | 'job_run' | 'erp_push_outcome' | '$ai_generation' | '$ai_span' | '$ai_trace';

const COMMON = ['org_id'] as const;
/** The ONLY keys each server event may carry. Owners: S1 `$ai_*`, S3 `job_run`, S4 `erp_push_outcome`. */
export const SERVER_EVENT_ALLOWLIST: Record<ServerEventName, ReadonlySet<string>> = {
  job_run: new Set(['job', 'status', 'items_processed', 'duration_ms', 'error_code', 'org_count',
    'recovered', 'reconcile_errors', 'org_error_count', ...COMMON]),
  erp_push_outcome: new Set(['tier', 'domain', 'operation', 'outcome', 'error_code', 'attempt_count',
    'duration_ms', 'outbox_id', 'needs_human', ...COMMON]),
  $ai_generation: new Set(['$ai_trace_id', '$ai_session_id', '$ai_span_id', '$ai_parent_id', '$ai_model',
    '$ai_provider', '$ai_input_tokens', '$ai_output_tokens', '$ai_total_cost_usd', '$ai_latency',
    '$ai_is_error', '$ai_http_status', 'action', 'cached_tokens', 'reasoning_tokens', 'error_code', ...COMMON]),
  $ai_span: new Set(['$ai_trace_id', '$ai_span_id', '$ai_parent_id', '$ai_span_name', '$ai_latency',
    '$ai_is_error', ...COMMON]),
  $ai_trace: new Set(['$ai_trace_id', '$ai_session_id', '$ai_latency', '$ai_is_error', 'error_code', ...COMMON]),
};

type Prim = string | number | boolean;
const MAX_STRING = 64; // codes, uuids, slugs; anything longer is not a code.

export function sanitizeServerProps(
  event: ServerEventName,
  props: Record<string, unknown>,
  strict: boolean,
): Record<string, Prim> {
  const allowed = SERVER_EVENT_ALLOWLIST[event];
  const out: Record<string, Prim> = {};
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null) continue;
    if (!allowed.has(k)) {
      if (strict) throw new Error(`Server event ${event}: property not allowlisted: ${k}`);
      continue;
    }
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'string' && v.length <= MAX_STRING) out[k] = v;
    else if (strict) throw new Error(`Server event ${event}: unsafe value for ${k}`);
  }
  return out;
}

export interface EmitOptions { timeoutMs?: number; strict?: boolean }

type DenoLike = { env: { get(k: string): string | undefined } };

export function emitServerEvent(
  event: ServerEventName,
  fn: EdgeFunctionName | 'money-outbox',
  props: Record<string, unknown>,
  opts: EmitOptions = {},
): Promise<void> {
  const deno = (globalThis as { Deno?: DenoLike }).Deno;
  // Sanitize FIRST: under Vitest (no Deno) strict is true, so an allowlist breach fails the test
  // even though nothing would be sent.
  const safe = sanitizeServerProps(event, props, opts.strict ?? !deno);
  if (!deno) return Promise.resolve();
  const key = deno.env.get('POSTHOG_PROJECT_KEY');
  if (!key) return Promise.resolve();
  const host = (deno.env.get('POSTHOG_HOST') || 'https://us.i.posthog.com').replace(/\/$/, '');
  const sent = fetchBounded(undefined, `${host}/i/v0/e/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: key,
      event,
      distinct_id: `edge:${fn}`, // synthetic, no user id (OQ-2)
      properties: { ...safe, $process_person_profile: false },
    }),
  }, opts.timeoutMs).then(() => undefined, () => undefined); // fire-and-forget: never rejects
  // ponytail: keeps the send alive after the response; absent runtime => the floating promise stays.
  (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil?.(sent);
  return sent;
}
```
Note `sanitizeServerProps` throwing under `strict` is the only throw path and is reached only before any I/O; `emitServerEvent` callers on the edge never see it (`strict` false).
4. Green: `npx vitest run src/lib/agent/posthogServer.test.ts`. Mutation check: change `strict` branch to `continue` → "throws" test goes red; restore.
5. `bash scripts/deno-typecheck-edge-fns.sh` (new `_shared` file must type-check under Deno).

### S0-T3 — Server-event producer registry + gate extension (NFR-PHO-GATE-001; owns AC-PHO-006 and the gate half of AC-PHO-043)
Files: create `supabase/functions/_shared/serverEventProducers.ts`; modify `scripts/check-dashboard-tiles.mjs`, `pmo-portal/src/lib/analytics/checkDashboardTiles.test.ts`.

1. **Failing tests first** in `checkDashboardTiles.test.ts`:
```ts
import { extractServerRegistry, checkServerEvents } from '../../../../scripts/check-dashboard-tiles.mjs';

describe('AC-PHO-006 server-emitted tiles need a producer call', () => {
  const reg = "  job_run: { producer: 'withJobRun', kind: 'server' },\n  $ai_span: { producer: 'emitAiSpan', kind: 'server' },\n";
  it('parses the registry (including $-prefixed event names)', () => {
    expect([...extractServerRegistry(reg).keys()]).toEqual(['job_run', '$ai_span']);
  });
  it('passes when the producer is called outside _shared', () => {
    expect(checkServerEvents(new Set(['job_run']), extractServerRegistry(reg), 'x = withJobRun(\'a\', h)')).toEqual([]);
  });
  it('fails when the call is removed (mutation: delete an emitter)', () => {
    expect(checkServerEvents(new Set(['job_run']), extractServerRegistry(reg), '// withJobRun is great')).toHaveLength(1);
  });
  it('fails for a tile event in neither registry', () => {
    expect(checkServerEvents(new Set(['nope']), new Map(), '', new Set())).toHaveLength(1);
  });
});
```
2. Red: `npx vitest run src/lib/analytics/checkDashboardTiles.test.ts`.
3. Implement. Registry file (literal shape, one row per line, parsed by regex like `eventCallSites.ts`; **all S1/S3/S4 rows pre-registered here by S0**):
```ts
import type { ServerEventName } from './posthogServer.ts';
export const SERVER_EVENT_PRODUCERS: Record<ServerEventName, { producer: string; kind: 'server' }> = {
  job_run:          { producer: 'withJobRun',             kind: 'server' },
  erp_push_outcome: { producer: 'emitErpPushOutcome',     kind: 'server' },
  $ai_generation:   { producer: 'emitAiGeneration',       kind: 'server' },
  $ai_span:         { producer: 'emitAiSpan',             kind: 'server' },
  $ai_trace:        { producer: 'emitAiTrace',            kind: 'server' },
};
```
In `check-dashboard-tiles.mjs` add (exported, pure):
```js
export function extractServerRegistry(src) {
  const m = new Map();
  for (const x of src.matchAll(/^\s{2}(\$?[a-z0-9_]+):\s*\{\s*producer:\s*'([A-Za-z0-9_]+)',\s*kind:\s*'server'/gm)) m.set(x[1], { producer: x[2], kind: 'server' });
  return m;
}
export function checkServerEvents(tileEvents, serverRegistry, serverSources, browserEvents = new Set()) {
  const failures = [];
  for (const ev of [...tileEvents].sort()) {
    if (browserEvents.has(ev)) continue;
    const entry = serverRegistry.get(ev);
    if (!entry) { failures.push(`tile event '${ev}' is in neither the browser nor the server producer registry`); continue; }
    if (!hasCallSite(serverSources, entry.producer)) failures.push(`tile event '${ev}' has NO server call site: '${entry.producer}(' is never called under supabase/functions/<fn>/`);
  }
  return failures;
}
```
`main()` changes: tile events = `extractTileEvents` over `dashboardSpec.mjs` **plus every `scripts/posthog/spec/*.mjs`** (concatenated text; hard-fail if zero files, same empty-input discipline); an event in the browser registry is checked as today; the rest go to `checkServerEvents` with `serverSources` = every non-test `.ts` under `supabase/functions/*/` **excluding `_shared/`** (so the producer's own definition never satisfies the check; hard-fail on zero files). Keep `isRunAsMain`.
4. Green: the vitest file; then `node scripts/check-dashboard-tiles.mjs` (still green, no new tiles yet).
5. Add to `package.json`? No — `check:dashboard-tiles` already runs it.

### S0-T4 — Pre-register the four business events and the facade seam (AC-PHO-043 groundwork)
Files: modify `pmo-portal/src/lib/analytics/events.ts` (union only), `eventCallSites.ts`, `index.ts` (one line); create `business.ts` stub.

1. **Failing test first** — extend `pmo-portal/src/lib/analytics/events.test.ts`: assert `EVENT_PRODUCERS` has keys `budget_activated`, `invoice_issued`, `payment_recorded`, `purchase_approved` with `kind: 'facade'` and producers `trackBudgetActivated`, `trackInvoiceIssued`, `trackPaymentRecorded`, `trackPurchaseApproved`. Red (`tsc` also red: `Record<AnalyticsEventName,…>` incomplete if the union is extended first — do the union and registry in one commit).
2. Edit: add the four names to `AnalyticsEventName` after `'agent_compose_view_saved'`; add four rows to `EVENT_PRODUCERS`; add `export * from './business';` to `analytics/index.ts` after the existing `export { safeTrack }` line; create `business.ts` containing only `export {};` and a comment "S5 owns this file".
3. Green: `npx vitest run src/lib/analytics/events.test.ts && npm run typecheck`.

### S0-T5 — Docs skeletons (Director pushes direct to `dev`; docs-only)
Create `docs/runbooks/posthog-operations.md` with: purpose paragraph, an **Evidence table** (columns: AC, what was run, date, evidence location — rows AC-PHO-007, 010, 023, 051 empty) and one H2 per slice (`## S1 AI`, `## S2 Alerts and source maps`, `## S3 Jobs`, `## S4 Push outcomes`, `## S5 Business events`, `## S6 Demo funnels`, `## S7 Logs (conditional)`). Append the same per-slice H2s to `docs/analytics-events.md` (under "Operational (server) events" / "Business events") and `docs/posthog-dashboards.md`. Evidence locations are **paths in `docs/private/` or Director memory, never inline screenshots of customer-identifying data** (public repo).

### S0-T6 — ADR-0096
Create `docs/adr/0096-server-operational-telemetry-vs-consent-gated-analytics.md` (context, decision, consequences). Decision text: *two classes*. **Product events**: browser, through the facade, consent-gated (ADR-0067), opt-out and DNT honoured. **Operational events**: server, `emitServerEvent`, key allowlist, no user id, synthetic `edge:<fn>` distinct id, `$process_person_profile: false`, disclosed on `/privacy`, carry codes/counts/durations only. Consequences: server events cannot join to a browser person (by design); PostHog has no row-level security so project membership stays operator-only; the allowlist is the enforcement point. Run `cd pmo-portal && npm run check:adrs`.

### S0-T7 — S0 verify and PR
`npm run check:guards`, `npm run typecheck`, `bash scripts/deno-typecheck-edge-fns.sh`, `npx eslint --max-warnings=0` on touched files, vitest on `provision.test.ts posthogServer.test.ts checkDashboardTiles.test.ts events.test.ts`. Branch `feat/posthog-ops-s0-foundation`; no PR (workers push branches only).

---

## 4. Slice Q — quota evaluation for the new resources (independent; NFR-PHO-QUOTA-002, AC-PHO-080)

Files: `scripts/posthog/check-quota.mjs`, `scripts/posthog/quota.mjs`, `pmo-portal/src/lib/analytics/quota.test.ts`, new `pmo-portal/src/lib/analytics/quota.live.fixture.json`.

- **Q-T1 — Capture the live shape (Director, needs the personal key).** Add `--dump` to `check-quota.mjs`: prints only `Object.entries(payload.limited)` as `{ resource: { limited, usage, limit } }` (numbers and booleans, nothing else) and exits 0; no key, host or id in the output. Director runs it via the existing `op-get.sh` pattern from `docs/posthog-dashboards.md`, saves the output to `quota.live.fixture.json`. *Reason: this script's own history — a fixture invented from docs passed against a shape the API never returned.* Until the Director supplies it, Q-T2 cannot start; S1–S6 do **not** depend on Q.
- **Q-T2 — Failing tests first** in `quota.test.ts` (extend): (a) with the captured fixture, set `events` to 85 % → `exitCode 1` and the line names `events`; same for `exceptions` and `recordings` (the resources S1–S6 consume; AC-PHO-080 first half). (b) A payload with an extra, unrecognised resource key → `exitCode 2` naming it (second half). (c) the fixture itself → `exitCode 0`.
- **Q-T3 — Implement.** In `quota.mjs` add `export const KNOWN_RESOURCES = new Set([...Object.keys(fixture.limited)])` written out as a literal list (same file, with a comment "captured from a live response <date>; add S7/S8 names only after they appear in a live capture"). In `evaluateQuota`, before the loop: any `resource` not in `KNOWN_RESOURCES` → `{ exitCode: 2, lines: ['ERROR: unrecognised quota resource <safeResourceName> — add it to KNOWN_RESOURCES after checking a live response.'] }`. Keep `safeResourceName` on every interpolated name.
- **Q-T4 — Verify.** `npx vitest run src/lib/analytics/quota.test.ts`. **Residual risk, stated:** PostHog adding a resource turns the daily workflow red (exit 2, "could not run") until someone adds the name. That is the spec's chosen fail-closed behaviour; `posthog-quota.yml` already separates exit 2 from the breach banner.

---

## 5. Slice S1 — AI traces, feedback link, dashboard, privacy copy (L; builder: Orca worker, after S0)

Covers FR-PHO-001..008, NFR-PHO-PRIV-002 (copy), AC-PHO-001..007. Reads (not edits): `_shared/usage.ts`,
`_shared/modelClient.ts`. **Design decisions**

- One per-run object, `AiRunTelemetry` (`supabase/functions/agent-chat/aiTelemetry.ts`), created in
  `agentChatHandler` (the outermost function, `handler.ts:1266`) and carried on `deps` as an **internal optional
  field** `deps.ai`. `agentChatHandler` is the only place that sets it, so `runToolLoop`, the decision pass and
  `recordModelUsage` reach it with **no signature churn** (they already receive `deps`).
- Generation emission hooks **inside `recordModelUsage`** (`handler.ts:672`), *before* its early `if (!deps.usage) return`,
  so all three model-call paths (round, answer-check, step-cap synthesis) are covered and emission does not depend on usage deps.
- Spans wrap the four tool-dispatch sites; the terminal `$ai_trace` is emitted by a thin generator wrapper that
  watches `status` events (`completed`|`errored`) exactly like `withPersistence` does.
- Automation runs need **no `agent-dispatch` change**: it runs `agentChatHandler` with `usageAction: 'automation'`
  (`agent-dispatch/dispatcher.ts:521`), so `action` comes from `deps.usageAction ?? 'chat'`.
- Limits, stated: a run that pauses for approval/answer and resumes is two requests; the trace for the resuming
  request has that request's latency. The `compose_view` tool inside agent-chat calls `composeSpec` whose inner model
  calls are not metered into `agent_usage` today (`handler.ts:918`), so they are not emitted either (parity, not a regression).
- `$ai_session_id` = `req.threadId ?? runId`. `$ai_provider` constant `'openrouter'` (`_shared/openRouterModelClient.ts` is the only client).

### S1-T1 — Confirm the PostHog AI property names (spec FR-PHO-001, "builder re-checks")
WebFetch `https://posthog.com/docs/ai-engineering/manual-capture` (and the LLM-analytics events reference it links).
Write a 3-column table (event, property, type) into `docs/runbooks/posthog-operations.md` `## S1 AI` headed
"Verified against live docs <date>". If any name in `SERVER_EVENT_ALLOWLIST` (S0-T2) differs, change the allowlist
and the types in T2 **before coding**; do not leave both names. Also confirm that `$ai_trace` / `$ai_span` accept a
`$ai_span_id` and `$ai_parent_id` as used below. Verify: the table is committed; nothing else.

### S1-T2 — Typed AI emitters (AC-PHO-002)
Files: create `supabase/functions/_shared/posthogAi.ts`; test `pmo-portal/src/lib/agent/posthogAi.test.ts`.

1. **Failing test first** (Vitest; `Deno` stub as in S0-T2):
```ts
import { it, expect, vi, afterEach, describe } from 'vitest';
import { emitAiGeneration } from '../../../../supabase/functions/_shared/posthogAi';
import { emitServerEvent } from '../../../../supabase/functions/_shared/posthogServer';
afterEach(() => { delete (globalThis as { Deno?: unknown }).Deno; vi.unstubAllGlobals(); });
const base = { traceId: 't', spanId: 'g', sessionId: 's', model: 'm', inputTokens: 1, outputTokens: 2, costUsd: 0.01,
  latencySeconds: 0.4, isError: false, httpStatus: 200, action: 'chat' as const, orgId: 'o', cachedTokens: 0, reasoningTokens: 0 };

describe('AC-PHO-002 allowlist, never text', () => {
  it('maps to $ai_* keys and carries no text', async () => {
    (globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => (k === 'POSTHOG_PROJECT_KEY' ? 'phc_x' : undefined) } };
    const f = vi.fn().mockResolvedValue({ ok: true }); vi.stubGlobal('fetch', f);
    await emitAiGeneration('agent-chat', base);
    const p = JSON.parse((f.mock.calls[0][1] as { body: string }).body).properties;
    expect(Object.keys(p).sort()).toEqual([
      '$ai_http_status','$ai_input_tokens','$ai_is_error','$ai_latency','$ai_model','$ai_output_tokens','$ai_provider',
      '$ai_session_id','$ai_span_id','$ai_total_cost_usd','$ai_trace_id','$process_person_profile','action',
      'cached_tokens','org_id','reasoning_tokens'].sort());
  });
  it('a smuggled $ai_input is thrown in test mode (strict) — mutation: loosening the allowlist turns this red', async () => {
    expect(() => emitServerEvent('$ai_generation', 'agent-chat', { $ai_trace_id: 't', $ai_input: 'user text' })).toThrow(/\$ai_input/);
  });
  it('error path carries error_code only, never the provider message', async () => {
    (globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => (k === 'POSTHOG_PROJECT_KEY' ? 'phc_x' : undefined) } };
    const f = vi.fn().mockResolvedValue({ ok: true }); vi.stubGlobal('fetch', f);
    await emitAiGeneration('agent-chat', { ...base, isError: true, httpStatus: 502, errorCode: 'UPSTREAM_ERROR' });
    const p = JSON.parse((f.mock.calls[0][1] as { body: string }).body).properties;
    expect(p.error_code).toBe('UPSTREAM_ERROR');
    expect(JSON.stringify(p)).not.toMatch(/message|user text/);
  });
});
```
`emitServerEvent` runs `sanitizeServerProps` synchronously first, so under Vitest (no `Deno`, strict) it throws at the call; on the edge (`Deno` present) strict is false and the key is dropped silently.
2. Red: `cd pmo-portal && npx vitest run src/lib/agent/posthogAi.test.ts`.
3. Implement `posthogAi.ts`:
```ts
import { emitServerEvent } from './posthogServer.ts';
import type { EdgeFunctionName } from './errorLog.ts';

export const AI_PROVIDER = 'openrouter';
export type AiAction = 'chat' | 'compose' | 'automation';

export interface AiGenerationProps {
  traceId: string; spanId: string; sessionId?: string; model: string;
  inputTokens: number; outputTokens: number; costUsd: number; latencySeconds: number;
  isError: boolean; httpStatus: number; action: AiAction; orgId: string;
  cachedTokens?: number; reasoningTokens?: number; errorCode?: string;
}
export async function emitAiGeneration(fn: EdgeFunctionName, p: AiGenerationProps): Promise<void> {
  return emitServerEvent('$ai_generation', fn, {
    $ai_trace_id: p.traceId, $ai_span_id: p.spanId, $ai_session_id: p.sessionId, $ai_model: p.model,
    $ai_provider: AI_PROVIDER, $ai_input_tokens: p.inputTokens, $ai_output_tokens: p.outputTokens,
    $ai_total_cost_usd: p.costUsd, $ai_latency: p.latencySeconds, $ai_is_error: p.isError,
    $ai_http_status: p.httpStatus, action: p.action, org_id: p.orgId,
    cached_tokens: p.cachedTokens, reasoning_tokens: p.reasoningTokens, error_code: p.errorCode,
  });
}
```
In the strict-mode test above an unknown key is pushed through `emitServerEvent('$ai_generation', 'agent-chat', { …, $ai_input: 'x' })` directly, because the typed function cannot express it.
Also `emitAiSpan(fn, { traceId, spanId, parentId?, name, latencySeconds, isError, orgId })` → `$ai_span` with `$ai_span_name: name`, and `emitAiTrace(fn, { traceId, sessionId?, latencySeconds, isError, errorCode?, orgId })` → `$ai_trace`.
4. Green: the vitest file. Mutation check (record in PR): add `'$ai_input'` to the `$ai_generation` allowlist → the strict test goes red; revert.

### S1-T3 — Per-run telemetry object
Files: create `supabase/functions/agent-chat/aiTelemetry.ts`; test inside `handlerAiTelemetry.test.ts` (T4).
```ts
import { clampUsageValue } from '../_shared/usage.ts';
import { emitAiGeneration, emitAiSpan, emitAiTrace, type AiAction } from '../_shared/posthogAi.ts';

export interface AiRunTelemetry {
  setOrg(orgId: string): void;
  /** Returns the generation id so the next tool spans can name it as their parent. */
  generation(resp: { model: string; usage?: Record<string, unknown> }, latencyMs: number, err?: { code: string; status: number }): void;
  span(toolName: string, latencyMs: number, isError: boolean): void;
  trace(status: 'completed' | 'errored', errorCode?: string): void;
}

export function createAiRunTelemetry(ctx: { runId: string; threadId?: string; action: AiAction }): AiRunTelemetry {
  let orgId = '';
  let lastGeneration: string | undefined;
  const startedAt = Date.now();
  const fire = (p: Promise<unknown>) => { void p.catch(() => undefined); }; // tight try/catch: never reaches the call site
  return {
    setOrg: (o) => { orgId = o; },
    generation(resp, latencyMs, err) {
      if (!orgId) return;
      const spanId = crypto.randomUUID();
      lastGeneration = spanId;
      const u = resp.usage ?? {};
      fire(emitAiGeneration('agent-chat', {
        traceId: ctx.runId, spanId, sessionId: ctx.threadId ?? ctx.runId, model: resp.model,
        inputTokens: clampUsageValue(u.prompt_tokens), outputTokens: clampUsageValue(u.completion_tokens),
        costUsd: clampUsageValue(u.total_cost), latencySeconds: latencyMs / 1000,
        isError: !!err, httpStatus: err?.status ?? 200, action: ctx.action, orgId,
        cachedTokens: clampUsageValue(u.cached_tokens), reasoningTokens: clampUsageValue(u.reasoning_tokens),
        errorCode: err?.code,
      }));
    },
    span(toolName, latencyMs, isError) {
      if (!orgId) return;
      fire(emitAiSpan('agent-chat', { traceId: ctx.runId, spanId: crypto.randomUUID(), parentId: lastGeneration, name: toolName, latencySeconds: latencyMs / 1000, isError, orgId }));
    },
    trace(status, errorCode) {
      if (!orgId) return;
      fire(emitAiTrace('agent-chat', { traceId: ctx.runId, sessionId: ctx.threadId ?? ctx.runId, latencySeconds: (Date.now() - startedAt) / 1000, isError: status === 'errored', errorCode, orgId }));
    },
  };
}
```
Wrap every call site in `try { … } catch { /* NFR-PHO-REL-001 */ }` (`emit*` can throw synchronously under strict in tests only; in tests the throw must **fail** the test, so the call-site try/catch lives inside `fire`'s caller only for non-test runs: use `try { … } catch (e) { if (typeof (globalThis as { Deno?: unknown }).Deno === 'undefined') throw e; }`. This keeps the "thrown in test, swallowed on the edge" contract from OQ-P6.)

### S1-T4 — Wire the handler (AC-PHO-001, 002, 003, 004)
Files: modify `supabase/functions/agent-chat/handler.ts`; test `pmo-portal/src/lib/agent/handlerAiTelemetry.test.ts`. Template for the harness: `pmo-portal/src/lib/agent/handlerCredits.test.ts` (usage-insert capture, `mockOrgAndUsageInsert`) and `handlerTrailingToolUse.test.ts` / `handlerWidgets.test.ts` (a model client that returns a tool call then a final answer).

1. **Failing tests first** (`handlerAiTelemetry.test.ts`). One shared helper `runWith(deps)` that stubs `Deno` env (key set) and `fetch`, drives `agentChatHandler` to completion, and returns `{ events, usageRows, posthogEvents }` where `posthogEvents` is every `JSON.parse(body)` posted to `/i/v0/e/`.
```ts
it('AC-PHO-001 two rounds + one tool => 2 generations, 1 span, 1 trace; one trace id; cost/tokens equal agent_usage', async () => {
  const r = await runWith({ rounds: 2, tool: 'query_entity', usageAction: undefined, verifyAnswer: false });
  const byEvent = (n: string) => r.posthogEvents.filter((e) => e.event === n);
  expect(byEvent('$ai_generation')).toHaveLength(2);
  expect(byEvent('$ai_span')).toHaveLength(1);
  expect(byEvent('$ai_trace')).toHaveLength(1);
  const ids = new Set(r.posthogEvents.map((e) => e.properties.$ai_trace_id));
  expect(ids.size).toBe(1);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  expect(sum(byEvent('$ai_generation').map((e) => e.properties.$ai_total_cost_usd))).toBeCloseTo(sum(r.usageRows.map((u) => u.cost)));
  expect(sum(byEvent('$ai_generation').map((e) => e.properties.$ai_input_tokens))).toBe(sum(r.usageRows.map((u) => u.prompt_tokens)));
  expect(byEvent('$ai_span')[0].properties.$ai_parent_id).toBe(byEvent('$ai_generation')[0].properties.$ai_span_id);
});
it('AC-PHO-002 a provider error containing user text reaches PostHog as error_code only', async () => {
  const r = await runWith({ modelThrows: new Error('quota exceeded for "Acme Corp payroll"') });
  const all = JSON.stringify(r.posthogEvents);
  expect(all).not.toContain('Acme Corp');
  expect(r.posthogEvents.find((e) => e.event === '$ai_trace')!.properties.error_code).toBe('UPSTREAM_ERROR');
});
it('AC-PHO-003 PostHog hanging => same events and same usage rows as the control run', async () => {
  const control = await runWith({ rounds: 2, tool: 'query_entity', posthog: 'absent' });
  const hung = await runWith({ rounds: 2, tool: 'query_entity', posthog: 'hangs' });
  const shape = (xs: AgentEvent[]) => xs.map((e) => [e.type, e.payload, e.text]);
  expect(shape(hung.events)).toEqual(shape(control.events));
  expect(hung.usageRows).toEqual(control.usageRows);
});
it('AC-PHO-003 PostHog rejecting => run still completes', async () => { /* posthog: 'rejects' ; same assertions */ });
it('AC-PHO-004 usageAction automation => action=automation on generations', async () => {
  const r = await runWith({ rounds: 1, usageAction: 'automation' });
  expect(r.posthogEvents.find((e) => e.event === '$ai_generation')!.properties.action).toBe('automation');
});
```
Plus in `pmo-portal/src/lib/agent/composeViewHandlerCredits.test.ts`'s sibling `composeViewAiTelemetry.test.ts`: a `composeViewHandler` success run emits one `$ai_generation` with `action: 'compose'`, `$ai_output_tokens` = `tokensUsed`, no `$ai_input` (AC-PHO-004 compose half). Use the existing compose test's mock `modelClient`.
2. Red: `npx vitest run src/lib/agent/handlerAiTelemetry.test.ts`.
3. Implement in `handler.ts` (all edits S1's; keep each one line where possible):
   - `HandlerDeps` (`:210`): add `/** @internal set only by agentChatHandler */ ai?: AiRunTelemetry;` and `import { createAiRunTelemetry, type AiRunTelemetry } from './aiTelemetry.ts';`.
   - `agentChatHandler` (`:1266`): after `const persist = …`: `const ai = createAiRunTelemetry({ runId, threadId: req.threadId, action: deps.usageAction ?? 'chat' }); const aiDeps = { ...deps, ai };` and use `aiDeps` in the two lines below that pass `deps` (`createThreadAndRun` path does not use deps; `agentChatHandlerInner(req, aiDeps, …)`). Replace the final `yield* withPersistence(...)` with `yield* withAiTrace(withPersistence(agentChatHandlerInner(req, aiDeps, runId, persist), persist, runId), ai);`.
   - Add beside `withPersistence`:
```ts
async function* withAiTrace(inner: AsyncGenerator<AgentEvent>, ai: AiRunTelemetry): AsyncGenerator<AgentEvent> {
  for await (const ev of inner) {
    if (ev.type === 'status') {
      const p = ev.payload as { status?: AgentRunStatus; error?: string } | undefined;
      if (p?.status === 'completed' || p?.status === 'errored') ai.trace(p.status, p.status === 'errored' ? p.error : undefined);
    }
    yield ev;
  }
}
```
   - `runToolLoop` start (`:666`, after `const orgId = deputyCtx.orgId;`): `deps.ai?.setOrg(orgId);`. Decision pass (`handleDecision`, the function containing `dispatchActionForced` at `:1754`): same line after its org is resolved.
   - `recordModelUsage` (`:672`): first line, before `if (!deps.usage) return;`: `deps.ai?.generation(response, durationMs);`.
   - `UPSTREAM_ERROR` catch (`:1232`): before `yield statusEvent('errored', { error: 'UPSTREAM_ERROR' })` add `deps.ai?.generation({ model: deps.model }, 0, { code: 'UPSTREAM_ERROR', status: 502 });`.
   - Spans: add a local helper at the top of `runToolLoop`: 
```ts
const timed = async <T>(name: string, run: () => Promise<T>): Promise<T> => {
  const t = Date.now();
  try {
    const out = await run();
    deps.ai?.span(name, Date.now() - t, !!out && typeof out === 'object' && 'error' in (out as object));
    return out;
  } catch (e) { deps.ai?.span(name, Date.now() - t, true); throw e; }
};
```
     and wrap exactly four sites: parallel read `dispatchAction(action, input, deputyCtx)` (`:847`) → `timed(tc.function.name, () => dispatchAction(...))`; forced write `dispatchActionForced(...)` (`:1134`); plain read `dispatchAction(action, toolInput, deputyCtx)` (`:1163`); `runComposeView(...)` (`:918`, name `'compose_view'`). In the decision pass wrap `:1754` the same way (copy the helper there; do not export it — two copies of five lines beats a new module).
   - `compose-view/handler.ts` (`:198-215`): measure `const t0 = Date.now()` before `composeSpec`; after it resolves call `void emitAiGeneration('compose-view', { traceId: crypto.randomUUID(), spanId: crypto.randomUUID(), model, inputTokens: 0, outputTokens: tokensUsed, costUsd: clampUsageValue(providerCost), latencySeconds: (Date.now() - t0) / 1000, isError: false, httpStatus: 200, action: 'compose', orgId: profileOrgId }).catch(() => undefined)`; in the `UPSTREAM_ERROR` branch emit the same with `isError: true, httpStatus: 502, errorCode: 'UPSTREAM_ERROR'`. (`providerCost` is `composeSpec`'s return; `clampUsageValue` from `../_shared/usage.ts`.)
4. Green: `npx vitest run src/lib/agent/handlerAiTelemetry.test.ts src/lib/agent/composeViewAiTelemetry.test.ts` and the **untouched** existing suites that cover this handler: `npx vitest run src/lib/agent/handler src/lib/agent/agentChatHandler` (name prefix match). FR-PHO-008: they must pass unmodified.
5. `bash scripts/deno-typecheck-edge-fns.sh` and `bash scripts/deno-boot-smoke-edge-fns.sh` (agent-chat and compose-view entrypoints still import cleanly).

### S1-T5 — Feedback joins its trace (AC-PHO-005; FR-PHO-005)
Files: `pmo-portal/src/lib/analytics/events.ts` (only `buildAgentFeedbackRatedEvent`), `analytics/index.ts` (only `trackAgentFeedbackRated`), `src/components/panel/FeedbackControl.tsx`, `src/components/panel/TranscriptItem.tsx`; tests `analytics/events.agent.test.ts`, `analytics/index.agent.test.ts`, `src/components/panel/FeedbackControl.analytics.test.tsx`; spec `docs/specs/agent-posthog-events.spec.md` (FR-APH-011, AC-APH-011/012/016 rows).

1. **Failing tests first** — change the existing assertions to the amended set:
   - `events.agent.test.ts`: `buildAgentFeedbackRatedEvent('down', 'wrong_answer', 'run-1')` has properties `{ rating: 'down', downvote_reason: 'wrong_answer', run_id: 'run-1' }`; for `'up'`, `downvote_reason` is `undefined` and `run_id` present. Name the test `AC-PHO-005 …` and update the AC-APH-016 key-set test for this event.
   - `FeedbackControl.analytics.test.tsx`: render `<FeedbackControl eventId="e1" runId="run-1" onRate={…}/>`, click thumbs-down + a reason, assert `capture` called with `agent_feedback_rated` and `run_id: 'run-1'`.
2. Red.
3. Implement: `buildAgentFeedbackRatedEvent(rating, downvoteReason, runId)` → `{ rating, downvote_reason, run_id: runId }`; `trackAgentFeedbackRated(rating, reason, runId)`; `FeedbackControlProps` gains `runId: string`; `TranscriptItem.tsx:80` passes `runId={event.runId}`. Update the spec rows: FR-APH-011 now lists `run_id`; AC-APH-011/012 assert it.
4. Green: `npx vitest run src/lib/analytics/events.agent.test.ts src/lib/analytics/index.agent.test.ts src/components/panel` and `npm run typecheck`.

### S1-T6 — AI · Cost & Quality dashboard (FR-PHO-007; AC-PHO-006)
File: `scripts/posthog/spec/ai.mjs` (S1 owns). Export one dashboard `[PMO] AI · Cost & Quality` using `trend`/`funnel` from `../queryBuilders.mjs`:

| Tile | Query |
|---|---|
| Cost per org per day | `$ai_generation`, math `sum` on `$ai_total_cost_usd`, breakdown `org_id` |
| Tokens by model | `$ai_generation`, math `sum` on `$ai_input_tokens` and a second series on `$ai_output_tokens`, breakdown `$ai_model` |
| Cost by model | sum `$ai_total_cost_usd`, breakdown `$ai_model` |
| Error rate by tool | `$ai_span` total vs `$ai_span` with `$ai_is_error = true`, breakdown `$ai_span_name` |
| Slowest tools (p95) | `$ai_span`, math `p95` on `$ai_latency`, breakdown `$ai_span_name` |
| Runs, errors | `$ai_trace` total and `$ai_is_error = true` |
| Thumbs-down rate by model | **confirm in T1 what PostHog supports for joining `agent_feedback_rated.run_id` to `$ai_trace_id`.** If a cross-event join tile is not expressible in `TrendsQuery`, ship two tiles side by side (feedback by rating; generations by model) and record the limitation in the runbook. Do not invent a join. |

Tile events must be spelled `event: '$ai_generation'` etc. (single/double/backtick quote; the gate regex accepts `$`).
Test: `npx vitest run src/lib/analytics/checkDashboardTiles.test.ts && node scripts/check-dashboard-tiles.mjs` → green only if all three `$ai_*` producers are called (`emitAiGeneration(`, `emitAiSpan(`, `emitAiTrace(` appear in `agent-chat/aiTelemetry.ts`, which is outside `_shared`). **Mutation (AC-PHO-006, record in PR):** delete the `emitAiSpan(` call, run `node scripts/check-dashboard-tiles.mjs` → exit 1 naming `$ai_span`; restore.

### S1-T7 — `/privacy` copy (NFR-PHO-PRIV-002)
Files: `pmo-portal/pages/Privacy.tsx` (inside "Analytics and Cookies", after the first paragraph, `:48-57`), `pmo-portal/pages/Privacy.test.tsx`.
Add one paragraph: "Separately from browser analytics, our servers send operational telemetry about how the service runs — error codes, job run results, push outcomes to connected accounting systems, and Assistant usage counts (model, tokens, cost, timings). It contains no record contents, prompts, replies or names, and is not linked to your account. It is not affected by the analytics opt-out below." **Failing test first:** `Privacy.test.tsx` asserts the text `operational telemetry` and `not linked to your account` render. Verify: `npx vitest run pages/Privacy.test.tsx`.

### S1-T8 — Docs
Edit only the S1 H2 in `docs/analytics-events.md` (server events `$ai_generation`, `$ai_span`, `$ai_trace`: property table, allowlist, "no text ever", the `run_id` feedback join) and `docs/posthog-dashboards.md` (the dashboard and its tiles).

### S1-T9 — Runbook: operator checks (AC-PHO-007) and the AI alert
In `docs/runbooks/posthog-operations.md` `## S1 AI`: (1) procedure for AC-PHO-007: run one Assistant turn in a non-production session, open the dashboard, record model/tokens/cost/latency and "no text" in the **Evidence table** (evidence path in `docs/private/` or Director memory, not a screenshot in the repo); (2) the PostHog **trend alert** for owner's "error rate or cost per day over a threshold" (comment 1): cost per day on `$ai_generation` and `$ai_trace` error count; thresholds are the owner's to set after a week of data (write "set after 7 days of data", not a number). Alert destination per OQ-1.

### S1-T10 — S1 verify
`npm run check:guards`, `npm run typecheck`, `bash scripts/deno-typecheck-edge-fns.sh`, eslint on touched files, vitest on every file named above. Branch `feat/posthog-ops-s1-ai`.

---

## 6. Slice S2 — error alerts and source maps (M; builder: Orca worker; needs owner action for rules)

Covers FR-PHO-010..015, AC-PHO-010..012. **Design:** the front end builds on Cloudflare Pages, not in GitHub
Actions (`docs/environments.md:192-205`), so the upload runs in the **build** via an npm `postbuild` hook, decides
itself whether this is a deploy build, and is a no-op elsewhere (including this repo's CI `verify` build).
Source maps are generated only on deploy builds, uploaded, then **deleted from `dist`** so they are never served.
No new npm dependency: the PostHog CLI is run with `npx --yes @posthog/cli@<pinned>` only on deploy builds, so
`package-lock.json` does not change (never regenerate it on macOS; if a dependency becomes unavoidable use `scripts/relock.sh`).

### S2-T1 — Confirm the vendor interfaces (research task; result recorded, no code)
WebFetch (a) PostHog Error tracking → Alerts docs, (b) Error tracking → Upload source maps (CLI). Record in
`docs/runbooks/posthog-operations.md` `## S2 …` "Verified <date>": which destinations issue alerts support
(OQ-1's webhook route to the Telegram send call, and email), the CLI's commands (`sourcemap inject`, `upload`), the
flags for release name/version, the **variable names the CLI reads for key and project id** (OQ-P3), and the
current CLI version to pin. If the webhook-to-Telegram route is not supported, the default falls back to **email only**
(OQ-1); say so in the runbook. This task decides T3's command lines.

### S2-T2 — Deploy-build policy (pure), AC-PHO-011
Files: create `scripts/sourcemapPolicy.mjs`; test `pmo-portal/src/lib/build/sourcemapPolicy.test.ts`.

1. **Failing test first:**
```ts
import { describe, it, expect } from 'vitest';
import { isDeployBuild, planSourcemapUpload } from '../../../../scripts/sourcemapPolicy.mjs';

const deploy = { CF_PAGES: '1', CF_PAGES_BRANCH: 'production' };
describe('AC-PHO-011 source-map policy', () => {
  it('only a Cloudflare production build is a deploy build', () => {
    expect(isDeployBuild(deploy)).toBe(true);
    expect(isDeployBuild({})).toBe(false);                                   // CI verify / local
    expect(isDeployBuild({ CF_PAGES: '1', CF_PAGES_BRANCH: 'dev' })).toBe(false);
  });
  it('deploy build without the upload credential FAILS (a deploy with unreadable stacks is the defect)', () => {
    expect(planSourcemapUpload(deploy, ['a.js.map'])).toMatchObject({ action: 'fail' });
  });
  it('non-deploy build SKIPS visibly, never fails', () => {
    expect(planSourcemapUpload({}, [])).toEqual({ action: 'skip', reason: expect.stringContaining('not a deploy build') });
  });
  it('deploy build with credential but no maps FAILS', () => {
    expect(planSourcemapUpload({ ...deploy, ...CRED }, [])).toMatchObject({ action: 'fail' });
  });
  it('deploy build with credential and maps UPLOADS', () => {
    expect(planSourcemapUpload({ ...deploy, ...CRED }, ['a.js.map'])).toMatchObject({ action: 'upload' });
  });
});
```
(`CRED` = the two variable names fixed in S2-T1; the test file is the only other place they appear.)
2. Red: `cd pmo-portal && npx vitest run src/lib/build/sourcemapPolicy.test.ts`.
3. Implement `scripts/sourcemapPolicy.mjs` (`isDeployBuild(env) => env.CF_PAGES === '1' && env.CF_PAGES_BRANCH === 'production'`; `planSourcemapUpload(env, mapFiles)` per the five cases; `CREDENTIAL_VARS` exported from here so there is one list).
4. Green.

### S2-T3 — Generate maps on deploy builds only; upload; delete
Files: modify `pmo-portal/vite.config.ts` (`build` block, `:165`), `pmo-portal/package.json` (`scripts`), create `scripts/upload-sourcemaps.mjs`; test `pmo-portal/src/lib/build/uploadSourcemaps.test.ts`.

1. **Failing test first** (temp dir + fake runner):
```ts
import { mkdtempSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSourcemapStep } from '../../../../scripts/upload-sourcemaps.mjs';

function dist() { const d = mkdtempSync(join(tmpdir(), 'dist-')); mkdirSync(join(d, 'assets')); writeFileSync(join(d, 'assets/a.js'), '//'); writeFileSync(join(d, 'assets/a.js.map'), '{}'); return d; }

it('AC-PHO-011 uploads then removes every .map from the deployed output', async () => {
  const d = dist(); const calls: string[][] = [];
  const code = await runSourcemapStep({ env: { ...DEPLOY_WITH_CRED }, distDir: d, run: async (args) => { calls.push(args); return 0; }, log: () => undefined });
  expect(code).toBe(0);
  expect(calls.length).toBeGreaterThan(0);
  expect(existsSync(join(d, 'assets/a.js.map'))).toBe(false);
});
it('AC-PHO-011 a failed upload returns non-zero and does NOT claim success', async () => {
  const d = dist();
  const code = await runSourcemapStep({ env: { ...DEPLOY_WITH_CRED }, distDir: d, run: async () => 1, log: () => undefined });
  expect(code).not.toBe(0);
});
it('AC-PHO-011 deploy build without credential exits non-zero; fork/CI build exits 0 with a visible message', async () => {
  const logs: string[] = [];
  expect(await runSourcemapStep({ env: { CF_PAGES: '1', CF_PAGES_BRANCH: 'production' }, distDir: dist(), run: async () => 0, log: (m) => logs.push(m) })).not.toBe(0);
  expect(await runSourcemapStep({ env: {}, distDir: dist(), run: async () => 0, log: (m) => logs.push(m) })).toBe(0);
  expect(logs.join('\n')).toMatch(/skipped: not a deploy build/);
});
```
2. Red.
3. Implement `scripts/upload-sourcemaps.mjs`: `export async function runSourcemapStep({ env, distDir, run, log })` → collects `.map` files under `distDir` (recursive `readdirSync`), calls `planSourcemapUpload`, then for `upload`: `await run(['sourcemap','inject','--directory',distDir])`, `await run(['sourcemap','upload','--directory',distDir, …release flags from T1 with env.CF_PAGES_COMMIT_SHA…])`; non-zero from either → log and return 1 **without deleting**; on success `rmSync` every collected map, log `uploaded N maps for release <sha7>`, return 0. The CLI-level `run` default = spawn `npx --yes @posthog/cli@<pinned> …args` with `stdio: 'inherit'`. Guard: `if (isRunAsMain(import.meta.url, process.argv[1])) process.exit(await runSourcemapStep({ env: process.env, distDir: resolve('dist'), run: spawnCli, log: console.log }))` (copy `isRunAsMain` from `check-dashboard-tiles.mjs`; same percent-encoding reasoning).
   - `vite.config.ts`: `import { isDeployBuild } from '../scripts/sourcemapPolicy.mjs';` and in `build:` add `sourcemap: isDeployBuild(process.env) ? 'hidden' : false,` ('hidden' = maps written, no `//# sourceMappingURL` comment).
   - `package.json` scripts: `"postbuild": "node ../scripts/upload-sourcemaps.mjs"`.
4. Green: `npx vitest run src/lib/build`; `npm run typecheck` (vite.config.ts imports the .mjs; if tsc objects add `// @ts-expect-error mjs` is NOT acceptable — mirror how `checkDashboardTiles.test.ts` imports a `.mjs`, which already typechecks); `npm run build` locally prints the skip line and exits 0.
5. **Deploy rehearsal (Director; needs the credential):** `CF_PAGES=1 CF_PAGES_BRANCH=production CF_PAGES_COMMIT_SHA=<sha> <credential vars> npm run build` in a scratch checkout; confirm `dist` has no `.map`, and the maps appear under the release in PostHog. Record in the Evidence table. Cloudflare build settings (owner): add the credential variables to the **Production** environment only.

### S2-T4 — Release id on front-end exceptions (AC-PHO-012; FR-PHO-012)
Files: `pmo-portal/src/lib/analytics/client.ts` (`doInit`, `:263`), test `client.test.ts` (extend).
1. **Failing test first:** after `analyticsClient.init(config)` the mocked `posthog.register` has been called with an object containing `release: expect.any(String)` (value `__GIT_SHA__`); and `buildPosthogInitOptions(config).before_send` is still `redactExceptionProperties` (assert via a captured-event run: an `$exception_message` containing an email is redacted — reuse the existing redaction fixture in `client.test.ts`). Name it `AC-PHO-012 …`.
2. Red: `npx vitest run src/lib/analytics/client.test.ts`.
3. Implement: in `doInit`, directly after `initialized = true;` add `posthog.register({ release: __GIT_SHA__ });` (the define already exists, `vite.config.ts:152`, typed in `src/vite-env.d.ts`). A non-personal value; not in `FORBIDDEN_PROPERTY_KEYS`.
4. Green: the file; `npx vitest run src/lib/analytics/client.optInOut.realSdk.test.ts` (real SDK; confirms opt-out unaffected).
5. Spec text: the release id *filters* issues; PostHog symbolicates by the chunk ids the CLI `inject` step writes into the JS. Say so in the runbook (S2-T1 confirms).

### S2-T5 — Runbook: alert rules, volume guard, fire-drill (FR-PHO-010, 014, 015; AC-PHO-010)
`docs/runbooks/posthog-operations.md` `## S2 …` (docs-only; Director pushes direct):
1. **Owner steps** in PostHog (no values in the repo): create the issue alert "new issue" and "spike" for the project; set the destination per OQ-1; check **exception rate limits and suppression rules** from FR-PHG-032 exist (screenshot path in `docs/private/`).
2. **Fire-drill (OQ-P9).** There is no non-production deploy with source maps (CF previews are off; only `production` builds). Default procedure: on a scratch checkout, add an uncommitted throw in a real module (e.g. in a route component's render path), build with the deploy-rehearsal environment and a release name `fire-drill-<date>` (S2-T3.5), serve `dist` with `npx vite preview`, load the route, and confirm in PostHog that (a) the issue shows original file names and lines and (b) the alert arrived on the chosen channel. Discard the checkout; resolve the drill issue in PostHog. Record in the Evidence table (AC-PHO-010) with the evidence path in `docs/private/`. Console-thrown errors do not prove symbolication (no app frames), which is why the throw must live in app code.
3. List which exception sources exist (browser via `AnalyticsProvider`; edge via `capturePosthogException`) so the alert covers both.

### S2-T6 — S2 verify
`npm run check:guards`, `npm run typecheck`, eslint on touched files, vitest on `src/lib/build src/lib/analytics/client.test.ts`. Branch `feat/posthog-ops-s2-alerts-sourcemaps`.

---

## 7. Slice S3 — job health (M; builder: Orca worker, after S0)

Covers FR-PHO-020..025, AC-PHO-020..023 (S3 owns the wrapper; S4 owns the push stream). **Design:** `withJobRun(job, handler, opts)`
wraps the *handler* and is placed *inside* `serveWithErrorReporting`, so a throw is recorded as `failed`, rethrown,
and still reaches `reportEdgeError`. It emits **one** `job_run` per run, awaited for at most 3 s (these are
background ticks, not user requests; a fire-and-forget fetch can be cut off when the response returns). It does not
count 401s (a wrong secret is not a run; the **absence** alert catches a tick that never authenticates) or `OPTIONS`.
Success / failure comes from the **response** the handler already builds, plus a per-job `summarize(body)` that
returns item counts and any hidden failure (FR-PHO-022). This leaves the 3.8 k-line `erpnext-sweep/index.ts` body untouched except its serve line.

### S3-T1 — The wrapper (AC-PHO-020 core)
Files: create `supabase/functions/_shared/jobRun.ts`; test `supabase/functions/_shared/jobRun.test.ts` (Deno; runs from the `_shared` entry in `deno-test-edge-fns.sh`).

1. **Failing test first** (Deno, `jsr:@std/assert@1` as in `_shared/usage.test.ts`; mock `globalThis.fetch`; set `Deno.env.set('POSTHOG_PROJECT_KEY','phc_t')`):
```ts
import { assertEquals } from 'jsr:@std/assert@1';
import { withJobRun, type JobSummary } from './jobRun.ts';

function capture() {
  const sent: Record<string, any>[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = ((_u: unknown, init: RequestInit) => { sent.push(JSON.parse(String(init.body))); return Promise.resolve(new Response('{}')); }) as typeof fetch;
  return { sent, restore: () => { globalThis.fetch = orig; } };
}
const req = () => new Request('http://x', { method: 'POST' });

Deno.test('AC-PHO-020 success emits exactly one job_run ok with items and duration', async () => {
  Deno.env.set('POSTHOG_PROJECT_KEY', 'phc_t'); const c = capture();
  try {
    const h = withJobRun('clickup-sweep', () => new Response(JSON.stringify({ ok: true, applied: 4 })), { summarize: (b) => ({ items: (b as any).applied }) });
    assertEquals((await h(req())).status, 200);
    assertEquals(c.sent.length, 1);
    assertEquals(c.sent[0].event, 'job_run');
    assertEquals(c.sent[0].properties.status, 'ok'); assertEquals(c.sent[0].properties.items_processed, 4);
    assertEquals(typeof c.sent[0].properties.duration_ms, 'number');
  } finally { c.restore(); }
});
Deno.test('AC-PHO-020 a throw emits failed, then rethrows (so reportEdgeError still sees it)', async () => { /* handler throws new Error('x'); expect rejects; one job_run failed error_code UNHANDLED_EXCEPTION */ });
Deno.test('AC-PHO-021 summarize failedCode turns a 200 into failed (a job that skips all work must not look healthy)', async () => { /* summarize => { items: 0, failedCode: 'NO_ORGS_BOUND' } => status failed, error_code NO_ORGS_BOUND */ });
Deno.test('non-2xx maps to failed with the body error code; 401 and OPTIONS emit nothing', async () => { /* 500 {error:'MISCONFIGURED'} => failed MISCONFIGURED; 401 => 0 events; OPTIONS => 0 events */ });
Deno.test('NFR-PHO-REL-001 PostHog down does not change the response or the rethrow', async () => { /* fetch rejects => same Response object status/body returned */ });
```
2. Red: `cd supabase/functions/erpnext-sweep && deno test ../_shared/jobRun.test.ts --config deno.json --allow-env --allow-net --allow-read`.
3. Implement:
```ts
import { emitServerEvent } from './posthogServer.ts';

export const JOB_NAMES = ['erpnext-sweep', 'clickup-sweep', 'clickup-webhook-worker', 'agent-dispatch', 'telegram-notify'] as const;
export type JobName = (typeof JOB_NAMES)[number];

export interface JobSummary { items: number; failedCode?: string; orgCount?: number; extra?: { recovered?: number; reconcile_errors?: number; org_error_count?: number } }
export interface JobRunOptions { /** null => not a scheduled run (e.g. a manual maintenance request): emit nothing. */ summarize?: (body: unknown) => JobSummary | null }

const EMIT_DEADLINE_MS = 3_000; // ponytail: background ticks may wait this long; shorten if a tick ever runs near the 150 s cap
const CODE = /^[A-Z][A-Z0-9_]{2,40}$/;

export function withJobRun(job: JobName, handler: (req: Request) => Response | Promise<Response>, opts: JobRunOptions = {}) {
  const emit = (p: Record<string, unknown>) => emitServerEvent('job_run', job, { job, ...p }, { timeoutMs: EMIT_DEADLINE_MS });
  return async (req: Request): Promise<Response> => {
    const t0 = Date.now();
    let res: Response;
    try {
      res = await handler(req);
    } catch (err) {
      await emit({ status: 'failed', error_code: 'UNHANDLED_EXCEPTION', duration_ms: Date.now() - t0 });
      throw err;
    }
    if (req.method === 'OPTIONS' || res.status === 401) return res;
    let body: unknown = null;
    try { body = await res.clone().json(); } catch { /* non-JSON body: counts as no summary */ }
    if (res.status >= 400) {
      const code = (body as { error?: unknown } | null)?.error;
      await emit({ status: 'failed', error_code: typeof code === 'string' && CODE.test(code) ? code : `HTTP_${res.status}`, duration_ms: Date.now() - t0 });
      return res;
    }
    const s = opts.summarize ? opts.summarize(body) : { items: 0 };
    if (s === null) return res;
    await emit({
      status: s.failedCode ? 'failed' : 'ok', items_processed: s.items, duration_ms: Date.now() - t0,
      ...(s.failedCode ? { error_code: s.failedCode } : {}), ...(s.orgCount !== undefined ? { org_count: s.orgCount } : {}), ...s.extra,
    });
    return res;
  };
}
```
4. Green; then `bash scripts/deno-typecheck-edge-fns.sh`.

### S3-T2 — Wire the five jobs (AC-PHO-020, 021) — one task per job, each 2-5 min
Each job: add `import { withJobRun } from '../_shared/jobRun.ts'`, an **exported** `summarize…` function, and wrap its handler; add a per-function Deno test that drives the **shipped** handler. For the three jobs whose `index.ts` calls `serveWithErrorReporting` at top level (`erpnext-sweep`, `clickup-sweep`, `agent-dispatch`) the test stubs `Deno.serve` **before** `await import('./index.ts')` to capture the registered handler (the proven pattern, `erpnext-sweep/moneyCadence.test.ts:1-5`). For the two behind `import.meta.main` (`clickup-webhook-worker`, `telegram-notify`) the wrapped handler is exported as `jobHandler` and the guard becomes `serveWithErrorReporting('<fn>', jobHandler)`.

| Job | Edit (line refs at `1ccadb793`) | `summarize(body)` | Test file (Deno) |
|---|---|---|---|
| `erpnext-sweep` | serve line `index.ts:3231` → `serveWithErrorReporting('erpnext-sweep', withJobRun('erpnext-sweep', async (req) => { …existing body… }, { summarize: summarizeErpSweep }))`. **Only the wrapper line and its closing `)` change; do not re-indent the body.** | `summarizeErpSweep`: if `body.perOrg` is not an array return `null` (maintenance request); `items = Σ(reconcile?.reconciled ?? 0) + Σ(sweep?.applied ?? 0)`; `extra = { recovered: Σ reconciled, reconcile_errors: Σ reconcile.errors.length, org_error_count: #perOrg with errors.length>0 }`; `orgCount = body.orgs`; `body.orgs === 0` → `failedCode: 'NO_ORGS_BOUND'` (OQ-P2) | `erpnext-sweep/jobRun.test.ts`: (a) env unset → handler returns 500 `MISCONFIGURED` → one `job_run` `failed` `MISCONFIGURED` (**AC-PHO-021, real handler**); (b) `summarizeErpSweep` unit cases incl. zero orgs; (c) 401 emits nothing |
| `clickup-sweep` | `index.ts:265` same shape | `{ items: body.applied, orgCount: body.orgs, failedCode: body.failures?.length ? 'ORG_SWEEP_FAILED' : undefined }` | `clickup-sweep/jobRun.test.ts`: env unset → 500 MISCONFIGURED failed; summarize cases |
| `clickup-webhook-worker` | `index.ts:354`: `export const jobHandler = withJobRun('clickup-webhook-worker', async (req) => {…}, { summarize })`; guard line calls `serveWithErrorReporting('clickup-webhook-worker', jobHandler)` | `{ items: body.processed, failedCode: body.failed > 0 ? 'ROWS_FAILED' : undefined }` | `clickup-webhook-worker/jobRun.test.ts` imports `jobHandler` |
| `agent-dispatch` | `index.ts:47` same shape | `{ items: 0 }` (the tick returns `{ok:true}` only; per-run counts would need `runDispatchTick` to return them — out of scope, noted) | `agent-dispatch/jobRun.test.ts`: env unset → 500 `MISCONFIGURED` failed; flag-off 200 `{ok:true, skipped:'flag off'}` → `ok` |
| `telegram-notify` | `index.ts:174`: `export const jobHandler = withJobRun('telegram-notify', handleTelegramNotifyRequest, { summarize })`; the **exported** `handleTelegramNotifyRequest` and its existing `index.test.ts` stay untouched | `{ items: body.sent, failedCode: body.skipped === 'secrets-unset' ? 'SECRETS_UNSET' : (body.sendFailures > 0 \|\| body.stampFailures > 0) ? 'SEND_FAILED' : undefined }` | `telegram-notify/jobRun.test.ts` imports `jobHandler` |

Steps per row: write the failing test (red: `cd supabase/functions/<fn> && deno test jobRun.test.ts --config deno.json --allow-env --allow-net --allow-read`), then the edit, then green. After all five: `bash scripts/deno-test-edge-fns.sh` (whole Deno inventory) and `bash scripts/deno-boot-smoke-edge-fns.sh`. Existing suites must stay green untouched (`moneyCadence.test.ts` etc.).

**Overhead check (spec §9 note: "keep wrapper overhead to one fetch")**: each run adds exactly one `fetch` plus a `res.clone().json()` of an already-small body; record the measured added time of `erpnext-sweep` in the PR (`console.time` in the test is enough).

### S3-T3 — CI check: a job without the wrapper fails (AC-PHO-022)
Files: `scripts/check-edge-fn-error-reporting.mjs`, `pmo-portal/src/lib/agent/checkEdgeFnErrorReporting.test.ts` (S3 owns both).
1. **Failing tests first** (extend the existing suite, which already calls the pure `checkFunctionSource`):
```ts
import { checkFunctionSource, JOB_FUNCTIONS } from '../../../../scripts/check-edge-fn-error-reporting.mjs';
it('AC-PHO-022 a registered job without withJobRun fails', () => {
  const src = "serveWithErrorReporting('erpnext-sweep', async () => new Response('x'))";
  expect(checkFunctionSource('erpnext-sweep', src).join(' ')).toMatch(/withJobRun/);
});
it('AC-PHO-022 a job that wraps with its OWN name passes; a copy-pasted name fails', () => {
  expect(checkFunctionSource('clickup-sweep', "serveWithErrorReporting('clickup-sweep', withJobRun('clickup-sweep', h))")).toEqual([]);
  expect(checkFunctionSource('clickup-sweep', "serveWithErrorReporting('clickup-sweep', withJobRun('erpnext-sweep', h))")).not.toEqual([]);
});
it('JOB_FUNCTIONS equals the runtime JOB_NAMES list', async () => {
  const { JOB_NAMES } = await import('../../../../supabase/functions/_shared/jobRun');
  expect([...JOB_FUNCTIONS].sort()).toEqual([...JOB_NAMES].sort());
});
```
2. Red. 3. Implement: `export const JOB_FUNCTIONS = ['erpnext-sweep','clickup-sweep','clickup-webhook-worker','agent-dispatch','telegram-notify'];` and in `checkFunctionSource` (after the existing checks) `if (JOB_FUNCTIONS.includes(name) && !new RegExp(\`withJobRun\\\\(\\\\s*['"]\${name}['"]\`).test(src)) failures.push(...)`. For the two `jobHandler` files the regex still matches (`export const jobHandler = withJobRun('<fn>'…`). 4. Green: `npx vitest run src/lib/agent/checkEdgeFnErrorReporting.test.ts && node scripts/check-edge-fn-error-reporting.mjs`.

### S3-T4 — Jobs dashboard (FR-PHO-025)
File: `scripts/posthog/spec/jobs.mjs` (S3 owns): `[PMO] Jobs` with tiles: last run per job (`job_run` breakdown `job`, `display: 'ActionsTable'`, math `max` on timestamp is not available — use runs in last 24 h by `job`); runs per hour (`interval: 'hour'`, breakdown `job`); failure rate (total vs `status = failed`); items processed (sum `items_processed`, breakdown `job`); duration p95 (`duration_ms`). Verify: `node scripts/check-dashboard-tiles.mjs` (green once `withJobRun(` is called in the five `index.ts`). Mutation: remove one wrapper call → it still passes (other files call it); remove **all** → red. Record both in the PR.

### S3-T5 — Runbook: alerts and the absence positive control (FR-PHO-023; AC-PHO-023, OQ-8)
`## S3 Jobs`: the per-job missing-run thresholds (3× cadence: minute jobs 5 min, `clickup-sweep` 20 min, hourly jobs 3 h) as **trend alerts on `job_run` count by `job` with "less than 1"**, plus a `status = failed` alert; the OQ-P2 note (no ERP-bound org => do not create the `erpnext-sweep` alert there). **Positive control (AC-PHO-023, owner):** in a non-production environment disable one job's cron (`select cron.alter_job(...)` is a DB write — owner/Director runs it, not a builder), wait the window, confirm the alert arrives, re-enable; record in the Evidence table. Quota check: after one day, read `job_run` volume and compare with NFR-PHO-QUOTA-001's ~97 k/month; if over, apply the first lever (idle-run thinning) as a follow-up issue.

### S3-T6 — S3 verify
`npm run check:guards`, `npm run typecheck`, `bash scripts/deno-typecheck-edge-fns.sh`, `bash scripts/deno-test-edge-fns.sh`, `bash scripts/deno-boot-smoke-edge-fns.sh`, eslint on touched files, vitest on `src/lib/agent/checkEdgeFnErrorReporting.test.ts`. Branch `feat/posthog-ops-s3-jobs`.

---

## 8. Slice S4 — ERP push outcomes (M; **MONEY PATH: Director-dispatched, alone in its PR, security reviewer, existing money tests unmodified**)

Covers FR-PHO-030..034, AC-PHO-030..033. Read first: `docs/money-path-primer.md`.
**Design.** Every outbox write-back in both `adapter-dispatch` and `erpnext-sweep` goes through one factory,
`createDbMoneyOutboxDeps` (`adapter-dispatch/moneyOutboxDeps.ts:178`). Its four state-changing members already return
the **transition result** (affected-row count, or the row), which is exactly FR-PHO-031's "emit only when the RPC
changed the row". So S4 edits **one production file** and adds one `_shared` emitter. It does **not** touch
`erpnext-sweep/index.ts` (S3 edits that file's serve line) — the distinct id is `edge:money-outbox`, not the calling
function's name, which keeps the two slices' file sets disjoint. Emission is `void …catch(()=>undefined)` after the
write-back has returned; it never gates, retries or alters the return value (NFR-PHO-REL-001).

### S4-T1 — Confirm the RPC semantics (research, ~10 min; result goes in the PR description)
For each of `confirm_outbox`, `mark_outbox_held`, `quarantine_committing` read the **latest** `create or replace`
(`grep -ln "function public.<name>" supabase/migrations/*.sql | tail -1`) and, because migrations are claims about the
deciding artifact, read the live local definition: `scripts/with-db-lock.sh psql "$(supabase status -o env | grep ^DB_URL | cut -d= -f2- | tr -d '"')" -c "select pg_get_functiondef('public.quarantine_committing(uuid)'::regprocedure)"` (read-only). Answer three questions in the PR:
(1) does `confirm_outbox`/`mark_outbox_held` return `1` only when *this* call transitioned the row? (2) does `quarantine_committing` return a row whose `state = 'quarantined'` **only** when this call transitioned it, or also when it was already quarantined? (3) what does `outbox_reconcile_candidates` do with `held`/`quarantined` (are they re-driven)? If (2) is "also when already quarantined", use the claim-generation: emit only when the row's `claim_generation` differs from the one remembered at claim time; if no claim was remembered, **do not emit** (a missed event is better than a double count). The code below assumes "transitioned only".

### S4-T2 — Emitter and stable codes (AC-PHO-030, 033)
Files: create `supabase/functions/_shared/erpPushOutcome.ts`; test `supabase/functions/_shared/erpPushOutcome.test.ts` (Deno, `_shared`).
1. **Failing test first:**
```ts
import { assertEquals } from 'jsr:@std/assert@1';
import { stableOutcomeCode, emitErpPushOutcome } from './erpPushOutcome.ts';

Deno.test('stableOutcomeCode keeps a code token and never ERP text', () => {
  assertEquals(stableOutcomeCode('external-unreachable: connect ECONNREFUSED erp.client.example.com'), 'external-unreachable');
  assertEquals(stableOutcomeCode('recovery-inconclusive-absence: mutable anchor cannot prove non-commit'), 'recovery-inconclusive-absence');
  assertEquals(stableOutcomeCode('Invoice ACC-SINV-0001 for PT Contoh is wrong'), 'unclassified'); // no leading code token
  assertEquals(stableOutcomeCode(undefined), 'unclassified');
});
Deno.test('AC-PHO-030 payload has no amount, name or ERP id keys', async () => { /* mock fetch; emit; assert Object.keys(properties) ⊆ allowlist and JSON has no 'ACC-' */ });
```
2. Red: `cd supabase/functions/erpnext-sweep && deno test ../_shared/erpPushOutcome.test.ts --config deno.json --allow-env --allow-net --allow-read`.
3. Implement:
```ts
import { emitServerEvent } from './posthogServer.ts';

const CODE_TOKEN = /^([a-z][a-z0-9-]{2,48}):/;
/** The leading `<code>:` that `redactErrorForOutbox` / the held reasons put in front of free text; nothing else leaves. */
export function stableOutcomeCode(text: string | undefined): string {
  return CODE_TOKEN.exec(text ?? '')?.[1] ?? 'unclassified';
}

export interface ErpPushOutcomeProps {
  tier: string; domain: string; operation: string; outcome: 'confirmed' | 'failed' | 'quarantined' | 'held';
  errorCode?: string; attemptCount?: number; durationMs?: number; orgId: string; outboxId: string;
}
export function emitErpPushOutcome(p: ErpPushOutcomeProps): Promise<void> {
  return emitServerEvent('erp_push_outcome', 'money-outbox', {
    tier: p.tier, domain: p.domain, operation: p.operation, outcome: p.outcome, error_code: p.errorCode,
    attempt_count: p.attemptCount, duration_ms: p.durationMs, org_id: p.orgId, outbox_id: p.outboxId,
    needs_human: p.outcome === 'held', // FR-PHO-032: a held command always needs a person
  });
}
```
(`EdgeFunctionName | 'money-outbox'` was already allowed by S0-T2's `emitServerEvent` signature.) `emitErpPushOutcome` lives in `_shared` and is **called** only from `adapter-dispatch/moneyOutboxDeps.ts`, so the registry gate (S0-T3) cannot be satisfied by the definition.
4. Green + `bash scripts/deno-typecheck-edge-fns.sh`.

### S4-T3 — Emit at the four transition points (AC-PHO-030, 031, 032, 033)
File: `supabase/functions/adapter-dispatch/moneyOutboxDeps.ts`; new test `supabase/functions/adapter-dispatch/moneyOutboxDeps.pushOutcome.test.ts` (Deno). Read the existing fake client in `moneyOutboxDeps.test.ts` first and reuse its shape (`rpc(fn,args)` + `from('external_command_outbox').update().eq().eq().select()`).

1. **Failing tests first** (`Deno.env.set('POSTHOG_PROJECT_KEY','phc_t')`; capture `globalThis.fetch` bodies; restore in `finally`):
   - **AC-PHO-030**: build deps with `createDbMoneyOutboxDeps({ serviceClient: fake, orgId:'org-1', externalTier:'erpnext', operation:'create', probeByRemarksKey })`; claim a row (rpc `claim_outbox_for_commit` → row with `domain:'revenue', attempt_count: 2`), then `confirmOutbox(id, 7)` (rpc → `1`) ⇒ exactly one `erp_push_outcome` `outcome:'confirmed'`, `attempt_count: 2`, `domain:'revenue'`. Repeat for `markOutboxFailed(id, 'external-unreachable: connect ECONNREFUSED erp.example', 7)` ⇒ `failed` + `error_code:'external-unreachable'` and the body string contains neither `ECONNREFUSED` nor `erp.example`; `markOutboxHeld(id, 'recovery-inconclusive-absence: …', 7)` ⇒ `held`; `quarantineCommitting(id)` (rpc → row `state:'quarantined'`) ⇒ `quarantined`.
   - **AC-PHO-031**: `confirmOutbox` returning `0` (already confirmed / superseded) ⇒ **zero** events; calling finalize twice with results `1` then `0` ⇒ exactly one event in total.
   - **AC-PHO-032**: the `held` event has `needs_human: true`; the `confirmed` event has `needs_human: false`.
   - **AC-PHO-033**: with `fetch` rejecting, throwing synchronously, and hanging, every member still returns exactly what it returned in the control run (counts `1`/`0`, the quarantine row), and no exception escapes.
2. Red: `cd supabase/functions/adapter-dispatch && deno test moneyOutboxDeps.pushOutcome.test.ts --config deno.json --allow-env --allow-net --allow-read`.
3. Implement in `createDbMoneyOutboxDeps`:
   - Extend the private `OutboxDbRow` (`:46`) with `attempt_count?: number;` and give `callRowRpc` (`:101`) an optional 4th parameter `onRaw?: (raw: OutboxDbRow) => void` called with `data` before `mapRow` (no change to its return value or throw behaviour).
   - Inside the factory, before `return {`:
```ts
  const meta = new Map<string, { domain: string; attempt?: number; claimedAtMs?: number }>();
  const outcome = (id: string, kind: 'confirmed' | 'failed' | 'quarantined' | 'held', code?: string): void => {
    const m = meta.get(id);
    if (!m) return; // never emit an event without a domain
    try {
      void emitErpPushOutcome({
        tier: externalTier, domain: m.domain, operation, outcome: kind, errorCode: code,
        attemptCount: m.attempt, durationMs: m.claimedAtMs ? Date.now() - m.claimedAtMs : undefined,
        orgId, outboxId: id,
      }).catch(() => undefined);
    } catch { /* NFR-PHO-REL-001: a telemetry fault never touches the outbox */ }
  };
```
   - `readOutbox` (`:183`): after mapping a found row, `meta.set(row.id, { domain: row.domain, ...meta.get(row.id) })`.
   - `claimOutboxForCommit` (`:273`): `(id) => callRowRpc(serviceClient, 'claim_outbox_for_commit', id, (raw) => meta.set(raw.id, { domain: raw.domain, attempt: raw.attempt_count, claimedAtMs: Date.now() }))`.
   - `quarantineCommitting`: `async (id) => { const row = await callRowRpc(serviceClient, 'quarantine_committing', id); if (row && row.state === 'quarantined') { meta.set(id, { domain: row.domain, ...meta.get(id) }); outcome(id, 'quarantined', 'committing-lease-expired'); } return row; }`.
   - `confirmOutbox`: `async (id, g) => { const n = await callCountRpc(serviceClient, 'confirm_outbox', { p_id: id, p_generation: g }); if (n === 1) outcome(id, 'confirmed'); return n; }`.
   - `markOutboxHeld`: same shape, `if (n === 1) outcome(id, 'held', stableOutcomeCode(reason))`.
   - `markOutboxFailed`: after the existing `if (error) throw …`, `const n = data?.length ?? 0; if (n === 1) outcome(id, 'failed', stableOutcomeCode(lastError)); return n;`.
   - `import { emitErpPushOutcome, stableOutcomeCode } from '../_shared/erpPushOutcome.ts';`.
4. Green: the new test file. **Existing money suites must pass with zero edits:** `(cd supabase/functions/adapter-dispatch && deno test . --config deno.json --allow-env --allow-net --allow-read)` and `(cd supabase/functions/erpnext-sweep && deno test . --config deno.json --allow-env --allow-net --allow-read)`; then `git diff --stat origin/dev -- 'supabase/functions/**/*.test.ts'` shows only **new** test files.
5. **Mutation checks (record each in the PR; each must turn a named test red, then revert):** (a) `n === 1` → `n >= 0` in `confirmOutbox` ⇒ AC-PHO-031 red; (b) drop `needs_human` ⇒ AC-PHO-032 red; (c) remove the `try/catch` in `outcome` and make `emitErpPushOutcome` throw synchronously ⇒ AC-PHO-033 red; (d) swap `stableOutcomeCode(lastError)` for `lastError` ⇒ AC-PHO-030's "no ERP text" red.

### S4-T4 — Dashboard and alerts (FR-PHO-032, 034)
`scripts/posthog/spec/pushes.mjs`: `[PMO] Money pushes` — outcomes per domain per day (`erp_push_outcome`, breakdown `domain`); failure rate (all vs `outcome = failed`); top `error_code` (breakdown `error_code`, filter `outcome != confirmed`); held/quarantined in the last 7 days (the dashboard cannot show "currently"; the outbox row is the record — say so in the tile name); push duration p95. Description states: "Empty when PMO is standalone (no external tier) — by design" (ADR-0094). Verify: `node scripts/check-dashboard-tiles.mjs` (requires `emitErpPushOutcome(` call in `moneyOutboxDeps.ts`; mutation: delete it ⇒ exit 1).
Runbook `## S4 Push outcomes`: trend alert A = `erp_push_outcome` where `outcome = failed` and `domain` in (`budget`, `revenue`, `procurement`, `expenses`) ≥ 1 in 15 min; alert B = `needs_human = true` ≥ 1 (any held command, regardless of attempt count). Note the other domains (`timesheets`, `companies`, …) are emitted but not alerted.

### S4-T5 — S4 verify and review
`npm run check:guards`, `bash scripts/deno-typecheck-edge-fns.sh`, both Deno suites above unmodified, `bash scripts/deno-test-edge-fns.sh`, eslint on touched files, vitest `src/lib/analytics/checkDashboardTiles.test.ts`. **Review: `security-auditor` (invariants: one record mints one ERP document, held is never reissued, SoD untouched — the diff must show no change to any dispatch/claim/reissue logic) + `spec-reviewer`.** Ship alone: branch `feat/posthog-ops-s4-push-outcomes`.

---

## 9. Slice S5 — business events (S; builder: Orca worker, after S0)

Covers FR-PHO-040..045, AC-PHO-040..043. S0 already added the four names to `AnalyticsEventName`, the four
`EVENT_PRODUCERS` rows and `export * from './business'`; S5 fills the two new files and calls them from four hooks.

### S5-T1 — Builders and facade (AC-PHO-040, 043)
Files: create `pmo-portal/src/lib/analytics/events.business.ts`; fill `business.ts`; test `pmo-portal/src/lib/analytics/business.test.ts`.
1. **Failing test first:**
```ts
import { describe, it, expect, vi } from 'vitest';
vi.mock('./client', () => ({ analyticsClient: { capture: vi.fn() } }));
import { analyticsClient } from './client';
import { trackBudgetActivated, trackInvoiceIssued, trackPaymentRecorded, trackPurchaseApproved } from './business';

describe('AC-PHO-040 business events carry only module and role', () => {
  it.each([
    [trackBudgetActivated, 'budget_activated', 'budget'],
    [trackInvoiceIssued, 'invoice_issued', 'revenue'],
    [trackPaymentRecorded, 'payment_recorded', 'revenue'],
    [trackPurchaseApproved, 'purchase_approved', 'procurement'],
  ] as const)('%s', (fn, event, module) => {
    fn('Finance');
    expect(analyticsClient.capture).toHaveBeenLastCalledWith(event, { module, role: 'Finance' });
  });
});
```
2. Red: `cd pmo-portal && npx vitest run src/lib/analytics/business.test.ts`.
3. Implement `events.business.ts` (four `build…Event(role): TrackedEvent` returning `{ event, properties: { module, role } }`) and `business.ts`:
```ts
import { analyticsClient } from './client';
import { buildBudgetActivatedEvent, buildInvoiceIssuedEvent, buildPaymentRecordedEvent, buildPurchaseApprovedEvent } from './events.business';

const send = (e: { event: Parameters<typeof analyticsClient.capture>[0]; properties: Record<string, string> }) => analyticsClient.capture(e.event, e.properties);
export const trackBudgetActivated = (role: string): void => send(buildBudgetActivatedEvent(role));
export const trackInvoiceIssued = (role: string): void => send(buildInvoiceIssuedEvent(role));
export const trackPaymentRecorded = (role: string): void => send(buildPaymentRecordedEvent(role));
export const trackPurchaseApproved = (role: string): void => send(buildPurchaseApprovedEvent(role));
```
4. Green; `npm run typecheck`. (`contract_value`/amount keys cannot appear: the builders accept only `role`; `buildEventProperties` still guards in `capture`.)

### S5-T2 — Wire the four success paths (AC-PHO-040, 041)
Files: `src/hooks/useBudget.ts`, `src/hooks/useRevenue.ts`, `src/hooks/useProcurementDetail.ts`, `src/components/procurement/ProcurementBlock.tsx`; tests alongside (new files `useBudget.businessEvent.test.tsx`, `useRevenue.businessEvent.test.tsx`, `useProcurementDetail.businessEvent.test.tsx`, `ProcurementBlock.businessEvent.test.tsx` — copy the provider/QueryClient harness from the neighbouring `useBudget.repository.test.tsx`, `useRevenue.assignProject.test.tsx`, `useProcurementDetail.test.ts`).
Each call sits **inside the mutation's `onSuccess`** (never `onSettled`/`finally`), wrapped in `safeTrack`, with the real role from `useEffectiveRole().realRole` (`src/auth/impersonation.tsx:16`; impersonation is view-only, so the *real* role is the actor):

| Event | Site | Condition |
|---|---|---|
| `budget_activated` | `useBudget.ts:104` `activate.onSuccess` | always |
| `invoice_issued` | `useRevenue.ts:145` `submitInvoice.onSuccess` | always (`submitInvoice` = ERP submit or native approve; `create` is a draft and is **not** counted) |
| `payment_recorded` | `useRevenue.ts:196` `createPayment.onSuccess` | always |
| `purchase_approved` | `useProcurementDetail.ts:94` `transition.onSuccess` (`(_d, { to })`) **and** `ProcurementBlock.tsx:369` (add an `onSuccess: (_d, { to }) => …`; today it only has `onSettled`) | `to === 'Approved'` |

Snippet (`useBudget.ts`):
```ts
const { realRole } = useEffectiveRole();
// …
onSuccess: () => { invalidateBoth(); invalidateMoneyCollections(); safeTrack(() => trackBudgetActivated(realRole ?? 'unknown')); },
```
Import the wrappers from `@/src/lib/analytics` (the gate counts a call site only **outside** `src/lib/analytics/**`).
1. **Failing tests first** (per hook): resolve the repository mock → the matching `trackX` is called once with the role; reject it → `trackX` is **not** called (**AC-PHO-041**, the failure is classified, nothing is captured). For purchase: transition to `'Approved'` tracks; transition to `'Ordered'` does not.
2. Red: `npx vitest run src/hooks/useBudget.businessEvent.test.tsx src/hooks/useRevenue.businessEvent.test.tsx src/hooks/useProcurementDetail.businessEvent.test.tsx src/components/procurement/ProcurementBlock.businessEvent.test.tsx`.
3. Implement the four edits. 4. Green + the **existing** neighbouring tests unmodified: `npx vitest run src/hooks/useBudget src/hooks/useRevenue src/hooks/useProcurementDetail`.
Known coverage gap, recorded in the docs section: a purchase approved by the Assistant (agent action) or by a direct API call fires no browser event (FR-PHO-045: observed use only).

### S5-T3 — Opt-out proof with the real SDK (AC-PHO-042)
File: `pmo-portal/src/lib/analytics/business.optOut.realSdk.test.ts` (copy the harness and `withStubbedNetwork` from `client.optInOut.realSdk.test.ts:1-40`; `// @vitest-environment jsdom`).
Test: init with the real SDK and stubbed network; **control** — not opted out, `trackBudgetActivated('Finance')` ⇒ the stubbed `fetch` receives a request to the PostHog host (positive control: absence tests need one). **Opted out** (`analyticsClient.optOut()`) ⇒ after the same call, **no** request. Red/green: `npx vitest run src/lib/analytics/business.optOut.realSdk.test.ts`. The browser-level proof stays `AC-CON-003` (unchanged, AC-PHO-081).

### S5-T4 — Dashboard and docs (FR-PHO-044/045; AC-PHO-043)
`scripts/posthog/spec/usage.mjs`: `[PMO] Usage per org (observed use)` — the four events per week, breakdown `org_id` (`org_id` is a super-property registered at identify, `client.ts:identify`), display a table; dashboard description: "Observed use — browser events, best effort (ad blockers, opt-out). Not a record; nothing commercial reads from it." `docs/analytics-events.md` (S5 H2): table of the four events, boundary hooks, safe properties, the coverage gap. **AC-PHO-043 mutation:** `node scripts/check-dashboard-tiles.mjs` green; delete the `trackPaymentRecorded(` call in `useRevenue.ts` ⇒ exit 1 naming `payment_recorded`; restore.

### S5-T5 — S5 verify
`npm run check:guards`, `npm run typecheck`, eslint on touched files, vitest on every file named above. Branch `feat/posthog-ops-s5-business-events`.

---

## 10. Slice S6 — demo money-path funnel (S; builder: Orca worker; **merges after S5**)

Covers FR-PHO-050..052, AC-PHO-050, 051. The tile gate fails until the four S5 events have call sites, so S6 can be
built in parallel but its PR merges after S5's.

### S6-T1 — Confirm the funnel filter shape (research, ~10 min)
Check, against the live project via a throwaway read (Director, key via the existing pattern; or the PostHog docs for `FunnelsQuery` property filters), that a `FunnelsQuery` accepts `source.properties = [{ type: 'event', key: 'demo_audience', operator: 'exact', value: ['prospect'] }]` and `breakdownFilter: { breakdown: 'demo_account', breakdown_type: 'event' }`. Record the confirmed shape in the runbook. If the filter belongs elsewhere (e.g. `filterTestAccounts` or a cohort), change T2's code to match; do not guess.

### S6-T2 — The funnel (AC-PHO-050)
Files: `scripts/posthog/spec/demo.mjs` (S6 owns); test `pmo-portal/src/lib/analytics/demoSpec.test.ts`.
1. **Failing test first:**
```ts
import { SPEC } from '../../../../scripts/posthog/dashboardSpec.mjs';
it('AC-PHO-050 Demo · Money path funnel exists, prospect-only, broken down by account', () => {
  const dash = SPEC.find((d: { dashboard: string }) => d.dashboard.includes('Demo'));
  const ins = SPEC.flatMap((d: { insights: { name: string; query: any }[] }) => d.insights).find((i) => i.name.includes('Money path'));
  expect(ins).toBeTruthy();
  const q = ins!.query.source;
  expect(q.kind).toBe('FunnelsQuery');
  expect(q.series.map((s: { event: string }) => s.event)).toEqual(['project_detail_opened', 'budget_activated', 'purchase_approved', 'invoice_issued']);
  expect(JSON.stringify(q.properties)).toContain('prospect');
  expect(q.breakdownFilter.breakdown).toBe('demo_account');
});
```
(`provision.test.ts` from S0 already proves idempotency over the whole SPEC, so a second run is `+0 / =all`; S6 adds the funnel's presence only.)
2. Red: `npx vitest run src/lib/analytics/demoSpec.test.ts`.
3. Implement `demo.mjs`, appended to the existing **Demo** dashboard by name (`[PMO] Demo · Prospect Funnel`, `provision-dashboards.mjs:197`; insights upsert by name and attach to the dashboard that already exists):
```js
import { funnel } from '../queryBuilders.mjs';
import { NS } from '../queryBuilders.mjs';
export default [{
  dashboard: `${NS} Demo · Prospect Funnel`, description: 'Prospect demo journeys. The money-path funnel shows the furthest step each demo persona can reach by role.',
  insights: [{
    name: `${NS} Demo · Money path (project → budget → purchase → invoice)`,
    query: funnel(['project_detail_opened', 'budget_activated', 'purchase_approved', 'invoice_issued'], {
      properties: [{ type: 'event', key: 'demo_audience', operator: 'exact', value: ['prospect'] }],
      breakdown: { breakdown: 'demo_account', breakdown_type: 'event' },
    }),
  }],
}];
```
Reuse of the existing dashboard: a second spec entry with the same dashboard name must land in the SAME dashboard. The shipped `main()` never recorded a just-created dashboard in `dashByName`, so two entries with one name in one run would create two dashboards; S0-T1 fixes that and tests it.
4. Green: `npx vitest run src/lib/analytics/demoSpec.test.ts src/lib/analytics/provision.test.ts && node scripts/check-dashboard-tiles.mjs`.

### S6-T3 — Heatmap and replay recipe and quota check (FR-PHO-052)
`docs/runbooks/posthog-operations.md` `## S6 Demo funnels` (docs-only; Director pushes direct): (1) list of demo screens to review (Projects list, a project's Budget tab, Procurement board, Receivables); (2) how to open the PostHog toolbar heatmap for those routes and the replay list filtered to `demo_audience = prospect`; (3) the **quota check**: run `node scripts/posthog/check-quota.mjs` (Director, key via the existing pattern) and record `recordings` and `events` as a % of allowance in the Evidence table; heatmaps are not billed against events (`client.ts` comment at `capture_heatmaps`), so only `recordings` needs a figure. (4) FR-PHO-051: which demo persona cannot perform which step by role; the funnel shows the furthest reachable step and the dashboard note says so.

### S6-T4 — AC-PHO-051 (owner verification)
Owner scripted pass as the demo personas through project → budget → purchase → invoice; open the funnel; record the reached steps in the Evidence table (path in `docs/private/`). Not automatable against a third-party SaaS.

---

## 11. Slice S7 — logs (S; **conditional; T1 is a decision gate**)

Covers FR-PHO-060/061, AC-PHO-060. Do **not** start T2 until T1 records "keep".

### S7-T1 — One-hour allowance check (OQ-5; decision recorded, no code)
Director/owner opens the live project's Logs billing page and records: free allowance (GB/month), retention, and the ingestion endpoint/protocol. Rule (OQ-5): if there is no free allowance, or retention is not materially longer than Supabase's, **drop S7**: write the reasons in `## S7 Logs` and close the slice. Otherwise record the endpoint and proceed. (Quota resource names for Logs go into `KNOWN_RESOURCES` only after a **live** capture — slice Q.)

### S7-T2 — Forward the structured error line (AC-PHO-060) — only if kept
Files: create `supabase/functions/_shared/posthogLogs.ts`; modify `supabase/functions/_shared/errorLog.ts` (`logStructuredError`, one added line); test `pmo-portal/src/lib/agent/posthogLogs.test.ts` (Vitest, `Deno` stub like `posthogError.test.ts`).
1. **Failing tests first:**
   - sends one OTLP-shaped log record whose attributes are exactly `{ fn, error_code, context_id?, org_id? }` — assert `Object.keys` equality and that no `console` text, body or message is present;
   - sends **nothing** when the key is unset, **or** when the explicit enable flag is off (the "allowance flagged exhausted / unknown → fail closed" rule, FR-PHO-061), **or** when `Deno` is undefined.
2. Red. 3. Implement `forwardPosthogLog(ctx: PosthogExceptionContext)` mirroring `capturePosthogException` (`posthogError.ts`): Deno guard → key → flag (`Deno.env.get('POSTHOG_LOGS_ENABLED') === 'true'`; a non-secret switch, off by default, recorded as OQ-P10 below) → `fetchBounded` to the endpoint recorded in T1 → swallow. In `logStructuredError` add `void forwardPosthogLog(ctx);` beside the existing `void capturePosthogException(ctx);`. `contextId` is already narrowly typed upstream (`errorLog.ts:StructuredErrorContext`), so no free text can arrive.
4. Green: `npx vitest run src/lib/agent/posthogLogs.test.ts src/lib/agent/posthogError.test.ts`; `bash scripts/deno-typecheck-edge-fns.sh`.

> **OQ-P10 (only if S7 is kept).** The enable flag is a new non-secret environment variable. Default: `POSTHOG_LOGS_ENABLED`, unset = off; set only after S7-T1 recorded a usable allowance. Confirm the name before building.

### S7-T3 — Docs and quota
`## S7 Logs` in the runbook (decision, endpoint, flag, retention) and `docs/analytics-events.md`. Add the live-captured Logs resource name to `KNOWN_RESOURCES` via slice Q (separate commit, after a live capture).

---

## 12. S8 — feature flags: NOT PLANNED

Held (OQ-4, written non-goal in `observability-analytics.spec.md` §1.4). If the owner says yes, plan from FR-PHO-070/071 and AC-PHO-070/071 as a new slice that adds a flag reader to the facade (`analytics/index.ts`) with the local default off; `features.ts` / `org_features` stay the authority. Nothing in S0–S7 blocks it.

---

## 12b. Slice S9 — feedback widget and surveys (owner ruling; builder: Orca worker)

Owner rulings (comment 2 on #1532) and the Director's answers at build time: surveys are **PostHog-native**, with PostHog's own wait period for the 30-day cap; **migration 0419** carries the org Admin switch (org_features key + Admin-only RPC); first-week gate is client-side from `profiles.created_at`; the demo deployment is always on, a real org is on by default and its Admin can switch it off; additive one-line edits to S0-owned files are allowed.

**Design.** Four surveys are created in PostHog by the owner (click-path in `docs/posthog-dashboards.md`), all of type **API** so PostHog never pops one by itself. The SDK is initialised with `disable_surveys_automatic_display: true`; the app decides when to render: `[PMO] Feedback` (widget, user-initiated), `[PMO] Assistant: what went wrong?` (thumbs-down, optional), `[PMO] First core flow` (1-5, after the first budget / invoice / payment / purchase success), `[PMO] NPS` (quarterly, active users). Prompted surveys render only if `canRenderSurvey` (PostHog's wait period, targeting flag and already-seen rules) says so **and** the moment is safe (no open dialog, no focused field, no write in flight, not a create/edit route, quiet for 3 s) **and** the user is past their first week **and** the org switch is on **and** analytics is active (opted-out and Do-Not-Track users never load surveys). Answers carry no record contents: `before_send` redacts every `$survey_response*` string with the same scrubber as exceptions; the context properties passed with a survey are `module`, `route` (template) and, in the assistant, `run_id` / `$ai_trace_id`.

**Known ceiling, recorded in the docs.** The SDK's "any survey in the last N days" wait period is read from this browser's storage, so across devices a person can see one survey per device per 30 days; a survey that is not repeatable is once per person (PostHog person property). A cross-device cap would need a per-user row (not built).

Files (new unless noted): `supabase/migrations/0419_feedback_surveys_switch.sql`, `supabase/tests/0419_feedback_surveys_switch.test.sql`, `pmo-portal/src/lib/analytics/surveys.ts` (+ test), `pmo-portal/src/lib/analytics/surveyPolicy.ts` (+ test), `pmo-portal/src/components/feedback/{FeedbackWidget,SurveyHost,SurveySlot}.tsx` (+ tests), `pmo-portal/src/hooks/useFeedbackSurveys.ts` (+ test), `scripts/posthog/spec/feedback.mjs`. Edited: `client.ts` (init option, survey methods, `before_send`), `features.ts`, `db/orgFeatures.ts`, repositories (`orgFeature.setFeedbackSurveys`), `AdministrationFeatures.tsx`, `AppShell.tsx` (mount), `FeedbackControl.tsx` (follow-up slot), `Privacy.tsx` (one paragraph), and the S0-owned one-liners `dashboardSpec.mjs` (import), docs H2s.

### S9-T1 — Migration 0419 and pgTAP (AC-PHO-090)
Add `'feedback_surveys'` to the `org_features` CHECK; a policy that lets the definer insert/update only that key for the caller's org when the caller is an active org Admin; `admin_set_feedback_surveys(p_enabled boolean)` (security definer, active member, role `Admin`, writes the caller's own org only). Absence of a row = on. pgTAP: Admin of org A turns it off and on; a PM, an Engineer and a Finance user are denied (`42501`); Admin of A cannot touch org B; any other key is still Operator-only; absent row reads as on through the existing `listOwn` select. **Mutation check:** change the role test to `true` and the non-Admin assertions must go red; restore.
### S9-T2 — Entitlement in the app and the Admin switch (AC-PHO-091)
`feedback_surveys` in `FEATURE_KEYS`, `FEATURE_ENV_DEFAULT` (true), `FEATURE_LABELS`; repository `orgFeature.setFeedbackSurveys(enabled)` over the RPC; `useFeedbackSurveysEnabled()` (demo deployment: always true; else the stored row, default true). An Admin-only switch in Administration > Features. Tests drive the user action: Admin flips, RPC called; non-Admin sees a pill only.
### S9-T3 — Survey policy, pure (AC-PHO-092)
`surveyPolicy.ts`: `isPastFirstWeek`, `isSafeMoment` (dialog, focused field, mutations in flight, create/edit route, 3 s quiet), `isActiveUser` (3 distinct days of the last 14), `shouldOfferPrompted`. Table-driven tests; every refusal reason has a case.
### S9-T4 — SDK boundary (AC-PHO-093)
`client.ts`: `disable_surveys_automatic_display: true`; `analyticsClient.surveys` (`find(name)`, `canRender(id)`, `render(id, selector, props)`) all no-ops when not initialised / opted out; `before_send` redacts `$survey_response*`. Tests: init options (real SDK), no-op when opted out, redaction (email, token, long id), non-survey events untouched.
### S9-T5 — Context builder and slots (AC-PHO-094)
`surveys.ts`: names, `buildSurveyContext({ module, route, runId })` returning only string values for allowed keys, `SurveySlot` (renders the PostHog survey into a token-styled container, reports `onDone`).
### S9-T6 — Feedback widget (AC-PHO-095)
A header "Feedback" button (hidden when the switch is off, analytics inactive, or the survey is not published), opening a token-styled panel that hosts `[PMO] Feedback`. Never opens by itself; closes on send or dismiss; Escape and focus return. Tests: opens on click, renders the survey with module and route context, hidden when off.
### S9-T7 — Prompted surveys (AC-PHO-096)
`SurveyHost` mounted once in the shell: subscribes to the four business events through the SDK's capture callback (no edit to the slices that own them), waits for a safe moment, renders `[PMO] First core flow` once; offers `[PMO] NPS` to active users on a safe moment. Tests with fake timers: not during a dialog, a focused field, a pending mutation or a create/edit route; not in week one; not when the switch is off; not when `canRender` says no; shown once.
### S9-T8 — Assistant follow-up (AC-PHO-097)
After the thumbs-down reason is picked, `FeedbackControl` renders `[PMO] Assistant: what went wrong?` with `run_id` and `$ai_trace_id`; optional, dismissible, one per rating. Existing FeedbackControl tests unmodified.
### S9-T9 — Dashboard and gate (AC-PHO-098)
`spec/feedback.mjs`: **[PMO] Feedback & Surveys** (shown / answered / dismissed by survey name, NPS and first-core-flow answer distribution, feedback by module). The SDK-emitted names have spaces, so the tile gate does not parse them; the provisioning test asserts the tiles exist. `node scripts/check-dashboard-tiles.mjs` stays green.
### S9-T10 — Docs and privacy
`docs/analytics-events.md` S9 H2 (SDK-emitted survey events, context keys, ceiling), `docs/posthog-dashboards.md` S9 H2 (survey definitions table, publishing click-path, wait period setting, alert on nothing), `docs/runbooks/posthog-operations.md` S9 H2 (operator checks), one paragraph in `/privacy`.
### S9-T11 — Verify
Local final gate, pgTAP for 0419 under `scripts/with-db-lock.sh`, touched e2e journey, `scripts/ux-proof.sh` on the touched routes. Branch `feat/posthog-s9`.

---

## 13. Traceability — every AC → its one owning test

Layers: **V** Vitest · **D** Deno · **G** CI gate / script test · **O** operator verification (Evidence table in `docs/runbooks/posthog-operations.md`) · **E** Playwright.

| AC | Layer | Owning test (exact path) | Slice |
|---|---|---|---|
| AC-PHO-001 | V | `pmo-portal/src/lib/agent/handlerAiTelemetry.test.ts` — "AC-PHO-001 two rounds + one tool…" | S1 |
| AC-PHO-002 | V | `pmo-portal/src/lib/agent/handlerAiTelemetry.test.ts` — "AC-PHO-002 provider error…" (end-to-end text) **and** `pmo-portal/src/lib/agent/posthogAi.test.ts` (allowlist mutation) — one test file owns the AC per layer rule: the handler test is the owner; the emitter test is its mutation witness | S1 |
| AC-PHO-003 | V | `pmo-portal/src/lib/agent/handlerAiTelemetry.test.ts` — hung / rejecting PostHog vs control | S1 |
| AC-PHO-004 | V | `handlerAiTelemetry.test.ts` (automation) + `pmo-portal/src/lib/agent/composeViewAiTelemetry.test.ts` (compose) | S1 |
| AC-PHO-005 | V | `pmo-portal/src/lib/analytics/events.agent.test.ts` ("AC-PHO-005 …") | S1 |
| AC-PHO-006 | G | `pmo-portal/src/lib/analytics/checkDashboardTiles.test.ts` ("AC-PHO-006 server-emitted tiles…") + `node scripts/check-dashboard-tiles.mjs` | S0 (gate), S1 (tiles) |
| AC-PHO-007 | O | Evidence table row AC-PHO-007 | S1 |
| AC-PHO-010 | O | Evidence table row AC-PHO-010 (fire-drill) | S2 |
| AC-PHO-011 | G | `pmo-portal/src/lib/build/sourcemapPolicy.test.ts` + `pmo-portal/src/lib/build/uploadSourcemaps.test.ts` | S2 |
| AC-PHO-012 | V | `pmo-portal/src/lib/analytics/client.test.ts` ("AC-PHO-012 …") | S2 |
| AC-PHO-020 | D | `supabase/functions/_shared/jobRun.test.ts` (wrapper semantics) + `supabase/functions/{erpnext-sweep,clickup-sweep,clickup-webhook-worker,agent-dispatch,telegram-notify}/jobRun.test.ts` (each shipped handler) | S3 |
| AC-PHO-021 | D | `supabase/functions/erpnext-sweep/jobRun.test.ts` ("AC-PHO-021 …") | S3 |
| AC-PHO-022 | G | `pmo-portal/src/lib/agent/checkEdgeFnErrorReporting.test.ts` ("AC-PHO-022 …") | S3 |
| AC-PHO-023 | O | Evidence table row AC-PHO-023 | S3 |
| AC-PHO-030 | D | `supabase/functions/adapter-dispatch/moneyOutboxDeps.pushOutcome.test.ts` ("AC-PHO-030 …") (+ `_shared/erpPushOutcome.test.ts` for the code rule) | S4 |
| AC-PHO-031 | D | same file ("AC-PHO-031 …") | S4 |
| AC-PHO-032 | D | same file ("AC-PHO-032 …") | S4 |
| AC-PHO-033 | D | same file ("AC-PHO-033 …") + the existing `adapter-dispatch` and `erpnext-sweep` suites **unmodified** | S4 |
| AC-PHO-040 | V | `pmo-portal/src/lib/analytics/business.test.ts` (payload) + the four `*.businessEvent.test.tsx` hook tests (fires once on success) — owner: the four hook tests; `business.test.ts` is the payload witness | S5 |
| AC-PHO-041 | V | the four `*.businessEvent.test.tsx` hook tests ("rejected ⇒ not tracked") | S5 |
| AC-PHO-042 | V | `pmo-portal/src/lib/analytics/business.optOut.realSdk.test.ts` | S5 |
| AC-PHO-043 | G | `checkDashboardTiles.test.ts` + `node scripts/check-dashboard-tiles.mjs` (delete-a-call mutation recorded in the S5 PR) | S5 |
| AC-PHO-050 | G | `pmo-portal/src/lib/analytics/demoSpec.test.ts` + `provision.test.ts` ("AC-PHO-050 provision is idempotent") | S0, S6 |
| AC-PHO-051 | O | Evidence table row AC-PHO-051 | S6 |
| AC-PHO-060 | V | `pmo-portal/src/lib/agent/posthogLogs.test.ts` (conditional) | S7 |
| AC-PHO-070, 071 | — | S8 not planned | — |
| AC-PHO-080 | G | `pmo-portal/src/lib/analytics/quota.test.ts` (live-shape fixture) | Q |
| AC-PHO-081 | E | existing `pmo-portal/e2e/AC-CON-003-analytics-opt-out.spec.ts`, unchanged | — |

**Layer deviation from spec §6 (OQ-P5):** AC-PHO-001..004 are V, not D.
**Where an AC lists two files** one is the owner and the other its mutation witness; the owner is named first. No AC is pushed up a layer.

**FR/NFR coverage notes.** FR-PHO-014 and 015 are runbook items (S2-T5). NFR-PHO-GATE-001 → S0-T3. NFR-PHO-QUOTA-001 → S3-T5 measurement.
NFR-PHO-QUOTA-002 → slice Q. NFR-PHO-MIG-001 → no migration in any slice (a builder who finds one is needed stops and asks).
FR-PHO-024 is partly deferred (OQ-P4).

---

## 14. Definition of done, per slice

1. The slice's failing tests were written first and were seen red (state in the PR).
2. The local final gate (§2) is green on touched files; evidence pasted in the PR.
3. Every mutation check listed for the slice was run and recorded (S1-T2, S1-T6, S3-T4, S4-T3, S5-T4).
4. `docs/analytics-events.md`, `docs/posthog-dashboards.md` and the runbook H2 for the slice are updated (docs-only part pushed direct to `dev` by the Director).
5. No PII, secret value, vault item, tenant id or hostname in any tracked file; no unpatched-weakness detail.
6. No attribution trailers in commit messages; before pushing: `git log --format=%B origin/dev..HEAD | grep -qi co-authored` must find nothing.
7. Browser e2e is **not** run on the dev PR (owner rule 2026-10-30); the only browser proof is the unchanged AC-CON-003.
8. S4 additionally: `security-auditor` + `spec-reviewer` pass, existing money suites unmodified, PR ships alone.
