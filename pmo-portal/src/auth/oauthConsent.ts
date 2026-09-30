import { supabase } from '@/src/lib/supabase/client';

/**
 * The consent screen's calls to Supabase Auth's OAuth 2.1 server (#728, DD-API-2). Supabase sends
 * the browser to /oauth/consent?authorization_id=… (supabase/config.toml `[auth.oauth_server]`);
 * these three calls read that request and relay the signed-in user's answer. Every call carries the
 * user's own session — the auth server checks the request belongs to them.
 */

export type ConsentRequest =
  /** The user has not answered yet — show who is asking and as whom. */
  | { kind: 'consent'; authorizationId: string; clientName: string; userEmail: string; redirectUri: string }
  /** The user already approved this client — go straight back. */
  | { kind: 'redirect'; redirectUrl: string };

/**
 * Only follow an http(s) redirect. The auth server returns the client's REGISTERED redirect URI, so
 * this should always hold; it is checked anyway so a bad value can never become a `javascript:` URL.
 */
function safeRedirect(url: unknown): string {
  const raw = String(url);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('The sign-in redirect is not a valid URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('The sign-in redirect is not an http(s) URL');
  }
  return raw;
}

export async function getConsentDetails(authorizationId: string): Promise<ConsentRequest> {
  const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
  if (error) throw error;
  if (!data) throw new Error('The sign-in request returned nothing');
  if ('authorization_id' in data) {
    return {
      kind: 'consent',
      authorizationId: data.authorization_id,
      clientName: data.client.name,
      userEmail: data.user.email,
      redirectUri: data.redirect_uri,
    };
  }
  return { kind: 'redirect', redirectUrl: safeRedirect(data.redirect_url) };
}

/** Send Allow / Deny; returns where to send the browser next. The page navigates, not supabase-js. */
export async function decideConsent(authorizationId: string, decision: 'approve' | 'deny'): Promise<string> {
  const call = decision === 'approve' ? supabase.auth.oauth.approveAuthorization : supabase.auth.oauth.denyAuthorization;
  const { data, error } = await call.call(supabase.auth.oauth, authorizationId, { skipBrowserRedirect: true });
  if (error) throw error;
  return safeRedirect(data?.redirect_url);
}
