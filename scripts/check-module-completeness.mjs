#!/usr/bin/env node
/**
 * Guard: the D13 module-completeness rule — a module cannot ship half-registered (FR-PLN-015).
 *
 * Every module surface must declare its plan switch (or be explicitly core), every switch key must have
 * a plan row for every plan and at least one assistant read path, and a migration after S2's enforcement
 * migration cannot quietly recreate a gated function or write policy without its gate (#1783 item 3).
 *
 * Sources are the shipped ones — never a hand-kept list beside them:
 *   routes      pmo-portal/App.tsx                      appRouteConfig (the route table as data)
 *   nav         pmo-portal/src/components/shell/Rail.tsx ALL_ITEMS
 *   palette     pmo-portal/src/components/shell/routeMatch.ts MODULES
 *   registry    pmo-portal/src/lib/features.ts          FEATURE_KEYS / CORE_FEATURES
 *   catalogue   supabase/migrations/*.sql               plans, the tier matrix, explicit plan_features rows
 *   assistant   supabase/functions/agent-chat/*.ts      entities (readEntities + ENTITY_WHITELIST) and tools
 *   key map     supabase/functions/agent-chat/featureSwitches.ts (S4) — pre-S4 fallback below
 *   enforcement supabase/migrations/0534_feature_enforcement.sql (S2) — parseable when merged
 *
 * Core modules are marked HERE (`CORE_ROUTES`/`CORE_NAV`/`CORE_PALETTE`: path -> module/reason) because
 * the alternative — a marker comment in App.tsx / Rail.tsx — collides with the FE slices rewriting them.
 * A stale entry fails, so the list cannot outlive the surface it names.
 *
 * Existing gaps live in `ALLOWLIST` — one justified entry per systemic gap, each naming its restoring
 * slice. A stale entry is a failure: the list cannot decay into "everything".
 *
 * Run: node scripts/check-module-completeness.mjs [--self-test]
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const APP = 'pmo-portal/App.tsx';
const RAIL = 'pmo-portal/src/components/shell/Rail.tsx';
const PALETTE = 'pmo-portal/src/components/shell/routeMatch.ts';
const FEATURES = 'pmo-portal/src/lib/features.ts';
const MIGRATIONS = 'supabase/migrations';
const ASSISTANT_DIR = 'supabase/functions/agent-chat';
const VIEWSPEC_TYPES = 'pmo-portal/src/lib/viewspec/types.ts';

/** Strip SQL/TS line and block comments so commented-out surfaces never satisfy a check. */
export const strip = (text) => text.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

// ── explicit core markings (see the header: these live here on purpose) ─────────────────────────

/** Routes that carry no entitlement and never should: core modules (D5 / core_feature_keys()), the
 *  Finance hub (role-gated), personal settings, redirect-only compatibility paths, and the two
 *  deliberate non-gates S3 records (personal M365 connect; the Odoo master-data mirror). */
export const CORE_ROUTES = {
  '/': 'dashboard — core (D5/core_feature_keys)',
  '/projects': 'projects — core',
  '/projects/new': 'projects — core',
  '/projects/:projectId/:tab': 'projects — core',
  '/projects/:projectId': 'projects — core',
  '/approvals': 'approvals — core',
  '/my-tasks': 'tasks — core',
  '/meetings': 'meetings — not a catalogue module (D5; no switch key)',
  '/meetings/new': 'meetings — not a catalogue module',
  '/meetings/:meetingId': 'meetings — not a catalogue module',
  '/expenses': 'expense_claims — core',
  '/expenses/new': 'expense_claims — core',
  '/expenses/:claimId': 'expense_claims — core',
  '/equipment': 'equipment — not a catalogue module',
  '/equipment/assets': 'equipment — not a catalogue module',
  '/equipment/assets/:assetId': 'equipment — not a catalogue module',
  '/reports': 'redirect to /finance/reports',
  '/administration': 'administration — core',
  '/administration/users': 'administration — core',
  '/administration/integrations': 'administration — core',
  '/administration/accounting': 'administration — core',
  '/administration/projects': 'administration — core',
  '/administration/credits': 'administration — core',
  '/administration/cost-attribution': 'administration — core',
  '/administration/usage': 'administration — core',
  '/administration/features': 'administration — core',
  '/administration/:section': 'administration — core (unknown sections stay inside the shell)',
  '/finance': 'Finance hub — role-gated (can(view,finance)), no entitlement',
  '/sales-invoices': 'redirect to /finance/receivables',
  '/incoming-payments': 'redirect to /finance/receivables',
  '/revenue-by-project': 'redirect to /finance/reports',
  '/financial-statements': 'redirect to /finance/statements',
  '/integrations': 'personal M365 connect — the token-custody callback and teardown surface; stays routable (S3 decision)',
  '/settings/profile': 'personal settings',
  '/master-data/:kind': 'Odoo master-data mirror — no switch key of its own (reached from the Odoo card; S3 inventory)',
};

