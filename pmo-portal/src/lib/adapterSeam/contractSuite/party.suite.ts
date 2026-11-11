/** party.match (v2) — moved from the ERPNext partyAdopt tests; the behaviour every ERP adapter must show. */
import { describe, expect, it } from 'vitest';
import type { ErpHarness, PartyRole } from './harness.ts';

const ROLES: PartyRole[] = ['vendor', 'client'];

export function partySuite(h: ErpHarness): void {
  describe(`party.match (${h.tier})`, () => {
    it.each(ROLES)('AC-ENA-041 %s with no PMO candidate is brought in, never linked', async (role) => {
      const r = await h.matchParty({ role, externalId: 'EXT-1', name: 'Acme Co', taxId: 'TAX-1' }, []);
      expect(r).toMatchObject({ outcome: 'bring-in', role });
    });

    it('one candidate and no source tax id links that company', async () => {
      const r = await h.matchParty({ role: 'vendor', externalId: 'EXT-1', name: 'Acme Co' }, [{ pmoId: 'pmo-1', taxId: null }]);
      expect(r).toMatchObject({ outcome: 'link', pmoId: 'pmo-1' });
    });

    it.each([null, undefined, ''])('one candidate with a different tax id still links when the source tax id is absent (%s)', async (taxId) => {
      const r = await h.matchParty({ role: 'vendor', externalId: 'EXT-1', name: 'Acme Co', taxId }, [{ pmoId: 'pmo-1', taxId: 'TAX-2' }]);
      expect(r).toMatchObject({ outcome: 'link', pmoId: 'pmo-1' });
    });

    it.each(ROLES)('AC-ENA-093a %s narrows same-name candidates by the source tax id', async (role) => {
      const r = await h.matchParty({ role, externalId: 'EXT-1', name: 'Test party', taxId: 'TAX-1' }, [
        { pmoId: 'pmo-other', taxId: 'TAX-2' },
        { pmoId: 'pmo-matching', taxId: 'TAX-1' },
      ]);
      expect(r).toMatchObject({ outcome: 'link', pmoId: 'pmo-matching' });
    });

    it.each([null, ''])('FR-ECA-011 v2: a same-name candidate with an unset tax id next to a conflicting one is a review (%s)', async (taxId) => {
      const r = await h.matchParty({ role: 'vendor', externalId: 'EXT-1', name: 'Test party', taxId: 'TAX-1' }, [
        { pmoId: 'pmo-other', taxId: 'TAX-2' },
        { pmoId: 'pmo-unset', taxId },
      ]);
      expect(r.outcome).toBe('review');
    });

    it.each(ROLES)('AC-ENA-093b %s refuses the only same-name candidate with a differing tax id', async (role) => {
      const r = await h.matchParty({ role, externalId: 'EXT-1', name: 'Test party', taxId: 'TAX-1' }, [{ pmoId: 'pmo-other', taxId: 'TAX-2' }]);
      expect(r.outcome).toBe('review');
    });

    it('FR-ECA-011 v2: a unique tax id links even when an unset-tax candidate shares the name', async () => {
      const r = await h.matchParty({ role: 'vendor', externalId: 'EXT-1', name: 'Acme Co', taxId: 'TAX-1' }, [
        { pmoId: 'pmo-a', taxId: 'TAX-1' },
        { pmoId: 'pmo-b', taxId: null },
      ]);
      expect(r).toMatchObject({ outcome: 'link', pmoId: 'pmo-a' });
    });

    it('FR-ECA-011 v2: a unique tax id links even when the names differ', async () => {
      const r = await h.matchParty({ role: 'vendor', externalId: 'EXT-1', name: 'Other Name', taxId: 'TAX-1' }, [{ pmoId: 'pmo-1', taxId: 'TAX-1' }]);
      expect(r).toMatchObject({ outcome: 'link', pmoId: 'pmo-1' });
    });

    it('AC-ENA-041 several candidates and no source tax id goes to review', async () => {
      const r = await h.matchParty({ role: 'vendor', externalId: 'EXT-1', name: 'Acme Co' }, [
        { pmoId: 'pmo-a', taxId: null },
        { pmoId: 'pmo-b', taxId: null },
      ]);
      expect(r.outcome).toBe('review');
    });

    it('matching again after the first run left its company behind lands on the same company and external id', async () => {
      const party = { role: 'vendor' as const, externalId: 'EXT-1', name: 'Acme Co', taxId: 'TAX-1' };
      const first = await h.matchParty(party, []);
      expect(first.outcome).toBe('bring-in');
      const pmoIdAfterFirstRun = 'pmo-created-by-first-run';
      const second = await h.matchParty(party, [{ pmoId: pmoIdAfterFirstRun, taxId: 'TAX-1' }]);
      expect(second).toMatchObject({ outcome: 'link', pmoId: pmoIdAfterFirstRun });
      if (first.outcome === 'bring-in' && second.outcome === 'link') expect(second.externalId).toBe(first.externalId);
    });

    it('AC-ENA-042 a client and a vendor sharing a name never merge: two distinct external ids and roles', async () => {
      const vendor = await h.matchParty({ role: 'vendor', externalId: 'SAME', name: 'Acme Co' }, []);
      const client = await h.matchParty({ role: 'client', externalId: 'SAME', name: 'Acme Co' }, []);
      expect(vendor).toMatchObject({ outcome: 'bring-in', role: 'vendor' });
      expect(client).toMatchObject({ outcome: 'bring-in', role: 'client' });
      if (vendor.outcome === 'bring-in' && client.outcome === 'bring-in') expect(vendor.externalId).not.toBe(client.externalId);
    });

    it.each(ROLES)('FR-ENA-090 a %s the ERP marks as PMO\'s own organisation is refused, never brought in', async (role) => {
      const r = await h.matchParty({ role, externalId: 'EXT-1', name: 'Own Org', internal: true }, []);
      expect(r.outcome).toBe('refused');
    });
  });
}
