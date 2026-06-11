# ADR-0022 — PostHog for product analytics and prospect-demo instrumentation

Status: Accepted (owner-grilled, 2026-06-11)
Companion spec: `docs/specs/posthog-instrumentation.spec.md`

## Context

The PMO Portal needs product analytics for two near-term jobs:

1. A production-safe foundation that can answer which authenticated app areas are used, without
   capturing sensitive contract/project data.
2. A deployed demo mode for potential-client walkthroughs, where the owner can review what prospects
   explored inside a synthetic seeded Solar EPC demo.

The app is React/Vite/Supabase, single-tenant today with a forward-compatible `org_id` seam
(ADR-0001). `docs/environments.md` already defines `VITE_DEMO_MODE=true` for the Cloudflare Pages demo
build. The demo seed work uses synthetic `@acme.test` personas and synthetic business data.

Alternatives considered:

- **GA4:** free, but optimized for marketing/web analytics, not authenticated SaaS product behavior.
- **Microsoft Clarity:** strong free replay/heatmaps, but does not cover typed product events,
  identity/grouping, and future flags/surveys in one system.
- **Sentry:** strong engineering observability, but not the primary product analytics/demo behavior
  tool.
- **Self-hosted Umami/OpenPanel/Matomo:** viable, but adds operating burden before the product needs
  data-residency/self-hosting.

## Decision

Adopt **PostHog Cloud US** as the product analytics and prospect-demo instrumentation vendor.

Implementation constraints:

- Browser code imports `posthog-js` only through `src/lib/analytics/client.ts`.
- App code uses a local analytics facade (`src/lib/analytics/*`) so the vendor boundary stays narrow.
- Analytics initializes only when `VITE_DEMO_MODE=true` or `VITE_ANALYTICS_ENABLED=true`.
- Production-safe analytics captures route tracking and explicit safe events only.
- Session replay and limited click autocapture run only for deployed prospect demo sessions:
  `VITE_DEMO_MODE=true`, non-dev build, `demo_audience=prospect`.
- Internal/local/dev sessions may send route/explicit events but never replay/autocapture.
- Demo segmentation uses `demo_audience` and `demo_account`, not email addresses.
- The first slice registers `org_id` as safe event context for free-tier filtering. Paid PostHog Group
  Analytics is not required for the first slice; Supabase RLS remains the tenant boundary.
- Heatmaps, feature flags, surveys, error tracking, logs/tracing, reverse proxy, dashboard setup, and
  self-hosting are follow-up issues.

## Consequences

- **Positive:** one vendor covers the near-term demo review need and the longer-term product analytics
  foundation; the local facade keeps lock-in contained; demo replay is available where it has the most
  value.
- **Positive:** PostHog events carry `org_id` context now, so future B2B multi-tenancy analytics will
  not require rethinking the event model.
- **Negative:** a third-party analytics SDK is added to the client bundle and build-time environment.
- **Negative:** privacy correctness becomes an implementation responsibility. The first slice must
  enforce property allowlists, route sanitization, masked replay inputs, and no network/body/header
  capture.
- **Watch:** PostHog dashboard setup is a required follow-up after the event contract lands; building
  dashboards before implementation would be guesswork.
