import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AccountingSnapshotsSection } from './AccountingSnapshotsSection';
import type { ErpActualsSnapshotRow, ErpAgingSnapshotRow } from '@/src/lib/db/erpSnapshots';

/**
 * task FIX-2 (Discover CRITICAL 2) — the actuals/AP-AR aging read surface mounted on the Finance
 * dashboard. Read-only: renders ERP figures as-is (ADR-0048 ledger-sourced-display), never
 * recomputes. Empty state is the default (unflipped org — no snapshot has ever been refreshed).
 */

const actualsRows: ErpActualsSnapshotRow[] = [
  {
    projectId: null,
    costCenter: 'Ops',
    account: 'Cost of Goods Sold',
    fiscalYear: '2026',
    debit: 12000,
    credit: 2000,
    net: 10000,
    asOf: '2026-07-13T08:00:00Z',
    sourceReport: 'GL Entry',
    snapshotId: 'snap-1',
  },
];

const apRows: ErpAgingSnapshotRow[] = [
  {
    party: 'Acme Vendor',
    partyType: 'Supplier',
    currency: 'USD',
    totalOutstanding: 5000,
    current: 2000,
    bucket0to30: 1000,
    bucket31to60: 1000,
    bucket61to90: 500,
    bucketOver90: 500,
    rangeLabels: null,
    reportDate: '2026-07-12',
    ageingBasedOn: 'Due Date',
    asOf: '2026-07-13T08:00:00Z',
    sourceReport: 'Accounts Payable',
    reportVersion: '15',
    snapshotId: 'snap-2',
  },
];

const arRows: ErpAgingSnapshotRow[] = [
  {
    party: 'Beta Client',
    partyType: 'Customer',
    currency: 'USD',
    totalOutstanding: 8000,
    current: 8000,
    bucket0to30: 0,
    bucket31to60: 0,
    bucket61to90: 0,
    bucketOver90: 0,
    rangeLabels: null,
    reportDate: '2026-07-12',
    ageingBasedOn: 'Due Date',
    asOf: '2026-07-13T08:00:00Z',
    sourceReport: 'Accounts Receivable',
    reportVersion: '15',
    snapshotId: 'snap-3',
  },
];

const emptyProps = {
  actuals: [] as ErpActualsSnapshotRow[],
  actualsPending: false,
  actualsError: false,
  apAging: [] as ErpAgingSnapshotRow[],
  apAgingPending: false,
  apAgingError: false,
  arAging: [] as ErpAgingSnapshotRow[],
  arAgingPending: false,
  arAgingError: false,
};

describe('AccountingSnapshotsSection — empty state (unflipped default)', () => {
  it('renders an empty state for each of the three snapshots when no rows exist', () => {
    render(<AccountingSnapshotsSection {...emptyProps} />);
    expect(screen.getAllByText(/no .*snapshot/i).length).toBeGreaterThanOrEqual(3);
  });

  it('never renders a fabricated figure in the empty state', () => {
    render(<AccountingSnapshotsSection {...emptyProps} />);
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
  });
});

describe('AccountingSnapshotsSection — populated state', () => {
  it('renders the actuals net figure, AP aging party row, and AR aging party row as-is (no recompute)', () => {
    render(
      <AccountingSnapshotsSection
        {...emptyProps}
        actuals={actualsRows}
        apAging={apRows}
        arAging={arRows}
      />,
    );
    // Ledger-sourced-display rule (ADR-0048): the mirrored `net`/`total_outstanding` figures render
    // verbatim — no PMO-side recomputation.
    expect(screen.getByText('$10,000')).toBeInTheDocument();
    expect(screen.getByText('Acme Vendor')).toBeInTheDocument();
    expect(screen.getByText('Beta Client')).toBeInTheDocument();
  });

  it('renders the AccountingSnapshotProvenance strip for each populated snapshot', () => {
    render(
      <AccountingSnapshotsSection
        {...emptyProps}
        actuals={actualsRows}
        apAging={apRows}
        arAging={arRows}
      />,
    );
    const strips = screen.getAllByTestId('snapshot-provenance');
    expect(strips.length).toBe(3);
    expect(strips[0]).toHaveTextContent('GL Entry');
  });
});

describe('AccountingSnapshotsSection — loading / error states', () => {
  it('shows a loading state while pending', () => {
    render(<AccountingSnapshotsSection {...emptyProps} actualsPending />);
    expect(screen.getAllByTestId('liststate-loading').length).toBeGreaterThan(0);
  });

  it('shows an error state with a retry affordance', () => {
    render(<AccountingSnapshotsSection {...emptyProps} apAgingError onRetryApAging={() => {}} />);
    expect(screen.getByText(/couldn.t load/i)).toBeInTheDocument();
  });
});
