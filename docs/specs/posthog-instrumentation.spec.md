# Spec: PostHog analytics foundation and prospect-demo instrumentation

Adds PostHog as the PMO Portal's analytics layer with two deliberately different modes:

1. **Production-safe foundation:** route tracking, authenticated identity, org context, and explicit
   safe events only.
2. **Deployed prospect demo instrumentation:** the same foundation plus session replay and limited
   click autocapture for potential-client demos that use synthetic seeded data.

This spec replaces the earlier no-replay draft after the requirements grill. The demo use case is not
general observability; it is to understand what potential clients explore during a seeded product
showcase without sending real client data to PostHog.

- **Grounds:** product-expectations Part A (monitoring/logging and production readiness), ADR-0001
  (`org_id` seam), ADR-0006 (monitoring deferred), ADR-0022 (PostHog adoption),
  `docs/environments.md` (`VITE_DEMO_MODE` on Cloudflare Pages), current app shape
  (`pmo-portal/App.tsx`, `src/auth/AuthProvider.tsx`, `src/auth/LoginPage.tsx`,
  `src/auth/useAuth.ts`, `src/vite-env.d.ts`), and the demo branch's
  `supabase/seed-demo-solar.sql`.
- **PostHog project decision:** use the owner's existing **PostHog US Cloud** project. Default host:
  `https://us.i.posthog.com` unless the PostHog project settings provide a more specific ingestion
  host.
- **Architecture decision:** app code depends on `src/lib/analytics/*`, not `posthog-js` directly.
  `src/lib/analytics/client.ts` is the only allowed direct SDK import.
- **Privacy decision:** email, names, raw domain records, raw UUID paths, query strings, notes,
  comments, file data, auth tokens, and real business values are never sent as analytics properties.
- **Demo decision:** the deployed demo contains synthetic seeded data only. Replay may show seeded UI
  text, but user-entered input values and sensitive interaction surfaces are masked or blocked.

## Scope

**IN (first slice):**
- Add `posthog-js`.
- Add Vite env vars and types:
  - `VITE_POSTHOG_KEY`
  - `VITE_POSTHOG_HOST`
  - `VITE_ANALYTICS_ENABLED`
  - `VITE_DEMO_MODE`
- Initialize analytics when `VITE_DEMO_MODE === 'true' || VITE_ANALYTICS_ENABLED === 'true'`.
- Add `src/lib/analytics/config.ts` for mode/audience parsing.
- Add `src/lib/analytics/events.ts` for typed event names and safe property contracts.
- Add `src/lib/analytics/client.ts` as the sole `posthog-js` SDK boundary.
- Add `src/lib/analytics/AnalyticsProvider.tsx` mounted inside `AuthProvider` and `BrowserRouter` so
  both the login page and authenticated shell can emit safe events.
- Track route changes with route patterns/module metadata, not raw ids or query strings.
- Identify authenticated users by internal profile id only; register `org_id` as safe event context.
- Add demo audience/account parsing:
  - Deployed demo default: `demo_audience=prospect`, `demo_account=default`.
  - Local/dev default: `demo_audience=internal`, `demo_account=local`.
  - `?da=internal` sets `demo_audience=internal`, `demo_account=default`.
  - `?da=prospect` sets `demo_audience=prospect`, `demo_account=default`.
  - `?da=<safe-slug>` sets `demo_audience=prospect`, `demo_account=<safe-slug>`.
  - `?demo_account=<safe-slug>` may override the account label.
  - Persist demo audience/account in `sessionStorage` only.
- Enable session replay and limited click autocapture **only** when all are true:
  - `VITE_DEMO_MODE === 'true'`
  - `import.meta.env.DEV !== true`
  - `demo_audience === 'prospect'`
- Configure limited click autocapture for deployed prospect demos:
  - DOM event allowlist: `click` only.
  - Element allowlist: links and buttons only.
  - Clipboard capture disabled.
  - Form/input/select/textarea autocapture disabled.
  - Rage/dead-click/heatmap analysis deferred unless explicitly enabled in a follow-up.
- Configure replay privacy:
  - Visible seeded UI text may be recorded.
  - Inputs, textareas, search fields, note/comment fields, auth fields, file upload/preview regions,
    and regions marked `ph-no-capture` are masked or blocked.
  - URL query strings are redacted from analytics properties.
  - Network request/response body capture, headers, console logs, OpenTelemetry logs, and traces are
    not enabled in this slice.
