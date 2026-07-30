# Analytics Events

PMO Portal uses PostHog for a thin analytics foundation and deployed prospect-demo instrumentation.
Application code must go through `pmo-portal/src/lib/analytics/*`; direct `posthog-js` imports are
allowed only in `pmo-portal/src/lib/analytics/client.ts`.

## Runtime Modes

Analytics initializes only when `VITE_DEMO_MODE=true` or `VITE_ANALYTICS_ENABLED=true`.

| Mode | Route events | Explicit events | Replay | Autocapture |
|---|---:|---:|---:|---:|
| Local/default | No | No | No | No |
| Analytics enabled | Yes | Yes | No | No |
| Internal deployed demo (`?da=internal`) | Yes | Yes | No | No |
| Prospect deployed demo (`?da=prospect` or `?da=<slug>`) | Yes | Yes | Yes | Click-only links/buttons |

`demo_audience` and `demo_account` are safe session labels. They are not tenant boundaries, auth
inputs, or PostHog Group Analytics. Supabase RLS remains the tenant boundary.

## Safe Properties

Allowed event properties are low-cardinality metadata: route pattern, module, role, org id, demo
audience/account, method, reason code, tab id, filter id, state id, form id, operation, entity type,
and counts.

Never send:

- email, person name, company name, project name, procurement title, notes, comments, file names, or
  free-text search query content
- raw UUID path segments or URL query strings
- contract value, budget amount, spend amount, or other business values
- passwords, auth tokens, refresh tokens, headers, request bodies, or response bodies

`buildEventProperties()` rejects forbidden keys in development/test and drops them in production.

## Common Context (Super Properties)

Every event automatically includes these properties via `posthog.register()`:

| Property | Meaning |
|---|---|
| `environment` | `local`, `demo`, `prod`, or equivalent from app env/config |
| `demo_audience` | `prospect`, `internal`, or omitted outside demo mode |
| `demo_account` | Safe slug such as `default`, `local`, `comp1`; never real company name |
| `role` | Auth/profile role when available |

These are registered once at init and re-registered after identity reset. They do not need to be
passed explicitly per-event.

## First-Slice Events

`role` on most rows below is not a per-call argument — it rides the `role` super-property already
registered by `AnalyticsProvider` at `identify()` (see Common Context above) and is attached to every
event automatically. Facade helpers only take an explicit `role` where the underlying event builder was
already defined with one (`empty_state_seen`).

### Wired (calling the facade from a real UI boundary — 2026-07-13, `docs/plans/2026-07-13-wire-engagement-friction-events.md`)

| Event | Purpose | Boundary | Safe properties |
|---|---|---|---|
| `demo_persona_selected` | Demo persona interest | `LoginPage` | `persona_role`, `demo_audience`, `demo_account` |
| `app_route_viewed` | Navigation interest | `AnalyticsProvider` (every route change) | `route`, `module`, `role` |
| `auth_login_succeeded` | Activation / session start | `AuthProvider` / `LoginPage` / `UpdatePasswordPage` | `method` |
| `auth_login_failed` | Demo / auth friction | same as above | `method`, `reason_code` |
| `auth_logout_succeeded` | Session end | `AuthProvider.signOut` | *(none — role rides the super-property)* |
| `project_detail_opened` | Project interest | `pages/Projects.tsx` (table/cards/kanban/calendar) | `route` (pattern), `source` (`list`\|`card`) |
| `project_tab_viewed` | Feature interest | `pages/project-detail/ProjectDetail.tsx` `setTab` | `tab_id` (SAFE_TAB_ID-normalized) |
| `procurement_detail_opened` | Procurement interest | `pages/Procurement.tsx` (board) + `ProcurementListRow` (table) | `route` (pattern), `source` |
| `filter_applied` | Workflow behavior | Companies / Projects (status, customer, PM) / Procurement / Incidents status filters | `filter_id`, `option_count`, `module` |
| `search_used` | Discovery behavior | `SearchMini` (`src/components/ui/DataTable.tsx`), debounced 500ms/Enter | `search_surface`, `result_count`, `module` |
| `coming_soon_clicked` | Demand signal | `VendorQuotesTab` (Attach file) + `ExecutiveDashboard` (Board pack) | `feature_id`, `module` |
| `form_validation_failed` | UX friction | `useEntityForm.handleSubmit` (validation-fail branch) | `form_id`, `field_count`, `reason_code`, `module` |
| `empty_state_seen` | Adoption / data gaps | `ListState` (`variant="empty"`, on mount) — instrumented on Companies, Projects, Procurement, Incidents, Contacts (the primary directory/list index pages; not every `ListState` empty render — see note) | `state_id`, `role`, `module` |

