/**
 * AC-M365SEP-013/014 — step 2, the client admin approves the PMO app for the organisation.
 *
 * `initiate_org_approval` is a SEPARATE authorization decision from the data-access gate
 * `authorizeMemberEntitled` (NFR-M365SEP-001): step 2 is an org-level administrative act ("may this
 * actor approve the app for the org?"), gated Admin-of-org OR platform Operator (FR-M365SEP-004) —
 * the same shape ADR-0065 applies to ClickUp/ERPNext connect. Step 3's gate (active member of an
 * entitled org) is a different question and a different gate; the two may share code, never one
 * decision.
 *
 * The handler returns Microsoft's admin-consent URL built from env.m365TenantId + env.m365ClientId
 * (FR-M365SEP-006 — never caller-supplied) and PERSISTS NOTHING (NFR-M365SEP-005, spec §1.5:
 * Microsoft is the authority on approval; a stored flag would drift the moment an admin revokes
 * consent in Entra).
 */
import { describe, it, expect } from 'vitest';
import { handleInitiateOrgApproval } from '../../../../../supabase/functions/m365-token-custody/orgApproval';
import { mockClient, deps } from './m365MockDeps';

/** An org Admin (the caller JWT carries their own profile row). */
function adminCaller() {
  return mockClient({
    profiles: [{ data: { org_id: 'org-1', role: 'Admin' }, error: null }],
  });
}

