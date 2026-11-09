import { describe, expect, it } from 'vitest';
import { bindCall } from '../client.ts';
import { createFakeOdoo } from '../fakeOdoo.ts';
import { parsePage } from '../kinds.ts';
import { keysetDomain } from '../sweep.ts';
import { LEDGER_FEED_SPEC, ledgerFeedReaders } from './feed.ts';

const raw = (over: Record<string, unknown> = {}) => ({
  id: 9, parent_state: 'posted', date: '2026-02-10', debit: 1000.01, credit: 0, balance: 1000.01,
  account_id: [12, '510000 Direct Costs'], move_id: [5, 'BILL/2026/0005'], move_name: 'BILL/2026/0005',
  journal_id: [3, 'Vendor Bills'], partner_id: [41, 'Acme'], company_id: [1, 'Example Co'], currency_id: [1, 'IDR'],
  amount_currency: 1000.01, analytic_distribution: { '101': 60, '102': 40 }, write_date: '2026-02-10 08:00:00', ...over,
});

describe('ledger feed parsing (FR-ODA-001/008)', () => {
  it('keeps parent_state, amounts, account, move, journal, partner and the distribution', () => {
    const row = LEDGER_FEED_SPEC.parse(raw());
    expect(row).toMatchObject({ external_id: '9', name: 'BILL/2026/0005', source_write_date: '2026-02-10 08:00:00', active: true });
    expect(row?.attrs).toMatchObject({
      parent_state: 'posted', date: '2026-02-10', debit: '1000.01', credit: '0.00', account_id: '12', journal: 'Vendor Bills',
      partner: 'Acme', foreign_currency: false, analytic_distribution: { '101': 60, '102': 40 },
    });
  });

  it('a draft line is kept, with its state, so a repost can flip it back', () => {
    expect(LEDGER_FEED_SPEC.parse(raw({ parent_state: 'draft' }))?.attrs.parent_state).toBe('draft');
  });

  it('no distribution and no partner are null, not malformed', () => {
    const row = LEDGER_FEED_SPEC.parse(raw({ analytic_distribution: false, partner_id: false, journal_id: false }));
    expect(row?.attrs).toMatchObject({ analytic_distribution: null, partner: null, journal: null });
  });

  it('flags a line carrying another currency (OQ-ODA-5)', () => {
    expect(LEDGER_FEED_SPEC.parse(raw({ currency_id: [2, 'USD'], amount_currency: 70 }))?.attrs.foreign_currency).toBe(true);
  });

  it('skips malformed rows and counts them', () => {
    const { rows, skipped } = parsePage(LEDGER_FEED_SPEC, [
      raw(), raw({ id: 'x' }), raw({ write_date: 'yesterday' }), raw({ debit: 'NaN' }), raw({ account_id: false }),
      raw({ parent_state: false }), raw({ date: false }), raw({ move_name: '' }),
    ]);
    expect(rows).toHaveLength(1);
    expect(skipped).toBe(7);
  });
});

describe('ledger feed reader over fakeOdoo', () => {
  const setup = () => {
    const fake = createFakeOdoo({ key: 'k' });
    const call = bindCall({ baseUrl: 'https://odoo.example.test', apiKey: 'k', database: 'db1', fetchImpl: fake.fetch });
    return { fake, call };
  };

  it('reads only the activated company, keyset by write_date and id, draft lines included', async () => {
    const { fake, call } = setup();
    fake.seed('account.move.line', [
      raw({ id: 1, write_date: '2026-02-10 08:00:02' }), raw({ id: 2, write_date: '2026-02-10 08:00:01', parent_state: 'draft' }),
      raw({ id: 3, write_date: '2026-02-10 08:00:01', company_id: [2, 'Other Co'] }), raw({ id: 4, write_date: '2026-02-10 08:00:03' }),
    ]);
    const readers = ledgerFeedReaders(call, 1);
    const first = await readers.read(keysetDomain({ w: '2026-02-10 08:00:00', id: 0 }), 'write_date asc, id asc', 2) as Array<{ id: number }>;
    expect(first.map((r) => r.id)).toEqual([2, 1]);
    const next = await readers.read(keysetDomain({ w: '2026-02-10 08:00:02', id: 1 }), 'write_date asc, id asc', 2) as Array<{ id: number }>;
    expect(next.map((r) => r.id)).toEqual([4]);
    expect(await readers.readIds(0, 10)).toEqual([1, 2, 4]);
  });

  it('every requested field is one fakeOdoo knows (no silent false)', async () => {
    const { fake, call } = setup();
    fake.seed('account.move.line', [raw()]);
    const [row] = await ledgerFeedReaders(call, 1).read([], 'id asc', 1) as Array<Record<string, unknown>>;
    for (const f of LEDGER_FEED_SPEC.fields) expect(row[f], f).not.toBeUndefined();
    expect(LEDGER_FEED_SPEC.parse(row)).not.toBeNull();
  });
});
