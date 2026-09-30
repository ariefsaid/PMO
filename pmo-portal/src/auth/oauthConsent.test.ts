/**
 * AC-CLI-006 — the consent screen's calls to Supabase Auth's OAuth server (supabase-js
 * `auth.oauth.*`). The page never follows a redirect the auth server did not return, and never a
 * non-http(s) one.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const oauth = vi.hoisted(() => ({
  getAuthorizationDetails: vi.fn(),
  approveAuthorization: vi.fn(),
  denyAuthorization: vi.fn(),
}));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { auth: { oauth } } }));

import { decideConsent, getConsentDetails } from './oauthConsent';

beforeEach(() => {
  for (const fn of Object.values(oauth)) fn.mockReset();
});

describe('oauthConsent (AC-CLI-006)', () => {
  it('AC-CLI-006: maps a pending request to the client name and the signed-in account', async () => {
    oauth.getAuthorizationDetails.mockResolvedValue({
      data: {
        authorization_id: 'auth-1',
        redirect_uri: 'http://127.0.0.1:53917/callback',
        client: { id: 'c1', name: 'PMO CLI', uri: '', logo_uri: '' },
        user: { id: 'u1', email: 'owner@example.test' },
        scope: 'email',
      },
      error: null,
    });
    await expect(getConsentDetails('auth-1')).resolves.toEqual({
      kind: 'consent',
      authorizationId: 'auth-1',
      clientName: 'PMO CLI',
      userEmail: 'owner@example.test',
      redirectUri: 'http://127.0.0.1:53917/callback',
    });
    expect(oauth.getAuthorizationDetails).toHaveBeenCalledWith('auth-1');
  });

  it('AC-CLI-006: an already-approved request becomes a redirect', async () => {
    oauth.getAuthorizationDetails.mockResolvedValue({
      data: { redirect_url: 'http://127.0.0.1:53917/callback?code=c' },
      error: null,
    });
    await expect(getConsentDetails('auth-1')).resolves.toEqual({
      kind: 'redirect',
      redirectUrl: 'http://127.0.0.1:53917/callback?code=c',
    });
  });

  it('AC-CLI-006: an auth-server error is thrown, not swallowed', async () => {
    oauth.getAuthorizationDetails.mockResolvedValue({ data: null, error: new Error('authorization expired') });
    await expect(getConsentDetails('auth-1')).rejects.toThrow('authorization expired');
  });

  it('AC-CLI-006: approve and deny send the decision without letting supabase-js navigate on its own', async () => {
    oauth.approveAuthorization.mockResolvedValue({ data: { redirect_url: 'http://127.0.0.1:53917/callback?code=c' }, error: null });
    oauth.denyAuthorization.mockResolvedValue({ data: { redirect_url: 'http://127.0.0.1:53917/callback?error=access_denied' }, error: null });
    await expect(decideConsent('auth-1', 'approve')).resolves.toBe('http://127.0.0.1:53917/callback?code=c');
    await expect(decideConsent('auth-1', 'deny')).resolves.toBe('http://127.0.0.1:53917/callback?error=access_denied');
    expect(oauth.approveAuthorization).toHaveBeenCalledWith('auth-1', { skipBrowserRedirect: true });
    expect(oauth.denyAuthorization).toHaveBeenCalledWith('auth-1', { skipBrowserRedirect: true });
  });

  it('AC-CLI-006: a decision error is thrown', async () => {
    oauth.approveAuthorization.mockResolvedValue({ data: null, error: new Error('boom') });
    await expect(decideConsent('auth-1', 'approve')).rejects.toThrow('boom');
  });

  it.each(['javascript:alert(1)', 'data:text/html,x', 'not a url'])(
    'AC-CLI-006: a non-http(s) redirect (%s) is refused',
    async (url) => {
      oauth.approveAuthorization.mockResolvedValue({ data: { redirect_url: url }, error: null });
      await expect(decideConsent('auth-1', 'approve')).rejects.toThrow(/redirect/i);
      oauth.getAuthorizationDetails.mockResolvedValue({ data: { redirect_url: url }, error: null });
      await expect(getConsentDetails('auth-1')).rejects.toThrow(/redirect/i);
    },
  );
});
