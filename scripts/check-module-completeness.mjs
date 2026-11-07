#!/usr/bin/env node
/**
 * Guard: the D13 module-completeness rule — a module cannot ship half-registered (FR-PLN-015,
 * AC-PLN-014). Every module surface must carry its plan switch (or an explicit core marking), every
 * switch key must have a plan row for every plan and at least one assistant read path, and a
 * migration after an enforcement migration cannot quietly recreate a gated function or write
 * policy without its gate (#1783 item 3).
 *
 * Sources are the shipped ones — never a hand-kept list beside them:
 *   routes      pmo-portal/App.tsx                              appRouteConfig (routes as data)
 *   nav         pmo-portal/src/components/shell/Rail.tsx        ALL_ITEMS
 *   palette     pmo-portal/src/components/shell/routeMatch.ts   MODULES (the ⌘K Navigate group)
 *   registry    pmo-portal/src/lib/features.ts                  FEATURE_KEYS / CORE_FEATURES
 *   catalogue   supabase/migrations/*.sql                       plans, the tier matrix, explicit rows,
 *                                                               the latest org_features key CHECK
 *   assistant   supabase/functions/agent-chat/*.ts              read entities + named tools
 *   key map     supabase/functions/agent-chat/featureSwitches.ts (S4) — pre-S4 fallback below
 *   enforcement supabase/migrations/*_enforcement.sql            the gated tables/functions that exist
 *                                                               TODAY (0081) plus S2's 0534 when it merges
 *
 * Core modules are marked HERE (`CORE_ROUTES`/`CORE_NAV`/`CORE_PALETTE`: path -> reason) because the
 * alternative — a marker comment in App.tsx / Rail.tsx — collides with the FE slices rewriting them.
 * A stale entry fails, so the list cannot outlive the surface it names.
 *
 * Existing gaps live in `ALLOWLIST` — one justified entry per systemic gap, each naming its restoring
 * slice. Every entry must suppress at least one real gap: a stale entry is itself a failure, so the
 * list cannot decay into "everything".
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
  '/calendar': 'calendar — a view of core tasks and milestones, no switch key',
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
  '/integrations': 'personal M365 connect — the token-custody callback surface; stays routable (S3)',
  '/settings/profile': 'personal settings',
  '/master-data/:kind': 'Odoo master-data mirror — no switch key of its own (S3 inventory)',
};

/** Rail items with no entitlement (mirrors CORE_ROUTES for the same modules). */
export const CORE_NAV = {
  '/': 'dashboard — core',
  '/projects': 'projects — core',
  '/equipment': 'equipment — not a catalogue module',
  '/expenses': 'expense_claims — core',
  '/approvals': 'approvals — core',
  '/my-tasks': 'tasks — core',
  '/calendar': 'calendar — a view of core tasks and milestones',
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
  '/calendar': 'calendar — a view of core tasks and milestones',
  '/approvals': 'approvals — core',
  '/finance': 'Finance hub — role-gated, no entitlement',
  '/administration': 'administration — core',
};

/**
 * The assistant's pre-S4 key map. S4's `featureSwitches.ts` is the runtime seam and REPLACES this the
 * moment it merges; until then the gate needs the same contract to prove every key reaches a read
 * path. Delete this constant (and the `parseKeyMap` fallback) when `featureSwitches.ts` is on dev.
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
    // D17 (#1783 item 1): receipts are a BASIC read; procurement_full is line-level + the match
    // (no assistant read entity of its own — covered by the ALLOWLIST entry below).
    procurement_receipts: 'procurement',
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
 * Existing gaps on dev, each with the slice that restores it. Remove an entry the moment its gaps
 * close (a stale entry fails).
 */
export const ALLOWLIST = [
  {
    ids: ['route:/incoming-payments/:receiptId'],
    reason: 'revenue detail route; S3 gates the redirects but not this one',
    restore: 'Delete when S3 gates it on `revenue` or rules it core.',
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
    reason:
      'no assistant-visible entity/tool for these keys yet (D13 wants a read tool when the module ships; S4 owns the runtime map)',
    restore: 'Delete each line when its module ships a read tool/entity in agent-chat.',
  },
  {
    ids: ['assistant:feedback_surveys'],
    reason: 'Admin-owned switch (0419); S4 deliberately gives it no assistant surface',
    restore: 'Delete only if the owner gives the assistant a feedback-surveys read path.',
  },
  {
    ids: ['assistant:procurement_full'],
    reason: 'Line-level receipt writes and the order/receipt/invoice match have no assistant read entity; existing receipt reads are Basic (procurement) since D17 #1783 item 1',
    restore: 'Remove when a Full-only assistant read entity or named read tool ships.',
  },
  {
    ids: [
      'enforcement:0646_rls_caller_initplans.sql:stock_items_select',
      'enforcement:0646_rls_caller_initplans.sql:stock_units_select',
      'enforcement:0646_rls_caller_initplans.sql:stock_warehouses_select',
    ],
    reason:
      'ALTER POLICY cannot change a policy command, so these are still the SELECT policies 0412 created (dynamically, via execute format, so the scanner has no prior state for them); the ALTER only adds a scalar-subselect wrapper to the expression copied from the catalog, and a SELECT policy never carries the stock write gate (0534 gates writes only).',
    restore:
      'Delete when the enforcement scanner derives an ALTER policy command from the prior state (or from the dynamic creation) instead of defaulting a command-less ALTER to ALL.',
  },
];

// ── source scanning helpers (pure) ──────────────────────────────────────────────────────────────

/** SQL: drop line and block comments (the check-retention.mjs idiom). */
export const strip = (sql) => sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * TS/TSX: blank line/block comments, keeping string literals intact (field regexes read them).
 * Same-length replacement, so indices still line up with the original text.
 */
export function stripTsComments(text) {
  const out = text.split('');
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (c === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') out[i++] = ' ';
    } else if (c === '/' && next === '*') {
      out[i++] = ' ';
      out[i++] = ' ';
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        if (text[i] !== '\n') out[i] = ' ';
        i += 1;
      }
      if (i < text.length) {
        out[i++] = ' ';
        out[i++] = ' ';
      }
    } else if (c === "'" || c === '"' || c === '`') {
      i += 1;
      while (i < text.length) {
        if (text[i] === '\\') i += 2;
        else if (text[i] === c) {
          i += 1;
          break;
        } else i += 1;
      }
    } else i += 1;
  }
  return out.join('');
}

/** TS/TSX structure: like stripTsComments, but string interiors are blanked too, so a brace or
 *  bracket inside a literal can never shift the scan. Used only for region/object splitting. */
function structure(text) {
  const out = stripTsComments(text).split('');
  const masked = stripTsComments(text);
  let i = 0;
  while (i < masked.length) {
    const c = masked[i];
    if (c === "'" || c === '"' || c === '`') {
      i += 1;
      while (i < masked.length) {
        if (masked[i] === '\\') {
          out[i] = ' ';
          if (i + 1 < masked.length) out[i + 1] = ' ';
          i += 2;
        } else if (masked[i] === c) {
          i += 1;
          break;
        } else {
          if (masked[i] !== '\n') out[i] = ' ';
          i += 1;
        }
      }
    } else i += 1;
  }
  return out.join('');
}

