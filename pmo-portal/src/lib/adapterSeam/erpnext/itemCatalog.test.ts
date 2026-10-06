import { describe, expect, it, vi } from 'vitest';
import { listErpItems, validateItemLines } from './itemCatalog.ts';
import { siToBody } from './bodies/salesInvoice.ts';
import { poToBody } from './bodies/purchaseOrder.ts';
import { piToBody } from './bodies/purchaseInvoice.ts';

const ctx = { refs: { customer: 'CUSTOMER-TEST', supplier: 'SUPPLIER-TEST' }, config: {} };

describe('ERP item authoring', () => {
  it.each(['sales', 'purchase'] as const)(
    'AC-ITM-001 lists enabled %s items with code/name and explicit ERP filters',
    async (purpose) => {
      const fetchImpl = vi.fn(async (url: string) => {
        const query = new URL(url).searchParams;
        expect(JSON.parse(query.get('filters')!)).toEqual([
          ['disabled', '=', 0],
          [`is_${purpose}_item`, '=', 1],
        ]);
        expect(JSON.parse(query.get('fields')!)).toEqual([
          'name',
          'item_name',
          'disabled',
          'is_sales_item',
          'is_purchase_item',
        ]);
        return Response.json({
          data: [
            {
              name: 'ITEM-TEST',
              item_name: 'Test service',
              disabled: 0,
              is_sales_item: 1,
              is_purchase_item: 1,
            },
            {
              name: 'ITEM-DISABLED',
              item_name: 'Disabled',
              disabled: 1,
              is_sales_item: 1,
              is_purchase_item: 1,
            },
            {
              name: 'ITEM-WRONG',
              item_name: 'Wrong purpose',
              disabled: 0,
              is_sales_item: purpose === 'sales' ? 0 : 1,
              is_purchase_item: purpose === 'purchase' ? 0 : 1,
            },
          ],
        });
      });
      expect(
        await listErpItems(
          {
            baseUrl: 'https://erp.example.com',
            apiKey: 'test',
            apiSecret: 'test',
            fetchImpl: fetchImpl as typeof fetch,
          },
          purpose,
        ),
      ).toEqual([{ code: 'ITEM-TEST', name: 'Test service' }]);
    },
  );

  it.each([siToBody, poToBody, piToBody])(
    'AC-ITM-002 keeps the free description distinct from the item code',
    (toBody) => {
      const body = toBody(
        {
          id: 'test',
          items: [
            {
              item_code: 'ITEM-TEST',
              description: 'Inspection of test unit',
              qty: 2,
              rate: 10,
              schedule_date: '2026-10-05',
            },
          ],
        },
        ctx,
      ) as { items: unknown[] };
      expect(body.items[0]).toMatchObject({
        item_code: 'ITEM-TEST',
        description: 'Inspection of test unit',
        qty: 2,
        rate: 10,
      });
    },
  );

  it('AC-ITM-003 rejects an unresolved second line with its number and code', () => {
    expect(() =>
      validateItemLines(
        [{ item_code: 'ITEM-TEST' }, { item_code: 'ITEM-UNKNOWN' }],
        [{ code: 'ITEM-TEST', name: 'Test service' }],
      ),
    ).toThrow('Line 2: item "ITEM-UNKNOWN" is not an enabled ERP item');
  });

  it('accepts a resolved item without replacing the authored description', () => {
    const lines = [{ item_code: 'ITEM-TEST', description: 'Test work' }];
    validateItemLines(lines, [{ code: 'ITEM-TEST', name: 'Test service' }]);
    expect(lines).toEqual([{ item_code: 'ITEM-TEST', description: 'Test work' }]);
  });

  it('omits descriptions that were not authored (legacy body shape)', () => {
    expect(
      siToBody({ id: 'test', items: [{ item_code: 'ITEM-TEST', qty: 1, rate: 10 }] }, ctx),
    ).toEqual({ customer: 'CUSTOMER-TEST', items: [{ item_code: 'ITEM-TEST', qty: 1, rate: 10 }] });
  });

  it('reads every catalog page without truncating the picker', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      const start = Number(new URL(url).searchParams.get('limit_start'));
      return Response.json({
        data:
          start === 0
            ? Array.from({ length: 200 }, (_, i) => ({
                name: `ITEM-${i}`,
                disabled: 0,
                is_sales_item: 1,
              }))
            : [{ name: 'ITEM-LAST', disabled: 0, is_sales_item: 1 }],
      });
    });
    const items = await listErpItems(
      {
        baseUrl: 'https://erp.example.com',
        apiKey: 'test',
        apiSecret: 'test',
        fetchImpl: fetchImpl as typeof fetch,
      },
      'sales',
    );
    expect(items).toHaveLength(201);
    expect(items.at(-1)).toEqual({ code: 'ITEM-LAST', name: 'ITEM-LAST' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('refuses an unreadable catalog and a missing line code', async () => {
    await expect(
      listErpItems(
        {
          baseUrl: 'https://erp.example.com',
          apiKey: 'test',
          apiSecret: 'test',
          fetchImpl: (async () => Response.json({})) as typeof fetch,
        },
        'sales',
      ),
    ).rejects.toThrow('ERP item catalog could not be read');
    expect(() => validateItemLines([{}], [])).toThrow('Line 1: item ""');
  });
});
