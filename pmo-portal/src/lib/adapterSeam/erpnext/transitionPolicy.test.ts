/**
 * AC-ENA-023 — erpnext/transitionPolicy.ts: a PMO edit to a submitted doc routes to cancel+amend
 * (never a `PUT` that would yield `UpdateAfterSubmitError`, R2). A multi-doc cancel is the CALLER's
 * chain concern (reverse-dependency order — downstream doc first, R9 §5); the adapter ships the
 * single-doc cancel primitive (erpnext/adapter.ts `cancelDoc`).
 * AC-SAR-022 — SI cancel auto-unlink reconcile (AR delta from procurement): ERPNext returns 200 on SI
 * cancel even when a PE-receive references it; it auto-unlinks the PE-receive's `references`. The
 * read-model helper `reconcileSiCancelAutoUnlink` returns the PE-receive patch (`sales_invoice_id`→null)
 * AC-SAR-022 — SI cancel auto-unlink reconcile (AR delta from procurement): ERPNext returns 200 on SI
 * cancel even when a PE-receive references it; it auto-unlinks the PE-receive's `references`. The
 * read-model helper `reconcileSiCancelAutoUnlink` returns the PE-receive patch (`sales_invoice_id`→null)
 * and SI tombstone.
 */
import { describe, expect, it } from 'vitest';
import { AdapterError } from '../contract.ts';
import { reconcileSiCancelAutoUnlink, routeEdit } from './transitionPolicy.ts';

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

describe('erpnext/transitionPolicy — reconcileSiCancelAutoUnlink (AC-SAR-022)', () => {
  it('SI cancel with linked PE-receive: returns PE patch (sales_invoice_id→null) + SI tombstone', () => {
    const result = reconcileSiCancelAutoUnlink('pe-pmo-1', '2026-07-11 12:00:00.000000');
    expect(result.peReceivePatch).toEqual({ sales_invoice_id: null });
    expect(result.siTombstone).toEqual({
      erp_cancelled_at: expect.any(String),
      erp_docstatus: 2,
      erp_modified: '2026-07-11 12:00:00.000000',
    });
  });

  it('SI cancel with NO linked PE-receive: returns only SI tombstone, PE patch is null', () => {
    const result = reconcileSiCancelAutoUnlink(null, '2026-07-11 12:00:00.000000');
    expect(result.peReceivePatch).toBeNull();
    expect(result.siTombstone).toEqual({
      erp_cancelled_at: expect.any(String),
      erp_docstatus: 2,
      erp_modified: '2026-07-11 12:00:00.000000',
    });
  });

});