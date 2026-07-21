// Luna re-audit BLOCK #2 + BLOCK #4 — the PMO-target binding guards.
//
// These tests import the REAL module (the previous revision re-implemented the logic inline and
// asserted the copy — it could never catch a regression in the shipped guard).
//
// BLOCK #2 (non-SI transitions have no PMO target binding): EVERY erpnext transition/update — all
// kinds, all domains — must be bound to the PMO record's OWN recorded `external_refs` mapping, and a
// MISSING mapping must FAIL CLOSED. Previously only revenue sales-invoice transitions were guarded
// and a missing mapping was permitted, so an authorized caller could submit/cancel an arbitrary ERP
// document by pairing their own PMO id with someone else's `externalRecordId`.
//
// BLOCK #4 (caller-controlled PMO ids permit ref overwrite): a `create` must not target an
// ALREADY-MAPPED PMO record — otherwise `record_outbox_ref` repoints that record's external identity
// to a brand-new ERP document before the mirror insert fails on the duplicate PK. The one legitimate
// exception is this same command's own retry (same idempotency key ⇒ an outbox row already exists).
//
// Verify: deno test supabase/functions/adapter-dispatch/ --config supabase/functions/adapter-dispatch/deno.json

import { assert, assertEquals } from 'jsr:@std/assert';
import {
  checkCreateTargetUnmapped,
  checkTransitionTargetBinding,
  isOpaqueIdempotencyKey,
  type GuardLookupClient,
} from './transitionTargetGuard.ts';

/** Fake service-role client over the two tables the guards read: `external_refs` (the PMO→ERP
 *  mapping) and `external_command_outbox` (this command's own in-flight row, for the retry
 *  exemption). Column filters are recorded so a test can assert the guard scoped its lookup. */
function fakeClient(opts: {
  mappedExternalId?: string | null;
  outboxKeys?: string[];
}): GuardLookupClient & { filters: Record<string, string>[] } {
  const filters: Record<string, string>[] = [];
  const client = {
    filters,
    from(table: string) {
      const applied: Record<string, string> = { table };
      filters.push(applied);
      const builder = {
        eq(column: string, value: string) {
          applied[column] = value;
          return builder;
        },
        async maybeSingle() {
          if (table === 'external_refs') {
            const mapped = opts.mappedExternalId ?? null;
            return { data: mapped ? { external_record_id: mapped } : null, error: null };
          }
          if (table === 'external_command_outbox') {
            const has = (opts.outboxKeys ?? []).includes(applied.idempotency_key);
            return { data: has ? { id: 'outbox-1' } : null, error: null };
          }
          return { data: null, error: null };
        },
      };
      return { select: (_columns: string) => builder };
    },
  };
  return client as unknown as GuardLookupClient & { filters: Record<string, string>[] };
}

// ── BLOCK #2 — transition/update target binding ────────────────────────────────────────────────

Deno.test('BLOCK2: a revenue sales-invoice transition whose externalRecordId matches the mapping is allowed', async () => {
  const res = await checkTransitionTargetBinding(fakeClient({ mappedExternalId: 'ACC-SINV-2026-00001' }), 'org-1', {
    domain: 'revenue',
    operation: 'transition',
    record: { id: 'si-1', erp_doc_kind: 'sales-invoice', externalRecordId: 'ACC-SINV-2026-00001' },
  });
  assertEquals(res.ok, true);
});

Deno.test('BLOCK2: a revenue sales-invoice transition targeting ANOTHER document is rejected 422', async () => {
  const res = await checkTransitionTargetBinding(fakeClient({ mappedExternalId: 'ACC-SINV-2026-00001' }), 'org-1', {
    domain: 'revenue',
    operation: 'transition',
    record: { id: 'si-1', erp_doc_kind: 'sales-invoice', externalRecordId: 'ACC-SINV-2026-00002' },
  });
  assertEquals(res.ok, false);
  assertEquals(res.status, 422);
});

