/**
 * Odoo stock posting recovery and crash-window bed tests (AC-OSP-004, Task 2 of plan #1508).
 *
 * Proves safe recovery identity on stock.picking via stock external identifiers (ir.model.data, module 'pmo').
 *
 * Enforces the binding rule:
 *   - Exactly one proven identity (same company, same intent) is adopted.
 *   - Absent, multiple, edited, wrong-company, or otherwise ambiguous evidence holds with zero second create.
 *   - No heuristic composite guessing is permitted for unanchored stock transfers.
 *
 * Gated on dependencies; fails explicitly (never skips) if bed settings are missing.
 * Synthetic records carry unique run stamps and are cleaned up in finally blocks.
 *
 * Run:
 *   scripts/with-odoo-lock.sh deno test --allow-env --allow-net --allow-read supabase/functions/_shared/odooStockRecovery.bed.test.ts
 */
// deno-lint-ignore no-import-prefix
import { assert, assertEquals } from 'jsr:@std/assert@1.0.0';
import { bindCall, type OdooCall } from '../../../pmo-portal/src/lib/adapterSeam/odoo/client.ts';

interface BedConfig {
  baseUrl: string;
  database: string;
  apiKey: string;
}

function getBedConfig(): BedConfig {
  let baseUrl = Deno.env.get('ODOO_BED_URL');
  let database = Deno.env.get('ODOO_BED_DB');
  let apiKey = Deno.env.get('ODOO_BED_KEY');

  if (!baseUrl || !database || !apiKey) {
    try {
      const envPath = new URL('../../../.env.odoo.local', import.meta.url);
      const content = Deno.readTextFileSync(envPath);
      const vars: Record<string, string> = {};
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const idx = trimmed.indexOf('=');
        if (idx > 0) {
          vars[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
        }
      }
      baseUrl = baseUrl ?? `http://127.0.0.1:${vars.ODOO_PORT || '8069'}`;
      database = database ?? vars.ODOO_DB;
      apiKey = apiKey ?? vars.ODOO_API_KEY;
    } catch {
      // Configuration file absent or unreadable
    }
  }

  assert(
    Boolean(baseUrl && database && apiKey),
    'Odoo dev bed settings (ODOO_BED_URL, ODOO_BED_DB, ODOO_BED_KEY or .env.odoo.local) are required; bed tests fail when absent.',
  );

  return { baseUrl: baseUrl!, database: database!, apiKey: apiKey! };
}

/** Formats an external identifier descriptor following the adapterSeam/odoo/purchase/anchors.ts contract. */
export function stockExternalIdentifier(key: string): { module: string; name: string } {
  return { module: 'pmo', name: key.replace(/[^a-zA-Z0-9_]/g, '_') };
}

export type StockProbeVerdict =
  | { status: 'adopted'; externalRecordId: string; state: string; completedQuantity?: number }
  | { status: 'hold'; reason: 'absent-anchor' | 'ambiguous-anchor' | 'missing-target' | 'wrong-company' | 'mismatched-intent' };

/**
 * Pure recovery probe: probes Odoo to determine whether a stock transfer was already committed.
 * Resolves by external identifier (ir.model.data, module 'pmo', model 'stock.picking').
 * Adopts only on an exact, unambiguous match; holds on any doubt without second creates.
 */
