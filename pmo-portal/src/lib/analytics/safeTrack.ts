/**
 * safeTrack — the shared fire-and-forget guard for every `trackAgent*` call site.
 *
 * Review round item 3: factors the 9 duplicated
 *   try { trackAgentX(...) } catch { // NFR-APH-REL-001 }
 * blocks (useAssistantPanel.ts, FeedbackControl.tsx, useComposeArtifact.ts,
 * AgentRuntimeProvider.tsx) into one helper. NFR-APH-REL-001: analytics must
 * never block or throw into the real state transition it sits alongside — a
 * thrown/rejected tracking call is caught and logged (not silently dropped),
 * never rethrown. Callers wrap ONLY the tracking call itself, never the real
 * state transition, per the spec-review recommendation.
 */
export function safeTrack(fn: () => void): void {
  try {
    fn();
  } catch (err) {
    // NFR-APH-REL-001: fail-safe, not fail-silent — logged, never rethrown.
    console.debug('[analytics] agent event failed', err);
  }
}
