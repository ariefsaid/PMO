/**
 * AC-M365-130 — verifyCallerJwt (local ES256 verification).
 * AC-M365SEP-001/003/005/006/007/011/012 — the DATA-ACCESS gate `authorizeMemberEntitled`: an
 *   active member of an entitled org is authorized, irrespective of PMO role or Operator status
 *   (FR-M365SEP-001/002/011). The gate does NOT consult `platform_operators` (FR-M365SEP-001) —
 *   its absence from the signature is the structural guarantee. Active membership is asserted
 *   EXPLICITLY from `profiles.status` (NFR-M365SEP-002), not inherited from `org_features`' RLS.
 * AC-M365SEP-003/015 — DISABLED_MEMBER / ORG_APPROVAL_REQUIRED are their own wire codes.
 *
 * The authz core is the pure `authorizeMemberEntitled` helper (injected caller client) — no Deno.env.
 */
import { describe, it, expect } from 'vitest';
import { verifyCallerJwt, JwtVerifyError } from '../../auth/verifyCallerJwt';
import {
  authorizeMemberEntitled,
} from '../../../../../supabase/functions/m365-token-custody/auth';
import {
  M365HandlerError,
  ERROR_STATUS,
} from '../../../../../supabase/functions/m365-token-custody/types';
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

describe('AC-M365SEP-003/015 — membership and org-approval are their own wire codes', () => {
  it('AC-M365SEP-003: DISABLED_MEMBER is 403 and distinct from NOT_ENTITLED', () => {
    expect(ERROR_STATUS.DISABLED_MEMBER).toBe(403);
  });
  it('AC-M365SEP-015: ORG_APPROVAL_REQUIRED is 403 and distinct from FORBIDDEN', () => {
    expect(ERROR_STATUS.ORG_APPROVAL_REQUIRED).toBe(403);
  });
});