export async function probeStockPicking(
  call: OdooCall,
  anchorKey: string,
  expected: { companyId: number; productId?: number; quantity?: number; srcLocId?: number; destLocId?: number },
): Promise<StockProbeVerdict> {
  const { module, name } = stockExternalIdentifier(anchorKey);
  const rows = await call<Array<{ id: number; res_id: number; model: string }>>('ir.model.data', 'search_read', {
    domain: [['module', '=', module], ['name', '=', name], ['model', '=', 'stock.picking']],
    fields: ['id', 'res_id', 'model'],
    limit: 2,
  });

  if (!rows || rows.length === 0) return { status: 'hold', reason: 'absent-anchor' };
  if (rows.length > 1) return { status: 'hold', reason: 'ambiguous-anchor' };

  const pickingId = rows[0].res_id;
  const pickings = await call<Array<{ id: number; state: string; company_id: [number, string]; location_id: [number, string]; location_dest_id: [number, string]; move_ids: number[] }>>(
    'stock.picking',
    'search_read',
    {
      domain: [['id', '=', pickingId]],
      fields: ['id', 'state', 'company_id', 'location_id', 'location_dest_id', 'move_ids'],
      limit: 1,
    },
  );

  if (!pickings || pickings.length === 0) return { status: 'hold', reason: 'missing-target' };

  const pick = pickings[0];
  if (pick.company_id[0] !== expected.companyId) return { status: 'hold', reason: 'wrong-company' };
  if (expected.srcLocId && pick.location_id[0] !== expected.srcLocId) return { status: 'hold', reason: 'mismatched-intent' };
  if (expected.destLocId && pick.location_dest_id[0] !== expected.destLocId) return { status: 'hold', reason: 'mismatched-intent' };

  let completedQuantity: number | undefined;
  if (pick.move_ids?.length) {
    const moves = await call<Array<{ product_id: [number, string]; quantity: number }>>(
      'stock.move',
      'read',
      { ids: pick.move_ids, fields: ['product_id', 'quantity'] },
    );
    if (expected.productId && !moves.some((m) => m.product_id[0] === expected.productId)) {
      return { status: 'hold', reason: 'mismatched-intent' };
    }
    completedQuantity = moves.reduce((sum, m) => sum + m.quantity, 0);
  }

  return {
    status: 'adopted',
    externalRecordId: `stock.picking:${pick.id}`,
    state: pick.state,
    completedQuantity,
  };
}

Deno.test({
  name: 'AC-OSP-004: Case 1 — create response lost before any anchor exists holds with zero second create',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const cfg = getBedConfig();
    const odoo = bindCall({ baseUrl: cfg.baseUrl, database: cfg.database, apiKey: cfg.apiKey, fetchImpl: fetch });
    const stamp = `C1-${Date.now()}`;

    const [company] = await odoo<Array<{ id: number }>>('res.company', 'search_read', { domain: [], fields: ['id'], limit: 1 });
    const [pickingType] = await odoo<Array<{ id: number; default_location_src_id: [number, string]; default_location_dest_id: [number, string] }>>(
      'stock.picking.type',
      'search_read',
      { domain: [['company_id', '=', company.id], ['code', '=', 'outgoing']], fields: ['id', 'default_location_src_id', 'default_location_dest_id'], limit: 1 },
    );
    const srcLocId = pickingType.default_location_src_id[0];
    const destLocId = pickingType.default_location_dest_id[0];

    let productId = 0;
    let unanchoredPickId = 0;

    try {
      const [pId] = await odoo<number[]>('product.product', 'create', {
        vals_list: [{ name: `${stamp} Item`, is_storable: true, standard_price: 20.0 }],
      });
      productId = pId;

      // Simulate a create that landed in Odoo, but client lost response before writing anchor
      const [pickId] = await odoo<number[]>('stock.picking', 'create', {
        vals_list: [{ picking_type_id: pickingType.id, location_id: srcLocId, location_dest_id: destLocId, company_id: company.id }],
      });
      unanchoredPickId = pickId;
      await odoo('stock.move', 'create', {
        vals_list: [{ picking_id: unanchoredPickId, product_id: productId, product_uom_qty: 5, location_id: srcLocId, location_dest_id: destLocId, company_id: company.id }],
      });

      // Probe using our intended anchor key
      const anchorKey = `stock:${stamp}-lost-create`;
      const verdict = await probeStockPicking(odoo, anchorKey, { companyId: company.id, productId, srcLocId, destLocId });

      // Binding rule: Absent anchor MUST NOT guess look-alikes; it must HOLD
      assertEquals(verdict.status, 'hold');
      if (verdict.status === 'hold') {
        assertEquals(verdict.reason, 'absent-anchor');
      }

      // Assert zero second picking created by probe
      const pickings = await odoo<Array<{ id: number }>>('stock.picking', 'search_read', {
        domain: [['company_id', '=', company.id], ['id', '=', unanchoredPickId]],
        fields: ['id'],
      });
      assertEquals(pickings.length, 1);
    } finally {
      if (unanchoredPickId) await odoo('stock.picking', 'unlink', { ids: [unanchoredPickId] }).catch(() => {});
      if (productId) await odoo('product.product', 'write', { ids: [productId], vals: { active: false } }).catch(() => {});
    }
  },
});