/** Rail items with no entitlement (mirrors CORE_ROUTES for the same modules). */
export const CORE_NAV = {
  '/': 'dashboard — core',
  '/projects': 'projects — core',
  '/equipment': 'equipment — not a catalogue module',
  '/expenses': 'expense_claims — core',
  '/approvals': 'approvals — core',
  '/my-tasks': 'tasks — core',
  '/meetings': 'meetings — not a catalogue module',
  '/finance': 'Finance hub — role-gated, no entitlement',
};

/** ⌘K palette modules with no entitlement. */
export const CORE_PALETTE = {
  '/': 'dashboard — core',
  '/projects': 'projects — core',
  '/meetings': 'meetings — not a catalogue module',
  '/expenses': 'expense_claims — core',
  '/equipment': 'equipment — not a catalogue module',
  '/my-tasks': 'tasks — core',
  '/approvals': 'approvals — core',
  '/finance': 'Finance hub — role-gated, no entitlement',
  '/administration': 'administration — core',
};

/**
 * The assistant's pre-S4 key map. S4's `featureSwitches.ts` is the runtime seam and REPLACES this the
 * moment it merges; until then the gate needs the same contract to prove every key reaches a read path.
 * Delete this constant (and the `parseKeyMap` fallback) when `featureSwitches.ts` is on dev.
 */
export const LEGACY_ASSISTANT_PATHS = {
  entity: {
    // CRM
    companies: 'crm',
    contacts: 'crm',
    crm_activities: 'crm',
    // HSE
    incidents: 'incidents',
    // Workforce
    timesheets: 'timesheets',
    // Procurement (the basic module)
    procurements: 'procurement',
    procurement_items: 'procurement',
    procurement_quotations: 'procurement',
    procurement_documents: 'procurement',
    procurement_status_events: 'procurement',
    procurement_invoices: 'procurement',
    payments: 'procurement',
    purchase_requests: 'procurement',
    rfqs: 'procurement',
    purchase_orders: 'procurement',
    // Procurement full — receipts / the three-way-match boundary
    procurement_receipts: 'procurement_full',
    // Stock (#1721 read surfaces)
    stock_items: 'stock',
    stock_warehouses: 'stock',
    stock_documents: 'stock',
    stock_document_lines: 'stock',
    stock_reorder_levels: 'stock',
    // Views
    user_views: 'user_views',
  },
  tool: {
    create_activity: 'crm',
    query_stock: 'stock',
    draft_invoice: 'sales_invoices',
    compose_view: 'user_views',
    create_automation: 'agent_assistant',
  },
};

/**
 * Existing gaps on dev, each with the slice that restores it. Remove an entry the moment its gaps close
 * (a stale entry fails).
 */
