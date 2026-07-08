# SDD: Agent Model Tuning — an operator-configurable model `temperature` lever

**Feature:** The agent-chat model call (`deepseek/deepseek-v4-flash` via OpenRouter) currently sends **no
`temperature`** — `attemptFetch`'s request body (`openRouterModelClient.ts:88-96`) carries only
`model/max_tokens/messages/tools/tool_choice/provider/usage`, so the provider default (~1.0 for deepseek)
governs sampling. The 2026-07-08 best-practices audit attributes part of the agent's **multi-intent 8-round
thrash** to that undisciplined default: lower temperature makes tool-routing more deterministic. This spec
introduces a single, **operator-configurable** `temperature` knob — **default 0.8** — that an Operator sets
live on the administration surface (no redeploy, no env var), stored org-scoped (org_id seam), read per
request by the edge fn under the deputy (caller-JWT) context, and passed into `modelClient.create()`. It is
a **tuning knob only** — the `deepseek/deepseek-v4-flash` pin stays binding; it never selects another model.

**Spec ID prefix:** AMT (`FR-AMT-###` functional · `NFR-AMT-###` non-functional · `AC-AMT-###` acceptance)
**ADR refs:** ADR-0036 (deputy invariant — run under caller JWT, RLS is sole enforcement, `service_role`
only for `auth.getUser`), ADR-0049 (operator-config surface — `org_features` + `operator_toggle_feature`
pattern this spec mirrors), ADR-0017 (repository seam), ADR-0016 (`can()`/`useIsOperator` is UX-preflight
only; RLS is authority), ADR-0010 (test pyramid), ADR-0001 (org_id seam; single-tenant now, multi-tenant
forward-compatible), ADR-0006 (reversible migrations).
**Layer ownership (ADR-0010):** request-body construction + per-request resolution + admin UI states →
**Unit** (Vitest/RTL, mocked); RLS/Operator-write/org-scoping/range-CHECK → **pgTAP** (`supabase test db`);
the live "set → next turn carries it" cross-stack journey → **E2E** (Playwright). One owning layer each.
**Status:** Draft — 2026-07-08
**Author:** Director (Claude Opus 4.8)

---

## 1. Context & problem

The agent loop (`supabase/functions/agent-chat/handler.ts`, `MAX_TOOL_ROUNDS = 8`) calls the model once per
round (`deps.modelClient.create(...)` at `handler.ts:646`). That call builds its request body inside
`OpenRouterModelClient.attemptFetch` (`openRouterModelClient.ts:88-96`) and **never sets `temperature`**;
`ModelClientParams` (`modelClient.ts:29-35`) has no temperature field at all. The OpenRouter/deepseek default
(~1.0) therefore governs — high enough to inject sampling noise into **tool selection**, which the audit
identifies as a contributor to the multi-intent 8-round thrash (a weaker tool-selector at high temperature
hedged and re-asked instead of committing).

The fix is a **single tuning knob**, not a model change: an optional `temperature` on `ModelClientParams`,
resolved per request from an **operator-configured, org-scoped** value, with a **0.8 default** applied at
read time. The owner asked specifically for a **live lever** (not a hard-coded value, not an env var) so it
can be tuned against real traffic without a redeploy. The storage + authorization shape **mirrors the
existing operator-config pattern** (`org_features` + `operator_toggle_feature`, migration `0070_org_features.sql`,
ADR-0049): Operator-only write via a security-definer RPC + `force row level security`; org-scoped read;
`can()`/`useIsOperator` UX-preflight only. The one structural difference is the value type — `org_features`
is `enabled boolean`; temperature is `numeric` — so this spec introduces a small dedicated
`agent_settings(org_id, setting_key, numeric_value)` table (the smaller reversible migration), reusing the
0070 RLS/RPC shape verbatim.

This is a sibling "model-call quality" concern to `agent-run-persistence-hardening` (ARH, cached_tokens) and
`agent-run-trace-observability` (ATO, the trace read-model): they share the theme but are **distinct config /
observability surfaces** — no shared table, no shared RPC, independently acceptable.

### 1.1 Current-state audit (with file evidence)

