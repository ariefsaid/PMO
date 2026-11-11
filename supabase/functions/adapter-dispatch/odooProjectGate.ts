/**
 * FR-OPP-020/021 (AC-OPP-014): an Odoo purchase whose case has a project pushes only when that project's cost account resolves.
 * The cost account rides on every line, so an unlinked project, or a link whose Odoo account is archived, gone or unreadable,
 * refuses here BEFORE any outbox row or Odoo call; there is no default account and no guess. The case owns its project: a command
 * naming another one is a second project, which O2 does not split (a later slice owns splits). A case with no project has no
 * cost account to resolve and is allowed, as for ERPNext. Fails closed on any unreadable input.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveOdooCostAccount } from '../_shared/odooPurchaseRefs.ts';

export interface OdooProjectGateResult { ok: boolean; status: number; message: string }
interface GateCommand { domain: string; operation: string; record: { procurementId?: unknown; projectId?: unknown; erp_doc_kind?: unknown } }

const OK: OdooProjectGateResult = { ok: true, status: 200, message: '' };
const refuse = (message: string): OdooProjectGateResult => ({ ok: false, status: 422, message });
/**
 * The tiers whose purchases are gated here, as data (AC-ECA-043: no branch on a tier name above the adapter). ERPNext keeps its own
 * project resolution in its dispatch factory (`project-unmapped`); a tier is listed once its adapter needs the cost account resolved first.
 */
const COST_ACCOUNT_TIERS: Readonly<Record<string, boolean>> = { odoo: true };
/** The documents that carry the cost account on their lines. */
const COST_BEARING = new Set(['purchase-order', 'purchase-invoice']);

export async function checkOdooProjectGate(sc: SupabaseClient, orgId: string, tier: string | undefined, command: GateCommand): Promise<OdooProjectGateResult> {
  if (!COST_ACCOUNT_TIERS[tier ?? ''] || command.domain !== 'procurement' || String(command.operation) !== 'create') return OK;
  if (!COST_BEARING.has(String(command.record.erp_doc_kind))) return OK;
  const procurementId = command.record.procurementId;
  if (typeof procurementId !== 'string' || procurementId === '') return refuse('gate-check-failed');
  const { data, error } = await sc.from('procurements').select('project_id').eq('org_id', orgId).eq('id', procurementId).maybeSingle();
  if (error) { console.error('[adapter-dispatch] odoo project gate read failed:', error); return refuse('gate-check-failed'); }
  if (!data) return refuse('purchase_not_found');
  const projectId = (data as { project_id: string | null }).project_id;
  const claimed = typeof command.record.projectId === 'string' && command.record.projectId !== '' ? command.record.projectId : null;
  if (claimed !== null && claimed !== projectId) return refuse('multiple-projects');
  if (projectId === null) return OK;
  const account = await resolveOdooCostAccount(sc, orgId, projectId);
  if (account.status === 'resolved') return OK;
  return refuse(account.status === 'unlinked' ? 'project-unlinked' : account.reason === 'unreadable' ? 'gate-check-failed' : 'project-needs-attention');
}