**`empty_state_seen` coverage note (FIX 1, 2026-07-13):** the shared boundary lives in `ListState.tsx`
and is opt-in (`stateId`/`role`/`module` all required to fire). It is currently wired only at the 5
primary "no records at all" empty states listed above — `companies-empty`, `projects-empty`,
`procurement-empty`, `incidents-empty`, `contacts-empty`. It is **not** wired at every `ListState
variant="empty"` render in the app: DataTable's own internal "no results match your filters" empty
render, and secondary list pages (SalesPipeline, MyTasks, Timesheets/ApprovalsQueue, AdminUsers, etc.)
are still dark. Each is the same 3-line addition (`stateId`/`role={realRole}`/`module`) as a fast-follow.

### Friction (central) — ADR-0067

| Event | Purpose | Boundary | Safe properties |
|---|---|---|---|
| `save_failed` | Reliability / UX friction, ONE per user-visible mutation error | `classifyMutationError` (`pmo-portal/src/lib/classifyMutationError.ts`) — the single point where "a classified mutation error was shown to the user" is reliably knowable | `failure_class` (the classification slug — `illegal_transition`, `permission_denied`, `duplicate`, `in_use`, `timeout`, `override`, or `unclassified`; renamed from `entity_type` 2026-07-27 — the property never carried an entity type), `operation`, `reason_code` (the Postgres/PostgREST code, e.g. `42501` — **bounded**, see note below), `module` |
| `bulk_import_failed` | Reliability / UX friction for a BULK COMMIT RUN (an import wizard or procurement-cycle commit), aggregated PER CLASSIFICATION | `trackBatchSaveFailed` (`classifyMutationError.ts`), called once after a per-row/per-record loop | `module`, `failure_class`, `failed_count` (how many rows/records in THIS run landed in this classification bucket) |

