import { describe, it, expect } from 'vitest';
import { DATABASE_LISTED_KINDS, WAITING_KINDS, WAITING_KIND_META, isDatabaseListedKind, scopeLabelText, waitingHeadingText } from './waitingKinds';
import { approvalItem } from '@/src/components/dashboard/hub/company/approvalItem';
import type { ApprovalPopulationEntry } from '@/src/lib/selectors/approvals';

/** Every record a login can decide, enumerated from the release (fix-waiting item 1). A new kind must be added HERE, to the registry and to its read. */
const EXPECTED = [
  'procurement', 'timesheets', 'expense', 'invoice', 'material', 'leave', 'imprest',
  'daily_report', 'work_order_issue', 'delivery_record', 'work_order_acceptance', 'transfer_receipt', 'quantity_change',
  'certificate', 'equipment_plan', 'check_in', 'medical_release',
];

/** The translation stub these assertions read through: the English default with its `{{placeholders}}` filled. */
const t = (_key: string, fallback: string, options?: Record<string, unknown>) =>
  fallback.replace(/{{(\w+)}}/g, (_m, name) => String(options?.[name] ?? ''));

describe('the registry of everything a login can decide', () => {
  it('AC-WAIT-040 lists exactly the enumerated kinds, so a kind added without a registry entry fails here', () => {
    expect([...WAITING_KINDS].sort()).toEqual([...EXPECTED].sort());
  });

  it('AC-WAIT-041 every kind has an inbox label and every database-listed kind opens its record', () => {
    for (const kind of WAITING_KINDS) {
      expect(WAITING_KIND_META[kind].scopeLabel.length).toBeGreaterThan(0);
      expect(WAITING_KIND_META[kind].scopeKey.length).toBeGreaterThan(0);
    }
    for (const kind of DATABASE_LISTED_KINDS) {
      expect(isDatabaseListedKind(kind)).toBe(true);
      expect(WAITING_KIND_META[kind].href?.('rec-1')).toMatch(/^\//);
    }
  });

  it('AC-WAIT-042 the home list can draw a row for every kind: no kind falls through to the wrong row', () => {
    const rows: Record<string, unknown> = {
      procurement: { id: 'p1', title: 'Pump', requested_by: { full_name: 'Ani' }, total_value: 1, currency: 'IDR' },
      timesheets: { id: 't1', owner: { full_name: 'Budi' }, week_start_date: '2026-11-16' },
      expense: { claim: { id: 'e1', title: 'Taxi', claimant: { full_name: 'Citra' }, amount: 1, currency: 'IDR' } },
      invoice: { id: 'i1', pmo_number: 'INV-1', customer_name: 'Acme', currency: 'IDR' },
      material: { requestId: 'm1', stepPosition: 1, label: 'Site lead' },
      leave: { id: 'l1', person_name: 'Dewi', start_date: '2026-11-20', end_date: '2026-11-21' },
      imprest: { id: 'r1', float_id: 'f1', number: 'REP-1' },
      medical_release: { id: 'mr1', person_name: 'Ana', release_date: '2026-11-20', status: 'Pending', can_decide: true },
      work_order_acceptance: { id: 'acc-1', work_order_id: 'wo-7', acceptance_date: '2026-11-20', is_final: true, prepared_at: '2026-11-20T00:00:00Z' },
    };
    for (const kind of WAITING_KINDS) {
      const row = isDatabaseListedKind(kind) ? { kind, recordId: 'rec-1', projectId: null, title: 'Row title', createdAt: '2026-11-20T00:00:00Z' } : rows[kind];
      const entry = { key: `${kind}:x`, kind, createdAt: '2026-11-20T00:00:00Z', row } as ApprovalPopulationEntry;
      const item = approvalItem(entry, t, new Date('2026-11-22T00:00:00Z').getTime());
      expect(item.what, kind).toBeTruthy();
      expect(item.href, kind).toMatch(/^\//);
    }
  });

  it('F5-3 an outside-area clock-in waiting for a supervisor is a listed decision that opens Crews', () => {
    expect(isDatabaseListedKind('check_in')).toBe(true);
    expect(WAITING_KIND_META.check_in.href?.('rec-1')).toBe('/crews');
    expect(scopeLabelText('check_in', t)).toBe('Clock-ins to decide');
    expect(waitingHeadingText('check_in', 2, t)).toBe('Clock-ins to decide (2)');
  });

  it('AC-WAIT-056 client acceptance (BAST) is its own kind, not the purchase-delivery kind, and opens its exact work order', () => {
    // The purchase-receipt kind stays what it was: a BAST is never counted or linked as a `delivery_record`.
    expect(WAITING_KIND_META.work_order_acceptance.scopeLabel).not.toBe(WAITING_KIND_META.delivery_record.scopeLabel);
    expect(isDatabaseListedKind('work_order_acceptance')).toBe(false);
    const entry = {
      key: 'work_order_acceptance:acc-9', kind: 'work_order_acceptance', createdAt: '2026-11-20T00:00:00Z',
      row: { id: 'acc-9', work_order_id: 'wo-9', acceptance_date: '2026-11-20', is_final: false, prepared_at: '2026-11-20T00:00:00Z' },
    } as ApprovalPopulationEntry;
    const item = approvalItem(entry, t, new Date('2026-11-22T00:00:00Z').getTime());
    expect(item.href).toBe('/work-orders/wo-9');
    expect(item.href).not.toContain('acc-9');
    expect(item.what).toMatch(/Client acceptance/);
  });
});