- Add first explicit event taxonomy:
  - `demo_persona_selected`
  - `app_route_viewed`
  - `auth_login_succeeded`
  - `auth_login_failed`
  - `auth_logout_succeeded`
  - `project_detail_opened`
  - `project_tab_viewed`
  - `procurement_detail_opened`
  - `filter_applied`
  - `search_used`
  - `coming_soon_clicked`
  - `form_validation_failed`
  - `save_failed`
  - `permission_denied_seen`
  - `empty_state_seen`
- Add `docs/analytics-events.md` documenting event naming, safe properties, and how to add future
  events.
- Add unit tests for config parsing, mode gating, identity sync, route sanitization, property guards,
  and PostHog init config.

**OUT (deferred):**
- Heatmaps.
- Broad autocapture.
- Replay/autocapture for internal, local/dev, or non-demo production-safe sessions.
- PostHog feature flags, experiments, surveys, support inbox, customer analytics, revenue analytics,
  error tracking, browser logs, OpenTelemetry tracing, and AI observability.
- PostHog dashboard setup in this first issue. Dashboard setup is a required follow-up issue after
  the instrumentation slice lands.
- External uptime monitoring.
- PostHog reverse proxy.
- Self-hosted PostHog.
- Real B2B multi-tenancy and paid PostHog Group Analytics. This slice sends `org_id` as safe event
  context so analytics remains multi-tenant-ready later without depending on a paid PostHog feature.

## Locked Decisions

- **LD-PH-001 (thin but demo-useful first slice):** not full observability; build the analytics
  foundation plus deployed-prospect demo replay/click capture.
- **LD-PH-002 (synthetic demo data):** deployed demo uses seeded synthetic data only.
- **LD-PH-003 (mode gate):** analytics initializes when `VITE_DEMO_MODE=true` or
  `VITE_ANALYTICS_ENABLED=true`.
- **LD-PH-004 (replay/autocapture gate):** replay and limited click autocapture run only for deployed
  prospect demo sessions, never internal/local/dev sessions.
- **LD-PH-005 (audience/account):** use `demo_audience` and `demo_account`, not email addresses, for
  demo filtering.
- **LD-PH-006 (session persistence):** demo audience/account labels persist in `sessionStorage` only.
- **LD-PH-007 (no consent banner):** no in-app consent/banner for the synthetic-data demo.
- **LD-PH-008 (dashboards):** emit clean data first; PostHog dashboard setup is a required follow-up
  issue after the instrumentation slice lands.

## Functional Requirements (EARS)

- **FR-PH-001** — Where neither demo mode nor analytics mode is enabled, the system shall not
  initialize PostHog and every analytics helper shall no-op.
- **FR-PH-002** — Where `VITE_DEMO_MODE=true` or `VITE_ANALYTICS_ENABLED=true`, when the PostHog key
  and host are present, the system shall initialize PostHog exactly once through the analytics client.
- **FR-PH-003** — Where analytics is enabled outside deployed prospect demo mode, the system shall send
  only route tracking and explicit safe events; it shall not enable replay or autocapture.
- **FR-PH-004** — Where a session is a deployed prospect demo session, the system shall enable session
  replay and click-only autocapture for links/buttons.
- **FR-PH-005** — Where a session is local/dev, internal demo, or non-demo analytics mode, the system
  shall disable replay and autocapture even when route tracking and explicit events are enabled.
- **FR-PH-006** — When a demo URL includes `da`, the system shall normalize it into safe
  `demo_audience` and `demo_account` values and persist them in session storage.
- **FR-PH-007** — When no demo URL flag is present, the system shall classify deployed demo sessions
  as `prospect/default` and local/dev sessions as `internal/local`.
- **FR-PH-008** — When an authenticated profile is available, the system shall identify the user by
  internal profile id and register `org_id` as safe context on subsequent events.
- **FR-PH-009** — When auth state becomes signed out, the system shall reset PostHog identity.
- **FR-PH-010** — When the React Router location changes, the system shall capture
  `app_route_viewed` with route-pattern/module metadata and without raw UUIDs or query strings.
