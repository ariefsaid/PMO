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

| Event | Purpose | Required safe properties |
|---|---|---|
| `demo_persona_selected` | Demo persona interest | `persona_role`, `demo_audience`, `demo_account` |
| `app_route_viewed` | Navigation interest | `route`, `module`, `role` |
| `auth_login_succeeded` | Activation / session start | `method`, `role` |
| `auth_login_failed` | Demo / auth friction | `method`, `reason_code` |
| `auth_logout_succeeded` | Session end | `role` |
| `project_detail_opened` | Project interest | `route`, `role`, `source` |
| `project_tab_viewed` | Feature interest | `tab_id`, `role` |
| `procurement_detail_opened` | Procurement interest | `route`, `role`, `source` |
| `filter_applied` | Workflow behavior | `filter_id`, `option_count`, `module` |
| `search_used` | Discovery behavior | `search_surface`, `result_count`, `module` |
| `coming_soon_clicked` | Demand signal | `feature_id`, `module` |
| `form_validation_failed` | UX friction | `form_id`, `field_count`, `reason_code`, `module` |
| `save_failed` | Reliability / UX friction | `entity_type`, `operation`, `reason_code`, `module` |
| `permission_denied_seen` | Authz / product friction | `surface`, `role`, `module` |
| `empty_state_seen` | Adoption / data gaps | `state_id`, `role`, `module` |

Allowed values: enums, route patterns, role names, module ids, safe slugs, bounded counts/durations,
status/reason codes, booleans.

Forbidden values: raw user-entered strings, raw UUID paths, raw query strings, raw DB rows, names,
emails, phone numbers, addresses, company/project/procurement names, monetary values, notes, comments,
file names, file contents, request/response bodies, and auth tokens.

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

PostHog dashboards are intentionally deferred. After the instrumentation PR emits real demo traffic,
create a follow-up SDD issue for dashboard setup covering:

- prospect-demo funnel: login persona selected -> route exploration -> detail/tab engagement
- usability friction: validation failures, save failures, permission denied, empty states
- demo account breakdown using `demo_audience` and `demo_account`
- session replay review for prospect sessions only

Do not add dashboard provisioning, PostHog management API tokens, or paid Group Analytics to this
instrumentation slice.
