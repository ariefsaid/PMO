/**
 * process_gates read helper (Slice 2 task 2.9 — minimal so dispatch compiles).
 * The org-config seam lives in `external_org_bindings.config.process_gates` (jsonb).
 * This module only READS and normalizes defaults — NO enforcement (Slice 3 wires that).
 * Keys (OD-SAR-GATES, FR-SAR-190/191/192):
 *   - require_so_before_si: boolean (inert in P3a — recognized but NOT enforced)
 *   - require_bast_before_si: boolean (inert in P3a — recognized but NOT enforced)
 *   - require_project_on_si: boolean (default true — enforced at dispatch boundary in Slice 3)
 */
export interface ProcessGates {
  require_so_before_si: boolean;
  require_bast_before_si: boolean;
  require_project_on_si: boolean;
}

/** Default gates when the binding has no explicit `process_gates` key. */
export const DEFAULT_GATES: ProcessGates = {
  require_so_before_si: false,
  require_bast_before_si: false,
  require_project_on_si: true,
};

/** Read and normalize `process_gates` from an org's binding config. Returns defaults when absent. */
export function readProcessGates(config: Record<string, unknown> | undefined): ProcessGates {
  const gates = config?.process_gates;
  if (!gates || typeof gates !== 'object') return DEFAULT_GATES;
  const g = gates as Record<string, unknown>;
  return {
    require_so_before_si: g.require_so_before_si === true,
    require_bast_before_si: g.require_bast_before_si === true,
    require_project_on_si: g.require_project_on_si !== false, // default true
  };
}

/** Slice 3 enforcement helper (stubbed here so dispatch compiles). Returns null (no block) or the gate violation code. */
export function enforceGates(_gates: ProcessGates, _command: { erp_doc_kind?: string; projectId?: string | null }): string | null {
  // Enforcement is wired in Slice 3 (adapter-dispatch + pgTAP). This is a no-op stub for compile.
  return null;
}