export const ALLOWLIST = [
  {
    ids: [
      'route:/sales',
      'route:/sales/:opportunityId',
      'route:/procurement',
      'route:/procurement/new',
      'route:/procurement/:procurementId',
      'route:/procurement/:procurementId/:tab',
      'route:/timesheets',
      'route:/companies',
      'route:/companies/:companyId',
      'route:/contacts',
      'route:/contacts/:contactId',
      'route:/imprest',
      'route:/imprest/:floatId',
      'route:/stock',
      'route:/stock/setup',
      'route:/stock/documents',
      'route:/stock/documents/:documentId',
      'route:/stock/documents/:documentId/edit',
      'route:/stock/ledger',
      'route:/stock/reorder',
      'route:/stock/new/:kind',
      'route:/erp-purchases',
      'route:/sales-invoices/:invoiceId',
      'route:/finance/statements',
      'route:/administration/exchange-rates',
    ],
    reason: 'S3 wires FeatureRoute for the module routes (AC-PLN-008); dev wraps only incidents/revenue/procurement/user_views',
    restore: 'Delete when S3 lands the route table (docs/plans/2026-11-02-plans-and-feature-switches.md §S3.0).',
  },
  {
    ids: ['route:/incoming-payments/:receiptId'],
    reason: 'revenue detail route; S3 should gate it on `revenue` or rule it core',
    restore: 'Delete when S3 wraps it (or core-marks it with the owner ruling).',
  },
  {
    ids: ['nav:/stock', 'nav:/imprest', 'nav:/finance/statements'],
    reason: 'S3 gates the Rail from the resolved projection; these three items are still ungated on dev',
    restore: 'Delete when S3 lands the Rail gates (§S3.0 Rail table).',
  },
  {
    ids: [
      'palette:/sales',
      'palette:/procurement',
      'palette:/stock',
      'palette:/timesheets',
      'palette:/companies',
      'palette:/companies?type=Vendor',
      'palette:/contacts',
      'palette:/incidents',
      'palette:/imprest',
      'palette:/finance/statements',
    ],
    reason: 'S3 makes the ⌘K palette follow MODULES[].feature; only the three Finance keys carry a feature on dev',
    restore: 'Delete when S3 lands the palette gates (§S3.3 task 6).',
  },
  {
    ids: [
      'assistant:sales_pipeline',
      'assistant:revenue',
      'assistant:import_export',
      'assistant:m365_integration',
      'assistant:budget_projection',
      'assistant:imprest',
      'assistant:clickup_sync',
      'assistant:erp_sync',
      'assistant:erp_purchases',
      'assistant:financial_statements',
      'assistant:management_pack',
      'assistant:budget_phasing',
      'assistant:multi_currency',
      'assistant:api_access',
      'assistant:sso',
    ],
    reason: 'no assistant-visible entity/tool for these keys yet (D13 wants a read tool when the module ships; S4 owns the runtime map)',
    restore: 'Delete each line when its module ships a read tool/entity in agent-chat.',
  },
  {
    ids: ['assistant:feedback_surveys'],
    reason: 'Admin-owned switch (0419); S4 deliberately gives it no assistant surface',
    restore: 'Delete only if the owner gives the assistant a feedback-surveys read path.',
  },
];

// ── discovery parsers (pure) ───────────────────────────────────────────────────────────────────

/** Entry blocks for a source array whose entries start with `{ ` and end at a line ending `},`. */
function entryBlocks(text, arrayStart, arrayEnd, startsEntry) {
  const start = text.indexOf(arrayStart);
  if (start === -1) return [];
  const end = text.indexOf(arrayEnd, start);
  const body = text.slice(start, end === -1 ? text.length : end);
  const blocks = [];
  let current = null;
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (current === null) {
      if (startsEntry(line)) current = [line];
      continue;
    }
    current.push(line);
    if (line.endsWith('},')) {
      blocks.push(current.join('\n'));
      current = null;
    }
  }
  return blocks;
}

/** `pmo-portal/App.tsx` appRouteConfig -> [{ path, feature }] (the `*` catch-all is kept; callers skip it). */
export function parseRoutes(appTsx) {
  const text = strip(appTsx);
  const blocks = entryBlocks(text, 'export const appRouteConfig', '\n];', (line) => /^\{ path: '/.test(line));
  return blocks.map((block) => {
    const path = block.match(/path:\s*'([^']+)'/)?.[1];
    const feature = block.match(/FeatureRoute\s+feature="([^"]+)"/)?.[1] ?? null;
    return { path, feature };
  }).filter((r) => r.path);
}

/** Rail.tsx ALL_ITEMS -> [{ to, feature, unlessFeature }]. */
export function parseRail(railTsx) {
  const text = strip(railTsx);
  const blocks = entryBlocks(text, 'const ALL_ITEMS', '\n];', (line) => /^\{ to: '/.test(line));
  return blocks.map((block) => ({
    to: block.match(/to:\s*'([^']+)'/)?.[1],
    feature: block.match(/feature:\s*'([^']+)'/)?.[1] ?? null,
    unlessFeature: block.match(/unlessFeature:\s*'([^']+)'/)?.[1] ?? null,
  })).filter((r) => r.to);
}

/** routeMatch.ts MODULES -> [{ path, feature }]. */
export function parsePalette(routeMatchTs) {
  const text = strip(routeMatchTs);
  const blocks = entryBlocks(text, 'export const MODULES', '\n];', (line) => line === '{' || /^\{ module:/.test(line));
  return blocks.map((block) => ({
    path: block.match(/path:\s*'([^']+)'/)?.[1],
    feature: block.match(/feature:\s*'([^']+)'/)?.[1] ?? null,
  })).filter((m) => m.path);
}

