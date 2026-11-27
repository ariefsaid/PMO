/**
 * Owner-supplied material workbook loader (`pmo material load`, #3010, Contract v2 + v1.1).
 *
 * - Spawns an explicitly configured isolated Python venv (`-I`) to parse untrusted XLSX files
 *   without executing formulas, macros, or external links. Never auto-installs packages.
 * - Previews by default; only `--confirm` writes.
 * - Step 1 (Contract v1.1): creates missing work orders via existing `import_work_orders` RPC
 *   using explicit commercial inputs from the private mapping (never guessed).
 * - Step 2: sends catalogue chunks (<= 500 entries) via `om_material_import`.
 * - Step 3: sends accepted sections (1 section per call, <= 200 lines) via `om_material_import`
 *   using Contract v2 opening stage totals + verbatim `evidence`.
 * - Never changes `source_key` on retry; transport unknown-outcome errors halt with resume guidance.
 *
 * Node 22 standard library only.
 */
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MATERIAL_SCHEMA_VERSION = 2;
export const MAX_CATALOGUE_CHUNK = 500;
export const MAX_SECTION_LINES = 200;
export const MAX_WORK_ORDER_CHUNK = 500;
export const MAX_EVIDENCE_VALUE_BYTES = 4096;

/** Column length & byte limits mirrored from migrations 0412, 1169, and 2790. */
export const DB_LIMITS = Object.freeze({
  section_code: 20,
  section_name: 120,
  owner_cost_code: 200,
  item_code: 40,
  item_name: 200,
  unit_code: 20,
  unit_name: 80,
  category_code: 40,
  category_name: 200,
  owner_warehouse_code: 40,
  owner_warehouse_name: 200,
  reconciliation_step_name: 100,
  source_key: 200,
  entity_key: 500,
  evidence_total_bytes: 32768,
});
export const DEFAULT_PYTHON_BIN = '/tmp/owner-material-loader-venv/bin/python';
export const MATERIAL_LOAD_RPCS = Object.freeze([
  'om_material_config',
  'om_material_import',
  'om_material_set_scale',
  'import_work_orders',
]);

/**
 * Standing prerequisite printed on every preview that would create missing work orders: the
 * work-order import RPC requires the organisation setup-workflow opt-in, which an organisation
 * Admin turns on in the app. With the opt-in off the server refuses the import before anything
 * is written (SQLSTATE 42501).
 */
export const SETUP_WORKFLOWS_PREREQUISITE =
  'Creating missing work orders requires the organisation setup-workflow opt-in (' +
  '"Enable setup workflows", which an organisation Admin turns on in the app, Finance hub). ' +
  'With the opt-in off the server refuses the work-order import and nothing is written.';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY_RE = /^[A-Z]{3}$/;
const PARSER_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'owner-material-workbook.py');

const ALLOWED_MAP_KEYS = new Set([
  'source_key',
  'as_of',
  'policy',
  'work_order_defaults',
  'owner_warehouses',
  'units',
  'workbook',
  'sheets',
  'consolidations',
  'reconciliation_scale',
  'zero_cost_tag_name',
  'zero_cost_tag_id',
  'report_path',
]);

const ALLOWED_POLICY_KEYS = new Set(['closing_conflict', 'duplicate_items']);

const ALLOWED_WORKBOOK_KEYS = new Set([
  'item_list_sheet',
  'reconciliation_sheet',
  'rollup_sheet',
  'validation_only_sheets',
  'excluded_sheets',
  'template_sheets',
  'location_sheet',
]);

const ALLOWED_LOCATION_SHEET_KEYS = new Set([
  'header_contains',
  'max_header_scan_rows',
  'two_row_marker',
  'title_cell',
  'excluded_columns',
  'warehouse_band',
  'columns',
  'sub_header_columns',
  'evidence_columns',
  'field_presence',
]);

const ALLOWED_WAREHOUSE_BAND_KEYS = new Set([
  'two_row_start_header',
  'single_row_after_fields',
  'end_field',
  'required',
]);

const PRESENCE_VALUES = new Set(['required', 'optional']);

/** 'required' | 'optional' | {two_row, single_row} with both variants declared. */
function isValidPresenceDecl(decl) {
  if (typeof decl === 'string') return PRESENCE_VALUES.has(decl);
  if (isPlainObject(decl) && Object.keys(decl).length === 2) {
    return PRESENCE_VALUES.has(decl.two_row) && PRESENCE_VALUES.has(decl.single_row);
  }
  return false;
}

const ALLOWED_WO_DEFAULT_KEYS = new Set([
  'tax_treatment',
  'tax_amount',
  'order_value',
  'currency',
  'description',
  'start_date',
  'end_date',
  'area_id',
]);

const ALLOWED_SHEET_KEYS = new Set([
  'ignore',
  'owner_order_number',
  'location_name',
  'section_code',
  'owner_cost_code',
  'title',
  'as_of',
  'receiving_location_code',
  'reconciliation_step',
  'order_value',
  'tax_treatment',
  'tax_amount',
  'currency',
  'description',
  'start_date',
  'end_date',
  'area_id',
]);

export class MaterialLoadError extends Error {
  /** @param {string} message @param {{exit?: number, code?: string, details?: unknown}} [opts] */
  constructor(message, opts = {}) {
    super(message);
    this.exit = opts.exit ?? 2;
    this.code = opts.code ?? 'material_load_error';
    this.details = opts.details;
  }
}

export class MaterialOutcomeUnknown extends Error {
  constructor({ sourceKey, entityKey, stage }) {
    super(
      `The ${stage} write for '${entityKey}' may or may not have committed: the connection failed before an answer came back. ` +
        `Re-run the identical command with the same mapping (source_key='${sourceKey}') to resume safely; never retry with a new source_key.`,
    );
    this.code = 'outcome_unknown';
    this.sourceKey = sourceKey;
    this.entityKey = entityKey;
    this.stage = stage;
  }
}

/**
 * Recognise the server's refusal of the work-order import because the organisation's
 * setup-workflow opt-in is off (HTTP 403 / SQLSTATE 42501, migration 2160). Transport-level
 * failures (no status and no code — an unknown outcome) never match.
 */
function isSetupWorkflowsDisabledError(err) {
  if (!err || typeof err !== 'object') return false;
  if (err.code === '42501') return /setup workflows are disabled/i.test(String(err.message ?? ''));
  return err.status === 403 && /setup workflows are disabled/i.test(String(err.message ?? ''));
}

/** One clear operator message for the disabled setup-workflow opt-in: stop before any write. */
function setupWorkflowsDisabledError() {
  return new MaterialLoadError(
    'Nothing was written: the server refused the work-order import because setup workflows are ' +
      'disabled for this organisation (the "Enable setup workflows" setting). An organisation Admin ' +
      'turns it on in the app (Finance hub); re-run the identical command once it is on.',
    { exit: 1, code: 'setup_workflows_disabled' },
  );
}

/** Deterministic key-sorted JSON serialization for canonical payload hashing. */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

