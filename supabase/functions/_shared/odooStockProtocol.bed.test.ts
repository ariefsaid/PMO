/**
 * Odoo stock posting native protocol bed tests (AC-OSP-002, AC-OSP-003, Task 1 of plan #1508).
 *
 * Proves native Odoo 20 Community stock transfer, validation, project issue and analytic costing behavior
 * on the dev bed using bindCall from pmo-portal/src/lib/adapterSeam/odoo/client.ts.
 *
 * Gated on dependencies; a test asked to run without required settings fails explicitly (never skips).
 * Synthetic records carry unique run stamps and are cleaned up in finally blocks.
 *
 * Run:
 *   scripts/with-odoo-lock.sh deno test --allow-env --allow-net --allow-read supabase/functions/_shared/odooStockProtocol.bed.test.ts
 */
// deno-lint-ignore no-import-prefix
import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1.0.0';
import { bindCall, OdooError } from '../../../pmo-portal/src/lib/adapterSeam/odoo/client.ts';

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

Deno.test({
  name: 'AC-OSP-002: availability of stock modules, company, operation type and synthetic master data',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const cfg = getBedConfig();
    const odoo = bindCall({ baseUrl: cfg.baseUrl, database: cfg.database, apiKey: cfg.apiKey, fetchImpl: fetch });
    const stamp = `AVAIL-${Date.now()}`;

    // 1. Verify required modules are installed
    const modules = await odoo<Array<{ name: string; state: string }>>('ir.module.module', 'search_read', {
      domain: [['name', 'in', ['stock', 'stock_account', 'project_stock_account']]],
      fields: ['name', 'state'],
    });
    const installed = new Map(modules.map((m) => [m.name, m.state]));
    assertEquals(installed.get('stock'), 'installed', 'stock module must be installed');
    assertEquals(installed.get('stock_account'), 'installed', 'stock_account module must be installed');
    assertEquals(installed.get('project_stock_account'), 'installed', 'project_stock_account module must be installed');

    // 2. Verify company availability
    const companies = await odoo<Array<{ id: number; name: string }>>('res.company', 'search_read', {
      domain: [],
      fields: ['id', 'name'],
      limit: 1,
    });
    assert(companies.length > 0, 'at least one active company must exist on the bed');
    const companyId = companies[0].id;

    // 3. Verify operation type availability
    const pickingTypes = await odoo<Array<{ id: number; name: string; code: string; analytic_costs: boolean }>>(
      'stock.picking.type',
      'search_read',
      {
        domain: [['company_id', '=', companyId], ['code', 'in', ['outgoing', 'internal', 'incoming']]],
        fields: ['id', 'name', 'code', 'analytic_costs'],
      },
    );
    assert(pickingTypes.length > 0, 'stock operation types must be defined for the company');
    const deliveryType = pickingTypes.find((pt) => pt.code === 'outgoing');
    assert(deliveryType !== undefined, 'outgoing delivery operation type must exist');
    assert(typeof deliveryType.analytic_costs === 'boolean', 'analytic_costs field must be present on picking type');

    // 4. Create synthetic master data with cleanup in finally
    let productId = 0;
    let projectId = 0;
    let locAId = 0;
    let locBId = 0;

    try {
      const stockLocations = await odoo<Array<{ id: number }>>('stock.location', 'search_read', {
        domain: [['usage', '=', 'internal'], ['company_id', 'in', [companyId, false]]],
        fields: ['id'],
        limit: 1,
      });
      assert(stockLocations.length > 0, 'parent internal stock location must exist');
      const parentLocId = stockLocations[0].id;

      // Synthetic costed item
      const [pId] = await odoo<number[]>('product.product', 'create', {
        vals_list: [{ name: `${stamp} Item`, is_storable: true, standard_price: 75.50 }],
      });
      productId = pId;
      assert(productId > 0, 'synthetic product created');

      const [pRead] = await odoo<Array<{ standard_price: number; is_storable: boolean; type: string }>>(
        'product.product',
        'read',
        { ids: [productId], fields: ['standard_price', 'is_storable', 'type'] },
      );
      assertEquals(pRead.standard_price, 75.50);
      assertEquals(pRead.is_storable, true);

      // Synthetic project
      const [prId] = await odoo<number[]>('project.project', 'create', {
        vals_list: [{ name: `${stamp} Project`, company_id: companyId }],
      });
      projectId = prId;
      assert(projectId > 0, 'synthetic project created');

      const [prRead] = await odoo<Array<{ account_id: [number, string] | false }>>(
        'project.project',
        'read',
        { ids: [projectId], fields: ['account_id'] },
      );
      assert(Array.isArray(prRead.account_id), 'project must automatically associate with an analytic account');

      // Synthetic locations
      const [locA] = await odoo<number[]>('stock.location', 'create', {
        vals_list: [{ name: `${stamp} Loc A`, usage: 'internal', location_id: parentLocId, company_id: companyId }],
      });
      locAId = locA;

      const [locB] = await odoo<number[]>('stock.location', 'create', {
        vals_list: [{ name: `${stamp} Loc B`, usage: 'internal', location_id: parentLocId, company_id: companyId }],
      });
      locBId = locB;

      assert(locAId > 0 && locBId > 0, 'synthetic locations created');
    } finally {
      if (projectId) await odoo('project.project', 'unlink', { ids: [projectId] }).catch(() => {});
      if (productId) await odoo('product.product', 'unlink', { ids: [productId] }).catch(() => {});
      if (locAId || locBId) {
        await odoo('stock.location', 'unlink', { ids: [locAId, locBId].filter(Boolean) }).catch(() => {});
      }
    }
  },
});

