import { describe, expect, it, vi } from 'vitest';
import { resolveSalesTaxRows } from './erpSalesTaxRows.ts';

/** ERPNext fake: the default-template list answers one name; the single-doc read answers `rows`. */
function deps(rows: Array<Record<string, unknown>>) {
  const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
    const path = decodeURIComponent(new URL(String(url)).pathname);
    if (path === '/api/resource/Sales Taxes and Charges Template') return Response.json({ data: [{ name: 'Synthetic Output VAT' }] });
    return Response.json({ data: { name: 'Synthetic Output VAT', taxes: rows } });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, apiKey: 'k', apiSecret: 's', baseUrl: 'https://erp.example.test' };
}
const VAT = { charge_type: 'On Net Total', account_head: 'Output VAT - SC', rate: 11, description: 'Output VAT' };

describe('sales tax rows — symmetry with vendor withholding (#876, DD-VWH-9)', () => {
  it('AC-VWH-013 a default sales template with a negative-rate row is refused (config-rejected) before any ERPNext write', async () => {
    await expect(resolveSalesTaxRows(deps([VAT, { ...VAT, account_head: 'Withholding - SC', rate: -2 }]), 'Synthetic Co'))
      .rejects.toMatchObject({
        code: 'config-rejected',
        message: 'The default sales tax template "Synthetic Output VAT" has a negative rate. Client withholding is recorded on the receipt, not the invoice — ask your ERP administrator to remove the row, then raise the invoice again.',
      });
  });

  it('AC-VWH-013 CONTROL a positive-rate default template still resolves its rows', async () => {
    await expect(resolveSalesTaxRows(deps([VAT]), 'Synthetic Co')).resolves.toEqual([
      { charge_type: 'On Net Total', account_head: 'Output VAT - SC', description: 'Output VAT', rate: 11 },
    ]);
  });
});