- **FR-PH-011** — When a demo persona button is selected on the login page, the system shall capture
  `demo_persona_selected` with role/persona label only, not email.
- **FR-PH-012** — When login succeeds or fails, the system shall capture `auth_login_succeeded` or
  `auth_login_failed` with safe method/audience/account metadata only.
- **FR-PH-013** — When a product-interest journey occurs, the system shall provide typed helper paths
  for project detail, project tab, procurement detail, filter, search, coming-soon, validation failure,
  save failure, permission denied, and empty-state events.
- **FR-PH-014** — When an event includes a forbidden property key or unsafe value shape, the analytics
  helper shall reject the event in development/test and drop or redact the forbidden property in
  production.
- **FR-PH-015** — The system shall prevent direct `posthog-js` imports outside
  `src/lib/analytics/client.ts`.

## Non-Functional Requirements

- **NFR-PH-SEC-001** — The browser bundle shall contain only the public PostHog project key, never a
  PostHog personal API key or management token.
- **NFR-PH-SEC-002** — `org_id` is an analytics context property only. It is never an authorization
  input; Supabase RLS remains the tenant boundary.
- **NFR-PH-PRIV-001** — No event property shall include raw email, person name, company name, project
  name, procurement title, contract value, budget amount, note/comment text, file name/content, URL
  query string, or auth token.
- **NFR-PH-PRIV-002** — Deployed prospect replay shall mask user-entered inputs and block sensitive
  surfaces while allowing synthetic seeded UI text to remain visible.
- **NFR-PH-PERF-001** — Analytics initialization shall not block first render, auth resolution, route
  transitions, or user actions.
- **NFR-PH-MAINT-001** — New events shall be added by extending the typed event contract and tests, not
  by ad hoc string literals in components.
- **NFR-PH-TEST-001** — Unit tests own this first slice. No e2e is required because the feature is
  non-user-facing instrumentation; later flag/replay UI behavior may add e2e if needed.

## Acceptance Criteria

- **AC-PH-001** — Disabled mode no-ops.
  Given `VITE_DEMO_MODE` and `VITE_ANALYTICS_ENABLED` are both unset/false, When the app mounts and
  routes change, Then PostHog is not initialized and no events are captured. *(FR-PH-001)*

- **AC-PH-002** — Enabled mode initializes once.
  Given either `VITE_DEMO_MODE=true` or `VITE_ANALYTICS_ENABLED=true` with key/host present, When the
  app mounts, Then PostHog initializes exactly once through `src/lib/analytics/client.ts`.
  *(FR-PH-002)*

- **AC-PH-003** — US Cloud host is configurable.
  Given `VITE_POSTHOG_HOST=https://us.i.posthog.com`, When PostHog initializes, Then the SDK receives
  that host and no host is hard-coded outside analytics config. *(FR-PH-002)*

- **AC-PH-004** — Production-safe analytics excludes replay/autocapture.
  Given `VITE_ANALYTICS_ENABLED=true` and `VITE_DEMO_MODE` is false, When PostHog initializes, Then
  route/explicit events are enabled and replay/autocapture are disabled. *(FR-PH-003)*

- **AC-PH-005** — Deployed prospect demo enables replay and limited click autocapture.
  Given `VITE_DEMO_MODE=true`, `import.meta.env.DEV=false`, and `demo_audience=prospect`, When
  PostHog initializes, Then session replay is enabled and autocapture is constrained to click events on
  links/buttons only. *(FR-PH-004)*

- **AC-PH-006** — Internal/local demo disables replay/autocapture.
  Given `VITE_DEMO_MODE=true` with either `import.meta.env.DEV=true` or `?da=internal`, When PostHog
  initializes, Then route/explicit events remain enabled but replay/autocapture are disabled.
  *(FR-PH-005)*

- **AC-PH-007** — Demo audience/account parsing works.
  Given a deployed demo URL with `?da=comp1`, When config parsing runs, Then analytics properties
  include `demo_audience=prospect` and `demo_account=comp1`, persisted in session storage only.
  *(FR-PH-006)*

- **AC-PH-008** — Defaults match environment.
  Given no `da` flag, When config parsing runs, Then deployed demo defaults to `prospect/default` and
  local/dev defaults to `internal/local`. *(FR-PH-007)*

