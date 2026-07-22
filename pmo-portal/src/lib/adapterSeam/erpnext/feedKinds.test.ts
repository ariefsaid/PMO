/**
 * AC-SAR-060 — erpnext/feedKinds.ts: Payment Entry inbound disambiguation by payment_type.
 *   Receive → 'incoming-payment' / domain 'revenue' / table 'incoming_payments'
 *   Pay → 'payment' / domain 'procurement' / table 'payments'
 * Sales Invoice is a unique doctype → 'sales-invoice' (no disambiguation needed).
 */
import { describe, expect, it } from 'vitest';
import {
  kindFromDoctype,
  kindFromDoctypeAndPaymentType,
  KIND_DOMAIN,
  KIND_MIRROR_TABLE,
  externalIdForKind,
} from './feedKinds.ts';

describe('erpnext/feedKinds — Payment Entry disambiguation (AC-SAR-060)', () => {
  it('Payment Entry with payment_type=Receive → incoming-payment (revenue domain)', () => {
    const kind = kindFromDoctypeAndPaymentType('Payment Entry', 'Receive');
    expect(kind).toBe('incoming-payment');
    expect(KIND_DOMAIN[kind!]).toBe('revenue');
    expect(KIND_MIRROR_TABLE[kind!]).toBe('incoming_payments');
  });

  it('Payment Entry with payment_type=Pay → payment (procurement domain)', () => {
    const kind = kindFromDoctypeAndPaymentType('Payment Entry', 'Pay');
    expect(kind).toBe('payment');
    expect(KIND_DOMAIN[kind!]).toBe('procurement');
    expect(KIND_MIRROR_TABLE[kind!]).toBe('payments');
  });

  it('Payment Entry with unknown/absent payment_type → undefined (ack-and-skip, lossy hint)', () => {
    expect(kindFromDoctypeAndPaymentType('Payment Entry', 'Unknown')).toBeUndefined();
    expect(kindFromDoctypeAndPaymentType('Payment Entry', undefined)).toBeUndefined();
    expect(kindFromDoctypeAndPaymentType('Payment Entry', '')).toBeUndefined();
  });

  it('Sales Invoice is a unique doctype → sales-invoice (no disambiguation)', () => {
    const kind = kindFromDoctype('Sales Invoice');
    expect(kind).toBe('sales-invoice');
    expect(KIND_DOMAIN[kind!]).toBe('revenue');
    expect(KIND_MIRROR_TABLE[kind!]).toBe('sales_invoices');
  });

  it('kindFromDoctype still works for Payment Entry (returns one kind, but disambiguation requires payment_type)', () => {
    // kindFromDoctype alone cannot disambiguate - it returns the first match
    const kind = kindFromDoctype('Payment Entry');
    // The registry has 'payment' first, but the feed should use kindFromDoctypeAndPaymentType
    expect(['payment', 'incoming-payment']).toContain(kind);
  });

  it('AC-TSP-021 Timesheet routes to the timesheets domain + its side-mirror table (ADR-0059 Posture B)', () => {
    const kind = kindFromDoctype('Timesheet');
    expect(kind).toBe('timesheet');
    expect(KIND_DOMAIN[kind!]).toBe('timesheets');
    // Posture B: the side table holds ERP-side state ONLY — the PMO SoT tables (`timesheets`/
    // `timesheet_entries`) are NEVER a feed/mirror write target.
    expect(KIND_MIRROR_TABLE[kind!]).toBe('timesheet_erp_mirror');
  });

  it('AC-BUD-012 Budget routes to the budget domain + its side-mirror table (ADR-0059 Posture B)', () => {
    const kind = kindFromDoctype('Budget');
    expect(kind).toBe('budget');
    expect(KIND_DOMAIN[kind!]).toBe('budget');
    // ⛔ Posture B: the side table holds ERP-side state ONLY. `budget_versions`/`budget_line_items` are
    // PMO's SoT and are NEVER a feed/mirror write target (FR-BUD-006/140 — a Desk-created Budget must be
    // ack-and-skipped, never adopted, so there must be no PMO-table route for it to take).
    expect(KIND_MIRROR_TABLE[kind!]).toBe('budget_version_erp_mirror');
  });

  it('AC-BUD-012 no ERPNext kind mirrors into a PMO budget SoT table', () => {
    expect(Object.values(KIND_MIRROR_TABLE)).not.toContain('budget_versions');
    expect(Object.values(KIND_MIRROR_TABLE)).not.toContain('budget_line_items');
  });

  it('externalIdForKind encodes parties with prefix, uses raw name for revenue kinds', () => {
    expect(externalIdForKind('customer', 'CUST-001')).toBe('Customer:CUST-001');
    expect(externalIdForKind('supplier', 'SUPP-001')).toBe('Supplier:SUPP-001');
    expect(externalIdForKind('sales-invoice', 'SINV-001')).toBe('SINV-001');
    expect(externalIdForKind('incoming-payment', 'PE-REC-001')).toBe('PE-REC-001');
    expect(externalIdForKind('payment', 'PE-PAY-001')).toBe('PE-PAY-001');
    expect(externalIdForKind('timesheet', 'TS-2026-00011')).toBe('TS-2026-00011');
  });

  it('AC-TSP-090/094 Employee routes to the TIMESHEETS domain (NOT companies) + its own erp_employees mirror table', () => {
    const kind = kindFromDoctype('Employee');
    expect(kind).toBe('employee');
    // FR-TSP-094: `companies` is already flipped for existing orgs — an Employee doctype must NEVER
    // ride that sweep/feed, or it changes behavior for orgs that never asked for it. The Employee
    // master lives in the `timesheets` domain the OWNER RULING created for it (AC-TSP-003's proof).
    expect(KIND_DOMAIN[kind!]).toBe('timesheets');
    expect(KIND_DOMAIN[kind!]).not.toBe('companies');
    expect(KIND_MIRROR_TABLE[kind!]).toBe('erp_employees');
  });

  it('externalIdForKind encodes Employee with the SAME Supplier:/Customer: prefix convention (FR-TSP-091)', () => {
    expect(externalIdForKind('employee', 'HR-EMP-00001')).toBe('Employee:HR-EMP-00001');
  });
});