export function canonicalHash(value) {
  return crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isPlaceholder(v) {
  return typeof v === 'string' && /^REQUIRED(?:$|[\s:_-])/i.test(v.trim());
}

/**
 * Validate the private mapping file strictly before spawning Python or calling the server.
 * Rejects unknown keys everywhere so typos cannot silently fall back to defaults.
 */
export function validateMapping(mapping) {
  const problems = [];
  if (!isPlainObject(mapping)) {
    return ['mapping must be a JSON object'];
  }
  for (const key of Object.keys(mapping)) {
    if (!ALLOWED_MAP_KEYS.has(key)) {
      problems.push(`unknown mapping key '${key}'`);
    }
  }
  if (typeof mapping.source_key !== 'string' || !mapping.source_key.trim()) {
    problems.push('source_key must be a non-empty string');
  } else if (mapping.source_key.trim().length > DB_LIMITS.source_key) {
    problems.push(`source_key exceeds ${DB_LIMITS.source_key} characters (${mapping.source_key.trim().length})`);
  }
  if (
    typeof mapping.zero_cost_tag_name !== 'string' ||
    !mapping.zero_cost_tag_name.trim() ||
    isPlaceholder(mapping.zero_cost_tag_name)
  ) {
    problems.push('zero_cost_tag_name must be a non-empty string naming an existing zero-cost stock tag');
  }
  if (mapping.as_of !== undefined && (typeof mapping.as_of !== 'string' || !ISO_DATE_RE.test(mapping.as_of))) {
    problems.push('as_of must be an ISO calendar date (YYYY-MM-DD)');
  }
  if (mapping.policy !== undefined) {
    if (!isPlainObject(mapping.policy)) {
      problems.push('policy must be an object');
    } else {
      for (const k of Object.keys(mapping.policy)) {
        if (!ALLOWED_POLICY_KEYS.has(k)) problems.push(`unknown policy key '${k}'`);
      }
      if (
        mapping.policy.closing_conflict !== undefined &&
        !['refuse', 'movements_win'].includes(mapping.policy.closing_conflict)
      ) {
        problems.push("policy.closing_conflict must be 'refuse' or 'movements_win'");
      }
      if (
        mapping.policy.duplicate_items !== undefined &&
        !['refuse', 'sum'].includes(mapping.policy.duplicate_items)
      ) {
        problems.push("policy.duplicate_items must be 'refuse' or 'sum'");
      }
    }
  }
  if (mapping.owner_warehouses !== undefined) {
    if (!isPlainObject(mapping.owner_warehouses)) {
      problems.push('owner_warehouses must be an object');
    } else {
      for (const [header, target] of Object.entries(mapping.owner_warehouses)) {
        if (typeof target === 'string') {
          if (!target.trim()) problems.push(`owner_warehouses['${header}'] must be non-empty`);
          else if (target.trim().length > DB_LIMITS.owner_warehouse_code) {
            problems.push(`owner_warehouses['${header}'] code exceeds ${DB_LIMITS.owner_warehouse_code} characters`);
          }
        } else if (isPlainObject(target)) {
          if (typeof target.code !== 'string' || !target.code.trim()) {
            problems.push(`owner_warehouses['${header}'].code must be a non-empty string`);
          } else if (target.code.trim().length > DB_LIMITS.owner_warehouse_code) {
            problems.push(`owner_warehouses['${header}'].code exceeds ${DB_LIMITS.owner_warehouse_code} characters`);
          }
          if (typeof target.name === 'string' && target.name.trim().length > DB_LIMITS.owner_warehouse_name) {
            problems.push(`owner_warehouses['${header}'].name exceeds ${DB_LIMITS.owner_warehouse_name} characters`);
          }
        } else {
          problems.push(`owner_warehouses['${header}'] must be a string code or {code, name}`);
        }
      }
    }
  }
  if (mapping.units !== undefined) {
    if (!isPlainObject(mapping.units)) {
      problems.push('units must be an object');
    } else {
      for (const [code, cfg] of Object.entries(mapping.units)) {
        if (String(code).trim().length > DB_LIMITS.unit_code) {
          problems.push(`units['${code}'] code exceeds ${DB_LIMITS.unit_code} characters`);
        }
        if (!isPlainObject(cfg)) {
          problems.push(`units['${code}'] must be an object`);
          continue;
        }
        for (const k of Object.keys(cfg)) {
          if (k !== 'name' && k !== 'whole_only') {
            problems.push(`unknown units['${code}'] key '${k}'`);
          }
        }
        if (cfg.name !== undefined && (typeof cfg.name !== 'string' || !cfg.name.trim())) {
          problems.push(`units['${code}'].name must be a non-empty string`);
        } else if (typeof cfg.name === 'string' && cfg.name.trim().length > DB_LIMITS.unit_name) {
          problems.push(`units['${code}'].name exceeds ${DB_LIMITS.unit_name} characters`);
        }
        if (cfg.whole_only !== undefined && typeof cfg.whole_only !== 'boolean') {
          problems.push(`units['${code}'].whole_only must be a boolean`);
        }
      }
    }
  }
  if (mapping.work_order_defaults !== undefined) {
    if (!isPlainObject(mapping.work_order_defaults)) {
      problems.push('work_order_defaults must be an object');
    } else {
      for (const k of Object.keys(mapping.work_order_defaults)) {
        if (!ALLOWED_WO_DEFAULT_KEYS.has(k)) problems.push(`unknown work_order_defaults key '${k}'`);
      }
    }
  }
  if (mapping.workbook !== undefined) {
    if (!isPlainObject(mapping.workbook)) {
      problems.push('workbook must be an object');
    } else {
      for (const k of Object.keys(mapping.workbook)) {
        if (!ALLOWED_WORKBOOK_KEYS.has(k)) problems.push(`unknown workbook key '${k}'`);
      }
      const loc = mapping.workbook.location_sheet;
      if (!isPlainObject(loc)) {
        problems.push('workbook.location_sheet must be an object');
      } else {
        for (const k of Object.keys(loc)) {
          if (!ALLOWED_LOCATION_SHEET_KEYS.has(k)) problems.push(`unknown workbook.location_sheet key '${k}'`);
        }
        if (!Array.isArray(loc.header_contains) || loc.header_contains.length === 0) {
          problems.push('workbook.location_sheet.header_contains must be a non-empty array');
        }
        if (!isPlainObject(loc.columns) || !loc.columns.item_code) {
          problems.push('workbook.location_sheet.columns.item_code is required');
        }
        if (loc.warehouse_band !== undefined) {
          if (!isPlainObject(loc.warehouse_band)) {
            problems.push('workbook.location_sheet.warehouse_band must be an object');
          } else {
            for (const k of Object.keys(loc.warehouse_band)) {
              if (!ALLOWED_WAREHOUSE_BAND_KEYS.has(k)) {
                problems.push(`unknown workbook.location_sheet.warehouse_band key '${k}'`);
              }
            }
            if (typeof loc.warehouse_band.required !== 'boolean') {
              problems.push(
                'workbook.location_sheet.warehouse_band.required must be a boolean declaring whether every sheet must carry at least one owner-warehouse column',
              );
            }
          }
        }
        const declaredFieldKeys = new Set([
          ...Object.keys(loc.columns ?? {}),
          ...Object.keys(loc.sub_header_columns ?? {}),
          ...Object.keys(loc.evidence_columns ?? {}),
        ]);
        if (!isPlainObject(loc.field_presence) || Object.keys(loc.field_presence).length === 0) {
          problems.push(
            'workbook.location_sheet.field_presence must be an object declaring every mapped field as "required" or "optional"',
          );
        } else {
          for (const [field, decl] of Object.entries(loc.field_presence)) {
            if (!declaredFieldKeys.has(field)) {
              problems.push(`workbook.location_sheet.field_presence declares unknown field '${field}'`);
            }
            if (!isValidPresenceDecl(decl)) {
              problems.push(
                `workbook.location_sheet.field_presence['${field}'] must be "required", "optional", or an object with both "two_row" and "single_row" set to "required" or "optional"`,
              );
            }
          }
          for (const field of declaredFieldKeys) {
            if (!(field in loc.field_presence)) {
              problems.push(`workbook.location_sheet.field_presence must declare '${field}' (required or optional)`);
            }
          }
        }
      }
    }
  }
  if (mapping.sheets !== undefined) {
    if (!isPlainObject(mapping.sheets)) {
      problems.push('sheets must be an object');
    } else {
      for (const [sheetName, cfg] of Object.entries(mapping.sheets)) {
        if (!isPlainObject(cfg)) {
          problems.push(`sheets['${sheetName}'] must be an object`);
          continue;
        }
        for (const k of Object.keys(cfg)) {
          if (!ALLOWED_SHEET_KEYS.has(k)) problems.push(`unknown sheets['${sheetName}'] key '${k}'`);
        }
        if (cfg.as_of !== undefined && (typeof cfg.as_of !== 'string' || !ISO_DATE_RE.test(cfg.as_of))) {
          problems.push(`sheets['${sheetName}'].as_of must be YYYY-MM-DD`);
        }
        if (cfg.section_code !== undefined) {
          const sc = String(cfg.section_code).trim();
          if (!sc || sc.length > DB_LIMITS.section_code) {
            problems.push(`sheets['${sheetName}'].section_code must be 1..${DB_LIMITS.section_code} characters`);
          }
        }
        if (cfg.location_name !== undefined && String(cfg.location_name).trim().length > DB_LIMITS.section_name) {
          problems.push(`sheets['${sheetName}'].location_name exceeds ${DB_LIMITS.section_name} characters`);
        }
        if (cfg.owner_cost_code !== undefined && String(cfg.owner_cost_code).length > DB_LIMITS.owner_cost_code) {
          problems.push(`sheets['${sheetName}'].owner_cost_code exceeds ${DB_LIMITS.owner_cost_code} characters`);
        }
        if (cfg.reconciliation_step !== undefined && String(cfg.reconciliation_step).trim().length > DB_LIMITS.reconciliation_step_name) {
          problems.push(`sheets['${sheetName}'].reconciliation_step exceeds ${DB_LIMITS.reconciliation_step_name} characters`);
        }
      }
    }
  }
  if (mapping.zero_cost_tag_id !== undefined && !UUID_RE.test(String(mapping.zero_cost_tag_id))) {
    problems.push('zero_cost_tag_id must be a UUID');
  }
  if (mapping.reconciliation_scale !== undefined) {
    if (!Array.isArray(mapping.reconciliation_scale) || mapping.reconciliation_scale.length === 0) {
      problems.push('reconciliation_scale must be a non-empty array');
    } else {
      let prevPct = 0;
      const seenNames = new Set();
      for (let i = 0; i < mapping.reconciliation_scale.length; i++) {
        const s = mapping.reconciliation_scale[i];
        if (!isPlainObject(s) || typeof s.name !== 'string' || !s.name.trim()) {
          problems.push(`reconciliation_scale[${i}].name must be a non-empty string`);
          continue;
        }
        if (s.name.trim().length > DB_LIMITS.reconciliation_step_name) {
          problems.push(`reconciliation_scale[${i}].name exceeds ${DB_LIMITS.reconciliation_step_name} characters`);
        }
        const key = s.name.trim().toLowerCase();
        if (seenNames.has(key)) problems.push(`reconciliation_scale duplicate step '${s.name}'`);
        seenNames.add(key);
        const pct = Number(s.percentage);
        if (!Number.isFinite(pct) || pct <= prevPct || pct > 100) {
          problems.push(`reconciliation_scale[${i}].percentage must be strictly increasing in (0, 100]`);
        }
        prevPct = pct;
      }
      if (prevPct !== 100) {
        problems.push('reconciliation_scale must end at percentage 100');
      }
    }
  }
  return problems;
}

/**
 * Spawn the isolated Python venv (`-I`) to parse an untrusted XLSX workbook.
 * Never auto-installs dependencies.
 */
export function parseWorkbookWithPython(workbookPath, mappingPath, { pythonBin } = {}) {
  const bin = pythonBin || process.env.PMO_OWNER_MATERIAL_PYTHON || DEFAULT_PYTHON_BIN;
  if (!fs.existsSync(bin)) {
    throw new MaterialLoadError(
      `Isolated Python interpreter not found at '${bin}'. Create the venv first:\n` +
        `  python3 -I -m venv /tmp/owner-material-loader-venv && /tmp/owner-material-loader-venv/bin/pip install -r scripts/requirements-owner-material.txt`,
      { exit: 2, code: 'python_venv_missing' },
    );
  }
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      ['-I', PARSER_SCRIPT, workbookPath, mappingPath],
      { maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          reject(
            new MaterialLoadError(
              `Workbook parser failed: ${stderr?.trim() || err.message}`,
              { exit: 2, code: 'workbook_parse_failed' },
            ),
          );
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch (parseErr) {
          reject(
            new MaterialLoadError(`Workbook parser returned invalid JSON: ${parseErr.message}`, {
              exit: 2,
              code: 'workbook_parse_invalid_json',
            }),
          );
        }
      },
    );
  });
}