Deno.test({
  name: 'AC-OSP-002: full stock transfer movement (create, set quantity, validate, read back completed movement)',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const cfg = getBedConfig();
    const odoo = bindCall({ baseUrl: cfg.baseUrl, database: cfg.database, apiKey: cfg.apiKey, fetchImpl: fetch });
    const stamp = `XFER-${Date.now()}`;

    const [company] = await odoo<Array<{ id: number }>>('res.company', 'search_read', {
      domain: [],
      fields: ['id'],
      limit: 1,
    });
    const companyId = company.id;

    // Operation type for transfer/delivery
    const [pickingType] = await odoo<Array<{ id: number; default_location_src_id: [number, string]; default_location_dest_id: [number, string] }>>(
      'stock.picking.type',
      'search_read',
      { domain: [['company_id', '=', companyId], ['code', '=', 'outgoing']], fields: ['id', 'default_location_src_id', 'default_location_dest_id'], limit: 1 },
    );
    assert(pickingType, 'outgoing delivery picking type must exist');

    let productId = 0;
    let pickingId = 0;
    let moveId = 0;

    try {
      // 1. Synthetic product
      const [pId] = await odoo<number[]>('product.product', 'create', {
        vals_list: [{ name: `${stamp} Transfer Item`, is_storable: true, standard_price: 32.00 }],
      });
      productId = pId;

      const srcLocId = pickingType.default_location_src_id[0];
      const destLocId = pickingType.default_location_dest_id[0];

      // 2. Create picking
      const [pckId] = await odoo<number[]>('stock.picking', 'create', {
        vals_list: [{
          picking_type_id: pickingType.id,
          location_id: srcLocId,
          location_dest_id: destLocId,
          company_id: companyId,
        }],
      });
      pickingId = pckId;
      assert(pickingId > 0, 'stock.picking created');

      // 3. Create stock move
      const [mvId] = await odoo<number[]>('stock.move', 'create', {
        vals_list: [{
          picking_id: pickingId,
          product_id: productId,
          product_uom_qty: 8,
          location_id: srcLocId,
          location_dest_id: destLocId,
          company_id: companyId,
        }],
      });
      moveId = mvId;
      assert(moveId > 0, 'stock.move created');

      // 4. Confirm picking
      const confirmRes = await odoo<boolean>('stock.picking', 'action_confirm', { ids: [pickingId] });
      assertEquals(confirmRes, true);

      const [pStateConf] = await odoo<Array<{ state: string }>>('stock.picking', 'read', { ids: [pickingId], fields: ['state'] });
      assertEquals(pStateConf.state, 'confirmed', 'picking confirmed');

      // 5. Set completed quantity
      const writeMove = await odoo<boolean>('stock.move', 'write', {
        ids: [moveId],
        vals: { quantity: 8, picked: true },
      });
      assertEquals(writeMove, true);

      const [mStateAssigned] = await odoo<Array<{ state: string; quantity: number; picked: boolean }>>(
        'stock.move',
        'read',
        { ids: [moveId], fields: ['state', 'quantity', 'picked'] },
      );
      assertEquals(mStateAssigned.quantity, 8);
      assertEquals(mStateAssigned.picked, true);

      // 6. Validate movement
      const validateRes = await odoo<boolean>('stock.picking', 'button_validate', { ids: [pickingId] });
      assertEquals(validateRes, true, 'button_validate returns true for full completed transfer');

      // 7. Read back verified state
      const [finalPState] = await odoo<Array<{ state: string; location_id: [number, string]; location_dest_id: [number, string] }>>(
        'stock.picking',
        'read',
        { ids: [pickingId], fields: ['state', 'location_id', 'location_dest_id'] },
      );
      assertEquals(finalPState.state, 'done', 'picking transitions to done');
      assertEquals(finalPState.location_id[0], srcLocId);
      assertEquals(finalPState.location_dest_id[0], destLocId);

      const [finalMState] = await odoo<Array<{ state: string; quantity: number }>>(
        'stock.move',
        'read',
        { ids: [moveId], fields: ['state', 'quantity'] },
      );
      assertEquals(finalMState.state, 'done', 'move transitions to done');
      assertEquals(finalMState.quantity, 8, 'move records completed quantity');

      // 8. Verify destination quant
      const quants = await odoo<Array<{ location_id: [number, string]; quantity: number }>>(
        'stock.quant',
        'search_read',
        { domain: [['product_id', '=', productId], ['location_id', '=', destLocId]], fields: ['location_id', 'quantity'] },
      );
      assert(quants.length > 0, 'stock quant recorded at destination');
      assertEquals(quants[0].quantity, 8);
    } finally {
      if (productId) await odoo('product.product', 'write', { ids: [productId], vals: { active: false } }).catch(() => {});
    }
  },
});

Deno.test({
  name: 'AC-OSP-003: project issue with native project-cost link (analytic costs on creates picking_entry, off creates zero lines)',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const cfg = getBedConfig();
    const odoo = bindCall({ baseUrl: cfg.baseUrl, database: cfg.database, apiKey: cfg.apiKey, fetchImpl: fetch });
    const stamp = `ISSUE-${Date.now()}`;

    const [company] = await odoo<Array<{ id: number }>>('res.company', 'search_read', { domain: [], fields: ['id'], limit: 1 });
    const companyId = company.id;

    const [pickingType] = await odoo<Array<{ id: number; analytic_costs: boolean; default_location_src_id: [number, string]; default_location_dest_id: [number, string] }>>(
      'stock.picking.type',
      'search_read',
      { domain: [['company_id', '=', companyId], ['code', '=', 'outgoing']], fields: ['id', 'analytic_costs', 'default_location_src_id', 'default_location_dest_id'], limit: 1 },
    );
    assert(pickingType, 'outgoing delivery picking type must exist');

    const initialAnalyticCostSetting = pickingType.analytic_costs;
    const srcLocId = pickingType.default_location_src_id[0];
    const destLocId = pickingType.default_location_dest_id[0];

    let projectId = 0;
    let prodOffId = 0;
    let prodOnId = 0;

    try {
      // 1. Create project with auto-created analytic account
      const [pId] = await odoo<number[]>('project.project', 'create', {
        vals_list: [{ name: `${stamp} Project`, company_id: companyId }],
      });
      projectId = pId;

      const [proj] = await odoo<Array<{ account_id: [number, string] }>>('project.project', 'read', { ids: [projectId], fields: ['account_id'] });
      assert(Array.isArray(proj.account_id), 'project must have an analytic account');
      const analyticAccountId = proj.account_id[0];

      // 2. Synthetic products with known standard price
      const [pOff] = await odoo<number[]>('product.product', 'create', {
        vals_list: [{ name: `${stamp} Item Off`, is_storable: true, standard_price: 50.00 }],
      });
      prodOffId = pOff;

      const [pOn] = await odoo<number[]>('product.product', 'create', {
        vals_list: [{ name: `${stamp} Item On`, is_storable: true, standard_price: 120.00 }],
      });
      prodOnId = pOn;

      // --- SUBCASE A: analytic_costs = false (flag off) ---
      await odoo('stock.picking.type', 'write', { ids: [pickingType.id], vals: { analytic_costs: false } });

      const [pickOff] = await odoo<number[]>('stock.picking', 'create', {
        vals_list: [{
          picking_type_id: pickingType.id,
          location_id: srcLocId,
          location_dest_id: destLocId,
          company_id: companyId,
          project_id: projectId,
        }],
      });
      const [moveOff] = await odoo<number[]>('stock.move', 'create', {
        vals_list: [{
          picking_id: pickOff,
          product_id: prodOffId,
          product_uom_qty: 4,
          location_id: srcLocId,
          location_dest_id: destLocId,
          company_id: companyId,
        }],
      });
      await odoo('stock.picking', 'action_confirm', { ids: [pickOff] });
      await odoo('stock.move', 'write', { ids: [moveOff], vals: { quantity: 4, picked: true } });
      const valOffRes = await odoo<boolean>('stock.picking', 'button_validate', { ids: [pickOff] });
      assertEquals(valOffRes, true);

      // Verify ZERO analytic lines generated when flag is off
      const linesOff = await odoo<Array<{ id: number }>>('account.analytic.line', 'search_read', {
        domain: [['account_id', '=', analyticAccountId]],
        fields: ['id'],
      });
      assertEquals(linesOff.length, 0, 'with analytic_costs off, no native analytic cost line is created');

      // --- SUBCASE B: analytic_costs = true (flag on) ---
      await odoo('stock.picking.type', 'write', { ids: [pickingType.id], vals: { analytic_costs: true } });

      const [pickOn] = await odoo<number[]>('stock.picking', 'create', {
        vals_list: [{
          picking_type_id: pickingType.id,
          location_id: srcLocId,
          location_dest_id: destLocId,
          company_id: companyId,
          project_id: projectId,
        }],
      });
      const [pickOnRead] = await odoo<Array<{ name: string }>>('stock.picking', 'read', { ids: [pickOn], fields: ['name'] });

      const [moveOn] = await odoo<number[]>('stock.move', 'create', {
        vals_list: [{
          picking_id: pickOn,
          product_id: prodOnId,
          product_uom_qty: 2,
          location_id: srcLocId,
          location_dest_id: destLocId,
          company_id: companyId,
        }],
      });
      await odoo('stock.picking', 'action_confirm', { ids: [pickOn] });
      await odoo('stock.move', 'write', { ids: [moveOn], vals: { quantity: 2, picked: true } });
      const valOnRes = await odoo<boolean>('stock.picking', 'button_validate', { ids: [pickOn] });
      assertEquals(valOnRes, true);

      // Verify EXACT native analytic cost line created when flag is on
      const linesOn = await odoo<Array<{ id: number; name: string; amount: number; unit_amount: number; category: string; product_id: [number, string] }>>(
        'account.analytic.line',
        'search_read',
        {
          domain: [['account_id', '=', analyticAccountId]],
          fields: ['id', 'name', 'amount', 'unit_amount', 'category', 'product_id'],
        },
      );
      assertEquals(linesOn.length, 1, 'with analytic_costs on, exactly one native project cost line is created');
      const costLine = linesOn[0];
      assertEquals(costLine.name, pickOnRead.name, 'analytic line name must match picking name');
      assertEquals(costLine.category, 'picking_entry', 'analytic line category must be picking_entry');
      assertEquals(costLine.unit_amount, 2, 'analytic line unit_amount matches issued quantity');
      assertEquals(costLine.amount, -240.00, 'analytic line amount is negative product value (-1 * 2 * 120)');
      assertEquals(costLine.product_id[0], prodOnId, 'analytic line points to the issued product');
    } finally {
      // Restore initial operation type setting
      await odoo('stock.picking.type', 'write', { ids: [pickingType.id], vals: { analytic_costs: initialAnalyticCostSetting } }).catch(() => {});
      if (prodOffId) await odoo('product.product', 'write', { ids: [prodOffId], vals: { active: false } }).catch(() => {});
      if (prodOnId) await odoo('product.product', 'write', { ids: [prodOnId], vals: { active: false } }).catch(() => {});
      if (projectId) await odoo('project.project', 'write', { ids: [projectId], vals: { active: false } }).catch(() => {});
    }
  },
});

