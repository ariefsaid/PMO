import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MoneyTotalLines } from '../MoneyTotalLines';

describe('MoneyTotalLines', () => {
  it('drops a zero currency line beside a real one', () => {
    render(<MoneyTotalLines testId="m" tooltip="tip" totals={[
      { currency: 'IDR', amount: 0, unknown: false },
      { currency: 'USD', amount: 30000, unknown: false },
    ]} />);
    expect(screen.getByTestId('m').textContent).not.toMatch(/IDR/);
    expect(screen.getByTestId('m').textContent).toMatch(/30,000/);
  });

  it('keeps one zero line when everything is zero', () => {
    render(<MoneyTotalLines testId="m" tooltip="tip" totals={[
      { currency: 'USD', amount: 0, unknown: false },
      { currency: 'IDR', amount: 0, unknown: false },
    ]} />);
    expect(screen.getByTestId('m').children).toHaveLength(1);
  });

  it('L12c: a currency with some unrecorded rows shows the recorded part and counts the rest', () => {
    render(<MoneyTotalLines testId="m" tooltip="tip" totals={[
      { currency: 'USD', amount: null, unknown: true, knownAmount: 30000, unknownCount: 2 },
    ]} />);
    expect(screen.getByTestId('m')).toHaveTextContent('$30,000');
    expect(screen.getByTestId('m')).toHaveTextContent('2 more have no amount recorded');
  });

  it('a currency with nothing recorded is named as not recorded, never shown as a figure', () => {
    render(<MoneyTotalLines testId="m" tooltip="tip" totals={[
      { currency: 'IDR', amount: null, unknown: true, knownAmount: 0, unknownCount: 3 },
    ]} />);
    expect(screen.getByTestId('m')).toHaveTextContent('IDR amount not recorded');
    expect(screen.getByTestId('m')).not.toHaveTextContent(/[0-9]/);
  });

  it('C4: no rows is a known zero, not "No amount"', () => {
    render(<MoneyTotalLines testId="m" tooltip="tip" totals={[]} />);
    expect(screen.getByTestId('m')).toHaveTextContent('0');
    expect(screen.getByTestId('m')).not.toHaveTextContent(/no amount/i);
  });
});
