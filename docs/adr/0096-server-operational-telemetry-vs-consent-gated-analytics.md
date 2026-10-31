# ADR-0096 — Server operational telemetry vs consent-gated product analytics

- **Status:** Accepted (Director, with the signed PostHog operations spec).
- **Date:** 2026-10-31
- **Related:** [spec](../specs/posthog-operations.spec.md), [plan](../plans/2026-10-31-posthog-operations.md), [edge error choke point](0066-edge-error-reporting-choke-point.md), [friction instrumentation and consent posture](0067-friction-instrumentation-and-consent-posture.md).
- **Ratifies:** NFR-PHO-PRIV-001/002 and NFR-PHO-REL-001 of the spec; issue #1532.

## Context

PostHog already receives two kinds of signal. Browser product events go through the typed facade and the consent gate (ADR-0067). Edge-function errors go through a server forwarder (ADR-0066). Operating the service now needs more server-side signal: AI run traces, job health and ERP push outcomes. Routing those through the browser consent gate would lose them (a job has no browser), while sending them without a rule would let any server code attach record contents to an analytics tool.

## Decision

Two classes, kept apart.

1. **Product events.** Sent from the browser through the facade only. Consent-gated (ADR-0067); the analytics opt-out and Do Not Track are honoured. They may carry a person identity as the facade already does.
2. **Operational events.** Sent from the server through `emitServerEvent` (`supabase/functions/_shared/posthogServer.ts`) and nothing else. Each event has a **key allowlist** (`SERVER_EVENT_ALLOWLIST`); a key not listed is dropped on the edge and thrown under Vitest. Values are numbers, booleans or short strings (64 characters or fewer), so codes, counts, durations and ids only. The distinct id is the synthetic `edge:<function>`, never a user id, and every event sets `$process_person_profile: false`. The send is bounded by a deadline, never rejects, and registers with `EdgeRuntime.waitUntil` when the runtime has it. The `/privacy` page discloses this class. It is not affected by the browser analytics opt-out.

A dashboard tile on an operational event must have a call of its producer under `supabase/functions/<fn>/` (`serverEventProducers.ts`, checked by `scripts/check-dashboard-tiles.mjs`).

## Consequences

- Operational events cannot be joined to a browser person, by design. One owner-ruled exception (FR-PHO-092): the AI events carry `user_id` and `$session_id` only when the user's browser sent the analytics-consent flag with the request; without the flag they carry neither.
- PostHog has no row-level security, so project membership stays operator-only.
- The allowlist is the enforcement point: adding a key is a reviewed code change with a privacy question attached, and the strict test mode makes a smuggled key fail CI.
- Any slice that needs a new operational key (for example a text field for a demo organisation) changes the allowlist deliberately and updates `/privacy`; it does not bypass the emitter.