Deno.test({
  name: 'AC-OSP-002 / AC-OSP-003: failure and partial transfer validation behavior (empty, zero quantity, backorder wizard)',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const cfg = getBedConfig();
    const odoo = bindCall({ baseUrl: cfg.baseUrl, database: cfg.database, apiKey: cfg.apiKey, fetchImpl: fetch });
    const stamp = `PART-${Date.now()}`;

    const [company] = await odoo<Array<{ id: number }>>('res.company', 'search_read', { domain: [], fields: ['id'], limit: 1 });
    const companyId = company.id;

    const [pickingType] = await odoo<Array<{ id: number; default_location_src_id: [number, string]; default_location_dest_id: [number, string] }>>(
      'stock.picking.type',
      'search_read',
      { domain: [['company_id', '=', companyId], ['code', '=', 'outgoing']], fields: ['id', 'default_location_src_id', 'default_location_dest_id'], limit: 1 },
    );
    const srcLocId = pickingType.default_location_src_id[0];
    const destLocId = pickingType.default_location_dest_id[0];

    let productId = 0;
    let pickEmptyId = 0;
    let pickZeroId = 0;
    let pickPartialId = 0;
    let pickCancelId = 0;

    try {
      const [pId] = await odoo<number[]>('product.product', 'create', {
        vals_list: [{ name: `${stamp} Item`, is_storable: true, standard_price: 10.00 }],
      });
      productId = pId;

      // 1. Failure: Validating an empty picking (no moves)
      const [emptyPck] = await odoo<number[]>('stock.picking', 'create', {
        vals_list: [{ picking_type_id: pickingType.id, location_id: srcLocId, location_dest_id: destLocId, company_id: companyId }],
      });
      pickEmptyId = emptyPck;
      const emptyErr = await assertRejects(
        () => odoo('stock.picking', 'button_validate', { ids: [pickEmptyId] }),
        OdooError,
      );
      assertEquals(emptyErr.errorClass, 'validation', 'empty transfer must fail with validation error');
      assertEquals(emptyErr.status, 422);

      // 2. Failure: Validating a picking without setting quantities (demand > 0, quantity = 0)
      const [zeroPck] = await odoo<number[]>('stock.picking', 'create', {
        vals_list: [{ picking_type_id: pickingType.id, location_id: srcLocId, location_dest_id: destLocId, company_id: companyId }],
      });
      pickZeroId = zeroPck;
      await odoo('stock.move', 'create', {
        vals_list: [{ picking_id: pickZeroId, product_id: productId, product_uom_qty: 5, location_id: srcLocId, location_dest_id: destLocId, company_id: companyId }],
      });
      await odoo('stock.picking', 'action_confirm', { ids: [pickZeroId] });

      const zeroErr = await assertRejects(
        () => odoo('stock.picking', 'button_validate', { ids: [pickZeroId] }),
        OdooError,
      );
      assertEquals(zeroErr.errorClass, 'validation', 'zero quantity transfer must fail with validation error');
      assertEquals(zeroErr.status, 422);

      // 3. Partial delivery with backorder creation (demand 10, completed 6)
      const [partPck] = await odoo<number[]>('stock.picking', 'create', {
        vals_list: [{ picking_type_id: pickingType.id, location_id: srcLocId, location_dest_id: destLocId, company_id: companyId }],
      });
      pickPartialId = partPck;
      const [movePart] = await odoo<number[]>('stock.move', 'create', {
        vals_list: [{ picking_id: pickPartialId, product_id: productId, product_uom_qty: 10, location_id: srcLocId, location_dest_id: destLocId, company_id: companyId }],
      });
      await odoo('stock.picking', 'action_confirm', { ids: [pickPartialId] });
      await odoo('stock.move', 'write', { ids: [movePart], vals: { quantity: 6, picked: true } });

      interface WizardAction {
        res_model: string;
        context: Record<string, unknown>;
      }
      const partWizardRes = await odoo<WizardAction>('stock.picking', 'button_validate', { ids: [pickPartialId] });
      assertEquals(partWizardRes.res_model, 'stock.backorder.confirmation', 'partial delivery returns backorder confirmation wizard');

      // Process wizard to create backorder
      const [wizId] = await odoo<number[]>('stock.backorder.confirmation', 'create', {
        vals_list: [{}],
        context: partWizardRes.context,
      });
      const procRes = await odoo<boolean>('stock.backorder.confirmation', 'process', {
        ids: [wizId],
        context: partWizardRes.context,
      });
      assertEquals(procRes, true);

      // Verify original picking is done with 6, and backorder picking is confirmed with remaining 4
      const [partPckRead] = await odoo<Array<{ state: string }>>('stock.picking', 'read', { ids: [pickPartialId], fields: ['state'] });
      assertEquals(partPckRead.state, 'done', 'original picking is marked done');

      const backorders = await odoo<Array<{ id: number; state: string; backorder_id: [number, string]; move_ids: number[] }>>(
        'stock.picking',
        'search_read',
        { domain: [['backorder_id', '=', pickPartialId]], fields: ['id', 'state', 'backorder_id', 'move_ids'] },
      );
      assertEquals(backorders.length, 1, 'exactly one backorder picking is generated');
      assertEquals(backorders[0].state, 'confirmed', 'backorder picking is confirmed');

      const [boMove] = await odoo<Array<{ product_uom_qty: number; quantity: number }>>(
        'stock.move',
        'read',
        { ids: [backorders[0].move_ids[0]], fields: ['product_uom_qty', 'quantity'] },
      );
      assertEquals(boMove.product_uom_qty, 4, 'backorder move has remaining 4 units');

      // 4. Partial delivery without backorder (cancel backorder)
      const [cancelPck] = await odoo<number[]>('stock.picking', 'create', {
        vals_list: [{ picking_type_id: pickingType.id, location_id: srcLocId, location_dest_id: destLocId, company_id: companyId }],
      });
      pickCancelId = cancelPck;
      const [moveCancel] = await odoo<number[]>('stock.move', 'create', {
        vals_list: [{ picking_id: pickCancelId, product_id: productId, product_uom_qty: 10, location_id: srcLocId, location_dest_id: destLocId, company_id: companyId }],
      });
      await odoo('stock.picking', 'action_confirm', { ids: [pickCancelId] });
      await odoo('stock.move', 'write', { ids: [moveCancel], vals: { quantity: 4, picked: true } });

      const cancelWizardRes = await odoo<WizardAction>('stock.picking', 'button_validate', { ids: [pickCancelId] });
      assertEquals(cancelWizardRes.res_model, 'stock.backorder.confirmation');

      const [cancelWizId] = await odoo<number[]>('stock.backorder.confirmation', 'create', {
        vals_list: [{}],
        context: cancelWizardRes.context,
      });
      const cancelProcRes = await odoo<boolean>('stock.backorder.confirmation', 'process_cancel_backorder', {
        ids: [cancelWizId],
        context: cancelWizardRes.context,
      });
      assertEquals(cancelProcRes, true);

      const [cancelPckRead] = await odoo<Array<{ state: string }>>('stock.picking', 'read', { ids: [pickCancelId], fields: ['state'] });
      assertEquals(cancelPckRead.state, 'done', 'canceled-backorder picking is marked done');

      const noBackorders = await odoo<Array<{ id: number }>>(
        'stock.picking',
        'search_read',
        { domain: [['backorder_id', '=', pickCancelId]], fields: ['id'] },
      );
      assertEquals(noBackorders.length, 0, 'no backorder picking generated when cancel_backorder is processed');
    } finally {
      if (pickEmptyId) await odoo('stock.picking', 'unlink', { ids: [pickEmptyId] }).catch(() => {});
      if (pickZeroId) {
        await odoo('stock.picking', 'action_cancel', { ids: [pickZeroId] }).catch(() => {});
        await odoo('stock.picking', 'unlink', { ids: [pickZeroId] }).catch(() => {});
      }
      if (productId) await odoo('product.product', 'write', { ids: [productId], vals: { active: false } }).catch(() => {});
    }
  },
});

