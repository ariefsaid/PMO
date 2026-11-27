/**
 * stockTransfers.ts (#2690) — two-step transfers (send, receive with a count, shortfall), handover confirmations and the proof status read.
 * Spec docs/specs/stock-two-step-transfer.spec.md. The database enforces every rule (counts, quality, proof, self-receive, write-off);
 * this file only reads, writes and maps. Quantities stay decimal strings (NFR-STK-007).
 */
import { fetchAllPages } from '@/src/lib/pagedRead';
import { supabase } from '@/src/lib/supabase/client';
import { nullableArg } from './nullableArg';
import { toAppError } from '@/src/lib/appError';
import { readOrgColumnsStrict } from './orgSettingsBatch';

export type TransferMode = 'one_step' | 'two_step';
export type ProofTiming = 'before_posting' | 'may_follow';
export type ProofRule = 'none' | 'paper' | 'confirmation' | 'either';
export type TransferStatus = 'Sent' | 'Received' | 'Closed' | 'Cancelled';
export type ShortResolution = 'delivered' | 'returned' | 'written_off';
export type QualityResult = 'pass' | 'fail';
export type HandoverStage = 'send' | 'receive';
export type HandoverProofType = 'in_app' | 'paper';
export type SignerKind = 'account' | 'guest';

export type HandoverScope = 'transfers' | 'transfers_and_issues';
export interface TransferSettings { mode: TransferMode; proofTiming: ProofTiming; handoverScope: HandoverScope }
export interface StockTransferLine {
  itemName?: string; needsQualityCheck?: boolean; proofRule?: ProofRule;
  id: string; lineNo: number; itemId: string; qtySent: string; qtyCounted: string | null; qtyAccepted: string | null; qtyRejected: string | null;
  rejectReason: string | null; qualityResult: QualityResult | null; shortResolution: ShortResolution | null; shortReason: string | null;
}
export interface StockTransfer {
  fromWarehouseName?: string; toWarehouseName?: string;
  id: string; number: string; fromWarehouseId: string; toWarehouseId: string; transitWarehouseId: string; workOrderId: string | null; toUserId: string | null;
  note: string | null; status: TransferStatus; sentBy: string; sentAt: string; receivedBy: string | null; receivedAt: string | null; cancelReason: string | null;
  lines: StockTransferLine[];
}
export interface HandoverConfirmation {
  id: string; transferId: string; stage: HandoverStage; proofType: HandoverProofType; signerKind: SignerKind; signerName: string;
  recordedBy: string; confirmedAt: string; goodsPhotoPath: string | null; signerPhotoPath: string | null; paperPhotoPath: string | null;
}
export interface SendTransferInput {
  fromWarehouseId: string; toWarehouseId: string; toUserId: string | null; note: string;
  lines: { itemId: string; quantity: string }[];
}
export interface ReceiveLineInput { lineId: string; counted: string; accepted: string; rejectReason: string; qualityResult: QualityResult | null }
/** What the client sends as a confirmation (photos are uploaded first; the paths are linked by the RPC). */
export type ConfirmationPayload = {
  id: string; stage?: HandoverStage; proof_type: HandoverProofType; signer_kind: SignerKind; signer_name?: string;
  goods_photo_path?: string; signer_photo_path?: string; paper_photo_path?: string;
};
export interface ProofStatusRow {
  movementId: string; number: string; mode: 'one_step' | 'two_step'; status: string; movementDate: string;
  fromWarehouseId: string; fromWarehouseName: string; toWarehouseId: string; toWarehouseName: string;
  tagRules: ProofRule[]; requiredProof: string; hasPaper: boolean; hasConfirmation: boolean;
  proofStatus: 'outstanding' | 'complete'; missing: string | null; proofCompletedAt: string | null;
}

export async function getTransferSettings(): Promise<TransferSettings> {
  const { data, error } = await readOrgColumnsStrict(['stock_transfer_mode', 'stock_proof_timing', 'stock_handover_scope'], { limit: true });
  if (error) throw toAppError(error);
  return { mode: data?.stock_transfer_mode === 'two_step' ? 'two_step' : 'one_step', proofTiming: data?.stock_proof_timing === 'may_follow' ? 'may_follow' : 'before_posting',
    handoverScope: data?.stock_handover_scope === 'transfers_and_issues' ? 'transfers_and_issues' : 'transfers' };
}
export async function setTransferMode(mode: TransferMode): Promise<void> {
  const { error } = await supabase.rpc('set_stock_transfer_mode', { p_mode: mode });
  if (error) throw toAppError(error);
}
export async function setProofTiming(timing: ProofTiming): Promise<void> {
  const { error } = await supabase.rpc('set_stock_proof_timing', { p_timing: timing });
  if (error) throw toAppError(error);
}