Deno.test('BLOCK2: an incoming-payment cancel targeting a DIFFERENT Payment Entry is rejected 422 (the kind is no longer exempt)', async () => {
  // The exploit: cancel a Pay Payment Entry through the Receive kind by supplying its ERP name
  // alongside an own-org incoming_payments id.
  const res = await checkTransitionTargetBinding(fakeClient({ mappedExternalId: 'ACC-PAY-2026-00009' }), 'org-1', {
    domain: 'revenue',
    operation: 'transition',
    record: { id: 'ip-1', erp_doc_kind: 'incoming-payment', verb: 'cancel', externalRecordId: 'ACC-PAY-2026-00042' },
  });
  assertEquals(res.ok, false);
  assertEquals(res.status, 422);
});

Deno.test('BLOCK2: a procurement transition targeting a DIFFERENT document is rejected 422 (the domain is no longer exempt)', async () => {
  const res = await checkTransitionTargetBinding(fakeClient({ mappedExternalId: 'ACC-PINV-2026-00001' }), 'org-1', {
    domain: 'procurement',
    operation: 'transition',
    record: { id: 'pi-1', erp_doc_kind: 'purchase-invoice', verb: 'cancel', externalRecordId: 'ACC-PINV-2026-00002' },
  });
  assertEquals(res.ok, false);
  assertEquals(res.status, 422);
});

Deno.test('BLOCK2: a transition on a PMO record with NO recorded mapping FAILS CLOSED (422), never permitted', async () => {
  // The core of the finding: a random own-org PMO id + another document's ERP name previously passed
  // straight through because "no mapping yet" was treated as not-applicable.
  const res = await checkTransitionTargetBinding(fakeClient({ mappedExternalId: null }), 'org-1', {
    domain: 'revenue',
    operation: 'transition',
    record: { id: 'si-unmapped', erp_doc_kind: 'sales-invoice', externalRecordId: 'ACC-SINV-2026-00001' },
  });
  assertEquals(res.ok, false);
  assertEquals(res.status, 422);
  assert(/mapping/i.test(res.message));
});

Deno.test('BLOCK2: an UPDATE (which routes to amend on a submitted doc) is bound to the mapping too', async () => {
  const res = await checkTransitionTargetBinding(fakeClient({ mappedExternalId: 'ACC-SINV-2026-00001' }), 'org-1', {
    domain: 'revenue',
    operation: 'update',
    record: { id: 'si-1', erp_doc_kind: 'sales-invoice', externalRecordId: 'ACC-SINV-2026-00002' },
  });
  assertEquals(res.ok, false);
  assertEquals(res.status, 422);
});

Deno.test('BLOCK2: the companies "<Doctype>:<name>" storage encoding still matches a bare ERP name', async () => {
  const res = await checkTransitionTargetBinding(fakeClient({ mappedExternalId: 'Customer:ACME Ltd' }), 'org-1', {
    domain: 'companies',
    operation: 'update',
    record: { id: 'co-1', erp_doc_kind: 'customer', externalRecordId: 'ACME Ltd' },
  });
  assertEquals(res.ok, true);
});

Deno.test('BLOCK2: the mapping lookup is scoped to the caller org + the command domain + the PMO record id', async () => {
  const client = fakeClient({ mappedExternalId: 'ACC-SINV-2026-00001' });
  await checkTransitionTargetBinding(client, 'org-1', {
    domain: 'revenue',
    operation: 'transition',
    record: { id: 'si-1', erp_doc_kind: 'sales-invoice', externalRecordId: 'ACC-SINV-2026-00001' },
  });
  const refsLookup = client.filters.find((f) => f.table === 'external_refs');
  assertEquals(refsLookup?.org_id, 'org-1');
  assertEquals(refsLookup?.domain, 'revenue');
  assertEquals(refsLookup?.pmo_record_id, 'si-1');
});

Deno.test('BLOCK2: a create is not a transition — the binding guard does not apply', async () => {
  const res = await checkTransitionTargetBinding(fakeClient({ mappedExternalId: null }), 'org-1', {
    domain: 'revenue',
    operation: 'create',
    record: { id: 'si-new', erp_doc_kind: 'sales-invoice' },
  });
  assertEquals(res.ok, true);
});

Deno.test('BLOCK2: a non-erpnext domain (P0/P1) is untouched', async () => {
  const res = await checkTransitionTargetBinding(fakeClient({ mappedExternalId: null }), 'org-1', {
    domain: 'tasks',
    operation: 'update',
    record: { id: 'task-1', externalRecordId: 'cu-123' },
  });
  assertEquals(res.ok, true);
});

