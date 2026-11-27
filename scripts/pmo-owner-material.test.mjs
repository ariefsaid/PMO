/**
 * Unit tests for owner-supplied material workbook loader (AC-001, AC-002 transport, Contract v2 + v1.1).
 *
 * Runs against a fake HTTP/RPC transport honoring the frozen contract of `om_material_config`,
 * `om_material_import`, and `import_work_orders`. No database required.
 *
 * Run: node --test scripts/pmo-owner-material.test.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  MATERIAL_LOAD_RPCS,
  MATERIAL_SCHEMA_VERSION,
  MaterialLoadError,
  MaterialOutcomeUnknown,
  buildSectionEntity,
  runMaterialLoad,
  validateMapping,
} from './lib/pmo-owner-material.mjs';
import { run, writeCredentials } from './pmo.mjs';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pmo-om-test-'));

const ZERO_COST_TAG_ID = '33333333-3333-4333-8333-333333333333';

function baseMapping(overrides = {}) {
  return {
    source_key: 'syn-source-v2',
    as_of: '2026-01-31',
    zero_cost_tag_name: 'Owner Supplied Material',
    reconciliation_scale: [
      { name: 'Prepared', position: 1, percentage: 20 },
      { name: 'Closed', position: 2, percentage: 100 },
    ],
    policy: { closing_conflict: 'refuse' },
    work_order_defaults: {
      tax_treatment: 'exclusive',
      tax_amount: '0',
      order_value: '0',
      currency: 'IDR',
    },
    owner_warehouses: {
      'WH NORTH': { code: 'WH-N', name: 'North Warehouse' },
    },
    workbook: {
      location_sheet: {
        header_contains: ['PART_NO', 'PART_DESC'],
        warehouse_band: {
          single_row_after_fields: ['reservation_date', 'request_date'],
          end_field: 'total_set_aside',
        },
        columns: {
          item_code: ['PART_NO'],
          description: ['PART_DESC'],
          unit: ['UNIT'],
          planned: ['PLAN_QTY'],
          category_code: ['CAT_CODE'],
          order_number: ['ORDER_NO'],
          cost_code: ['COST_CODE'],
          total_set_aside: ['HOLD_TOTAL'],
          received_direct: ['RECV_DIRECT'],
          received_transfer_in: ['RECV_XFER'],
          total_received: ['RECV_TOTAL'],
          issued: ['ISSUE_QTY'],
          returned: ['RET_QTY'],
          transfer_out: ['XFER_OUT_QTY'],
          closing: ['END_BAL'],
        },
        evidence_columns: {
          request_reference: ['REQ_REF'],
          request_date: ['REQ_DATE'],
          reservation_date: ['HOLD_DATE'],
          reservation_reference: ['HOLD_REF'],
          received_date: ['RECV_DATE'],
          issue_reference: ['ISSUE_REF'],
          issued_date: ['ISSUE_DATE'],
          returned_date: ['RET_DATE'],
          transfer_out_date: ['XFER_OUT_DATE'],
        },
      },
    },
    sheets: {},
    ...overrides,
  };
}

function sampleParsed(overrides = {}) {
  return {
    source_digest: 'a'.repeat(64),
    policy: { closing_conflict: 'refuse' },
    catalogue: {
      items: [
        { code: '001001', name: 'Synthetic Pipe', unit: 'PCS' },
        { code: '001002', name: 'Synthetic Valve', unit: 'EA' },
      ],
      categories: [{ code: 'CAT-A', name: 'Category Alpha' }],
      owner_warehouses: [{ code: 'WH-N', name: 'North Warehouse' }],
    },
    reconciliation_scale: [
      { name: 'Prepared', position: 1, percentage: 20 },
      { name: 'Closed', position: 2, percentage: 100 },
    ],
    accepted_sections: [
      {
        sheet: 'LOC_ONE',
        header_row: 7,
        owner_order_number: 'WO-SYN-100',
        location_name: 'LOC_ONE',
        owner_cost_code: 'CC-100',
        title: 'Synthetic Pipeline Package',
        as_of: '2026-01-31',
        closing_conflict: 'refuse',
        receiving_location_code: 'SITE-A',
        reconciliation_step: 'Prepared',
        lines: [
          {
            row: 8,
            item_code: '001001',
            item_name: 'Synthetic Pipe',
            unit: 'PCS',
            category_code: 'CAT-A',
            planned: '10',
            opening: {
              requested: '10',
              set_aside: '10',
              received: '10',
              issued: '6',
              returned: '1',
              transfer_in: '0',
              transfer_out: '0',
              owner_return: '2',
            },
            evidence: {
              request_reference: 'REQ-1',
              owner_warehouses: { 'WH-N': '10' },
            },
            expected: { closing: '3' },
          },
        ],
        policy_flags: { closing_conflicts: [], negative_closings: [] },
      },
      {
        sheet: 'LOC_TWO',
        header_row: 7,
        owner_order_number: 'WO-SYN-100',
        location_name: 'LOC_TWO',
        owner_cost_code: 'CC-101',
        title: 'Synthetic Pipeline Package',
        as_of: '2026-01-31',
        closing_conflict: 'refuse',
        receiving_location_code: 'SITE-A',
        reconciliation_step: 'Closed',
        lines: [
          {
            row: 8,
            item_code: '001002',
            item_name: 'Synthetic Valve',
            unit: 'EA',
            category_code: 'CAT-A',
            planned: '5',
            opening: {
              requested: '5',
              set_aside: '5',
              received: '5',
              issued: '0',
              returned: '0',
              transfer_in: '0',
              transfer_out: '0',
              owner_return: '0',
            },
            evidence: { owner_warehouses: { 'WH-N': '5' } },
            expected: { closing: '5' },
          },
        ],
        policy_flags: { closing_conflicts: [], negative_closings: [] },
      },
    ],
    refused_sections: [],
    validation_sheets: ['ITEM_CATALOG'],
    excluded_sheets: ['BLANK_TEMPLATE'],
    unmapped_sheets: [],
    ...overrides,
  };
}

/** Stateful fake transport honoring om_material_config, om_material_import (v2), and import_work_orders. */
function makeFakeTransport(initial = {}) {
  const workOrders = [...(initial.workOrders ?? [])];
  const savedHashes = new Map(); // `${source_key}|${entity_key}` -> { hash, planned }
  const calls = [];
  let nextWoSeq = 1;

  return {
    calls,
    workOrders,
    savedHashes,
    async get(table, query) {
      calls.push({ kind: 'get', table, query });
      if (table === 'work_orders') {
        const params = new URLSearchParams(query);
        const offset = Number(params.get('offset') ?? 0);
        const limit = Number(params.get('limit') ?? 500);
        return workOrders.slice(offset, offset + limit);
      }
      return [];
    },
    async rpc(name, body) {
      calls.push({ kind: 'rpc', name, body });
      if (initial.onRpc) {
        const override = await initial.onRpc(name, body, { calls, workOrders, savedHashes });
        if (override !== undefined) return override;
      }
      if (name === 'om_material_config') {
        return {
          categories: [],
          owner_warehouses: [],
          steps: initial.steps ?? [
            { id: 'step-1', name: 'Prepared', position: 1, percentage: '20' },
            { id: 'step-2', name: 'Closed', position: 2, percentage: '100' },
          ],
          zero_cost_tags: initial.zeroCostTags ?? [{ id: ZERO_COST_TAG_ID, name: 'Owner Supplied Material' }],
        };
      }
      if (name === 'om_material_set_scale') {
        return { count: body.p_steps.length };
      }
      if (name === 'import_work_orders') {
        const ids = [];
        for (const r of body.p_rows) {
          const id = `00000000-0000-4000-8000-${String(nextWoSeq++).padStart(12, '0')}`;
          workOrders.push({
            id,
            wo_number: null,
            client_po_number: r.client_po_number,
            title: r.title,
            status: 'Draft',
          });
          ids.push(id);
        }
        return { created: ids.length, lines: 0, ids };
      }
      if (name === 'om_material_import') {
        const { p_source_key: sk, p_payload: payload, p_confirm: confirm } = body;
        const results = [];
        let complete = true;
        if (payload.kind === 'catalogue') {
          for (const e of payload.entities) {
            const k = `${sk}|${e.entity_key}`;
            const prev = savedHashes.get(k);
            if (prev && prev.hash === e.hash) {
              results.push({ entity_key: e.entity_key, status: 'skip', ids: {} });
            } else {
              if (confirm) savedHashes.set(k, { hash: e.hash });
              results.push({ entity_key: e.entity_key, status: prev ? 'update' : 'create', ids: {} });
            }
          }
        } else if (payload.kind === 'section') {
          for (const sec of payload.entities) {
            const wo = workOrders.find(
              (w) => w.wo_number === sec.owner_order_number || w.client_po_number === sec.owner_order_number,
            );
            if (!wo) {
              results.push({
                entity_key: sec.entity_key,
                status: 'refused',
                reason_code: 'material-work-order-missing',
                reason: `Work order '${sec.owner_order_number}' does not exist in this project`,
                sheet: sec.sheet,
                row: sec.row,
                ids: {},
              });
              complete = false;
              continue;
            }
            if (wo.status !== 'Draft' && wo.status !== 'Issued') {
              results.push({
                entity_key: sec.entity_key,
                status: 'refused',
                reason_code: 'material-conflict',
                reason: `Work order '${sec.owner_order_number}' is in closed state '${wo.status}'`,
                sheet: sec.sheet,
                row: sec.row,
                ids: { work_order_id: wo.id },
              });
              complete = false;
              continue;
            }
            for (const line of sec.lines) {
              const k = `${sk}|${line.entity_key}`;
              const prev = savedHashes.get(k);
              if (prev && prev.hash === line.hash) {
                results.push({
                  entity_key: line.entity_key,
                  status: 'skip',
                  ids: { work_order_id: wo?.id ?? null },
                  sheet: sec.sheet,
                  row: line.row,
                });
              } else {
                if (confirm) savedHashes.set(k, { hash: line.hash, planned: line.planned });
                results.push({
                  entity_key: line.entity_key,
                  status: prev ? 'update' : 'create',
                  before: prev ? { planned: prev.planned } : undefined,
                  after: { planned: line.planned },
                  ids: { work_order_id: wo?.id ?? null },
                  sheet: sec.sheet,
                  row: line.row,
                });
              }
            }
          }
        }
        return {
          batch_id: confirm ? '22222222-2222-4222-8222-222222222222' : null,
          results,
          complete,
        };
      }
      throw new Error(`Unexpected RPC ${name}`);
    },
  };
}

