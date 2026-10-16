import { describe, expect, it, vi } from 'vitest';
import { fetchStatementMetadata } from './statementMetadata.ts';

const response = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
const client = (fetchImpl: typeof fetch) => ({ fetchImpl, apiKey: 'k', apiSecret: 's', baseUrl: 'https://erp.example.test', maxRetries: 0 });

describe('statement metadata', () => {
  it('AC-005: captures IDR, book, applicable fiscal calendar, precision and report settings', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith('/Company/Synthetic%20Co')) return response({ data: { name: 'Synthetic Co', default_currency: 'IDR', default_finance_book: 'Accrual' } });
      if (path.endsWith('/Fiscal%20Year')) return response({ data: [{ name: 'FY-X', year_start_date: '2025-04-01', year_end_date: '2026-03-31' }] });
      if (path.endsWith('/Accounts%20Settings')) return response({ data: { allow_stale: 0, show_unclosed_fy_pl: 1, ignore_is_opening_check: 0, ignore_account_closing_balance: 0 } });
      if (path.endsWith('/System%20Settings')) return response({ data: { currency_precision: 3, float_precision: 3, rounding_method: "Banker's Rounding", currency: 'IDR' } });
      if (path.endsWith('/Currency/IDR')) return response({ data: { name: 'IDR', smallest_currency_fraction_value: 1000 } });
      throw new Error(`unexpected path ${path}`);
    }) as typeof fetch;
    await expect(fetchStatementMetadata(client(fetchImpl), { company: 'Synthetic Co' })).resolves.toMatchObject({
      currency: 'IDR', defaultFinanceBook: 'Accrual', precision: 3, floatPrecision: 3,
      roundingMethod: "Banker's Rounding", zeroCutoff: '0.0005',
      calendar: [{ name: 'FY-X', start: '2025-04-01', end: '2026-03-31' }],
    });
  });

  it('AC-005: uses documented Frappe defaults when optional System Settings are blank', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith('/Company/Synthetic%20Co')) return response({ data: { name: 'Synthetic Co', default_currency: 'IDR', default_finance_book: null } });
      if (path.endsWith('/Fiscal%20Year')) return response({ data: [{ name: 'FY-X', year_start_date: '2025-04-01', year_end_date: '2026-03-31' }] });
      if (path.endsWith('/Accounts%20Settings')) return response({ data: { ignore_is_opening_check: 0, ignore_account_closing_balance: 0 } });
      if (path.endsWith('/System%20Settings')) return response({ data: { currency_precision: '', float_precision: null, rounding_method: '' } });
      if (path.endsWith('/Currency/IDR')) return response({ data: { smallest_currency_fraction_value: 100 } });
      throw new Error(`unexpected path ${path}`);
    }) as typeof fetch;
    await expect(fetchStatementMetadata(client(fetchImpl), { company: 'Synthetic Co' })).resolves.toMatchObject({ precision: 2, floatPrecision: 3, roundingMethod: "Banker's Rounding" });
  });

  it('AC-005: rejects unsupported currency and malformed or missing required metadata', async () => {
    const fetchImpl = vi.fn(async () => response({ data: { name: 'Synthetic Co', default_currency: 'USD' } })) as typeof fetch;
    await expect(fetchStatementMetadata(client(fetchImpl), { company: 'Synthetic Co' })).rejects.toThrow(/IDR/i);
  });
});
