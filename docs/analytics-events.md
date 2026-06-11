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

## First-Slice Events

| Event | Purpose | Required safe properties |
|---|---|---|
| `app_route_viewed` | Sanitized route tracking | `route`, `module`, `demo_audience`, `demo_account` |
| `demo_persona_selected` | Demo-login persona interest | `persona_role` |
| `auth_login_succeeded` | Login completion | `method` |
| `auth_login_failed` | Login failure | `method`, `reason_code` |
| `auth_logout_succeeded` | Logout completion | `method` or no extra properties |
| `project_detail_opened` | Project detail interest | `source`, `module` |
| `project_tab_viewed` | Project tab interest | `tab`, `module` |
| `procurement_detail_opened` | Procurement detail interest | `source`, `module` |
| `filter_applied` | List filtering behavior | `filter_id`, `module` |
| `search_used` | Search action without query text | `surface`, `result_count`, `module` |
| `coming_soon_clicked` | Demand for deferred surfaces | `surface`, `module` |
| `form_validation_failed` | Validation friction | `form_id`, `field_count`, `reason_code`, `module` |
| `save_failed` | Write friction | `entity_type`, `operation`, `reason_code`, `module` |
| `permission_denied_seen` | Authorization friction | `surface`, `role`, `module` |
| `empty_state_seen` | Empty data state exposure | `state_id`, `role`, `module` |

## Adding Events

1. Add or extend the event in `pmo-portal/src/lib/analytics/events.ts`.
2. Add a unit test in `pmo-portal/src/lib/analytics/events.test.ts`.
3. Use helper builders for repeated event shapes instead of ad hoc component strings.
4. Capture from the nearest UI or data boundary through `analyticsClient.capture(...)`.
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
