import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LedgerDateLine } from './LedgerDateLine';

// #2290 ruling: in a narrow date cell the ledger date is LABEL ABOVE VALUE; the date never breaks across lines.
describe('LedgerDateLine stacked (narrow date cell)', () => {
  it('puts the label and the date on separate block lines, with the date unbreakable', () => {
    render(<LedgerDateLine stacked entered="2026-05-30" posted="2026-06-01" />);
    const line = screen.getByTestId('ledger-date');
    const label = screen.getByTestId('ledger-date-label');
    const value = screen.getByTestId('ledger-date-value');
    expect(label).toHaveTextContent(/^Ledger date$/);
    expect(value).toHaveTextContent(/^1 Jun( 2026)?$/);
    expect(line).toContainElement(label);
    expect(line).toContainElement(value);
    expect(label.className).toMatch(/\bblock\b/);
    expect(label.className).toMatch(/whitespace-nowrap/);
    expect(value.className).toMatch(/\bblock\b/);
    expect(value.className).toMatch(/whitespace-nowrap/);
    expect(label.compareDocumentPosition(value) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps the entered date reachable: a muted unbreakable second line and the cell title', () => {
    render(<LedgerDateLine stacked entered="2026-05-30" posted="2026-06-01" />);
    const line = screen.getByTestId('ledger-date');
    const entered = screen.getByTestId('ledger-date-entered');
    expect(entered).toHaveTextContent(/^Entered 30 May( 2026)?$/);
    expect(entered.className).toMatch(/whitespace-nowrap/);
    expect(entered.className).toMatch(/\bblock\b/);
    expect(line.getAttribute('title')).toMatch(/30 May/);
    expect(line.getAttribute('title')).toMatch(/1 Jun/);
  });

  it('renders nothing when the ledger date equals the entered one', () => {
    render(<LedgerDateLine stacked entered="2026-06-01" posted="2026-06-01" />);
    expect(screen.queryByTestId('ledger-date')).toBeNull();
  });

  it('has the Bahasa label', async () => {
    const id = (await import('../../../public/locales/id/finance.json')).default as unknown as { odooOutcome: Record<string, string> };
    expect(id.odooOutcome.ledgerDateLabel).toBe('Tanggal buku besar');
    expect(id.odooOutcome.ledgerDateEntered).toBe('Dimasukkan {{date}}');
  });
});

// #2290: a date such as "11 Oct" never splits across lines; the line may wrap only between words.
describe('LedgerDateLine keeps each date whole', () => {
  it('joins day and month with no-break spaces in the single-line form', () => {
    render(<LedgerDateLine entered="2026-10-09" posted="2026-10-11" />);
    const text = screen.getByTestId('ledger-date').textContent ?? '';
    expect(text).toMatch(/11\u00a0Oct/);
    expect(text).toMatch(/9\u00a0Oct/);
    expect(text).not.toMatch(/\d{1,2} Oct/);
  });
});
