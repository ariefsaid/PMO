import { assertEquals, assertStringIncludes } from '@std/assert';
import type { OutboxRow } from '../../../pmo-portal/src/lib/adapterSeam/dispatch.ts';
import type { OdooOutboxRecoveryCandidate } from '../_shared/odooOutboxRecovery.ts';
import { reconcileOdooRevenueOutbox } from './odooRevenueRecovery.ts';
import { reconcileOdooProcurementOutbox } from './odooProcurementRecovery.ts';
import { reconcileOdooStockOutbox } from './odooStockRecovery.ts';
import { STOCK_DOC_KIND } from './odooStock.ts';
import { INVENTORY_DOMAIN } from '../../../pmo-portal/src/lib/adapterSeam/odoo/stock/stockAdapter.ts';

function client(stored: Record<string, unknown>) {
  const tables: string[] = [];
  const sc = {
    from: (table: string) => {
      tables.push(table);
      const chain = {
        select: () => chain, eq: () => chain,
        maybeSingle: () => Promise.resolve({ data: table === 'external_command_outbox' ? stored : null, error: null }),
        limit: () => Promise.resolve({ data: table === 'external_domain_ownership' ? [{ id: 'own-1' }] : [], error: null }),
      };
      return chain;
    },
    rpc: () => { throw new Error('unexpected rpc'); },
  };
  return { sc: sc as never, tables };
}

function candidate(domain: string, pmoRecordId: string, payload: Record<string, unknown>): OdooOutboxRecoveryCandidate {
  const row: OutboxRow = {
    id: `row-${domain}`, domain, pmoRecordId, idempotencyKey: `key-${domain}`, state: 'pending',
    externalRecordId: null, canonical: null, claimGeneration: 1, payloadDigest: null,
  } as OutboxRow;
  return { row, externalTier: 'odoo', operation: 'create', payload, updatedAt: '2026-11-15T00:00:00Z' };
}

const stored = (domain: string, pmoRecordId: string, payload: Record<string, unknown>) => ({
  external_tier: 'odoo', domain, pmo_record_id: pmoRecordId, operation: 'create', state: 'pending', payload, actor_user_id: null,
});

Deno.test('AC-2283-001 revenue recovery refuses a frozen invoice with no recorded actor before any adapter', async () => {
  const payload = { id: 'inv-1', erp_doc_kind: 'sales-invoice', verb: 'submit' };
  const { sc, tables } = client(stored('revenue', 'inv-1', payload));
  const result = await reconcileOdooRevenueOutbox(sc, 'org-a', { candidates: [candidate('revenue', 'inv-1', payload)] });
  assertEquals(result.reconciled, 0);
  assertStringIncludes(result.errors[0]?.error ?? '', 'no recorded actor');
  assertEquals([...new Set(tables)].sort(), ['external_command_outbox', 'external_domain_ownership']);
});

Deno.test('AC-2283-001 procurement recovery refuses a frozen order with no recorded actor before any adapter', async () => {
  const payload = { id: 'po-1', erp_doc_kind: 'purchase-order' };
  const { sc, tables } = client(stored('procurement', 'po-1', payload));
  const result = await reconcileOdooProcurementOutbox(sc, 'org-a', { candidates: [candidate('procurement', 'po-1', payload)] });
  assertEquals(result.reconciled, 0);
  assertEquals(result.errors, [{ id: 'row-procurement', error: 'commit-rejected' }]);
  assertEquals([...new Set(tables)].sort(), ['external_command_outbox', 'external_domain_ownership']);
});

Deno.test('AC-2283-001 stock recovery refuses a frozen stock post with no recorded actor before any adapter', async () => {
  const payload = { erp_doc_kind: STOCK_DOC_KIND, stockDocumentId: 'doc-1', documentRevision: 1 };
  const { sc, tables } = client(stored(INVENTORY_DOMAIN, 'doc-1', payload));
  const result = await reconcileOdooStockOutbox(sc, 'org-a', { candidates: [candidate(INVENTORY_DOMAIN, 'doc-1', payload)], owns: true });
  assertEquals(result.reconciled, 0);
  assertStringIncludes(result.errors[0]?.error ?? '', 'no recorded actor');
  assertEquals([...new Set(tables)], ['external_command_outbox']);
});
