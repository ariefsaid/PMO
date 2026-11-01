/**
 * party.send · project.send · item.send (v1) — PMO masters sent to an ERP that lacks them (S-C, FR-ECA-020/021):
 * lookup-then-create, so a retry after a lost answer never makes a second document (NFR-ECA-001).
 */
import { describe, expect, it } from 'vitest';
import type { MasterKind, PmoMaster } from '../connect/types.ts';
import type { ConnectHarness, ErpHarness, Suite } from './harness.ts';

const RECORDS: Record<'party' | 'project' | 'item', PmoMaster> = {
  party: { id: 'pmo-c-1', name: 'PT Contoh Baja', role: 'vendor', taxId: '01.234.567.8-901.000' },
  project: { id: 'pmo-p-1', name: 'Jembatan Contoh', code: 'PRJ-26-0001' },
  item: { id: 'pmo-i-1', name: 'Semen 50 kg', code: 'SMN-50' },
};

function connectOf(h: ErpHarness): ConnectHarness {
  if (!h.connect) throw new Error(`${h.tier} declares a send workflow supported but its harness has no connect()`);
  return h.connect();
}

function sendSuite(kind: 'party' | 'project' | 'item'): Suite {
  const record = RECORDS[kind];
  const key = `seed:${kind}:${record.id}`;
  const send = (c: ConnectHarness, r: PmoMaster = record) => c.adapter.sendMaster(kind as MasterKind, r, key);

  return (h) => describe(`${kind}.send (${h.tier})`, () => {
    it('FR-ECA-020 creates exactly one ERP document for a PMO record the ERP lacks, and answers its external id', async () => {
      const c = connectOf(h);
      const { externalId } = await send(c);
      const docs = c.documents(kind as MasterKind);
      expect(docs).toHaveLength(1);
      expect(docs[0].externalId).toBe(externalId);
      expect(docs[0].name).toContain(record.name);
      if (record.code) expect(docs[0].code).toBe(record.code);
    });

    it('FR-ECA-021 sending again finds the first document: no second create, same external id', async () => {
      const c = connectOf(h);
      const first = await send(c);
      expect(await send(c)).toEqual(first);
      expect(c.documents(kind as MasterKind)).toHaveLength(1);
    });

    it('AC-ECA-011 a create whose answer is lost, then retried, leaves one document with the retry\'s external id', async () => {
      const c = connectOf(h);
      c.failNextWrite('lost-response');
      await expect(send(c)).rejects.toMatchObject({ code: 'external-unreachable' });
      const retry = await send(c);
      const docs = c.documents(kind as MasterKind);
      expect(docs).toHaveLength(1);
      expect(docs[0].externalId).toBe(retry.externalId);
    });

    it('a create that never reached the ERP is classified unreachable and writes nothing; the retry creates one', async () => {
      const c = connectOf(h);
      c.failNextWrite('transport');
      await expect(send(c)).rejects.toMatchObject({ code: 'external-unreachable' });
      expect(c.documents(kind as MasterKind)).toEqual([]);
      await send(c);
      expect(c.documents(kind as MasterKind)).toHaveLength(1);
    });

    if (kind === 'party') {
      it('FR-ECA-020 a vendor and a client are distinct ERP parties with their own roles and external ids', async () => {
        const c = connectOf(h);
        const vendor = await send(c, { ...record, id: 'pmo-v', role: 'vendor' });
        const client = await send(c, { ...record, id: 'pmo-k', role: 'client' });
        expect(vendor.externalId).not.toBe(client.externalId);
        const byId = new Map(c.documents('party').map((d) => [d.externalId, d]));
        expect(byId.get(vendor.externalId)).toMatchObject({ role: 'vendor', taxId: record.taxId });
        expect(byId.get(client.externalId)).toMatchObject({ role: 'client' });
      });
    }
  });
}

export const partySendSuite = sendSuite('party');
export const projectSendSuite = sendSuite('project');
export const itemSendSuite = sendSuite('item');