/**
 * Deterministic collision-checked section code bounded to `DB_LIMITS.section_code` (20 chars)
 * including any collision suffix, without altering `location_name` (migration 1169).
 */
export function deriveSectionCode(locationName, usedCodes) {
  const maxLen = DB_LIMITS.section_code;
  const rawBase =
    String(locationName || 'SECTION')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'SECTION';
  let candidate = rawBase.slice(0, maxLen).replace(/_+$/, '') || 'SECTION';
  let suffix = 2;
  while (usedCodes.has(candidate.toLowerCase())) {
    const tag = `_${suffix}`;
    const prefix = rawBase.slice(0, maxLen - tag.length).replace(/_+$/, '') || 'S';
    candidate = `${prefix}${tag}`;
    suffix += 1;
  }
  usedCodes.add(candidate.toLowerCase());
  return candidate;
}

/** Read all work orders for the project using paged GET requests. */
async function readProjectWorkOrders(api, projectId) {
  const pageSize = 500;
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const q = new URLSearchParams({
      select: 'id,wo_number,client_po_number,title,status',
      project_id: `eq.${projectId}`,
      order: 'id.asc',
      limit: String(pageSize),
      offset: String(offset),
    });
    const batch = await api.get('work_orders', q.toString());
    if (!Array.isArray(batch) || batch.length === 0) break;
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return rows;
}

/**
 * Match an owner order number against existing project work orders (FR-001).
 * Matches trimmed `wo_number` OR `client_po_number`; refuses disagreement or multiple matches.
 */
export function matchWorkOrder(ownerOrderNumber, workOrders) {
  const needle = String(ownerOrderNumber || '').trim();
  const byNumber = workOrders.filter((w) => String(w.wo_number ?? '').trim() === needle && needle !== '');
  const byClientPo = workOrders.filter((w) => String(w.client_po_number ?? '').trim() === needle && needle !== '');
  const combinedIds = new Set([...byNumber.map((w) => w.id), ...byClientPo.map((w) => w.id)]);
  if (combinedIds.size === 0) return { status: 'missing' };
  if (combinedIds.size > 1) {
    const reason =
      byNumber.length > 0 && byClientPo.length > 0
        ? `Owner order '${needle}' matched different work orders on wo_number vs client_po_number.`
        : `Owner order '${needle}' matched ${combinedIds.size} work orders in this project.`;
    return { status: 'ambiguous', reason };
  }
  const match = byNumber[0] ?? byClientPo[0];
  return { status: 'matched', workOrder: match };
}