describe('AC-M365SEP-013/014 — handleInitiateOrgApproval (step 2 — org approval)', () => {
  describe('AC-M365SEP-013 — an org Admin receives a consent URL built from env (never caller-supplied), nothing persisted', () => {
    it('AC-M365SEP-013: an org Admin receives an admin-consent URL pinned to the env tenant + client id', async () => {
      const caller = adminCaller();
      const service = mockClient();

      const result = await handleInitiateOrgApproval(deps({ service, caller, userId: 'user-1' }));

      expect(result.status).toBe(200);
      const body = result.body as { adminConsentUrl: string };
      // The URL is built from env.m365TenantId + env.m365ClientId (the test env defaults), NEVER a
      // caller-supplied value (FR-M365SEP-006). An Admin passes without consulting platform_operators.
      expect(body.adminConsentUrl).toMatch(
        /^https:\/\/login\.microsoftonline\.com\/test-tenant-id\/v2\.0\/adminconsent/,
      );
      expect(body.adminConsentUrl).toContain('client_id=test-client-id');
      expect(body.adminConsentUrl).toContain('redirect_uri=');
      // An Admin short-circuits the gate before the platform_operators read.
      expect(service.from).not.toHaveBeenCalledWith('platform_operators');
    });

    it('AC-M365SEP-013: overriding env.m365TenantId/m365ClientId changes the URL — proves the URL is bound to env, not hardcoded', async () => {
      // This is the env-binding proof: if the handler hardcoded a tenant (or read one from a caller
      // body), overriding the env would NOT change the URL — and this test would redden.
      const caller = adminCaller();
      const service = mockClient();

      const result = await handleInitiateOrgApproval(
        deps({
          service,
          caller,
          userId: 'user-1',
          env: { m365TenantId: 'override-tenant', m365ClientId: 'override-client' },
        }),
      );

      const body = result.body as { adminConsentUrl: string };
      expect(body.adminConsentUrl).toContain('/override-tenant/v2.0/adminconsent');
      expect(body.adminConsentUrl).toContain('client_id=override-client');
    });

    it('AC-M365SEP-013: the handler persists NOTHING — no .from(...) write and no .rpc(...) call on either client', async () => {
      // NFR-M365SEP-005 / spec §1.5: PMO records nothing about org approval — Microsoft is the
      // authority. This assertion makes "nothing is persisted" provable rather than incidental: a
      // future change that adds an insert/update/upsert/delete or an RPC reddenens this test.
      const caller = adminCaller();
      const service = mockClient();

      await handleInitiateOrgApproval(deps({ service, caller, userId: 'user-1' }));

      // No MUTATION reached either client (reads — profiles — are recorded in `selects`, not writes).
      expect(service.writes).toHaveLength(0);
      expect(caller.writes).toHaveLength(0);
      // No RPC of any kind (audit / state / connection RPCs are all absent).
      expect(service.rpc).not.toHaveBeenCalled();
      expect(caller.rpc).not.toHaveBeenCalled();
    });
  });

  describe('AC-M365SEP-014 — a caller who is neither Admin-of-org nor Operator is forbidden (step 2 does NOT use the member gate)', () => {
    it('AC-M365SEP-014: an active, entitled Project Manager (not Admin, not Operator) is FORBIDDEN', async () => {
      // LOAD-BEARING for the two-gates invariant (NFR-M365SEP-001): this caller is an ACTIVE member
      // of an ENTITLED org — they would PASS `authorizeMemberEntitled` (the data-access gate). Step 2
      // uses the Admin-or-Operator gate instead, so they are forbidden. If the handler were wired to
      // `authorizeMemberEntitled`, this caller would get a 200 and this test would redden — which is
      // exactly mutation check #1 (the single most important check in this change).
      const caller = mockClient({
        profiles: [{ data: { org_id: 'org-1', role: 'Project Manager', status: 'active' }, error: null }],
        org_features: [{ data: { enabled: true }, error: null }], // entitled — the member gate would pass
      });
      const service = mockClient({
        platform_operators: [{ data: null, error: null }], // NOT an Operator
      });

      const result = await handleInitiateOrgApproval(deps({ service, caller, userId: 'user-1' }));

      expect(result).toMatchObject({ status: 403, body: { error: 'FORBIDDEN' } });
      // A forbidden caller persists nothing and receives no consent URL.
      expect(service.writes).toHaveLength(0);
      expect(caller.writes).toHaveLength(0);
      expect((result.body as { adminConsentUrl?: string }).adminConsentUrl).toBeUndefined();
    });

    it('AC-M365SEP-014: a caller with no resolvable profile is forbidden (discloses nothing about org existence)', async () => {
      const caller = mockClient({ profiles: [{ data: null, error: { code: 'PGRST116' } }] });
      const service = mockClient({ platform_operators: [{ data: null, error: null }] });

      const result = await handleInitiateOrgApproval(deps({ service, caller, userId: 'user-1' }));

      expect(result).toMatchObject({ status: 403, body: { error: 'FORBIDDEN' } });
    });
  });

  describe('FR-M365SEP-004 — the gate is Admin-of-org OR Operator (an Operator who is not an Admin passes)', () => {
    it('FR-M365SEP-004: a non-Admin platform Operator receives a consent URL (the OR half of the gate)', async () => {
      // Without this case the gate could collapse to "Admin only" and still pass AC-013/014 (whose
      // forbidden caller is non-Admin AND non-Operator). An Operator passes the OR — proving the
      // gate is exactly Admin-of-org OR Operator, matching ADR-0065's ClickUp/ERPNext gate.
      const caller = mockClient({
        profiles: [{ data: { org_id: 'org-1', role: 'Project Manager' }, error: null }], // not Admin
      });
      const service = mockClient({
        platform_operators: [{ data: { user_id: 'user-1' }, error: null }], // IS an Operator
      });

      const result = await handleInitiateOrgApproval(deps({ service, caller, userId: 'user-1' }));

      expect(result.status).toBe(200);
      const body = result.body as { adminConsentUrl: string };
      expect(body.adminConsentUrl).toMatch(/\/test-tenant-id\/v2\.0\/adminconsent/);
      // The non-Admin path consulted platform_operators service-side (ADR-0065 precedent).
      expect(service.from).toHaveBeenCalledWith('platform_operators');
      // Still persists nothing.
      expect(service.writes).toHaveLength(0);
      expect(service.rpc).not.toHaveBeenCalled();
    });
  });
});
