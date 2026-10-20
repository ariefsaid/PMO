import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { AccountingSnapshotsSection } from './AccountingSnapshotsSection';
import type { ErpActualsSnapshotRow, ErpAgingSnapshotRow } from '@/src/lib/db/erpSnapshots';

vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));

// Record every mounted DataTable's saved-width identity beside its column-key shape. The real
// table still renders, so this observes production wiring rather than a stand-in.
const seen = vi.hoisted(() => [] as { tableId: string | undefined; shape: string }[]);
vi.mock('@/src/components/ui/DataTable', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/components/ui/DataTable')>();
  return {
    ...actual,
    DataTable: (props: React.ComponentProps<typeof actual.DataTable>) => {
      seen.push({ tableId: props.tableId, shape: props.columns.map((column) => column.key).join('|') });
      return <actual.DataTable {...props} />;
    },
  };
});

const actuals: ErpActualsSnapshotRow[] = [{
  projectId: null, costCenter: 'Ops', account: 'COGS', fiscalYear: '2026', debit: 2, credit: 1, net: 1,
  asOf: '2026-07-13T08:00:00Z', sourceReport: 'GL Entry', snapshotId: 'snap-1',
}];
const aging = (snapshotId: string, partyType: string): ErpAgingSnapshotRow[] => [{
  party: 'Party', partyType, currency: 'USD', totalOutstanding: 5, current: 5, bucket0to30: 0,
  bucket31to60: 0, bucket61to90: 0, bucketOver90: 0, rangeLabels: null, reportDate: '2026-07-12',
  ageingBasedOn: 'Due Date', asOf: '2026-07-13T08:00:00Z', sourceReport: 'Aging', reportVersion: '15', snapshotId,
}];

describe('AccountingSnapshotsSection saved-width identities', () => {
  it('AC-TBL-RESIZE-002: differently shaped tables never share a tableId at runtime', () => {
    seen.length = 0;
    render(
      <AccountingSnapshotsSection
        actuals={actuals} actualsPending={false} actualsError={false}
        apAging={aging('snap-2', 'Supplier')} apAgingPending={false} apAgingError={false}
        arAging={aging('snap-3', 'Customer')} arAgingPending={false} arAgingError={false}
      />,
    );
    expect(seen.length).toBeGreaterThanOrEqual(3);
    const shapesById = new Map<string, Set<string>>();
    for (const { tableId, shape } of seen) {
      expect(tableId, 'every snapshot table needs a tableId').toBeTruthy();
      shapesById.set(tableId!, (shapesById.get(tableId!) ?? new Set()).add(shape));
    }
    for (const [tableId, shapes] of shapesById) {
      expect(shapes.size, `tableId ${tableId} is shared by differently shaped tables`).toBe(1);
    }
    expect(shapesById.size).toBe(2); // actuals vs aging (AP and AR share one shape)
  });
});
