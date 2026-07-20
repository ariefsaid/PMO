/**
 * Tests for the pure PKCE parameter-generation + authorize-URL helpers (ADR-0060 §1, D2 —
 * server-side auth-code + PKCE bootstrap). Offline: no network, no secrets — the code_challenge is
 * verified against an independently-computed SHA-256 digest via Web Crypto, and the authorize URL
 * is checked as plain string construction. This module does NOT implement the token exchange (that
 * is the held Phase-1 edge function, which alone holds the client secret).
 */
import { describe, it, expect } from 'vitest';
import { generateCodeVerifier, codeChallengeS256, buildAuthorizeUrl } from '../graphPkce';

// RFC 7636 §4.1 unreserved charset: ALPHA / DIGIT / "-" / "." / "_" / "~"
const UNRESERVED_CHARSET_RE = /^[A-Za-z0-9\-._~]+$/;

function base64UrlEncode(bytes: ArrayBuffer): string {
  const binary = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

describe('generateCodeVerifier', () => {
  it('AC-M365-031: produces a verifier within the RFC 7636 43-128 char length range', () => {
    const verifier = generateCodeVerifier();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
  });

  it('AC-M365-031: produces a verifier using only the RFC 7636 unreserved charset', () => {
    const verifier = generateCodeVerifier();
    expect(verifier).toMatch(UNRESERVED_CHARSET_RE);
  });

  it('AC-M365-031: produces a DIFFERENT verifier on each call (high entropy, no static value)', () => {
    const a = generateCodeVerifier();
    const b = generateCodeVerifier();
    expect(a).not.toBe(b);
  });
});

describe('codeChallengeS256', () => {
  it('AC-M365-031: computes base64url(SHA-256(verifier)) — the S256 challenge — against an independent digest', async () => {
    const verifier = generateCodeVerifier();
    const challenge = await codeChallengeS256(verifier);

    // Independently compute the expected value with subtle.digest directly.
    const expectedDigest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    const expectedChallenge = base64UrlEncode(expectedDigest);

    expect(challenge).toBe(expectedChallenge);
  });

  it('AC-M365-031: the challenge is base64url — no padding, no "+"/"/" characters', async () => {
    const challenge = await codeChallengeS256(generateCodeVerifier());
    expect(challenge).not.toMatch(/[+/=]/);
  });

  it('AC-M365-031: matches a known RFC 7636 test vector', async () => {
    // RFC 7636 appendix B example verifier/challenge pair.
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const expected = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
    expect(await codeChallengeS256(verifier)).toBe(expected);
  });
});

describe('buildAuthorizeUrl', () => {
  const baseParams = {
    tenant: 'contoso-tenant-id',
    clientId: 'client-abc-123',
    redirectUri: 'https://app.example.com/api/m365/callback',
    scopes: ['offline_access', 'Files.Read', 'User.Read'],
    state: 'opaque-csrf-state-value',
    codeChallenge: 'test-challenge-value',
  };

  it('AC-M365-031: the authorize URL uses the correct tenant path', () => {
    const url = new URL(buildAuthorizeUrl(baseParams));
    expect(url.origin).toBe('https://login.microsoftonline.com');
    expect(url.pathname).toBe('/contoso-tenant-id/oauth2/v2.0/authorize');
  });

  it('AC-M365-031: includes response_type=code and code_challenge_method=S256', () => {
    const url = new URL(buildAuthorizeUrl(baseParams));
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBe('test-challenge-value');
  });

  it('AC-M365-031: space-joins scopes and includes offline_access', () => {
    const url = new URL(buildAuthorizeUrl(baseParams));
    const scope = url.searchParams.get('scope');
    expect(scope).toBe('offline_access Files.Read User.Read');
  });

  it('AC-M365-031: includes client_id, redirect_uri, and state verbatim', () => {
    const url = new URL(buildAuthorizeUrl(baseParams));
    expect(url.searchParams.get('client_id')).toBe('client-abc-123');
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.example.com/api/m365/callback');
    expect(url.searchParams.get('state')).toBe('opaque-csrf-state-value');
  });

  it('AC-M365-031: the returned string contains no client secret / token material (pure param construction)', () => {
    const url = buildAuthorizeUrl(baseParams);
    expect(url).not.toMatch(/secret/i);
    expect(url).not.toMatch(/refresh_token/i);
  });

  it('AC-M365-031: accepts the valid tenant forms (GUID, common/organizations/consumers, verified domain)', () => {
    for (const tenant of [
      '11111111-2222-3333-4444-555555555555',
      'common',
      'organizations',
      'consumers',
      'contoso.onmicrosoft.com',
    ]) {
      const url = new URL(buildAuthorizeUrl({ ...baseParams, tenant }));
      expect(url.origin).toBe('https://login.microsoftonline.com');
      expect(url.pathname).toBe(`/${tenant}/oauth2/v2.0/authorize`);
    }
  });

  it('AC-M365-031: rejects a tenant that could smuggle path/query segments into the authorize URL', () => {
    // Would otherwise inject a second client_id and break out of the intended path.
    expect(() =>
      buildAuthorizeUrl({ ...baseParams, tenant: 'common/oauth2/v2.0/authorize?client_id=evil&x=' }),
    ).toThrow(/invalid tenant/i);
    expect(() => buildAuthorizeUrl({ ...baseParams, tenant: '../../evil' })).toThrow(/invalid tenant/i);
  });
});