/** Build a row for `import_work_orders` from explicit mapping commercial inputs (Contract v1.1). */
export function buildWorkOrderImportRow(ownerOrderNumber, title, mapping, sheetCfg = {}) {
  const defaults = mapping.work_order_defaults || {};
  const taxTreatment = sheetCfg.tax_treatment ?? defaults.tax_treatment;
  const currency = sheetCfg.currency ?? defaults.currency;
  const orderValue = sheetCfg.order_value ?? defaults.order_value ?? '0';
  const taxAmount = sheetCfg.tax_amount ?? defaults.tax_amount ?? '0';
  const problems = [];

  if (!taxTreatment || typeof taxTreatment !== 'string' || !taxTreatment.trim() || isPlaceholder(taxTreatment)) {
    problems.push(`work_order_defaults.tax_treatment is required (set explicitly in mapping) to create missing work order '${ownerOrderNumber}'`);
  }
  if (!currency || typeof currency !== 'string' || !CURRENCY_RE.test(currency.trim()) || isPlaceholder(currency)) {
    problems.push(`work_order_defaults.currency must be a 3-letter ISO code (set explicitly in mapping) to create missing work order '${ownerOrderNumber}'`);
  }
  if (!Number.isFinite(Number(orderValue)) || Number(orderValue) < 0) {
    problems.push(`work_order_defaults.order_value must be a non-negative number for '${ownerOrderNumber}'`);
  }
  if (!Number.isFinite(Number(taxAmount)) || Number(taxAmount) < 0) {
    problems.push(`work_order_defaults.tax_amount must be a non-negative number for '${ownerOrderNumber}'`);
  }
  if (problems.length > 0) return { problems };

  const row = {
    title: String(title || ownerOrderNumber).trim(),
    client_po_number: String(ownerOrderNumber).trim(),
    order_value: Number(orderValue),
    tax_treatment: taxTreatment.trim(),
    tax_amount: Number(taxAmount),
    currency: currency.trim(),
  };
  const description = sheetCfg.description ?? defaults.description;
  const startDate = sheetCfg.start_date ?? defaults.start_date;
  const endDate = sheetCfg.end_date ?? defaults.end_date;
  const areaId = sheetCfg.area_id ?? defaults.area_id;
  if (description) row.description = String(description).trim();
  if (startDate) row.start_date = String(startDate).trim();
  if (endDate) row.end_date = String(endDate).trim();
  if (areaId) row.area_id = String(areaId).trim();
  return { row, problems: [] };
}

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/**
 * Build bounded (<= maxChunkSize) catalogue chunks so every chunk containing items begins
 * with the distinct unit entities those items depend on (same entity_key and hash as the
 * initial unit chunk). Preview calls roll back independently, so each item chunk must carry
 * its own unit prerequisites; confirm skips already-created units idempotently.
 */
export function buildCatalogueChunks(catalogueEntities, maxChunkSize = MAX_CATALOGUE_CHUNK) {
  const unitEntities = catalogueEntities.filter((e) => e.type === 'unit');
  const nonItemOther = catalogueEntities.filter((e) => e.type !== 'unit' && e.type !== 'item');
  const itemEntities = catalogueEntities.filter((e) => e.type === 'item');
  const unitByCode = new Map(unitEntities.map((u) => [u.code, u]));

  const chunks = [];
  chunks.push(...chunkArray(unitEntities, maxChunkSize));
  chunks.push(...chunkArray(nonItemOther, maxChunkSize));

  let curUnits = new Map();
  let curItems = [];
  for (const item of itemEntities) {
    const unitCode = String(item.unit || '').trim().toUpperCase();
    const neededUnit = unitByCode.get(unitCode);
    const needsNewUnit = Boolean(neededUnit && !curUnits.has(unitCode));
    const projectedSize = curUnits.size + (needsNewUnit ? 1 : 0) + curItems.length + 1;
    if (curItems.length > 0 && projectedSize > maxChunkSize) {
      chunks.push([...curUnits.values(), ...curItems]);
      curUnits = new Map();
      curItems = [];
    }
    if (neededUnit && !curUnits.has(unitCode)) {
      curUnits.set(unitCode, neededUnit);
    }
    curItems.push(item);
  }
  if (curItems.length > 0) {
    chunks.push([...curUnits.values(), ...curItems]);
  }
  return chunks;
}

/**
 * Flatten a line's `evidence` object so every value is a scalar string (Contract v2.3 §4).
 * Nested objects/arrays are JSON-serialized. Nothing is ever shortened: a value over the
 * per-value limit passes through unchanged and is flagged in `oversized` so the caller
 * refuses the whole line (`field_length_exceeded`, Contract v2.4 §4).
 */
export function flattenEvidence(rawEvidence) {
  const flat = {};
  const oversized = [];
  if (!isPlainObject(rawEvidence)) return { evidence: flat, oversized };
  for (const [key, val] of Object.entries(rawEvidence)) {
    if (val === null || val === undefined) continue;
    const rawStr = typeof val === 'string' ? val : JSON.stringify(val);
    const bytes = Buffer.byteLength(rawStr, 'utf8');
    if (bytes > MAX_EVIDENCE_VALUE_BYTES) {
      oversized.push({ key, bytes });
    }
    flat[key] = rawStr;
  }
  return { evidence: flat, oversized };
}

function lookupUnitConfig(unitCode, unitsMap) {
  if (!isPlainObject(unitsMap)) return {};
  if (isPlainObject(unitsMap[unitCode])) return unitsMap[unitCode];
  for (const [k, v] of Object.entries(unitsMap)) {
    if (String(k).trim().toUpperCase() === unitCode && isPlainObject(v)) return v;
  }
  return {};
}

/** Build deterministic catalogue entities (units first, then categories, owner warehouses, items). */
export function buildCatalogueEntities(parsed, mapping, resolvedZeroCostTagId = undefined) {
  const units = [];
  const categories = [];
  const warehouses = [];
  const items = [];
  const seenUnit = new Set();
  const seenCat = new Set();
  const seenWh = new Set();
  const seenItem = new Set();

  const registerUnit = (rawUnit) => {
    const code = String(rawUnit || '').trim().toUpperCase();
    if (!code || seenUnit.has(code)) return;
    seenUnit.add(code);
    const cfg = lookupUnitConfig(code, mapping?.units);
    const name = typeof cfg.name === 'string' && cfg.name.trim() ? cfg.name.trim() : code;
    const wholeOnly = Boolean(cfg.whole_only ?? false);
    const body = { type: 'unit', code, name, whole_only: wholeOnly };
    units.push({ entity_key: `unit:${code}`, hash: canonicalHash(body), ...body });
  };

  for (const item of parsed.catalogue?.items ?? []) {
    if (item.unit) registerUnit(item.unit);
  }
  for (const sec of parsed.accepted_sections ?? []) {
    for (const line of sec.lines ?? []) {
      if (line.unit) registerUnit(line.unit);
    }
  }

  for (const cat of parsed.catalogue?.categories ?? []) {
    if (!cat.code || seenCat.has(cat.code)) continue;
    seenCat.add(cat.code);
    const body = { type: 'category', code: cat.code, name: cat.name || cat.code };
    categories.push({ entity_key: `category:${cat.code}`, hash: canonicalHash(body), ...body });
  }
  for (const sec of parsed.accepted_sections ?? []) {
    for (const line of sec.lines ?? []) {
      if (line.category_code && !seenCat.has(line.category_code)) {
        seenCat.add(line.category_code);
        const body = { type: 'category', code: line.category_code, name: line.category_code };
        categories.push({ entity_key: `category:${line.category_code}`, hash: canonicalHash(body), ...body });
      }
    }
  }

  for (const wh of parsed.catalogue?.owner_warehouses ?? []) {
    if (!wh.code || seenWh.has(wh.code)) continue;
    seenWh.add(wh.code);
    const body = { type: 'owner_warehouse', code: wh.code, name: wh.name || wh.code };
    warehouses.push({ entity_key: `owner_warehouse:${wh.code}`, hash: canonicalHash(body), ...body });
  }

  const tagId = resolvedZeroCostTagId ?? mapping.zero_cost_tag_id ?? undefined;
  for (const item of parsed.catalogue?.items ?? []) {
    if (!item.code || seenItem.has(item.code)) continue;
    seenItem.add(item.code);
    const body = {
      type: 'item',
      code: item.code,
      name: item.name || item.code,
      unit: String(item.unit || '').trim().toUpperCase(),
      ...(tagId ? { zero_cost_tag_id: tagId } : {}),
    };
    items.push({ entity_key: `item:${item.code}`, hash: canonicalHash(body), ...body });
  }
  for (const sec of parsed.accepted_sections ?? []) {
    for (const line of sec.lines ?? []) {
      if (line.item_code && !seenItem.has(line.item_code)) {
        seenItem.add(line.item_code);
        const body = {
          type: 'item',
          code: line.item_code,
          name: line.item_name || line.item_code,
          unit: String(line.unit || '').trim().toUpperCase(),
          ...(tagId ? { zero_cost_tag_id: tagId } : {}),
        };
        items.push({ entity_key: `item:${line.item_code}`, hash: canonicalHash(body), ...body });
      }
    }
  }

  return [...units, ...categories, ...warehouses, ...items];
}

