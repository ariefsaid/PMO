/**
 * AC-M365-130/131/132 — caller JWT verification + org resolution + Admin + entitlement gates.
 * AC-M365-130: verifyCallerJwt (ES256 local verify) — valid token returns sub; expired / alg-confusion reject.
 * AC-M365-131: Admin gate — a non-Admin caller is forbidden.
 * AC-M365-132: entitlement gate — an org without m365_integration is not entitled.
 * The authz core is the pure `authorizeOperatorEntitled` helper (injected caller client) — no Deno.env.
 */
import { describe, it, expect } from 'vitest';
import { verifyCallerJwt, JwtVerifyError } from '../../auth/verifyCallerJwt';
import { authorizeOperatorEntitled } from '../../../../../supabase/functions/m365-token-custody/auth';
import { M365HandlerError } from '../../../../../supabase/functions/m365-token-custody/types';
import { createMockJwks, createMockHs256Jwks, createMockJwt } from './mocks/jwtMocks';
import { mockClient } from './m365MockDeps';

const ISSUER = 'https://test.supabase.co/auth/v1';

describe('AC-M365-130 — verifyCallerJwt (local ES256 verification)', () => {
  it('AC-M365-130: a valid ES256 caller JWT verifies and returns the caller sub', async () => {
    const jwks = await createMockJwks();
    const token = await createMockJwt({ sub: 'user-123', role: 'Admin' }, jwks.privateKey);
    const verified = await verifyCallerJwt(token, jwks.resolver, {
      issuer: ISSUER,
      audience: 'authenticated',
      algorithms: ['ES256'],
    });
    expect(verified.sub).toBe('user-123');
  });

  it('AC-M365-130: an expired JWT is rejected (JwtVerifyError)', async () => {
    const jwks = await createMockJwks();
    const expired = Math.floor(Date.now() / 1000) - 3600;
    const token = await createMockJwt({ sub: 'user-123' }, jwks.privateKey, { exp: expired });
    await expect(
      verifyCallerJwt(token, jwks.resolver, { issuer: ISSUER, audience: 'authenticated', algorithms: ['ES256'] }),
    ).rejects.toBeInstanceOf(JwtVerifyError);
  });

  it('AC-M365-130: an HS256 token is rejected — alg-confusion is blocked (ES256 pinned)', async () => {
    const jwks = await createMockHs256Jwks();
    const token = await createMockJwt({ sub: 'user-123' }, jwks.privateKey, { alg: 'HS256' });
    await expect(
      verifyCallerJwt(token, jwks.resolver, { issuer: ISSUER, audience: 'authenticated', algorithms: ['ES256'] }),
    ).rejects.toBeInstanceOf(JwtVerifyError);
  });
});

/** A service client that answers the `platform_operators` lookup: row present ⇒ Operator. */
function operatorService(isOperator: boolean) {
  return mockClient({
    platform_operators: [{ data: isOperator ? { user_id: 'user-1' } : null, error: null }],
  });
}

describe('AC-M365-131/132 — authorizeOperatorEntitled (org resolution + Operator + entitlement)', () => {
  // ADR-0058 §3 amendment (2026-07-24): M365 connect is OPERATOR-gated, not org-Admin-gated. The
  // Entra app registration lives in the vendor tenant (ADR-0059 Option C), so wiring it up is a
  // platform action. ClickUp/ERPNext stay Admin-or-Operator — the client supplies those creds.
  it('AC-M365-130: resolves org_id for an Operator under the caller-JWT client', async () => {
    const caller = mockClient({
      profiles: [{ data: { org_id: 'org-123', role: 'Admin' }, error: null }],
      org_features: [{ data: { enabled: true }, error: null }],
    });
    const service = operatorService(true);
    const result = await authorizeOperatorEntitled({
      callerClient: caller.client as never,
      serviceClient: service.client as never,
      userId: 'user-1',
    });
    expect(result).toEqual({ orgId: 'org-123', role: 'Admin' });
    expect(caller.from).toHaveBeenCalledWith('profiles');
    expect(caller.from).toHaveBeenCalledWith('org_features');
    // The Operator check MUST be service-side — platform_operators has no caller-readable policy.
    expect(service.from).toHaveBeenCalledWith('platform_operators');
  });

  it('AC-M365-131: an org Admin who is NOT an Operator is forbidden', async () => {
    // The load-bearing case for the amendment: org-Admin alone no longer grants M365 connect.
    const caller = mockClient({
      profiles: [{ data: { org_id: 'org-123', role: 'Admin' }, error: null }],
    });
    const service = operatorService(false);
    await expect(
      authorizeOperatorEntitled({
        callerClient: caller.client as never,
        serviceClient: service.client as never,
        userId: 'user-1',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // The entitlement lookup must NOT happen once the Operator gate fails.
    expect(caller.from).not.toHaveBeenCalledWith('org_features');
  });

  it('AC-M365-131: a non-Admin, non-Operator caller is forbidden', async () => {
    const caller = mockClient({
      profiles: [{ data: { org_id: 'org-123', role: 'Project Manager' }, error: null }],
    });
    const service = operatorService(false);
    await expect(
      authorizeOperatorEntitled({
        callerClient: caller.client as never,
        serviceClient: service.client as never,
        userId: 'user-1',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(caller.from).not.toHaveBeenCalledWith('org_features');
  });

  it('AC-M365-132: an org without the m365_integration entitlement is rejected as NOT_ENTITLED', async () => {
    const caller = mockClient({
      profiles: [{ data: { org_id: 'org-123', role: 'Admin' }, error: null }],
      org_features: [{ data: { enabled: false }, error: null }],
    });
    await expect(
      authorizeOperatorEntitled({
        callerClient: caller.client as never,
        serviceClient: operatorService(true).client as never,
        userId: 'user-1',
      }),
    ).rejects.toMatchObject({ code: 'NOT_ENTITLED' });
  });

  it('AC-M365-132: a missing entitlement row (no enabled=true) is treated as not entitled', async () => {
    const caller = mockClient({
      profiles: [{ data: { org_id: 'org-123', role: 'Admin' }, error: null }],
      org_features: [{ data: null, error: { code: 'PGRST116' } }],
    });
    await expect(
      authorizeOperatorEntitled({
        callerClient: caller.client as never,
        serviceClient: operatorService(true).client as never,
        userId: 'user-1',
      }),
    ).rejects.toMatchObject({ code: 'NOT_ENTITLED' });
  });

  it('AC-M365-130: an unresolvable profile (no row) yields a typed BAD_REQUEST', async () => {
    const caller = mockClient({ profiles: [{ data: null, error: { code: 'PGRST116' } }] });
    await expect(
      authorizeOperatorEntitled({
        callerClient: caller.client as never,
        serviceClient: operatorService(true).client as never,
        userId: 'user-1',
      }),
    ).rejects.toBeInstanceOf(M365HandlerError);
  });
});