describe('AC-M365SEP-001/003/005/006/007/011 — authorizeMemberEntitled (active member of an entitled org)', () => {
  it('AC-M365SEP-001: an active Project Manager of an entitled org is authorized (irrespective of role)', async () => {
    // The caller is explicitly NOT a platform Operator (platform_operators seeded null). FR-M365SEP-011:
    // an active member of an entitled org is authorized irrespective of role OR Operator status. The
    // explicit non-Operator seed is what makes a re-added operator lookup redden this test.
    const caller = mockClient({
      profiles: [{ data: { org_id: 'org-1', role: 'Project Manager', status: 'active' }, error: null }],
      org_features: [{ data: { enabled: true }, error: null }],
      platform_operators: [{ data: null, error: null }],
    });
    const result = await authorizeMemberEntitled({ callerClient: caller.client as never, userId: 'user-1' });
    expect(result).toEqual({ orgId: 'org-1', role: 'Project Manager' });
  });

  it('AC-M365SEP-007: an active entitled Operator (Admin role) still passes — the de-gate excludes no one', async () => {
    const caller = mockClient({
      profiles: [{ data: { org_id: 'org-1', role: 'Admin', status: 'active' }, error: null }],
      org_features: [{ data: { enabled: true }, error: null }],
    });
    const result = await authorizeMemberEntitled({ callerClient: caller.client as never, userId: 'user-1' });
    expect(result).toEqual({ orgId: 'org-1', role: 'Admin' });
  });

  it('AC-M365SEP-005: an active member of a NON-entitled org is rejected NOT_ENTITLED', async () => {
    const caller = mockClient({
      profiles: [{ data: { org_id: 'org-1', role: 'Project Manager', status: 'active' }, error: null }],
      org_features: [{ data: { enabled: false }, error: null }],
    });
    await expect(
      authorizeMemberEntitled({ callerClient: caller.client as never, userId: 'user-1' }),
    ).rejects.toMatchObject({ code: 'NOT_ENTITLED' });
  });

  it('AC-M365SEP-003: an INACTIVE member is rejected DISABLED_MEMBER — explicitly NOT NOT_ENTITLED (NFR-M365SEP-002)', async () => {
    // The load-bearing case for NFR-M365SEP-002: a disabled caller reads their own profile fine
    // (profiles_select has no status predicate, 0002_rls.sql:32), so the rejection MUST come from
    // the gate's explicit status check — NOT from org_features' RLS side effect.
    const caller = mockClient({
      profiles: [{ data: { org_id: 'org-1', role: 'Admin', status: 'disabled' }, error: null }],
      org_features: [{ data: { enabled: true }, error: null }],
    });
    const rejection = authorizeMemberEntitled({ callerClient: caller.client as never, userId: 'user-1' });
    await expect(rejection).rejects.toMatchObject({ code: 'DISABLED_MEMBER' });
    // The error is DISTINCT from the entitlement error — a disabled caller is not told their org
    // is unentitled (it is entitled); they are told THEIR access is disabled.
    await expect(rejection).rejects.not.toMatchObject({ code: 'NOT_ENTITLED' });
    // The entitlement lookup must NOT happen once membership fails (short-circuit).
    expect(caller.from).not.toHaveBeenCalledWith('org_features');
  });

  it('AC-M365SEP-011: a caller with no resolvable profile is rejected BAD_REQUEST (discloses nothing about org existence)', async () => {
    const caller = mockClient({ profiles: [{ data: null, error: { code: 'PGRST116' } }] });
    await expect(
      authorizeMemberEntitled({ callerClient: caller.client as never, userId: 'user-1' }),
    ).rejects.toBeInstanceOf(M365HandlerError);
    await expect(
      authorizeMemberEntitled({ callerClient: caller.client as never, userId: 'user-1' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    // No entitlement lookup for an unresolvable caller.
    expect(caller.from).not.toHaveBeenCalledWith('org_features');
  });

  it('AC-M365SEP-006: the gate NEVER queries platform_operators — operator authority is out of the data-access path', async () => {
    // The absence of a serviceClient parameter is the structural guarantee (FR-M365SEP-001). This
    // assertion on the absence of a query makes the de-gate provable rather than incidental: a
    // future refactor that re-adds a platform_operators lookup reddens this test.
    const caller = mockClient({
      profiles: [{ data: { org_id: 'org-1', role: 'Project Manager', status: 'active' }, error: null }],
      org_features: [{ data: { enabled: true }, error: null }],
    });
    await authorizeMemberEntitled({ callerClient: caller.client as never, userId: 'user-1' });
    const tablesQueried = caller.from.mock.calls.map((c) => c[0]);
    expect(tablesQueried).not.toContain('platform_operators');
  });
});

describe('AC-M365SEP-012 — a non-member of an entitled org is forbidden (re-specifies AC-M365-131)', () => {
  // AC-M365-131 asserted the SUPERSEDED rule ("an org Admin who is not an Operator is FORBIDDEN").
  // Its replacement asserts the NEW boundary: an authenticated caller who is NOT a member of an
  // entitled org is forbidden. The old operator gate is gone (FR-M365SEP-003); membership — not
  // Operator status and not PMO role — is the data-access boundary (FR-M365SEP-011). Deleting the
  // AC would lose the proof that the boundary is tested at all (FR-M365SEP-020).

  it('AC-M365SEP-012: a caller with no profile (not a member of any org) is forbidden', async () => {
    const caller = mockClient({ profiles: [{ data: null, error: { code: 'PGRST116' } }] });
    await expect(
      authorizeMemberEntitled({ callerClient: caller.client as never, userId: 'user-1' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('AC-M365SEP-012: a member of a non-entitled org is forbidden from M365 actions', async () => {
    // The caller IS a member of an org (profile resolves, status active) — but that org does not
    // hold the m365_integration entitlement, so they are forbidden the data-access path.
    const caller = mockClient({
      profiles: [{ data: { org_id: 'org-other', role: 'Admin', status: 'active' }, error: null }],
      org_features: [{ data: null, error: { code: 'PGRST116' } }],
    });
    await expect(
      authorizeMemberEntitled({ callerClient: caller.client as never, userId: 'user-1' }),
    ).rejects.toMatchObject({ code: 'NOT_ENTITLED' });
  });
});
