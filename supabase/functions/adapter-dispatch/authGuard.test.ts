// Luna money audit — BLOCK 4: server-side authorization gate for erpnext-tier commands.
// The dispatch must reject BEFORE any adapter/outbox/ERP write when:
// (a) the caller's org does NOT own the command's domain (public.domain_externally_owned(orgId, domain) is false) → 403
// (b) the caller's role is NOT permitted for a money write (Admin/Executive/Project Manager/Finance) → 403
// (c) command.domain != KIND_DOMAIN[erp_doc_kind] (cross-domain kind, e.g. domain:'procurement' with erp_doc_kind:'incoming-payment') → 422
// Deno-native test idiom (matches sodGuard.test.ts).
// Verify: cd supabase/functions/adapter-dispatch && deno test --allow-all --config deno.json authGuard.test.ts

import { assertEquals, assert } from 'jsr:@std/assert';
import { checkErpnextCommandAuthorization, MONEY_WRITE_ROLES, type AuthorizationClient } from './authGuard.ts';

/** Fake client resolving domain_externally_owned and the caller's role via profiles select. */
function fakeClient(opts: { domainOwned: boolean; role: string | null }): AuthorizationClient {
  return {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === 'domain_externally_owned') {
        return { data: opts.domainOwned, error: null };
      }
      return { data: null, error: { code: 'P0001', message: `unknown rpc: ${fn}` } };
    },
    from: (table: string) => {
      return {
        select: (columns: string) => {
          return {
            eq: (column: string, value: string) => {
              return {
                maybeSingle: async () => {
                  if (table === 'profiles' && column === 'id' && value === 'user-1') {
                    return { data: opts.role ? { role: opts.role } : null, error: null };
                  }
                  return { data: null, error: null };
                },
              };
            },
          };
        },
      };
    },
  };
}

Deno.test('checkErpnextCommandAuthorization: ok when org owns domain, role permitted, and domain matches kind', async () => {
  const res = await checkErpnextCommandAuthorization(
    fakeClient({ domainOwned: true, role: 'Admin' }),
    'org-1',
    'user-1',
    { domain: 'revenue', operation: 'create', record: { id: 'si-1', erp_doc_kind: 'sales-invoice' } } as any,
  );
  assertEquals(res.ok, true);
  assertEquals(res.status, 200);
});

Deno.test('checkErpnextCommandAuthorization: 403 when org does NOT own the domain', async () => {
  const res = await checkErpnextCommandAuthorization(
    fakeClient({ domainOwned: false, role: 'Admin' }),
    'org-1',
    'user-1',
    { domain: 'revenue', operation: 'create', record: { id: 'si-1', erp_doc_kind: 'sales-invoice' } } as any,
  );
  assertEquals(res.ok, false);
  assertEquals(res.status, 403);
  assert(res.message.includes('does not own domain') || res.message.includes('not authorized'));
});

Deno.test('checkErpnextCommandAuthorization: 403 when role is NOT permitted for money write (Engineer)', async () => {
  const res = await checkErpnextCommandAuthorization(
    fakeClient({ domainOwned: true, role: 'Engineer' }),
    'org-1',
    'user-1',
    { domain: 'revenue', operation: 'create', record: { id: 'si-1', erp_doc_kind: 'sales-invoice' } } as any,
  );
  assertEquals(res.ok, false);
  assertEquals(res.status, 403);
  assert(res.message.includes('role') || res.message.includes('not authorized'));
});

Deno.test('checkErpnextCommandAuthorization: 403 when profile not found (unauthenticated)', async () => {
  const res = await checkErpnextCommandAuthorization(
    fakeClient({ domainOwned: true, role: null }),
    'org-1',
    'user-1',
    { domain: 'revenue', operation: 'create', record: { id: 'si-1', erp_doc_kind: 'sales-invoice' } } as any,
  );
  assertEquals(res.ok, false);
  assertEquals(res.status, 403);
  assert(res.message.includes('role not resolvable') || res.message.includes('not authorized'));
});

Deno.test('checkErpnextCommandAuthorization: 422 when command.domain mismatches KIND_DOMAIN[erp_doc_kind] (cross-domain kind)', async () => {
  const res = await checkErpnextCommandAuthorization(
    fakeClient({ domainOwned: true, role: 'Admin' }),
    'org-1',
    'user-1',
    { domain: 'procurement', operation: 'create', record: { id: 'ip-1', erp_doc_kind: 'incoming-payment' } } as any,
  );
  assertEquals(res.ok, false);
  assertEquals(res.status, 422);
  assert(res.message.includes('domain') || res.message.includes('kind') || res.message.includes('mismatch'));
});

Deno.test('checkErpnextCommandAuthorization: 422 when erp_doc_kind is missing on a transition', async () => {
  const res = await checkErpnextCommandAuthorization(
    fakeClient({ domainOwned: true, role: 'Admin' }),
    'org-1',
    'user-1',
    { domain: 'revenue', operation: 'transition', record: { id: 'si-1' } } as any,
  );
  assertEquals(res.ok, false);
  assertEquals(res.status, 422);
  assert(res.message.includes('erp_doc_kind') || res.message.includes('missing'));
});

Deno.test('checkErpnextCommandAuthorization: all MONEY_WRITE_ROLES are permitted', async () => {
  for (const role of MONEY_WRITE_ROLES) {
    const res = await checkErpnextCommandAuthorization(
      fakeClient({ domainOwned: true, role }),
      'org-1',
      'user-1',
      { domain: 'revenue', operation: 'create', record: { id: 'si-1', erp_doc_kind: 'sales-invoice' } } as any,
    );
    assertEquals(res.ok, true, `role ${role} should be permitted`);
  }
});

Deno.test('checkErpnextCommandAuthorization: non-money roles are denied (Engineer, Viewer)', async () => {
  for (const role of ['Engineer', 'Viewer', 'Intern']) {
    const res = await checkErpnextCommandAuthorization(
      fakeClient({ domainOwned: true, role }),
      'org-1',
      'user-1',
      { domain: 'revenue', operation: 'create', record: { id: 'si-1', erp_doc_kind: 'sales-invoice' } } as any,
    );
    assertEquals(res.ok, false, `role ${role} should be denied`);
    assertEquals(res.status, 403);
  }
});