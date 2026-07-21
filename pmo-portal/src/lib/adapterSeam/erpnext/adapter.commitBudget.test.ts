/**
 * Luna round-5 BLOCK 10 — the claim budget must bound the ACTUAL non-idempotent POST, not just the
 * entry into `adapter.commit`.
 *
 * `dispatch.ts` checked `MONEY_COMMIT_CLAIM_BUDGET_MS` ONCE, immediately before `adapter.commit`. But
 * an amend is `cancelDoc` (PUT) THEN `createDoc` (POST) — the non-idempotent create is the THIRD ERP
 * call. A slow cancel (retried up to `maxRetries`, each bounded by the 120 s per-attempt deadline, each
 * possibly honoring a `Retry-After` sleep) can push that POST past `reconcile_after`, after a
 * reconciler has already reissued ⇒ DUPLICATE ERP money documents.
 *
 * The fix threads an ABSOLUTE deadline (`AdapterCommand.commitDeadlineAtMs`, armed by dispatch at claim
 * time) down to the ERPNext client, which refuses any POST issued at/after it. The guarantee therefore
 * lives at the ONE chokepoint every non-idempotent create passes through (`erpnextRequest`), so a
 * future doctype or verb cannot forget it — see `adapter.ts`'s `budgetedDeps`.
 *
 * A fake clock drives real elapsed time (never a static relationship between two constants).
 */
import { describe, expect, it, vi } from 'vitest';
import { createErpAdapter, type ErpAdapterDeps } from './adapter.ts';
import { MONEY_COMMIT_CLAIM_BUDGET_MS } from '../dispatch.ts';
import type { AdapterCommand } from '../contract.ts';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const CLAIM_AT = 1_000_000;
const DEADLINE = CLAIM_AT + MONEY_COMMIT_CLAIM_BUDGET_MS;

/** An adapter over a fake bench + a fake clock. `cancelCostMs` is how much wall-clock the cancel PUT
 *  burns (the slow-cancel scenario: retries + honored Retry-After sleeps inside `erpnextRequest`). */
function amendHarness(cancelCostMs: number) {
  const clock = { ms: CLAIM_AT };
  const calls: Array<{ method: string; url: string }> = [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ method, url: String(url) });
    if (method === 'PUT') {
      // the cancel (docstatus:2) — the call that burns the budget before the create POST
      clock.ms += cancelCostMs;
      return jsonResponse(200, { data: { name: 'PINV-OLD', docstatus: 2 } });
    }
    if (method === 'POST') return jsonResponse(200, { data: { name: 'PINV-NEW', docstatus: 0 } });
    return jsonResponse(200, { data: { name: 'PINV-NEW', docstatus: 1 } });
  }) as unknown as typeof fetch;

  const deps: ErpAdapterDeps = {
    client: { fetchImpl, apiKey: 'k', apiSecret: 's', baseUrl: 'https://erp.example.com', now: () => clock.ms },
    doctypeBodies: {
      'sales-invoice': { toBody: () => ({ customer: 'ACME' }), fromDoc: (doc) => ({ id: 'x', name: (doc as { name: string }).name }) },
      payment: { toBody: () => ({ paid_amount: 100 }), fromDoc: (doc) => ({ id: 'x', name: (doc as { name: string }).name }) },
    },
    ctx: { refs: {}, config: { company: 'PMO Co' } },
  };
  return { adapter: createErpAdapter(deps), calls, clock };
}

function amendCommand(kind: string, commitDeadlineAtMs?: number): AdapterCommand {
  return {
    domain: kind === 'payment' ? 'procurement' : 'revenue',
    operation: 'transition',
    record: { id: 'pmo-1', erp_doc_kind: kind, externalRecordId: 'PINV-OLD', verb: 'amend' },
    idempotencyKey: 'key-amend-1',
    commitDeadlineAtMs,
  };
}

