import posthog from 'posthog-js';
import { analyticsClient } from './client';

/**
 * #1532 S1: the consent flag agent-chat receives. Present ONLY while analytics is genuinely
 * running in this browser (SDK initialised, so enabled + no DNT; not opted out). The server then
 * tags AI telemetry with the replay session and the opaque user id, and (demo org only) may
 * capture prompt/response text. Absent => none of that. Never throws.
 */
export function agentAnalyticsFlag(): { consent: true; sessionId?: string } | undefined {
  try {
    if (!posthog.__loaded || posthog.has_opted_out_capturing() || analyticsClient.hasOptedOut()) return undefined;
    const sessionId = posthog.get_session_id();
    return { consent: true, ...(sessionId ? { sessionId } : {}) };
  } catch {
    return undefined;
  }
}