/** Index just past the bracket that closes the opener at `open` (`[` / `(` / `{`), or -1. */
const PAIRS = { '[': ']', '(': ')', '{': '}' };

function matchingClose(text, open) {
  const opener = text[open];
  const pair = PAIRS[opener];
  if (!pair) return -1;
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === opener) depth += 1;
    else if (text[i] === pair) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** The `[ ... ]` value region that follows `marker` (an identifier) in a TS source, as [start, end]. */
function arrayRegion(structured, marker) {
  const at = structured.indexOf(marker);
  if (at === -1) return null;
  const equals = structured.indexOf('=', at);
  if (equals === -1) return null;
  const open = structured.indexOf('[', equals);
  if (open === -1) return null;
  const close = matchingClose(structured, open);
  return close === -1 ? null : [open, close];
}

/** Top-level `{ ... }` blocks inside the array that follows `marker`. Returns ORIGINAL slices. */
function objectBlocks(text, marker) {
  const structured = structure(text);
  const region = arrayRegion(structured, marker);
  if (!region) return [];
  const [open, close] = region;
  const blocks = [];
  let depth = 0;
  let start = -1;
  for (let i = open; i <= close; i += 1) {
    const ch = structured[i];
    if (ch === '{') {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0 && start !== -1) {
        blocks.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return blocks;
}

/** Field regex over a block: `name: 'value'` first match. */
const field = (block, name) => block.match(new RegExp(`${name}\\s*:\\s*'([^']*)'`))?.[1] ?? null;

/** `feature="key"` / `feature='key'` / `feature={'key'}` inside a JSX element. */
function jsxFeature(block) {
  return block.match(/FeatureRoute[\s\S]{0,300}?feature=(?:"([^"]+)"|'([^']+)'|\{[^}]*?'([^']+)')/);
}

/** `pmo-portal/App.tsx` appRouteConfig -> [{ path, feature }] (the `*` catch-all included).
 *  Comments are blanked before matching: a `/* TODO: gate this *\/` note is not a gate (#1783 review). */
export function parseRoutes(appTsx) {
  return objectBlocks(appTsx, 'export const appRouteConfig')
    .map((block) => {
      const code = stripTsComments(block);
      const path = field(code, 'path');
      const feature = jsxFeature(code);
      const helperFeature = code.match(/\bgated\s*\(\s*['"]([^'"]+)['"]/);
      return { path, feature: feature ? (feature[1] ?? feature[2] ?? feature[3]) : (helperFeature?.[1] ?? null) };
    })
    .filter((route) => route.path);
}

/** Rail.tsx ALL_ITEMS -> [{ to, feature, unlessFeature }]. Comment text is not a gate. */
export function parseRail(railTsx) {
  return objectBlocks(railTsx, 'const ALL_ITEMS')
    .map((raw) => {
      const block = stripTsComments(raw);
      return {
        to: field(block, 'to'),
        feature: field(block, 'feature'),
        unlessFeature: field(block, 'unlessFeature'),
      };
    })
    .filter((item) => item.to);
}

/** routeMatch.ts MODULES -> [{ path, feature, unlessFeature }]. Comment text is not a gate. */
export function parsePalette(routeMatchTs) {
  return objectBlocks(routeMatchTs, 'export const MODULES')
    .map((raw) => {
      const block = stripTsComments(raw);
      return { path: field(block, 'path'), feature: field(block, 'feature'), unlessFeature: field(block, 'unlessFeature') };
    })
    .filter((module) => module.path);
}

/** features.ts -> { keys: FEATURE_KEYS, core: CORE_FEATURES }. */
export function parseFeatures(featuresTs) {
  const commentsStripped = stripTsComments(featuresTs);
  const structured = structure(featuresTs);
  const list = (name) => {
    const region = arrayRegion(structured, `export const ${name}`);
    if (!region) return [];
    const body = commentsStripped.slice(region[0], region[1] + 1);
    return [...body.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
  };
  return { keys: list('FEATURE_KEYS'), core: list('CORE_FEATURES') };
}

const INTERNAL = '\u0000';

/** CTE body (`name(cols) as ( values…)`) -> its quoted tokens. */
function cteKeys(sql, name) {
  const at = sql.search(new RegExp(`${name}\\s*\\([^)]*\\)\\s+as\\s*\\(`, 'i'));
  if (at === -1) return [];
  const m = sql.slice(at).match(new RegExp(`${name}\\s*\\([^)]*\\)\\s+as\\s*\\(`, 'i'));
  const open = at + m[0].length - 1;
  const close = matchingClose(sql, open);
  if (close === -1) return [];
  return [...sql.slice(open, close).matchAll(/'([a-z][a-z0-9_]*)'/g)].map((x) => x[1]);
}

/**
 * Replay the plan seed migrations: plans, the tier matrix, explicit plan_features rows, and the
 * latest org_features feature-key CHECK. Returns sets; `check` turns them into named failures.
 */
export function parsePlanCatalogue(migrations) {
  const plans = new Set();
  const keys = new Set();
  const coverage = new Set();
  const sorted = [...migrations].sort((a, b) =>
    a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' }),
  );

  for (const { sql } of sorted) {
    const text = strip(sql);

    for (const m of text.matchAll(/insert\s+into\s+(?:public\.)?plans\s*\([^)]*\)\s*values([\s\S]*?);/gi)) {
      for (const row of m[1].matchAll(/\(\s*'([a-z0-9_]+)'\s*,/g)) plans.add(row[1]);
    }
    for (const m of text.matchAll(/plans_id_check\s+check\s*\(\s*id\s+in\s*\(([\s\S]*?)\)\s*\)/gi)) {
      for (const row of m[1].matchAll(/'([a-z0-9_]+)'/g)) plans.add(row[1]);
    }

    // 0531's matrix: plan_tiers × feature_tiers -> one row for every pair.
    const planTiers = cteKeys(text, 'plan_tiers');
    const featureTiers = cteKeys(text, 'feature_tiers');
    if (planTiers.length && featureTiers.length) {
      for (const plan of planTiers) for (const key of featureTiers) coverage.add(`${plan}${INTERNAL}${key}`);
    }

    for (const m of text.matchAll(/insert\s+into\s+(?:public\.)?plan_features\b[^;]*?values([\s\S]*?);/gi)) {
      for (const row of m[1].matchAll(/\(\s*'([a-z0-9_]+)'\s*,\s*'([a-z0-9_]+)'/g)) {
        coverage.add(`${row[1]}${INTERNAL}${row[2]}`);
      }
    }

    // Latest key CHECK wins (0531 restates 0530's list).
    for (const m of text.matchAll(
      /org_features_feature_key_check\s+check\s*\(\s*feature_key\s+in\s*\(([\s\S]*?)\)\s*\)/gi,
    )) {
      const found = [...m[1].matchAll(/'([a-z0-9_]+)'/g)].map((x) => x[1]);
      if (found.length) {
        keys.clear();
        found.forEach((key) => keys.add(key));
      }
    }
  }
  return { plans, keys, coverage };
}

/**
 * Assistant inventory from the shipped sources: read entities (`AGENT_READ_ENTITIES` in
 * readEntities.ts plus `ENTITY_WHITELIST` keys in viewspec/types.ts) and tool names (a
 * `name: '<snake>'` literal in a file that also declares `inputSchema` — an action definition).
 */
export function parseAssistant(files) {
  const entities = new Set();
  const tools = new Set();

  for (const { name, text } of files) {
    const code = stripTsComments(text);
    if (/readEntities\.ts$/.test(name)) {
      const structured = structure(text);
      const region = arrayRegion(structured, 'export const AGENT_READ_ENTITIES');
      if (region) {
        for (const m of code.slice(region[0], region[1] + 1).matchAll(/'([a-z][a-z0-9_]*)'/g)) {
          entities.add(m[1]);
        }
      }
    }
    if (/viewspec\/types\.ts$/.test(name)) {
      const at = code.indexOf('export const ENTITY_WHITELIST');
      if (at !== -1) {
        const structured = structure(text);
        const open = structured.indexOf('{', at);
        const close = open === -1 ? -1 : matchingClose(structured, open);
        if (close !== -1) {
          // One key per entry line at the Object.freeze level (the fixture/real file both indent 4).
          for (const m of text.slice(open, close + 1).matchAll(/^\s{4}([a-z][a-z0-9_]*):\s*\{/gm)) {
            entities.add(m[1]);
          }
        }
      }
    }
    if (code.includes('inputSchema')) {
      // A tool is an ACTION OBJECT: a brace block that declares both a name and an inputSchema, so a
      // stray `name:` literal elsewhere in the same file (telemetry, a non-tool const) is not one.
      const structured = structure(text);
      for (let i = 0; i < structured.length; i += 1) {
        if (structured[i] !== '{') continue;
        const close = matchingClose(structured, i);
        if (close === -1) continue;
        const block = text.slice(i, close + 1);
        if (!block.includes('inputSchema')) continue;
        const name = block.match(/name:\s*'([a-z][a-z0-9_]*)'/)?.[1];
        if (name) tools.add(name);
      }
    }
  }
  return { entities, tools };
}

/**
 * The key -> assistant surface map. S4's `featureSwitches.ts` wins when present (it is the runtime
 * seam); otherwise the pre-S4 fallback states the same contract (LEGACY_ASSISTANT_PATHS).
 */
export function parseKeyMap(files) {
  if (!files.has('featureSwitches.ts')) {
    return {
      entity: new Map(Object.entries(LEGACY_ASSISTANT_PATHS.entity)),
      tool: new Map(Object.entries(LEGACY_ASSISTANT_PATHS.tool)),
    };
  }
  const switches = stripTsComments(files.get('featureSwitches.ts'));
  const structured = structure(switches);
  const block = (name) => {
    const at = structured.indexOf(`export const ${name}`);
    if (at === -1) return new Map();
    const open = structured.indexOf('{', at);
    const close = open === -1 ? -1 : matchingClose(structured, open);
    if (close === -1) return new Map();
    const body = switches.slice(open, close + 1);
    return new Map([...body.matchAll(/([a-z][a-z0-9_]*)\s*:\s*'([a-z][a-z0-9_]*)'/g)].map((m) => [m[1], m[2]]));
  };
  return { entity: block('ENTITY_FEATURE_KEYS'), tool: block('TOOL_FEATURE_KEYS') };
}

// ── S2 enforcement: a later migration must keep the gate (#1783 item 3) ─────────────────────────

/** An enforcement migration: 0081/0534 or a later numbered enforcement baseline. */
const ENFORCEMENT_FILE_RE = /^\d+_.*_enforcement\.sql$/i;

/**
 * A function definition, with its body in either Postgres body form that appears in this repo:
 * dollar-quoted with an optional tag (`$$ … $$`, `$body$ … $body$`) or single-quoted (`as '…'`).
 * The `as` anchor matters: a lazy scan that accepts any quoted string would swallow `set search_path
 * to 'public'` as the "body" and then miss the real one.
 */
const FUNCTION_RE = new RegExp(
  String.raw`create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s*\([^)]*\)[\s\S]*?\bas\s+(?:\$\w*\$([\s\S]*?)\$\w*\$|'((?:[^']|'')*)')`,
  'gi',
);

/** A `create policy` / `alter policy` statement: kind, policy name, table, and the rest of the body. */
const POLICY_RE =
  /\b(create|alter)\s+policy\s+(?:if\s+not\s+exists\s+)?"?([a-z0-9_]+)"?\s+on\s+(?:public\.)?"?([a-z0-9_]+)"?([\s\S]*?);/gi;
const POLICY_EVENT_RE =
  /\b(create|alter|drop)\s+policy\s+(?:(?:if\s+(?:not\s+)?exists)\s+)?"?([a-z0-9_]+)"?\s+on\s+(?:public\.)?"?([a-z0-9_]+)"?([\s\S]*?);/gi;

/** A function body from a FUNCTION_RE match (dollar-quoted or single-quoted). */
const functionBody = (m) => m[2] ?? m[3] ?? '';

/** Arguments of the first `<name>(...)` call in `text` (balanced parens), or null. */
function firstCallArgs(text, name) {
  const m = text.match(new RegExp(`${name}\\s*\\(`));
  if (!m) return null;
  const open = m.index + m[0].length - 1;
  const close = matchingClose(text, open);
  return close === -1 ? null : text.slice(open, close + 1);
}

/** The switch keys quoted in the first `<helper>(…)` call of `text`, last one being the key. */
function keyOfCall(text, helper) {
  const args = firstCallArgs(text, helper);
  if (!args) return null;
  const keys = [...args.matchAll(/'([a-z][a-z0-9_]*)'/g)].map((x) => x[1]);
  return keys.length ? keys[keys.length - 1] : null;
}

/**
 * The switch key a FUNCTION body gates on, or null. Only the RAISING form counts: `assert_feature_on`
 * (0534 §A) or an explicit `raise exception 'feature_off'`. `org_feature_enabled` is the policy-side
 * predicate — it RETURNS false instead of raising — so a definer body that copies the RLS conjunct
 * idiom never refuses the call and is not a gate (#1783 item 3).
 */
function keyInFunctionGate(body) {
  const asserted = keyOfCall(body, 'assert_feature_on');
  if (asserted) return asserted;
  const detail = body.match(/raise\s+exception\s+'feature_off'[\s\S]{0,200}?detail\s*=\s*'([a-z][a-z0-9_]*)'/i);
  return detail ? detail[1] : null;
}

/** Does a POLICY predicate carry `org_feature_enabled(…, '<key>')`? Every call is inspected, so a
 *  predicate that conjoins two keys (`procurement` and `procurement_full`) matches on either. */
function policyHasGate(body, key) {
  for (const call of body.matchAll(/org_feature_enabled\s*\(/gi)) {
    const open = call.index + call[0].length - 1;
    const close = matchingClose(body, open);
    if (close === -1) continue;
    const args = body.slice(open, close + 1);
    if ([...args.matchAll(/'([a-z][a-z0-9_]*)'/g)].some((x) => x[1] === key)) return true;
  }
  return false;
}

/** The key a BASELINE migration gates a function on, in whichever form it declares (the baseline is
 *  descriptive — it records what exists). A *recreation* must use the raising form (keyInFunctionGate). */
const keyInAnyFunctionGate = (body) => keyInFunctionGate(body) ?? keyOfCall(body, 'org_feature_enabled');

/** `create policy`: the command it applies to (`for <cmd>`), defaulting to `all`. Read from the head of
 *  the statement, before any predicate, so a `select` inside `using (…)` can never be mistaken for it. */
function policyCommand(body) {
  const head = body.split(/\busing\b|\bwith\s+check\b/i)[0];
  const m = head.match(/\bfor\s+(all|select|insert|update|delete)\b/i);
  return m ? m[1].toLowerCase() : 'all';
}

/** Is this policy RESTRICTIVE (`as restrictive`)? A restrictive policy only narrows what its permissive
 *  twin allows, so a feature conjunct is not where the gate lives (0081 gates the permissive policy). */
const isRestrictive = (body) => /\bas\s+restrictive\b/i.test(body);

/**
 * Parse an enforcement migration: gated function name -> key, gated write table -> key. Table baselines
 * can be declared by 0081's `case <alias>.tablename when 'table' then 'key' … end` mapping, S2's
 * `join (values ('table','key'), …) as m(tablename, feature_key)` list, or explicit gated permissive
 * write-policy definitions in a later enforcement migration.
 */
export function parseEnforcement(sql) {
  const text = strip(sql);
  const functions = new Map();
  for (const m of text.matchAll(FUNCTION_RE)) {
    const key = keyInAnyFunctionGate(functionBody(m));
    if (key) functions.set(m[1], key);
  }
  const tables = new Map();
  const policies = new Map();
  const list = text.match(/join\s*\(\s*values([\s\S]*?)\)\s*as\s*m\s*\(\s*tablename\s*,\s*feature_key\s*\)/i);
  if (list) {
    for (const m of list[1].matchAll(/\(\s*'([a-z_][a-z0-9_]*)'\s*,\s*'([a-z_][a-z0-9_]*)'\s*\)/g)) {
      tables.set(m[1], m[2]);
    }
  }
  for (const block of text.matchAll(/case\s+(?:[a-z_][a-z0-9_]*\.)?tablename([\s\S]*?)\bend\b/gi)) {
    for (const m of block[1].matchAll(/when\s+'([a-z_][a-z0-9_]*)'\s*then\s+'([a-z_][a-z0-9_]*)'/gi)) {
      tables.set(m[1], m[2]);
    }
  }
  for (const m of text.matchAll(POLICY_RE)) {
    const [, kind, , table, body] = m;
    if (kind.toLowerCase() !== 'create' || policyCommand(body) === 'select' || isRestrictive(body)) continue;
    const key = keyOfCall(body, 'org_feature_enabled');
    if (key) policies.set(`${table}${INTERNAL}${m[2]}`, { table, key });
  }
  return { functions, tables, policies };
}

/**
 * The gate each table/function carries TODAY, and the latest enforcement migration that establishes
 * it. A higher-numbered migration must preserve it; the baseline migration itself is not a
 * "recreation". Folding every enforcement migration includes 0081's live list, S2's 0534 catalogue,
 * and explicit policy baselines added when a previously composed table is repaired.
 */
export function enforcementBaseline(migrations) {
  const functions = new Map();
  const tables = new Map();
  const policies = new Map();
  const ordered = [...migrations]
    .filter((m) => ENFORCEMENT_FILE_RE.test(m.name))
    .sort((a, b) => Number.parseInt(a.name, 10) - Number.parseInt(b.name, 10));
  for (const migration of ordered) {
    const since = Number.parseInt(migration.name, 10);
    if (!Number.isFinite(since)) continue;
    const parsed = parseEnforcement(migration.sql);
    for (const [name, key] of parsed.functions) functions.set(name, { key, since, file: migration.name });
    for (const [table, key] of parsed.tables) tables.set(table, { key, since, file: migration.name });
    for (const [policy, gate] of parsed.policies) {
      policies.set(policy, { key: gate.key, since, file: migration.name });
    }
  }
  return { functions, tables, policies };
}


// ── the rules ──────────────────────────────────────────────────────────────────────────────────

const basePath = (path) => path.split('?')[0];

/** Match an allowlist id: exact, or a trailing `*` prefix. */
function idMatches(entryId, gapId) {
  if (entryId === gapId) return true;
  if (entryId.endsWith('*')) return gapId.startsWith(entryId.slice(0, -1));
  return false;
}

/**
 * Check a parsed bundle. Returns human-readable errors (each naming the missing artefact); an empty
 * array means the repo is complete.
 */
export function check(input) {
  const {
    routes = [],
    rail = [],
    palette = [],
    features = { keys: [], core: [] },
    catalogue = { plans: new Set(), keys: new Set(), coverage: new Set() },
    assistant = { entities: new Set(), tools: new Set() },
    keyMap = { entity: new Map(), tool: new Map() },
    migrations = [],
    coreRoutes = {},
    coreNav = {},
    corePalette = {},
    allowlist = [],
  } = input;

  const gaps = [];
  const gap = (id, message) => gaps.push({ id, message });
  const keyList = features.keys;
  const keySet = new Set(keyList);
  const coreSet = new Set(features.core);
  const validKey = (key, where) => {
    if (!keySet.has(key)) {
      gaps.push({
        id: `badkey:${where}`,
        message: `${where} uses switch key '${key}', which is not in FEATURE_KEYS (${FEATURES})`,
      });
    }
  };

  // 1. Routes
  const seenRoutes = new Set();
  for (const { path, feature } of routes) {
    if (path === '*') continue;
    seenRoutes.add(path);
    if (feature) validKey(feature, `route ${path}`);
    else if (!(path in coreRoutes)) {
      gap(
        `route:${path}`,
        `route ${path}: no switch key and no core marking — wrap it in <FeatureRoute feature="…"> (${APP}) or add it to CORE_ROUTES in this guard`,
      );
    }
  }
  for (const path of Object.keys(coreRoutes)) {
    if (!seenRoutes.has(path)) {
      gap(`stale-core-route:${path}`, `stale core route ${path}: names no route in appRouteConfig (${APP})`);
    }
  }

  // 2. Rail nav
  const seenNav = new Set();
  for (const { to, feature, unlessFeature } of rail) {
    seenNav.add(to);
    if (feature) validKey(feature, `nav ${to}`);
    else if (unlessFeature) validKey(unlessFeature, `nav ${to}`);
    else if (!(to in coreNav)) {
      gap(`nav:${to}`, `nav ${to}: no switch key and no core marking — set feature/unlessFeature (${RAIL}) or add it to CORE_NAV in this guard`);
    }
  }
  for (const to of Object.keys(coreNav)) {
    if (!seenNav.has(to)) gap(`stale-core-nav:${to}`, `stale core nav ${to}: names no Rail item (${RAIL})`);
  }

  // 3. ⌘K palette modules (+ drift from the Rail twin, when the Rail gates it)
  const seenPalette = new Set();
  for (const { path, feature, unlessFeature } of palette) {
    seenPalette.add(path);
    if (feature) validKey(feature, `palette ${path}`);
    else if (unlessFeature) validKey(unlessFeature, `palette ${path}`);
    else if (!(path in corePalette)) {
      gap(`palette:${path}`, `palette ${path}: no switch key and no core marking — add feature (${PALETTE}) or CORE_PALETTE in this guard`);
    }
    const gatedTwin = (item) => item.feature || item.unlessFeature;
    const twin = rail.find((item) => item.to === path && gatedTwin(item))
      ?? rail.find((item) => basePath(item.to) === basePath(path) && gatedTwin(item));
    if (twin && (feature !== twin.feature || unlessFeature !== twin.unlessFeature)) {
      const railGate = twin.feature ? `feature '${twin.feature}'` : `unlessFeature '${twin.unlessFeature}'`;
      const paletteGate = feature ? `feature '${feature}'` : unlessFeature ? `unlessFeature '${unlessFeature}'` : 'no feature';
      gap(`palette:${path}`, `palette ${path}: drift from its Rail item — Rail gates it on ${railGate} but MODULES declares ${paletteGate} (${PALETTE})`);
    }
  }
  for (const path of Object.keys(corePalette)) {
    if (!seenPalette.has(path)) {
      gap(`stale-core-palette:${path}`, `stale core palette module ${path}: names no MODULES entry (${PALETTE})`);
    }
  }

  // 4. FE registry <-> the DB catalogue's key CHECK
  if (catalogue.keys.size) {
    for (const key of keyList) {
      if (!catalogue.keys.has(key)) {
        gap(`dbkey:${key}`, `switch key ${key}: missing from the DB catalogue key CHECK (${MIGRATIONS})`);
      }
    }
    for (const key of catalogue.keys) {
      if (!keySet.has(key)) gap(`dbkey-stale:${key}`, `DB catalogue key ${key}: not in FEATURE_KEYS (${FEATURES})`);
      if (coreSet.has(key)) gap(`dbkey-core:${key}`, `DB catalogue key ${key}: is a CORE_FEATURES key and must never be gatable`);
    }
  }

  // 5. Plan rows — every plan × every switch key resolves to a plan_features row
  for (const plan of catalogue.plans) {
    for (const key of keyList) {
      if (!catalogue.coverage.has(`${plan}${INTERNAL}${key}`)) {
        gap(`plan:${plan}/${key}`, `plan ${plan}: no plan_features row for switch key ${key} (${MIGRATIONS})`);
      }
    }
  }
  for (const pair of catalogue.coverage) {
    const [plan, key] = pair.split(INTERNAL);
    if (!catalogue.plans.has(plan)) gap(`plan-unknown:${plan}/${key}`, `plan_features row names unknown plan '${plan}' (key ${key}; ${MIGRATIONS})`);
    if (!keySet.has(key)) gap(`plan-key:${plan}/${key}`, `plan_features row for '${plan}' carries key '${key}', which is not a gatable FEATURE_KEYS entry (${FEATURES})`);
    if (coreSet.has(key)) gap(`plan-core:${plan}/${key}`, `core key ${key} must never have a plan_features row (never gatable, D5; ${MIGRATIONS})`);
  }

  // 6. Assistant read path per key
  const keyHasPath = new Set();
  for (const [entity, key] of keyMap.entity) {
    if (!assistant.entities.has(entity)) {
      gap(`assistant-map:${entity}`, `assistant key map names entity '${entity}' for ${key}, but no such read entity is shipped (${ASSISTANT_DIR}/readEntities.ts or ${VIEWSPEC_TYPES})`);
    } else keyHasPath.add(key);
  }
  for (const [tool, key] of keyMap.tool) {
    if (!assistant.tools.has(tool)) {
      gap(`assistant-map:${tool}`, `assistant key map names tool '${tool}' for ${key}, but no such action is shipped (no \`name: '${tool}'\` beside an inputSchema in ${ASSISTANT_DIR})`);
    } else keyHasPath.add(key);
  }
  for (const key of keyList) {
    if (!keyHasPath.has(key)) {
      gap(`assistant:${key}`, `switch key ${key}: no assistant read path — add a read entity (${ASSISTANT_DIR}/readEntities.ts) or a named read tool (${ASSISTANT_DIR}/*.ts)`);
    }
  }
  for (const key of new Set([...keyMap.entity.values(), ...keyMap.tool.values()])) {
    if (!keySet.has(key)) {
      gap(`assistant-key:${key}`, `assistant key map routes a surface to switch key ${key}, which is not in FEATURE_KEYS (${FEATURES})`);
    }
  }

  // 7. A gate that exists today must survive every later migration (#1783 item 3). The baseline is
  // every enforcement migration (0081's live list, S2's 0534, and explicit later policy baselines).
  const baseline = enforcementBaseline(migrations);
  if (baseline.functions.size || baseline.tables.size || baseline.policies.size) {
    const orderedMigrations = [...migrations].sort((a, b) => Number.parseInt(a.name, 10) - Number.parseInt(b.name, 10));
    const policyState = new Map();
    for (const migration of orderedMigrations) {
      const number = Number.parseInt(migration.name, 10);
      if (!Number.isFinite(number)) continue;
      // DDL assembled by EXECUTE is a string, not a policy statement in the source migration.
      const text = strip(migration.sql).replace(/\bexecute\s+'(?:[^']|'')*'/gi, (match) => ' '.repeat(match.length));

      for (const m of text.matchAll(FUNCTION_RE)) {
        const name = m[1];
        const gate = baseline.functions.get(name);
        if (!gate || number <= gate.since) continue;
        if (keyInFunctionGate(functionBody(m)) !== gate.key) {
          gap(
            `enforcement:${migration.name}:${name}`,
            `${migration.name} recreates public.${name}() without the '${gate.key}' gate from ${gate.file} — call the RAISING assert_feature_on(…, '${gate.key}') in the same definition (org_feature_enabled only returns false; it is the policy-side predicate)`,
          );
        }
      }

      for (const m of text.matchAll(POLICY_EVENT_RE)) {
        const [, rawKind, policy, table, body] = m;
        const kind = rawKind.toLowerCase();
        const id = `${table}${INTERNAL}${policy}`;
        if (kind === 'drop') {
          policyState.delete(id);
          continue;
        }

        const prior = policyState.get(id);
        if (kind === 'alter' && !/\busing\s*\(|\bwith\s+check\s*\(/i.test(body)) continue;
        const current = kind === 'create'
          ? { cmd: policyCommand(body), restrictive: isRestrictive(body) }
          : prior ?? { cmd: policyCommand(body), restrictive: isRestrictive(body) };
        policyState.set(id, current);

        const tableGate = baseline.tables.get(table);
        const policyGate = baseline.policies.get(id);
        const gate = policyGate ?? tableGate;
        if (!gate || number <= gate.since) continue;
        // 0081 gates the PERMISSIVE write policy: a read policy needs no gate, and a restrictive
        // policy only narrows its permissive twin (where the gate lives).
        if (current.cmd === 'select' || current.restrictive) continue;
        if (!policyHasGate(body, gate.key)) {
          gap(
            `enforcement:${migration.name}:${policy}`,
            `${migration.name} recreates write policy ${policy} on ${table} without the '${gate.key}' gate from ${gate.file} — keep the org_feature_enabled(…, '${gate.key}') conjunct (a deliberate re-boundary must be an ALLOWLIST entry naming the new key)`,
          );
        }
      }
    }
  }

  // Apply the allowlist; an entry that suppresses nothing is stale.
  const entries = allowlist.flatMap((entry) => (Array.isArray(entry.ids) ? entry.ids : [entry.ids]).map((id) => ({ id, entry })));
  const used = new Set();
  const errors = [];
  for (const g of gaps) {
    const hit = entries.find(({ id }) => idMatches(id, g.id));
    if (hit) used.add(hit.id);
    else errors.push(g.message);
  }
  for (const entry of allowlist) {
    const ids = Array.isArray(entry.ids) ? entry.ids : [entry.ids];
    for (const id of ids) {
      if (!entry.reason || !entry.restore) {
        errors.push(`bad allowlist entry: ${id} — needs both a reason and a restore note`);
      } else if (!used.has(id)) {
        errors.push(`stale allowlist entry: ${id} — no matching gap any more; delete it (reason: ${entry.reason})`);
      }
    }
  }
  return errors;
}

// ── real-repo run ──────────────────────────────────────────────────────────────────────────────

function readRepoBundle() {
  const migrationFiles = readdirSync(join(REPO, MIGRATIONS)).filter((f) => f.endsWith('.sql')).sort();
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
  const has = (errors, needle) => errors.some((error) => error.includes(needle));

  const appTsx = `export const appRouteConfig: RouteObject[] = [
  { path: '/', element: <ExecutiveDashboard /> },
  { path: '/projects', element: <Projects /> },
  { path: '/incidents', element: <FeatureRoute feature="incidents" element={<IncidentsPage />} /> },
  { path: '/fixture-helper', element: gated('stock', <FixturePage />) },
  { path: '/fixture-module', element: <FixturePage /> },
  { path: '*', element: <NotFoundPage /> },
];`;
  const railTsx = `const ALL_ITEMS: NavItem[] = [
  { to: '/', text: 'Dashboard', group: 'Overview' },
  { to: '/incidents', text: 'Incidents', group: 'Delivery', feature: 'incidents' },
  { to: '/fixture-negative', text: 'Fallback', group: 'Delivery', unlessFeature: 'incidents' },
  { to: '/fixture-nav', text: 'Fixture', group: 'Delivery' },
];`;
  const paletteTs = `export const MODULES: ModuleDef[] = [
  { module: 'dashboard', path: '/' },
  { module: 'incidents', path: '/incidents', feature: 'incidents' },
  { module: 'fixture-negative', path: '/fixture-negative', unlessFeature: 'incidents' },
  { module: 'fixture-module', path: '/fixture-module' },
];`;
  const featuresTs = `export const FEATURE_KEYS = ['incidents', 'stock'] as const;
export const CORE_FEATURES = ['projects', 'dashboard'] as const;`;
  const catalogueSql = `
insert into public.plans (id, name, seat_limit) values
  ('starter', 'Starter', 10);
alter table public.org_features add constraint org_features_feature_key_check
  check (feature_key in ('incidents', 'stock'));
with plan_tiers(plan_id, tier) as (
  values ('starter'::text, 1)
), feature_tiers(feature_key, minimum_tier) as (
  values ('incidents'::text, 1)
)
insert into public.plan_features (plan_id, feature_key, enabled)
select p.plan_id, f.feature_key, p.tier >= f.minimum_tier from plan_tiers p cross join feature_tiers f;`;
  const readEntitiesTs = `export const AGENT_READ_ENTITIES = [
  'incidents',
] as const;
export const AGENT_ENTITY_TABLES = {
  incidents: { table: 'incidents' },
};`;
  const whitelistTs = `export const ENTITY_WHITELIST: Readonly<Record<WhitelistedEntity, Entry>> =
  Object.freeze({
    projects: { table: 'projects' },
  });`;
  const actionsTs = `export const queryEntityAction: Action = { name: 'query_entity', inputSchema: {}, run: async () => {} };
const notATool = { name: 'right_tool' };`;
  const switchesTs = `export const ENTITY_FEATURE_KEYS: Readonly<Record<string, string>> = Object.freeze({
  incidents: 'incidents',
});
export const TOOL_FEATURE_KEYS: Readonly<Record<string, string>> = Object.freeze({});`;

  const assistant = parseAssistant([
    { name: 'readEntities.ts', text: readEntitiesTs },
    { name: 'viewspec/types.ts', text: whitelistTs },
    { name: 'actions.ts', text: actionsTs },
  ]);

  const base = () => ({
    routes: parseRoutes(appTsx),
    rail: parseRail(railTsx),
    palette: parsePalette(paletteTs),
    features: parseFeatures(featuresTs),
    catalogue: parsePlanCatalogue([{ name: '0531_plan_catalogue.sql', sql: catalogueSql }]),
    assistant,
    keyMap: { entity: new Map([['incidents', 'incidents']]), tool: new Map() },
    migrations: [],
    coreRoutes: { '/': 'dashboard', '/projects': 'projects' },
    coreNav: { '/': 'dashboard' },
    corePalette: { '/': 'dashboard' },
    allowlist: [],
  });

  // AC-PLN-014: one fixture module with a route but no switch key, no plan row and no read path.
  const errors = check(base());
  ok(has(errors, 'route /fixture-module:'), `a route with no switch key must be named, got: ${errors.join(' | ')}`);
  ok(has(errors, 'plan starter: no plan_features row for switch key stock'), 'a missing plan row must name plan + key');
  ok(has(errors, 'switch key stock: no assistant read path'), 'a key with no read path must be named');
  ok(has(errors, 'nav /fixture-nav:'), 'a Rail item with no switch key must be named');
  ok(has(errors, 'palette /fixture-module:'), 'a palette module with no switch key must be named');
  ok(!has(errors, 'route /incidents:'), 'a FeatureRoute route passes');
  ok(!has(errors, 'route /:'), 'a core-marked route passes');
  ok(!has(errors, 'stale core route'), 'no stale core marking in the fixture');

  // Parsers discover every entry, including adjacent single-line objects.
  ok(parseRoutes(appTsx).length === 6, `parseRoutes discovers all 6 route entries (got ${parseRoutes(appTsx).length})`);
  ok(parseFeatures(featuresTs).keys.join() === 'incidents,stock', 'parseFeatures discovers the registry keys');
  ok(assistant.entities.has('incidents') && assistant.entities.has('projects'), 'parseAssistant discovers both entity sources');
  ok(assistant.tools.has('query_entity') && !assistant.tools.has('right_tool'), 'only inputSchema-backed names are tools');

  // Complete bundle -> clean.
  const complete = base();
  complete.routes = complete.routes.filter((route) => route.path !== '/fixture-module');
  complete.rail = complete.rail.filter((item) => item.to !== '/fixture-nav');
  complete.palette = complete.palette.filter((module) => module.path !== '/fixture-module');
  complete.keyMap = { entity: new Map([['incidents', 'incidents']]), tool: new Map([['query_stock', 'stock']]) };
  complete.assistant = { entities: new Set(assistant.entities), tools: new Set([...assistant.tools, 'query_stock']) };
  complete.catalogue = {
    ...base().catalogue,
    coverage: new Set([...base().catalogue.coverage, `starter${INTERNAL}stock`]),
  };
  ok(check(complete).length === 0, `a complete bundle passes, got: ${check(complete).join(' | ')}`);

  // Unknown switch key, and a stale core marking.
  const unknown = base();
  unknown.routes = [{ path: '/x', feature: 'not_a_key' }, ...unknown.routes];
  ok(has(check(unknown), "switch key 'not_a_key'"), 'an unknown switch key is named');
  ok(has(check({ ...base(), coreRoutes: { ...base().coreRoutes, '/gone': 'dashboard' } }), 'stale core route /gone'), 'a stale core marking fails');

  // Palette drift from a gated Rail twin.
  const drift = base();
  drift.palette = [{ path: '/incidents', feature: null }, { path: '/', feature: null }];
  drift.corePalette = { '/': 'dashboard' };
  ok(has(check(drift), 'drift from its Rail item'), 'palette/Rail drift is named');

  // Catalogue: stale key, a core key, a matrix gap and an explicit insert.
  const staleKey = base();
  staleKey.catalogue = { ...base().catalogue, keys: new Set(['incidents', 'stock', 'ghost_key']) };
  ok(has(check(staleKey), 'DB catalogue key ghost_key'), 'a DB key absent from FEATURE_KEYS is named');
  const coreRow = base();
  coreRow.catalogue = { ...base().catalogue, coverage: new Set([...base().catalogue.coverage, `starter${INTERNAL}projects`]) };
  ok(has(check(coreRow), 'core key projects must never have a plan_features row'), 'a core key with a plan row fails');

  // Allowlist: suppresses, goes stale, needs a restore note, prefix match.
  const allowed = {
    ...base(),
    allowlist: [{ ids: ['route:/fixture-module', 'nav:/fixture-nav', 'palette:/fixture-module', 'plan:starter/stock', 'assistant:stock'], reason: 'r', restore: 'x' }],
  };
  ok(check(allowed).length === 0, `allowlisted gaps pass, got: ${check(allowed).join(' | ')}`);
  ok(has(check({ ...base(), allowlist: [{ ids: 'route:/ghost', reason: 'r', restore: 'x' }] }), 'stale allowlist entry: route:/ghost'), 'a stale allowlist entry fails');
  ok(has(check({ ...base(), allowlist: [{ ids: 'route:/fixture-module', reason: 'r' }] }), 'needs both a reason and a restore note'), 'an allowlist entry without a restore note fails');
  ok(
    check({ ...base(), allowlist: [{ ids: 'route:/fixture-*', reason: 'r', restore: 'x' }] }).every((error) => !error.includes('route /fixture-module')),
    'a prefix allowlist id suppresses its gaps',
  );

  // S2 enforcement recreation (#1783 item 3).
  const enforcementSql = `
create or replace function public.save_stock() returns void language plpgsql as $$
begin perform public.assert_feature_on(public.auth_org_id(), 'stock'); end $$;
do $$ begin
  for r in (select 1 join (values ('stock_items','stock')) as m(tablename, feature_key) on true) loop null; end loop;
end $$;`;
  const laterBad = `
create or replace function public.save_stock() returns void language plpgsql as $$ begin null; end $$;
create policy write_stock on public.stock_items for insert with check (true);`;
  const laterOk = `
create or replace function public.save_stock() returns void language plpgsql as $$
begin perform public.assert_feature_on(public.auth_org_id(), 'stock'); end $$;
create policy write_stock on public.stock_items for insert
  with check (public.org_feature_enabled(public.auth_org_id(), 'stock'));`;
  const laterWrongKey = `
create or replace function public.save_stock() returns void language plpgsql as $$
begin perform public.assert_feature_on(public.auth_org_id(), 'incidents'); end $$;`;
  const enforcementBase = (later) => ({
    ...complete,
    migrations: [
      { name: '0534_feature_enforcement.sql', sql: enforcementSql },
      { name: '0600_rewrite.sql', sql: later },
    ],
  });
  const badErrors = check(enforcementBase(laterBad));
  ok(has(badErrors, '0600_rewrite.sql recreates public.save_stock()'), `an ungated function recreation is named, got: ${badErrors.join(' | ')}`);
  ok(has(badErrors, 'write_stock'), 'an ungated policy recreation is named');
  ok(check(enforcementBase(laterOk)).length === 0, 'a recreation that keeps the gate passes');
  ok(has(check(enforcementBase(laterWrongKey)), "without the 'stock' gate"), 'a recreation with the wrong key fails');
  const allowlistedEnforcement = check({
    ...enforcementBase(laterBad),
    allowlist: [{ ids: ['enforcement:0600_rewrite.sql:save_stock', 'enforcement:0600_rewrite.sql:write_stock'], reason: 'r', restore: 'x' }],
  });
  ok(allowlistedEnforcement.length === 0, `an allowlisted enforcement exception passes, got: ${allowlistedEnforcement.join(' | ')}`);

  const procurementBaseline = `create policy purchase_orders_insert on public.purchase_orders for insert
    with check (public.org_feature_enabled(public.auth_org_id(), 'procurement'));`;
  const procurementHistory = [
    {
      name: '0534_feature_enforcement.sql',
      sql: `do $$ begin
        for r in (select 1 join (values ('purchase_orders','procurement')) as m(tablename,feature_key) on true)
        loop null; end loop;
      end $$;`,
    },
    { name: '0536_recompose.sql', sql: 'create policy purchase_orders_insert on public.purchase_orders for insert with check (true);' },
    { name: '0538_procurement_write_policy_enforcement.sql', sql: procurementBaseline },
  ];
  ok(
    parseEnforcement(procurementBaseline).policies.get(`purchase_orders${INTERNAL}purchase_orders_insert`)?.key === 'procurement',
    'an explicit gated write policy declares its policy baseline',
  );
  ok(
    check({ ...complete, migrations: procurementHistory }).length === 0,
    'a later enforcement baseline closes earlier policy redefinition gaps',
  );
  const afterProcurementBaseline = [
    ...procurementHistory,
    { name: '0539_recompose.sql', sql: 'create policy purchase_orders_insert on public.purchase_orders for insert with check (true);' },
  ];
  ok(
    has(check({ ...complete, migrations: afterProcurementBaseline }), '0539_recompose.sql recreates write policy purchase_orders_insert'),
    'a rewrite after the latest baseline still fails when it drops the gate',
  );

  // ── The 0081 baseline, `alter policy`, the RAISING-only function gate, and body/table-name forms ──
  // Each fixture below passes on the pre-fix guard; they exist so a revert reddens immediately.
  const baseline81Sql = `
-- The gated-table list that exists TODAY (0081 A2): a tablename in (...) list + a case mapping.
do $$
declare feat text;
begin
  for r in (select tablename from pg_policies where tablename in ('timesheet_entries','m365_pkce_states')) loop
    feat := case r.tablename
      when 'timesheet_entries' then 'timesheets'
      when 'm365_pkce_states' then 'm365_integration'
    end;
  end loop;
end $$;`;
  const onBaseline81 = (later, extra = []) => ({
    ...complete,
    migrations: [
      { name: '0002_rls.sql', sql: `create policy timesheet_entries_select on timesheet_entries for select using (true);` },
      ...extra,
      { name: '0081_feature_flag_write_enforcement.sql', sql: baseline81Sql },
      { name: '0610_rewrite.sql', sql: later },
    ],
  });

  ok(
    parseEnforcement(baseline81Sql).tables.get('timesheet_entries') === 'timesheets',
    '0081\'s case mapping is parsed into the baseline (tables gated today, not just 0534\'s)',
  );
  const alterBare = `alter policy timesheet_entries_write on public.timesheet_entries with check (true);`;
  ok(
    has(check(onBaseline81(alterBare)), 'recreates write policy timesheet_entries_write on timesheet_entries'),
    `alter policy without the conjunct is named, got: ${check(onBaseline81(alterBare)).join(' | ')}`,
  );
  const alterGated = `alter policy timesheet_entries_write on public.timesheet_entries
  with check (public.org_feature_enabled(public.auth_org_id(), 'timesheets'));`;
  ok(check(onBaseline81(alterGated)).length === 0, `an alter policy that keeps the gate passes, got: ${check(onBaseline81(alterGated)).join(' | ')}`);
  const alterSelect = `alter policy timesheet_entries_select on public.timesheet_entries using (public.is_active_member());`;
  ok(check(onBaseline81(alterSelect)).length === 0, 'altering a READ policy on a gated table is not a hole (0081 gates writes only)');
  const digitTable = `create policy write_pkce on public.m365_pkce_states for insert with check (true);`;
  ok(
    has(check(onBaseline81(digitTable)), 'recreates write policy write_pkce on m365_pkce_states'),
    `a digit-named gated table is not silently skipped, got: ${check(onBaseline81(digitTable)).join(' | ')}`,
  );
  const selectPolicy = `create policy timesheet_entries_read on public.timesheet_entries for select using (true);`;
  ok(check(onBaseline81(selectPolicy)).length === 0, 'a new READ policy on a gated table is not a hole');

  const nonRaising = `
create or replace function public.save_stock() returns void language plpgsql as $$
begin perform public.org_feature_enabled(public.auth_org_id(), 'stock'); end $$;`;
  ok(
    has(check(enforcementBase(nonRaising)), "recreates public.save_stock() without the 'stock' gate"),
    `org_feature_enabled in a function body is not a gate (it never raises), got: ${check(enforcementBase(nonRaising)).join(' | ')}`,
  );
  ok(
    has(
      check({
        ...complete,
        migrations: [
          { name: '0534_feature_enforcement.sql', sql: nonRaising },
          { name: '0600_rewrite.sql', sql: 'create or replace function public.save_stock() returns void language plpgsql as $$ begin null; end $$;' },
        ],
      }),
      "recreates public.save_stock() without the 'stock' gate",
    ),
    'a baseline that declares the non-raising form is still recorded, so a bare recreation fails',
  );
  const taggedBody = `
create or replace function public.save_stock() returns void language plpgsql as $body$
begin null; end $body$;`;
  ok(
    has(check(enforcementBase(taggedBody)), 'recreates public.save_stock()'),
    'a $body$-tagged recreation is parsed, not skipped',
  );
  const quotedBody = `
create or replace function public.save_stock() returns void language plpgsql as 'begin null; end';`;
  ok(has(check(enforcementBase(quotedBody)), 'recreates public.save_stock()'), 'a single-quoted body is parsed, not skipped');

  // Comment text is not a gate.
  const commentedApp = `export const appRouteConfig: RouteObject[] = [
  { path: '/', element: <ExecutiveDashboard /> },
  { path: '/fixture-module', /* <FeatureRoute feature="stock"> */ element: <FixturePage /> },
];`;
  const commentedRail = `const ALL_ITEMS: NavItem[] = [
  { to: '/', text: 'Dashboard' },
  { to: '/fixture-nav', text: 'Fixture' /* feature: 'stock' */ },
];`;
  const commentedPalette = `export const MODULES: ModuleDef[] = [
  { module: 'dashboard', path: '/' },
  { module: 'fixture-module', path: '/fixture-module' /* feature: 'stock' */ },
];`;
  ok(
    parseRoutes(commentedApp).find((route) => route.path === '/fixture-module')?.feature === null,
    'a commented-out FeatureRoute is not a gate',
  );
  ok(parsePalette(paletteTs).find((module) => module.path === '/fixture-negative')?.unlessFeature === 'incidents', 'parsePalette recognizes the intentional negative gate');
  ok(parseRail(commentedRail).find((item) => item.to === '/fixture-nav')?.feature === null, 'a commented-out Rail feature is not a gate');
  ok(
    parsePalette(commentedPalette).find((module) => module.path === '/fixture-module')?.feature === null,
    'a commented-out palette feature is not a gate',
  );

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
    console.error(
      `\nmodule-completeness: ${errors.length} missing registration(s). Give the module a switch key (or a core marking), a plan row and an assistant read path — or justify an ALLOWLIST entry with a restore note.`,
    );
    process.exit(1);
  }
  console.log('module-completeness: OK');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