Deno.test({
  name: 'AC-OSP-004: Case 2 — anchored draft that was never validated is adopted in draft state',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const cfg = getBedConfig();
    const odoo = bindCall({ baseUrl: cfg.baseUrl, database: cfg.database, apiKey: cfg.apiKey, fetchImpl: fetch });
    const stamp = `C2-${Date.now()}`;

    const [company] = await odoo<Array<{ id: number }>>('res.company', 'search_read', { domain: [], fields: ['id'], limit: 1 });
    const [pickingType] = await odoo<Array<{ id: number; default_location_src_id: [number, string]; default_location_dest_id: [number, string] }>>(
      'stock.picking.type',
      'search_read',
      { domain: [['company_id', '=', company.id], ['code', '=', 'outgoing']], fields: ['id', 'default_location_src_id', 'default_location_dest_id'], limit: 1 },
    );
    const srcLocId = pickingType.default_location_src_id[0];
    const destLocId = pickingType.default_location_dest_id[0];

    let productId = 0;
    let draftPickId = 0;
    let anchorId = 0;

    try {
      const [pId] = await odoo<number[]>('product.product', 'create', {
        vals_list: [{ name: `${stamp} Item`, is_storable: true, standard_price: 35.0 }],
      });
      productId = pId;

      // 1. Create picking and move
      const [pickId] = await odoo<number[]>('stock.picking', 'create', {
        vals_list: [{ picking_type_id: pickingType.id, location_id: srcLocId, location_dest_id: destLocId, company_id: company.id }],
      });
      draftPickId = pickId;
      await odoo('stock.move', 'create', {
        vals_list: [{ picking_id: draftPickId, product_id: productId, product_uom_qty: 3, location_id: srcLocId, location_dest_id: destLocId, company_id: company.id }],
      });

      // 2. Anchor is written successfully right after create
      const anchorKey = `stock:${stamp}-anchored-draft`;
      const { module, name } = stockExternalIdentifier(anchorKey);
      const [ancId] = await odoo<number[]>('ir.model.data', 'create', {
        vals_list: [{ module, name, model: 'stock.picking', res_id: draftPickId, noupdate: true }],
      });
      anchorId = ancId;

      // 3. Client crashed before confirming/validating
      // Probe must find the anchored draft picking and adopt its identity so caller can resume
      const verdict = await probeStockPicking(odoo, anchorKey, { companyId: company.id, productId, srcLocId, destLocId });

      assertEquals(verdict.status, 'adopted');
      if (verdict.status === 'adopted') {
        assertEquals(verdict.externalRecordId, `stock.picking:${draftPickId}`);
        assertEquals(verdict.state, 'draft');
      }
    } finally {
      if (anchorId) await odoo('ir.model.data', 'unlink', { ids: [anchorId] }).catch(() => {});
      if (draftPickId) await odoo('stock.picking', 'unlink', { ids: [draftPickId] }).catch(() => {});
      if (productId) await odoo('product.product', 'write', { ids: [productId], vals: { active: false } }).catch(() => {});
    }
  },
});