/** features.ts -> { keys: FEATURE_KEYS, core: CORE_FEATURES }. */
export function parseFeatures(featuresTs) {
  const text = strip(featuresTs);
  const list = (name) => {
    const start = text.indexOf(`export const ${name}`);
    if (start === -1) return [];
    const body = text.slice(start, text.indexOf('as const', start));
    return [...body.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
  };
  return { keys: list('FEATURE_KEYS'), core: list('CORE_FEATURES') };
}

const INTERNAL = '\u0000';

/**
 * Replay the plan seed migrations: plans, the tier matrix, explicit plan_features rows, and the latest
 * org_features key constraint. Returns sets; `check` turns them into named failures.
 */
export function parsePlanCatalogue(migrations) {
  const plans = new Set();
  const keys = new Set();
  const coverage = new Set();
  const sorted = [...migrations].sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));

  for (const { sql } of sorted) {
    const text = strip(sql);

    for (const m of text.matchAll(/insert\s+into\s+(?:public\.)?plans\s*\([^)]*\)\s*values([\s\S]*?);/gi)) {
      for (const row of m[1].matchAll(/\(\s*'([^']+)'/g)) plans.add(row[1]);
    }

    // The tier matrix (0531): plan_tiers × feature_tiers -> a row for every pair.
    const planTiers = [...text.matchAll(/plan_tiers\s*\(plan_id,\s*tier\)\s+as\s*\(\s*values([\s\S]*?)\)/gi)]
      .flatMap((m) => [...m[1].matchAll(/'([^']+)'(?:::text)?/g)].map((x) => x[1]));
    const featureTiers = [...text.matchAll(/feature_tiers\s*\(feature_key,\s*minimum_tier\)\s+as\s*\(\s*values([\s\S]*?)\)/gi)]
      .flatMap((m) => [...m[1].matchAll(/'([^']+)'(?:::text)?/g)].map((x) => x[1]));
    if (planTiers.length && featureTiers.length) {
      for (const p of planTiers) for (const k of featureTiers) coverage.add(`${p}${INTERNAL}${k}`);
    }

    for (const m of text.matchAll(/insert\s+into\s+(?:public\.)?plan_features\b[^;]*?values([\s\S]*?);/gi)) {
      for (const row of m[1].matchAll(/\(\s*'([^']+)'\s*,\s*'([^']+)'/g)) coverage.add(`${row[1]}${INTERNAL}${row[2]}`);
    }

    for (const m of text.matchAll(/org_features_feature_key_check[\s\S]*?features?\s+in\s*\(([\s\S]*?)\)\s*\)/gi)) {
      const found = [...m[1].matchAll(/'([a-z0-9_]+)'/g)].map((x) => x[1]);
      if (found.length) {
        keys.clear();
        found.forEach((k) => keys.add(k));
      }
    }
  }
  return { plans, keys, coverage };
}

/**
 * Assistant inventory from the shipped sources: entity keys (readEntities + ENTITY_WHITELIST) and tool
 * names (a `name: '<snake>'` literal in a file that also declares `inputSchema` — the action definition).
 */
export function parseAssistant(files) {
  const entities = new Set();
  const tools = new Set();

  for (const { name, text } of files) {
    const code = strip(text);
    if (/readEntities\.ts$/.test(name)) {
      const start = code.indexOf('AGENT_ENTITY_TABLES');
      if (start !== -1) {
        const body = code.slice(start);
        for (const m of body.matchAll(/^\s{2}([a-z][a-z0-9_]*):\s*\{/gm)) entities.add(m[1]);
      }
    }
    if (/viewspec\/types\.ts$/.test(name)) {
      const start = code.indexOf('ENTITY_WHITELIST');
      if (start !== -1) {
        const body = code.slice(start);
        for (const m of body.matchAll(/^\s{4}([a-z][a-z0-9_]*):\s*\{/gm)) entities.add(m[1]);
      }
    }
    if (code.includes('inputSchema')) {
      for (const m of code.matchAll(/name:\s*'([a-z][a-z0-9_]*)'/g)) tools.add(m[1]);
    }
  }
  return { entities, tools };
}

/**
 * The key -> assistant surface map. S4's `featureSwitches.ts` wins when present (it is the runtime seam);
 * otherwise the pre-S4 fallback states the same contract (see LEGACY_ASSISTANT_PATHS).
 */
export function parseKeyMap(files) {
  const switches = files.get('featureSwitches.ts');
  if (!switches) {
    return {
      entity: new Map(Object.entries(LEGACY_ASSISTANT_PATHS.entity)),
      tool: new Map(Object.entries(LEGACY_ASSISTANT_PATHS.tool)),
    };
  }
  const block = (name) => {
    const start = switches.indexOf(`export const ${name}`);
    const body = start === -1 ? '' : switches.slice(start, switches.indexOf('});', start));
    return new Map([...body.matchAll(/([a-z][a-z0-9_]*):\s*'([a-z][a-z0-9_]*)'/g)].map((m) => [m[1], m[2]]));
  };
  return { entity: block('ENTITY_FEATURE_KEYS'), tool: block('TOOL_FEATURE_KEYS') };
}

const FUNCTION_RE = /create\s+or\s+replace\s+function\s+(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s*\([^)]*\)[\s\S]*?\$\$([\s\S]*?)\$\$/gi;

function keyInGate(body) {
  return body.match(/assert_feature_on\s*\([^)]*?'([a-z_]+)'\s*\)/i)?.[1]
    ?? body.match(/org_feature_enabled\s*\([^)]*?'([a-z_]+)'\s*\)/i)?.[1]
    ?? body.match(/raise\s+exception\s+'feature_off'[\s\S]*?detail\s*=\s*'([a-z_]+)'/i)?.[1]
    ?? null;
}

/** Parse S2's enforcement migration: gated function name -> key, gated write table -> key. */
export function parseEnforcement(sql) {
  const text = strip(sql);
  const functions = new Map();
  for (const m of text.matchAll(FUNCTION_RE)) {
    const key = keyInGate(m[2]);
    if (key) functions.set(m[1], key);
  }
  const tables = new Map();
  const list = text.match(/join\s*\(\s*values([\s\S]*?)\)\s*as\s*m\s*\(\s*tablename\s*,\s*feature_key\s*\)/i);
  if (list) {
    for (const m of list[1].matchAll(/\(\s*'([a-z_][a-z0-9_]*)'\s*,\s*'([a-z_][a-z0-9_]*)'\s*\)/g)) {
      tables.set(m[1], m[2]);
    }
  }
  return { functions, tables };
}

// ── the rules ──────────────────────────────────────────────────────────────────────────────────

const gap = (id, message) => ({ id, message });

function basePath(path) {
  return path.split('?')[0];
}

/** Match an allowlist id: exact, or a trailing `*` prefix. */
function idMatches(entryId, gapId) {
  if (entryId === gapId) return true;
  if (entryId.endsWith('*')) return gapId.startsWith(entryId.slice(0, -1));
  return false;
}

/**
 * Check a parsed bundle. Returns human-readable errors; an empty array means the repo is complete.
 */
export function check(input) {
  const {
    routes, rail, palette, features, catalogue, assistant, keyMap, migrations = [],
    coreRoutes = {}, coreNav = {}, corePalette = {}, allowlist = [],
  } = input;
  const gaps = [];
  const keyList = features.keys;
  const keySet = new Set(keyList);
  const coreSet = new Set(features.core);

  const validKey = (key, where) => {
    if (!keySet.has(key)) gaps.push(gap(`${where}:${key}`, `${where} ${key}: switch key not in FEATURE_KEYS (${FEATURES})`));
  };

  // 1. Routes
  const seenRoutes = new Set();
  for (const { path, feature } of routes) {
    if (path === '*') continue;
    seenRoutes.add(path);
    if (feature) validKey(feature, `route ${path}`);
    else if (!(path in coreRoutes)) {
      gaps.push(gap(`route:${path}`, `route ${path}: no switch key and not marked core — wrap it in <FeatureRoute feature="…"> or add it to CORE_ROUTES`));
    }
  }
  for (const path of Object.keys(coreRoutes)) {
    if (!seenRoutes.has(path)) gaps.push(gap(`stale-core-route:${path}`, `stale core route ${path}: names no route in appRouteConfig (${APP})`));
  }

  // 2. Rail nav
  const seenNav = new Set();
  for (const { to, feature, unlessFeature } of rail) {
    seenNav.add(to);
    if (feature) validKey(feature, `nav ${to}`);
    else if (unlessFeature) validKey(unlessFeature, `nav ${to}`);
    else if (!(to in coreNav)) {
      gaps.push(gap(`nav:${to}`, `nav ${to}: no switch key and not marked core — add feature/unlessFeature or CORE_NAV (${RAIL})`));
    }
  }
  for (const to of Object.keys(coreNav)) {
    if (!seenNav.has(to)) gaps.push(gap(`stale-core-nav:${to}`, `stale core nav ${to}: names no Rail item (${RAIL})`));
  }

  // 3. Palette modules (+ drift from the Rail twin)
  const seenPalette = new Set();
  for (const { path, feature } of palette) {
    seenPalette.add(path);
    if (feature) validKey(feature, `palette ${path}`);
    else if (!(path in corePalette)) {
      gaps.push(gap(`palette:${path}`, `palette ${path}: no switch key and not marked core — add feature or CORE_PALETTE (${PALETTE})`));
    }
    const twin = rail.find((r) => basePath(r.to) === basePath(path) && r.feature);
    if (twin && feature !== twin.feature) {
      gaps.push(gap(`palette:${path}`, `palette ${path}: drift from its Rail item — Rail gates it on '${twin.feature}' but MODULES declares ${feature ? `'${feature}'` : 'no feature'} (${PALETTE})`));
    }
  }
  for (const path of Object.keys(corePalette)) {
    if (!seenPalette.has(path)) gaps.push(gap(`stale-core-palette:${path}`, `stale core palette module ${path}: names no MODULES entry (${PALETTE})`));
  }

  // 4. Registry <-> DB catalogue constraint
  if (catalogue.keys.size) {
    for (const key of keyList) {
      if (!catalogue.keys.has(key)) {
        gaps.push(gap(`dbkey:${key}`, `switch key ${key}: missing from the DB catalogue (org_features_feature_key_check, ${MIGRATIONS})`));
      }
    }
    for (const key of catalogue.keys) {
      if (!keySet.has(key)) gaps.push(gap(`dbkey-stale:${key}`, `DB catalogue key ${key}: not in FEATURE_KEYS (${FEATURES})`));
    }
  }

  // 5. Plan rows
  for (const plan of catalogue.plans) {
    for (const key of keyList) {
      if (!catalogue.coverage.has(`${plan}${INTERNAL}${key}`)) {
        gaps.push(gap(`plan:${plan}/${key}`, `plan ${plan}: no plan_features row for switch key ${key} (${MIGRATIONS})`));
      }
    }
  }
  for (const pair of catalogue.coverage) {
    const [plan, key] = pair.split(INTERNAL);
    if (!catalogue.plans.has(plan)) gaps.push(gap(`plan-unknown:${plan}/${key}`, `plan_features row for unknown plan ${plan} (${key})`));
    if (!keySet.has(key)) gaps.push(gap(`plan-key:${plan}/${key}`, `plan_features key ${key} is not a gatable FEATURE_KEYS entry (${plan})`));
    if (coreSet.has(key)) gaps.push(gap(`plan-core:${plan}/${key}`, `core key ${key} must never have a plan_features row (never gatable, D5)`));
  }

  // 6. Assistant read path per key
  const keyHasPath = new Set();
  for (const [entity, key] of keyMap.entity) {
    if (!assistant.entities.has(entity)) gaps.push(gap(`assistant-map:${entity}`, `assistant map names entity '${entity}' for ${key}, but no such entity is shipped (${ASSISTANT_DIR}/readEntities.ts or ${VIEWSPEC_TYPES})`));
    else keyHasPath.add(key);
  }
  for (const [tool, key] of keyMap.tool) {
    if (!assistant.tools.has(tool)) gaps.push(gap(`assistant-map:${tool}`, `assistant map names tool '${tool}' for ${key}, but no such action is shipped (${ASSISTANT_DIR}/*.ts inputSchema + name)`));
    else keyHasPath.add(key);
  }
  for (const key of keyList) {
    if (!keyHasPath.has(key)) gaps.push(gap(`assistant:${key}`, `switch key ${key}: no assistant read path (entity or tool) — add one in ${ASSISTANT_DIR}`));
  }
  for (const key of [...keyMap.entity.values(), ...keyMap.tool.values()]) {
    if (!keySet.has(key)) gaps.push(gap(`assistant-key:${key}`, `assistant map routes a surface to switch key ${key}, which is not in FEATURE_KEYS`));
  }

  // 7. S2 enforcement must survive later migrations (#1783 item 3)
  const enforcement = migrations.find((m) => /^\d+_.*feature_enforcement\.sql$/.test(m.name));
  if (enforcement) {
    const baseline = parseEnforcement(enforcement.sql);
    const baseNumber = Number.parseInt(enforcement.name, 10);
    for (const migration of migrations) {
      const number = Number.parseInt(migration.name, 10);
      if (!Number.isFinite(number) || number <= baseNumber) continue;
      const text = strip(migration.sql);

      for (const m of text.matchAll(FUNCTION_RE)) {
        const name = m[1];
        const key = baseline.functions.get(name);
        if (!key) continue;
        if (keyInGate(m[2]) !== key) {
          gaps.push(gap(
            `enforcement:${migration.name}:${name}`,
            `${migration.name} recreates public.${name}() without the '${key}' gate from ${enforcement.name} — call assert_feature_on() with the same key`,
          ));
        }
      }

      for (const m of text.matchAll(/create\s+policy\s+"?([a-z0-9_]+)"?\s+on\s+(?:public\.)?"?([a-z_]+)"?([\s\S]*?);/gi)) {
        const [, policy, table, rest] = m;
        const key = baseline.tables.get(table);
        if (!key) continue;
        if (!new RegExp(`org_feature_enabled\\s*\\([^)]*'${key}'`, 'i').test(rest)) {
          gaps.push(gap(
            `enforcement:${migration.name}:${policy}`,
            `${migration.name} recreates write policy ${policy} on ${table} without the '${key}' gate from ${enforcement.name} — add the org_feature_enabled conjunct`,
          ));
        }
      }
    }
  }

  // Apply the allowlist; an entry that suppresses nothing is stale.
  const used = new Set();
  const errors = [];
  for (const g of gaps) {
    const hit = allowlist
      .flatMap((entry) => (Array.isArray(entry.ids) ? entry.ids : [entry.ids]).map((id) => ({ id, entry })))
      .find(({ id }) => idMatches(id, g.id));
    if (hit) used.add(hit.id);
    else errors.push(g.message);
  }
  for (const entry of allowlist) {
    const ids = Array.isArray(entry.ids) ? entry.ids : [entry.ids];
    for (const id of ids) {
      if (!used.has(id)) {
        errors.push(`stale allowlist entry: ${id} — no matching gap any more; delete it (reason: ${entry.reason})`);
      }
      if (!entry.reason || !entry.restore) errors.push(`bad allowlist entry: ${id} — needs both a reason and a restore note`);
    }
  }
  return errors;
}

// ── real-repo run ──────────────────────────────────────────────────────────────────────────────

function readRepoBundle() {
  const migrationFiles = readdirSync(join(REPO, MIGRATIONS))
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const migrations = migrationFiles.map((name) => ({ name, sql: readFileSync(join(REPO, MIGRATIONS, name), 'utf8') }));
  const assistantFiles = readdirSync(join(REPO, ASSISTANT_DIR))
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((name) => ({ name, text: readFileSync(join(REPO, ASSISTANT_DIR, name), 'utf8') }));
  assistantFiles.push({ name: 'viewspec/types.ts', text: readFileSync(join(REPO, VIEWSPEC_TYPES), 'utf8') });
  const keyMapFiles = new Map(assistantFiles.map(({ name, text }) => [name, text]));

  return {
    routes: parseRoutes(readFileSync(join(REPO, APP), 'utf8')),
    rail: parseRail(readFileSync(join(REPO, RAIL), 'utf8')),
    palette: parsePalette(readFileSync(join(REPO, PALETTE), 'utf8')),
    features: parseFeatures(readFileSync(join(REPO, FEATURES), 'utf8')),
    catalogue: parsePlanCatalogue(migrations),
    assistant: parseAssistant(assistantFiles),
    keyMap: parseKeyMap(keyMapFiles),
    migrations,
    coreRoutes: CORE_ROUTES,
    coreNav: CORE_NAV,
    corePalette: CORE_PALETTE,
    allowlist: ALLOWLIST,
  };
}

// ── fixtures (AC-PLN-014) ─────────────────────────────────────────────────────────────────────

function selfTest() {
  let failures = 0;
  const ok = (condition, message) => {
    if (!condition) {
      failures += 1;
      console.error(`module-completeness self-test FAIL: ${message}`);
    }
  };
  const has = (errors, needle) => errors.some((e) => e.includes(needle));

  const appTsx = `
export const appRouteConfig: RouteObject[] = [
  { path: '/', element: <ExecutiveDashboard /> },
  { path: '/projects', element: <Projects /> },
  { path: '/incidents', element: <FeatureRoute feature="incidents" element={<IncidentsPage />} /> },
  { path: '/fixture-module', element: <FixturePage /> },
  { path: '*', element: <NotFoundPage /> },
];`;
  const railTsx = `const ALL_ITEMS: NavItem[] = [
  { to: '/', text: 'Dashboard', group: 'Overview' },
  { to: '/incidents', text: 'Incidents', group: 'Delivery', feature: 'incidents' },
];`;
  const paletteTs = `export const MODULES: ModuleDef[] = [
  { module: 'dashboard', path: '/' },
  { module: 'incidents', path: '/incidents', feature: 'incidents' },
];`;
  const featuresTs = `export const FEATURE_KEYS = ['incidents', 'stock'] as const;
export const CORE_FEATURES = ['projects', 'dashboard'] as const;`;
  const catalogueSql = `
insert into public.plans (id, name) values ('starter', 'Starter');
alter table public.org_features add constraint org_features_feature_key_check
  check (feature_key in ('incidents', 'stock'));
insert into public.plan_features (plan_id, feature_key, enabled) values ('starter', 'incidents', true);`;
  const readEntitiesTs = `export const AGENT_ENTITY_TABLES = {
  incidents: { table: 'incidents' },
};`;
  const whitelistTs = `export const ENTITY_WHITELIST = Object.freeze({
    projects: { table: 'projects' },
});`;
  const actionsTs = `export const queryEntityAction = { name: 'query_entity', inputSchema: {}, run: async () => {} };`;

  const base = () => ({
    routes: parseRoutes(appTsx),
    rail: parseRail(railTsx),
    palette: parsePalette(paletteTs),
    features: parseFeatures(featuresTs),
    catalogue: parsePlanCatalogue([{ name: '0531_plan_catalogue.sql', sql: catalogueSql }]),
    assistant: parseAssistant([
      { name: 'readEntities.ts', text: readEntitiesTs },
      { name: 'viewspec/types.ts', text: whitelistTs },
      { name: 'actions.ts', text: actionsTs },
    ]),
    keyMap: { entity: new Map([['incidents', 'incidents']]), tool: new Map() },
    migrations: [],
    coreRoutes: { '/': 'dashboard', '/projects': 'projects' },
    coreNav: { '/': 'dashboard' },
    corePalette: { '/': 'dashboard' },
    allowlist: [],
  });

  // AC-PLN-014: one fixture module with a route but no switch key, no plan row and no read tool.
  const errors = check(base());
  ok(has(errors, 'route /fixture-module:'), 'a route with no switch key must be named');
  ok(has(errors, 'plan starter: no plan_features row for switch key stock'), 'a missing plan row must name plan + key');
  ok(has(errors, 'switch key stock: no assistant read path'), 'a key with no read path must be named');
  ok(!has(errors, 'route /incidents:'), 'a FeatureRoute route passes');
  ok(!has(errors, 'route /:'), 'a core-marked route passes');

  // Complete bundle -> clean.
  const complete = base();
  complete.routes = complete.routes.filter((r) => r.path !== '/fixture-module');
  complete.keyMap = { entity: new Map([['incidents', 'incidents']]), tool: new Map([['stock', 'stock']]) };
  complete.assistant.tools.add('stock');
  complete.catalogue.coverage.add('starter\u0000stock');
  ok(check(complete).length === 0, `a complete bundle passes, got: ${check(complete).join(' | ')}`);

  // Allowlist: suppresses, goes stale, needs a restore note.
  const allowed = { ...base(), allowlist: [{ ids: ['route:/fixture-module', 'plan:starter/stock', 'assistant:stock'], reason: 'r', restore: 'x' }] };
  ok(check(allowed).length === 0, `allowlisted gaps pass, got: ${check(allowed).join(' | ')}`);
  const stale = { ...base(), allowlist: [{ ids: 'route:/ghost', reason: 'r', restore: 'x' }] };
  ok(has(check(stale), 'stale allowlist entry: route:/ghost'), 'a stale allowlist entry fails');
  const noRestore = { ...base(), allowlist: [{ ids: 'route:/fixture-module', reason: 'r' }] };
  ok(has(check(noRestore), 'needs both a reason and a restore note'), 'an allowlist entry without a restore note fails');

  // Enforcement recreation.
  const enforcementSql = `
create or replace function public.save_stock() returns void language plpgsql as $$
begin perform public.assert_feature_on(public.auth_org_id(), 'stock'); end $$;
do $$ begin
  for r in (select 1 join (values ('stock_items','stock')) as m(tablename, feature_key) on true) loop null; end loop;
end $$;`;
  const laterBad = `
create or replace function public.save_stock() returns void language plpgsql as $$ begin null; end $$;
create policy write_stock on public.stock_items for insert with check (true);`;
  const enforcementErrors = check({
    ...complete,
    migrations: [
      { name: '0534_feature_enforcement.sql', sql: enforcementSql },
      { name: '0600_rewrite.sql', sql: laterBad },
    ],
  });
  ok(has(enforcementErrors, '0600_rewrite.sql recreates public.save_stock()'), 'an ungated function recreation is named');
  ok(has(enforcementErrors, 'write_stock'), 'an ungated policy recreation is named');

  if (failures) {
    console.error(`module-completeness self-test: ${failures} failure(s)`);
    process.exit(1);
  }
  console.log('module-completeness self-test: OK');
}

// ── main ──────────────────────────────────────────────────────────────────────────────────────

function main() {
  if (process.argv.includes('--self-test')) {
    selfTest();
    return;
  }
  const errors = check(readRepoBundle());
  if (errors.length) {
    for (const error of errors) console.error(`module-completeness: ${error}`);
    console.error(`\nmodule-completeness: ${errors.length} missing registration(s). Mark a module core, add the switch/plan row/read path, or justify an ALLOWLIST entry with a restore note.`);
    process.exit(1);
  }
  console.log('module-completeness: OK');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
