/**
 * Sending a whole PMO catalogue to an empty ERP (S-C, FR-ECA-020/022): everything accepted lands, nothing but masters is
 * created, and one refusal leaves the others alone. Registered with `party.send` (the registry maps one suite per workflow).
 */
import { describe, expect, it } from 'vitest';
import type { ConnectHarness, ErpHarness } from './harness.ts';
import { partySendSuite } from './send.suite.ts';

const items = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `Item ${i + 1}`, name: `Item ${i + 1}`, code: `ITM-${i + 1}` }));

function sendAllCases(h: ErpHarness) {
  const connectOf = (): ConnectHarness => { if (!h.connect) throw new Error(`${h.tier} has no connect()`); return h.connect(); };
  describe(`sendAll (${h.tier})`, () => {
    it('AC-ECA-010 an empty ERP receives exactly the accepted vendors, projects and items, and no account or tax', async () => {
      const c = connectOf();
      for (let i = 1; i <= 3; i += 1) await c.adapter.sendMaster('party', { id: `v${i}`, name: `PT Vendor ${i}`, role: 'vendor', taxId: `0${i}.111` }, `seed:party:v${i}`);
      for (let i = 1; i <= 2; i += 1) await c.adapter.sendMaster('project', { id: `p${i}`, name: `Project ${i}`, code: `PRJ-${i}` }, `seed:project:p${i}`);
      for (const it of items(4)) await c.adapter.sendMaster('item', it, `seed:item:${it.id}`);
      expect([c.documents('party').length, c.documents('project').length, c.documents('item').length]).toEqual([3, 2, 4]);
      expect(c.documents('account')).toHaveLength(0);
      expect(c.touchedAccounting()).toBe(false);   // FR-ECA-020, DD-SETUP-1
    });

    it('AC-ECA-012 one rejected send does not stop the others', async () => {
      const c = connectOf();
      const [first, second, third] = items(3);
      await c.adapter.sendMaster('item', first, `seed:item:${first.id}`);
      c.rejectNextWrite();
      await expect(c.adapter.sendMaster('item', second, `seed:item:${second.id}`)).rejects.toMatchObject({ code: 'commit-rejected' });
      await c.adapter.sendMaster('item', third, `seed:item:${third.id}`);
      expect(c.documents('item').map((d) => d.name).sort()).toEqual([first.name, third.name]);
    });
  });
}

export const partySendAllSuite = (h: ErpHarness) => { partySendSuite(h); sendAllCases(h); };