/** Collect the bounded (<= 500) catalogue entities that one section depends on, units first (Contract v2.3 §2). */
export function buildSectionCatalogueDependencies(section, catalogueByKey) {
  const unitKeys = new Set();
  const catKeys = new Set();
  const whKeys = new Set();
  const itemKeys = new Set();

  for (const line of section.lines ?? []) {
    const u = String(line.unit || '').trim().toUpperCase();
    if (u) unitKeys.add(`unit:${u}`);
    if (line.category_code) catKeys.add(`category:${line.category_code}`);
    if (line.item_code) itemKeys.add(`item:${line.item_code}`);
    const ev = line.evidence;
    if (isPlainObject(ev)) {
      if (isPlainObject(ev.owner_warehouses)) {
        for (const whCode of Object.keys(ev.owner_warehouses)) whKeys.add(`owner_warehouse:${whCode}`);
      }
      if (Array.isArray(ev.rows)) {
        for (const rowObj of ev.rows) {
          if (isPlainObject(rowObj?.texts?.owner_warehouses)) {
            for (const whCode of Object.keys(rowObj.texts.owner_warehouses)) whKeys.add(`owner_warehouse:${whCode}`);
          }
        }
      }
    }
  }

  const orderedKeys = [...unitKeys, ...catKeys, ...whKeys, ...itemKeys];
  const deps = [];
  for (const k of orderedKeys) {
    const ent = catalogueByKey.get(k);
    if (ent) deps.push(ent);
  }
  return deps.slice(0, MAX_CATALOGUE_CHUNK);
}

/** Build Contract v2/v2.4 section entity payload with deterministic entity keys, hashes, flattened scalar evidence, and line-level skip visibility. */
export function buildSectionEntity(section, sourceKey, sectionCode) {
  const orderKey = String(section.owner_order_number).trim();
  const locKey = String(section.location_name).trim().toLowerCase();
  const sectionEntityKey = `section:${sourceKey}:${orderKey}:${locKey}`;

  // Contract v2.4 §1: make partial loads visible on the section payload. Only line-level
  // skips count (empty lines are reported separately by the parser); reason codes are
  // distinct, in first-seen order, capped at 20.
  const skippedLines = Array.isArray(section.skipped_lines) ? section.skipped_lines : [];
  const skippedReasonCodes = [
    ...new Set(skippedLines.map((s) => String(s?.class ?? '').trim()).filter(Boolean)),
  ].slice(0, 20);

  const lines = (section.lines ?? []).map((line) => {
    const lineEntityKey = `line:${sourceKey}:${orderKey}:${locKey}:${line.item_code}`;
    const { evidence: flatEvidence } = flattenEvidence(line.evidence);
    const lineCore = {
      item_code: line.item_code,
      unit: String(line.unit || '').trim().toUpperCase(),
      category_code: line.category_code ?? null,
      planned: line.planned,
      opening: line.opening,
      evidence: flatEvidence,
      expected: line.expected,
    };
    return {
      entity_key: lineEntityKey,
      hash: canonicalHash(lineCore),
      row: line.row,
      ...lineCore,
    };
  });

  const sectionCore = {
    owner_order_number: orderKey,
    location_name: section.location_name,
    section_code: sectionCode,
    owner_cost_code: section.owner_cost_code ?? null,
    title: section.title ?? section.location_name,
    as_of: section.as_of,
    closing_conflict: section.closing_conflict ?? 'refuse',
    reconciliation_step: section.reconciliation_step ?? null,
    skipped_source_rows: skippedLines.length,
    skipped_reason_codes: skippedReasonCodes,
    lines: lines.map((l) => ({ entity_key: l.entity_key, hash: l.hash })),
  };

  return {
    entity_key: sectionEntityKey,
    hash: canonicalHash(sectionCore),
    sheet: section.sheet,
    row: section.header_row ?? 7,
    owner_order_number: orderKey,
    location_name: section.location_name,
    section_code: sectionCode,
    owner_cost_code: section.owner_cost_code ?? null,
    title: section.title ?? section.location_name,
    as_of: section.as_of,
    ...(section.closing_conflict ? { closing_conflict: section.closing_conflict } : {}),
    ...(section.reconciliation_step ? { reconciliation_step: section.reconciliation_step } : {}),
    skipped_source_rows: skippedLines.length,
    skipped_reason_codes: skippedReasonCodes,
    lines,
  };
}

/**
 * Optional Contract v2 report: aggregate positive closing stock by (site location, item, unit)
 * so an operator can review what to load with `load_stock_opening`. Never mixes units; never writes.
 */
export function buildSuggestedStockOpenings(acceptedSections) {
  const byKey = new Map();
  for (const sec of acceptedSections ?? []) {
    const loc = sec.receiving_location_code || sec.location_name || 'UNMAPPED_LOCATION';
    for (const line of sec.lines ?? []) {
      const closing = Number(line.expected?.closing ?? 0);
      if (!(closing > 0)) continue;
      const key = `${loc}|${line.item_code}|${line.unit}`;
      const existing = byKey.get(key) ?? {
        location_code: loc,
        item_code: line.item_code,
        unit: line.unit,
        quantity_milli: 0,
      };
      existing.quantity_milli += Math.round(closing * 1000);
      byKey.set(key, existing);
    }
  }
  return [...byKey.values()]
    .sort((a, b) => a.location_code.localeCompare(b.location_code) || a.item_code.localeCompare(b.item_code))
    .map(({ location_code, item_code, unit, quantity_milli }) => ({
      location_code,
      item_code,
      unit,
      closing_quantity: String(quantity_milli / 1000),
    }));
}

async function callImportRpc(api, { sourceKey, payload, confirm, entityKey, stage }) {
  try {
    return await api.rpc('om_material_import', {
      p_source_key: sourceKey,
      p_schema_version: MATERIAL_SCHEMA_VERSION,
      p_payload: payload,
      p_confirm: confirm,
    });
  } catch (err) {
    if (err?.status === undefined && err?.code === undefined) {
      throw new MaterialOutcomeUnknown({ sourceKey, entityKey, stage });
    }
    throw err;
  }
}

