/**
 * The `require_project_on_si` process gate (FR-SAR-191/192), for EVERY Sales-Invoice command that puts
 * revenue on the ERP ledger — round-7 cross-family audit B8.
 *
 * The signed spec: "When ON, an SI create/**submit** must carry a non-null `project_id` and the
 * dispatch rejects a null-project SI at the boundary (`commit-rejected` / `project-required`)"
 * (docs/specs/erpnext-adapter-p3a-sales-ar.spec.md, FR-SAR-191). The shipped gate covered only the
 * BODY-BUILDING operations (create / update / amend, `buildsSalesInvoiceBody`) and deliberately
 * excluded submit — so an SI created while the gate was OFF, or an inbound unassigned SI adopted by
 * the sweep, could still be SUBMITTED once the gate was turned on: the revenue posts to the ERP GL
 * with no project dimension while PMO reports project-attributed revenue (FR-SAR-101). The expected
 * `422 project-required` never came back.
 *
 * The two halves ask the same question of different authorities, because a submit builds no body:
 *   • create / update / amend — the COMMAND carries the project (`record.projectId`); the body is
 *     built from it. (`dispatchFactory.assertSiProjectGate` owns the second half of this same rule:
 *     a projectId that is present but resolves to no ERP project mapping.)
 *   • submit                  — the PMO MIRROR ROW is the authority (`sales_invoices.project_id`),
 *     which is precisely what an inbound-adopted or gate-off-created invoice leaves NULL.
 *
 * Fail CLOSED everywhere: a gate-read failure, an unreadable invoice, or a missing invoice row is a
 * refusal, never "the rule did not apply". Runs BEFORE any adapter/outbox/ERP work.
 */
import { ERPNEXT_REVENUE_DOMAIN } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/adapter.ts';
import { buildsSalesInvoiceBody } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/dispatchFactory.ts';
import type { ExternalRefsLookupClient } from '../../../pmo-portal/src/lib/adapterSeam/refs.ts';

/** `get_process_gates` (mig 0108 §A — merged over the per-key defaults) + the `sales_invoices` read. */
export type ProjectGateClient = ExternalRefsLookupClient & {
  rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { code?: string; message: string } | null }>;
};

export interface ProjectGateResult {
  ok: boolean;
  status: number;
  /** The wire message the dispatch returns verbatim: `project-required` / `gate-check-failed`. */
  message: string;
}

const OK: ProjectGateResult = { ok: true, status: 200, message: '' };
const PROJECT_REQUIRED: ProjectGateResult = { ok: false, status: 422, message: 'project-required' };
const GATE_CHECK_FAILED: ProjectGateResult = { ok: false, status: 422, message: 'gate-check-failed' };

interface GateCommand {
  domain: string;
  operation: string;
  record: { id: string; erp_doc_kind?: unknown; verb?: unknown; projectId?: string | null; [key: string]: unknown };
}

/** Does this command SUBMIT an existing Sales Invoice (post its revenue to the ERP ledger)? */
function isSalesInvoiceSubmit(command: GateCommand): boolean {
  return String(command.operation) === 'transition' && command.record.verb === 'submit';
}

/**
 * Enforce `require_project_on_si` for a Sales-Invoice command. Returns `{ok:true}` for every command
 * the gate does not cover (other domains/kinds, cancel, and — with the gate OFF — everything).
 */
export async function checkSiProjectGate(
  client: ProjectGateClient,
  orgId: string,
  command: GateCommand,
): Promise<ProjectGateResult> {
  if (command.domain !== ERPNEXT_REVENUE_DOMAIN) return OK;
  if (command.record.erp_doc_kind !== 'sales-invoice') return OK;

  const buildsBody = buildsSalesInvoiceBody({ operation: String(command.operation), record: command.record });
  const submits = isSalesInvoiceSubmit(command);
  if (!buildsBody && !submits) return OK;

  const { data: gatesData, error: gatesError } = await client.rpc('get_process_gates', { p_org: orgId });
  if (gatesError || !gatesData) {
    console.error('[adapter-dispatch] get_process_gates RPC failed:', gatesError);
    return GATE_CHECK_FAILED;
  }
  const gates = gatesData as { require_so_before_si?: boolean; require_bast_before_si?: boolean; require_project_on_si?: boolean };

  // SO/BAST gates are recognized but inert in P3a (FR-SAR-191) — log if enabled, for visibility.
  if (gates.require_so_before_si) {
    console.warn('[adapter-dispatch] require_so_before_si is true but not enforced in P3a (inert)');
  }
  if (gates.require_bast_before_si) {
    console.warn('[adapter-dispatch] require_bast_before_si is true but not enforced in P3a (inert)');
  }

  if (!gates.require_project_on_si) return OK;

  if (buildsBody) {
    // The command is the authority: the ERP body carries whatever project it names (or none).
    return (command.record.projectId ?? null) === null ? PROJECT_REQUIRED : OK;
  }

  // Submit: the PMO mirror row is the authority — org-scoped, so a foreign id can never satisfy it.
  const { data, error } = await client
    .from('sales_invoices')
    .select('project_id')
    .eq('id', String(command.record.id))
    .eq('org_id', orgId)
    .maybeSingle();
  if (error) {
    console.error('[adapter-dispatch] sales_invoices project read failed:', error);
    return GATE_CHECK_FAILED;
  }
  const row = data as { project_id: string | null } | null;
  if (!row) return PROJECT_REQUIRED;   // no readable PMO row ⇒ no provable project attribution
  return row.project_id === null ? PROJECT_REQUIRED : OK;
}
