// BLOCK 1 [Deno unit] — the doctype poll must NEVER pull-adopt a doc that a PMO-originated, still
// unresolved outbox command is responsible for.
//
// The hazard (deterministic, not a rare race): the quarantine window (300 s, migration 0096) is >= the
// sweep interval (300 s, migration 0102), so a poll ALWAYS lands inside the window of a lost-response
// commit. The doctype poll saw the committed doc, `findPmoRecordId` returned null (the outbox had not
// finalized its `external_refs` yet) and it PULL-ADOPTED: a SECOND PMO row for the ONE ERP document
// (revenue double-counted), while the outbox's own recovery later tried to map the same ERP name to the
// ORIGINAL pmo id — which the `unique (org_id, domain, external_record_id)` constraint (0093) then
// rejects with 23505, wedging that money row at `committed` forever.
//
// The guard: before adopting, the poll refuses any doc whose ANCHOR field carries an idempotency key
// belonging to an UNRESOLVED outbox row of this org. Those docs are the outbox's to finalize (exactly
// one PMO row, ADR-0058 §4) — the poll re-surfaces them on a later tick if needed.
//
// ── ROUND-7 CROSS-FAMILY AUDIT, FINDING B5: the guard was not a BARRIER. ────────────────────────────
// The round-6 shape read the org's in-flight keys into a `Set` once per tick. Two independent defects:
//
//   (a) THE SATURATION CHECK COULD NOT FIRE. It asked for `limit(CAP+1)` = 1001 rows to detect a
//       truncated read — but `supabase/config.toml` sets PostgREST `max_rows = 1000`, so the 1001st row
//       is never returned. Saturation was undetectable and the guard silently truncated exactly as
//       before: past 1000 unresolved rows an arbitrary subset came back and a live key could be absent.
//
//   (b) THE KEY SET WAS STALE. It was read up front and reused for the LATER ERP poll. A user starting
//       a create after that read — whose ERP document appears before the poll — was not in the set, so
//       the poll adopted a PMO-originated document into a second PMO row (BLOCK 1 re-opening as a race).
//
// The fix removes both classes by removing the snapshot: the guard asks the outbox PER CANDIDATE, at
// the moment the document is seen, whether any unresolved row owns a key stamped in its anchor. The
// query is an EXISTENCE check keyed on the handful of UUIDs present in that one anchor value, so no cap
// can truncate it and no read can be stale.
//
// Verify: cd supabase/functions/erpnext-sweep && deno test inFlightAdoptGuard.test.ts

