/**
 * process_gates read helper (Slice 2 task 2.9).
 * The org-config seam lives in `external_org_bindings.config.process_gates` (jsonb).
 * This module only READS and normalizes defaults — the live `require_project_on_si` enforcement is
 * the dispatch boundary's (`adapter-dispatch/projectGateGuard.ts`, AC-SAR-070).
 * Keys (OD-SAR-GATES, FR-SAR-190/191/192):
 *   - require_so_before_si: boolean (inert in P3a — recognized but NOT enforced)
 *   - require_bast_before_si: boolean (inert in P3a — recognized but NOT enforced)
 *   - require_project_on_si: boolean (default true — enforced at dispatch boundary)
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