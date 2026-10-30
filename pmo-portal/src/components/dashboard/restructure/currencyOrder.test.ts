import { describe, expect, it } from 'vitest';
import { orderByCurrency } from './currencyOrder';
import { currencyFigure } from './useCompanyFigures';
import { projectMoneyFigure } from '../hub/pm/metrics';
import type { PMDashboardProject } from '@/src/lib/db/dashboard';

describe('L12(h) one currency order for money pairs', () => {
  it('puts the organisation currency first, the rest alphabetically', () => {
    expect(orderByCurrency([{ currency: 'IDR' }, { currency: 'EUR' }, { currency: 'USD' }], 'USD').map((row) => row.currency)).toEqual(['USD', 'EUR', 'IDR']);
  });

  it('company figures and the PM contract total read the same pair in the same order', () => {
    const company = currencyFigure([{ currency: 'IDR', amount: 269_000_000 }, { currency: 'USD', amount: 33_100_000 }], 'USD', 'n/a');
    const projects = [
      { id: 'a', currency: 'USD', contract_value: 33_100_000 },
      { id: 'b', currency: 'IDR', contract_value: 269_000_000 },
    ] as unknown as PMDashboardProject[];
    const pm = projectMoneyFigure(projects, 'contract_value', 'USD', 'n/a');
    expect(company?.value).toBe(pm.value);
    expect(pm.value.indexOf('$33.1M')).toBeLessThan(pm.value.indexOf('IDR'));
  });
});
