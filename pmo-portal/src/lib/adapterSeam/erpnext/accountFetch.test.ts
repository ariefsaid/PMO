import { describe, expect, it, vi } from 'vitest';
import { fetchStatementAccounts } from './accountFetch.ts';

const deps = (fetchImpl: typeof fetch) => ({ fetchImpl, apiKey: 'k', apiSecret: 's', baseUrl: 'https://erp.example.test', maxRetries: 0 });
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('statement account source', () => {
  it('AC-005: scans all company accounts, including disabled groups, with no modified filter', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const parsed = new URL(String(url));
      expect(parsed.pathname).toBe('/api/resource/Account');
      const filters = JSON.parse(parsed.searchParams.get('filters')!);
      expect(filters).toEqual([['company', '=', 'Synthetic Co']]);
      expect(parsed.searchParams.get('order_by')).toBe('lft asc, name asc');
      const start = parsed.searchParams.get('limit_start');
      return response({ data: start === '0' ? [{ name: 'Root', company: 'Synthetic Co', lft: 1, rgt: 4, account_name: 'Root', root_type: 'Asset', report_type: 'Balance Sheet', disabled: 1, is_group: 1 }] : start === '1' ? [{ name: 'Cash', company: 'Synthetic Co', lft: 2, rgt: 3, account_name: 'Cash', root_type: 'Asset', report_type: 'Balance Sheet', disabled: 0, is_group: 0 }] : [] });
    }) as typeof fetch;
    const result = await fetchStatementAccounts(deps(fetchImpl), { company: 'Synthetic Co', pageSize: 1 });
    expect(result).toEqual([
      expect.objectContaining({ name: 'Root', disabled: true, is_group: true }),
      expect.objectContaining({ name: 'Cash', disabled: false, is_group: false }),
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(3); // two records plus short/empty terminal page
  });

  it('AC-005: fails closed when a later page errors or the response is malformed', async () => {
    const pageError = vi.fn().mockResolvedValueOnce(response({ data: [{ name: 'A' }] })).mockResolvedValueOnce(response({ message: 'failed' }, 403));
    await expect(fetchStatementAccounts(deps(pageError as typeof fetch), { company: 'Synthetic Co', pageSize: 1 })).rejects.toMatchObject({ code: 'commit-rejected' });
    const malformed = vi.fn().mockResolvedValue(response({ data: { name: 'not a page' } }));
    await expect(fetchStatementAccounts(deps(malformed as typeof fetch), { company: 'Synthetic Co' })).rejects.toThrow(/malformed/i);
  });
});
