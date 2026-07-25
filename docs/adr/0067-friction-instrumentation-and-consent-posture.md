# ADR-0067 — Instrument friction at `classifyMutationError`; consent by disclosure + opt-out

- **Status:** Proposed (2026-07-25)
- **Spec:** `docs/specs/observability-analytics.spec.md` §5.2, §5.4, §6 (FR-PHG-010/011/012/013, FR-CON-001..005)
- **Owner decisions honoured:** OD-OBS-1 (no replay/autocapture for real users), OD-OBS-2 (no banner),
  OD-OBS-3 (friction + demo funnel taxonomy)

## Context — the trap this avoids

The `save_failed` event is defined, unit-tested, and has a provisioned dashboard tile. It has never
fired. **Two** independent conditions must both hold and neither does:

1. No caller anywhere in `pmo-portal/src/` or `pmo-portal/pages/` passes `entityType` to
   `useEntityForm` — the hook's `save_failed` branch is opt-in on `module && entityType`
   (`src/components/ui/useEntityForm.ts:196`).
2. `useEntityForm`'s catch only runs when `onValid` throws. Every form's submit callback catches its
   own error and calls `onError(err)` **without rethrowing** — e.g. `pages/Companies.tsx:421-429`:

```tsx
    void form.handleSubmit(async (values) => {
      const input: CompanyInput = { name: values.name.trim(), type: values.type };
      try {
        if (isEdit && company) await onUpdate(company.id, input);
        else await onCreate(input);
      } catch (err) {
        onError(err);
      }
    });
```

So the obvious fix — pass the missing `entityType` prop — **still produces zero events**, and the
still-empty tile reads as "our users never hit save errors" rather than "the fix didn't work". That
is the silent-false-signal class, inside the instrumentation meant to detect it.

## Decision

**1. Instrument at `classifyMutationError` (`pmo-portal/src/lib/classifyMutationError.ts:27`), not at
`useEntityForm`.**

- 194 references across 74 files (hooks, DAL, export/import, adapter dispatch, approvals, timesheets)
  versus 17 entity forms. One site instead of ~17.
- A new form cannot forget to opt in.
- It captures errors that never touch a form at all (bulk import, export, ERP push).
- It is by construction "errors the user was actually shown" — which *is* the friction signal.

**2. The capture is wrapped in `safeTrack`.** This code runs *inside* error handling; an analytics
fault must never propagate into the path that is already recovering from a failure
(NFR-APH-REL-001 precedent).

**3. `classifyMutationError` becomes deliberately impure.** Accepted, and named here so a future
reader does not "fix" it back: the classify call site is the moment the user is shown the error, and
splitting it into `classify()` + `reportFriction()` would recreate the 17-call-site opt-in problem.
The function's return value stays a pure function of its inputs; only a fire-and-forget side effect
is added.

**4. `permission_denied_seen` is removed**, along with its builder, its facade export and its
dashboard tile (FR-PHG-012 permits "wired or removed"). `42501` is already a `reason_code` on the
friction event, so the question "where do people hit permission denials" is answered by the existing
`save_failed`-by-`reason_code` tile without double-counting.

**5. `save_failed` keeps its name** despite now meaning "a classified mutation error was shown to the
user", not literally "a form save failed". Renaming would orphan the existing tile and split the
series. The widened meaning is documented in `docs/analytics-events.md`.

**6. The dead `entityType` path is deleted from `useEntityForm`** so there is exactly one producer of
`save_failed` and no possibility of double-counting if a form ever does rethrow.
`form_validation_failed` stays in the hook — different event, real call sites.

**7. A CI gate makes this class self-detecting** (`scripts/check-dashboard-tiles.mjs`, wired into
`npm run verify`). For every event referenced by a tile in `scripts/posthog/provision-dashboards.mjs`
it requires a registered producer in `pmo-portal/src/lib/analytics/eventCallSites.ts` **and** at
least one reference to that producer from outside `src/lib/analytics/**` and outside test files.
A naive "does `analyticsClient.capture('save_failed')` appear anywhere" grep would have passed today
and proved nothing — the wrapper existed, the caller did not. Fixing `save_failed` and
`permission_denied_seen` by hand resolves today's two instances; the gate stops the third.

## Consent posture (OD-OBS-2)

**Disclose + in-app opt-out + `respect_dnt: true`. No banner.** Legitimate-interest posture for B2B
named account-holders.

- The opt-out control lives on `/privacy`, next to the disclosure it relates to. `/privacy` is
  reachable both from the login footer (`src/auth/LoginPage.tsx:334`) and from the in-app account
  menu (`src/components/shell/ContextBar.tsx:275`), so it satisfies "in-app" without a new page.
- **Persistence is ours, not the SDK's.** The preference is stored under `pmo.analyticsOptOut` in
  `localStorage`, and `analyticsClient.init` returns early when it is set — so an opted-out user's
  next session never calls `posthog.init` and therefore issues **zero** requests to the PostHog host,
  including the SDK's own remote-config fetch. Relying on `posthog.opt_out_capturing()` alone would
  still permit that fetch, which would falsify AC-CON-003.
- `posthog.opt_out_capturing()` is still called (FR-CON-003) so the *current* session stops
  immediately, before a reload.
- No `opt_out_capturing_by_default` — default is opt-in, per OD-OBS-2.
- Cookieless mode rejected: it disables replay/surveys, kills GeoIP, and inflates user counts through
  daily salt rotation.

## Consequences

**Good**

- Two permanently-empty tiles become real signal, and the gate prevents a third.
- Friction coverage extends well beyond forms with no per-call-site work.
- Opt-out is provable: zero network requests, not "the SDK promises not to send".

**Costs / risks**

- `classifyMutationError` gains a module-level import of the analytics facade. Its 14 existing unit
  tests must keep passing with the facade mocked; `analyticsClient.capture` no-ops when uninitialised,
  so unmocked tests are unaffected.
- Event volume rises with every classified mutation error. Bounded by the quota alarm
  (`scripts/posthog/check-quota.mjs`, FR-PHG-030) and by PostHog-side rate limits/suppression rules
  (FR-PHG-032, an owner settings action, unbilled because it drops before ingestion).
- `reason_code` is a Postgres/PostgREST code, never free text — no PII path exists, and
  `buildEventProperties` throws in dev on any forbidden key regardless.
