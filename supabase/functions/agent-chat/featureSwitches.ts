/**
 * featureSwitches.ts — the ONE entity/tool → plan-switch-key map for the assistant (S4, FR-PLN-008).
 *
 * The rule the slice implements: while a key resolves *off* for the caller's org, the assistant is not
 * OFFERED that key's tools or entities, and refuses them at execution if the model calls anyway
 * (AC-PLN-006). "Off" means the caller org's resolved switches — `resolved_org_features()` under the
 * caller JWT (0533:180-202), resolved once per request by featureResolution.ts.
 *
 * CORE = no key = never gated. Core modules (0533 `core_feature_keys()`) and the caller's own
 * directory/inbox carry no entitlement, so they stay offered at every plan (AC-PLN-004's rule, from
 * the assistant side).
 *
 * Purity: the only import is the dependency-free read catalogue; no I/O — the handler, the actions and
 * the tests all read the same data.
 */
import { AGENT_READ_ENTITIES } from './readEntities.ts';

/** The caller org's resolved switches: key → enabled. `null` = not resolved (nothing known is off). */
export type FeatureSwitches = Readonly<Record<string, boolean>>;

/** Minimal structural view of a model tool definition (name only — nothing else is read here). */
export interface NamedTool {
  function: { name: string };
}

/**
 * Entity → switch key. An entity that appears here is offered only while its key is on. An entity
 * absent from this map is CORE (offered always) — see S4.0 of the plan for the per-row reasoning.
 */
export const ENTITY_FEATURE_KEYS: Readonly<Record<string, string>> = Object.freeze({
  // CRM (companies/contacts + the activity log)
  companies: 'crm',
  contacts: 'crm',
  crm_activities: 'crm',
  // Incidents / HSE
  incidents: 'incidents',
  // Timesheets (the header summary; entries are deliberately not exposed)
  timesheets: 'timesheets',
  // Procurement — the basic module: create, approve, track (decision #2)
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
  // D17 (#1783 item 1): receipts are a BASIC read — whole-purchase receipts and receipt reads stay on
  // `procurement`; `procurement_full` is line-level receipt writes and the order/receipt/invoice match,
  // which have no assistant read entity of their own (justified by the completeness ALLOWLIST entry).
  procurement_receipts: 'procurement',
  // Warehouse / stock (#1721 read surfaces)
  stock_items: 'stock',
  stock_warehouses: 'stock',
  stock_documents: 'stock',
  stock_document_lines: 'stock',
  stock_reorder_levels: 'stock',
});

/** Tool (action) name → switch key. Absent = CORE (always offered). See S4.1 of the plan. */
export const TOOL_FEATURE_KEYS: Readonly<Record<string, string>> = Object.freeze({
  query_stock: 'stock',
  create_activity: 'crm',
  draft_invoice: 'sales_invoices',
  compose_view: 'user_views',
  create_automation: 'agent_assistant',
});

/**
 * Human labels for the switchable keys — the ONLY form shown to the model when it must say a feature
 * is not on the org's plan ("not on your plan" instruction, FR-PLN-008). Labels, never raw keys or ids.
 * `feedback_surveys` is deliberately absent: that switch is Admin-owned and has no assistant surface.
 */
export const FEATURE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  timesheets: 'timesheets',
  crm: 'the CRM (companies, contacts and activity history)',
  sales_pipeline: 'the sales pipeline',
  procurement: 'procurement',
  procurement_full: 'the order/receipt/invoice match and line-level receipt quantities',
  sales_invoices: 'sales invoices and billing',
  revenue: 'incoming payments',
  budget_projection: 'budget projection',
  imprest: 'imprest (petty cash)',
  user_views: 'saved views',
  m365_integration: 'the Microsoft 365 integration',
  clickup_sync: 'ClickUp sync',
  erp_sync: 'ERP sync',
  erp_purchases: 'ERP purchases',
  financial_statements: 'financial statements',
  management_pack: 'the management pack',
  budget_phasing: 'budget phasing',
  multi_currency: 'multi-currency',
  stock: 'stock (warehouse and inventory)',
  api_access: 'API access',
  sso: 'single sign-on',
  incidents: 'incidents (HSE)',
  import_export: 'data import and export',
  agent_assistant: 'automations',
});

/** Stable display order for the prompt's not-on-plan list (registry order, `features.ts`). */
const LABEL_ORDER: readonly string[] = Object.freeze([
  'incidents', 'crm', 'procurement', 'timesheets', 'import_export', 'agent_assistant',
  'sales_invoices', 'user_views', 'revenue', 'm365_integration',
  'sales_pipeline', 'procurement_full', 'imprest', 'clickup_sync', 'budget_projection',
  'erp_sync', 'erp_purchases', 'financial_statements', 'management_pack', 'budget_phasing',
  'multi_currency', 'stock', 'api_access', 'sso',
]);

/** The switch key for an entity, or `undefined` when the entity is core. */
export function keyForEntity(entity: string): string | undefined {
  return ENTITY_FEATURE_KEYS[entity];
}

/** The switch key for a tool, or `undefined` when the tool is core. */
export function keyForTool(tool: string): string | undefined {
  return TOOL_FEATURE_KEYS[tool];
}

/** The switch key that gates the assistant capability itself (FR-PLN-006 / D6). */
export const ASSISTANT_FEATURE_KEY = 'agent_assistant';

