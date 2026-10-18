import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { TaxBasisLabel } from '../TaxBasisLabel';

/**
 * `OD-TAX-1` §2 — no bare number anywhere the treatment exists, and no invented one where it does
 * not. Both treatments appear here on purpose: a fixture carrying only one of them cannot tell a
 * label DERIVED from the row apart from a hardcoded string (the DD-CUR-6 / #529 blind spot the
 * issue's own test note names).
 */
describe('TaxBasisLabel — the basis that travels with a money figure (OD-TAX-1)', () => {
  it('AC-S39-001: keeps each stored basis immediate and discloses only its authored details on demand', async () => {
    const user = userEvent.setup();
    render(
      <>
        <TaxBasisLabel
          testId="exclusive-basis"
          treatment="exclusive"
          taxRate={12}
          taxBaseNumerator={11}
          taxBaseDenominator={12}
          detailsMode="disclosure"
        />
        <TaxBasisLabel
          testId="inclusive-basis"
          treatment="inclusive"
          taxRate={5}
          taxBaseNumerator={1}
          taxBaseDenominator={2}
          detailsMode="disclosure"
        />
        <TaxBasisLabel
          testId="unknown-facts"
          treatment="exclusive"
          taxRate={null}
          taxBaseUnknown
          detailsMode="disclosure"
        />
        <TaxBasisLabel
          testId="known-zero-rate"
          treatment="exclusive"
          taxRate={0}
          taxBaseNumerator={1}
          taxBaseDenominator={1}
          detailsMode="disclosure"
        />
        <TaxBasisLabel
          testId="basis-only"
          treatment="exclusive"
          taxRate={12}
          taxBaseNumerator={11}
          taxBaseDenominator={12}
          detailsMode="disclosure"
          showDetails={false}
        />
        <TaxBasisLabel testId="unknown-treatment" treatment={null} detailsMode="disclosure" />
      </>,
    );

    const exclusive = screen.getByTestId('exclusive-basis');
    const exclusiveTrigger = within(exclusive).getByRole('button', { name: 'Show tax details' });
    expect(exclusiveTrigger).toHaveClass('touch-target');
    expect(exclusiveTrigger).toHaveClass('min-h-8');
    expect(exclusive).toHaveTextContent('excl. PPN');
    expect(exclusiveTrigger).toHaveAttribute('aria-expanded', 'false');
    const panelId = exclusiveTrigger.getAttribute('aria-controls');
    expect(panelId).toBeTruthy();
    const exclusiveDetails = document.getElementById(panelId!);
    expect(exclusiveDetails).toBeInTheDocument();
    expect(exclusiveDetails).toHaveAttribute('aria-labelledby', exclusiveTrigger.id);
    expect(exclusiveDetails).not.toBeVisible();

    exclusiveTrigger.focus();
    await user.keyboard('{Enter}');
    expect(exclusiveTrigger).toHaveAttribute('aria-expanded', 'true');
    expect(exclusiveTrigger).toHaveAttribute('aria-controls', panelId);
    expect(exclusiveDetails).toBeVisible();
    expect(exclusiveDetails).toHaveTextContent('12%');
    expect(exclusiveDetails).toHaveTextContent('DPP 11/12');

    await user.keyboard('{Escape}');
    expect(exclusiveTrigger).toHaveAttribute('aria-expanded', 'false');
    expect(exclusiveDetails).not.toBeVisible();
    expect(exclusiveTrigger).toHaveFocus();

    const inclusive = screen.getByTestId('inclusive-basis');
    const inclusiveTrigger = within(inclusive).getByRole('button', { name: 'Show tax details' });
    expect(inclusive).toHaveTextContent('incl. PPN');
    inclusiveTrigger.focus();
    await user.keyboard(' ');
    const inclusiveDetails = document.getElementById(inclusiveTrigger.getAttribute('aria-controls')!);
    expect(inclusiveDetails).toBeVisible();
    expect(inclusiveDetails).toHaveTextContent('5%');
    expect(inclusiveDetails).toHaveTextContent('DPP 1/2');
    await user.click(inclusiveTrigger);
    expect(inclusiveTrigger).toHaveAttribute('aria-expanded', 'false');

    const knownZero = screen.getByTestId('known-zero-rate');
    const zeroTrigger = within(knownZero).getByRole('button', { name: 'Show tax details' });
    await user.click(zeroTrigger);
    const zeroDetails = document.getElementById(zeroTrigger.getAttribute('aria-controls')!);
    expect(zeroDetails).toHaveTextContent('0%');
    expect(zeroDetails).not.toHaveTextContent('rate not recorded');

    const unknownFacts = screen.getByTestId('unknown-facts');
    const unknownTrigger = within(unknownFacts).getByRole('button', { name: 'Show tax details' });
    await user.keyboard('{Tab}');
    await user.click(unknownTrigger);
    const unknownDetails = document.getElementById(unknownTrigger.getAttribute('aria-controls')!);
    expect(unknownDetails).toHaveTextContent('rate not recorded');
    expect(unknownDetails).toHaveTextContent('DPP not recorded');
    expect(unknownDetails).not.toHaveTextContent('DPP 1/1');

    const basisOnly = screen.getByTestId('basis-only');
    expect(basisOnly).toHaveTextContent('excl. PPN');
    expect(within(basisOnly).queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByTestId('unknown-treatment')).not.toBeInTheDocument();
  });

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