// Stub Deno.serve so importing index.ts (top-level Deno.serve) does not bind a port under deno test.
(Deno as unknown as { serve: (...a: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const { sweepFieldsForKind, inFlightAnchorFilter, createInFlightAnchorProbe } = await import('./index.ts');
import { DOCTYPE_REGISTRY } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/doctypeRegistry.ts';
import type { SupabaseClient } from '@supabase/supabase-js';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const ORG = '00000000-0000-4000-8000-0000000000aa';
const KEY = '5f7d2b1e-0c3a-4a9e-9f10-2b6c8d4e1a77';
const OTHER_KEY = '9a1c4e77-3b52-4d18-8f6b-71c0d2e5a334';
const uuidAt = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;

interface OutboxTestRow {
  org_id: string;
  state: string;
  idempotency_key: string;
}

/**
 * A fake `external_command_outbox` that really applies the DAL's filters AND really enforces
 * PostgREST's `max_rows = 1000` ceiling on every read — the exact server behavior that made the old
 * saturation check unfireable. The rows array is MUTABLE so a test can insert one mid-tick.
 */
function fakeOutbox(rows: OutboxTestRow[], error: { code?: string; message: string } | null = null) {
  const POSTGREST_MAX_ROWS = 1000;
  let reads = 0;
  const client = {
    from: () => {
      let filtered = rows;
      let cap = POSTGREST_MAX_ROWS;
      const result = () => {
        reads += 1;
        return {
          data: error
            ? null
            : filtered.slice(0, Math.min(cap, POSTGREST_MAX_ROWS)).map((r) => ({ idempotency_key: r.idempotency_key })),
          error,
        };
      };
      const builder = {
        eq: (column: string, value: string) => {
          filtered = filtered.filter((r) => (r as unknown as Record<string, string>)[column] === value);
          return builder;
        },
        in: (column: string, values: readonly string[]) => {
          filtered = filtered.filter((r) => values.includes((r as unknown as Record<string, string>)[column]));
          return builder;
        },
        limit: (n: number) => {
          cap = n;
          return Promise.resolve(result());
        },
        then: (resolve: (v: unknown) => void) => resolve(result()),
      };
      return { select: () => builder };
    },
  } as unknown as SupabaseClient;
  return { client, rows, readCount: () => reads };
}

/** The anchor value a PMO-originated document carries: the key APPENDED into the stock field. */
const anchorFor = (key: string) => `Invoice for ACME — ${key}`;

Deno.test("BLOCK 1: the poll fetches the kind's recovery ANCHOR field (without it the guard is blind)", () => {
  // Sales Invoice anchors on `remarks`; the Payment Entry kinds on `reference_no`.
  assert(sweepFieldsForKind('sales-invoice').includes('remarks'), 'sales-invoice poll must fetch remarks');
  assert(sweepFieldsForKind('purchase-invoice').includes('remarks'), 'purchase-invoice poll must fetch remarks');
  assert(sweepFieldsForKind('incoming-payment').includes('reference_no'), 'incoming-payment poll must fetch reference_no');
  assert(sweepFieldsForKind('payment').includes('reference_no'), 'payment poll must fetch reference_no');
  // An anchor-less kind adds nothing (no phantom field in the list query — Frappe rejects unknown fields).
  assert(DOCTYPE_REGISTRY.rfq.anchorField === null, 'precondition: rfq has no anchor');
  assert(sweepFieldsForKind('rfq').length === new Set(sweepFieldsForKind('rfq')).size, 'no duplicate fields');
});

// ── The probe: the outbox existence check the guard is now built on. ─────────────────────────────

Deno.test('B5(b): a document whose outbox row is created AFTER the guard is built is STILL guarded (no stale snapshot)', async () => {
  const outbox = fakeOutbox([]);
  // The guard is built at the top of the org's tick — the outbox is empty at that instant.
  const probe = createInFlightAnchorProbe(outbox.client, ORG);

  // …then a user starts a create. The outbox row is inserted BEFORE the ERP POST (ADR-0058 §2), so by
  // the time the ERP document is visible to the poll the row exists — and the guard must see it.
  outbox.rows.push({ org_id: ORG, state: 'pending', idempotency_key: KEY });

  assert(
    await probe(anchorFor(KEY)),
    'the guard must read the outbox as it stands when the DOCUMENT is seen — a snapshot taken before the '
      + 'poll lets the sweep pull-adopt a PMO-originated document into a SECOND PMO row',
  );
});

Deno.test('B5(a): a live key is found even when the org has FAR more unresolved rows than PostgREST returns (max_rows=1000)', async () => {
  const rows: OutboxTestRow[] = Array.from({ length: 5000 }, (_, i) => ({
    org_id: ORG,
    state: 'committing',
    idempotency_key: uuidAt(i),
  }));
  // The live one sits at index 4000 — unreachable through any single capped, unordered read.
  const buried = rows[4000].idempotency_key;
  const outbox = fakeOutbox(rows);
  const probe = createInFlightAnchorProbe(outbox.client, ORG);

  assert(
    await probe(anchorFor(buried)),
    'the guard must not depend on how many unresolved rows the org has — an existence check keyed on the '
      + "document's own anchor key cannot be truncated by max_rows",
  );
});

Deno.test('every state that can carry an UNRESOLVED ERP document is guarded', async () => {
  for (const state of ['pending', 'committing', 'committed', 'quarantined', 'held']) {
    const outbox = fakeOutbox([{ org_id: ORG, state, idempotency_key: KEY }]);
    const probe = createInFlightAnchorProbe(outbox.client, ORG);
    assert(await probe(anchorFor(KEY)), `a '${state}' row's document may exist and be unmapped — it must be guarded`);
  }
});

Deno.test('a CONFIRMED row is not guarded (its external_refs mapping exists — the poll must keep applying its updates)', async () => {
  const outbox = fakeOutbox([{ org_id: ORG, state: 'confirmed', idempotency_key: KEY }]);
  const probe = createInFlightAnchorProbe(outbox.client, ORG);
  assert(!(await probe(anchorFor(KEY))), 'a confirmed row is resolved, not adopted');
});

Deno.test("another org's in-flight rows never guard this org's poll (org scoping preserved)", async () => {
  const outbox = fakeOutbox([{ org_id: 'other-org', state: 'committing', idempotency_key: KEY }]);
  const probe = createInFlightAnchorProbe(outbox.client, ORG);
  assert(!(await probe(anchorFor(KEY))), 'the guard stays org-scoped');
});

Deno.test('a NATIVE document (no stamped key in its anchor) is adoptable — and costs no outbox read', async () => {
  const outbox = fakeOutbox([{ org_id: ORG, state: 'committing', idempotency_key: KEY }]);
  const probe = createInFlightAnchorProbe(outbox.client, ORG);

  assert(!(await probe('Payment for July — cash on delivery')), 'a native ERP document must still be adopted');
  assert(outbox.readCount() === 0, 'an anchor carrying no key needs no query at all (the poll pays nothing for native docs)');
});

Deno.test('a READ ERROR fails CLOSED (throws — sweeping with a blind guard is what duplicated money rows)', async () => {
  const outbox = fakeOutbox([], { code: '08006', message: 'connection failure' });
  const probe = createInFlightAnchorProbe(outbox.client, ORG);
  let threw = false;
  try {
    await probe(anchorFor(KEY));
  } catch {
    threw = true;
  }
  assert(threw, 'a failed guard read must abort the poll, never allow the adopt');
});

Deno.test('the same key is asked ONCE per tick (the per-candidate check does not become an N+1 per page)', async () => {
  const outbox = fakeOutbox([{ org_id: ORG, state: 'committing', idempotency_key: KEY }]);
  const probe = createInFlightAnchorProbe(outbox.client, ORG);

  await probe(anchorFor(KEY));
  await probe(anchorFor(KEY));
  await probe(anchorFor(KEY));

  assert(outbox.readCount() === 1, 'a repeated key is answered from the tick-local memo');
});

// ── inFlightAnchorFilter: the predicate the poll actually receives. ──────────────────────────────

Deno.test('BLOCK 1: a doc stamped with an in-flight outbox key is NOT adopted by the poll', async () => {
  const outbox = fakeOutbox([{ org_id: ORG, state: 'committing', idempotency_key: KEY }]);
  const filter = inFlightAnchorFilter('sales-invoice', createInFlightAnchorProbe(outbox.client, ORG));
  assert(filter !== undefined, 'a kind with an anchor field must produce a filter');
  assert(
    (await filter!({ name: 'ACC-SINV-2026-00001', remarks: KEY })) === false,
    'a doc carrying an in-flight idempotency key must be skipped (the outbox owns it)',
  );
});

Deno.test('BLOCK 1: an unrelated / native ERP doc is still adopted', async () => {
  const outbox = fakeOutbox([{ org_id: ORG, state: 'committing', idempotency_key: KEY }]);
  const filter = inFlightAnchorFilter('sales-invoice', createInFlightAnchorProbe(outbox.client, ORG));
  assert((await filter!({ name: 'ACC-SINV-2026-00002', remarks: 'Invoice for June services' })) === true, 'a native doc must still be adopted');
  assert((await filter!({ name: 'ACC-SINV-2026-00003', remarks: null })) === true, 'an empty anchor must still be adopted');
  assert(
    (await filter!({ name: 'ACC-SINV-2026-00004', remarks: OTHER_KEY })) === true,
    'a CONFIRMED (or foreign) key has no unresolved row — its doc is already mapped, adopt normally',
  );
});

Deno.test('BLOCK 1: the key is matched inside a longer anchor value (the stamp is appended, ADR-0058 §3)', async () => {
  const outbox = fakeOutbox([{ org_id: ORG, state: 'committing', idempotency_key: KEY }]);
  const filter = inFlightAnchorFilter('incoming-payment', createInFlightAnchorProbe(outbox.client, ORG));
  assert((await filter!({ name: 'ACC-PE-2026-1', reference_no: `PMO ${KEY}` })) === false, 'a key embedded in the anchor value must still match');
});

Deno.test('BLOCK 1: an anchor-less kind cannot be guarded (nothing to read) — it keeps the base filter verbatim', () => {
  const outbox = fakeOutbox([]);
  assert(inFlightAnchorFilter('rfq', createInFlightAnchorProbe(outbox.client, ORG)) === undefined, 'no anchor, no base filter ⇒ no filter at all');
});

Deno.test('BLOCK 1: the guard composes with the payment_type discriminator (BLOCK A1 must survive)', async () => {
  const outbox = fakeOutbox([{ org_id: ORG, state: 'committing', idempotency_key: KEY }]);
  const filter = inFlightAnchorFilter(
    'incoming-payment',
    createInFlightAnchorProbe(outbox.client, ORG),
    (row) => row.payment_type === 'Receive',
  );
  // Both conditions must hold for a row to be emitted.
  assert((await filter!({ payment_type: 'Receive', reference_no: 'native-ref' })) === true, 'a native Receive PE is adopted');
  assert((await filter!({ payment_type: 'Pay', reference_no: 'native-ref' })) === false, 'a Pay PE is still excluded from the Receive poll');
  assert((await filter!({ payment_type: 'Receive', reference_no: KEY })) === false, 'an in-flight Receive PE is excluded');
});
