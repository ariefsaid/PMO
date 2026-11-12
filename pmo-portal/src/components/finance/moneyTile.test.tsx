import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { moneyTileProps } from './moneyTile';

describe('moneyTileProps', () => {
  it('distinguishes absent amounts, explicit zero, and partially unknown totals', () => {
    expect(moneyTileProps({}, 'IDR').value).toBeNull();
    expect(renderToStaticMarkup(moneyTileProps({ IDR: 0 }, 'IDR').value)).toContain('0');
    const mixed = moneyTileProps({ USD: null, IDR: 500 }, 'IDR');
    expect(renderToStaticMarkup(mixed.value)).toContain('5');
    expect(mixed.unknown).toBe(true);
  });
});
