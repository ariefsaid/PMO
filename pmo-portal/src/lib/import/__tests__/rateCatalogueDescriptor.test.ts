import { describe, it, expect, vi, beforeEach } from 'vitest';

const { upsertItem } = vi.hoisted(() => ({ upsertItem: vi.fn() }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { rateCatalogue: { upsertItem } } }));

import { makeRateCatalogueImportDescriptor, parseStages, RATE_CATALOGUE_MAX_ROWS } from '../rateCatalogueDescriptor';
import { validateRows } from '../validateRows';
import { autoMap } from '../autoMap';
import { buildFailedRowsTable } from '../failedRows';
import { rateAt } from '@/src/lib/db/rateCatalogue';

const V = ['Remote', 'Non-remote'];
const d = () => makeRateCatalogueImportDescriptor('prj-1', V);
const good = (over: Record<string, string> = {}) => ({
  category: 'Pipe', class: 'A', itemCode: 'W-1', description: 'Weld', unit: 'm', workMethod: 'Manual', testType: 'RT',
  effectiveFrom: '2026-01-01', 'rate:Remote': '120.50', 'rate:Non-remote': '100', stages: 'Fabrication=10; Welding=80; Testing=10', ...over,
});

describe('rate catalogue import descriptor (#2520)', () => {
  beforeEach(() => upsertItem.mockReset().mockResolvedValue({ itemId: 'i', created: true, ratesAdded: 2 }));

  it('AC-RC-2 accepts a good row and maps rates by variant name, stages with weights', () => {
    expect(d().validateRow!(good())).toEqual({});
    expect(d().toInput(good())).toMatchObject({
      itemCode: 'W-1', effectiveFrom: '2026-01-01', rates: { Remote: 120.5, 'Non-remote': 100 },
      stages: [{ stage: 'Fabrication', weightPct: 10 }, { stage: 'Welding', weightPct: 80 }, { stage: 'Testing', weightPct: 10 }],
    });
  });

  it('AC-RC-2 refuses a row without required text, a real date, or any rate', () => {
    const e = d().validateRow!(good({ itemCode: '', unit: '', effectiveFrom: '2026-02-30' }));
    expect(e).toHaveProperty('itemCode'); expect(e).toHaveProperty('unit'); expect(e).toHaveProperty('effectiveFrom');
    expect(d().validateRow!(good({ 'rate:Remote': '', 'rate:Non-remote': '' }))).toHaveProperty('itemCode');
    expect(d().validateRow!(good({ 'rate:Remote': '-1' }))).toHaveProperty('rate:Remote');
    expect(d().validateRow!(good({ 'rate:Remote': '1.234' }))).toHaveProperty('rate:Remote');
  });

  it('AC-RC-5 stage weights must add to 100 and read as name=percent', () => {
    expect(d().validateRow!(good({ stages: 'A=50; B=40' }))).toHaveProperty('stages');
    expect(d().validateRow!(good({ stages: 'nonsense' }))).toHaveProperty('stages');
    expect(d().validateRow!(good({ stages: '' }))).toEqual({});
    expect(parseStages('A=33.33; B=66.67')).toHaveLength(2);
  });

  it('refuses a repeated item code inside one sheet, naming both rows', () => {
    const out = d().validateSheet!([good(), good({ itemCode: 'W-2' }), good({ itemCode: 'w-1' })]);
    expect(out[2].itemCode).toMatch(/rows 2 and 4/);
    expect(out[0]).toEqual({}); expect(out[1]).toEqual({});
  });

  it('maps 2,000 items to repository writes', async () => {
    expect(RATE_CATALOGUE_MAX_ROWS).toBeGreaterThanOrEqual(2000);
    expect(d().maxRows).toBe(RATE_CATALOGUE_MAX_ROWS);
    const desc = d();
    const headers = desc.fields.map((f) => f.label);
    const mapping = autoMap(headers, desc.fields);
    const rows = Array.from({ length: 2000 }, (_, i) => desc.fields.map((f) => {
      const c = good({ itemCode: `IT-${i}`, description: `Item ${i}` }) as Record<string, string>;
      return c[f.key] ?? '';
    }));
    const v = validateRows(rows, desc.fields, mapping, desc.validateRow, desc.validateSheet);
    expect(v.filter((x) => x.valid)).toHaveLength(2000);
    for (const r of rows.slice(0, 2000)) await desc.create(desc.toInput(Object.fromEntries(desc.fields.map((f, i) => [f.key, r[i]]))));
    expect(upsertItem).toHaveBeenCalledTimes(2000);
    expect(upsertItem.mock.calls[0][0]).toBe('prj-1');
  });
});

describe('failed rows download table (#2520)', () => {
  it('keeps the sheet headers and cells, adds a reason column, in sheet order', () => {
    const t = buildFailedRowsTable(['Code', 'Rate'], [['a', '1'], ['b', 'x'], ['c', '3']], [{ index: 2, reason: 'late' }, { index: 1, reason: 'bad rate' }], 'Why');
    expect(t.header).toEqual(['Code', 'Rate', 'Why']);
    expect(t.body).toEqual([['b', 'x', 'bad rate'], ['c', '3', 'late']]);
  });
});

describe('rateAt (#2520)', () => {
  const rates = [
    { item_id: 'i', variant_id: 'v', rate: 120, effective_from: '2026-01-01' },
    { item_id: 'i', variant_id: 'v', rate: 150, effective_from: '2026-06-01' },
  ];
  it('AC-RC-4 reads the rate in force on a date; before the first rate there is none', () => {
    expect(rateAt(rates, 'i', 'v', '2026-05-31')).toBe(120);
    expect(rateAt(rates, 'i', 'v', '2026-06-01')).toBe(150);
    expect(rateAt(rates, 'i', 'v', '2025-12-31')).toBeNull();
    expect(rateAt(rates, 'i', 'other', '2026-06-01')).toBeNull();
  });
});