function writeReportAtomically(reportPath, report) {
  const dir = path.dirname(reportPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${reportPath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  fs.renameSync(tmp, reportPath);
}

/** Resolve mapping.zero_cost_tag_name against config.zero_cost_tags (Contract v2.2 3b). Never creates a tag. */
function resolveZeroCostTag(tagName, zeroCostTags) {
  const needle = String(tagName || '').trim();
  const tags = Array.isArray(zeroCostTags) ? zeroCostTags : [];
  const exact = tags.filter((t) => String(t?.name ?? '').trim() === needle);
  if (exact.length === 1) return exact[0];
  const ci = tags.filter((t) => String(t?.name ?? '').trim().toLowerCase() === needle.toLowerCase());
  if (ci.length === 1) return ci[0];
  const available = tags.map((t) => `'${t?.name}'`).join(', ') || '(none)';
  const reason =
    ci.length > 1
      ? `Zero-cost tag '${needle}' matched multiple tags in this organisation (${available}).`
      : `Zero-cost tag '${needle}' was not found in this organisation's zero-cost stock tags (${available}). Create it in the app first; the loader never creates tags.`;
  throw new MaterialLoadError(reason, { exit: 2, code: 'zero_cost_tag_not_found' });
}

function normalizeScaleSteps(steps) {
  return [...(steps ?? [])]
    .sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0))
    .map((s, idx) => ({
      name: String(s.name ?? '').trim(),
      position: Number.isFinite(Number(s.position)) && Number(s.position) > 0 ? Number(s.position) : idx + 1,
      percentage: String(Number(s.percentage)),
    }));
}

function scalesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].name !== b[i].name) return false;
    if (a[i].position !== b[i].position) return false;
    if (Number(a[i].percentage) !== Number(b[i].percentage)) return false;
  }
  return true;
}

/**
 * Execute the full owner-supplied material load workflow (preview by default; write only with `confirm: true`).
 *
 * @param {{
 *   workbookPath: string,
 *   mappingPath: string,
 *   mapping: Record<string, any>,
 *   projectId: string,
 *   confirm?: boolean,
 *   reportPath?: string,
 *   pythonBin?: string,
 *   target?: { url?: string, user?: string | null },
 *   parseWorkbook?: (wbPath: string, mapPath: string, opts?: any) => Promise<any>,
 * }} opts
 * @param {{ get(table: string, query: string): Promise<any>, rpc(name: string, body: any): Promise<any> }} api
 */