export async function setHandoverScope(scope: HandoverScope): Promise<void> {
  const { error } = await supabase.rpc('set_stock_handover_scope', { p_scope: scope });
  if (error) throw toAppError(error);
}

/** PostgREST returns a numeric column as a JSON number; quantities stay decimal strings (NFR-STK-007). */
const qty = (v: number | null | undefined): string | null => (v === null || v === undefined ? null : String(v));
type TransferRow = {
  id: string; number: string; from_warehouse_id: string; to_warehouse_id: string; transit_warehouse_id: string; work_order_id: string | null;
  to_user_id: string | null; note: string | null; status: string; sent_by: string; sent_at: string; received_by: string | null;
  received_at: string | null; cancel_reason: string | null; stock_transfer_lines: LineRow[];
};
type LineRow = {
  id: string; line_no: number; item_id: string; qty_sent: number; qty_counted: number | null; qty_accepted: number | null; qty_rejected: number | null;
  reject_reason: string | null; quality_result: string | null; short_resolution: string | null; short_reason: string | null;
};
/** Every enum-ish column here is `text` with a CHECK, which the generated row states as `string`. */
const mapLine = (l: LineRow): StockTransferLine => ({
  id: l.id, lineNo: l.line_no, itemId: l.item_id, qtySent: String(l.qty_sent), qtyCounted: qty(l.qty_counted), qtyAccepted: qty(l.qty_accepted),
  qtyRejected: qty(l.qty_rejected), rejectReason: l.reject_reason ?? null, qualityResult: (l.quality_result ?? null) as QualityResult | null,
  shortResolution: (l.short_resolution ?? null) as ShortResolution | null, shortReason: l.short_reason ?? null,
});
const mapTransfer = (t: TransferRow): StockTransfer => ({
  id: t.id, number: t.number, fromWarehouseId: t.from_warehouse_id, toWarehouseId: t.to_warehouse_id, transitWarehouseId: t.transit_warehouse_id,
  workOrderId: t.work_order_id ?? null, toUserId: t.to_user_id ?? null, note: t.note ?? null, status: t.status as TransferStatus, sentBy: t.sent_by, sentAt: t.sent_at,
  receivedBy: t.received_by ?? null, receivedAt: t.received_at ?? null, cancelReason: t.cancel_reason ?? null,
  lines: (t.stock_transfer_lines ?? []).map(mapLine).sort((a, b) => a.lineNo - b.lineNo),
});

export async function listStockTransfers(status?: TransferStatus): Promise<StockTransfer[]> {
  const rows = await fetchAllPages((from, to) => {
    const query = supabase.from('stock_transfers').select('*, stock_transfer_lines(*)').order('sent_at', { ascending: false }).order('id');
    return (status ? query.eq('status', status) : query).range(from, to);
  });
  return rows.map(mapTransfer);
}
export async function getStockTransfer(id: string): Promise<StockTransfer | null> {
  const { data, error } = await supabase.from('stock_transfers').select('*, stock_transfer_lines(*)').eq('id', id).maybeSingle();
  if (error) throw toAppError(error);
  if (!data) return null;
  const transfer = mapTransfer(data);
  const metadata = await supabase.rpc('stock_transfer_receiving_items', { p_transfer: id });
  if (metadata.error) throw toAppError(metadata.error);
  const items = new Map((metadata.data ?? []).map((i) => [i.item_id, i]));
  return { ...transfer, fromWarehouseName: metadata.data?.[0]?.from_name, toWarehouseName: metadata.data?.[0]?.to_name,
    lines: transfer.lines.map((line) => { const item = items.get(line.itemId); return item ? { ...line,
      itemName: `${item.item_code} - ${item.item_name}`, needsQualityCheck: item.needs_quality_check, proofRule: item.proof_rule as ProofRule } : line; }) };

}
export async function listHandoverConfirmations(transferId: string): Promise<HandoverConfirmation[]> {
  const { data, error } = await supabase.from('stock_handover_confirmations').select('*').eq('transfer_id', transferId).order('confirmed_at').limit(200);
  if (error) throw toAppError(error);
  return (data ?? []).map((c) => ({
    id: c.id, transferId: c.transfer_id, stage: c.stage as HandoverStage, proofType: c.proof_type as HandoverProofType,
    signerKind: c.signer_kind as SignerKind, signerName: c.signer_name,
    recordedBy: c.recorded_by, confirmedAt: c.confirmed_at, goodsPhotoPath: c.goods_photo_path ?? null, signerPhotoPath: c.signer_photo_path ?? null,
    paperPhotoPath: c.paper_photo_path ?? null,
  }));
}