Deno.test('BLOCK2: a mapped record with a server-resolved target (no caller externalRecordId) is allowed', async () => {
  // The companies update path resolves the ERP name server-side (ctx.refs.self) and sends none —
  // there is no caller-supplied target to bind, but the mapping must still exist.
  const res = await checkTransitionTargetBinding(fakeClient({ mappedExternalId: 'Supplier:ACME' }), 'org-1', {
    domain: 'companies',
    operation: 'update',
    record: { id: 'co-1', erp_doc_kind: 'supplier' },
  });
  assertEquals(res.ok, true);
});

// ── BLOCK #4 — a create must not target an already-mapped PMO record ────────────────────────────

Deno.test('BLOCK4: a create against an UNMAPPED (genuinely new) PMO record is allowed', async () => {
  const res = await checkCreateTargetUnmapped(fakeClient({ mappedExternalId: null }), 'org-1', {
    domain: 'revenue',
    operation: 'create',
    record: { id: 'si-new', erp_doc_kind: 'sales-invoice' },
  }, 'key-1');
  assertEquals(res.ok, true);
});

Deno.test('BLOCK4: a create REUSING an already-mapped PMO record id is rejected 422 before any ERP write', async () => {
  const res = await checkCreateTargetUnmapped(fakeClient({ mappedExternalId: 'ACC-SINV-2026-00001', outboxKeys: ['other-key'] }), 'org-1', {
    domain: 'revenue',
    operation: 'create',
    record: { id: 'si-existing', erp_doc_kind: 'sales-invoice' },
  }, 'attacker-key');
  assertEquals(res.ok, false);
  assertEquals(res.status, 422);
  assert(/already mapped/i.test(res.message));
});

Deno.test('BLOCK4: this command\'s OWN retry (same idempotency key ⇒ its outbox row exists) is still allowed to finalize', async () => {
  // record_outbox_ref writes the mapping BEFORE the mirror insert, so a crash-and-retry legitimately
  // re-enters with a mapping already present. Rejecting that would break recovery.
  const res = await checkCreateTargetUnmapped(fakeClient({ mappedExternalId: 'ACC-SINV-2026-00001', outboxKeys: ['key-1'] }), 'org-1', {
    domain: 'revenue',
    operation: 'create',
    record: { id: 'si-1', erp_doc_kind: 'sales-invoice' },
  }, 'key-1');
  assertEquals(res.ok, true);
});

Deno.test('BLOCK4: the outbox retry lookup is scoped to org + domain + record + idempotency key', async () => {
  const client = fakeClient({ mappedExternalId: 'ACC-SINV-2026-00001', outboxKeys: ['key-1'] });
  await checkCreateTargetUnmapped(client, 'org-1', {
    domain: 'revenue',
    operation: 'create',
    record: { id: 'si-1', erp_doc_kind: 'sales-invoice' },
  }, 'key-1');
  const outboxLookup = client.filters.find((f) => f.table === 'external_command_outbox');
  assertEquals(outboxLookup?.org_id, 'org-1');
  assertEquals(outboxLookup?.domain, 'revenue');
  assertEquals(outboxLookup?.pmo_record_id, 'si-1');
  assertEquals(outboxLookup?.idempotency_key, 'key-1');
});

Deno.test('BLOCK4: a mapped record with NO idempotency key cannot slip through the retry exemption', async () => {
  const res = await checkCreateTargetUnmapped(fakeClient({ mappedExternalId: 'ACC-SINV-2026-00001', outboxKeys: ['key-1'] }), 'org-1', {
    domain: 'revenue',
    operation: 'create',
    record: { id: 'si-1', erp_doc_kind: 'sales-invoice' },
  }, undefined);
  assertEquals(res.ok, false);
  assertEquals(res.status, 422);
});

Deno.test('BLOCK4: a non-erpnext domain (P0/P1) is untouched', async () => {
  const res = await checkCreateTargetUnmapped(fakeClient({ mappedExternalId: 'cu-123' }), 'org-1', {
    domain: 'tasks',
    operation: 'create',
    record: { id: 'task-1' },
  }, 'key-1');
  assertEquals(res.ok, true);
});