export async function runMaterialLoad(opts, api) {
  const {
    workbookPath,
    mappingPath,
    mapping,
    projectId,
    confirm = false,
    reportPath,
    pythonBin,
    target = {},
    parseWorkbook = parseWorkbookWithPython,
  } = opts;

  if (!UUID_RE.test(String(projectId ?? ''))) {
    throw new MaterialLoadError('--project must be a valid project UUID', { exit: 2, code: 'invalid_project_id' });
  }

  const mapProblems = validateMapping(mapping);
  if (mapProblems.length > 0) {
    throw new MaterialLoadError(`Mapping file has ${mapProblems.length} problem(s); nothing was sent.`, {
      exit: 2,
      code: 'invalid_mapping',
      details: mapProblems,
    });
  }

  const parsed = await parseWorkbook(workbookPath, mappingPath, { pythonBin });
  const sourceKey = mapping.source_key.trim();

  // Read server config and existing project work orders
  const config = await api.rpc('om_material_config', {});
  const resolvedTag = resolveZeroCostTag(mapping.zero_cost_tag_name, config?.zero_cost_tags);
  const existingWorkOrders = await readProjectWorkOrders(api, projectId);

  const refusedSections = [...(parsed.refused_sections ?? [])];
  const eligibleSections = [];
  const missingOrdersMap = new Map(); // owner_order_number -> { title, sheetCfg }
  // Contract v2.4 §4: count of lines refused for field-length reasons (kept now that
  // truncation — and its own report counter — is gone).
  let fieldLengthExceededLines = 0;

  for (const rawSec of parsed.accepted_sections ?? []) {
    const secSheetCfg = mapping.sheets?.[rawSec.sheet] ?? mapping.sheets?.[rawSec.sheet.trim()] ?? {};
    const orderKey = String(rawSec.owner_order_number ?? '').trim();
    const locName = String(rawSec.location_name ?? '').trim();
    const secLimitRefusals = [];

    if (!locName || locName.length > DB_LIMITS.section_name) {
      secLimitRefusals.push({
        sheet: rawSec.sheet,
        row: rawSec.header_row ?? 7,
        column: 'A',
        class: 'field_length_exceeded',
        reason: `Section location_name length (${locName.length}) must be 1..${DB_LIMITS.section_name} characters.`,
      });
    }
    if (rawSec.owner_cost_code && String(rawSec.owner_cost_code).length > DB_LIMITS.owner_cost_code) {
      secLimitRefusals.push({
        sheet: rawSec.sheet,
        row: rawSec.header_row ?? 7,
        column: 'A',
        class: 'field_length_exceeded',
        reason: `Section owner_cost_code length (${String(rawSec.owner_cost_code).length}) exceeds ${DB_LIMITS.owner_cost_code} characters.`,
      });
    }
    if (rawSec.reconciliation_step && String(rawSec.reconciliation_step).trim().length > DB_LIMITS.reconciliation_step_name) {
      secLimitRefusals.push({
        sheet: rawSec.sheet,
        row: rawSec.header_row ?? 7,
        column: 'A',
        class: 'field_length_exceeded',
        reason: `Section reconciliation_step length (${String(rawSec.reconciliation_step).trim().length}) exceeds ${DB_LIMITS.reconciliation_step_name} characters.`,
      });
    }
    if (secSheetCfg.section_code !== undefined) {
      const explicitCode = String(secSheetCfg.section_code).trim();
      if (!explicitCode || explicitCode.length > DB_LIMITS.section_code) {
        secLimitRefusals.push({
          sheet: rawSec.sheet,
          row: rawSec.header_row ?? 7,
          column: 'A',
          class: 'field_length_exceeded',
          reason: `Mapped section_code '${explicitCode}' length (${explicitCode.length}) must be 1..${DB_LIMITS.section_code} characters.`,
        });
      }
    }
    const secKeyPreview = `section:${sourceKey}:${orderKey}:${locName.toLowerCase()}`;
    if (secKeyPreview.length > DB_LIMITS.entity_key) {
      secLimitRefusals.push({
        sheet: rawSec.sheet,
        row: rawSec.header_row ?? 7,
        column: 'A',
        class: 'field_length_exceeded',
        reason: `Section entity_key length (${secKeyPreview.length}) exceeds ${DB_LIMITS.entity_key} characters.`,
      });
    }
    if (secLimitRefusals.length > 0) {
      refusedSections.push({
        sheet: rawSec.sheet,
        owner_order_number: rawSec.owner_order_number,
        location_name: rawSec.location_name,
        refusals: secLimitRefusals,
      });
      continue;
    }

    // Line-level DB column length checks (skip over-limit lines rather than silently truncating)
    const validLines = [];
    const extraSkipped = [];
    for (const line of rawSec.lines ?? []) {
      const codeStr = String(line.item_code ?? '').trim();
      const nameStr = String(line.item_name ?? '').trim();
      const unitStr = String(line.unit ?? '').trim();
      const catStr = line.category_code != null ? String(line.category_code).trim() : '';
      const lineKey = `line:${sourceKey}:${orderKey}:${locName.toLowerCase()}:${codeStr}`;
      const lineProblems = [];
      if (codeStr.length > DB_LIMITS.item_code) {
        lineProblems.push(`item_code length (${codeStr.length}) exceeds ${DB_LIMITS.item_code} characters`);
      }
      if (nameStr.length > DB_LIMITS.item_name) {
        lineProblems.push(`item_name length (${nameStr.length}) exceeds ${DB_LIMITS.item_name} characters`);
      }
      if (unitStr.length > DB_LIMITS.unit_code) {
        lineProblems.push(`unit code length (${unitStr.length}) exceeds ${DB_LIMITS.unit_code} characters`);
      }
      if (catStr.length > DB_LIMITS.category_code) {
        lineProblems.push(`category_code length (${catStr.length}) exceeds ${DB_LIMITS.category_code} characters`);
      }
      if (lineKey.length > DB_LIMITS.entity_key) {
        lineProblems.push(`line entity_key length (${lineKey.length}) exceeds ${DB_LIMITS.entity_key} characters`);
      }
      // Contract v2.4 §4: an evidence value over the per-value limit refuses the whole line
      // (field_length_exceeded) instead of being truncated; nothing is silently shortened.
      const { evidence: flatEv, oversized } = flattenEvidence(line.evidence);
      for (const o of oversized) {
        lineProblems.push(
          `evidence value '${o.key}' (${o.bytes} bytes) exceeds the ${MAX_EVIDENCE_VALUE_BYTES}-byte per-value limit`,
        );
      }
      const evBytes = Buffer.byteLength(JSON.stringify(flatEv), 'utf8');
      if (evBytes > DB_LIMITS.evidence_total_bytes) {
        lineProblems.push(`serialized evidence size (${evBytes} bytes) exceeds ${DB_LIMITS.evidence_total_bytes} bytes`);
      }
      if (lineProblems.length > 0) {
        extraSkipped.push({
          sheet: rawSec.sheet,
          row: line.row,
          column: 'B',
          item_code: codeStr,
          class: 'field_length_exceeded',
          reason: lineProblems.join('; '),
        });
      } else {
        validLines.push(line);
      }
    }
    fieldLengthExceededLines += extraSkipped.length;

    if (validLines.length === 0 && extraSkipped.length > 0) {
      refusedSections.push({
        sheet: rawSec.sheet,
        owner_order_number: rawSec.owner_order_number,
        location_name: rawSec.location_name,
        refusals: [...(rawSec.skipped_lines ?? []), ...extraSkipped],
      });
      continue;
    }

    const sec =
      extraSkipped.length > 0
        ? {
            ...rawSec,
            partial: true,
            lines: validLines,
            skipped_lines: [...(rawSec.skipped_lines ?? []), ...extraSkipped],
          }
        : rawSec;

    if ((sec.lines ?? []).length > MAX_SECTION_LINES) {
      refusedSections.push({
        sheet: sec.sheet,
        owner_order_number: sec.owner_order_number,
        location_name: sec.location_name,
        refusals: [
          {
            sheet: sec.sheet,
            row: sec.header_row ?? 7,
            column: 'A',
            class: 'section_row_limit_exceeded',
            reason: `Section has ${sec.lines.length} lines, exceeding the ${MAX_SECTION_LINES}-line contract limit.`,
          },
        ],
      });
      continue;
    }

    const match = matchWorkOrder(sec.owner_order_number, existingWorkOrders);
    if (match.status === 'ambiguous') {
      refusedSections.push({
        sheet: sec.sheet,
        owner_order_number: sec.owner_order_number,
        location_name: sec.location_name,
        refusals: [
          {
            sheet: sec.sheet,
            row: sec.header_row ?? 7,
            column: 'G',
            class: 'ambiguous_work_order_match',
            reason: match.reason,
          },
        ],
      });
      continue;
    }
    if (match.status === 'missing') {
      const orderKey = String(sec.owner_order_number).trim();
      if (!missingOrdersMap.has(orderKey)) {
        const sheetCfg = mapping.sheets?.[sec.sheet] ?? mapping.sheets?.[sec.sheet.trim()] ?? {};
        missingOrdersMap.set(orderKey, { title: sec.title || orderKey, sheetCfg });
      }
    }
    eligibleSections.push(sec);
  }

  // Step 1 (Contract v1.1): prepare / create missing work orders via import_work_orders
  const workOrderRows = [];
  const workOrderProblems = [];
  for (const [ownerOrderNumber, info] of missingOrdersMap.entries()) {
    const built = buildWorkOrderImportRow(ownerOrderNumber, info.title, mapping, info.sheetCfg);
    if (built.problems.length > 0) {
      workOrderProblems.push(...built.problems);
    } else {
      workOrderRows.push(built.row);
    }
  }
  if (workOrderProblems.length > 0) {
    throw new MaterialLoadError(
      `Cannot create ${missingOrdersMap.size} missing work order(s) without explicit commercial inputs in mapping; nothing was written.`,
      { exit: 2, code: 'missing_work_order_commercial_inputs', details: workOrderProblems },
    );
  }

  const workOrdersPlan = {
    mode: confirm ? 'confirm' : 'preview',
    existing_count: existingWorkOrders.length,
    to_create_count: workOrderRows.length,
    rows: workOrderRows,
    created: 0,
    ids: [],
    // Standing prerequisite (preview only): the operator must know before confirming.
    ...(workOrderRows.length > 0 && !confirm ? { prerequisite: SETUP_WORKFLOWS_PREREQUISITE } : {}),
  };

  if (confirm && workOrderRows.length > 0) {
    for (const chunk of chunkArray(workOrderRows, MAX_WORK_ORDER_CHUNK)) {
      let res;
      try {
        res = await api.rpc('import_work_orders', { p_project: projectId, p_rows: chunk });
      } catch (err) {
        if (isSetupWorkflowsDisabledError(err)) throw setupWorkflowsDisabledError();
        throw err;
      }
      workOrdersPlan.created += Number(res?.created ?? chunk.length);
      if (Array.isArray(res?.ids)) workOrdersPlan.ids.push(...res.ids);
    }
  }

  // Step 2: Catalogue chunks (<= 500 entries per call; units sent in their own chunk(s) first — Contract v2.3 §1)
  const catalogueEntities = buildCatalogueEntities(
    { ...parsed, accepted_sections: eligibleSections },
    mapping,
    resolvedTag.id,
  );
  const catalogueByKey = new Map(catalogueEntities.map((e) => [e.entity_key, e]));
  const unitEntities = catalogueEntities.filter((e) => e.type === 'unit');
  const orderedCatalogueChunks = buildCatalogueChunks(catalogueEntities, MAX_CATALOGUE_CHUNK);

  const catalogueResults = [];
  let catalogueComplete = true;
  let lastBatchId = null;

  for (const [idx, chunk] of orderedCatalogueChunks.entries()) {
    const res = await callImportRpc(api, {
      sourceKey,
      confirm,
      entityKey: `catalogue-chunk-${idx + 1}`,
      stage: 'catalogue',
      payload: {
        kind: 'catalogue',
        project_id: projectId,
        source_digest: parsed.source_digest,
        entities: chunk,
      },
    });
    if (res?.batch_id) lastBatchId = res.batch_id;
    if (Array.isArray(res?.results)) catalogueResults.push(...res.results);
    if (res?.complete === false) catalogueComplete = false;
  }

  const createdUnitKeys = new Set(
    catalogueResults
      .filter((r) => String(r.entity_key ?? '').startsWith('unit:') && r.status === 'create')
      .map((r) => r.entity_key),
  );
  const unitsToCreate = unitEntities
    .filter((u) => createdUnitKeys.has(u.entity_key))
    .map((u) => ({ code: u.code, name: u.name, whole_only: u.whole_only }));

  // Step 2.5 (Contract v2.2 3a): Reconciliation scale comparison / update before sections
  const currentScale = normalizeScaleSteps(config?.steps ?? []);
  const desiredScale = Array.isArray(mapping.reconciliation_scale) ? normalizeScaleSteps(mapping.reconciliation_scale) : null;
  let scaleReport = { status: 'unchanged', before: currentScale, after: currentScale };
  let scaleBlocked = false;

  if (desiredScale) {
    if (scalesEqual(currentScale, desiredScale)) {
      scaleReport = { status: 'skip', before: currentScale, after: desiredScale };
    } else if (!confirm) {
      scaleReport = { status: 'update', before: currentScale, after: desiredScale };
    } else {
      try {
        await api.rpc('om_material_set_scale', { p_steps: desiredScale });
        scaleReport = { status: 'updated', before: currentScale, after: desiredScale };
      } catch (err) {
        if (err?.status === undefined && err?.code === undefined) {
          throw new MaterialOutcomeUnknown({ sourceKey, entityKey: 'reconciliation_scale', stage: 'reconciliation_scale' });
        }
        scaleReport = { status: 'refused', before: currentScale, after: desiredScale, error: err?.message ?? String(err) };
        scaleBlocked = true;
      }
    }
  }

  // Step 3: Sections (1 section per call; always carries projected catalogue_entities + reconciliation_scale — Contract v2.3 §2)
  const usedSectionCodesByOrder = new Map();
  const sectionResults = [];
  const closedWorkOrderRefusals = [];
  let sectionsComplete = !scaleBlocked;

  if (!scaleBlocked) {
    for (const sec of eligibleSections) {
      const orderKey = String(sec.owner_order_number).trim();
      let used = usedSectionCodesByOrder.get(orderKey);
      if (!used) {
        used = new Set();
        usedSectionCodesByOrder.set(orderKey, used);
      }
      const sheetCfg = mapping.sheets?.[sec.sheet] ?? mapping.sheets?.[sec.sheet.trim()] ?? {};
      const sectionCode = sheetCfg.section_code ? String(sheetCfg.section_code).trim() : deriveSectionCode(sec.location_name, used);
      used.add(sectionCode.toLowerCase());

      const entity = buildSectionEntity(sec, sourceKey, sectionCode);
      const sectionDeps = buildSectionCatalogueDependencies(sec, catalogueByKey);
      const matchedWo = matchWorkOrder(orderKey, existingWorkOrders);
      const woStatus = matchedWo.status === 'matched' ? matchedWo.workOrder?.status ?? null : null;
      const isClosedWo = woStatus !== null && woStatus !== 'Draft' && woStatus !== 'Issued';

      const res = await callImportRpc(api, {
        sourceKey,
        confirm,
        entityKey: entity.entity_key,
        stage: 'section',
        payload: {
          kind: 'section',
          project_id: projectId,
          source_digest: parsed.source_digest,
          catalogue_entities: sectionDeps,
          ...(desiredScale ? { reconciliation_scale: desiredScale } : {}),
          entities: [entity],
        },
      });
      if (res?.batch_id) lastBatchId = res.batch_id;
      let hadNonQueuedRefusal = false;
      if (Array.isArray(res?.results)) {
        for (const r of res.results) {
          const reasonCode = r.reason_code ?? r.reason ?? '';
          if (!confirm && r.status === 'refused' && reasonCode === 'material-work-order-missing' && missingOrdersMap.has(orderKey)) {
            sectionResults.push({
              ...r,
              reason_code: reasonCode,
              status: 'pending_work_order',
              note: 'work order will be created on confirm',
            });
          } else if (
            r.status === 'refused' &&
            reasonCode === 'material-conflict' &&
            (isClosedWo || /\b(closed|frozen|completed|cancelled)\b/i.test(String(r.reason ?? '')))
          ) {
            closedWorkOrderRefusals.push({
              sheet: sec.sheet,
              owner_order_number: orderKey,
              location_name: sec.location_name,
              work_order_status: woStatus,
              entity_key: r.entity_key,
              reason_code: reasonCode,
              reason: r.reason ?? reasonCode,
            });
            hadNonQueuedRefusal = true;
          } else {
            sectionResults.push(r);
            if (r.status === 'refused') hadNonQueuedRefusal = true;
          }
        }
      }
      if (res?.complete === false && (hadNonQueuedRefusal || confirm || !missingOrdersMap.has(orderKey))) {
        sectionsComplete = false;
      }
    }
  }

  const serverRefused = [
    ...catalogueResults.filter((r) => r.status === 'refused'),
    ...sectionResults.filter((r) => r.status === 'refused'),
  ];

  const partialSections = eligibleSections
    .filter((s) => s.partial || (s.skipped_lines?.length ?? 0) > 0)
    .map((s) => ({
      sheet: s.sheet,
      owner_order_number: s.owner_order_number,
      location_name: s.location_name,
      accepted_line_count: s.lines?.length ?? 0,
      skipped_lines: s.skipped_lines ?? [],
    }));
  const skippedLinesCount = partialSections.reduce((sum, s) => sum + s.skipped_lines.length, 0);
  const emptyLinesCount = eligibleSections.reduce((sum, s) => sum + (s.empty_lines?.length ?? 0), 0);

  const policyFlaggedSections = eligibleSections
    .filter(
      (s) =>
        (s.policy_flags?.closing_conflicts?.length ?? 0) > 0 ||
        (s.policy_flags?.negative_closings?.length ?? 0) > 0 ||
        (s.policy_flags?.set_aside_conflicts?.length ?? 0) > 0 ||
        (s.policy_flags?.received_conflicts?.length ?? 0) > 0 ||
        (s.policy_flags?.consolidated_items?.length ?? 0) > 0,
    )
    .map((s) => ({
      sheet: s.sheet,
      owner_order_number: s.owner_order_number,
      closing_conflicts: s.policy_flags.closing_conflicts ?? [],
      negative_closings: s.policy_flags.negative_closings ?? [],
      set_aside_conflicts: s.policy_flags.set_aside_conflicts ?? [],
      received_conflicts: s.policy_flags.received_conflicts ?? [],
      consolidated_items: s.policy_flags.consolidated_items ?? [],
    }));

  const complete =
    !scaleBlocked &&
    refusedSections.length === 0 &&
    partialSections.length === 0 &&
    closedWorkOrderRefusals.length === 0 &&
    serverRefused.length === 0 &&
    catalogueComplete &&
    sectionsComplete;

  const report = {
    mode: confirm ? 'confirm' : 'preview',
    target: {
      url: target.url ?? null,
      project_id: projectId,
      user: target.user ?? null,
    },
    source_key: sourceKey,
    source_digest: parsed.source_digest,
    schema_version: MATERIAL_SCHEMA_VERSION,
    batch_id: lastBatchId,
    policy: parsed.policy ?? {
      closing_conflict: mapping.policy?.closing_conflict ?? 'refuse',
      duplicate_items: mapping.policy?.duplicate_items ?? 'refuse',
    },
    zero_cost_tag: { id: resolvedTag.id, name: resolvedTag.name },
    reconciliation_scale: scaleReport,
    units_to_create: unitsToCreate,
    config_summary: {
      categories: config?.categories?.length ?? 0,
      owner_warehouses: config?.owner_warehouses?.length ?? 0,
      steps: config?.steps?.length ?? 0,
      zero_cost_tags: config?.zero_cost_tags?.length ?? 0,
    },
    work_orders: workOrdersPlan,
    counts: {
      accepted_sections: eligibleSections.length,
      partial_sections: partialSections.length,
      skipped_lines: skippedLinesCount,
      empty_lines: emptyLinesCount,
      refused_sections: refusedSections.length,
      closed_work_order_refusals: closedWorkOrderRefusals.length,
      catalogue_entities: catalogueEntities.length,
      units_to_create: unitsToCreate.length,
      server_refused: serverRefused.length,
      policy_flagged_sections: policyFlaggedSections.length,
      field_length_exceeded_lines: fieldLengthExceededLines,
    },
    catalogue_results: catalogueResults,
    section_results: sectionResults,
    partial_sections: partialSections,
    closed_work_order_refusals: closedWorkOrderRefusals,
    refused_sections: refusedSections,
    policy_flagged_sections: policyFlaggedSections,
    suggested_stock_openings: buildSuggestedStockOpenings(eligibleSections),
    complete,
    ...(confirm ? {} : { next: 'Re-run with --confirm to apply the accepted records.' }),
  };

  const finalReportPath = reportPath || mapping.report_path;
  if (finalReportPath) {
    writeReportAtomically(finalReportPath, report);
    report.report_path = finalReportPath;
  }

  return { report, exit: complete ? 0 : 1 };
}