Deno.test({
  name: 'AC-OSP-003: whole-ledger oracle, periodic / standard',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const cfg = getBedConfig();
    const odoo = bindCall({ baseUrl: cfg.baseUrl, database: cfg.database, apiKey: cfg.apiKey, fetchImpl: fetch });
    const stamp = `ORACLE-${Date.now()}`;

    // 1. Resolve company, picking type with analytic_costs enabled, and internal/customer locations
    const companies = await odoo<Array<{ id: number; name: string; currency_id: [number, string] }>>('res.company', 'search_read', {
      domain: [],
      fields: ['id', 'name', 'currency_id'],
      limit: 1,
    });
    const company = companies[0];
    const companyId = company.id;

    const [currency] = await odoo<Array<{ name: string; rounding: number; decimal_places: number }>>('res.currency', 'read', {
      ids: [company.currency_id[0]],
      fields: ['name', 'rounding', 'decimal_places'],
    });
    assertEquals(currency.decimal_places, 2);

    const pickingTypes = await odoo<Array<{ id: number; analytic_costs: boolean }>>('stock.picking.type', 'search_read', {
      domain: [['company_id', '=', companyId], ['code', '=', 'outgoing']],
      fields: ['id', 'analytic_costs'],
      limit: 1,
    });
    assert(pickingTypes.length > 0, 'outgoing picking type must exist');
    const pickingType = pickingTypes[0];
    const initialAnalyticCostSetting = pickingType.analytic_costs;
    if (!initialAnalyticCostSetting) {
      await odoo('stock.picking.type', 'write', { ids: [pickingType.id], vals: { analytic_costs: true } });
    }

    const stockLocations = await odoo<Array<{ id: number }>>('stock.location', 'search_read', {
      domain: [['usage', '=', 'internal'], ['company_id', 'in', [companyId, false]]],
      fields: ['id'],
      limit: 1,
    });
    const parentLocId = stockLocations[0].id;
    const [srcLocId] = await odoo<number[]>('stock.location', 'create', {
      vals_list: [{ name: `${stamp} Src`, location_id: parentLocId, usage: 'internal', company_id: companyId }],
    });
    const [destLocId] = await odoo<number[]>('stock.location', 'create', {
      vals_list: [{ name: `${stamp} Dest`, usage: 'customer', company_id: companyId }],
    });

    let productId = 0;
    let projectId = 0;
    let pickingId = 0;

    const unitCost = 85.50;
    const issueQty = 4;
    const expectedCostDelta = -1 * issueQty * unitCost; // -342.00

    try {
      // 2. Create synthetic project and costed item
      const [projId] = await odoo<number[]>('project.project', 'create', {
        vals_list: [{ name: `${stamp} Project`, company_id: companyId }],
      });
      projectId = projId;

      const [projRead] = await odoo<Array<{ account_id: [number, string] }>>('project.project', 'read', {
        ids: [projectId],
        fields: ['account_id'],
      });
      assert(Array.isArray(projRead.account_id), 'project must have an associated analytic account');
      const analyticAccountId = projRead.account_id[0];

      const [prodId] = await odoo<number[]>('product.product', 'create', {
        vals_list: [{ name: `${stamp} Costed Item`, is_storable: true, standard_price: unitCost }],
      });
      productId = prodId;

      // 3. Snapshot BEFORE issue: project analytic lines and general ledger (account.move.line)
      const analyticLinesBefore = await odoo<Array<{ id: number; amount: number; unit_amount: number; name: string }>>(
        'account.analytic.line',
        'search_read',
        {
          domain: [['account_id', '=', analyticAccountId]],
          fields: ['id', 'amount', 'unit_amount', 'name'],
          limit: 100,
          offset: 0,
        },
      );
      assertEquals(analyticLinesBefore.length, 0, 'snapshot before: project starts with 0 analytic lines');

      const maxAmlBeforeRows = await odoo<Array<{ id: number }>>('account.move.line', 'search_read', {
        domain: [['company_id', '=', companyId]],
        fields: ['id'],
        order: 'id desc',
        limit: 1,
      });
      const maxAmlIdBefore = maxAmlBeforeRows.length > 0 ? maxAmlBeforeRows[0].id : 0;

      // 4. Issue known quantity from known-cost stock to the project
      const [pickId] = await odoo<number[]>('stock.picking', 'create', {
        vals_list: [{
          picking_type_id: pickingType.id,
          location_id: srcLocId,
          location_dest_id: destLocId,
          company_id: companyId,
          project_id: projectId,
          origin: `${stamp} Oracle Issue`,
        }],
      });
      pickingId = pickId;

      const [moveId] = await odoo<number[]>('stock.move', 'create', {
        vals_list: [{
          picking_id: pickingId,
          product_id: productId,
          product_uom_qty: issueQty,
          location_id: srcLocId,
          location_dest_id: destLocId,
          company_id: companyId,
        }],
      });

      await odoo('stock.picking', 'action_confirm', { ids: [pickingId] });
      await odoo('stock.move', 'write', { ids: [moveId], vals: { quantity: issueQty, picked: true } });
      const valRes = await odoo<boolean>('stock.picking', 'button_validate', { ids: [pickingId] });
      assertEquals(valRes, true, 'transfer validation must succeed');

      // 5. Read ALL affected lines after issue with pagination and source identities
      const [pickingDone] = await odoo<Array<{ id: number; name: string; state: string }>>('stock.picking', 'read', {
        ids: [pickingId],
        fields: ['id', 'name', 'state'],
      });
      assertEquals(pickingDone.state, 'done');

      // 5a. Project analytic lines after issue (paged query)
      const pageSize = 50;
      let offset = 0;
      const allAnalyticLinesAfter: Array<{ id: number; name: string; amount: number; unit_amount: number; category: string; product_id: [number, string]; move_line_id: unknown }> = [];
      while (true) {
        const page = await odoo<Array<{ id: number; name: string; amount: number; unit_amount: number; category: string; product_id: [number, string]; move_line_id: unknown }>>(
          'account.analytic.line',
          'search_read',
          {
            domain: [['account_id', '=', analyticAccountId]],
            fields: ['id', 'name', 'amount', 'unit_amount', 'category', 'product_id', 'move_line_id'],
            limit: pageSize,
            offset,
            order: 'id asc',
          },
        );
        allAnalyticLinesAfter.push(...page);
        if (page.length < pageSize) break;
        offset += pageSize;
      }

      // Assert signed delta in project cost equals native valued issue exactly once
      assertEquals(allAnalyticLinesAfter.length, 1, 'exactly one project analytic line created for the issue');
      const costLine = allAnalyticLinesAfter[0];
      assertEquals(costLine.name, pickingDone.name, 'analytic line source name matches picking name');
      assertEquals(costLine.category, 'picking_entry', 'analytic line category is native picking_entry');
      assertEquals(costLine.unit_amount, issueQty, 'analytic line unit_amount matches issued quantity');
      assertEquals(costLine.amount, expectedCostDelta, 'analytic line signed cost equals -1 * issue_qty * unit_cost exactly once');
      assertEquals(costLine.product_id[0], productId, 'analytic line points to synthetic product');

      // 5b. Stock movement & inventory lines
      const [moveDone] = await odoo<Array<{ id: number; state: string; quantity: number; value: number }>>('stock.move', 'read', {
        ids: [moveId],
        fields: ['id', 'state', 'quantity', 'value'],
      });
      assertEquals(moveDone.state, 'done');
      assertEquals(moveDone.quantity, issueQty);
      assertEquals(moveDone.value, expectedCostDelta, 'stock move value records native valuation decrease (-1 * qty * unit_cost)');

      // 5c. General ledger (account.move.line) paged inspection
      let amlOffset = 0;
      const newAmls: Array<{ id: number; name: string; debit: number; credit: number; balance: number; analytic_line_ids: number[] }> = [];
      while (true) {
        const amlPage = await odoo<Array<{ id: number; name: string; debit: number; credit: number; balance: number; analytic_line_ids: number[] }>>(
          'account.move.line',
          'search_read',
          {
            domain: [['company_id', '=', companyId], ['id', '>', maxAmlIdBefore]],
            fields: ['id', 'name', 'debit', 'credit', 'balance', 'analytic_line_ids'],
            limit: pageSize,
            offset: amlOffset,
            order: 'id asc',
          },
        );
        newAmls.push(...amlPage);
        if (amlPage.length < pageSize) break;
        amlOffset += pageSize;
      }

      // Bed configuration: property_valuation is 'periodic', so no automated GL lines are generated on stock moves.
      // Even if automated valuation was active, GL entries are the balance-sheet/inventory accounting side, NOT duplicate project expense.
      for (const aml of newAmls) {
        assert(
          !aml.analytic_line_ids || !aml.analytic_line_ids.includes(costLine.id),
          'GL move lines must not double-count the project analytic line',
        );
      }
      assertEquals(newAmls.length, 0, 'under periodic valuation on bed, 0 unexpected GL entries are created during stock move');

      // 6. Repeat recovery read-back and assert no added project cost
      const repeatAnalyticLines = await odoo<Array<{ id: number; amount: number }>>(
        'account.analytic.line',
        'search_read',
        {
          domain: [['account_id', '=', analyticAccountId]],
          fields: ['id', 'amount'],
          limit: 100,
        },
      );
      assertEquals(repeatAnalyticLines.length, 1, 'repeat read-back proves no duplicate analytic lines');
      const totalAnalyticCost = repeatAnalyticLines.reduce((acc, l) => acc + l.amount, 0);
      assertEquals(totalAnalyticCost, expectedCostDelta, 'total project cost remains exactly one valued issue');

      const repeatAmls = await odoo<Array<{ id: number }>>('account.move.line', 'search_read', {
        domain: [['company_id', '=', companyId], ['id', '>', maxAmlIdBefore]],
        fields: ['id'],
        limit: 10,
      });
      assertEquals(repeatAmls.length, 0, 'repeat read-back proves no additional GL entries');
    } finally {
      if (!initialAnalyticCostSetting) {
        await odoo('stock.picking.type', 'write', { ids: [pickingType.id], vals: { analytic_costs: initialAnalyticCostSetting } }).catch(() => {});
      }
      if (projectId) await odoo('project.project', 'write', { ids: [projectId], vals: { active: false } }).catch(() => {});
      if (productId) await odoo('product.product', 'write', { ids: [productId], vals: { active: false } }).catch(() => {});
      if (srcLocId || destLocId) await odoo('stock.location', 'write', { ids: [srcLocId, destLocId], vals: { active: false } }).catch(() => {});
    }
  },
});

