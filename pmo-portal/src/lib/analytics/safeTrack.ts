/**
 * safeTrack — the shared fire-and-forget guard for every analytics tracking call site (not
 * agent-only since 2026-07-25's friction instrumentation — `classifyMutationError` uses it too).
 *
 * Review round item 3: factors the 9 duplicated
 *   try { trackAgentX(...) } catch { // NFR-APH-REL-001 }
 * blocks (useAssistantPanel.ts, FeedbackControl.tsx, useComposeArtifact.ts,
 * AgentRuntimeProvider.tsx) into one helper. NFR-APH-REL-001: analytics must
 * never block or throw into the real state transition it sits alongside — a
 * thrown/rejected tracking call is caught and logged (not silently dropped),
 * never rethrown, UNCONDITIONALLY (in every environment, not just production —
 * AC-APH-017 pins this).
 *
 * `console.error` (not `.debug`, since a 2026-07-27 review round): `buildEventProperties` THROWS
 * on a forbidden key in dev/test as a loud PII tripwire — swallowing that as a `.debug` line
 * turned the loud guard into a whisper nobody would notice in test/CI output. Rethrowing was
 * considered and rejected: NFR-APH-REL-001 is unconditional, not "except in dev", and this
 * helper has no reliable way to distinguish "a genuine PII-guard trip" from "posthog-js itself
 * threw" — silently-fail-safe stays the behavior; only the log volume changes.
 */
export function safeTrack(fn: () => void): void {
  try {
    fn();
  } catch (err) {
    // NFR-APH-REL-001: fail-safe, not fail-silent — logged, never rethrown.
    console.error('[analytics] tracking call failed', err);
  }
}
