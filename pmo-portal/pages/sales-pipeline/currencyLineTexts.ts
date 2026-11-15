import { formatTableMoney, formatTileMoney } from '@/src/lib/format';
import type { CurrencyAmount } from './pipelineCurrencySplit';

/**
 * #2199 (screen rules, Numbers: one currency per figure): per-currency amounts as text lines, already in
 * currency order (organisation currency first). The first line is the figure; every other currency is a
 * second line ("+ USD 5,300"), never "A · B". `tile`: short ("IDR 7.7B"); `table`: whole units. Null when
 * any amount cannot be formatted, so the caller keeps the figure hidden instead of dropping a currency.
 */
export function currencyLineTexts(amounts: readonly CurrencyAmount[], orgCurrency: string, kind: 'tile' | 'table'): string[] | null {
  const lines: string[] = [];
  for (const [index, { currency, amount }] of amounts.entries()) {
    const opts = { code: currency !== orgCurrency };
    const text = kind === 'tile' ? formatTileMoney(Number(amount), currency, opts) : formatTableMoney(amount, currency, opts);
    if (text === null) return null;
    lines.push(index === 0 ? text : `+ ${text}`);
  }
  return lines;
}