Deno.test({
  name: 'AC-OSP-003: whole-ledger oracle, real_time / standard',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const cfg = getBedConfig();
    const odoo = bindCall({ baseUrl: cfg.baseUrl, database: cfg.database, apiKey: cfg.apiKey, fetchImpl: fetch });
    const stamp = `RT-STD-${Date.now()}`;
    const companyId = 1;

    let categId = 0;
    let productId = 0;
    let projectId = 0;
    let locSrcId = 0;
    let locDestId = 0;

    const unitCost = 90.00;
    const issueQtyOn = 3;
    const expectedCostOn = -1 * issueQtyOn * unitCost; // -270.00

    try {
      // 1. Synthetic product category with real_time valuation and standard costing
      const [cId] = await odoo<number[]>('product.category', 'create', {
        vals_list: [{
          name: `${stamp} Category`,
          property_valuation: 'real_time',
          property_cost_method: 'standard',
          property_stock_journal: 14, // Inventory Valuation STJ
          property_stock_valuation_account_id: 66, // Inventory (11300180)
          property_account_expense_categ_id: 152, // Cost of Goods Sold (51000010)
          property_account_income_categ_id: 140, // Interim Stock (29000000)
        }],
      });
      categId = cId;

      // 2. Synthetic project with analytic account
      const [prId] = await odoo<number[]>('project.project', 'create', {
        vals_list: [{ name: `${stamp} Project`, company_id: companyId }],
      });
      projectId = prId;
      const [proj] = await odoo<Array<{ account_id: [number, string] }>>('project.project', 'read', {
        ids: [projectId],
        fields: ['account_id'],
      });
      assert(Array.isArray(proj.account_id), 'project must have an analytic account');
      const analyticAccountId = proj.account_id[0];

      // 3. Synthetic product under synthetic category
      const [pId] = await odoo<number[]>('product.product', 'create', {
        vals_list: [{
          name: `${stamp} Item`,
          categ_id: categId,
          is_storable: true,
          standard_price: unitCost,
        }],
      });
      productId = pId;

      // 4. Locations: internal source and customer destination with valuation_account_id
      const stockLocations = await odoo<Array<{ id: number }>>('stock.location', 'search_read', {
        domain: [['usage', '=', 'internal'], ['company_id', 'in', [companyId, false]]],
        fields: ['id'],
        limit: 1,
      });
      const parentLocId = stockLocations[0].id;
      const [lSrc] = await odoo<number[]>('stock.location', 'create', {
        vals_list: [{ name: `${stamp} Stock`, location_id: parentLocId, usage: 'internal', company_id: companyId }],
      });
      locSrcId = lSrc;

      const [lDest] = await odoo<number[]>('stock.location', 'create', {
        vals_list: [{
          name: `${stamp} Dest`,
          usage: 'customer',
          company_id: companyId,
          valuation_account_id: 152, // COGS account triggers real_time valuation entry
        }],
      });
      locDestId = lDest;

      // --- SUBCASE 1: Project-cost setting ON (analytic_costs: true) ---
      await odoo('stock.picking.type', 'write', { ids: [2], vals: { analytic_costs: true } });

      // Snapshot BEFORE issue
      const analyticBefore = await odoo<Array<{ id: number }>>('account.analytic.line', 'search_read', {
        domain: [['account_id', '=', analyticAccountId]],
        fields: ['id'],
      });
      assertEquals(analyticBefore.length, 0, 'project starts with 0 analytic lines');

      const maxAmlBefore = await odoo<Array<{ id: number }>>('account.move.line', 'search_read', {
        domain: [['company_id', '=', companyId]],
        fields: ['id'],
        order: 'id desc',
        limit: 1,
      });
      const maxAmlIdBefore = maxAmlBefore.length > 0 ? maxAmlBefore[0].id : 0;

      // Issue 3 units
      const [pickOn] = await odoo<number[]>('stock.picking', 'create', {
        vals_list: [{
          picking_type_id: 2,
          location_id: locSrcId,
          location_dest_id: locDestId,
          company_id: companyId,
          project_id: projectId,
          origin: `${stamp} On Issue`,
        }],
      });
      const [moveOn] = await odoo<number[]>('stock.move', 'create', {
        vals_list: [{
          picking_id: pickOn,
          product_id: productId,
          product_uom_qty: issueQtyOn,
          location_id: locSrcId,
          location_dest_id: locDestId,
          company_id: companyId,
        }],
      });

      await odoo('stock.picking', 'action_confirm', { ids: [pickOn] });
      await odoo('stock.move', 'write', { ids: [moveOn], vals: { quantity: issueQtyOn, picked: true } });
      const valOnRes = await odoo<boolean>('stock.picking', 'button_validate', { ids: [pickOn] });
      assertEquals(valOnRes, true);

      // Verify stock move state and automated account move link
      const [moveOnRead] = await odoo<Array<{ state: string; value: number; account_move_id: [number, string] | false }>>(
        'stock.move',
        'read',
        { ids: [moveOn], fields: ['state', 'value', 'account_move_id'] },
      );
      assertEquals(moveOnRead.state, 'done');
      assertEquals(moveOnRead.value, expectedCostOn);
      assert(Array.isArray(moveOnRead.account_move_id), 'under real_time valuation, move must be linked to an account.move');

      // List EVERY new journal line created for this issue
      const amlsOn = await odoo<Array<{ id: number; name: string; account_id: [number, string]; debit: number; credit: number; balance: number; analytic_distribution: unknown; analytic_line_ids: number[] }>>(
        'account.move.line',
        'search_read',
        {
          domain: [['company_id', '=', companyId], ['id', '>', maxAmlIdBefore]],
          fields: ['id', 'name', 'account_id', 'debit', 'credit', 'balance', 'analytic_distribution', 'analytic_line_ids'],
          order: 'id asc',
        },
      );
      assertEquals(amlsOn.length, 2, 'automated valuation creates exactly 2 GL move lines (Inventory + COGS)');
      const creditLine = amlsOn.find((l) => l.credit > 0)!;
      const debitLine = amlsOn.find((l) => l.debit > 0)!;
      assertEquals(creditLine.account_id[0], 66, 'credit account is Stock Valuation (Inventory)');
      assertEquals(creditLine.credit, -1 * expectedCostOn);
      assertEquals(creditLine.analytic_distribution, false, 'automated valuation GL line has no analytic distribution');
      assertEquals(debitLine.account_id[0], 152, 'debit account is Cost of Goods Sold');
      assertEquals(debitLine.debit, -1 * expectedCostOn);
      assertEquals(debitLine.analytic_distribution, false, 'automated valuation GL line has no analytic distribution');

      // List EVERY new analytic line created for the project
      const analyticOn = await odoo<Array<{ id: number; name: string; amount: number; unit_amount: number; category: string; product_id: [number, string]; move_line_id: unknown }>>(
        'account.analytic.line',
        'search_read',
        {
          domain: [['account_id', '=', analyticAccountId]],
          fields: ['id', 'name', 'amount', 'unit_amount', 'category', 'product_id', 'move_line_id'],
        },
      );
      assertEquals(analyticOn.length, 1, 'under real_time valuation, project receives cost exactly ONCE (from picking_entry, NOT duplicated by GL)');
      const costLineOn = analyticOn[0];
      assertEquals(costLineOn.category, 'picking_entry');
      assertEquals(costLineOn.amount, expectedCostOn);
      assertEquals(costLineOn.unit_amount, issueQtyOn);
      assertEquals(costLineOn.move_line_id, false, 'analytic line is born from stock picking, not GL line');

      const totalCostOn = analyticOn.reduce((sum, l) => sum + l.amount, 0);
      assertEquals(totalCostOn, expectedCostOn, 'total project cost change equals quantity x unit cost exactly once');

      // --- SUBCASE 2: Project-cost setting OFF (analytic_costs: false) under real_time ---
      await odoo('stock.picking.type', 'write', { ids: [2], vals: { analytic_costs: false } });

      const maxAmlBeforeOff = await odoo<Array<{ id: number }>>('account.move.line', 'search_read', {
        domain: [['company_id', '=', companyId]],
        fields: ['id'],
        order: 'id desc',
        limit: 1,
      });
      const maxAmlIdBeforeOff = maxAmlBeforeOff.length > 0 ? maxAmlBeforeOff[0].id : 0;

      const issueQtyOff = 2;
      const [pickOff] = await odoo<number[]>('stock.picking', 'create', {
        vals_list: [{
          picking_type_id: 2,
          location_id: locSrcId,
          location_dest_id: locDestId,
          company_id: companyId,
          project_id: projectId,
          origin: `${stamp} Off Issue`,
        }],
      });
      const [moveOff] = await odoo<number[]>('stock.move', 'create', {
        vals_list: [{
          picking_id: pickOff,
          product_id: productId,
          product_uom_qty: issueQtyOff,
          location_id: locSrcId,
          location_dest_id: locDestId,
          company_id: companyId,
        }],
      });

      await odoo('stock.picking', 'action_confirm', { ids: [pickOff] });
      await odoo('stock.move', 'write', { ids: [moveOff], vals: { quantity: issueQtyOff, picked: true } });
      await odoo('stock.picking', 'button_validate', { ids: [pickOff] });

      // GL entry is still generated because category is real_time
      const amlsOff = await odoo<Array<{ id: number; name: string; debit: number; credit: number; analytic_distribution: unknown }>>(
        'account.move.line',
        'search_read',
        {
          domain: [['company_id', '=', companyId], ['id', '>', maxAmlIdBeforeOff]],
          fields: ['id', 'name', 'debit', 'credit', 'analytic_distribution'],
        },
      );
      assertEquals(amlsOff.length, 2, 'automated GL entry is posted for movement');
      for (const aml of amlsOff) {
        assertEquals(aml.analytic_distribution, false);
      }

      // But project analytic lines are NOT created (setting OFF leaves project cost unchanged)
      const analyticOff = await odoo<Array<{ id: number; amount: number }>>('account.analytic.line', 'search_read', {
        domain: [['account_id', '=', analyticAccountId]],
        fields: ['id', 'amount'],
      });
      assertEquals(analyticOff.length, 1, 'no second analytic line added when analytic_costs is off; project gets nothing from GL entry');
      assertEquals(analyticOff[0].id, costLineOn.id);
    } finally {
      await odoo('stock.picking.type', 'write', { ids: [2], vals: { analytic_costs: true } }).catch(() => {});
      if (projectId) await odoo('project.project', 'write', { ids: [projectId], vals: { active: false } }).catch(() => {});
      if (productId) await odoo('product.product', 'write', { ids: [productId], vals: { active: false } }).catch(() => {});
      if (locSrcId || locDestId) await odoo('stock.location', 'write', { ids: [locSrcId, locDestId], vals: { active: false } }).catch(() => {});
      if (categId) await odoo('product.category', 'unlink', { ids: [categId] }).catch(() => {});
    }
  },
});

