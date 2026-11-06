/**
 * actionCatalog — the feature-gated action registry and tool catalog (THEME-CROSS-93):
 * BASE_ACTIONS/BASE_ACTION_BY_NAME, the Deno-env kill-switch flags, ASK_USER_TOOL,
 * buildTools/narrowQueryEntityTool (FR-MC-017, S4 switch narrowing) and the plan-aware
 * system prompt builder that composes the offer from the SAME catalog the loop registers.
 */
import {
  queryEntityAction,
  createActivityAction,
  updateTaskStatusAction,
  composeViewAction,
  notifyAction,
  createAutomationAction,
  askUserAction,
  AGENT_READ_ENTITIES,
} from './actions.ts';
import { makeWhatsOverdueAction } from './overdue.ts';
import { draftInvoiceAction } from './draftInvoice.ts';
import { remindOverdueAction } from './remindOverdue.ts';
import { queryStockAction } from './stockRead.ts';
import { buildAgentSystemPrompt } from './prompt.ts';
import {
  isToolAllowed,
  offerableEntities,
  offerableTools,
  unavailableFeatureLabels,
  type FeatureSwitches,
} from './featureSwitches.ts';
import type { AgentAction, DeputyContext } from '../../../pmo-portal/src/lib/agent/runtime/port.ts';
import type { ModelTool } from '../_shared/modelClient.ts';

// ── Action registry (A3) ──────────────────────────────────────────────────────

/** Minimal ambient shape for Deno.env — avoids depending on the Deno global lib.d.ts, which
 * this file (imported by Node/Vitest, REC-1) does not have available at typecheck time. */
interface DenoEnvLike {
  env: { get(key: string): string | undefined };
}

/**
 * Base read+write actions (always registered). notify/create_automation (ADR-0044, FR-AAN-038)
 * are gated behind the AGENT_AUTOMATIONS Deno env flag — the server-side mirror of the SPA's
 * `agentAssistant` Vite flag (Deno cannot read a browser env var), the SAME pattern as
 * AGENT_PERSISTENCE in index.ts. With the flag off, the catalog omits both entries: no chat action
 * can create an automation and no notify producer runs. In a Deno-less context (Vitest/Node,
 * REC-1's test-import boundary), `Deno` is undefined and the flag defaults ON — matching
 * production's default-ON posture (mirrors AGENT_PERSISTENCE's `!== 'false'` default).
 */
const denoGlobal = (globalThis as { Deno?: DenoEnvLike }).Deno;
export const AUTOMATIONS_ENABLED = denoGlobal === undefined || denoGlobal.env.get('AGENT_AUTOMATIONS') !== 'false';
/** #787 kill switch: AGENT_INVOICE_DRAFTS=false removes draft_invoice without a redeploy (default ON; ON in
 *  a Deno-less test context, mirroring AUTOMATIONS_ENABLED). */
export const INVOICE_DRAFTS_ENABLED = denoGlobal === undefined || denoGlobal.env.get('AGENT_INVOICE_DRAFTS') !== 'false';
/** #1639 kill switch: AGENT_REMINDERS=false removes remind_overdue (and the overdue offer line) without a redeploy
 *  (default ON; ON in a Deno-less test context, mirroring INVOICE_DRAFTS_ENABLED). */
export const REMINDERS_ENABLED = denoGlobal === undefined || denoGlobal.env.get('AGENT_REMINDERS') !== 'false';
/**
 * The always-registered action catalogue, exported so the S4 completeness suite binds to the SHIPPED
 * registry instead of copying a tool list: a new gated tool added here fails that suite until it has a
 * switch-key row.
 */
export const BASE_ACTIONS: AgentAction[] = [
  queryEntityAction,
  queryStockAction,
  makeWhatsOverdueAction({ offerReminders: REMINDERS_ENABLED }),
  createActivityAction,
  updateTaskStatusAction,
  ...(INVOICE_DRAFTS_ENABLED ? [draftInvoiceAction] : []),
  ...(REMINDERS_ENABLED ? [remindOverdueAction] : []),
  ...(AUTOMATIONS_ENABLED ? [notifyAction, createAutomationAction] : []),
];
export const BASE_ACTION_BY_NAME = new Map<string, AgentAction>(BASE_ACTIONS.map((a) => [a.name, a]));