// ── BLOCK #1 (Lane C hand-off) — the idempotency key must be an OPAQUE UUID ──────────────────────
//
// The recovery probe matches the anchor field with `%key%` — a SUBSTRING match, kept deliberately
// (Lane C): a false-negative probe triggers a REISSUE, i.e. duplicate money, which is worse than the
// wildcard injection Lane C closed by escaping LIKE metacharacters in client.ts. That leaves a second
// vector at THIS boundary: a direct caller supplying a short key (`"1"`) matches every ERP document
// whose anchor merely CONTAINS it, and recovery adopts the wrong document.
//
// Requiring a UUID-shaped key makes the whole substring class unreachable by construction — a UUID
// cannot be a proper substring of another document's UUID anchor. NOT a length check: UUID-shaped or
// rejected. The legitimate client already mints `crypto.randomUUID()` (repositories/index.ts
// `freshIdempotencyKey`).

Deno.test('BLOCK1: a real crypto.randomUUID() key is accepted', () => {
  assertEquals(isOpaqueIdempotencyKey(crypto.randomUUID()), true);
  assertEquals(isOpaqueIdempotencyKey('3f2504e0-4f89-41d3-9a0c-0305e82c3301'), true);
});

Deno.test('BLOCK1: an UPPERCASE UUID is accepted (case-insensitive hex)', () => {
  assertEquals(isOpaqueIdempotencyKey('3F2504E0-4F89-41D3-9A0C-0305E82C3301'), true);
});

Deno.test('BLOCK1: a SHORT key that could substring-match another document\'s anchor is rejected', () => {
  assertEquals(isOpaqueIdempotencyKey('1'), false);
  assertEquals(isOpaqueIdempotencyKey('key-1'), false);
  assertEquals(isOpaqueIdempotencyKey('ac-ena-050-abc'), false);
});

Deno.test('BLOCK1: a long-but-not-UUID key is rejected (never relaxed to a length threshold)', () => {
  assertEquals(isOpaqueIdempotencyKey('a'.repeat(64)), false);
  assertEquals(isOpaqueIdempotencyKey('0305e82c3301-3f2504e0-4f89-41d3-9a0c'), false);
});

Deno.test('BLOCK1: LIKE metacharacters cannot appear in an accepted key (the injection class stays closed at this boundary too)', () => {
  assertEquals(isOpaqueIdempotencyKey('%'), false);
  assertEquals(isOpaqueIdempotencyKey('3f2504e0-4f89-41d3-9a0c-0305e82c33%1'), false);
  assertEquals(isOpaqueIdempotencyKey('_f2504e0-4f89-41d3-9a0c-0305e82c3301'), false);
});

Deno.test('BLOCK1: a UUID with surrounding whitespace or extra characters is rejected (anchored match)', () => {
  assertEquals(isOpaqueIdempotencyKey(' 3f2504e0-4f89-41d3-9a0c-0305e82c3301'), false);
  assertEquals(isOpaqueIdempotencyKey('3f2504e0-4f89-41d3-9a0c-0305e82c3301x'), false);
});

Deno.test('BLOCK1: an absent/empty/non-string key is rejected', () => {
  assertEquals(isOpaqueIdempotencyKey(undefined), false);
  assertEquals(isOpaqueIdempotencyKey(''), false);
  assertEquals(isOpaqueIdempotencyKey(12345 as unknown as string), false);
});

// ── P3b (FR-TSP-013) — the timesheets domain accepts NO client-supplied ERP target at all ─────────

Deno.test('FR-TSP-013: a timesheets command carrying ANY externalRecordId is refused 422 (create)', async () => {
  // Stricter than the compare-against-external_refs rule the other domains take: for a Posture-B push
  // the ERP target is resolved solely server-side, so rejecting the mere PRESENCE of a caller-supplied
  // target removes the "authorized PMO id + foreign ERP document" class by construction.
  const res = await checkCreateTargetUnmapped(
    fakeClient({ mappedExternalId: null }),
    'org-1',
    { domain: 'timesheets', operation: 'create', record: { id: 'ts-1', erp_doc_kind: 'timesheet', externalRecordId: 'TS-2026-00011' } },
    'ts:ts-1:2026-01-12T03:04:05Z',
  );
  assertEquals(res.ok, false);
  assertEquals(res.status, 422);
  assert(res.message.includes('externalRecordId'));
});

