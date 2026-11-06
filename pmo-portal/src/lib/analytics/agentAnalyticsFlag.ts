import { analyticsClient } from './client';

/**
 * #1532 S1: the consent flag agent-chat receives. Present ONLY while analytics is genuinely
 * running in this browser (SDK loaded + initialised, so enabled + no DNT; not opted out). The server then
 * tags AI telemetry with the replay session and the opaque user id, and (demo org only) may
 * capture prompt/response text. Absent => none of that (including while the deferred SDK is still loading).
 * Never throws.
 */
export function agentAnalyticsFlag(): { consent: true; sessionId?: string } | undefined {
  try {
    if (analyticsClient.hasOptedOut()) return undefined;
    const session = analyticsClient.agentSession();
    return session ? { consent: true, ...session } : undefined;
  } catch {
    return undefined;
  }
}