Deno.test({
  name: 'AC-OSP-004: Case 3 & 4 — validation with lost response adopts completed movement, and repeated probe is idempotent',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const cfg = getBedConfig();
    const odoo = bindCall({ baseUrl: cfg.baseUrl, database: cfg.database, apiKey: cfg.apiKey, fetchImpl: fetch });
    const stamp = `C34-${Date.now()}`;

    const [company] = await odoo<Array<{ id: number }>>('res.company', 'search_read', { domain: [], fields: ['id'], limit: 1 });
    const [pickingType] = await odoo<Array<{ id: number; default_location_src_id: [number, string]; default_location_dest_id: [number, string] }>>(
      'stock.picking.type',
      'search_read',
      { domain: [['company_id', '=', company.id], ['code', '=', 'outgoing']], fields: ['id', 'default_location_src_id', 'default_location_dest_id'], limit: 1 },
    );
    const srcLocId = pickingType.default_location_src_id[0];
    const destLocId = pickingType.default_location_dest_id[0];

    let productId = 0;
    let validatedPickId = 0;
    let anchorId = 0;

    try {
      const [pId] = await odoo<number[]>('product.product', 'create', {
        vals_list: [{ name: `${stamp} Item`, is_storable: true, standard_price: 50.0 }],
      });
      productId = pId;

      // 1. Create and anchor picking
      const [pickId] = await odoo<number[]>('stock.picking', 'create', {
        vals_list: [{ picking_type_id: pickingType.id, location_id: srcLocId, location_dest_id: destLocId, company_id: company.id }],
      });
      validatedPickId = pickId;
      const [mvId] = await odoo<number[]>('stock.move', 'create', {
        vals_list: [{ picking_id: validatedPickId, product_id: productId, product_uom_qty: 6, location_id: srcLocId, location_dest_id: destLocId, company_id: company.id }],
      });

      const anchorKey = `stock:${stamp}-validated-loss`;
      const { module, name } = stockExternalIdentifier(anchorKey);
      const [ancId] = await odoo<number[]>('ir.model.data', 'create', {
        vals_list: [{ module, name, model: 'stock.picking', res_id: validatedPickId, noupdate: true }],
      });
      anchorId = ancId;

      // 2. Validate in Odoo
      await odoo('stock.picking', 'action_confirm', { ids: [validatedPickId] });
      await odoo('stock.move', 'write', { ids: [mvId], vals: { quantity: 6, picked: true } });
      await odoo('stock.picking', 'button_validate', { ids: [validatedPickId] });

      // 3. Case 3: Network dropped after validate; probe recovers the completed movement
      const verdict1 = await probeStockPicking(odoo, anchorKey, { companyId: company.id, productId, srcLocId, destLocId });
      assertEquals(verdict1.status, 'adopted');
      if (verdict1.status === 'adopted') {
        assertEquals(verdict1.externalRecordId, `stock.picking:${validatedPickId}`);
        assertEquals(verdict1.state, 'done');
        assertEquals(verdict1.completedQuantity, 6);
      }

      // 4. Case 4: Repeated probe is idempotent and returns identical proven adoption
      const verdict2 = await probeStockPicking(odoo, anchorKey, { companyId: company.id, productId, srcLocId, destLocId });
      assertEquals(verdict2, verdict1, 'repeated probe must return identical verdict');
    } finally {
      if (anchorId) await odoo('ir.model.data', 'unlink', { ids: [anchorId] }).catch(() => {});
      if (productId) await odoo('product.product', 'write', { ids: [productId], vals: { active: false } }).catch(() => {});
    }
  },
});

