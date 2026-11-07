import { describe, expect, it } from 'vitest';
import { toCents } from './moneyCents';

describe('toCents (#1459: one cents helper)', () => {
  it('rounds a money amount to whole cents', () => {
    expect(toCents(12.34)).toBe(1234);
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents(-1.005)).toBe(-100);
    expect(toCents(0)).toBe(0);
  });
});
