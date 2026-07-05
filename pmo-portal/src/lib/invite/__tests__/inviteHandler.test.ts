/**
 * Tests for authorizeInvite (S3 — admin-invite-user, issuance-only). FR-INV-004/005. Pure,
 * Deno+vitest-importable logic — no @supabase/supabase-js import. Mirrors the agent-dispatch
 * precedent (pure module vitest-tested with an injected SupabaseLike; the Deno wrapper is
 * integration-only, verified by the deploy-time checklist, not unit-tested here).
 */
import { it, expect, vi, describe } from 'vitest';
import { authorizeInvite, InviteError, INVITE_ROLES } from '../inviteHandler';
import type { InviteSupabaseLike } from '../inviteHandler';

function mockDb(opts: {
  isOperator?: boolean;
  profile?: { org_id: string; role: string; email: string } | null;
  profileError?: { code?: string; message: string } | null;
  orgExists?: boolean;
  dup?: boolean;
}): InviteSupabaseLike {
  const rpc = vi.fn(async (fn: string) => {
    if (fn === 'is_operator') return { data: opts.isOperator ?? false, error: null };
    if (fn === 'operator_org_exists') return { data: opts.orgExists ?? true, error: null };
    if (fn === 'org_has_member_email') return { data: opts.dup ?? false, error: null };
    return { data: null, error: null };
  });
  const from = vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        single: vi.fn(async () => ({
          data: opts.profile === undefined ? { org_id: 'org-1', role: 'Admin', email: 'admin@example.com' } : opts.profile,
          error: opts.profileError ?? null,
        })),
      })),
    })),
  }));
  return { rpc, from } as unknown as InviteSupabaseLike;
}

describe('authorizeInvite', () => {
  it('authorizes org-Admin (own org)', async () => {
    const db = mockDb({ isOperator: false, profile: { org_id: 'org-1', role: 'Admin', email: 'admin@example.com' } });
    const result = await authorizeInvite(db, 'caller-1', { email: 'new@example.com', role: 'Engineer' });
    expect(result).toEqual({ targetOrgId: 'org-1', role: 'Engineer' });
  });

  it('authorizes Operator', async () => {
    const db = mockDb({ isOperator: true, profile: { org_id: 'operator-home-org', role: 'Admin', email: 'op@example.com' }, orgExists: true });
    const result = await authorizeInvite(db, 'operator-1', {
      email: 'new@example.com',
      role: 'Finance',
      p_org_id: 'org-target',
    });
    expect(result).toEqual({ targetOrgId: 'org-target', role: 'Finance' });
  });

  it('rejects non-Admin/non-Operator', async () => {
    const db = mockDb({ isOperator: false, profile: { org_id: 'org-1', role: 'Engineer', email: 'eng@example.com' } });
    await expect(
      authorizeInvite(db, 'caller-1', { email: 'new@example.com', role: 'Engineer' }),
    ).rejects.toMatchObject({ code: 'INVITE_UNAUTHORIZED', status: 403 });
  });

  it('rejects a caller whose profile lookup fails (401)', async () => {
    const db = mockDb({ isOperator: false, profile: null, profileError: { message: 'no rows' } });
    await expect(
      authorizeInvite(db, 'caller-1', { email: 'new@example.com', role: 'Engineer' }),
    ).rejects.toMatchObject({ code: 'INVITE_UNAUTHORIZED', status: 401 });
  });

  it('rejects duplicate email in target org', async () => {
    const db = mockDb({ isOperator: false, profile: { org_id: 'org-1', role: 'Admin', email: 'admin@example.com' }, dup: true });
    await expect(
      authorizeInvite(db, 'caller-1', { email: 'existing@example.com', role: 'Engineer' }),
    ).rejects.toMatchObject({ code: 'DUPLICATE_EMAIL', status: 409 });
  });

  it('rejects invalid role', async () => {
    const db = mockDb({ isOperator: false, profile: { org_id: 'org-1', role: 'Admin', email: 'admin@example.com' } });
    await expect(
      authorizeInvite(db, 'caller-1', { email: 'new@example.com', role: 'Superuser' }),
    ).rejects.toMatchObject({ code: 'INVALID_ROLE', status: 400 });
  });

  it('rejects Operator invite into nonexistent org', async () => {
    const db = mockDb({ isOperator: true, profile: { org_id: 'op-home', role: 'Admin', email: 'op@example.com' }, orgExists: false });
    await expect(
      authorizeInvite(db, 'operator-1', { email: 'new@example.com', role: 'Engineer', p_org_id: 'ghost-org' }),
    ).rejects.toMatchObject({ code: 'UNKNOWN_ORG', status: 400 });
  });

  it('rejects a malformed email', async () => {
    const db = mockDb({ isOperator: false, profile: { org_id: 'org-1', role: 'Admin', email: 'admin@example.com' } });
    await expect(
      authorizeInvite(db, 'caller-1', { email: 'not-an-email', role: 'Engineer' }),
    ).rejects.toMatchObject({ code: 'BAD_EMAIL', status: 400 });
  });

  it('builds the profiles insert payload: org-Admin invite pins to their own org, never client-decided', async () => {
    const db = mockDb({ isOperator: false, profile: { org_id: 'org-1', role: 'Admin', email: 'admin@example.com' } });
    // Even if a non-Operator caller tries to pass p_org_id, org-Admin path ignores it (pinned to own org).
    const result = await authorizeInvite(db, 'caller-1', {
      email: 'new@example.com',
      role: 'Engineer',
      p_org_id: 'someone-elses-org',
    });
    expect(result.targetOrgId).toBe('org-1');
  });

  it('exposes exactly the 5 valid user_role values', () => {
    expect(INVITE_ROLES).toEqual(['Engineer', 'Project Manager', 'Finance', 'Executive', 'Admin']);
  });

  it('InviteError carries a status code', () => {
    const err = new InviteError('INVITE_UNAUTHORIZED', 401);
    expect(err.code).toBe('INVITE_UNAUTHORIZED');
    expect(err.status).toBe(401);
  });
});