/**
 * Is this key on for the caller?
 *
 * Core (no key) is always on. An unresolved snapshot (`null`/`undefined`) means nothing is KNOWN to be
 * off — the resolver is an offering filter, never the enforcement authority (S2's `assert_feature_on`
 * and RLS are), so an unreachable resolver must not blank the assistant. Only an explicit `false` is off.
 *
 * READ semantics only. A write must use `writeRefusal`, which never fails open.
 */
export function isKeyEnabled(key: string | undefined, switches: FeatureSwitches | null | undefined): boolean {
  if (key === undefined || !switches) return true;
  return switches[key] !== false;
}

/** May the assistant run at all for this request? Explicit `false` only — see `isKeyEnabled`. */
export function isAssistantEnabled(switches: FeatureSwitches | null | undefined): boolean {
  return isKeyEnabled(ASSISTANT_FEATURE_KEY, switches);
}

/** The refusal a write path returns: the key is off, or entitlement could not be established. */
export interface WriteFeatureRefusal {
  error: string;
  code: 'FEATURE_OFF' | 'PLAN_UNVERIFIED';
}

/** Shown to the model — and through it, the user — when the plan could not be confirmed at write time. */
export const PLAN_UNVERIFIED_ERROR =
  "I couldn't confirm your organisation's plan just now, so I did not make that change. Ask me again in a moment.";

/**
 * The check EVERY assistant write path makes at execution (FR-PLN-006, D6).
 *
 * Reads may fail open; a write may not. Two ways to be refused, both deliberate:
 *   - the key resolves explicitly off → `FEATURE_OFF` (the module is not on this plan);
 *   - there is no resolved snapshot (the resolver failed, timed out or was never read) →
 *     `PLAN_UNVERIFIED`. A chip approved after a failed read must not create a row or leave the
 *     database on a guess.
 *
 * `undefined` is "no snapshot in this context" and refuses too: a caller that skips the resolution
 * cannot silently skip the gate.
 */
export function writeRefusal(key: string, switches: FeatureSwitches | null | undefined): WriteFeatureRefusal | null {
  if (!switches) return { error: PLAN_UNVERIFIED_ERROR, code: 'PLAN_UNVERIFIED' };
  if (switches[key] === false) {
    const { error, code } = notOnPlanError(key);
    return { error, code };
  }
  return null;
}

/**
 * Tools whose write must ALSO refuse when the switch cannot be verified (not merely when it is off).
 *
 * Reads degrade to "nothing known is off"; a write that leaves the database or mints a live row must
 * not. The list is deliberately explicit, not "every confirm action": each entry is a path whose
 * approval can execute after the resolver read failed, so `PLAN_UNVERIFIED` is the honest answer.
 */
export const FAIL_CLOSED_WRITE_TOOLS: ReadonlySet<string> = Object.freeze(
  new Set(['create_automation', 'draft_invoice']),
);

/**
 * The refusal a pending/executing WRITE gets: an off key always refuses, and a fail-closed tool also
 * refuses an unresolved snapshot. Core (keyless) tools are never refused here.
 */
export function writeRefusalFor(tool: string, switches: FeatureSwitches | null | undefined): WriteFeatureRefusal | null {
  const key = keyForTool(tool);
  if (key === undefined) return null;
  if (isKeyEnabled(key, switches)) {
    return FAIL_CLOSED_WRITE_TOOLS.has(tool) && !switches
      ? { error: PLAN_UNVERIFIED_ERROR, code: 'PLAN_UNVERIFIED' }
      : null;
  }
  const { error, code } = notOnPlanError(key);
  return { error, code };
}

/** Is this entity offered to the model for this request? */
export function isEntityAllowed(entity: string, switches: FeatureSwitches | null | undefined): boolean {
  return isKeyEnabled(keyForEntity(entity), switches);
}

/** Is this tool offered to the model for this request? */
export function isToolAllowed(tool: string, switches: FeatureSwitches | null | undefined): boolean {
  return isKeyEnabled(keyForTool(tool), switches);
}

/** The entities to offer (and to render in the prompt's schema section) for this request. */
export function offerableEntities<T extends string = string>(
  switches: FeatureSwitches | null | undefined,
  entities: readonly T[] = AGENT_READ_ENTITIES as unknown as readonly T[],
): T[] {
  return entities.filter((entity) => isEntityAllowed(entity, switches));
}

/** The tools to offer the model for this request — off-key tools are dropped, never renamed. */
export function offerableTools<T extends NamedTool>(
  tools: readonly T[],
  switches: FeatureSwitches | null | undefined,
): T[] {
  return tools.filter((tool) => isToolAllowed(tool.function.name, switches));
}

/** Human labels of the features that are off, in registry order — the prompt's not-on-plan list. */
export function unavailableFeatureLabels(switches: FeatureSwitches | null | undefined): string[] {
  if (!switches) return [];
  return LABEL_ORDER
    .filter((key) => switches[key] === false && FEATURE_LABELS[key] !== undefined)
    .map((key) => FEATURE_LABELS[key]);
}

/**
 * The tool result the handler returns when the model calls an off-key tool anyway (execution-time
 * refusal, defence in depth behind the offering filter). Never includes data — just the reason.
 */
export function notOnPlanError(key: string): { error: string; code: 'FEATURE_OFF' } {
  const label = FEATURE_LABELS[key] ?? 'that feature';
  return {
    error: `${label} is not on your organisation's plan. Tell the user the feature is not on their plan; do not try to answer from other entities.`,
    code: 'FEATURE_OFF',
  };
}
