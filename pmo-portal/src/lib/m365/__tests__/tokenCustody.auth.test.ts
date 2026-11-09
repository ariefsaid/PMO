/**
 * AC-M365-130 — verifyCallerJwt (local ES256 verification).
 * AC-M365SEP-001/003/005/006/007/011/012 — the DATA-ACCESS gate `authorizeMemberEntitled`: an
 *   active member of an entitled org is authorized, irrespective of PMO role or Operator status
 *   (FR-M365SEP-001/002/011). The gate does NOT consult `platform_operators` (FR-M365SEP-001).
 *   Active membership comes from the service-side `m365_membership_state` read (NFR-M365SEP-002),
 *   not inherited from `org_features`' RLS.
 * AC-M365SEP-003/015 — DISABLED_MEMBER / ORG_APPROVAL_REQUIRED are their own wire codes.
 *
 * The authz core is `authorizeMemberEntitled` (injected caller + service clients) — no Deno.env.
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

/** The service-side reads the gate makes: `m365_membership_state` then the resolved plan switch. */
function membership(row: Record<string, unknown> | null, featureEnabled: boolean | { error: true } = true) {
  const service = mockClient();
  service.rpc.mockImplementation((fn: string) => {
    if (fn === 'service_feature_enabled') {
      return Promise.resolve(typeof featureEnabled === 'object'
        ? { data: null, error: { code: 'XX000' } }
        : { data: featureEnabled, error: null });
    }
    return Promise.resolve(row ? { data: row, error: null } : { data: null, error: { code: 'PGRST116' } });
  });
  return service;
}
const active = (role: string, featureEnabled: boolean | { error: true } = true) =>
  membership({ state: 'active', org_id: 'org-1', role }, featureEnabled);
const gate = (caller: ReturnType<typeof mockClient>, service: ReturnType<typeof mockClient>) =>
  authorizeMemberEntitled({ callerClient: caller.client as never, serviceClient: service.client as never, userId: 'user-1' });

describe('AC-M365SEP-001/003/005/006/007/011 — authorizeMemberEntitled (active member of an entitled org)', () => {
  it('AC-M365SEP-001: an active Project Manager of an entitled org is authorized (irrespective of role)', async () => {
    const caller = mockClient({ platform_operators: [{ data: null, error: null }] });
    const service = active('Project Manager');
    expect(await gate(caller, service)).toEqual({ orgId: 'org-1', role: 'Project Manager' });
    expect(service.rpc).toHaveBeenCalledWith('service_feature_enabled', { p_org_id: 'org-1', p_key: 'm365_integration' });
  });

  it('AC-M365SS-001: an active member is authorized when the plan resolves M365 on and no override row exists', async () => {
    const caller = mockClient(); // no org_features row seeded anywhere
    expect(await gate(caller, active('Project Manager', true))).toEqual({ orgId: 'org-1', role: 'Project Manager' });
    expect(caller.from).not.toHaveBeenCalledWith('org_features');
  });

  it('AC-M365SS-002: a member is rejected NOT_ENTITLED when the plan resolves M365 off', async () => {
    await expect(gate(mockClient(), active('Project Manager', false))).rejects.toMatchObject({ code: 'NOT_ENTITLED' });
  });

  it('teardown (requireEntitlement: false) skips the plan switch but still enforces membership', async () => {
    const service = active('Project Manager', false);
    expect(await authorizeMemberEntitled({
      callerClient: mockClient().client as never, serviceClient: service.client as never, userId: 'user-1', requireEntitlement: false,
    })).toEqual({ orgId: 'org-1', role: 'Project Manager' });
    expect(service.rpc).not.toHaveBeenCalledWith('service_feature_enabled', expect.anything());
    await expect(authorizeMemberEntitled({
      callerClient: mockClient().client as never, serviceClient: membership({ state: 'disabled', org_id: 'org-1', role: 'Admin' }).client as never,
      userId: 'user-1', requireEntitlement: false,
    })).rejects.toMatchObject({ code: 'DISABLED_MEMBER' });
  });

  it('AC-M365SS-002: a failing entitlement read fails closed (NOT_ENTITLED)', async () => {
    await expect(gate(mockClient(), active('Admin', { error: true }))).rejects.toMatchObject({ code: 'NOT_ENTITLED' });
  });

  it('AC-M365SEP-007: an active entitled Operator (Admin role) still passes — the de-gate excludes no one', async () => {
    expect(await gate(mockClient(), active('Admin'))).toEqual({ orgId: 'org-1', role: 'Admin' });
  });

  it('AC-M365SEP-005: an active member of a NON-entitled org is rejected NOT_ENTITLED', async () => {
    await expect(gate(mockClient(), active('Project Manager', false))).rejects.toMatchObject({ code: 'NOT_ENTITLED' });
  });

  it('AC-M365SEP-004: a raw-banned member is rejected BANNED_MEMBER by the service-side state read', async () => {
    const service = membership({ state: 'banned', org_id: 'org-1', role: 'Admin' });
    await expect(gate(mockClient(), service)).rejects.toMatchObject({ code: 'BANNED_MEMBER' });
    expect(service.rpc).not.toHaveBeenCalledWith('service_feature_enabled', expect.anything());
  });

  it('AC-M365SEP-003: an INACTIVE member is rejected DISABLED_MEMBER — explicitly NOT NOT_ENTITLED (NFR-M365SEP-002)', async () => {
    // The rejection comes from the gate's explicit membership state, not from an entitlement side effect.
    const service = membership({ state: 'disabled', org_id: 'org-1', role: 'Admin' });
    const rejection = gate(mockClient(), service);
    await expect(rejection).rejects.toMatchObject({ code: 'DISABLED_MEMBER' });
    await expect(rejection).rejects.not.toMatchObject({ code: 'NOT_ENTITLED' });
    // The entitlement lookup must NOT happen once membership fails (short-circuit).
    expect(service.rpc).not.toHaveBeenCalledWith('service_feature_enabled', expect.anything());
  });

  it('AC-M365SEP-011: a caller with no resolvable membership is rejected BAD_REQUEST (discloses nothing about org existence)', async () => {
    const caller = mockClient();
    await expect(gate(caller, membership(null))).rejects.toBeInstanceOf(M365HandlerError);
    await expect(gate(caller, membership(null))).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(caller.from).not.toHaveBeenCalledWith('org_features');
  });

  it('AC-M365SEP-006: the gate NEVER queries platform_operators — operator authority is out of the data-access path', async () => {
    const caller = mockClient();
    const service = active('Project Manager');
    await gate(caller, service);
    expect(caller.from.mock.calls.map((c) => c[0])).not.toContain('platform_operators');
    expect(service.from.mock.calls.map((c) => c[0])).not.toContain('platform_operators');
  });
});

describe('AC-M365SEP-012 — a non-member of an entitled org is forbidden (re-specifies AC-M365-131)', () => {
  // Membership — not Operator status and not PMO role — is the data-access boundary (FR-M365SEP-011).

  it('AC-M365SEP-012: a caller with no membership (not a member of any org) is forbidden', async () => {
    await expect(gate(mockClient(), membership(null))).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('AC-M365SEP-012: a member of a non-entitled org is forbidden from M365 actions', async () => {
    await expect(gate(mockClient(), membership({ state: 'active', org_id: 'org-other', role: 'Admin' }, false)))
      .rejects.toMatchObject({ code: 'NOT_ENTITLED' });
  });
});
