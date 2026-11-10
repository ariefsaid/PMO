import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import { AppError } from '@/src/lib/appError';
import { odooErrorMessage } from './odooErrors';

const t = ((_k: string, d: string) => d) as unknown as TFunction;

describe('AC-ODS-008 setup refusals read as plain words, never the server English', () => {
  it.each([
    ['sends-pending', 'Some records are still being sent to Odoo', 'Some records are still on their way to Odoo. Try again when they have arrived.'],
    ['config-rejected', 'Odoo config check failed: missing journal', 'Odoo is missing something this needs. Check the connection again, then try again.'],
    ['feature_off', 'feature off for this org', 'Connecting an accounting system is not turned on for your organization.'],
  ])('AC-ODS-008 %s', (code, server, shown) => {
    const out = odooErrorMessage(t, new AppError(server, code));
    expect(out).toBe(shown);
    expect(out).not.toContain(server);
  });
});