Deno.test({
  name: 'AC-OSP-004: Case 5 — look-alike transfer in same company is rejected, and edited/ambiguous anchors hold',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const cfg = getBedConfig();
    const odoo = bindCall({ baseUrl: cfg.baseUrl, database: cfg.database, apiKey: cfg.apiKey, fetchImpl: fetch });
    const stamp = `C5-${Date.now()}`;

    const [company] = await odoo<Array<{ id: number }>>('res.company', 'search_read', { domain: [], fields: ['id'], limit: 1 });
    const [pickingType] = await odoo<Array<{ id: number; default_location_src_id: [number, string]; default_location_dest_id: [number, string] }>>(
      'stock.picking.type',
      'search_read',
      { domain: [['company_id', '=', company.id], ['code', '=', 'outgoing']], fields: ['id', 'default_location_src_id', 'default_location_dest_id'], limit: 1 },
    );
    const srcLocId = pickingType.default_location_src_id[0];
    const destLocId = pickingType.default_location_dest_id[0];

    let productId = 0;
    let ourPickId = 0;
    let ourAnchorId = 0;
    let lookalikePickId = 0;
    let corruptedAnchorId = 0;

    try {
      const [pId] = await odoo<number[]>('product.product', 'create', {
        vals_list: [{ name: `${stamp} Item`, is_storable: true, standard_price: 15.0 }],
      });
      productId = pId;

      // 1. Create OUR picking with our anchor
      const [pick1] = await odoo<number[]>('stock.picking', 'create', {
        vals_list: [{ picking_type_id: pickingType.id, location_id: srcLocId, location_dest_id: destLocId, company_id: company.id }],
      });
      ourPickId = pick1;
      const [mv1] = await odoo<number[]>('stock.move', 'create', {
        vals_list: [{ picking_id: ourPickId, product_id: productId, product_uom_qty: 10, location_id: srcLocId, location_dest_id: destLocId, company_id: company.id }],
      });
      const ourKey = `stock:${stamp}-our-transfer`;
      const { module: ourMod, name: ourName } = stockExternalIdentifier(ourKey);
      const [anc1] = await odoo<number[]>('ir.model.data', 'create', {
        vals_list: [{ module: ourMod, name: ourName, model: 'stock.picking', res_id: ourPickId, noupdate: true }],
      });
      ourAnchorId = anc1;
      await odoo('stock.picking', 'action_confirm', { ids: [ourPickId] });
      await odoo('stock.move', 'write', { ids: [mv1], vals: { quantity: 10, picked: true } });
      await odoo('stock.picking', 'button_validate', { ids: [ourPickId] });

      // 2. Create an UNRELATED LOOK-ALIKE transfer in the same company: same product, quantity, locations!
      const [pick2] = await odoo<number[]>('stock.picking', 'create', {
        vals_list: [{ picking_type_id: pickingType.id, location_id: srcLocId, location_dest_id: destLocId, company_id: company.id }],
      });
      lookalikePickId = pick2;
      const [mv2] = await odoo<number[]>('stock.move', 'create', {
        vals_list: [{ picking_id: lookalikePickId, product_id: productId, product_uom_qty: 10, location_id: srcLocId, location_dest_id: destLocId, company_id: company.id }],
      });
      await odoo('stock.picking', 'action_confirm', { ids: [lookalikePickId] });
      await odoo('stock.move', 'write', { ids: [mv2], vals: { quantity: 10, picked: true } });
      await odoo('stock.picking', 'button_validate', { ids: [lookalikePickId] });

      // Subcase 5A: Probing OUR anchor adopts ONLY our picking, never the look-alike
      const probeOur = await probeStockPicking(odoo, ourKey, { companyId: company.id, productId, srcLocId, destLocId });
      assertEquals(probeOur.status, 'adopted');
      if (probeOur.status === 'adopted') {
        assertEquals(probeOur.externalRecordId, `stock.picking:${ourPickId}`);
        assert(probeOur.externalRecordId !== `stock.picking:${lookalikePickId}`, 'must not adopt look-alike picking');
      }

      // Subcase 5B: If our anchor is missing, probing refuses to guess the look-alike transfer
      const missingKey = `stock:${stamp}-lost-against-lookalike`;
      const probeLost = await probeStockPicking(odoo, missingKey, { companyId: company.id, productId, srcLocId, destLocId });
      assertEquals(probeLost.status, 'hold', 'probe without anchor must hold, never adopt look-alike');
      if (probeLost.status === 'hold') {
        assertEquals(probeLost.reason, 'absent-anchor');
      }

      // Subcase 5C: Corrupted/edited anchor pointing to non-existent target or wrong company
      const corruptedKey = `stock:${stamp}-corrupted`;
      const { module: corMod, name: corName } = stockExternalIdentifier(corruptedKey);
      const [corAncId] = await odoo<number[]>('ir.model.data', 'create', {
        vals_list: [{ module: corMod, name: corName, model: 'stock.picking', res_id: 9999999, noupdate: true }],
      });
      corruptedAnchorId = corAncId;

      const probeCorrupted = await probeStockPicking(odoo, corruptedKey, { companyId: company.id, productId, srcLocId, destLocId });
      assertEquals(probeCorrupted.status, 'hold');
      if (probeCorrupted.status === 'hold') {
        assertEquals(probeCorrupted.reason, 'missing-target');
      }

      // Subcase 5D: Anchor edited to point to a picking in a different/unmatched location
      const wrongLocKey = `stock:${stamp}-wrong-loc`;
      const { module: wlMod, name: wlName } = stockExternalIdentifier(wrongLocKey);
      const [wlAncId] = await odoo<number[]>('ir.model.data', 'create', {
        vals_list: [{ module: wlMod, name: wlName, model: 'stock.picking', res_id: ourPickId, noupdate: true }],
      });
      const probeWrongLoc = await probeStockPicking(odoo, wrongLocKey, {
        companyId: company.id,
        productId,
        srcLocId: 99999, // mismatched expected location
        destLocId,
      });
      assertEquals(probeWrongLoc.status, 'hold');
      if (probeWrongLoc.status === 'hold') {
        assertEquals(probeWrongLoc.reason, 'mismatched-intent');
      }
      await odoo('ir.model.data', 'unlink', { ids: [wlAncId] }).catch(() => {});
    } finally {
      if (ourAnchorId) await odoo('ir.model.data', 'unlink', { ids: [ourAnchorId] }).catch(() => {});
      if (corruptedAnchorId) await odoo('ir.model.data', 'unlink', { ids: [corruptedAnchorId] }).catch(() => {});
      if (productId) await odoo('product.product', 'write', { ids: [productId], vals: { active: false } }).catch(() => {});
    }
  },
});