- **AC-PH-009** — Identity is internal and org context is registered.
  Given a profile with id `u1`, role `Project Manager`, and `org_id=o1`, When identity sync runs, Then
  PostHog identifies `u1`, registers `org_id=o1` as event context, and sends no email/name/company/project
  properties. *(FR-PH-008, NFR-PH-PRIV-001)*

- **AC-PH-010** — Logout resets identity.
  Given a previously identified user, When auth state becomes signed out, Then PostHog reset is called
  once for that transition. *(FR-PH-009)*

- **AC-PH-011** — Route tracking strips unsafe URL detail.
  Given navigation from `/projects` to `/projects/d0000000-0000-0000-0000-000000000001?x=y`, When
  `app_route_viewed` is captured, Then properties include a route pattern/module and do not include
  the UUID or query string. *(FR-PH-010)*

- **AC-PH-012** — Demo persona event avoids email.
  Given the demo login panel is visible, When the Executive persona is selected, Then
  `demo_persona_selected` is captured with role/persona label and without `exec@acme.test`.
  *(FR-PH-011, NFR-PH-PRIV-001)*

- **AC-PH-013** — Failed-action events are explicit and safe.
  Given login fails, form validation fails, a save fails, or access is denied, When the helper captures
  the event, Then only safe reason codes/module/operation metadata are sent. *(FR-PH-012/013)*

- **AC-PH-014** — Forbidden properties are blocked.
  Given app code attempts to track `email`, `project_name`, `company_name`, `contract_value`, `token`,
  `notes`, `comment`, or `file_name`, When the helper processes the event in test/development, Then
  PostHog capture is not called with those properties. *(FR-PH-014, NFR-PH-PRIV-001)*

- **AC-PH-015** — Event taxonomy is typed.
  Given a developer calls `analytics.track('random_click')`, When TypeScript checks the code, Then the
  call fails unless the event is added to the approved event union. *(FR-PH-013, NFR-PH-MAINT-001)*

- **AC-PH-016** — SDK import boundary is enforced.
  Given implementation is complete, When the repo is searched for `posthog-js`, Then the only direct
  import is in `src/lib/analytics/client.ts`. *(FR-PH-015)*

## Event Contract

Every event includes common safe context:

| Property | Meaning |
|---|---|
| `environment` | `local`, `demo`, `prod`, or equivalent from app env/config |
| `demo_audience` | `prospect`, `internal`, or omitted outside demo mode |
| `demo_account` | Safe slug such as `default`, `local`, `comp1`; never real company name by default |
| `role` | Auth/profile role when available |
| `module` | Stable module id such as `dashboard`, `projects`, `procurement` |

Initial event names:

| Event | Purpose | Required safe properties |
|---|---|---|
| `demo_persona_selected` | Demo persona interest | `persona_role`, `demo_audience`, `demo_account` |
| `app_route_viewed` | Navigation interest | `route`, `module`, `role` |
| `auth_login_succeeded` | Activation/session start | `method`, `role` |
| `auth_login_failed` | Demo/auth friction | `method`, `reason_code` |
| `auth_logout_succeeded` | Session end | `role` |
| `project_detail_opened` | Project interest | `route`, `role`, `source` |
| `project_tab_viewed` | Feature interest | `tab_id`, `role` |
| `procurement_detail_opened` | Procurement interest | `route`, `role`, `source` |
| `filter_applied` | Workflow behavior | `filter_id`, `option_count`, `module` |
| `search_used` | Discovery behavior | `search_surface`, `result_count`, `module` |
| `coming_soon_clicked` | Demand signal | `feature_id`, `module` |
| `form_validation_failed` | UX friction | `form_id`, `field_count`, `reason_code`, `module` |
| `save_failed` | Reliability/UX friction | `entity_type`, `operation`, `reason_code`, `module` |
| `permission_denied_seen` | Authz/product friction | `surface`, `role`, `module` |
| `empty_state_seen` | Adoption/data gaps | `state_id`, `role`, `module` |

Allowed values: enums, route patterns, role names, module ids, safe slugs, bounded counts/durations,
status/reason codes, booleans.

Forbidden values: raw user-entered strings, raw UUID paths, raw query strings, raw DB rows, names,
emails, phone numbers, addresses, company/project/procurement names, monetary values, notes, comments,
file names, file contents, request/response bodies, and auth tokens.

