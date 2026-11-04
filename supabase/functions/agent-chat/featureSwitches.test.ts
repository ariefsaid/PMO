/**
 * S4 (FR-PLN-008) — the one entity/tool → plan-switch-key map.
 *
 * Proves the MAP is complete and stays complete: every entity the agent can read and every tool the
 * agent can register is either CORE (no key, always offered) or mapped to a key the plan catalogue
 * (migrations 0531/0533 + `pmo-portal/src/lib/features.ts`) actually knows. A new entity or tool with
 * no row here is exactly how a paid module would leak through the assistant (S6's completeness gate
 * covers the same surface from the CI side).
 */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  ENTITY_FEATURE_KEYS,
  TOOL_FEATURE_KEYS,
  FEATURE_LABELS,
  FAIL_CLOSED_WRITE_TOOLS,
  isEntityAllowed,
  isKeyEnabled,
  isToolAllowed,
  keyForEntity,
  keyForTool,
  offerableEntities,
  offerableTools,
  unavailableFeatureLabels,
  writeRefusal,
  writeRefusalFor,
} from './featureSwitches.ts';
import { AGENT_READ_ENTITIES } from './readEntities.ts';
import { BASE_ACTIONS } from './handler.ts';

/** Every switchable key the plan registry accepts (0531 CHECK + 0533 core split). */
const CATALOGUE_KEYS = new Set([
  'timesheets', 'crm', 'sales_pipeline', 'procurement', 'procurement_full',
  'sales_invoices', 'revenue', 'budget_projection', 'imprest', 'user_views',
  'm365_integration', 'clickup_sync', 'erp_sync', 'erp_purchases',
  'financial_statements', 'management_pack', 'budget_phasing', 'multi_currency',
  'stock', 'api_access', 'sso', 'incidents', 'import_export', 'agent_assistant',
]);

/** Every tool the handler can put in front of the model — the SHIPPED registry, not a copy. */
const TOOL_NAMES = [
  ...BASE_ACTIONS.map((action) => action.name),
  // compose_view is registered per-request (its own capability flag) and ask_user is dispatched
  // specially by the loop, so neither is in BASE_ACTIONS.
  'compose_view',
  'ask_user',
];

/**
 * The tools that are deliberately CORE — no plan key, offered at every plan (S4.0/S4.1 reasoning). A tool
 * that is neither mapped nor listed here fails the completeness test: a new capability has to be
 * classified once instead of inheriting "core" by omission.
 */
const CORE_TOOLS = new Set<string>([
  'query_entity', // reads per-entity keys (the entity map below)
  'whats_overdue', // overdue tasks are core; its invoice section is role- and revenue-gated
  'remind_overdue', // nudges people about core tasks
  'update_task_status', // tasks are core
  'notify', // the caller's own inbox is core
  'ask_user', // UX only
]);

Deno.test('S4 map — every readable entity is core or mapped to a catalogue key', () => {
  for (const entity of AGENT_READ_ENTITIES) {
    const key = keyForEntity(entity);
    if (key === undefined) continue; // core: no key
    assertEquals(CATALOGUE_KEYS.has(key), true, `entity ${entity} maps to unknown key ${key}`);
  }
  // A mapped entity that is not readable is dead data — catches a rename drift.
  for (const entity of Object.keys(ENTITY_FEATURE_KEYS)) {
    assertEquals(
      (AGENT_READ_ENTITIES as readonly string[]).includes(entity),
      true,
      `ENTITY_FEATURE_KEYS names ${entity}, which is not a readable entity`,
    );
  }
});

Deno.test('S4 map — every tool is core or mapped to a catalogue key', () => {
  for (const tool of TOOL_NAMES) {
    const key = keyForTool(tool);
    if (key === undefined) {
      assertEquals(CORE_TOOLS.has(tool), true, `tool ${tool} is neither mapped to a key nor declared core`);
      continue;
    }
    assertEquals(CATALOGUE_KEYS.has(key), true, `tool ${tool} maps to unknown key ${key}`);
  }
  for (const tool of Object.keys(TOOL_FEATURE_KEYS)) {
    assertEquals(TOOL_NAMES.includes(tool), true, `TOOL_FEATURE_KEYS names unknown tool ${tool}`);
  }
  for (const tool of CORE_TOOLS) {
    assertEquals(TOOL_NAMES.includes(tool), true, `CORE_TOOLS names unknown tool ${tool}`);
  }
});

Deno.test('S4 map — every switchable key has a human label for the prompt', () => {
  for (const key of CATALOGUE_KEYS) {
    assertEquals(typeof FEATURE_LABELS[key], 'string', `no label for ${key}`);
  }
});

