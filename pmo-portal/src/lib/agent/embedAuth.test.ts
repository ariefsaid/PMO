/**
 * AC-408 (bearer handoff half) — FR-408.
 * Given an authenticated PMO session, activating the embed writes the session JWT where
 * agent-native's fetch interceptor reads it and installs that interceptor, so every
 * same-origin `/_agent-native/*` call carries `Authorization: Bearer <jwt>`.
 *
 * Owning layer: Unit.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the agent-native client so the unit test never pulls the ~730 kB real client nor
// makes network calls. The factory captures calls to the (idempotent) interceptor.
const ensureEmbedAuthFetchInterceptor = vi.fn();
vi.mock('@agent-native/core/client', () => ({
  ensureEmbedAuthFetchInterceptor,
  // Provide a stub for the lazy component path too (not exercised here, but keeps the mock complete).
  AgentNativeEmbedded: () => null,
}));

import { activateEmbedAuth, clearEmbedAuth, EMBED_TOKEN_STORAGE_KEY, hasStoredEmbedToken } from '@/src/lib/agent/embedAuth';

describe('AC-408 — embed bearer handoff (activateEmbedAuth)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    ensureEmbedAuthFetchInterceptor.mockClear();
  });

  it('writes the PMO session JWT to the SDK-owned sessionStorage key', async () => {
    await activateEmbedAuth('jwt-session-token');
    expect(sessionStorage.getItem(EMBED_TOKEN_STORAGE_KEY)).toBe('jwt-session-token');
    // The SDK reads exactly this key (verified in embed-auth.js).
    expect(EMBED_TOKEN_STORAGE_KEY).toBe('agent-native:embed-auth-token');
  });

  it('installs the agent-native fetch interceptor so same-origin calls get the bearer', async () => {
    await activateEmbedAuth('jwt-session-token');
    expect(ensureEmbedAuthFetchInterceptor).toHaveBeenCalledTimes(1);
  });

  it('writes the token BEFORE installing the interceptor (first fetch already authorized)', async () => {
    // Behavior-based order check: at the moment the interceptor installs, the token must
    // ALREADY be in sessionStorage — proving write-before-install (so the SDK's first
    // resolved fetch is already authorized, per the API-ref ordering note).
    let tokenSeenAtInstall: string | null = '__not-inspected__';
    ensureEmbedAuthFetchInterceptor.mockImplementation(() => {
      tokenSeenAtInstall = sessionStorage.getItem(EMBED_TOKEN_STORAGE_KEY);
    });
    await activateEmbedAuth('jwt-session-token');
    expect(tokenSeenAtInstall).toBe('jwt-session-token');
  });

  it('clears any stale token when no session is available (signed out → no leaked bearer)', async () => {
    sessionStorage.setItem(EMBED_TOKEN_STORAGE_KEY, 'stale-jwt');
    await activateEmbedAuth(null);
    expect(sessionStorage.getItem(EMBED_TOKEN_STORAGE_KEY)).toBeNull();
    // No interceptor needed when there is nothing to authorize.
    expect(ensureEmbedAuthFetchInterceptor).not.toHaveBeenCalled();
  });

  it('clearEmbedAuth + hasStoredEmbedToken round-trip', () => {
    expect(hasStoredEmbedToken()).toBe(false);
    sessionStorage.setItem(EMBED_TOKEN_STORAGE_KEY, 'jwt');
    expect(hasStoredEmbedToken()).toBe(true);
    clearEmbedAuth();
    expect(hasStoredEmbedToken()).toBe(false);
  });
});
