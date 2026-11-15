// THEME-BACK-40 (#1643): the late-link repairs, imported from their own module.
import { repairOrgLinksLive, repairUnlinkedReceipts } from './linkRepair.ts';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const references = (...names: string[]) => names.map((reference_name) => ({ reference_doctype: 'Sales Invoice', reference_name, allocated_amount: 1 }));

Deno.test('BLOCK 6 a receipt links to the first MAPPED invoice it cites; an unmapped one is left for the next tick', async () => {
  const links: string[] = [];
  const stamped: string[] = [];
  const result = await repairUnlinkedReceipts({
    listUnlinkedReceipts: () => Promise.resolve([{ id: 'ip-1', erpName: 'PE-1' }, { id: 'ip-2', erpName: 'PE-2' }]),
    fetchDoc: (name) => Promise.resolve({ name, references: name === 'PE-1' ? references('SI-UNMAPPED', 'SI-7') : references('SI-UNMAPPED') }),
    resolveSalesInvoicePmoId: (si) => Promise.resolve(si === 'SI-7' ? 'pmo-si-7' : null),
    link: (ip, si) => { links.push(`${ip}->${si}`); return Promise.resolve(); },
    stampAllocationCheck: (ip) => { stamped.push(ip); return Promise.resolve(); },
  });
  assert(result.repaired === 1 && links.join() === 'ip-1->pmo-si-7', `links: ${links}`);
  assert(stamped.join() === 'ip-1,ip-2', `every attempt is stamped: ${stamped}`);
});

Deno.test('BLOCK 9 an org that does not own revenue has no receipts to repair and never reaches ERP', async () => {
  const client = { from: () => { throw new Error('no read expected'); }, rpc: () => { throw new Error('no read expected'); } } as never;
  const org = { orgId: 'o', siteUrl: 'https://erp.example.com', secretRef: 's', company: 'C', config: {}, ownedDomains: ['procurement'], versionMajor: 15 };
  const result = await repairOrgLinksLive(client, org);
  assert(result.repaired === 0 && result.error === undefined, JSON.stringify(result));
});