test('AC-001: two locations sharing one missing work order preview, confirm once, and second run skips everything', async () => {
  const transport = makeFakeTransport();
  const parsed = sampleParsed();
  const mapping = baseMapping();

  // 1. Default preview: writes nothing, lists 1 work order to create, 2 sections
  const preview = await runMaterialLoad(
    {
      workbookPath: '/fake/wb.xlsx',
      mappingPath: '/fake/map.json',
      mapping,
      projectId: PROJECT_ID,
      confirm: false,
      parseWorkbook: async () => parsed,
    },
    transport,
  );
  assert.equal(preview.exit, 0);
  assert.equal(preview.report.mode, 'preview');
  assert.equal(preview.report.work_orders.to_create_count, 1);
  assert.equal(preview.report.work_orders.created, 0);
  assert.equal(transport.workOrders.length, 0, 'preview must not create work orders');
  assert.equal(transport.savedHashes.size, 0, 'preview must not write material openings');
  assert.equal(preview.report.suggested_stock_openings.length, 2);

  // 2. Confirm: creates 1 Draft work order via import_work_orders, then imports catalogue + 2 sections
  const firstConfirm = await runMaterialLoad(
    {
      workbookPath: '/fake/wb.xlsx',
      mappingPath: '/fake/map.json',
      mapping,
      projectId: PROJECT_ID,
      confirm: true,
      parseWorkbook: async () => parsed,
    },
    transport,
  );
  assert.equal(firstConfirm.exit, 0);
  assert.equal(firstConfirm.report.complete, true);
  assert.equal(firstConfirm.report.work_orders.created, 1);
  assert.equal(transport.workOrders.length, 1);
  assert.equal(transport.workOrders[0].client_po_number, 'WO-SYN-100');
  assert.equal(transport.workOrders[0].status, 'Draft');
  assert.equal(
    firstConfirm.report.section_results.every((r) => r.status === 'create'),
    true,
  );

  // 3. Second confirm with identical source: creates 0 work orders, skips all catalogue & section rows
  const secondConfirm = await runMaterialLoad(
    {
      workbookPath: '/fake/wb.xlsx',
      mappingPath: '/fake/map.json',
      mapping,
      projectId: PROJECT_ID,
      confirm: true,
      parseWorkbook: async () => parsed,
    },
    transport,
  );
  assert.equal(secondConfirm.exit, 0);
  assert.equal(secondConfirm.report.work_orders.to_create_count, 0);
  assert.equal(secondConfirm.report.work_orders.created, 0);
  assert.equal(
    secondConfirm.report.catalogue_results.every((r) => r.status === 'skip'),
    true,
  );
  assert.equal(
    secondConfirm.report.section_results.every((r) => r.status === 'skip'),
    true,
  );

  // 4. Changed plan quantity previews old -> new before/after
  const changed = sampleParsed();
  changed.accepted_sections[0].lines[0].planned = '14';
  const changedPreview = await runMaterialLoad(
    {
      workbookPath: '/fake/wb.xlsx',
      mappingPath: '/fake/map.json',
      mapping,
      projectId: PROJECT_ID,
      confirm: false,
      parseWorkbook: async () => changed,
    },
    transport,
  );
  const updatedLine = changedPreview.report.section_results.find((r) => r.entity_key.endsWith(':001001'));
  assert.equal(updatedLine.status, 'update');
  assert.deepEqual(updatedLine.before, { planned: '10' });
  assert.deepEqual(updatedLine.after, { planned: '14' });
});