| Concern | State | Evidence |
|---|---|---|
| OpenRouter request body | **NO `temperature` sent** | `openRouterModelClient.ts:88-96` — `body: JSON.stringify({ model, max_tokens, messages, tools?, tool_choice?, provider, usage })`; provider default (~1.0 deepseek) governs |
| `ModelClientParams` type | **No temperature field** | `modelClient.ts:29-35` (`model, max_tokens, messages, tools?, tool_choice?, stream?`) |
| Model call site (per round) | **EXISTS** — single choke point | `handler.ts:646` `deps.modelClient.create({ model: deps.model, max_tokens: 2048, messages, tools })` inside `runToolLoop` |
| Org resolution under deputy | **EXISTS** — the read seam | `handler.ts:1125` `orgId = data.org_id` (gate-2 caller-JWT profiles read, `deps.supabase`) |
| Operator-config storage pattern | **EXISTS — mirror it** | `0070_org_features.sql`: `org_features(org_id, feature_key, enabled)` + `operator_toggle_feature` security-definer RPC; `force row level security`; Operator-only `FOR ALL` policy; own-org `SELECT` |
| `is_operator()` SQL fn | **EXISTS** | `0064_platform_operators.sql:39` `function public.is_operator() returns boolean` |
| Operator-only RPC re-assert convention | **EXISTS** | `operator_toggle_feature` (`0070`): entry-guards `is_active_member()` → `is_operator()` → org exists → registry/range check → upsert |
| FE operator gate (UX-preflight) | **EXISTS** | `useIsOperator` (`src/auth/useIsOperator.ts`) — defaults false (fail-closed); RPC re-asserts server-side |
| Operator admin surface | **EXISTS — extend it** | `/administration` route = `AdminUsers.tsx`; Usage (`:424`), Credits (`:435`), Features (`:440`) sections; `ownOrgId` at `:113`; `isOperator` at `:105` |
| Repository seam for operator config | **EXISTS — extend it** | `repositories.orgFeature` (`src/lib/repositories/types.ts:449`) `listOwn()`/`toggle()`; `repositories.operator.isOperator()` |
| `org_features` value type vs temperature | **MISMATCH** — boolean vs numeric | `org_features.enabled boolean` (`0070`) cannot carry `[0,2]`; a dedicated `agent_settings` numeric table is the smaller reversible migration (FR-AMT-007) |
| `compose_view` model call | **SEPARATE path** | `handler.ts:746` `runComposeView(...)` builds its own `ModelClientParams` — explicitly out of scope v1 (non-goal) |

**Verdict:** the wiring seams all exist (request-body builder, per-round call site, deputy org-resolution,
operator-config RLS/RPC pattern, admin surface, repository + hook). What's **NEW** is: (a) the optional
`temperature` field + body inclusion; (b) the per-request org-scoped resolution with 0.8 fallback; (c) the
`agent_settings` table + `operator_set_agent_setting` RPC (a typed twin of 0070); (d) one new admin section
+ repository + hook. No model change, no runtime/event/schema change to `agent_runs`/`agent_events`/`agent_usage`.

---

## 2. Functional Requirements (EARS)

Conventions: **[PARAM]** the model-call parameter · **[RESOLVE]** per-request resolution · **[STORE]**
storage + authz · **[UI]** operator admin surface · **[LIVE]** the live-lever property.

### 2.1 The model-call parameter `[PARAM]` — **NEW (additive)**

**FR-AMT-001** (ubiquitous)
The system SHALL add an **optional** `temperature?: number` field to `ModelClientParams`
(`supabase/functions/_shared/modelClient.ts`) and the `OpenRouterModelClient` SHALL include `temperature` in
the OpenRouter request body **when and only when** it is set — joining the existing body
(`openRouterModelClient.ts:88-96`) as a conditional spread. A caller that does **not** set `temperature`
SHALL produce a byte-identical request body to today (no behavioral change for unaffected callers).

**FR-AMT-002** (ubiquitous — the pin is binding)
This requirement is a **tuning knob only**. The resolved model id (`deepseek/deepseek-v4-flash` via
`resolveDefaultModel`, `index.ts`) is **binding and unchanged**; `temperature` SHALL NOT select, swap, or
fall back to a different model, and SHALL NOT alter `provider:{order:['DeepInfra'],allow_fallbacks:true}`.
Setting `temperature` changes only the sampling parameter of the pinned model.

### 2.2 Per-request resolution `[RESOLVE]` — **NEW**

**FR-AMT-003** (ubiquitous — default 0.8, applied at read time)
The system SHALL apply a **default temperature of 0.8** (a `DEFAULT_AGENT_TEMPERATURE = 0.8` constant) when
the org has **no stored** `agent_temperature` row **or** when the read fails. The default is **not** a stored
row and **not** an environment variable — it is a code constant; the live lever is the stored row
(FR-AMT-006/007). The owner directive ("a live lever, not an env var") is satisfied by the stored-row write
path; the constant is only the unset/error fallback.

**FR-AMT-004** (event-driven — resolve once per run, under the deputy)
When an agent-chat turn begins, **after** `orgId` is resolved under the deputy (caller-JWT gate-2 read,
`handler.ts:1125`), the edge fn SHALL read the org's `agent_temperature` setting via a **single, bounded,
org-scoped** select on `agent_settings` using `deps.supabase` (the caller-JWT client — never `service_role`,
which stays reserved for `auth.getUser` per ADR-0036). The resolved value SHALL be passed as `temperature`
into each `deps.modelClient.create(...)` call in `runToolLoop` (`handler.ts:646`). The resolution SHALL occur
**once per run**, not once per round.

