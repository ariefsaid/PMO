/**
 * `pmo attribution` (#1271): cost attribution rules — preview, set (save a new rule or a new version), end, list.
 * Every check is the database's (migration 0376): the RPCs validate the rule, refuse ties and stale versions, and
 * decide who may call them. This module only shapes the calls, the dry run and the messages.
 * Contract: docs/specs/cost-attribution.spec.md §3. Node 22 standard library only.
 */

/** The API-client guard tiers (0376) — keep in step with `cost_attribution_write_rpcs` / `cost_attribution_read_rpcs`. */
export const ATTRIBUTION_WRITE_RPCS = Object.freeze(['preview_cost_attribution', 'save_cost_attribution_rule', 'end_cost_attribution_rule']);
export const ATTRIBUTION_READ_RPCS = Object.freeze(['list_cost_attribution_rules']);
export const MAX_RULES = 50;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A refusal before anything is sent; `problems` lists every reason. */
export class AttributionFileError extends Error {
  constructor(problems) {
    super(problems.join('; '));
    this.problems = problems;
  }
}

/** One rule object or an array of them → an array. Shape only; the database validates the content. */
export function readRules(doc) {
  const rules = Array.isArray(doc) ? doc : [doc];
  const problems = [];
  if (rules.length === 0) problems.push('the file has no rules');
  if (rules.length > MAX_RULES) problems.push(`at most ${MAX_RULES} rules per file`);
  rules.forEach((r, i) => {
    if (r === null || typeof r !== 'object' || Array.isArray(r)) problems.push(`rule ${i + 1} is not a JSON object`);
  });
  if (problems.length > 0) throw new AttributionFileError(problems);
  return rules;
}

/** Check the arguments of `pmo attribution end`. */
export function validateEnd({ ruleKey, to, version }) {
  const problems = [];
  if (!ruleKey || !UUID.test(ruleKey)) problems.push('a rule_key (uuid) is required');
  if (!to || !DATE.test(to) || Number.isNaN(Date.parse(`${to}T00:00:00Z`))) problems.push('--to must be a date (YYYY-MM-DD)');
  if (!/^\d+$/.test(String(version ?? '')) || Number(version) < 1) problems.push('--version must be the current version number (see pmo attribution list)');
  if (problems.length > 0) throw new AttributionFileError(problems);
  return { p_rule_key: ruleKey.toLowerCase(), p_effective_to: to, p_expected_version: Number(version) };
}

const MESSAGES = {
  42501: 'Not allowed: rules are managed by an active Admin or Finance member (Executive and Project Manager may list them).',
  22023: 'The rule is not valid',
  P0002: 'Not found',
  23505: 'This rule ties another rule (same specificity, overlapping dates, a line both could take). Narrow it with a cost centre or party, or change its dates',
  40001: 'The rule changed since you loaded it. Run `pmo attribution list` and set expected_version to the current version',
};

/** A clear message for a database refusal; keeps the database's own reason after a colon. */
export function explainError(e) {
  const base = MESSAGES[e?.code];
  if (!base) return e?.message ?? String(e);
  if (e.code === '42501') return base;
  return e.message ? `${base}: ${e.message}` : base;
}

/** Preview every rule: [{index, name, rows}]. A refusal throws with `ruleIndex` set. */
export async function previewRules(api, rules) {
  const out = [];
  for (const [i, rule] of rules.entries()) {
    try {
      const rows = await api.rpc('preview_cost_attribution', { p_rule: rule });
      out.push({ index: i + 1, name: rule.name ?? null, rows: Array.isArray(rows) ? rows : [] });
    } catch (e) {
      e.ruleIndex = i + 1;
      throw e;
    }
  }
  return out;
}

/**
 * Set every rule in order. Each is previewed first (the same validation and tie check as the save); with `dryRun`
 * nothing else is sent. A dry run also checks an edit's expected_version against the current list. On a failure the
 * error carries `applied` (the rules already saved) and `ruleIndex`.
 */
export async function setRules(api, rules, { dryRun }) {
  const previews = await previewRules(api, rules);
  if (dryRun) {
    const edits = rules.filter((r) => r.rule_key);
    if (edits.length > 0) {
      const current = await api.rpc('list_cost_attribution_rules', { p_include_history: false });
      for (const [i, rule] of rules.entries()) {
        if (!rule.rule_key) continue;
        const row = (Array.isArray(current) ? current : []).find((c) => c.rule_key === String(rule.rule_key).toLowerCase());
        if (!row) throw Object.assign(new Error(`rule ${rule.rule_key}`), { code: 'P0002', ruleIndex: i + 1 });
        if (Number(rule.expected_version) !== row.version) {
          throw Object.assign(new Error(`current version is ${row.version}`), { code: '40001', ruleIndex: i + 1 });
        }
      }
    }
    return { dry_run: true, results: previews.map((p) => ({ index: p.index, name: p.name, action: 'would_save', total: total(p.rows), rows: p.rows })) };
  }
  const applied = [];
  for (const [i, rule] of rules.entries()) {
    try {
      const saved = await api.rpc('save_cost_attribution_rule', { p_rule: rule });
      applied.push({ index: i + 1, name: rule.name ?? null, ...saved, total: total(previews[i].rows) });
    } catch (e) {
      e.ruleIndex = i + 1;
      e.applied = applied;
      throw e;
    }
  }
  return { dry_run: false, results: applied };
}

function total(rows) {
  const cents = rows.reduce((s, r) => s + Math.round(Number(r.amount) * 100), 0);
  return (cents / 100).toFixed(2);
}

/** A readable preview table: one block per rule, rows by month then project then category. */
export function formatPreview(previews, projectNames = new Map()) {
  const lines = [];
  for (const p of previews) {
    lines.push(`Rule ${p.index}${p.name ? `: ${p.name}` : ''}`);
    if (p.rows.length === 0) {
      lines.push('  (no ledger lines match in this window)', '');
      continue;
    }
    const table = p.rows.map((r) => [
      projectNames.get(r.project_id) ?? r.project_id,
      String(r.month ?? '').slice(0, 7),
      r.category ?? '(account not mapped to a budget category: not shown in actuals)',
      Number(r.amount).toFixed(2),
      String(r.line_count),
    ]);
    const head = ['Project', 'Month', 'Category', 'Amount', 'Lines'];
    const widths = head.map((h, c) => Math.max(h.length, ...table.map((row) => row[c].length)));
    const fmt = (row) => `  ${row.map((v, c) => (c >= 3 ? v.padStart(widths[c]) : v.padEnd(widths[c]))).join('  ')}`.trimEnd();
    lines.push(fmt(head), fmt(widths.map((w) => '-'.repeat(w))), ...table.map(fmt));
    lines.push(`  Total ${total(p.rows)}`, '');
  }
  return `${lines.join('\n')}\n`;
}
