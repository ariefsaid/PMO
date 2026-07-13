# Plan — Wire the 11 defined-but-unfired analytics events

**Context.** PostHog capture is live (verified: events landing in project 465502). But 11 events
are defined in `src/lib/analytics/events.ts`, unit-tested, and already charted by the provisioned
"Product · Usage & Friction" dashboard (#303) — yet **never called from any page**, so those tiles
are empty and prospect engagement/friction is invisible. This plan wires each at its correct UI
boundary through the typed facade (`src/lib/analytics`). No new events, no schema, no new deps.

**Layer (ADR-0010).** These are component/logic-layer signals — owned by **Vitest/RTL unit tests**
(mock the analytics facade, assert the call fires with the right safe props), matching how
`auth_*`/`demo_persona_selected` are already tested. **No e2e.** Every prop must survive
`buildEventProperties` (forbidden-key guard) — no names/ids/free-text.

## Wave 1 — central boundaries (max coverage per edit)

| Event | Boundary (single file) | Fire when | Safe props |
|---|---|---|---|
| `form_validation_failed` | `src/components/ui/useEntityForm.ts` (`handleSubmit`, validation-fail branch) | submit blocked by validation | `form_id`, `field_count`, `reason_code`='validation', `module` |
| `save_failed` | `src/components/ui/useEntityForm.ts` (submit catch → `classifyMutationError`) | mutation throws | `entity_type`, `operation`, `reason_code` (from classify), `module` |
| `empty_state_seen` | `src/components/panel/EmptyState.tsx` (on mount) | shared empty state renders | `state_id`, `role`, `module` |
| `auth_logout_succeeded` | `src/auth/AuthProvider.tsx` (signOut success) | logout completes | `role` |
| `search_used` | `src/components/ui/DataTable.tsx` `SearchMini` (debounced, on non-empty submit) | user searches | `search_surface`, `result_count`, `module` |

`form_id`/`module`/`entity_type`/`state_id`/`search_surface` come from props the caller already
passes (or a new required prop) — NEVER derive from user input. Debounce `search_used` so it fires
once per search intent, not per keystroke (fire on submit or 500ms idle); **never** send the query text.

## Wave 2 — targeted boundaries

| Event | Boundary | Fire when | Safe props |
|---|---|---|---|
| `project_detail_opened` | `pages/Projects.tsx` (row → navigate) | open a project | `route`, `role`, `source`='list'\|'card' |
| `procurement_detail_opened` | `pages/Procurement.tsx` (row → navigate) | open a procurement | `route`, `role`, `source` |
| `project_tab_viewed` | `pages/project-detail/ProjectDetail.tsx` (tab change) | switch tab | `tab_id`, `role` |
| `coming_soon_clicked` | shared coming-soon affordance (find the common one; else each site) | click a coming-soon CTA | `feature_id`, `module` |
| `filter_applied` | filter bars: `Projects.tsx`, `Procurement.tsx`, `Incidents.tsx`, `Companies.tsx` | apply a filter | `filter_id`, `option_count`, `module` |

Prefer a shared helper if the filter bars share a component; otherwise wire each. `tab_id` must pass
`SAFE_TAB_ID`; `route` must be a pattern (`/projects/:projectId`), never a raw UUID path.

## Definition of done
- TDD: each event has a failing unit test first (render boundary, mock facade, assert call + props).
- `buildEventProperties` throws on no forbidden key (tests run in non-prod → it enforces).
- `scripts/posthog/query.mjs` included (the read/analysis helper; already built + proven).
- `docs/analytics-events.md`: move the 11 from "defined" to "wired"; drop the stale "dashboards
  deferred" note (dashboards shipped #303) — point to `query.mjs` for ad-hoc analysis.
- **Full `npm run verify` green** (typecheck + lint:ci + test + build) before PR. PR → `dev`.

## Traceability
Events → `AnalyticsEventName` union (already present). Owning tests: `*.analytics.test.tsx`
colocated with each boundary, or extend the existing analytics test files.