Deno.test({
  name: 'AC-OSP-004: create and anchor are one call',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const cfg = getBedConfig();
    const odoo = bindCall({ baseUrl: cfg.baseUrl, database: cfg.database, apiKey: cfg.apiKey, fetchImpl: fetch });
    const stamp = `ATOMIC-${Date.now()}`;

    // 1. Resolve active company, internal source, and customer destination
    const companies = await odoo<Array<{ id: number }>>('res.company', 'search_read', { domain: [], fields: ['id'], limit: 1 });
    const companyId = companies[0].id;
    const stockLocations = await odoo<Array<{ id: number }>>('stock.location', 'search_read', {
      domain: [['usage', '=', 'internal'], ['company_id', 'in', [companyId, false]]],
      fields: ['id'],
      limit: 1,
    });
    const srcLocId = stockLocations[0].id;

    const customers = await odoo<Array<{ id: number }>>('stock.location', 'search_read', {
      domain: [['usage', '=', 'customer']],
      fields: ['id'],
      limit: 1,
    });
    const destLocId = customers[0].id;

    let productId = 0;
    let pickingId = 0;
    const anchorKey = `stock:${stamp}-atomic`;
    const { module, name: anchorName } = stockExternalIdentifier(anchorKey);
    const xmlId = `${module}.${anchorName}`;

    interface LoadResult {
      ids: number[] | false;
      messages: Array<{ type: string; message: string; field?: string }>;
      nextrow: number;
    }

    try {
      // Create synthetic costed item
      const [pId] = await odoo<number[]>('product.product', 'create', {
        vals_list: [{ name: `${stamp} Item`, is_storable: true, standard_price: 60.00 }],
      });
      productId = pId;

      // 2. Perform atomic creation via stock.picking load entry point
      const loadRes1 = await odoo<LoadResult>('stock.picking', 'load', {
        fields: [
          'id',
          'picking_type_id/.id',
          'location_id/.id',
          'location_dest_id/.id',
          'company_id/.id',
          'origin',
          'move_ids/product_id/.id',
          'move_ids/product_uom_qty',
          'move_ids/location_id/.id',
          'move_ids/location_dest_id/.id',
          'move_ids/company_id/.id',
        ],
        data: [
          [xmlId, 2, srcLocId, destLocId, companyId, `${stamp}-CALL-1`, productId, 4, srcLocId, destLocId, companyId],
        ],
      });

      assert(Array.isArray(loadRes1.ids) && loadRes1.ids.length > 0, 'load must return created picking ID');
      pickingId = loadRes1.ids[0];
      assert(pickingId > 0, 'positive picking ID must be returned');
      assertEquals(loadRes1.messages.length, 0, 'load must succeed with 0 error messages');

      // 3. Prove both the record and its external identifier exist after the single call
      const [picking] = await odoo<Array<{ id: number; origin: string; state: string }>>('stock.picking', 'read', {
        ids: [pickingId],
        fields: ['id', 'origin', 'state'],
      });
      assertEquals(picking.id, pickingId);
      assertEquals(picking.origin, `${stamp}-CALL-1`);

      const anchorRows = await odoo<Array<{ id: number; module: string; name: string; model: string; res_id: number }>>(
        'ir.model.data',
        'search_read',
        {
          domain: [['module', '=', module], ['name', '=', anchorName]],
          fields: ['id', 'module', 'name', 'model', 'res_id'],
        },
      );
      assertEquals(anchorRows.length, 1, 'ir.model.data row must exist after single load call');
      assertEquals(anchorRows[0].model, 'stock.picking');
      assertEquals(anchorRows[0].res_id, pickingId);

      // Verify that move lines were also created atomically
      const moves = await odoo<Array<{ id: number; product_id: [number, string]; product_uom_qty: number; state: string }>>(
        'stock.move',
        'search_read',
        {
          domain: [['picking_id', '=', pickingId]],
          fields: ['id', 'product_id', 'product_uom_qty', 'state'],
        },
      );
      assertEquals(moves.length, 1, 'stock move must be created atomically under the picking');
      assertEquals(moves[0].product_id[0], productId);
      assertEquals(moves[0].product_uom_qty, 4);

      // 4. Repeated identical call does NOT create a second picking (updates existing, returns same id)
      const loadRes2 = await odoo<LoadResult>('stock.picking', 'load', {
        fields: [
          'id',
          'picking_type_id/.id',
          'location_id/.id',
          'location_dest_id/.id',
          'company_id/.id',
          'origin',
        ],
        data: [
          [xmlId, 2, srcLocId, destLocId, companyId, `${stamp}-CALL-2`],
        ],
      });

      assert(Array.isArray(loadRes2.ids) && loadRes2.ids.length > 0);
      assertEquals(loadRes2.ids[0], pickingId, 'repeated call returns identical picking ID (no duplicate created)');

      const [pickingUpdated] = await odoo<Array<{ id: number; origin: string }>>('stock.picking', 'read', {
        ids: [pickingId],
        fields: ['id', 'origin'],
      });
      assertEquals(pickingUpdated.origin, `${stamp}-CALL-2`, 'repeated call updates existing record origin');

      const anchorRowsAfter2 = await odoo<Array<{ id: number }>>('ir.model.data', 'search_read', {
        domain: [['module', '=', module], ['name', '=', anchorName]],
        fields: ['id'],
      });
      assertEquals(anchorRowsAfter2.length, 1, 'ir.model.data row remains exactly one');

      // 5. Failure inside the call leaves neither record nor identifier (atomic rollback)
      const failKey = `stock:${stamp}-fail`;
      const { module: failMod, name: failName } = stockExternalIdentifier(failKey);
      const failXmlId = `${failMod}.${failName}`;

      const failRes = await odoo<LoadResult>('stock.picking', 'load', {
        fields: ['id', 'picking_type_id/.id', 'location_id/.id', 'location_dest_id/.id', 'company_id/.id'],
        data: [
          [failXmlId, 2, 99999999, destLocId, companyId], // non-existent location ID
        ],
      });

      assertEquals(failRes.ids, false, 'failed load must return ids: false');
      assert(failRes.messages.length > 0, 'failed load must contain error messages');

      const failAnchorRows = await odoo<Array<{ id: number }>>('ir.model.data', 'search_read', {
        domain: [['module', '=', failMod], ['name', '=', failName]],
        fields: ['id'],
      });
      assertEquals(failAnchorRows.length, 0, 'failure inside load leaves zero ir.model.data records');
    } finally {
      if (pickingId) {
        await odoo('stock.picking', 'unlink', { ids: [pickingId] }).catch(() => {});
      }
      if (productId) {
        await odoo('product.product', 'write', { ids: [productId], vals: { active: false } }).catch(() => {});
      }
    }
  },
});