Deno.test('FR-TSP-013: a timesheets transition carrying an externalRecordId is refused 422 too', async () => {
  const res = await checkTransitionTargetBinding(
    fakeClient({ mappedExternalId: 'TS-2026-00011' }),
    'org-1',
    { domain: 'timesheets', operation: 'transition', record: { id: 'ts-1', erp_doc_kind: 'timesheet', externalRecordId: 'TS-2026-00011' } },
  );
  assertEquals(res.ok, false);
  assertEquals(res.status, 422);
});

Deno.test('FR-TSP-013: a clean timesheets create (no externalRecordId, unmapped record) passes both guards', async () => {
  const client = fakeClient({ mappedExternalId: null });
  const create = await checkCreateTargetUnmapped(client, 'org-1', { domain: 'timesheets', operation: 'create', record: { id: 'ts-1', erp_doc_kind: 'timesheet' } }, 'ts:ts-1:2026-01-12T03:04:05Z');
  assertEquals(create.ok, true);
  const binding = await checkTransitionTargetBinding(client, 'org-1', { domain: 'timesheets', operation: 'create', record: { id: 'ts-1', erp_doc_kind: 'timesheet' } });
  assertEquals(binding.ok, true);
});

Deno.test('BLOCK #4 still applies to timesheets: an already-mapped sheet may not be re-created (no duplicate week)', async () => {
  const res = await checkCreateTargetUnmapped(
    fakeClient({ mappedExternalId: 'TS-2026-00011', outboxKeys: [] }),
    'org-1',
    { domain: 'timesheets', operation: 'create', record: { id: 'ts-1', erp_doc_kind: 'timesheet' } },
    'ts:ts-1:2026-01-12T03:04:05Z',
  );
  assertEquals(res.ok, false);
  assertEquals(res.status, 422);
});

Deno.test('BLOCK #4 retry exemption still applies to timesheets: the SAME deterministic key finalizes', async () => {
  const key = 'ts:ts-1:2026-01-12T03:04:05Z';
  const res = await checkCreateTargetUnmapped(
    fakeClient({ mappedExternalId: 'TS-2026-00011', outboxKeys: [key] }),
    'org-1',
    { domain: 'timesheets', operation: 'create', record: { id: 'ts-1', erp_doc_kind: 'timesheet' } },
    key,
  );
  assertEquals(res.ok, true);
});

Deno.test('FR-TSP-041: the DETERMINISTIC Posture-B key is accepted as opaque; a short/loose key is still refused', () => {
  // ADR-0059 §4 pins `ts:<uuid>:<approved_at>` — two originators with no shared client state need a
  // DERIVED key or the outbox 4-tuple cannot de-duplicate them. It satisfies the same three properties
  // the UUID rule exists for: it embeds a full UUID (so it can never be a proper substring of another
  // document's anchor), it is fixed-shape, and it carries no LIKE metacharacter (`%`/`_`).
  assert(isOpaqueIdempotencyKey('ts:3f1b0c9e-1a2b-4c3d-8e4f-5a6b7c8d9e0f:2026-01-12T03:04:05.678Z'));
  assert(isOpaqueIdempotencyKey('ts:3f1b0c9e-1a2b-4c3d-8e4f-5a6b7c8d9e0f:2026-01-12T03:04:05+00:00'));
  assert(!isOpaqueIdempotencyKey('ts:1:2026-01-12T03:04:05Z'), 'a short id must not pass as opaque');
  assert(!isOpaqueIdempotencyKey('ts:3f1b0c9e-1a2b-4c3d-8e4f-5a6b7c8d9e0f:%'), 'a LIKE metacharacter must not pass');
  assert(!isOpaqueIdempotencyKey('ts:3f1b0c9e-1a2b-4c3d-8e4f-5a6b7c8d9e0f:2026-01-12T03:04:05Z_'), 'a LIKE metacharacter must not pass');
  assert(!isOpaqueIdempotencyKey('ts:3f1b0c9e-1a2b-4c3d-8e4f-5a6b7c8d9e0f'), 'the state stamp is not optional');
});
