/**
 * AccountingSnapshotProvenance (task 7.8): a read-only provenance strip for the actuals/aging
 * snapshot read surface — shows as_of + source_report + report_version from a seeded snapshot row,
 * or an empty-state when no snapshot exists. RTL unit only (no new route). Strictly DESIGN.md tokens.
 *
 * RED until AccountingSnapshotProvenance.tsx exists.
 */
import { afterEach, describe, it, expect } from 'vitest';
import { resetActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';
import { render, screen } from '@testing-library/react';
import { AccountingSnapshotProvenance } from './AccountingSnapshotProvenance';

describe('AccountingSnapshotProvenance (task 7.8 — read-only provenance display)', () => {
  it('renders as_of + source_report + report_version provenance from a seeded aging snapshot row', () => {
    render(
      <AccountingSnapshotProvenance
        asOf="2026-07-12T10:00:00Z"
        sourceReport="Accounts Payable"
        reportVersion="erpnext-15.94.3/frappe-15.96.0"
      />,
    );
    expect(screen.getByText(/As of/)).toBeInTheDocument();
    // the as_of date is surfaced (date-formatted, human-readable)
    expect(screen.getByText(/2026/)).toBeInTheDocument();
    // source_report + report_version provenance
    expect(screen.getByText(/Accounts Payable/)).toBeInTheDocument();
    expect(screen.getByText(/erpnext-15\.94\.3/)).toBeInTheDocument();
  });

  it('renders the mirrored-ledger fallback source provenance when the report RPC fell back', () => {
    render(
      <AccountingSnapshotProvenance
        asOf="2026-07-12T10:00:00Z"
        sourceReport="Accounts Payable (mirrored-ledger fallback)"
        reportVersion="erpnext-15.94.3/frappe-15.96.0"
      />,
    );
    expect(screen.getByText(/mirrored-ledger fallback/)).toBeInTheDocument();
  });

  it('shows an empty-state when no snapshot exists (no as_of)', () => {
    render(<AccountingSnapshotProvenance asOf={null} sourceReport={null} reportVersion={null} />);
    expect(screen.getByText(/No snapshot available/i)).toBeInTheDocument();
    // does NOT render a stray as-of / source line
    expect(screen.queryByText(/As of/)).not.toBeInTheDocument();
  });

  it('omits the report_version chip when it is absent (actuals snapshots have no report_version)', () => {
    render(
      <AccountingSnapshotProvenance
        asOf="2026-07-12T10:00:00Z"
        sourceReport="GL Entry"
        reportVersion={null}
      />,
    );
    expect(screen.getByText(/GL Entry/)).toBeInTheDocument();
    // no version chip rendered
    expect(screen.queryByText(/erpnext-/)).not.toBeInTheDocument();
  });
});

describe('AC-PLC-005: the snapshot date follows the profile timezone', () => {
  afterEach(() => resetActiveLocale());

  it('shows the as_of instant on the calendar day of the viewer timezone', () => {
    const asOf = '2026-06-14T23:30:00Z';
    setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'UTC' });
    const { unmount } = render(<AccountingSnapshotProvenance asOf={asOf} sourceReport="GL Entry" reportVersion={null} />);
    expect(screen.getByText(/Jun 14, 2026/)).toBeInTheDocument();
    unmount();

    setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'Asia/Jakarta' });
    render(<AccountingSnapshotProvenance asOf={asOf} sourceReport="GL Entry" reportVersion={null} />);
    expect(screen.getByText(/Jun 15, 2026/)).toBeInTheDocument();
  });
});

describe('AccountingSnapshotProvenance optional updatedLabel', () => {
  afterEach(() => resetActiveLocale());

  it('uses supplied localized prefixes while preserving the captured timestamp and supplied provenance', () => {
    setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'UTC' });
    const { rerender } = render(
      <AccountingSnapshotProvenance
        asOf="2026-07-12T10:00:00Z"
        sourceReport="Profit and loss"
        reportVersion="source-version"
        updatedLabel="Updated"
      />,
    );
    const strip = screen.getByTestId('snapshot-provenance');
    const timestamp = strip.querySelector('.font-medium')?.textContent;
    expect(strip.firstElementChild?.textContent).toMatch(/^Updated /);
    expect(timestamp).toMatch(/2026/);
    expect(strip).toHaveTextContent('Profit and loss');
    expect(strip).toHaveTextContent('source-version');
    expect(strip.querySelectorAll('[aria-hidden="true"]')).toHaveLength(2);
    expect(strip.children).toHaveLength(5);

    rerender(
      <AccountingSnapshotProvenance
        asOf="2026-07-12T10:00:00Z"
        sourceReport="Profit and loss"
        reportVersion="source-version"
        updatedLabel="Diperbarui"
      />,
    );
    const updatedStrip = screen.getByTestId('snapshot-provenance');
    expect(updatedStrip.firstElementChild?.textContent).toMatch(/^Diperbarui /);
    expect(updatedStrip.querySelector('.font-medium')).toHaveTextContent(timestamp ?? '');
    expect(updatedStrip).toHaveTextContent('Profit and loss');
    expect(updatedStrip).toHaveTextContent('source-version');
    expect(updatedStrip.children).toHaveLength(5);
  });

  it('retains the original As of text and DOM when updatedLabel is omitted or undefined', () => {
    const { rerender } = render(
      <AccountingSnapshotProvenance
        asOf="2026-07-12T10:00:00Z"
        sourceReport="Accounts Payable"
        reportVersion="source-version"
        className="custom-strip"
      />,
    );
    const strip = screen.getByTestId('snapshot-provenance');
    const originalMarkup = strip.innerHTML;
    expect(strip.firstElementChild?.textContent).toMatch(/^As of /);
    expect(strip).toHaveClass('custom-strip');
    expect(strip.children).toHaveLength(5);
    expect(strip.querySelectorAll('[aria-hidden="true"]')).toHaveLength(2);
    expect(strip).toHaveTextContent('Accounts Payable');
    expect(strip).toHaveTextContent('source-version');

    rerender(
      <AccountingSnapshotProvenance
        asOf="2026-07-12T10:00:00Z"
        sourceReport="Accounts Payable"
        reportVersion="source-version"
        className="custom-strip"
        updatedLabel={undefined}
      />,
    );
    expect(screen.getByTestId('snapshot-provenance').innerHTML).toBe(originalMarkup);
  });

  it('ignores updatedLabel and other provenance fields when asOf is null or omitted', () => {
    const { rerender } = render(
      <AccountingSnapshotProvenance
        asOf={null}
        sourceReport="Must not appear"
        reportVersion="must-not-appear"
        updatedLabel="Updated"
      />,
    );
    expect(screen.getByTestId('snapshot-provenance-empty')).toHaveTextContent('No snapshot available yet');
    expect(screen.getByTestId('snapshot-provenance-empty').children).toHaveLength(0);
    expect(screen.queryByTestId('snapshot-provenance')).not.toBeInTheDocument();

    rerender(
      <AccountingSnapshotProvenance
        sourceReport="Must not appear"
        reportVersion="must-not-appear"
        updatedLabel="Diperbarui"
      />,
    );
    expect(screen.getByTestId('snapshot-provenance-empty')).toHaveTextContent('No snapshot available yet');
    expect(screen.getByTestId('snapshot-provenance-empty').children).toHaveLength(0);
    expect(screen.queryByText('Must not appear')).not.toBeInTheDocument();
    expect(screen.queryByText('must-not-appear')).not.toBeInTheDocument();
  });
});
