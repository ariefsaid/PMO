import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { TaxBasisLabel } from '../TaxBasisLabel';

/**
 * `OD-TAX-1` §2 — no bare number anywhere the treatment exists, and no invented one where it does
 * not. Both treatments appear here on purpose: a fixture carrying only one of them cannot tell a
 * label DERIVED from the row apart from a hardcoded string (the DD-CUR-6 / #529 blind spot the
 * issue's own test note names).
 */
describe('TaxBasisLabel — the basis that travels with a money figure (OD-TAX-1)', () => {
  it('AC-DPP-002: shows the nominal rate and the exact authored DPP fraction', () => {
    render(<TaxBasisLabel treatment="exclusive" taxRate={12} taxBaseNumerator={11} taxBaseDenominator={12} />);
    expect(screen.getByTestId('tax-basis')).toHaveTextContent('excl. PPN 12% · DPP 11/12');
  });

  it('AC-DPP-002: states an unknown historical rate without inventing an effective or nominal rate', () => {
    render(<TaxBasisLabel treatment="inclusive" taxRate={null} taxBaseNumerator={1} taxBaseDenominator={1} />);
    expect(screen.getByTestId('tax-basis')).toHaveTextContent('incl. PPN · rate not recorded · DPP 1/1');
    expect(screen.getByTestId('tax-basis')).not.toHaveTextContent('0%');
  });
  it('AC-DPP-002: an ERP mirror without base facts qualifies DPP as unknown', () => {
    render(<TaxBasisLabel treatment="inclusive" taxRate={null} taxBaseUnknown />);
    expect(screen.getByTestId('tax-basis')).toHaveTextContent('DPP not recorded');
    expect(screen.getByTestId('tax-basis')).not.toHaveTextContent('DPP 1/1');
  });
  it('renders "incl. PPN" for an inclusive row', () => {
    render(<TaxBasisLabel treatment="inclusive" />);
    expect(screen.getByTestId('tax-basis')).toHaveTextContent('incl. PPN');
  });

  it('renders "excl. PPN" for an exclusive row — a different row reads differently', () => {
    render(<TaxBasisLabel treatment="exclusive" />);
    expect(screen.getByTestId('tax-basis')).toHaveTextContent('excl. PPN');
  });

  it('AC-UNB-001: states only the comparison basis for a normalized aggregate', () => {
    render(<TaxBasisLabel treatment="exclusive" showDetails={false} />);
    expect(screen.getByTestId('tax-basis')).toHaveTextContent('excl. PPN');
    expect(screen.getByTestId('tax-basis')).not.toHaveTextContent('rate not recorded');
    expect(screen.getByTestId('tax-basis')).not.toHaveTextContent('DPP');
  });

  it('renders NOTHING for a NULL treatment — 0197 pairs NULL with a zero value, so there is no basis to state', () => {
    const { container } = render(<TaxBasisLabel treatment={null} />);
    expect(screen.queryByTestId('tax-basis')).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it('renders NOTHING for undefined — a projection that omitted the column states nothing either', () => {
    render(<TaxBasisLabel treatment={undefined} />);
    expect(screen.queryByTestId('tax-basis')).not.toBeInTheDocument();
  });

  it('renders NOTHING for an out-of-domain marker rather than guessing one of the two', () => {
    render(<TaxBasisLabel treatment="inklusif" />);
    expect(screen.queryByTestId('tax-basis')).not.toBeInTheDocument();
  });

  it('carries the treatment as a data attribute, so a surface with many figures is auditable', () => {
    render(<TaxBasisLabel treatment="inclusive" testId="contract-tax-basis" />);
    expect(screen.getByTestId('contract-tax-basis')).toHaveAttribute('data-tax-basis', 'inclusive');
  });
});