test('AC-001: refuses missing work order creation when commercial tax_treatment is absent or placeholder', async () => {
  const transport = makeFakeTransport();
  const parsed = sampleParsed();
  const mapping = baseMapping({
    work_order_defaults: {
      tax_treatment: 'REQUIRED_FILL_TAX_TREATMENT',
      currency: 'IDR',
      order_value: '0',
    },
  });
  await assert.rejects(
    () =>
      runMaterialLoad(
        {
          workbookPath: '/fake/wb.xlsx',
          mappingPath: '/fake/map.json',
          mapping,
          projectId: PROJECT_ID,
          confirm: false,
          parseWorkbook: async () => parsed,
        },
        transport,
      ),
    (err) => {
      assert.ok(err instanceof MaterialLoadError);
      assert.equal(err.code, 'missing_work_order_commercial_inputs');
      assert.equal(err.exit, 2);
      return true;
    },
  );
  // import_work_orders must never have been called
  assert.equal(
    transport.calls.some((c) => c.name === 'import_work_orders' || c.name === 'om_material_import'),
    false,
  );
});

test('AC-002: refused sections stay unwritten, accepted sections load, exit is 1, and report file is written outside repo', async () => {
  const dir = tmpDir();
  try {
    const reportPath = path.join(dir, 'load-report.json');
    const transport = makeFakeTransport({
      workOrders: [
        { id: 'wo-existing-1', wo_number: 'WO-SYN-100', client_po_number: null, title: 'Existing', status: 'Issued' },
      ],
    });
    const parsed = sampleParsed({
      accepted_sections: [sampleParsed().accepted_sections[0]],
      refused_sections: [
        {
          sheet: 'LOC_BAD',
          owner_order_number: 'WO-BAD',
          location_name: 'LOC_BAD',
          refusals: [
            { sheet: 'LOC_BAD', row: 9, column: 'E', class: 'excel_error', reason: 'Invalid planned quantity (#REF!)' },
          ],
        },
      ],
    });
    const res = await runMaterialLoad(
      {
        workbookPath: '/fake/wb.xlsx',
        mappingPath: '/fake/map.json',
        mapping: baseMapping(),
        projectId: PROJECT_ID,
        confirm: true,
        reportPath,
        parseWorkbook: async () => parsed,
      },
      transport,
    );
    assert.equal(res.exit, 1);
    assert.equal(res.report.complete, false);
    assert.equal(res.report.counts.accepted_sections, 1);
    assert.equal(res.report.counts.refused_sections, 1);
    assert.ok(fs.existsSync(reportPath));
    const saved = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    assert.equal(saved.refused_sections[0].refusals[0].column, 'E');
    assert.equal(saved.schema_version, MATERIAL_SCHEMA_VERSION);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('AC-002: unknown-outcome transport failure halts without retrying a new source_key', async () => {
  const transport = makeFakeTransport({
    workOrders: [
      { id: 'wo-existing-1', wo_number: 'WO-SYN-100', client_po_number: null, title: 'Existing', status: 'Issued' },
    ],
    onRpc: async (name, body) => {
      if (name === 'om_material_import' && body.p_payload.kind === 'section') {
        throw new Error('ECONNRESET');
      }
      return undefined;
    },
  });
  await assert.rejects(
    () =>
      runMaterialLoad(
        {
          workbookPath: '/fake/wb.xlsx',
          mappingPath: '/fake/map.json',
          mapping: baseMapping(),
          projectId: PROJECT_ID,
          confirm: true,
          parseWorkbook: async () => sampleParsed(),
        },
        transport,
      ),
    (err) => {
      assert.ok(err instanceof MaterialOutcomeUnknown);
      assert.equal(err.sourceKey, 'syn-source-v2');
      assert.match(err.message, /never retry with a new source_key/i);
      return true;
    },
  );
  const sectionCalls = transport.calls.filter(
    (c) => c.name === 'om_material_import' && c.body.p_payload.kind === 'section',
  );
  assert.equal(sectionCalls.length, 1, 'must not silently retry after unknown outcome');
});

test('AC-002: mapping validation rejects unknown keys and buildSectionEntity emits Contract v2 shape', () => {
  const problems = validateMapping({
    source_key: 'k',
    mystery_key: true,
    policy: { closing_conflict: 'refuse', multi_value_cells: 'latest_date' },
  });
  assert.ok(problems.some((p) => p.includes("unknown mapping key 'mystery_key'")));
  assert.ok(problems.some((p) => p.includes("unknown policy key 'multi_value_cells'")));

  const sec = sampleParsed().accepted_sections[0];
  const entity = buildSectionEntity(sec, 'src-1', 'LOC_ONE');
  assert.equal(entity.as_of, '2026-01-31');
  assert.equal(entity.closing_conflict, 'refuse');
  assert.equal(entity.lines[0].opening.received, '10');
  assert.equal(entity.lines[0].evidence.request_reference, 'REQ-1');
  assert.equal('movements' in entity.lines[0], false, 'Contract v2 drops movements[]');
  assert.equal('reservations' in entity.lines[0], false, 'Contract v2 drops reservations[]');

  const dupProblems = validateMapping(baseMapping({ policy: { closing_conflict: 'movements_win', duplicate_items: 'invalid' } }));
  assert.ok(dupProblems.some((p) => p.includes('policy.duplicate_items')));
  assert.deepEqual(validateMapping(baseMapping({ policy: { closing_conflict: 'movements_win', duplicate_items: 'sum' } })), []);
});

test('AC-002: partial section loads accepted lines, reports skipped_lines and policy flags, and exits 1', async () => {
  const transport = makeFakeTransport({
    workOrders: [
      { id: 'wo-existing-1', wo_number: 'WO-SYN-100', client_po_number: null, title: 'Existing', status: 'Issued' },
    ],
  });
  const base = sampleParsed();
  const partialSec = {
    ...base.accepted_sections[0],
    partial: true,
    skipped_lines: [
      { sheet: 'LOC_ONE', row: 9, column: 'D', item_code: '009999', class: 'missing_unit', reason: "Missing unit for item '009999'." },
    ],
    policy_flags: {
      closing_conflicts: [],
      negative_closings: [],
      set_aside_conflicts: [{ sheet: 'LOC_ONE', row: 8, column: 'P', item_code: '001001', workbook_total: '12', computed_total: '10' }],
      received_conflicts: [],
      consolidated_items: [{ sheet: 'LOC_ONE', row: 8, rows: [8, 10], item_code: '001001', row_count: 2 }],
    },
  };
  const res = await runMaterialLoad(
    {
      workbookPath: '/fake/wb.xlsx',
      mappingPath: '/fake/map.json',
      mapping: baseMapping({ policy: { closing_conflict: 'movements_win', duplicate_items: 'sum' } }),
      projectId: PROJECT_ID,
      confirm: true,
      parseWorkbook: async () => sampleParsed({ accepted_sections: [partialSec] }),
    },
    transport,
  );
  assert.equal(res.exit, 1);
  assert.equal(res.report.complete, false);
  assert.equal(res.report.counts.accepted_sections, 1);
  assert.equal(res.report.counts.partial_sections, 1);
  assert.equal(res.report.counts.skipped_lines, 1);
  assert.equal(res.report.partial_sections.length, 1);
  assert.equal(res.report.partial_sections[0].skipped_lines[0].class, 'missing_unit');
  assert.equal(res.report.policy_flagged_sections.length, 1);
  assert.equal(res.report.policy_flagged_sections[0].set_aside_conflicts.length, 1);
  assert.equal(res.report.policy_flagged_sections[0].consolidated_items.length, 1);
});

test('AC-001 (v2.2 3a): reconciliation scale skips when matching, previews diff, updates on confirm, and stops before sections on server refusal', async () => {
  const customScale = [
    { name: 'Stage One', position: 1, percentage: 25 },
    { name: 'Stage Final', position: 2, percentage: 100 },
  ];
  const mapping = baseMapping({ reconciliation_scale: customScale });
  const parsed = sampleParsed();
  const existingWo = [{ id: 'wo-1', wo_number: 'WO-SYN-100', client_po_number: null, title: 'Existing', status: 'Issued' }];

  // 1. Preview shows before/after and does not call om_material_set_scale
  const t1 = makeFakeTransport({ workOrders: existingWo });
  const prev = await runMaterialLoad(
    { workbookPath: '/fake/wb.xlsx', mappingPath: '/fake/map.json', mapping, projectId: PROJECT_ID, confirm: false, parseWorkbook: async () => parsed },
    t1,
  );
  assert.equal(prev.exit, 0);
  assert.equal(prev.report.reconciliation_scale.status, 'update');
  assert.equal(prev.report.reconciliation_scale.before.length, 2);
  assert.equal(prev.report.reconciliation_scale.after[0].name, 'Stage One');
  assert.equal(t1.calls.some((c) => c.name === 'om_material_set_scale'), false);

  // 2. Confirm calls om_material_set_scale BEFORE sections
  const t2 = makeFakeTransport({ workOrders: existingWo });
  const conf = await runMaterialLoad(
    { workbookPath: '/fake/wb.xlsx', mappingPath: '/fake/map.json', mapping, projectId: PROJECT_ID, confirm: true, parseWorkbook: async () => parsed },
    t2,
  );
  assert.equal(conf.exit, 0);
  assert.equal(conf.report.reconciliation_scale.status, 'updated');
  const setIdx = t2.calls.findIndex((c) => c.name === 'om_material_set_scale');
  const secIdx = t2.calls.findIndex((c) => c.name === 'om_material_import' && c.body.p_payload.kind === 'section');
  assert.ok(setIdx >= 0 && setIdx < secIdx, 'om_material_set_scale must run before sections');

  // 3. Server refusal on om_material_set_scale stops before sending any section
  const t3 = makeFakeTransport({
    workOrders: existingWo,
    onRpc: async (name) => {
      if (name === 'om_material_set_scale') {
        const err = new Error('Steps in use');
        err.status = 400;
        err.code = 'P0001';
        throw err;
      }
      return undefined;
    },
  });
  const refused = await runMaterialLoad(
    { workbookPath: '/fake/wb.xlsx', mappingPath: '/fake/map.json', mapping, projectId: PROJECT_ID, confirm: true, parseWorkbook: async () => parsed },
    t3,
  );
  assert.equal(refused.exit, 1);
  assert.equal(refused.report.complete, false);
  assert.equal(refused.report.reconciliation_scale.status, 'refused');
  assert.equal(
    t3.calls.some((c) => c.name === 'om_material_import' && c.body.p_payload.kind === 'section'),
    false,
    'must not load sections when scale change is refused',
  );
});

test('AC-001 (v2.2 3b): zero_cost_tag_name is required, resolved from config, attached to item entities, and stops before any write if missing', async () => {
  const missingProblems = validateMapping({ source_key: 'k' });
  assert.ok(missingProblems.some((p) => p.includes('zero_cost_tag_name')));

  // Unmatched tag stops before any write
  const tMiss = makeFakeTransport({ zeroCostTags: [{ id: ZERO_COST_TAG_ID, name: 'Different Tag' }] });
  await assert.rejects(
    () =>
      runMaterialLoad(
        { workbookPath: '/fake/wb.xlsx', mappingPath: '/fake/map.json', mapping: baseMapping(), projectId: PROJECT_ID, confirm: true, parseWorkbook: async () => sampleParsed() },
        tMiss,
      ),
    (err) => err instanceof MaterialLoadError && err.code === 'zero_cost_tag_not_found' && err.exit === 2,
  );
  assert.equal(tMiss.calls.some((c) => c.name === 'import_work_orders' || c.name === 'om_material_import'), false);

  // Matched tag attaches resolved zero_cost_tag_id to every item catalogue entity
  const tOk = makeFakeTransport({
    workOrders: [{ id: 'wo-1', wo_number: 'WO-SYN-100', client_po_number: null, title: 'Existing', status: 'Issued' }],
  });
  const res = await runMaterialLoad(
    { workbookPath: '/fake/wb.xlsx', mappingPath: '/fake/map.json', mapping: baseMapping(), projectId: PROJECT_ID, confirm: false, parseWorkbook: async () => sampleParsed() },
    tOk,
  );
  assert.equal(res.exit, 0);
  const catEntities = tOk.calls
    .filter((c) => c.name === 'om_material_import' && c.body.p_payload.kind === 'catalogue')
    .flatMap((c) => c.body.p_payload.entities);
  const items = catEntities.filter((e) => e.type === 'item');
  assert.ok(items.length > 0);
  assert.ok(items.every((i) => i.zero_cost_tag_id === ZERO_COST_TAG_ID));
});

test('AC-001 (v2.2 3c/3d): empty_line is counted without marking partial, and preview shows queued missing WOs as pending_work_order', async () => {
  const transport = makeFakeTransport(); // WO-SYN-100 is missing -> queued for create on confirm
  const parsed = sampleParsed();
  parsed.accepted_sections[0].empty_lines = [{ sheet: 'LOC_ONE', row: 12, item_code: '009990', class: 'empty_line' }];

  const preview = await runMaterialLoad(
    { workbookPath: '/fake/wb.xlsx', mappingPath: '/fake/map.json', mapping: baseMapping(), projectId: PROJECT_ID, confirm: false, parseWorkbook: async () => parsed },
    transport,
  );
  assert.equal(preview.exit, 0);
  assert.equal(preview.report.complete, true);
  assert.equal(preview.report.counts.server_refused, 0);
  assert.equal(preview.report.counts.partial_sections, 0);
  assert.equal(preview.report.counts.empty_lines, 1);
  assert.ok(preview.report.section_results.every((r) => r.status === 'pending_work_order' && /will be created on confirm/i.test(r.note)));
});

test('AC-001 (v2.3): unit chunks sent first, units_to_create listed, and every section carries projected catalogue_entities + reconciliation_scale', async () => {
  const transport = makeFakeTransport({
    workOrders: [{ id: 'wo-1', wo_number: 'WO-SYN-100', client_po_number: null, title: 'Existing', status: 'Issued' }],
  });
  const mapping = baseMapping({
    units: {
      PCS: { name: 'Pieces', whole_only: true },
    },
  });
  const parsed = sampleParsed();
  const res = await runMaterialLoad(
    { workbookPath: '/fake/wb.xlsx', mappingPath: '/fake/map.json', mapping, projectId: PROJECT_ID, confirm: false, parseWorkbook: async () => parsed },
    transport,
  );
  assert.equal(res.exit, 0);

  // Unit chunk sent strictly before non-unit catalogue chunk
  const catCalls = transport.calls.filter((c) => c.name === 'om_material_import' && c.body.p_payload.kind === 'catalogue');
  assert.ok(catCalls.length >= 2, 'units must be sent in their own chunk(s) first');
  assert.ok(catCalls[0].body.p_payload.entities.every((e) => e.type === 'unit'));
  const pcsUnit = catCalls[0].body.p_payload.entities.find((e) => e.code === 'PCS');
  const eaUnit = catCalls[0].body.p_payload.entities.find((e) => e.code === 'EA');
  assert.deepEqual({ name: pcsUnit.name, whole_only: pcsUnit.whole_only }, { name: 'Pieces', whole_only: true });
  assert.deepEqual({ name: eaUnit.name, whole_only: eaUnit.whole_only }, { name: 'EA', whole_only: false });

  // Preview lists every unit it would create
  assert.deepEqual(
    res.report.units_to_create.map((u) => u.code).sort(),
    ['EA', 'PCS'],
  );

  // Every section payload carries projected catalogue_entities (scoped to that section) + reconciliation_scale
  const secCalls = transport.calls.filter((c) => c.name === 'om_material_import' && c.body.p_payload.kind === 'section');
  assert.equal(secCalls.length, 2);
  const firstSecPayload = secCalls[0].body.p_payload;
  assert.ok(Array.isArray(firstSecPayload.catalogue_entities));
  assert.ok(firstSecPayload.catalogue_entities.length <= 500);
  // First section only uses item 001001 (PCS), not 001002 (EA)
  const firstSecItemCodes = firstSecPayload.catalogue_entities.filter((e) => e.type === 'item').map((e) => e.code);
  const firstSecUnitCodes = firstSecPayload.catalogue_entities.filter((e) => e.type === 'unit').map((e) => e.code);
  assert.deepEqual(firstSecItemCodes, ['001001']);
  assert.deepEqual(firstSecUnitCodes, ['PCS']);
  assert.equal(firstSecPayload.catalogue_entities[0].type, 'unit', 'units first in projected catalogue_entities');
  assert.deepEqual(firstSecPayload.reconciliation_scale, [
    { name: 'Prepared', position: 1, percentage: '20' },
    { name: 'Closed', position: 2, percentage: '100' },
  ]);
});

test('AC-002 (v2.3): evidence values are flattened to scalar strings <= 4KB with truncation marker & count, and closed WO refusals get own report heading', async () => {
  const transport = makeFakeTransport({
    workOrders: [{ id: 'wo-closed', wo_number: 'WO-SYN-100', client_po_number: null, title: 'Closed WO', status: 'Completed' }],
  });
  const parsed = sampleParsed();
  // Inject a nested rows array whose JSON exceeds 4096 bytes
  parsed.accepted_sections[0].lines[0].evidence = {
    request_reference: 'REQ-1',
    owner_warehouses: { 'WH-N': '10' },
    rows: Array.from({ length: 80 }, (_, idx) => ({
      row: idx + 8,
      planned: '1',
      texts: { note: 'X'.repeat(80) },
    })),
  };

  const res = await runMaterialLoad(
    { workbookPath: '/fake/wb.xlsx', mappingPath: '/fake/map.json', mapping: baseMapping(), projectId: PROJECT_ID, confirm: false, parseWorkbook: async () => parsed },
    transport,
  );

  // Verify every sent evidence value is a scalar string <= 4096 UTF-8 bytes
  const secCalls = transport.calls.filter((c) => c.name === 'om_material_import' && c.body.p_payload.kind === 'section');
  const sentEvidence = secCalls[0].body.p_payload.entities[0].lines[0].evidence;
  for (const [k, v] of Object.entries(sentEvidence)) {
    assert.equal(typeof v, 'string', `evidence.${k} must be a scalar string`);
    assert.ok(Buffer.byteLength(v, 'utf8') <= 4096, `evidence.${k} must be <= 4096 bytes`);
  }
  assert.match(sentEvidence.rows, /\.\.\.\[truncated\]$/);
  assert.equal(res.report.counts.truncated_evidence_values, 1);
  assert.equal(res.report.truncated_evidence.length, 1);
  assert.equal(res.report.truncated_evidence[0].key, 'rows');

  // Closed work order refusals are separated under their own heading, not mixed with other refusals
  assert.equal(res.exit, 1);
  assert.equal(res.report.complete, false);
  assert.equal(res.report.counts.closed_work_order_refusals, 2);
  assert.equal(res.report.closed_work_order_refusals.length, 2);
  assert.equal(res.report.closed_work_order_refusals[0].reason_code, 'material-conflict');
  assert.match(res.report.closed_work_order_refusals[0].reason, /Completed/);
  assert.equal(res.report.counts.server_refused, 0);
});

test('AC-001: CLI `pmo material load` wires ordinary session, Admin check, preview default, and never prints tokens', async () => {
  const dir = tmpDir();
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const url = new URL(req.url, 'http://127.0.0.1');
    requests.push({ method: req.method, path: url.pathname, body });
    const send = (status, json) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(json));
    };
    if (url.pathname === '/auth/v1/user') return send(200, { id: 'u-admin', email: 'admin@example.test' });
    if (url.pathname === '/rest/v1/profiles') return send(200, [{ full_name: 'Admin User', role: 'Admin', status: 'active' }]);
    if (url.pathname === '/rest/v1/work_orders') {
      return send(200, [{ id: 'wo-1', wo_number: 'WO-SYN-1', client_po_number: null, title: 'WO 1', status: 'Issued' }]);
    }
    if (url.pathname === '/rest/v1/rpc/om_material_config') {
      return send(200, {
        categories: [],
        owner_warehouses: [],
        steps: [
          { id: 'step-1', name: 'Prepared', position: 1, percentage: '20' },
          { id: 'step-2', name: 'Closed', position: 2, percentage: '100' },
        ],
        zero_cost_tags: [{ id: ZERO_COST_TAG_ID, name: 'Owner Supplied Material' }],
      });
    }
    if (url.pathname === '/rest/v1/rpc/om_material_import') {
      const parsedBody = JSON.parse(body);
      return send(200, {
        batch_id: null,
        results: parsedBody.p_payload.entities.map((e) => ({ entity_key: e.entity_key, status: 'create', ids: {} })),
        complete: true,
      });
    }
    return send(404, { message: 'not found' });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    writeCredentials(
      { PMO_CONFIG_DIR: dir },
      url,
      {
        client_id: 'cli-1',
        access_token: 'secret-access-token-xyz',
        refresh_token: 'secret-refresh-token-xyz',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: { id: 'u-admin', email: 'admin@example.test' },
      },
    );

    // Create a minimal synthetic workbook using the venv python if available
    const pythonBin = process.env.PMO_OWNER_MATERIAL_PYTHON || '/tmp/owner-material-loader-venv/bin/python';
    const wbPath = path.join(dir, 'syn.xlsx');
    const mapPath = path.join(dir, 'map.json');
    fs.writeFileSync(mapPath, JSON.stringify(baseMapping(), null, 2));

    const { execFileSync } = await import('node:child_process');
    execFileSync(pythonBin, [
      '-I',
      '-c',
      `import openpyxl; wb=openpyxl.Workbook(); ws=wb.active; ws.title='LOC_1'; ` +
        `hdr=['LINE_NO','PART_NO','PART_DESC','UNIT','PLAN_QTY','CAT_CODE','ORDER_NO','COST_CODE','REQ_REF','REQ_DATE','HOLD_DATE','WH NORTH','HOLD_TOTAL','HOLD_REF','RECV_DATE','RECV_DIRECT','RECV_XFER','RECV_TOTAL','ISSUE_REF','ISSUE_DATE','ISSUE_QTY','RET_DATE','RET_QTY','XFER_OUT_DATE','XFER_OUT_QTY','END_BAL']; ` +
        `[ws.cell(7,i+1,h) for i,h in enumerate(hdr)]; ` +
        `row=[1,'009911','Synthetic Gasket','PCS',10,'CAT-A','WO-SYN-1','CC-1','REQ-1','2026-01-05','2026-01-06',10,10,'DOC-1','2026-01-10',10,0,10,'SLIP-1','2026-01-12',4,None,0,None,0,6]; ` +
        `[ws.cell(8,i+1,v) for i,v in enumerate(row)]; wb.save(${JSON.stringify(wbPath)})`,
    ]);

    let out = '';
    let err = '';
    const code = await run(
      ['material', 'load', wbPath, '--project', PROJECT_ID, '--map', mapPath, '--url', url],
      {
        env: { PMO_CONFIG_DIR: dir, PMO_SUPABASE_KEY: 'test-publishable-key', PMO_OWNER_MATERIAL_PYTHON: pythonBin },
        stdout: { write: (s) => (out += s) },
        stderr: { write: (s) => (err += s) },
      },
    );
    assert.equal(code, 0, err);
    assert.doesNotMatch(out + err, /secret-access-token|secret-refresh-token/);
    const json = JSON.parse(out);
    assert.equal(json.mode, 'preview');
    assert.equal(json.complete, true);
    assert.equal(json.counts.accepted_sections, 1);
    assert.ok(MATERIAL_LOAD_RPCS.includes('om_material_import'));
  } finally {
    await new Promise((r) => server.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
