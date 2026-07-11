/**
 * AC-ENA-023 — erpnext/transitionPolicy.ts: a PMO edit to a submitted doc routes to cancel+amend
 * (never a `PUT` that would yield `UpdateAfterSubmitError`, R2); a chain cancel orders the DOWNSTREAM
 * doc first (PR[eceipt]-then-PO, PE-then-PI — R9 §5 "Cancel the chain in reverse"), surfacing any
 * blocking `LinkExistsError` uncaught rather than swallowing/faking it. `cancelChain` is pure ERP
 * orchestration with NO mirror dependency at all, so a blocked cancel structurally cannot mutate the
 * PMO mirror — the throw propagates before any caller-side mirror write is ever reached.
 */
import { describe, expect, it, vi } from 'vitest';
import { AdapterError } from '../contract.ts';
import { ErpError } from './client.ts';
import { cancelChain, routeEdit } from './transitionPolicy.ts';

describe('erpnext/transitionPolicy — routeEdit', () => {
  it('AC-ENA-023 routes a draft (docstatus 0) edit to update (a direct PUT is safe)', () => {
    expect(routeEdit(0)).toBe('update');
  });

  it('AC-ENA-023 routes a submitted (docstatus 1) edit to amend — never a PUT that would UpdateAfterSubmitError', () => {
    expect(routeEdit(1)).toBe('amend');
  });

  it('rejects an edit attempt on an already-cancelled (docstatus 2) document', () => {
    let caught: AdapterError | undefined;
    try {
      routeEdit(2);
    } catch (err) {
      caught = err as AdapterError;
    }
    expect(caught).toBeInstanceOf(AdapterError);
    expect(caught?.code).toBe('commit-rejected');
  });
});

describe('erpnext/transitionPolicy — cancelChain (reverse-dependency-order, R9 §5)', () => {
  it('cancels a Purchase Receipt before its Purchase Order (PR-then-PO)', async () => {
    const calls: string[] = [];
    const cancelDoc = vi.fn(async (doctype: string, name: string) => {
      calls.push(`${doctype}:${name}`);
    });
    await cancelChain([{ doctype: 'Purchase Receipt', name: 'MAT-PRE-2026-00001' }, { doctype: 'Purchase Order', name: 'PUR-ORD-2026-00001' }], { cancelDoc });
    expect(calls).toEqual(['Purchase Receipt:MAT-PRE-2026-00001', 'Purchase Order:PUR-ORD-2026-00001']);
  });

  it('cancels a Payment Entry before its Purchase Invoice (PE-then-PI)', async () => {
    const calls: string[] = [];
    const cancelDoc = vi.fn(async (doctype: string, name: string) => {
      calls.push(`${doctype}:${name}`);
    });
    await cancelChain([{ doctype: 'Payment Entry', name: 'ACC-PAY-2026-00001' }, { doctype: 'Purchase Invoice', name: 'ACC-PINV-2026-00002' }], { cancelDoc });
    expect(calls).toEqual(['Payment Entry:ACC-PAY-2026-00001', 'Purchase Invoice:ACC-PINV-2026-00002']);
  });

  it('a blocking LinkExistsError propagates UNCAUGHT and stops the chain (never swallowed/faked as success)', async () => {
    const cancelDoc = vi.fn(async (doctype: string) => {
      if (doctype === 'Purchase Order') {
        throw new ErpError(417, 'commit-rejected', 'LinkExistsError: blocked by MAT-PRE-2026-00001', true);
      }
    });
    await expect(
      cancelChain([{ doctype: 'Purchase Order', name: 'PUR-ORD-2026-00001' }, { doctype: 'Purchase Receipt', name: 'MAT-PRE-2026-00001' }], { cancelDoc }),
    ).rejects.toThrow(/LinkExistsError/);
    // the chain stops at the failing step — no further cancel attempted, no mirror ever reached.
    expect(cancelDoc).toHaveBeenCalledTimes(1);
  });
});
