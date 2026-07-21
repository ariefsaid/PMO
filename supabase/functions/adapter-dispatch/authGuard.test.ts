// Luna money audit — BLOCK 4: server-side authorization gate for erpnext-tier commands.
// The dispatch must reject BEFORE any adapter/outbox/ERP write when:
// (a) the caller's org does NOT own the command's domain (public.domain_externally_owned(orgId, domain) is false) → 403
// (b) the caller's role is NOT permitted for a money write (Admin/Executive/Project Manager/Finance) → 403
// (c) command.domain != KIND_DOMAIN[erp_doc_kind] (cross-domain kind, e.g. domain:'procurement' with erp_doc_kind:'incoming-payment') → 422
// Deno-native test idiom (matches sodGuard.test.ts).
// Verify: cd supabase/functions/adapter-dispatch && deno test --allow-all --config deno.json authGuard.test.ts

import { assertEquals, assert } from 'jsr:@std/assert';
import {
  checkErpnextCommandAuthorization,
  checkOutboxReplayAuthorization,
  moneyWriteRolesForDomain,
  replayMayIssueErpWrite,
  type AuthorizationClient,
} from './authGuard.ts';

/**
 * Fake client resolving the two authorization RPCs:
 *  - `domain_owned_by_tier(org, domain, tier)` — TIER-SPECIFIC ownership (B9);
 *  - `actor_authorization_state(org, user)`    — the actor's CURRENT role + active membership.
 * `ownedByTier` names the (domain, tier) pairs the org actually assigned; anything else is unowned.
 */