⚑ **`module`/`operation` are constants (`unknown`/`classify`), not yet real dimensions.** No
current call site threads a real `module`/`operation` into `classifyMutationError`'s context —
every `save_failed`/`bulk_import_failed` event today carries `module: 'unknown'` (or the bulk
caller's own module id) and `operation: 'classify'` until callers are threaded to pass real
values. **Do not break down a PostHog explorer view by `module` or `operation` yet** — you will
see ~100% `unknown`/`classify` and it is easy to misread that as "nobody uses any other module",
which is a fact about instrumentation coverage, not product usage.

**`reason_code` is bounded, not passed through (SECURITY finding, 2026-07-27).** `.code` is typed
`string | undefined` and at least one real path (`src/lib/db/adminUsers.ts:103`) reads it straight
from an external/edge-fn response body, which can carry arbitrary text. `boundReasonCode` (in
`classifyMutationError.ts`) only lets a reviewed allowlist of known codes, or a shape structurally
too short to hold free text (a genuine Postgres SQLSTATE, an HTTP status, a PostgREST error code),
through verbatim; anything else — including a raw external error message — collapses to the
literal string `'other'`. A new custom application error code must be added to
`KNOWN_REASON_CODES` explicitly; it does not flow through by default.

**`save_failed` was previously wired at `useEntityForm.handleSubmit` and was INERT there for two years**:
no caller ever passed `entityType`, and every form's `onValid` swallows its own error without
rethrowing, so the hook's catch never ran. The obvious fix (thread the missing prop) would still have
produced zero events, since the rejection never reaches the hook. Moved instead (2026-07-25, ADR-0067)
to `classifyMutationError`, which has 40+ call sites versus 17 entity forms, already extracts the error
`.code`, and is by construction "the errors the user was actually shown" — the friction signal itself.
The old `useEntityForm` producer was deleted; there is exactly one producer of `save_failed` now.

**`bulk_import_failed` is a DISTINCT event from `save_failed`, not a `failed_count` bolted onto it
(code-quality review, 2026-07-27).** `save_failed`'s "Save failures by reason" tile counts EVENTS —
a lump `failed_count` under `save_failed` would make a 5,000-row import failure contribute exactly
1 to whichever bucket it landed in, indistinguishable from a single real failure, and would discard
the per-row reason distribution entirely (you could no longer tell whether a wholesale import
failure was RLS-denied vs duplicate-keyed). `bulk_import_failed` fires ONE event PER NON-ZERO
CLASSIFICATION BUCKET per commit run instead — at most 7 events (the friction classification has 7
values), which stays quota-safe *and* keeps the reason distribution answerable. Loop call sites
(`useImportWizard.commit`, `procurementCycle/commit.ts`'s `commitGroups`) suppress their own
per-row `save_failed` capture (`{ suppressCapture: true }`) and tally the classification instead.

**`permission_denied_seen` was removed (2026-07-25, ADR-0067)** — it had zero call sites (never wired to
a UI boundary) yet had a provisioned dashboard tile, which renders a permanently-empty chart that reads
as a product fact ("nobody hits this") rather than the broken measurement it actually was. Its signal is
answerable from the `save_failed` breakdown filtered to `reason_code = 42501`.

Allowed values: enums, route patterns, role names, module ids, safe slugs, bounded counts/durations,
status/reason codes, booleans.

Forbidden values: raw user-entered strings, raw UUID paths, raw query strings, raw DB rows, names,
emails, phone numbers, addresses, company/project/procurement names, monetary values, notes, comments,
file names, file contents, request/response bodies, and auth tokens.

### ⚑ PostHog's built-in path/URL views are empty by design (2026-07-27 SECURITY finding)

posthog-js attaches `$current_url`, `$pathname`, `$initial_current_url`, `$session_entry_url`, and
`$session_entry_pathname` to **every** captured event automatically, straight from
`window.location` — independent of whatever properties the app passes. Every one of these carries
the **raw, unparameterized** path (e.g. `/projects/550e8400-e29b-41d4-a716-446655440000`, not
`/projects/:projectId`), which is a raw record UUID and forbidden by this doc's own rule above.
All five are denylisted (`FORBIDDEN_PROPERTY_KEYS` in `src/lib/analytics/events.ts`, verified
against the real, unmocked SDK in `client.currentUrlLeak.realSdk.test.ts` — not a config-only
assertion, which is exactly the class of check that missed the earlier `capture_dead_clicks` leak).

**This is a deliberate, real trade-off, not just an implementation detail:** PostHog's built-in
**Web Analytics** dashboard and the **Paths**/**$pageview**-style explorer views are populated
FROM these exact properties. With them stripped, those built-in views will read **empty** for
this project — permanently, by design. Route-level navigation signal is still fully available via
our own `app_route_viewed` event's `route` property (the parameterized pattern,
`routeAnalyticsForPath`), and that is the intended replacement — it is just not the same UI
surface as PostHog's out-of-the-box Web Analytics tab.

## Demo funnel (FR-PHG-020/021)

The prospect-demo funnel — land → persona selected → login → first module opened → last module before
exit — is answerable end-to-end from existing events, provisioned as `[PMO] Demo · Prospect Funnel`
(`scripts/posthog/provision-dashboards.mjs`): a `demo_persona_selected → auth_login_succeeded →
app_route_viewed` funnel, plus breakdowns of `demo_persona_selected` (by `persona_role`),
`app_route_viewed` (by `route`), and `coming_soon_clicked` (by `feature_id`) — the latter two already
fired with **no tile** before this slice, i.e. free signal that was being collected and never looked at.

**"Last module before exit" is deliberately not a dashboard tile** — PostHog trends cannot express
"session-final event" without a HogQL insight, and a wrong tile is worse than none. Run it directly via
`scripts/posthog/query.mjs`:

```sql
-- Last module a demo session viewed before exiting (FR-PHG-020)
SELECT argMax(properties.route, timestamp) AS last_route, count() AS sessions
FROM events
WHERE event = 'app_route_viewed' AND properties.demo_audience = 'prospect'
  AND timestamp > now() - INTERVAL 30 DAY
GROUP BY $session_id
```

## Quota safety (FR-PHG-030/031)

Exceeding a PostHog free allowance is **destructive, not billed** — ingestion stops and the excess data
is lost forever, which would flatten every chart and look indistinguishable from "nobody used the
product". `scripts/posthog/check-quota.mjs` alarms (non-zero exit) when any resource passes 80% of its
free allowance, reading `GET /api/projects/:project_id/quota_limits/`:

```bash
POSTHOG_API_KEY=$(op-get.sh posthog-personal-api AS credential) \
POSTHOG_PROJECT_ID=465502 \
node scripts/posthog/check-quota.mjs
```

A malformed response (a renamed field, a schema change, an error-shaped 200) hard-fails
(`exitCode 2`, "unrecognised quota payload") rather than being read as zero rows / all-clear — a
quota alarm that fails open is worse than no alarm. `POSTHOG_HOST`/`POSTHOG_PROJECT_ID` are
validated (https-only host, numeric-only project id) before the API key is sent anywhere.

**Scheduled run:** `.github/workflows/posthog-quota.yml` (daily + manual dispatch — never a
per-PR gate). ⚑ **Requires two GitHub repo secrets not yet configured (owner action):**
`POSTHOG_API_KEY` (personal, `project:read`) and `POSTHOG_PROJECT_ID`. Until both are set, the
scheduled run fails loudly (the exact "don't fail open" posture above) rather than silently
reporting nothing was checked.

Error-tracking rate limits and suppression rules (bounding exception ingestion below the 100k/month
free allowance) are an **owner settings action in PostHog project settings, not code** (FR-PHG-032) —
not covered by this script.

## Consent posture (ADR-0067)

Analytics ships on a **disclosure + opt-out** posture, not a blocking consent banner: `respect_dnt:
true` is passed to `posthog.init` (a user's OS/browser Do Not Track signal suppresses capture
entirely), the collection is disclosed on `/privacy`, and an in-app opt-out toggle there calls
`analyticsOptOut()` / `analyticsOptIn()` (`src/lib/analytics/index.ts`), persisted client-side under the
`pmo.analyticsOptOut` `localStorage` key and checked on every capture via `hasAnalyticsOptedOut()`.

## Session Replay Privacy

Replay and click autocapture are enabled **only** for deployed prospect demo sessions (all three:
`VITE_DEMO_MODE=true`, `DEV=false`, `demo_audience=prospect`). All other modes disable replay and
autocapture entirely.

### Input masking (global)

All `<input>`, `<textarea>`, and `<select>` elements are globally masked via `maskAllInputs: true`.
User-entered text in form fields is never visible in replays.

### Network capture (disabled)

- `recordHeaders: false` — request and response headers are never captured.
- `recordBody: false` — request and response bodies are never captured.
- `maskCapturedNetworkRequestFn` strips query strings from URLs and deletes any residual header/body
  fields.

### Marking non-input sensitive surfaces

Non-input elements that display sensitive content (profile cards, notification text, data tables with
PII, file previews, etc.) must be explicitly annotated by engineering when adding those surfaces:

| Selector | Effect | Use when |
|---|---|---|
| `.ph-no-capture` or `data-ph-no-capture="true"` | **Blocks** — the entire element and children are excluded from recording | The surface contains data that must never appear in any recording (auth tokens, secrets, full PII) |
| `.ph-mask` or `data-ph-mask="true"` | **Masks** — text content is replaced with asterisks; layout is preserved | The surface contains PII that should be obscured but the layout/interaction is useful for UX analysis |

These are configured via `maskTextSelector` and `blockSelector` in the PostHog init options in
`client.ts`.

**Rule of thumb:** inputs are already masked globally. Only non-input surfaces that render user data
need explicit annotation. When in doubt, use `ph-no-capture` (block) over `ph-mask` (mask) to be
conservative.

## Adding Events

1. Add or extend the event in `pmo-portal/src/lib/analytics/events.ts`.
2. Add a unit test in `pmo-portal/src/lib/analytics/events.test.ts`.
3. Use helper builders for repeated event shapes instead of ad hoc component strings.
4. Capture from the nearest UI or data boundary through the typed facade in
   `src/lib/analytics/index.ts`.
5. Run:

```bash
cd pmo-portal
npm test -- events.test.ts
npm run typecheck
```

## Dashboards

Dashboards shipped in #303 (`scripts/posthog/provision-dashboards.mjs`) — dashboards-as-code, idempotent
(upserted by name), grounded in the typed event catalog above. It provisions four PostHog dashboards
(`[PMO] Agent · Adoption & Reliability`, `[PMO] Auth · Login Health`, `[PMO] Product · Usage & Friction`,
`[PMO] Demo · Prospect Funnel`) covering the funnels/friction breakdowns this doc previously listed as
deferred, and force-refreshes every provisioned insight (`?refresh=blocking`) after upsert so a
freshly-provisioned dashboard never renders blank. Run it via `op-get.sh` (never hard-code the personal
API key):

```bash
POSTHOG_API_KEY=$(op-get.sh posthog-personal-api AS credential) \
POSTHOG_PROJECT_ID=465502 \
node scripts/posthog/provision-dashboards.mjs
```

For ad-hoc HogQL analysis outside the provisioned dashboards, use `scripts/posthog/query.mjs` (same auth:
1Password `posthog-personal-api`, project 465502).

`scripts/check-dashboard-tiles.mjs` (wired into `npm run verify`, FR-PHG-013) fails the build if any
provisioned tile depends on an event with no real call site (see `src/lib/analytics/eventCallSites.ts`)
— the CI gate that generalises the two friction-event fixes above (ADR-0067).

Do not add PostHog management API tokens or paid Group Analytics beyond what's already provisioned.