**FR-AMT-005** (state-driven — never blocks the turn)
While the `agent_settings` read is in flight or fails (network error, RLS denial, malformed value), the edge
fn SHALL swallow the failure, apply the 0.8 default (FR-AMT-003), and **continue the turn** — a tuning-read
failure SHALL NEVER terminate the run or surface an error event to the user. The temperature read is
fail-soft by construction.

### 2.3 Storage + authorization `[STORE]` — **NEW (mirrors `0070_org_features.sql`)**

**FR-AMT-006** (ubiquitous — Operator-only write; RLS is authority)
The temperature value SHALL be writable **only by an Operator**, persisted through an Operator-only
security-definer RPC (`operator_set_agent_setting`). **RLS is the enforcement authority** (`agent_settings`
is `enable row level security` + `force row level security`, with an Operator-only `FOR ALL` policy mirroring
`0070`'s `org_features_write`); the FE `useIsOperator` gate and any `can()` check are **UX-preflight only**
(ADR-0016/0049) — a non-Operator SHALL be denied at the database even if the FE control is somehow reached.

**FR-AMT-007** (ubiquitous — org-scoped numeric storage)
The temperature SHALL be stored as a **NUMERIC**, **org-scoped** row in a dedicated
`agent_settings(org_id, setting_key, numeric_value)` table. The `org_id` column SHALL be a foreign key to
`organizations(id) on delete cascade` (the org_id seam, ADR-0001) and the table SHALL reuse the `0070` RLS
shape verbatim: own-org-active-member `SELECT`; Operator-only `FOR ALL`; `force row level security` so the
security-definer RPC owner is itself subject to RLS (exactly like `org_features`). This is the **smaller
reversible migration** versus overloading the boolean `org_features.enabled` (which cannot carry `[0,2]`).

**FR-AMT-008** (event-driven — out-of-range rejected)
When a `numeric_value` outside the OpenRouter range **[0, 2]** is submitted for `agent_temperature`, the
system SHALL reject it. Rejection SHALL occur at **two** boundaries: (a) the **storage boundary** — a
table-level `CHECK` constraining `agent_temperature` to `[0, 2]` (raising errcode `23514`) **and** an
in-RPC range re-assert (defense-in-depth, mirroring `operator_toggle_feature`'s core-key guard); and (b) the
**client boundary** — the admin control SHALL clamp/disable save for out-of-range input (FR-AMT-011). A
rejected write SHALL leave no row change and SHALL surface a clear error (§8).

**FR-AMT-009** (ubiquitous — org-scoped read for the edge fn + FE)
The edge fn (FR-AMT-004) and the admin UI (FR-AMT-010) SHALL read `agent_temperature` via a direct RLS-scoped
select on `agent_settings` (no RPC for reads — mirroring `useOrgFeatures` reading `org_features` directly).
RLS SHALL scope the read to the caller's own org (`org_id = auth_org_id()` + `is_active_member()`), so a
member of org A SHALL NOT read org B's row (NFR-AMT-SEC-004).

### 2.4 Operator admin UI `[UI]` — **NEW (extends `/administration`)**

**FR-AMT-010** (ubiquitous — the control)
The operator administration surface (`/administration`, `AdminUsers.tsx`) SHALL expose a **labeled numeric
control** for the agent temperature, rendered as a new section **alongside** the existing Usage / Credits /
Features operator sections (`AdminUsers.tsx:424-444`). The control SHALL display the **effective** value
(the stored value, or `0.8` with a "(default)" hint when unset), a visible **range hint "0–2"**, and SHALL
use strictly `DESIGN.md` tokens (root 16px font → 32px control; shared primitives).

**FR-AMT-011** (event-driven — Operator edits; non-Operator read-only)
When the viewer **is** an Operator (`useIsOperator === true`), the control SHALL be an editable numeric input
(min `0`, max `2`, step `0.1`) with a Save affordance that calls `operator_set_agent_setting` through the
repository seam (ADR-0017); an out-of-range or empty input SHALL disable Save. When the viewer is **not** an
Operator, the control SHALL render **read-only** (the effective value + a status pill, mirroring
`AdministrationFeatures`'s non-Operator variant) — the permission-denied state is rendered, not a hidden
route (so an org-Admin still sees the effective tuning, just cannot change it).

**FR-AMT-012** (ubiquitous — all UI states)
The control SHALL render every state explicitly: **load** (pending skeleton/placeholder while the read is in
flight), **save** (Save disabled + pending indicator while the mutation runs), **error** (a toast via
`classifyMutationError` mapping `23514` → "Temperature must be between 0 and 2" and `42501` → the shared
permission toast), and **permission-denied** (FR-AMT-011's read-only variant). A successful save SHALL
invalidate the read query so the effective value re-resolves on next paint.

### 2.5 The live-lever property `[LIVE]`

**FR-AMT-013** (ubiquitous — effective next turn, no redeploy)
Changing the temperature SHALL take effect on the **NEXT** agent-chat turn, with **no redeploy and no
function restart** — because the edge fn reads the stored value per request (FR-AMT-004) rather than caching
it at boot. There SHALL be no boot-time snapshot, module-global memo, or Deno-env read of the value inside
the edge fn.

---

## 3. Observed / legacy behavior to preserve (OBS)

**OBS-AMT-001 — The request body today has no `temperature`.** `openRouterModelClient.ts:88-96` builds the
body without it; the provider default (~1.0 for deepseek) governs. FR-AMT-001 is **additive only** — a caller
that omits `temperature` produces the identical body, so `compose_view`, tests, and any future caller are
unaffected until they opt in.

**OBS-AMT-002 — The model pin is binding (memory + audit).** `deepseek/deepseek-v4-flash` via
`resolveDefaultModel` (`index.ts`); `provider:{order:['DeepInfra'],allow_fallbacks:true}`. This spec does
**not** touch either — FR-AMT-002 makes that explicit so a future reader does not mistake "add a temperature
field" for "open model choice."

**OBS-AMT-003 — The operator-config pattern is the mirror.** `0070_org_features.sql` (`org_features` +
`operator_toggle_feature` + `force row level security` + Operator-only `FOR ALL` + own-org `SELECT`) and
ADR-0049. Temperature reuses that exact RLS/RPC/grant shape; the only delta is a `numeric_value` column in
place of `enabled boolean`, which is why a dedicated table (FR-AMT-007) is cleaner than distorting
`org_features`.

**OBS-AMT-004 — The edge fn already does caller-JWT org-scoped reads.** `handler.ts:1125` resolves `orgId`
under `deps.supabase` (the caller-JWT client); the temperature read (FR-AMT-004) slots in there and reuses
that same deputy-scoped client. No new client, no `service_role` on business data.

**OBS-AMT-005 — ARH (cached_tokens) and ATO (trace observability) are siblings, not shared surfaces.** They
share the "model-call quality" theme raised by the 2026-07-08 audit but have **no shared table or RPC** with
this spec. `agent_settings` is owned solely by AMT; `agent_usage` (ARH) and the trace read-model (ATO) are
untouched here.

**OBS-AMT-006 — `compose_view` is a separate model-call path.** `handler.ts:746` `runComposeView(...)` builds
its own `ModelClientParams`. Applying temperature there is an Open Question (§10), explicitly **out of scope
v1** (non-goal NG-AMT-003).

---

## 4. Non-Functional Requirements

### 4.1 Security (OWASP / STRIDE)

- **NFR-AMT-SEC-001 — Non-Operator write is denied by RLS; RLS is the authority.** `agent_settings` is
  `force row level security` with an Operator-only `FOR ALL` policy, and `operator_set_agent_setting`
  re-asserts `is_active_member()` → `is_operator()` → org-exists → registry → range before upsert (mirroring
  `operator_toggle_feature`). A non-Operator cannot INSERT/UPDATE/DELETE the row even with the FE control
  bypassed. **Proven by pgTAP** (AC-AMT-004). STRIDE-E (elevation) closed.
- **NFR-AMT-SEC-002 — The deputy invariant is preserved.** The edge fn temperature read uses `deps.supabase`
  (caller-JWT), never `service_role`; `service_role` remains only for `auth.getUser` (ADR-0036, `index.ts`).
  The temperature value is a **model-call parameter**, never an authorization input — it cannot widen a
  read scope, choose a row, or bypass a `can()` gate. STRIDE-S (spoofing/tenancy) unchanged.
- **NFR-AMT-SEC-003 — The model pin cannot be subverted via the knob.** `temperature` never selects a model
  (FR-AMT-002); an out-of-range value is rejected before it reaches the model (table CHECK + RPC +
  client clamp, FR-AMT-008/011). STRIDE-T (tampering) closed.
- **NFR-AMT-SEC-004 — Org-scoped (org_id seam).** RLS scopes reads/writes to `org_id = auth_org_id()` +
  active membership; a member of org A cannot read or write org B's row. A future multi-tenant deploy is
  **unaffected** — each org carries its own row, keyed by the FK'd `org_id`. **Proven by pgTAP**
  (AC-AMT-009). ADR-0001 preserved.

### 4.2 Performance

- **NFR-AMT-PERF-001 — One bounded select per run, fail-soft.** The edge fn adds **exactly one** single-row
  select per run (by `org_id` + `setting_key`, resolved once — not per round), after org resolution. The read
  is fail-soft (0.8 fallback, FR-AMT-005) so it never blocks the turn or meaningfully extends the ~150s edge
  wall-clock. No new network hop beyond the existing Supabase client.

### 4.3 Operability

- **NFR-AMT-OPS-001 — Live lever; reversible migration.** A temperature change is effective on the next turn
  with no redeploy (FR-AMT-013). The migration is **reversible** (`supabase db reset`, or manual drop of
  RPC → policies → table) and **RLS- and org_id-seam-preserving** (§6 migration description). No data
  backfill is required (absence = 0.8 default).

### 4.4 Accessibility (WCAG 2.1 AA)

- **NFR-AMT-A11Y-001 — The numeric control is labelled and operable.** The input has a programmatic label
  ("Agent temperature"), the range hint is associated text, and Save is a named button. The read-only
  non-Operator variant conveys the same value via a status pill (no information hidden from assistive tech).
  Matches the existing `AdministrationFeatures` control a11y posture.

---

## 5. Acceptance Criteria (Given/When/Then)

> Layer per ADR-0010: **Unit** (Vitest/RTL, mocked) for request-body construction, per-request resolution,
> and admin-UI states; **pgTAP** (`supabase test db`) for RLS/Operator-write/range-CHECK/org-scoping; **E2E**
> (Playwright) for the single cross-stack "live lever" journey. One owning layer per AC.

### The model-call parameter

**AC-AMT-001 — `temperature` is sent when set and omitted when unset. [Unit]**
Given an `OpenRouterModelClient` with a fetch mock,
When `create({ ..., temperature: 0.6 })` is called,
Then the posted body's JSON contains `"temperature": 0.6`; and given `create({ ... })` with **no**
`temperature`, the posted body contains **no** `temperature` key (byte-identical to today) — asserting
FR-AMT-001 and that the change is additive (no regression for callers that opt out).

### Per-request resolution

**AC-AMT-002 — The edge fn resolves the configured temperature and falls back to 0.8 on absence/error.
[Unit]**
Given a `runToolLoop` with `deps.supabase` mocked to return `{ numeric_value: 0.5 }` for the
`agent_temperature` row,
When the first `modelClient.create` is invoked,
Then it is called with `temperature: 0.5`; and given the mock returns **no row** (absence), it is called
with `temperature: 0.8` (the `DEFAULT_AGENT_TEMPERATURE`); and given the mock **throws**, it is STILL called
with `temperature: 0.8` and the run does NOT emit an error event — asserting FR-AMT-003/004/005 (read once,
fail-soft, never blocks).

### Storage + authorization

**AC-AMT-003 — Out-of-range values are rejected at the storage boundary. [pgTAP]**
Given an Operator in org O,
When `operator_set_agent_setting(O, 'agent_temperature', 2.5)` (and `-0.1`) is invoked,
Then the RPC raises errcode `23514` (range violation) and **no row** is inserted/updated — asserting the
table `CHECK` + RPC re-assert (FR-AMT-008).

**AC-AMT-004 — A non-Operator cannot write the setting (RLS is authority). [pgTAP]**
Given a non-Operator active member of org O,
When they attempt `INSERT`/`UPDATE`/`DELETE` on `agent_settings` directly AND invoke
`operator_set_agent_setting`,
Then the direct writes are denied by RLS (0 rows affected) AND the RPC raises errcode `42501`
(`operator_only`) — asserting FR-AMT-006 and NFR-AMT-SEC-001 (RLS, not the FE, is the authority).

**AC-AMT-009 — The setting is org-scoped (org_id seam). [pgTAP]**
Given a member of org A and a stored `agent_temperature` row for org B,
When the org-A member reads `agent_settings`,
Then they see **only** org A's rows (org B's row is invisible); and an Operator's write to org B does not
leak into org A — asserting FR-AMT-009 and NFR-AMT-SEC-004 (cross-org isolation; multi-tenant-safe).

### Operator admin UI

**AC-AMT-005 — The control renders with the 0.8 default + range hint, DESIGN.md tokens. [Unit]**
Given an Operator views `/administration` with **no** stored `agent_temperature` row,
When the Agent section renders,
Then a labelled numeric control shows `0.8` with a "(default)" hint and a "0–2" range hint, using DESIGN.md
tokens — asserting FR-AMT-010 (effective value + default distinction).

**AC-AMT-006 — An Operator can change and save the temperature. [Unit]**
Given an Operator with the control editable,
When they enter `0.7` and click Save,
Then `operator_set_agent_setting` is called via the repository seam with `(orgId, 'agent_temperature', 0.7)`,
a success toast shows, and the read query is invalidated (effective value re-resolves to `0.7`) — asserting
FR-AMT-011/012.

**AC-AMT-007 — A non-Operator sees the read-only / permission-denied variant. [Unit]**
Given a non-Operator org-Admin views `/administration`,
When the Agent section renders,
Then the temperature is shown read-only (a status pill with the effective value), there is **no** editable
input / Save affordance, and no mutation is possible from the FE — asserting FR-AMT-011/012
(permission-denied state rendered, not a hidden route).

**AC-AMT-008 — Out-of-range input is rejected client-side before submit. [Unit]**
Given an Operator types `3` (or `-1`) into the control,
When the input is evaluated,
Then Save is **disabled** and no RPC call is made; submitting an empty input is also blocked — asserting
FR-AMT-008 (client boundary) and preventing a round-trip the server would reject anyway.

### The live lever (cross-stack)

**AC-AMT-010 — Changing temperature takes effect on the NEXT turn, no redeploy. [E2E]**
Given an Operator sets the temperature to `0.4` on `/administration` (the RPC writes the row),
When any user opens the panel and sends the next chat message in the same deployment (no redeploy),
Then the agent-chat turn's model request carries `temperature: 0.4` (asserted at the OpenRouter boundary
via a route/intercept in the e2e fixture) — asserting FR-AMT-013 and NFR-AMT-OPS-001 (per-request read,
no boot snapshot).

---

## 6. Traceability

| AC | Owning layer | Owning test (name / file) |
|---|---|---|
| AC-AMT-001 | Unit | `AC-AMT-001 temperature sent when set, omitted when unset` (`supabase/functions/_shared/openRouterModelClient.body.test.ts` — fetch mock asserts the JSON body) |
| AC-AMT-002 | Unit | `AC-AMT-002 resolves configured temperature, 0.8 fallback on absence/error` (`supabase/functions/agent-chat/handler.temperature.test.ts` — mocks `deps.supabase` + asserts `modelClient.create` arg; ADR-0039 §7 importable handler) |
| AC-AMT-003 | pgTAP | `AC-AMT-003 out-of-range rejected at storage boundary` (`supabase/tests/agent_settings.pgtap.sql`) |
| AC-AMT-004 | pgTAP | `AC-AMT-004 non-Operator cannot write (RLS authority)` (same file) |
| AC-AMT-005 | Unit | `AC-AMT-005 control renders 0.8 default + range hint` (`pmo-portal/pages/__tests__/Administration.agentSettings.test.tsx`) |
| AC-AMT-006 | Unit | `AC-AMT-006 Operator changes + saves` (same file) |
| AC-AMT-007 | Unit | `AC-AMT-007 non-Operator read-only` (same file, `isOperator=false`) |
| AC-AMT-008 | Unit | `AC-AMT-008 out-of-range rejected client-side` (same file) |
| AC-AMT-009 | pgTAP | `AC-AMT-009 org-scoped cross-org isolation` (`supabase/tests/agent_settings.pgtap.sql`) |
| AC-AMT-010 | E2E | `AC-AMT-010 set → next turn carries new temperature` (`pmo-portal/e2e/AC-AMT-010-temperature-live-lever.spec.ts` — intercepts the OpenRouter request) |

---

## 7. SoD & Security (OWASP / STRIDE)

**Elevation / Operator-only write (STRIDE-E, OWASP A01).** The new write surface is
`operator_set_agent_setting`, a security-definer RPC that re-asserts `is_active_member()` → `is_operator()`
→ org-exists → registry → range before upsert — a typed twin of `operator_toggle_feature` (`0070`). RLS is
the authority: `agent_settings` is `force row level security` with an Operator-only `FOR ALL` policy, so a
non-Operator cannot write even with the FE control bypassed (NFR-AMT-SEC-001, AC-AMT-004). This is **not
SoD** in the approver≠author sense (ADR-0019) — there is no two-person rule; it is a single Operator power,
enforced the same way the existing Operator powers (feature toggle, credit grant) are. The FE
`useIsOperator` gate is UX-preflight only (ADR-0016/0049) — the RPC + RLS re-assert is the boundary.

**Tampering / model pin (STRIDE-T).** `temperature` is a sampling parameter only; it cannot select a model,
swap providers, or bypass the `deepseek/deepseek-v4-flash` pin (FR-AMT-002, NFR-AMT-SEC-003). An
out-of-range value is rejected at the table `CHECK` + RPC re-assert + client clamp **before** it reaches
the model (FR-AMT-008) — so a forged/careless value cannot push the model into an undefined sampling state.

**Spoofing / tenancy / deputy (STRIDE-S, ADR-0036).** The deputy invariant is untouched: the edge fn
read uses the caller-JWT client (`deps.supabase`), **never** `service_role`; `service_role` stays reserved
for `auth.getUser` (NFR-AMT-SEC-002). The temperature value is a **model-call parameter, never an
authorization input** — it cannot widen a read scope, choose a row, or bypass a `can()` gate. Reads are
org-scoped by RLS (`org_id = auth_org_id()`), so a cross-org probe yields nothing (NFR-AMT-SEC-004,
AC-AMT-009) and a future multi-tenant deploy is unaffected.

**Repudiation (STRIDE-R).** `agent_settings.updated_at` + `updated_by` stamp every write (mirrors
`org_features`), so who-changed-temperature-when is auditable from the row itself.

**Depth note (security-auditor model-tiering).** This change is **config-surface + new-table + new-RPC
bearing**. The auditor should focus depth on: (a) the `force row level security` + Operator-only `FOR ALL`
policy + security-definer RPC re-assert triad — the elevation surface, an exact mirror of `0070` that must
not drift (the `force RLS` trap where the RPC owner needs the `FOR ALL` policy to write its own upsert);
(b) the range `CHECK` as a tampering guard on the model-call boundary; (c) confirming the edge fn read is
caller-JWT (`deps.supabase`), not `service_role`. Lighter than a full SoD / destructive-delete issue, but
the new RPC + table is a genuine elevation surface that must be **pgTAP-proven** (AC-AMT-003/004/009), not
waved through on the FE gate alone.

---

## 8. Migration description (reversible · RLS-preserving · org_id-seam-compatible)

> Described, not written. The eng-plan writes the SQL; this is the binding shape. Mirrors
> `0070_org_features.sql` for the RLS/RPC/grant pattern; the only delta is a numeric value column.

**Table `public.agent_settings`:**
- `org_id uuid not null references public.organizations(id) on delete cascade`
- `setting_key text not null`
- `numeric_value numeric not null`
- `updated_at timestamptz not null default now()`
- `updated_by uuid references public.profiles(id)`
- `primary key (org_id, setting_key)`
- **Registry CHECK:** `setting_key in ('agent_temperature')` (forward-compatible: future agent settings add
  their key here).
- **Range CHECK:** `setting_key = 'agent_temperature' and numeric_value between 0 and 2` (key-aware, tight).
- Index `agent_settings_org_idx on (org_id)` (mirrors `org_features_org_idx`).

**RLS (verbatim 0070 shape):**
- `alter table public.agent_settings enable row level security;`
- `alter table public.agent_settings force row level security;`
- **SELECT** `for select using (org_id = public.auth_org_id() and public.is_active_member())` — every member
  reads their own org (a tuning setting is not an intra-org secret; mirrors `org_features_select`).
- **FOR ALL** `using (public.is_operator() and public.is_active_member()) with check (public.is_operator()
  and public.is_active_member())` — the sole write path for the security-definer RPC owner (mirrors
  `org_features_write`; `force RLS` means the table owner needs this policy to write).

**RPC `public.operator_set_agent_setting(p_org_id uuid, p_setting_key text, p_numeric_value numeric)
returns void`:** `security definer set search_path = public`, mirroring `operator_toggle_feature`:
1. `if not public.is_active_member() then raise 'inactive' (42501)`;
2. `if not public.is_operator() then raise 'operator_only' (42501)`;
3. `if p_setting_key not in ('agent_temperature') then raise 'unknown_key' (P0001)` (registry guard);
4. `if p_setting_key = 'agent_temperature' and (p_numeric_value < 0 or p_numeric_value > 2) then raise
   'out_of_range' (23514)` (defense-in-depth alongside the table CHECK);
5. `if not exists (select 1 from organizations where id = p_org_id) then raise 'unknown_org' (23503)`;
6. `insert ... on conflict (org_id, setting_key) do update set numeric_value, updated_at, updated_by`.
- `revoke all from public; grant execute to authenticated;`

**Reversibility (ADR-0006):** `supabase db reset` recreates from scratch; manual reverse is
`drop function operator_set_agent_setting; drop policy ... on agent_settings; drop table agent_settings;`.
**No backfill** — absence = 0.8 default (FR-AMT-003). **RLS + org_id seam preserved** (every policy is
org-scoped; `org_id` FK + `force RLS`).

---

## 9. Error Handling

| Error condition | Surface / behavior | User outcome |
|---|---|---|
| No stored `agent_temperature` row (unset) | Read returns null → `DEFAULT_AGENT_TEMPERATURE` 0.8 applied (FR-AMT-003); UI shows "0.8 (default)" | Agent runs at 0.8; UI distinguishes "default" from explicit |
| `agent_settings` read fails in the edge fn (network/RLS/malformed) | Swallowed → 0.8 fallback; no error event (FR-AMT-005) | Turn proceeds normally at 0.8; user is unaware |
| Operator submits value outside [0, 2] | Client: Save disabled (FR-AMT-011); if it reaches the RPC: `23514` → "Temperature must be between 0 and 2" toast | No write; value not changed |
| Non-Operator attempts to write | FE hides the editable control (FR-AMT-011); if reached: RLS denies + RPC `42501` → permission toast | Read-only; no write |
| Unknown `setting_key` (future-proofing / typo) | RPC `P0001` `unknown_key` | No write; surfaces a developer error |
| Read returns a value but the org_id seam mismatches (future multi-tenant) | RLS scopes to `auth_org_id()` → caller sees only their org (FR-AMT-009) | Per-org isolation; unaffected |

---

## 10. Non-goals (explicitly out of scope)

- **NG-AMT-001 — Changing the model pin.** `deepseek/deepseek-v4-flash` is binding (memory + audit). This
  spec adds a sampling parameter; it never selects, swaps, or falls back across models
  (FR-AMT-002). Cross-model fallback is explicitly unwanted.
- **NG-AMT-002 — Other model-call parameters** (`top_p`, `presence_penalty`, `frequency_penalty`,
  `max_tokens` tuning, stop sequences). Out — **one knob** (temperature) is the owner-directed v1 scope.
  The `agent_settings` table is shaped to allow future keys, but none are specced here.
- **NG-AMT-003 — Applying temperature to `compose_view`'s model call** (`handler.ts:746` `runComposeView`).
  Out v1 — it is a separate single-call path; applying the same resolved value is Open Question #1, not
  committed scope.
- **NG-AMT-004 — A general-purpose app-settings table** (non-numeric values, arbitrary JSON). Out — the
  table is `numeric_value` typed and registry-CHECK'd to `agent_temperature`; broadening it is a future
  issue if more setting types are needed.
- **NG-AMT-005 — Per-user or per-thread temperature** (vs per-org). Out — the owner-directed lever is
  org-scoped (one tuning for the deployment's org); per-user variation is a separate, larger concern.
- **NG-AMT-006 — A/B experiments / eval harness for temperature.** Out — those belong to the
  `agent-native-gap-analysis` follow-ups (the eval-harness item), not this config surface. The e2e
  (AC-AMT-010) proves the lever wires through; it does not assert a quality outcome.

---

## 11. Open Questions for the owner

1. **`compose_view` — apply temperature there too?** FR-AMT-004/005 scope the resolved temperature to the
   `runToolLoop` `modelClient.create` calls (the thrash source). `compose_view` (`handler.ts:746`) is a
   separate single-call path. Applying the same resolved value there is consistent (same model, same deputy
   context) but is **out of scope v1** (NG-AMT-003). Include it in v1, or keep scoped to the main loop?
   (Recommendation: keep scoped v1 — the audit's thrash finding is the main loop; compose is a one-shot.)
2. **Default 0.8 as a hard constant vs a deploy-time override.** FR-AMT-003 makes 0.8 a code constant (the
   owner wants a live lever, not an env var). Confirm a hard-coded `DEFAULT_AGENT_TEMPERATURE = 0.8` is
   acceptable as the unset/error fallback (the live lever is still the stored row, not the constant).
3. **Table shape — confirm the dedicated `agent_settings` table.** FR-AMT-007 chooses a dedicated numeric
  `agent_settings(org_id, setting_key, numeric_value)` over overloading the boolean `org_features.enabled`
  (which cannot carry `[0,2]`). Confirm the dedicated table is preferred (it is the smaller reversible
  migration and keeps `org_features` semantically boolean).
4. **"Default" vs "explicit 0.8" in the UI.** FR-AMT-010/AC-AMT-005 distinguish unset (shows "0.8
  (default)") from an explicitly-stored 0.8. Does the owner want that distinction visible, or should the
  control simply show the effective number with no default marker? (Recommendation: keep the marker — it
  tells the Operator they have not yet asserted a value.)
5. **Default value itself — is 0.8 right?** The audit suggests lower-than-1.0 for more deterministic tool
  routing; 0.8 is a conservative starting point. Confirm 0.8, or pick a different default (e.g. 0.5 for
  stricter determinism). The constant is one line to change pre-merge.

---

## 12. Contradictions / conflicts flagged against existing code & locked decisions

None against ADR-0036/0049/0017/0016/0010/0001/0006 — this spec operates strictly inside their boundaries
(deputy invariant, operator-config pattern, repository seam, RLS-as-authority, test pyramid, org_id seam,
reversible migrations). Facts worth flagging for the eng-plan (none is a contradiction):

1. **`ModelClientParams` has no `temperature` today** (`modelClient.ts:29-35`). FR-AMT-001 adds it as an
   optional field; the change is additive and type-checks cleanly against existing callers
   (`agent-chat` `runToolLoop`, `compose_view`, tests).
2. **The request body is built once, in `attemptFetch`** (`openRouterModelClient.ts:88-96`). `temperature`
   joins as a conditional spread (`...(params.temperature !== undefined ? { temperature: params.temperature
   } : {})`), mirroring the existing `tools`/`tool_choice` conditional spreads — no structural change.
3. **The model call is at `handler.ts:646`; `orgId` resolves at `:1125`.** The temperature read (FR-AMT-004)
   must execute **after** `:1125` and **before** the first round's `modelClient.create` at `:646` — the
   eng-plan confirms `runToolLoop` is called with the resolved temperature in scope (likely a `runToolLoop`
   param or a closure variable, not a `HandlerDeps` field, since it is per-run not per-deployment).
4. **`org_features` is boolean; temperature is numeric** — the reason for the dedicated table (FR-AMT-007).
   Do not attempt to overload `org_features.enabled`; the CHECK registry there is a fixed gatable-key set
   (`0070`) and the column is `boolean not null`.
5. **`force row level security` on `agent_settings` means the security-definer RPC owner needs the
   Operator-only `FOR ALL` policy to write** — mirror `0070`'s `org_features_write` exactly; omitting it
   silently denies the RPC's own upsert (the 0070 comment documents this trap).
6. **Sibling ARH/ATO specs may not exist yet at build time.** This spec is self-contained and does not
   depend on them; if they land first, confirm no `agent_settings`-shaped table is introduced there (AMT
   owns `agent_settings`).
