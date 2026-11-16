import { describe, it, expect } from 'vitest';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { journalErrorOverrides } from './journalWords';
import en from '../../public/locales/en/journals.json';
import id from '../../public/locales/id/journals.json';

const t = ((_key: string, fallback: string) => fallback) as never;

describe('journalErrorOverrides', () => {
  it('AC-MJE-DEC-1 a refused excess-decimals amount shows the decimals headline, not the generic one', () => {
    const err = Object.assign(new Error('line 2: the amount has more decimals than the currency holds (2)'), { code: 'PJ422' });
    const c = classifyMutationError(err, journalErrorOverrides(t));
    expect(c.headline).toBe(en.errors.tooManyDecimals);
    expect(c.headline).not.toBe(en.errors.invalid);
  });

  it('AC-MJE-DEC-1 the decimals message exists in English and Bahasa', () => {
    expect(en.errors.tooManyDecimals).toBeTruthy();
    expect(id.errors.tooManyDecimals).toBeTruthy();
    expect(id.errors.tooManyDecimals).not.toBe(en.errors.tooManyDecimals);
  });
});
