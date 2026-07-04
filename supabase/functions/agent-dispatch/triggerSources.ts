/**
 * triggerSources.ts — the SOLE allowlist of tables `trigger_on.source` may name (ADR-0044 §1/§2,
 * security fix HIGH-1). `trigger_on.source` is user-authored input (via `create_automation`'s
 * validated input) that ultimately reaches `serviceClient.from(source)` in the dispatcher's
 * selection query (selectTriggerMatches) — an un-allowlisted source would let a crafted automation
 * point the service_role client at an ARBITRARY table (e.g. `profiles`, `agent_automations` itself),
 * a metadata-enumeration-authority escape (NFR-AAN-SEC-002).
 *
 * BOTH layers enforce against this SAME constant (defense-in-depth, never drift):
 *   1. `agent-chat/actions.ts` validateCreateAutomation — rejects the CREATE at the source (a bad
 *      source never reaches the DB row at all).
 *   2. `agent-dispatch/dispatcher.ts` selectTriggerMatches / `watermark.ts` — the ENFORCEMENT
 *      authority: even a pre-existing row with a non-allowlisted source (e.g. inserted before this
 *      allowlist existed, or written directly) is skipped before any `.from(source)` call, never
 *      queried.
 */
export const TRIGGER_SOURCES = ['procurement_status_events'] as const;
export type TriggerSource = (typeof TRIGGER_SOURCES)[number];

export function isAllowedTriggerSource(source: string): source is TriggerSource {
  return (TRIGGER_SOURCES as readonly string[]).includes(source);
}
