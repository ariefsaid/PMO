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
});
