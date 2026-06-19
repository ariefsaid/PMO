/**
 * AC-PR-005 — RecordCard dual-ID display: both the system-minted number and the
 * external reference must render as TEXT, each with the correct semantic label.
 * NFR-PR-A11Y-003: identity communicated via text labels, not color-only.
 * NFR-PR-SEC-003: reference number rendered via React escaping (no dangerouslySetInnerHTML).
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { RecordCard } from './RecordCard';

describe('AC-PR-005: RecordCard dual-ID display', () => {
  const defaultProps = {
    systemNumber: 'PO-2606190001',
    referenceNumber: 'ACME-PO-77',
    date: '2026-06-10',
    amount: 1500,
    status: 'Issued',
    label: 'Purchase Order',
  };

  it('AC-PR-005 external reference round-trips: both system number and external ref render', () => {
    render(<RecordCard {...defaultProps} />);

    // Both numbers must appear as text
    expect(screen.getByText('PO-2606190001')).toBeDefined();
    expect(screen.getByText('ACME-PO-77')).toBeDefined();
  });

  it('AC-PR-005 system number has a "System #" label (NFR-PR-A11Y-003 not-color-only)', () => {
    render(<RecordCard {...defaultProps} />);
    expect(screen.getByText('System #')).toBeDefined();
  });

  it('AC-PR-005 external ref has a "Ref #" label (NFR-PR-A11Y-003 not-color-only)', () => {
    render(<RecordCard {...defaultProps} />);
    expect(screen.getByText('Ref #')).toBeDefined();
  });

  it('AC-PR-005 business date renders', () => {
    render(<RecordCard {...defaultProps} />);
    // date is formatted; we check for the year fragment at minimum
    const el = screen.getByText(/2026/);
    expect(el).toBeDefined();
  });

  it('AC-PR-005 formatted amount renders', () => {
    render(<RecordCard {...defaultProps} />);
    // formatCurrency(1500) → "$1,500"
    expect(screen.getByText(/1,500/)).toBeDefined();
  });

  it('AC-PR-005 status renders as text', () => {
    render(<RecordCard {...defaultProps} />);
    expect(screen.getByText('Issued')).toBeDefined();
  });

  it('AC-PR-005 omits Ref # row when referenceNumber is null', () => {
    render(<RecordCard {...defaultProps} referenceNumber={null} />);
    expect(screen.queryByText('Ref #')).toBeNull();
  });

  it('AC-PR-005 escapes special chars in referenceNumber (NFR-PR-SEC-003: no dangerouslySetInnerHTML)', () => {
    render(<RecordCard {...defaultProps} referenceNumber='<script>xss</script>' />);
    // The raw string should appear as text; no actual <script> element
    const text = screen.getByText(/<script>xss<\/script>/);
    expect(text).toBeDefined();
    // No <script> in the DOM
    expect(document.querySelector('script[data-xss]')).toBeNull();
  });
});

describe('RecordCard — empty/edge states', () => {
  it('renders with only a system number and no optional fields', () => {
    render(<RecordCard systemNumber="PR-2606190001" label="Purchase Request" />);
    expect(screen.getByText('PR-2606190001')).toBeDefined();
    expect(screen.queryByText('Ref #')).toBeNull();
  });
});