## Error Handling

| Error Condition | System Behavior | User-Facing Behavior |
|---|---|---|
| Analytics disabled | No-op client | None |
| Missing key/host while enabled | Dev/test throws descriptive config error; production no-ops and logs once | None |
| PostHog blocked by browser/network | App continues; analytics calls fail closed | None |
| Forbidden property in dev/test | Throw/reject before capture | None |
| Forbidden property in production | Drop/redact property before capture | None |
| Invalid `da` slug | Ignore unsafe value and fall back to environment default | None |

## Implementation Checklist

### Analytics Foundation
- [ ] Install `posthog-js`.
- [ ] Add `src/lib/analytics/config.ts`.
- [ ] Add `src/lib/analytics/events.ts`.
- [ ] Add `src/lib/analytics/client.ts`.
- [ ] Add `src/lib/analytics/AnalyticsProvider.tsx`.
- [ ] Add `src/lib/analytics/index.ts`.
- [ ] Add Vite env declarations in `src/vite-env.d.ts`.
- [ ] Mount `AnalyticsProvider` so it covers the login page and authenticated shell.

### Demo Mode
- [ ] Parse `da` and `demo_account` URL params into safe session-scoped demo labels.
- [ ] Add PostHog init config for deployed prospect demo replay and click-only autocapture.
- [ ] Add CSS/data-attribute guidance for `ph-no-capture` sensitive regions.
- [ ] Ensure auth screens and inputs are masked/blocked in replay.

### Event Integration
- [ ] Track route changes as `app_route_viewed`.
- [ ] Sync authenticated profile id/role/org context.
- [ ] Reset analytics identity on sign-out.
- [ ] Track demo persona selection without email.
- [ ] Add typed helper/call sites for the approved initial event taxonomy.
- [ ] Add `docs/analytics-events.md`.

### Testing
- [ ] Unit test disabled, analytics-enabled, local demo, deployed prospect demo, and internal deployed
      demo config modes.
- [ ] Unit test `da` parsing and sessionStorage persistence.
- [ ] Unit test PostHog init config for replay/autocapture gates.
- [ ] Unit test route tracking strips raw ids and query strings.
- [ ] Unit test identify/reset transitions.
- [ ] Unit test forbidden-property rejection/redaction.
- [ ] Run `npm run typecheck`, `npm run lint:ci`, and the focused Vitest suite from `pmo-portal/`.

## Deferred Follow-Up Priorities

1. **Heatmaps** — Enable only after enough prospect demo sessions exist to make aggregate heatmaps
   useful.
2. **PostHog dashboard setup** — Required follow-up issue. Build dashboard views for prospect demo
   review: sessions/replays by `demo_account`, route/module interest, project/procurement detail
   interest, coming-soon demand, failed-action friction, search/filter usage, and internal-vs-prospect
   filtering. This follows the instrumentation slice so the dashboard is based on the implemented
   event contract.
3. **Feature flags** — Add a feature-flag adapter behind `src/lib/analytics` for safe rollouts and
   kill switches.
4. **Surveys** — Add targeted prospect feedback prompts after a few demos clarify useful questions.
5. **Error tracking** — Evaluate PostHog error tracking against Sentry once frontend error volume
   exists; do not enable stack traces in the first slice.
6. **Logs/tracing** — Add browser logs/OpenTelemetry only when backend/API debugging needs exceed
   Supabase logs.
7. **Reverse proxy** — Add a first-party PostHog proxy only if ad blockers or corporate networks hide
   too much demo traffic.
8. **External uptime** — Add UptimeRobot/Uptime Kuma separately; PostHog does not replace outside-in
   uptime checks.
9. **Self-hosting review** — Revisit only for client compliance, data residency, or procurement.
10. **B2B multi-tenancy / Group Analytics** — Keep `org_id` on events for free-tier filtering now;
    implement actual multi-tenant onboarding/auth and paid PostHog Group Analytics as separate
    product/auth/security/commercial decisions.

## Open Questions

None for this first-slice spec. The owner has locked US Cloud, environment-gated replay/autocapture,
session-scoped demo account labels, no consent banner, and dashboard setup as a required follow-up
issue.
