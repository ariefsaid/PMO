/**
 * `pmo equipment` (#1519): equipment usage totals and versioned costing settings.
 * The database validates settings and decides who may call; this module shapes calls and protects dry runs.
 * Contract: docs/specs/equipment-usage.spec.md §8. Node 22 standard library only.
 */

/** The API-client guard tiers (S4) — keep in step with equipment_*_rpcs. */
export const EQUIPMENT_WRITE_RPCS = Object.freeze([
  'preview_equipment_costing',
  'save_equipment_costing',
  'end_equipment_costing',
]);
export const EQUIPMENT_READ_RPCS = Object.freeze([
  'list_equipment_costing',
  'list_equipment_allocations',
]);
export const EQUIPMENT_USAGE_RPCS = Object.freeze(['list_equipment_usage_totals']);
export const MAX_SETTINGS = 50;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_USAGE_RANGE_DAYS = 731;

/** A file that cannot be safely sent to the database. */
export class EquipmentFileError extends Error {
  constructor(problems) {
    super(problems.join('; '));
    this.problems = problems;
  }
}

/** Usage query arguments that are invalid before a request is sent. */
export class EquipmentUsageError extends Error {
  constructor(problems) {
    super(problems.join('; '));
    this.problems = problems;
  }
}

/** One setting object or an array of settings → an array. Shape only; SQL owns domain validation. */
export function readSettings(doc) {
  const settings = Array.isArray(doc) ? doc : [doc];
  const problems = [];
  if (settings.length === 0) problems.push('the file has no settings');
  if (settings.length > MAX_SETTINGS) problems.push(`at most ${MAX_SETTINGS} settings per file`);
  settings.forEach((setting, index) => {
    if (setting === null || typeof setting !== 'object' || Array.isArray(setting)) {
      problems.push(`setting ${index + 1} is not a JSON object`);
    }
  });
  if (problems.length > 0) throw new EquipmentFileError(problems);
  return settings;
}

/** Validate a bounded usage-total request and return the PostgREST RPC body. */
export function validateUsageList({ project, asset, from, to }) {
  const problems = [];
  const hasProject = project !== undefined && project !== null && String(project).trim() !== '';
  const hasAsset = asset !== undefined && asset !== null && String(asset).trim() !== '';
  if (hasProject === hasAsset) problems.push('name exactly one of --project or --asset');
  if (hasProject && !UUID.test(String(project))) problems.push('--project must be a project id (uuid)');
  if (hasAsset && !UUID.test(String(asset))) problems.push('--asset must be an asset id (uuid)');
  if (!isCalendarDate(from)) problems.push('--from must be a date (YYYY-MM-DD)');
  if (!isCalendarDate(to)) problems.push('--to must be a date (YYYY-MM-DD)');
  if (isCalendarDate(from) && isCalendarDate(to)) {
    const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
    if (days < 0) problems.push('--to must be on or after --from');
    else if (days > MAX_USAGE_RANGE_DAYS) problems.push('the date range may not exceed two years');
  }
  if (problems.length > 0) throw new EquipmentUsageError(problems);
  return {
    p_project_id: hasProject ? String(project).toLowerCase() : null,
    p_asset_id: hasAsset ? String(asset).toLowerCase() : null,
    p_from: from,
    p_to: to,
  };
}

function isCalendarDate(value) {
  if (typeof value !== 'string' || !DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

const MESSAGES = {
  42501: 'Not allowed: equipment costing is managed by an active Admin or Finance member; active Admin, Finance, Executive and Project Manager members may list settings.',
  22023: 'The equipment costing setting is not valid',
  P0002: 'Not found',
  23505: 'This equipment costing conflicts with another rule that matches the same costs. Narrow the setting or change its dates',
  40001: 'The equipment costing setting changed since you loaded it. Run `pmo equipment costing list` and use the current version',
};

/** A clear message for a database refusal; keeps the database's reason after a colon. */
export function explainError(error) {
  const base = MESSAGES[error?.code];
  if (!base) return error?.message ?? String(error);
  if (error.code === '42501') return base;
  return error.message ? `${base}: ${error.message}` : base;
}

/** Preview every setting in order: [{index, rows}]. A refusal carries its setting index. */
export async function previewSettings(api, settings) {
  const previews = [];
  for (const [index, setting] of settings.entries()) {
    try {
      const rows = await api.rpc('preview_equipment_costing', { p_setting: setting });
      previews.push({ index: index + 1, rows: Array.isArray(rows) ? rows : [] });
    } catch (error) {
      error.settingIndex = index + 1;
      throw error;
    }
  }
  return previews;
}

/** Preview every setting before saving any; with dryRun, no write RPC is sent. */
export async function setSettings(api, settings, { dryRun }) {
  const previews = await previewSettings(api, settings);
  if (dryRun) {
    return {
      dry_run: true,
      results: previews.map((preview) => ({
        index: preview.index,
        action: 'would_save',
        total: total(preview.rows),
        rows: preview.rows,
      })),
    };
  }

  const applied = [];
  for (const [index, setting] of settings.entries()) {
    try {
      const saved = await api.rpc('save_equipment_costing', { p_setting: setting });
      applied.push({ index: index + 1, ...saved, total: total(previews[index].rows) });
    } catch (error) {
      error.settingIndex = index + 1;
      error.applied = applied;
      throw error;
    }
  }
  return { dry_run: false, results: applied };
}

function total(rows) {
  const cents = rows.reduce((sum, row) => sum + Math.round(Number(row.amount ?? 0) * 100), 0);
  return (cents / 100).toFixed(2);
}

/** Human-readable rows for costing previews and usage totals. */
export function formatAllocations(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return '(no equipment allocations in this window)\n';
  return `${rows.map((row) => {
    const month = String(row.month ?? '').slice(0, 7) || '(unknown month)';
    const project = row.project_name ?? row.project_id ?? '(no project)';
    const category = row.category ? ` · ${row.category}` : '';
    if (row.project_id == null && row.amount !== null && row.amount !== undefined) {
      return `${month} · unallocated: ${Number(row.amount).toFixed(2)}${category}`;
    }
    if (row.amount !== null && row.amount !== undefined) {
      const basis = row.basis ?? 'allocated';
      return `${month} · ${project} · ${basis} · ${Number(row.amount).toFixed(2)}${category}`;
    }
    const measures = [
      row.work_units != null && `${row.work_units} ${row.unit ?? 'units'}`,
      row.standby_units != null && Number(row.standby_units) > 0 && `${row.standby_units} standby ${row.unit ?? 'units'}`,
      row.fuel_litres != null && Number(row.fuel_litres) > 0 && `${row.fuel_litres} L`,
      row.trips != null && Number(row.trips) > 0 && `${row.trips} trips`,
    ].filter(Boolean);
    const detail = measures.length > 0 ? ` (${measures.join(', ')})` : '';
    return `${month} · ${project}${category} · usage only${detail}`;
  }).join('\n')}\n`;
}