Deno.test({
  name: 'AC-OSP-003: whole-ledger oracle, real_time / average (AVCO)',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const cfg = getBedConfig();
    const odoo = bindCall({ baseUrl: cfg.baseUrl, database: cfg.database, apiKey: cfg.apiKey, fetchImpl: fetch });
    const stamp = `RT-AVCO-${Date.now()}`;
    const companyId = 1;

    let categId = 0;
    let productId = 0;
    let projectId = 0;
    let po1Id = 0;
    let po2Id = 0;
    let locCustId = 0;

    try {
      // 1. Synthetic product category with real_time valuation and average costing (AVCO)
      const [cId] = await odoo<number[]>('product.category', 'create', {
        vals_list: [{
          name: `${stamp} Category`,
          property_valuation: 'real_time',
          property_cost_method: 'average',
          property_stock_journal: 14, // Inventory Valuation STJ
          property_stock_valuation_account_id: 66, // Inventory
          property_account_expense_categ_id: 152, // Cost of Goods Sold
          property_account_income_categ_id: 140, // Interim Stock
        }],
      });
      categId = cId;

      // 2. Synthetic project with analytic account
      const [prId] = await odoo<number[]>('project.project', 'create', {
        vals_list: [{ name: `${stamp} Project`, company_id: companyId }],
      });
      projectId = prId;
      const [proj] = await odoo<Array<{ account_id: [number, string] }>>('project.project', 'read', {
        ids: [projectId],
        fields: ['account_id'],
      });
      assert(Array.isArray(proj.account_id), 'project must have an analytic account');
      const analyticAccountId = proj.account_id[0];

      // 3. Synthetic product initialized with standard_price = 0.0
      const [pId] = await odoo<number[]>('product.product', 'create', {
        vals_list: [{
          name: `${stamp} AVCO Item`,
          categ_id: categId,
          is_storable: true,
          standard_price: 0.0,
        }],
      });
      productId = pId;

      // Resolve vendor partner and internal stock location
      const partners = await odoo<Array<{ id: number }>>('res.partner', 'search_read', {
        domain: [['supplier_rank', '>', 0]],
        fields: ['id'],
        limit: 1,
      });
      const partnerId = partners.length > 0 ? partners[0].id : 1;

      const stockLocations = await odoo<Array<{ id: number }>>('stock.location', 'search_read', {
        domain: [['usage', '=', 'internal'], ['company_id', 'in', [companyId, false]]],
        fields: ['id'],
        limit: 1,
      });
      const internalLocId = stockLocations[0].id;

      // Synthetic customer destination location with valuation_account_id (triggers real_time COGS move)
      const [lCust] = await odoo<number[]>('stock.location', 'create', {
        vals_list: [{
          name: `${stamp} Dest`,
          usage: 'customer',
          company_id: companyId,
          valuation_account_id: 152,
        }],
      });
      locCustId = lCust;

      // 4. Receive at two different purchase prices so average cost is non-trivial
      // Receipt 1: 10 units @ 100.00
      const [po1] = await odoo<number[]>('purchase.order', 'create', {
        vals_list: [{
          partner_id: partnerId,
          company_id: companyId,
          order_line: [[0, 0, { product_id: productId, product_qty: 10, price_unit: 100.00 }]],
        }],
      });
      po1Id = po1;
      await odoo('purchase.order', 'button_confirm', { ids: [po1Id] });
      const pick1 = await odoo<Array<{ id: number; move_ids: number[] }>>('stock.picking', 'search_read', {
        domain: [['purchase_id', '=', po1Id]],
        fields: ['id', 'move_ids'],
      });
      await odoo('stock.move', 'write', { ids: [pick1[0].move_ids[0]], vals: { quantity: 10, picked: true } });
      await odoo('stock.picking', 'button_validate', { ids: [pick1[0].id] });

      const [pRead1] = await odoo<Array<{ standard_price: number }>>('product.product', 'read', {
        ids: [productId],
        fields: ['standard_price'],
      });
      assertEquals(pRead1.standard_price, 100.00, 'product standard_price after first receipt is 100.00');

      // Receipt 2: 10 units @ 200.00
      const [po2] = await odoo<number[]>('purchase.order', 'create', {
        vals_list: [{
          partner_id: partnerId,
          company_id: companyId,
          order_line: [[0, 0, { product_id: productId, product_qty: 10, price_unit: 200.00 }]],
        }],
      });
      po2Id = po2;
      await odoo('purchase.order', 'button_confirm', { ids: [po2Id] });
      const pick2 = await odoo<Array<{ id: number; move_ids: number[] }>>('stock.picking', 'search_read', {
        domain: [['purchase_id', '=', po2Id]],
        fields: ['id', 'move_ids'],
      });
      await odoo('stock.move', 'write', { ids: [pick2[0].move_ids[0]], vals: { quantity: 10, picked: true } });
      await odoo('stock.picking', 'button_validate', { ids: [pick2[0].id] });

      const [pRead2] = await odoo<Array<{ standard_price: number }>>('product.product', 'read', {
        ids: [productId],
        fields: ['standard_price'],
      });
      assertEquals(pRead2.standard_price, 150.00, 'product standard_price after second receipt is AVCO average (10*100 + 10*200)/20 = 150.00');

      // 5. Snapshot BEFORE issue: project analytic lines and general ledger
      const analyticBefore = await odoo<Array<{ id: number }>>('account.analytic.line', 'search_read', {
        domain: [['account_id', '=', analyticAccountId]],
        fields: ['id'],
      });
      assertEquals(analyticBefore.length, 0, 'snapshot before: project starts with 0 analytic lines');

      const maxAmlBefore = await odoo<Array<{ id: number }>>('account.move.line', 'search_read', {
        domain: [['company_id', '=', companyId]],
        fields: ['id'],
        order: 'id desc',
        limit: 1,
      });
      const maxAmlIdBefore = maxAmlBefore.length > 0 ? maxAmlBefore[0].id : 0;

      // 6. Issue 5 units from AVCO stock to the project
      const issueQty = 5;
      const expectedAvcoUnitCost = 150.00;
      const expectedTotalCost = -1 * issueQty * expectedAvcoUnitCost; // -750.00

      const [outPick] = await odoo<number[]>('stock.picking', 'create', {
        vals_list: [{
          picking_type_id: 2,
          location_id: internalLocId,
          location_dest_id: locCustId,
          company_id: companyId,
          project_id: projectId,
          origin: `${stamp} Issue`,
        }],
      });
      const [outMove] = await odoo<number[]>('stock.move', 'create', {
        vals_list: [{
          picking_id: outPick,
          product_id: productId,
          product_uom_qty: issueQty,
          location_id: internalLocId,
          location_dest_id: locCustId,
          company_id: companyId,
        }],
      });

      await odoo('stock.picking', 'action_confirm', { ids: [outPick] });
      await odoo('stock.move', 'write', { ids: [outMove], vals: { quantity: issueQty, picked: true } });
      const valRes = await odoo<boolean>('stock.picking', 'button_validate', { ids: [outPick] });
      assertEquals(valRes, true);

      // Verify stock move value
      const [outMoveRead] = await odoo<Array<{ state: string; value: number; account_move_id: [number, string] | false }>>(
        'stock.move',
        'read',
        { ids: [outMove], fields: ['state', 'value', 'account_move_id'] },
      );
      assertEquals(outMoveRead.state, 'done');
      assertEquals(outMoveRead.value, expectedTotalCost, 'stock move value records native AVCO valuation decrease (-1 * 5 * 150.00)');
      assert(Array.isArray(outMoveRead.account_move_id), 'move must be linked to automated account.move');

      // List EVERY new journal line created for this issue
      const newAmls = await odoo<Array<{ id: number; name: string; account_id: [number, string]; debit: number; credit: number; balance: number; analytic_distribution: unknown; analytic_line_ids: number[] }>>(
        'account.move.line',
        'search_read',
        {
          domain: [['company_id', '=', companyId], ['id', '>', maxAmlIdBefore]],
          fields: ['id', 'name', 'account_id', 'debit', 'credit', 'balance', 'analytic_distribution', 'analytic_line_ids'],
          order: 'id asc',
        },
      );
      assertEquals(newAmls.length, 2, 'automated valuation creates 2 GL lines (Inventory + COGS)');
      const creditAml = newAmls.find((l) => l.credit > 0)!;
      const debitAml = newAmls.find((l) => l.debit > 0)!;
      assertEquals(creditAml.account_id[0], 66, 'credit account is Inventory');
      assertEquals(creditAml.credit, -1 * expectedTotalCost);
      assertEquals(creditAml.analytic_distribution, false);
      assertEquals(debitAml.account_id[0], 152, 'debit account is COGS');
      assertEquals(debitAml.debit, -1 * expectedTotalCost);
      assertEquals(debitAml.analytic_distribution, false);

      // List EVERY new analytic line created for the project
      const analyticAfter = await odoo<Array<{ id: number; name: string; amount: number; unit_amount: number; category: string; product_id: [number, string]; move_line_id: unknown }>>(
        'account.analytic.line',
        'search_read',
        {
          domain: [['account_id', '=', analyticAccountId]],
          fields: ['id', 'name', 'amount', 'unit_amount', 'category', 'product_id', 'move_line_id'],
        },
      );
      assertEquals(analyticAfter.length, 1, 'project receives cost exactly ONCE under AVCO real_time valuation');
      const costLine = analyticAfter[0];
      assertEquals(costLine.category, 'picking_entry');
      assertEquals(costLine.amount, expectedTotalCost);
      assertEquals(costLine.unit_amount, issueQty);
      assertEquals(costLine.move_line_id, false);

      const totalCost = analyticAfter.reduce((sum, l) => sum + l.amount, 0);
      assertEquals(totalCost, expectedTotalCost, 'total project cost equals quantity x AVCO unit cost exactly once');
    } finally {
      if (projectId) await odoo('project.project', 'write', { ids: [projectId], vals: { active: false } }).catch(() => {});
      if (productId) await odoo('product.product', 'write', { ids: [productId], vals: { active: false } }).catch(() => {});
      if (locCustId) await odoo('stock.location', 'write', { ids: [locCustId], vals: { active: false } }).catch(() => {});
      if (categId) await odoo('product.category', 'unlink', { ids: [categId] }).catch(() => {});
    }
  },
});
