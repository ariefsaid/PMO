/**
 * FR-PFE-010 (#1319): an org's purchase rules (organizations.procurement_gates) for every PMO-authored procurement
 * document that the ERP path would create. Same question the database asks on the transition RPC, record inserts and
 * links (procurement_gate_violation), asked here BEFORE any adapter/outbox/ERP work, because on an ERP-owned org the
 * PMO record is only written after the ERP document exists. Fails closed on any unreadable input.
 */
export type ProcurementGateClient = {
  from(table: string): { select(cols: string): { eq(c: string, v: string): { eq(c: string, v: string): { maybeSingle(): Promise<{ data: unknown; error: { message: string } | null }> } } } };
  rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { code?: string; message: string } | null }>;
};
export interface ProcurementGateResult { ok: boolean; status: number; message: string }
interface GateCommand { domain: string; operation: string; record: { id: string; procurementId?: unknown; erp_doc_kind?: unknown } }

const OK: ProcurementGateResult = { ok: true, status: 200, message: '' };
const FAILED: ProcurementGateResult = { ok: false, status: 422, message: 'gate-check-failed' };
const STEP_BY_KIND: Record<string, 'Ordered' | 'Received' | 'Vendor Invoiced' | 'Paid'> = {
  'purchase-order': 'Ordered', 'goods-receipt': 'Received', 'purchase-invoice': 'Vendor Invoiced', payment: 'Paid',
};

export async function checkProcurementGate(client: ProcurementGateClient, orgId: string, command: GateCommand): Promise<ProcurementGateResult> {
  if (command.domain !== 'procurement' || String(command.operation) !== 'create') return OK;
  const step = STEP_BY_KIND[String(command.record.erp_doc_kind)];
  if (!step) return OK;
  const procurementId = command.record.procurementId;
  if (typeof procurementId !== 'string' || procurementId === '') return FAILED;
  const { data: row, error: rowError } = await client.from('procurements').select('org_id').eq('id', procurementId).eq('org_id', orgId).maybeSingle();
  if (rowError) { console.error('[adapter-dispatch] procurement gate read failed:', rowError); return FAILED; }
  if (!row) return { ok: false, status: 422, message: 'purchase-not-found' };
  const { data, error } = await client.rpc('procurement_gate_violation', { p_procurement_id: procurementId, p_step: step });
  if (error) { console.error('[adapter-dispatch] procurement_gate_violation failed:', error); return FAILED; }
  return data === null || data === undefined ? OK : { ok: false, status: 422, message: String(data) };
}