Deno.test('S4 offering — an off key drops exactly its own entities and tools', () => {
  const switches = { stock: false };
  const entities = offerableEntities(switches);
  assertEquals(entities.includes('stock_items'), false);
  assertEquals(entities.includes('stock_documents'), false);
  // core + other keys survive
  assertEquals(entities.includes('projects'), true);
  assertEquals(entities.includes('companies'), true);

  const tools = offerableTools([
    { function: { name: 'query_entity' } },
    { function: { name: 'query_stock' } },
    { function: { name: 'create_activity' } },
    { function: { name: 'ask_user' } },
  ], switches);
  assertEquals(tools.map((t) => t.function.name), ['query_entity', 'create_activity', 'ask_user']);
});

Deno.test('S4 offering — unknown/null switches never hide anything (fail open)', () => {
  assertEquals(offerableEntities(null).length, AGENT_READ_ENTITIES.length);
  assertEquals(offerableEntities(undefined).length, AGENT_READ_ENTITIES.length);
  // A key absent from the resolved map is not "off" — only an explicit false is.
  assertEquals(isKeyEnabled('stock', { crm: false }), true);
  assertEquals(isKeyEnabled('stock', { stock: false }), false);
  // An entity/tool with no key is core: offered under every map.
  assertEquals(isEntityAllowed('projects', { stock: false, crm: false }), true);
  assertEquals(isToolAllowed('query_entity', { stock: false }), true);
});

Deno.test('S4 offering — labels name only the features that are off', () => {
  assertEquals(unavailableFeatureLabels({ stock: false }), [FEATURE_LABELS.stock]);
  assertEquals(unavailableFeatureLabels({ stock: true }), []);
  assertEquals(unavailableFeatureLabels(null), []);
  // Never leak a raw key to the model when a label exists.
  assertEquals(unavailableFeatureLabels({ stock: false }).some((l) => l.includes('stock')), true);
});

Deno.test('S4 writes — a read may fail open, a write may not', () => {
  // Reads: an unresolved snapshot is not "off".
  assertEquals(isKeyEnabled('sales_invoices', null), true);
  assertEquals(writeRefusal('sales_invoices', null)?.code, 'PLAN_UNVERIFIED');
  // An explicit false refuses under both names.
  assertEquals(writeRefusal('sales_invoices', { sales_invoices: false })?.code, 'FEATURE_OFF');
  assertEquals(writeRefusal('sales_invoices', { sales_invoices: true }), null);

  // Fail-closed policy is per tool: a keyed tool still refuses an off key, but only a fail-closed write
  // refuses an unresolved snapshot.
  assertEquals(writeRefusalFor('create_automation', null)?.code, 'PLAN_UNVERIFIED');
  assertEquals(writeRefusalFor('draft_invoice', null)?.code, 'PLAN_UNVERIFIED');
  assertEquals(writeRefusalFor('create_activity', null), null);
  assertEquals(writeRefusalFor('create_activity', { crm: false })?.code, 'FEATURE_OFF');
  assertEquals(writeRefusalFor('query_entity', null), null);
  assertEquals(writeRefusalFor('ask_user', { stock: false }), null);

  // Every fail-closed tool must be a real, gated tool in the shipped registry.
  for (const tool of FAIL_CLOSED_WRITE_TOOLS) {
    assertEquals(TOOL_NAMES.includes(tool), true, `${tool} is not in the shipped tool registry`);
    assertEquals(typeof keyForTool(tool), 'string', `${tool} has no switch key to check`);
  }
});

// ── #1783 item 1 (D17 / AC-PLN-006/007): receipts are a BASIC read; Full is line-level + match ──

Deno.test('#1783 D17 — procurement_receipts reads sit on procurement (Basic), never on procurement_full', () => {
  assertEquals(keyForEntity('procurement_receipts'), 'procurement');
});

Deno.test('#1783 D17 — a Basic org (procurement on, full off) is offered and can read its receipts', () => {
  const switches = { procurement: true, procurement_full: false };
  const offered = offerableEntities(switches);
  assertEquals(offered.includes('procurement_receipts'), true, 'existing receipt reads stay Basic');
  // Execution-time gate agrees with the offering filter (the read path, never a write).
  assertEquals(isEntityAllowed('procurement_receipts', switches), true);
  // An explicit procurement off hides them again.
  assertEquals(isEntityAllowed('procurement_receipts', { procurement: false }), false);
});

Deno.test('#1783 D17 — the Full label names the match/line-level capability, not plain goods receipts', () => {
  const label = FEATURE_LABELS['procurement_full'].toLowerCase();
  assertEquals(label.includes('goods receipts'), false, 'a Basic org must not be told its receipts are unlicensed');
  assertEquals(/\bmatch\b/.test(label), true, 'the match is the Full capability the label names');
});
