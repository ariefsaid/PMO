import { describe, expect, it, vi } from 'vitest';
import { fetchStatementAccounts } from './accountFetch.ts';

const deps = (fetchImpl: typeof fetch) => ({ fetchImpl, apiKey: 'k', apiSecret: 's', baseUrl: 'https://erp.example.test', maxRetries: 0 });
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const accountRow = (name: string, index: number, overrides: Record<string, unknown> = {}) => ({
  name, company: 'Synthetic Co', lft: index * 2 + 1, rgt: index * 2 + 2,
  account_name: name, root_type: 'Asset', report_type: 'Balance Sheet', disabled: 0, is_group: 0,
  ...overrides,
});

describe('statement account source', () => {
  it('AC-005: scans all company accounts, including disabled groups, with no modified filter', async () => {
    const firstPage = Array.from({ length: 500 }, (_, index) => accountRow(
      index === 0 ? 'Root' : `Account-${index}`,
      index,
      index === 0 ? { lft: 1, rgt: 1002, disabled: 1, is_group: 1 } : {},
    ));
    const secondPage = [accountRow('Cash', 500)];
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const parsed = new URL(String(url));
      expect(parsed.pathname).toBe('/api/resource/Account');
      const filters = JSON.parse(parsed.searchParams.get('filters')!);
      expect(filters).toEqual([['company', '=', 'Synthetic Co']]);
      expect(parsed.searchParams.get('order_by')).toBe('lft asc, name asc');
      expect(parsed.searchParams.get('limit_page_length')).toBe('500');
      const start = parsed.searchParams.get('limit_start');
      return response({ data: start === '0' ? firstPage : secondPage });
    }) as typeof fetch;
    const result = await fetchStatementAccounts(deps(fetchImpl), { company: 'Synthetic Co' });
    expect(result).toHaveLength(501);
    expect(result[0]).toMatchObject({ name: 'Root', disabled: true, is_group: true });
    expect(result[500]).toMatchObject({ name: 'Cash', disabled: false, is_group: false });
    expect(fetchImpl).toHaveBeenCalledTimes(2); // a full live-size page, then the short terminal page
  });

  it('AC-005: fails closed when a later page errors or the response is malformed', async () => {
    const firstPage = Array.from({ length: 500 }, (_, index) => accountRow(`Account-${index}`, index));
    const pageError = vi.fn().mockResolvedValueOnce(response({ data: firstPage })).mockResolvedValueOnce(response({ message: 'failed' }, 403));
    await expect(fetchStatementAccounts(deps(pageError as typeof fetch), { company: 'Synthetic Co' })).rejects.toMatchObject({ code: 'commit-rejected' });
    const malformed = vi.fn().mockResolvedValue(response({ data: { name: 'not a page' } }));
    await expect(fetchStatementAccounts(deps(malformed as typeof fetch), { company: 'Synthetic Co' })).rejects.toThrow(/malformed/i);
  });
});
