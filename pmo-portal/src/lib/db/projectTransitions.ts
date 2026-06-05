import { supabase } from '@/src/lib/supabase/client';
import type { ProjectRow } from './projects';

// ---------------------------------------------------------------------------
// Type contract (plan §1.6)
// ---------------------------------------------------------------------------

export type ProjectStatus = ProjectRow['status'];
export type ProjectStatusGroup = 'pipeline' | 'onHand' | 'lost' | 'internal';

export interface PipelineStageConfig {
  status: ProjectStatus;
  win_probability: number;
}

export interface TransitionProjectOpts {
  /** The CLIENT's inbound contract/PO number — manually entered, NOT auto-generated (OD-SP-3). */
  customerContractRef?: string;
  /** ISO 'YYYY-MM-DD' */
  contractDate?: string;
}

// ---------------------------------------------------------------------------
// Transition map — single TS source, mirrors the SQL literal inside
// transition_project() (AC-1000, FR-PR-001/003/012)
// Note: status literals are EXACT enum spellings, including 'Won, Pending KoM' with comma.
// ---------------------------------------------------------------------------

export const LEGAL_PROJECT_TRANSITIONS: Record<string, string[]> = {
  'Leads':               ['PQ Submitted', 'Loss Tender', 'Internal Project'],
  'PQ Submitted':        ['Quotation Submitted', 'Leads', 'Loss Tender'],
  'Quotation Submitted': ['Tender Submitted', 'PQ Submitted', 'Won, Pending KoM', 'Loss Tender'],
  'Tender Submitted':    ['Negotiation', 'Quotation Submitted', 'Won, Pending KoM', 'Loss Tender'],
  'Negotiation':         ['Won, Pending KoM', 'Tender Submitted', 'Loss Tender'],
  'Won, Pending KoM':    ['Ongoing Project', 'On Hold', 'Close Out'],
  'Ongoing Project':     ['On Hold', 'Close Out'],
  'On Hold':             ['Ongoing Project', 'Close Out'],
  'Close Out':           ['Ongoing Project'],
  'Loss Tender':         ['Negotiation'],
  'Internal Project':    [],
};

// ---------------------------------------------------------------------------
// Status group membership — OD-SP-1 (AC-1001, FR-PR-012)
// Exported as named arrays for #5's lens membership reuse.
// ---------------------------------------------------------------------------

export const PIPELINE_STATUSES: readonly string[] = [
  'Leads',
  'PQ Submitted',
  'Quotation Submitted',
  'Tender Submitted',
  'Negotiation',
];

export const ON_HAND_STATUSES: readonly string[] = [
  'Won, Pending KoM',
  'Ongoing Project',
  'On Hold',
  'Close Out',
];

export const LOST_STATUSES: readonly string[] = ['Loss Tender'];

export const INTERNAL_STATUSES: readonly string[] = ['Internal Project'];

/**
 * Returns true when (from → to) is in the legal transition map (AC-1000, FR-PR-001/003).
 * Pure function; mirrors the map literal in transition_project().
 * Returns false when from === to (no-op), from is not in the map, or to is not in the allowed list.
 */
export function isLegalProjectTransition(from: ProjectStatus, to: ProjectStatus): boolean {
  if (from === to) return false;
  const allowed = LEGAL_PROJECT_TRANSITIONS[from as string];
  if (!allowed) return false;
  return allowed.includes(to as string);
}

/**
 * Returns the OD-SP-1 group for a given project status (AC-1001, FR-PR-012).
 * This is the foundation #5 reuses for its lens membership.
 */
export function projectStatusGroup(status: ProjectStatus): ProjectStatusGroup {
  if (PIPELINE_STATUSES.includes(status as string)) return 'pipeline';
  if (ON_HAND_STATUSES.includes(status as string)) return 'onHand';
  if (LOST_STATUSES.includes(status as string)) return 'lost';
  return 'internal';
}

// ---------------------------------------------------------------------------
// DAL writes — thin RPC wrapper (AC-1002, FR-PR-002/011)
// org_id is NEVER sent; the security-definer RPC re-asserts org from auth context.
// Uses @ts-expect-error + as unknown as cast (mirrors timesheetTransition.ts / procurementLifecycle.ts)
// because transition_project is in the generated Functions type but the rpc() overload resolution
// may not fully infer the return shape — the cast is intentional and contained.
// ---------------------------------------------------------------------------

/**
 * Transitions a project to the given status. Throws and surfaces any RPC error.
 * org_id is NEVER sent (FR-PR-010/011).
 * opts.customerContractRef / opts.contractDate are required when targeting 'Won, Pending KoM'
 * from a pipeline stage (the RPC enforces this with P0001).
 */
export async function transitionProject(
  id: string,
  to: ProjectStatus,
  opts?: TransitionProjectOpts,
): Promise<void> {
  const { error } = (await supabase.rpc('transition_project', {
    p_id: id,
    p_to: to,
    p_customer_contract_ref: opts?.customerContractRef ?? null,
    p_contract_date: opts?.contractDate ?? null,
  })) as unknown as { data: null; error: { message: string } | null };
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// DAL reads — listPipelineStageConfig (AC-1003, FR-PR-013)
// org_id is NEVER sent — RLS (pipeline_stage_config_select: org_id = auth_org_id()) scopes rows.
// ---------------------------------------------------------------------------

/**
 * Returns the org's (status, win_probability) rows from pipeline_stage_config.
 * win_probability is normalised to Number (Postgres returns numeric as string).
 * org_id is NEVER sent — RLS scopes rows (FR-PR-013).
 */
export async function listPipelineStageConfig(): Promise<PipelineStageConfig[]> {
  const { data, error } = await supabase
    .from('pipeline_stage_config')
    .select('status, win_probability');
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<{ status: string; win_probability: string | number }>).map(r => ({
    status: r.status as ProjectStatus,
    win_probability: Number(r.win_probability),
  }));
}
