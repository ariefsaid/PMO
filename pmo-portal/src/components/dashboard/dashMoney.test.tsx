import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { moneyTileValue } from './dashMoney';

const lines = (value: ReturnType<typeof moneyTileValue>) => {
  const { container } = render(<div>{value?.value}</div>);
  return [...container.firstElementChild!.children].map((node) => node.textContent?.replace(/\u00a0/g, ' '));
};

describe('moneyTileValue — a second currency is its own labelled amount (owner ruling 2026-11-16)', () => {
  it('leads with the organisation currency and labels the other currency as an addition, never a bare line', () => {
    const value = moneyTileValue([{ currency: 'USD', amount: 1_850_000 }, { currency: 'IDR', amount: 32_000_000_000 }], 'IDR', (amount) => `+ ${amount} contracts`);
    expect(lines(value)).toEqual(['IDR 32B', '+ USD 1.85M contracts']);
  });

  it('never shows a zero in a second currency; a home zero stays', () => {
    expect(lines(moneyTileValue([{ currency: 'IDR', amount: 0 }, { currency: 'USD', amount: 0 }], 'IDR'))).toEqual(['IDR 0']);
  });

  it('with only another currency, that amount leads alone, named by its code', () => {
    expect(lines(moneyTileValue([{ currency: 'USD', amount: 5_000 }], 'IDR'))).toEqual(['USD 5K']);
  });
});
