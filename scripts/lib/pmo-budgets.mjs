/**
 * `pmo budgets activate` (#1270 B). Activation runs under the EXISTING rules: this only calls the same RPCs the app
 * calls. `budget_activation_mode` (read, tells the caller whether the second-person rule lets them activate) is asked
 * first so a refused caller leaves nothing behind; the optional source file is linked while the version is still a
 * Draft; `activate_budget_version` then decides, with its own separation-of-duties checks. Node 22 standard library only.
 */

/** The BUDGET-ACTIVATION tier of the API-client guard — keep in step with the guard's allow-list. */
export const BUDGET_RPCS = Object.freeze(['budget_activation_mode', 'link_m365_documents_batch', 'activate_budget_version']);
/**
 * OFF until the API-client guard carries an `activate_budget_version` tier. The owner has not ruled on it, so the
 * guard refuses that RPC and the CLI says so up front instead of linking a file and then failing.
 */
export const ACTIVATION_ENABLED = false;
const SP_FIELDS = ['drive_id', 'item_id', 'web_url', 'name', 'kind'];
const ALLOWED_MODES = new Set(['allowed', 'sole_operator']);
const MODE_REASONS = {
  blocked: 'You cannot activate this budget version (not found, another organisation, or your role does not allow it).',
  blocked_editor: 'separation of duties: You edited this version, so someone else must activate it.',
  blocked_no_drafter: 'a budget version with no recorded drafter can be activated by Admin or Finance only',
};

/** The activation was refused by the database's own rule; nothing was written. */
export class ActivationRefused extends Error {
  constructor(message, mode) {
    super(message);
    this.code = 'activation_refused';
    this.mode = mode;
  }
}

/** Problems with a --source row (same shape as `pmo purchases link-file`'s item); [] when valid. */
export function validateSource(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return ['--source must be a JSON object {drive_id, item_id, web_url, name, kind}'];
  const problems = Object.keys(item).filter((k) => !SP_FIELDS.includes(k)).map((k) => `--source has an unknown field '${k}'`);
  for (const k of SP_FIELDS) if (typeof item[k] !== 'string' || item[k].trim() === '') problems.push(`--source needs ${k}`);
  if (typeof item.kind === 'string' && item.kind !== '' && !['file', 'folder'].includes(item.kind)) problems.push("--source kind must be 'file' or 'folder'");
  if (typeof item.web_url === 'string' && item.web_url !== '' && !/^https:\/\//i.test(item.web_url)) problems.push('--source web_url must be an https link');
  return problems;
}

/**
 * Attach a SharePoint item to a Draft budget version through `link_m365_documents_batch` with one `budget_version_id`
 * row: the batch RPC pins the link to the organisation's own SharePoint host and is already in the API-client guard.
 * Linking the same item twice is a no-op (`already_linked`).
 * @returns {Promise<{version_id: string, state: string, link_id: string|null}>}
 */
export async function linkBudgetSource(api, versionId, source) {
  const out = await api.rpc('link_m365_documents_batch', { p_rows: [{ budget_version_id: versionId, ...source }], p_dry_run: false });
  const row = out?.results?.[0];
  return { version_id: versionId, state: row?.state ?? 'unknown', link_id: row?.document_id ?? null };
}

/**
 * Activate a budget version, attaching the source file first when given.
 * @param {{rpc: (name: string, body: object) => Promise<any>}} api
 * @returns {Promise<{version_id: string, activated: true, activation_mode: string, source_link_id: string|null}>}
 */
export async function activateBudget(api, versionId, { source } = {}) {
  const mode = await api.rpc('budget_activation_mode', { version_id: versionId });
  if (!ALLOWED_MODES.has(mode)) throw new ActivationRefused(MODE_REASONS[mode] ?? `The activation check answered '${mode}'.`, mode);
  let linkId = null;
  if (source !== undefined) linkId = (await linkBudgetSource(api, versionId, source)).link_id;
  try {
    await api.rpc('activate_budget_version', { version_id: versionId });
  } catch (e) {
    e.sourceLinkId = linkId;
    throw e;
  }
  return { version_id: versionId, activated: true, activation_mode: mode, source_link_id: linkId };
}