describe('Luna BLOCK 10 — the claim budget bounds the amend POST, not just the commit entry', () => {
  it('an amend whose CANCEL burns the whole budget REFUSES the create POST (no duplicate money document)', async () => {
    const h = amendHarness(MONEY_COMMIT_CLAIM_BUDGET_MS + 1);

    await expect(h.adapter.commit(amendCommand('sales-invoice', DEADLINE))).rejects.toMatchObject({
      // retryable transport classification — dispatch leaves the row `committing`; the reconciler owns it
      code: 'external-unreachable',
    });

    // THE critical assertion: the non-idempotent create never reached ERP.
    expect(h.calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    expect(h.calls.map((c) => c.method)).toEqual(['PUT']);
  });

  it('the refusal is RETRYABLE (external-unreachable), never a terminal commit-rejected', async () => {
    const h = amendHarness(MONEY_COMMIT_CLAIM_BUDGET_MS + 1);
    const error = await h.adapter.commit(amendCommand('sales-invoice', DEADLINE)).catch((e: unknown) => e);
    expect((error as { code: string }).code).toBe('external-unreachable');
    expect((error as { retryable?: boolean }).retryable).toBe(true);
  });

  it('a normal amend (cancel well inside the budget) still completes: cancel PUT → create POST', async () => {
    const h = amendHarness(1_500);
    const result = await h.adapter.commit(amendCommand('sales-invoice', DEADLINE));
    expect(h.calls.map((c) => c.method)).toEqual(['PUT', 'POST']);
    expect(result.externalRecordId).toBe('PINV-NEW');
  });

  it('the boundary is exact: 1 ms inside the deadline POSTs, exactly AT the deadline does not', async () => {
    const inside = amendHarness(MONEY_COMMIT_CLAIM_BUDGET_MS - 1);
    await inside.adapter.commit(amendCommand('sales-invoice', DEADLINE));
    expect(inside.calls.filter((c) => c.method === 'POST')).toHaveLength(1);

    const atDeadline = amendHarness(MONEY_COMMIT_CLAIM_BUDGET_MS);
    await expect(atDeadline.adapter.commit(amendCommand('sales-invoice', DEADLINE))).rejects.toMatchObject({ code: 'external-unreachable' });
    expect(atDeadline.calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  it('C-1 (mutable-anchor Payment Entry) is preserved exactly: an over-budget PE amend POSTs NOTHING', async () => {
    // ADR-0058 C-1: a PE whose recovery is inconclusive is HELD, never reissued. That guarantee rests on
    // the original claimant NOT minting a document outside its window — this is that half of it.
    const h = amendHarness(MONEY_COMMIT_CLAIM_BUDGET_MS + 5_000);
    await expect(h.adapter.commit(amendCommand('payment', DEADLINE))).rejects.toMatchObject({ code: 'external-unreachable' });
    expect(h.calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  it('a command with NO deadline (P0/P1 and every non-money path) is unbounded — byte-for-byte', async () => {
    const h = amendHarness(10 * MONEY_COMMIT_CLAIM_BUDGET_MS);
    const result = await h.adapter.commit(amendCommand('sales-invoice', undefined));
    expect(h.calls.map((c) => c.method)).toEqual(['PUT', 'POST']);
    expect(result.externalRecordId).toBe('PINV-NEW');
  });

  it('an IDEMPOTENT call past the deadline is still allowed (only the POST is refused)', async () => {
    // A create+submit whose submit PUT lands past the deadline must NOT be refused: re-issuing a submit
    // is safe, and refusing it would strand a committed document unsubmitted.
    const clock = { ms: CLAIM_AT };
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push(method);
      if (method === 'POST') {
        clock.ms += MONEY_COMMIT_CLAIM_BUDGET_MS + 1; // the create itself was slow
        return jsonResponse(200, { data: { name: 'PINV-NEW', docstatus: 0 } });
      }
      return jsonResponse(200, { data: { name: 'PINV-NEW', docstatus: 1 } });
    }) as unknown as typeof fetch;
    const adapter = createErpAdapter({
      client: { fetchImpl, apiKey: 'k', apiSecret: 's', baseUrl: 'https://erp.example.com', now: () => clock.ms },
      doctypeBodies: { payment: { toBody: () => ({}), fromDoc: (doc) => ({ id: 'x', name: (doc as { name: string }).name }) } },
      ctx: { refs: {}, config: { company: 'PMO Co' } },
    });
    const result = await adapter.commit({
      domain: 'procurement',
      operation: 'create',
      record: { id: 'pmo-2', erp_doc_kind: 'payment' },
      idempotencyKey: 'key-create-1',
      commitDeadlineAtMs: DEADLINE,
    });
    expect(calls).toEqual(['POST', 'PUT', 'GET']); // create → submit → re-fetch, all completed
    expect(result.externalRecordId).toBe('PINV-NEW');
  });
});