/** ask_user (ADR-0045 §2) — always registered, dispatched specially by runToolLoop. */
const ASK_USER_TOOL: ModelTool = {
  type: 'function',
  function: { name: askUserAction.name, description: askUserAction.description, parameters: askUserAction.inputSchema },
};

// ACTIONS and ACTION_BY_NAME are built per-call based on composeEnabled (Task 7/FR-CV-024).
// They are kept as module-level variables for the continuation/handleDecision helpers which
// don't receive composeEnabled directly; the handler passes the right map to helpers.

// ── Tool catalog builder (FR-MC-017) ──────────────────────────────────────────

/**
 * The tool catalog for ONE request (S4, FR-PLN-008). Two filters, both from the caller org's resolved
 * switches:
 *   1. a tool whose switch key is off is DROPPED (never renamed, never a dangling affordance —
 *      FR-AXP-010);
 *   2. `query_entity`'s `entity` enum is narrowed to the entities whose key is on, so the model is never
 *      told an off entity exists.
 * A `null` snapshot (resolver unavailable) offers everything — see featureResolution.ts.
 *
 * Exported so the prompt's tool index is built from the SAME catalog the loop offers (the prompt must
 * never advertise a tool that was not registered for this request).
 */
export function buildTools(composeEnabled: boolean | undefined, switches: FeatureSwitches | null | undefined): ModelTool[] {
  const tools: ModelTool[] = offerableTools(BASE_ACTIONS.map((a) => ({
    type: 'function' as const,
    function: { name: a.name, description: a.description, parameters: a.inputSchema },
  })), switches);
  tools.push(ASK_USER_TOOL);
  if (composeEnabled && isToolAllowed(composeViewAction.name, switches)) {
    tools.push({
      type: 'function',
      function: { name: composeViewAction.name, description: composeViewAction.description, parameters: composeViewAction.inputSchema },
    });
  }
  return tools.map((tool) => tool.function.name === 'query_entity' ? narrowQueryEntityTool(tool, switches) : tool);
}

/**
 * Copy the shipped `query_entity` tool with its entity enum narrowed to the offered entities. Only the
 * enum is replaced — every other schema key (columns/filter/order_by/group_by/sum/limit/as) is the
 * SHIPPED schema object, so the action-side validation stays the authority.
 */
function narrowQueryEntityTool(tool: ModelTool, switches: FeatureSwitches | null | undefined): ModelTool {
  const schema = tool.function.parameters as { properties?: { entity?: Record<string, unknown> } };
  const entity = schema?.properties?.entity;
  if (!schema?.properties || !entity) return tool;
  return {
    ...tool,
    function: {
      ...tool.function,
      parameters: {
        ...schema,
        properties: {
          ...schema.properties,
          entity: { ...entity, enum: offerableEntities(switches) },
        },
      },
    },
  };
}

export function buildPlanAwarePrompt(
  rowCap: number,
  role: string | null,
  deputyCtx: DeputyContext,
  gates: {
    composeEnabled: boolean | undefined;
    automationsEnabled: boolean;
    invoiceDraftsEnabled: boolean;
    remindersEnabled: boolean;
  },
  allowCompose: boolean,
): string {
  const switches = deputyCtx.featureSwitches ?? null;
  const offered = buildTools(allowCompose ? gates.composeEnabled : false, switches);
  const entities = offerableEntities(switches, AGENT_READ_ENTITIES);
  return buildAgentSystemPrompt(entities, rowCap, role, {
    composeEnabled: gates.composeEnabled,
    automationsEnabled: gates.automationsEnabled,
    invoiceDraftsEnabled: gates.invoiceDraftsEnabled,
    remindersEnabled: gates.remindersEnabled,
    offeredTools: new Set(offered.map((t) => t.function.name)),
    offeredEntities: new Set<string>(entities),
    unavailableFeatures: unavailableFeatureLabels(switches),
  });
}