function fakeClient(opts: {
  domainOwned: boolean;
  role: string | null;
  active?: boolean;
  /** Restrict ownership to specific `${domain}:${tier}` pairs (default: every domain on `erpnext`). */
  ownedPairs?: readonly string[];
  actorId?: string;
}): AuthorizationClient {
  const actorId = opts.actorId ?? 'user-1';
  return {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === 'domain_owned_by_tier') {
        if (!opts.domainOwned) return { data: false, error: null };
        const pair = `${String(args.p_domain)}:${String(args.p_tier)}`;
        const owned = opts.ownedPairs ? opts.ownedPairs.includes(pair) : args.p_tier === 'erpnext';
        return { data: owned, error: null };
      }
      if (fn === 'actor_authorization_state') {
        if (args.p_user_id !== actorId) return { data: { role: null, active: false }, error: null };
        return { data: { role: opts.role, active: opts.active ?? opts.role !== null }, error: null };
      }
      return { data: null, error: { code: 'P0001', message: `unknown rpc: ${fn}` } };
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

// An unresolvable actor (no profile row) reports `{role:null, active:false}` — refused as a
// non-active member, which is the same fail-closed outcome with a more precise message.
Deno.test('checkErpnextCommandAuthorization: 403 when the actor is not resolvable (no profile row)', async () => {
  const res = await checkErpnextCommandAuthorization(
    fakeClient({ domainOwned: true, role: null }),
    'org-1',
    'user-1',
    { domain: 'revenue', operation: 'create', record: { id: 'si-1', erp_doc_kind: 'sales-invoice' } } as any,
  );
  assertEquals(res.ok, false);
  assertEquals(res.status, 403);
  assert(
    res.message.includes('role not resolvable') || res.message.includes('not authorized') || res.message.includes('not an active member'),
    res.message,
  );
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

Deno.test('checkErpnextCommandAuthorization: every role in a domain\'s write set is permitted for that domain', async () => {
  for (const domain of ['revenue', 'procurement', 'companies']) {
    const kind = domain === 'revenue' ? 'sales-invoice' : domain === 'procurement' ? 'purchase-invoice' : 'supplier';
    for (const role of moneyWriteRolesForDomain(domain)) {
      const res = await checkErpnextCommandAuthorization(
        fakeClient({ domainOwned: true, role }),
        'org-1',
        'user-1',
        { domain, operation: 'create', record: { id: 'rec-1', erp_doc_kind: kind } } as any,
      );
      assertEquals(res.ok, true, `role ${role} should be permitted on ${domain}`);
    }
  }
});

// ════════════════════════════════════════════════════════════════════════════
// Round-6 re-audit, finding 3 — the REVENUE write set must match the owner ruling (2026-07-20:
// revenue write = Admin + Finance, `pmo-portal/src/auth/policy.ts` REVENUE_WRITE).
//
// The defect: one shared 4-role `MONEY_WRITE_ROLES` admitted Executive and Project Manager on EVERY
// erpnext domain. A PM with no revenue affordance in the UI could POST straight to adapter-dispatch
// with a sales-invoice CANCEL transition — `isRevenueSiSubmitTransition` is false for `cancel`, so no
// SoD gate applies either — and reverse a submitted invoice's AR. The FE-stricter-than-RLS principle
// permits a NARROWER front end; it does not permit the BACKEND (the enforcement authority) to be the
// permissive side, which made the ruling unreal.
//
// PROCUREMENT's ruling is different and deliberately unchanged (Admin·Exec·PM·Finance).
// ════════════════════════════════════════════════════════════════════════════

Deno.test('finding 3: a Project Manager is REFUSED a revenue sales-invoice cancel (the owner ruling is enforced server-side)', async () => {
  const res = await checkErpnextCommandAuthorization(
    fakeClient({ domainOwned: true, role: 'Project Manager' }),
    'org-1',
    'user-1',
    { domain: 'revenue', operation: 'transition', record: { id: 'si-1', erp_doc_kind: 'sales-invoice', verb: 'cancel' } } as any,
  );
  assertEquals(res.ok, false, 'a PM must not be able to cancel a submitted Sales Invoice / reverse AR');
  assertEquals(res.status, 403);
});

Deno.test('finding 3: an Executive is REFUSED every revenue write (create, update, transition)', async () => {
  for (const operation of ['create', 'update', 'transition']) {
    const res = await checkErpnextCommandAuthorization(
      fakeClient({ domainOwned: true, role: 'Executive' }),
      'org-1',
      'user-1',
      { domain: 'revenue', operation, record: { id: 'si-1', erp_doc_kind: 'sales-invoice' } } as any,
    );
    assertEquals(res.ok, false, `an Executive must not be able to ${operation} revenue`);
    assertEquals(res.status, 403);
  }
});

Deno.test('finding 3: an incoming payment (revenue) is equally closed to Exec/PM', async () => {
  for (const role of ['Executive', 'Project Manager']) {
    const res = await checkErpnextCommandAuthorization(
      fakeClient({ domainOwned: true, role }),
      'org-1',
      'user-1',
      { domain: 'revenue', operation: 'create', record: { id: 'ip-1', erp_doc_kind: 'incoming-payment' } } as any,
    );
    assertEquals(res.ok, false, `${role} must not be able to record a customer receipt`);
  }
});

Deno.test('finding 3: Admin and Finance keep the full revenue write (the ruling is not a lockout)', async () => {
  for (const role of ['Admin', 'Finance']) {
    const res = await checkErpnextCommandAuthorization(
      fakeClient({ domainOwned: true, role }),
      'org-1',
      'user-1',
      { domain: 'revenue', operation: 'transition', record: { id: 'si-1', erp_doc_kind: 'sales-invoice', verb: 'cancel' } } as any,
    );
    assertEquals(res.ok, true, `${role} is a revenue writer under the ruling`);
  }
});

Deno.test('finding 3: PROCUREMENT is NOT narrowed — a PM keeps their purchase-invoice + payment writes', async () => {
  for (const kind of ['purchase-invoice', 'purchase-order', 'payment']) {
    const res = await checkErpnextCommandAuthorization(
      fakeClient({ domainOwned: true, role: 'Project Manager' }),
      'org-1',
      'user-1',
      { domain: 'procurement', operation: 'create', record: { id: 'rec-1', erp_doc_kind: kind } } as any,
    );
    assertEquals(res.ok, true, `a PM must keep their procurement ${kind} write (that domain's ruling is different)`);
  }
  // …and the companies (party master-data) domain likewise keeps the four master-data roles.
  const party = await checkErpnextCommandAuthorization(
    fakeClient({ domainOwned: true, role: 'Executive' }),
    'org-1',
    'user-1',
    { domain: 'companies', operation: 'create', record: { id: 'c-1', erp_doc_kind: 'customer' } } as any,
  );
  assertEquals(party.ok, true, 'party master data keeps its master-data write set');
});

Deno.test('finding 3: an unmapped erpnext domain FAILS CLOSED (a new domain must opt in to a role set)', async () => {
  assertEquals(moneyWriteRolesForDomain('a-future-domain').length, 0);
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
// ════════════════════════════════════════════════════════════════════════════
// Round-7 cross-family audit, B9 — ERP-tier ownership is checked too generically.
//
// `domain_externally_owned(org, domain)` (0087:48-51) ignores `external_tier`, and this guard called it
// without one. So if an org assigns `revenue` to a DIFFERENT external tier (odoo) while an ERPNext
// binding still exists, the ERPNext dispatch surface keeps accepting + posting revenue money commands
// for a domain ERPNext no longer owns. The sweep already scopes its ownership read by tier
// (`erpnext-sweep/index.ts` listEmployingOrgsLive `.eq('external_tier', ERPNEXT_TIER)`) — this guard is
// the one place the tier was dropped. Fixed via `domain_owned_by_tier(org, domain, tier)` (mig 0117).
// ════════════════════════════════════════════════════════════════════════════

Deno.test('B9: a domain owned by ANOTHER external tier is refused on the ERPNext dispatch surface', async () => {
  const res = await checkErpnextCommandAuthorization(
    // revenue is assigned to `odoo`; the org has NO erpnext ownership of revenue.
    fakeClient({ domainOwned: true, role: 'Finance', ownedPairs: ['revenue:odoo', 'procurement:erpnext'] }),
    'org-1',
    'user-1',
    { domain: 'revenue', operation: 'create', record: { id: 'si-1', erp_doc_kind: 'sales-invoice' } } as any,
  );
  assertEquals(res.ok, false, 'ERPNext must not post revenue money for a domain another tier owns');
  assertEquals(res.status, 403);
  assert(res.message.includes('erpnext'), `message should name the tier: ${res.message}`);
});

Deno.test('B9: the SAME domain owned by the erpnext tier is still permitted', async () => {
  const res = await checkErpnextCommandAuthorization(
    fakeClient({ domainOwned: true, role: 'Finance', ownedPairs: ['revenue:erpnext'] }),
    'org-1',
    'user-1',
    { domain: 'revenue', operation: 'create', record: { id: 'si-1', erp_doc_kind: 'sales-invoice' } } as any,
  );
  assertEquals(res.ok, true);
});

Deno.test('B9: a DEACTIVATED actor is refused even with a money-write role', async () => {
  const res = await checkErpnextCommandAuthorization(
    fakeClient({ domainOwned: true, role: 'Finance', active: false }),
    'org-1',
    'user-1',
    { domain: 'revenue', operation: 'create', record: { id: 'si-1', erp_doc_kind: 'sales-invoice' } } as any,
  );
  assertEquals(res.ok, false, 'a deactivated/banned member must not move money');
  assertEquals(res.status, 403);
});

// ════════════════════════════════════════════════════════════════════════════
// Round-7 cross-family audit, B6 — sweep recovery bypasses CURRENT authorization.
//
// The sweep rebuilds the command from the FROZEN outbox payload and calls `dispatchMoneyWrite`
// directly, so a replay re-runs NONE of the dispatch gates. 0112 bounded WHICH rows replay and the
// sweep gained a domain-snapshot check, but the original actor's CURRENT role / active membership was
// never re-evaluated: a user could issue a command, be demoted or deactivated, and still have the cron
// post it up to 24 hours later.
//
// The rule is NOT forked: `checkOutboxReplayAuthorization` reconstructs the command from the row and
// delegates to `checkErpnextCommandAuthorization` — the same function the synchronous path runs.
// A refusal NEVER drops the row: the sweep records it as a per-candidate error and leaves the row
// exactly as it is (operator-visible), per `reconcileOrgOutbox`'s existing domain-not-owned handling.
// ════════════════════════════════════════════════════════════════════════════

const pendingRow = {
  id: 'ob-1',
  state: 'pending',
  domain: 'revenue',
  operation: 'create',
  pmoRecordId: 'si-1',
  actorUserId: 'user-1',
  payload: { id: 'si-1', erp_doc_kind: 'sales-invoice' },
};

Deno.test('B6: replay of a pending row is REFUSED when the original actor has been demoted', async () => {
  const res = await checkOutboxReplayAuthorization(
    fakeClient({ domainOwned: true, role: 'Engineer' }),
    'org-1',
    pendingRow,
  );
  assertEquals(res.ok, false, 'a demoted actor must not have their frozen money command auto-posted');
  assertEquals(res.status, 403);
  assert(res.message.includes('ob-1'), `the message must identify the held row: ${res.message}`);
});

Deno.test('B6: replay of a pending row is REFUSED when the original actor has been deactivated', async () => {
  const res = await checkOutboxReplayAuthorization(
    fakeClient({ domainOwned: true, role: 'Finance', active: false }),
    'org-1',
    pendingRow,
  );
  assertEquals(res.ok, false);
  assertEquals(res.status, 403);
});

Deno.test('B6: replay is REFUSED when the domain is no longer owned by the erpnext tier (TOCTOU-tight: checked at replay, not from a snapshot)', async () => {
  const res = await checkOutboxReplayAuthorization(
    fakeClient({ domainOwned: true, role: 'Finance', ownedPairs: ['revenue:odoo'] }),
    'org-1',
    pendingRow,
  );
  assertEquals(res.ok, false);
  assertEquals(res.status, 403);
});

Deno.test('B6: replay of a pending row with NO recorded actor fails CLOSED (held for an operator)', async () => {
  const res = await checkOutboxReplayAuthorization(
    fakeClient({ domainOwned: true, role: 'Finance' }),
    'org-1',
    { ...pendingRow, actorUserId: null },
  );
  assertEquals(res.ok, false, 'an unattributable money command must never be auto-posted');
  assertEquals(res.status, 403);
  assert(res.message.includes('actor'), res.message);
});

Deno.test('B6: replay of a pending row is ALLOWED when the actor still passes the full synchronous rule', async () => {
  const res = await checkOutboxReplayAuthorization(
    fakeClient({ domainOwned: true, role: 'Finance' }),
    'org-1',
    pendingRow,
  );
  assertEquals(res.ok, true, `an unchanged, still-authorized actor keeps converging: ${res.message}`);
});

Deno.test('B6: a `failed` row (the other state that may issue a NEW ERP write) is re-authorized too', async () => {
  const demoted = await checkOutboxReplayAuthorization(
    fakeClient({ domainOwned: true, role: 'Project Manager' }),
    'org-1',
    { ...pendingRow, state: 'failed', operation: 'update' },
  );
  assertEquals(demoted.ok, false, 'a PM is not a revenue writer — the same ruling as the synchronous path');
  assertEquals(demoted.status, 403);
});

Deno.test('B6: finalize-only / safety states keep converging — re-authorization must not strand posted money', async () => {
  // `committed` (ref + mirror + confirm), `committing`-past-lease (→ quarantine) and `quarantined`
  // (adopt-or-hold) issue NO new ERP write; the money either exists in ERP already or is being made
  // visible. Blocking them on a demoted actor would strand a REAL ERP document unmirrored forever.
  for (const state of ['committed', 'committing', 'quarantined']) {
    assertEquals(replayMayIssueErpWrite(state), false, `${state} issues no new ERP write`);
    const res = await checkOutboxReplayAuthorization(
      fakeClient({ domainOwned: true, role: 'Engineer' }),
      'org-1',
      { ...pendingRow, state, actorUserId: null },
    );
    assertEquals(res.ok, true, `${state} must keep converging regardless of the actor's current role`);
  }
  for (const state of ['pending', 'failed']) {
    assertEquals(replayMayIssueErpWrite(state), true, `${state} may issue a NEW ERP write`);
  }
});

Deno.test('B6: a replay whose frozen payload has an unknown/absent erp_doc_kind is refused 422 (same rule as the synchronous path)', async () => {
  const res = await checkOutboxReplayAuthorization(
    fakeClient({ domainOwned: true, role: 'Finance' }),
    'org-1',
    { ...pendingRow, payload: { id: 'si-1' } },
  );
  assertEquals(res.ok, false);
  assertEquals(res.status, 422);
});

Deno.test('B6: replay authorization is the SAME rule as the synchronous path (parity over every role)', async () => {
  for (const role of ['Admin', 'Finance', 'Executive', 'Project Manager', 'Engineer', 'Viewer']) {
    const sync = await checkErpnextCommandAuthorization(
      fakeClient({ domainOwned: true, role }),
      'org-1',
      'user-1',
      { domain: 'revenue', operation: 'create', record: { id: 'si-1', erp_doc_kind: 'sales-invoice' } } as any,
    );
    const replay = await checkOutboxReplayAuthorization(fakeClient({ domainOwned: true, role }), 'org-1', pendingRow);
    assertEquals(replay.ok, sync.ok, `role ${role}: replay and synchronous verdicts must not diverge`);
  }
});