export async function sendStockTransfer(i: SendTransferInput, clientRequestId: string): Promise<string> {
  const { data, error } = await supabase.rpc('send_stock_transfer', {
    p_header: { warehouse_id: i.fromWarehouseId, to_warehouse_id: i.toWarehouseId, to_user_id: i.toUserId ?? '', note: i.note.trim() },
    p_lines: i.lines.map((l) => ({ item_id: l.itemId, quantity: l.quantity })),
    p_client_request_id: clientRequestId,
  });
  if (error) throw toAppError(error);
  return data;
}
export async function receiveStockTransfer(transferId: string, lines: ReceiveLineInput[], confirmation: ConfirmationPayload | null): Promise<void> {
  const { error } = await supabase.rpc('receive_stock_transfer', {
    p_transfer: transferId,
    p_lines: lines.map((l) => ({
      line_id: l.lineId, counted: l.counted, accepted: l.accepted, reject_reason: l.rejectReason.trim(), quality_result: l.qualityResult ?? '',
    })),
    // The parameter is `jsonb default null`: null IS the "no confirmation" request.
    p_confirmation: confirmation,
  });
  if (error) throw toAppError(error);
}
export async function recallStockTransfer(transferId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('recall_stock_transfer', { p_transfer: transferId, p_reason: reason });
  if (error) throw toAppError(error);
}
export async function resolveStockShortfall(lineId: string, resolution: ShortResolution, reason: string): Promise<void> {
  const { error } = await supabase.rpc('resolve_stock_transfer_shortfall', { p_line: lineId, p_resolution: resolution, p_reason: nullableArg(reason.trim() || null) });
  if (error) throw toAppError(error);
}
export async function recordStockHandover(transferId: string, confirmation: ConfirmationPayload & { stage: HandoverStage }): Promise<string> {
  const { data, error } = await supabase.rpc('record_stock_handover', { p_transfer: transferId, p_confirmation: confirmation });
  if (error) throw toAppError(error);
  return data;
}

export async function getMovementProofStatus(f: { status?: 'outstanding' | 'complete'; from?: string; to?: string } = {}): Promise<ProofStatusRow[]> {
  const { data, error } = await supabase.rpc('get_stock_movement_proof_status', {
    p_status: nullableArg(f.status ?? null), p_from: nullableArg(f.from ?? null), p_to: nullableArg(f.to ?? null),
  });
  if (error) throw toAppError(error);
  // `returns table` states no nullability, so the generated row marks every column NOT NULL; the proof dates and the gap
  // are genuinely absent while proof is outstanding, and the mode/status/rule columns are bounded by the database's CHECKs.
  return (data ?? []).map((r) => ({
    movementId: r.movement_id, number: r.movement_number, mode: r.mode as ProofStatusRow['mode'], status: r.transfer_status, movementDate: r.movement_date,
    fromWarehouseId: r.from_warehouse_id, fromWarehouseName: r.from_warehouse_name, toWarehouseId: r.to_warehouse_id, toWarehouseName: r.to_warehouse_name,
    tagRules: (r.tag_rules ?? []) as ProofRule[], requiredProof: r.required_proof, hasPaper: r.has_paper === true, hasConfirmation: r.has_confirmation === true,
    proofStatus: r.proof_status as ProofStatusRow['proofStatus'], missing: r.missing ?? null, proofCompletedAt: r.proof_completed_at ?? null,
  }));
}

/** The photo goes to the private bucket first, under {org}/{transfer}/{confirmation}/{file}; the RPC then links the path. */
export async function uploadHandoverPhoto(orgId: string, transferId: string, confirmationId: string, kind: 'goods' | 'person' | 'paper', file: File): Promise<string> {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120) || 'photo.jpg';
  const path = `${orgId}/${transferId}/${confirmationId}/${kind}-${safeName}`;
  const { error } = await supabase.storage.from('stock-handover').upload(path, file);
  if (error) throw toAppError(error);
  return path;
}
export async function handoverPhotoUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from('stock-handover').createSignedUrl(path, 300);
  if (error) throw toAppError(error);
  return data.signedUrl;
}

export async function setTagProofRule(tagId: string, rule: ProofRule): Promise<void> {
  const { data, error } = await supabase.from('stock_tags').update({ proof_required: rule }).eq('id', tagId).select('id');
  if (error) throw toAppError(error);
  if (!data || data.length === 0) throw toAppError({ message: 'You cannot change this tag.', code: '42501' });
}
export async function setItemQualityCheck(itemId: string, needs: boolean): Promise<void> {
  const { data, error } = await supabase.from('stock_items').update({ needs_quality_check: needs }).eq('id', itemId).select('id');
  if (error) throw toAppError(error);
  if (!data || data.length === 0) throw toAppError({ message: 'You cannot change this item.', code: '42501' });
}
