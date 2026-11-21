/**
 * stockTransfers.ts (#2690) — two-step transfers (send, receive with a count, shortfall), handover confirmations and the proof status read.
 * Spec docs/specs/stock-two-step-transfer.spec.md. The database enforces every rule (counts, quality, proof, self-receive, write-off);
 * this file only reads, writes and maps. Quantities stay decimal strings (NFR-STK-007).
 * The generated database types predate migrations 1305-1309, so these calls go through one narrow loose client until they are regenerated.
 */
import { supabase } from '@/src/lib/supabase/client';
import { toAppError } from '@/src/lib/appError';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = Record<string, any>;
interface Reply { data: any; error: { message: string; code?: string; details?: string } | null }
interface Loose {
  from: (table: string) => any;
  rpc: (name: string, args?: Json) => PromiseLike<Reply>;
  storage: typeof supabase.storage;
}
const db = supabase as unknown as Loose;
/* eslint-enable @typescript-eslint/no-explicit-any */

export type TransferMode = 'one_step' | 'two_step';
export type ProofTiming = 'before_posting' | 'may_follow';
export type ProofRule = 'none' | 'paper' | 'confirmation' | 'either';
export type TransferStatus = 'Sent' | 'Received' | 'Closed' | 'Cancelled';
export type ShortResolution = 'delivered' | 'returned' | 'written_off';
export type QualityResult = 'pass' | 'fail';
export type HandoverStage = 'send' | 'receive';
export type HandoverProofType = 'in_app' | 'paper';
export type SignerKind = 'account' | 'guest';

export interface TransferSettings { mode: TransferMode; proofTiming: ProofTiming }
export interface StockTransferLine {
  id: string; lineNo: number; itemId: string; qtySent: string; qtyCounted: string | null; qtyAccepted: string | null; qtyRejected: string | null;
  rejectReason: string | null; qualityResult: QualityResult | null; shortResolution: ShortResolution | null; shortReason: string | null;
}
export interface StockTransfer {
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
export interface ConfirmationPayload {
  id: string; stage?: HandoverStage; proof_type: HandoverProofType; signer_kind: SignerKind; signer_name?: string;
  goods_photo_path?: string; signer_photo_path?: string; paper_photo_path?: string;
}
export interface ProofStatusRow {
  movementId: string; number: string; mode: 'one_step' | 'two_step'; status: string; movementDate: string;
  fromWarehouseId: string; fromWarehouseName: string; toWarehouseId: string; toWarehouseName: string;
  tagRules: ProofRule[]; requiredProof: string; hasPaper: boolean; hasConfirmation: boolean;
  proofStatus: 'outstanding' | 'complete'; missing: string | null; proofCompletedAt: string | null;
}

const rpc = async (name: string, args: Json): Promise<any> => { // eslint-disable-line @typescript-eslint/no-explicit-any
  const { data, error } = await db.rpc(name, args);
  if (error) throw toAppError(error);
  return data;
};

export async function getTransferSettings(): Promise<TransferSettings> {
  const { data, error } = await db.from('organizations').select('stock_transfer_mode, stock_proof_timing').limit(1).maybeSingle();
  if (error) throw toAppError(error);
  return { mode: data?.stock_transfer_mode === 'two_step' ? 'two_step' : 'one_step', proofTiming: data?.stock_proof_timing === 'may_follow' ? 'may_follow' : 'before_posting' };
}
export const setTransferMode = (mode: TransferMode): Promise<void> => rpc('set_stock_transfer_mode', { p_mode: mode });
export const setProofTiming = (timing: ProofTiming): Promise<void> => rpc('set_stock_proof_timing', { p_timing: timing });

/** PostgREST returns a numeric column as a JSON number; quantities stay decimal strings (NFR-STK-007). */
const qty = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const mapLine = (l: Json): StockTransferLine => ({
  id: l.id, lineNo: l.line_no, itemId: l.item_id, qtySent: String(l.qty_sent), qtyCounted: qty(l.qty_counted), qtyAccepted: qty(l.qty_accepted),
  qtyRejected: qty(l.qty_rejected), rejectReason: l.reject_reason ?? null, qualityResult: l.quality_result ?? null,
  shortResolution: l.short_resolution ?? null, shortReason: l.short_reason ?? null,
});
const mapTransfer = (t: Json): StockTransfer => ({
  id: t.id, number: t.number, fromWarehouseId: t.from_warehouse_id, toWarehouseId: t.to_warehouse_id, transitWarehouseId: t.transit_warehouse_id,
  workOrderId: t.work_order_id ?? null, toUserId: t.to_user_id ?? null, note: t.note ?? null, status: t.status, sentBy: t.sent_by, sentAt: t.sent_at,
  receivedBy: t.received_by ?? null, receivedAt: t.received_at ?? null, cancelReason: t.cancel_reason ?? null,
  lines: ((t.stock_transfer_lines ?? []) as Json[]).map(mapLine).sort((a, b) => a.lineNo - b.lineNo),
});

export async function listStockTransfers(status?: TransferStatus): Promise<StockTransfer[]> {
  let q = db.from('stock_transfers').select('*, stock_transfer_lines(*)').order('sent_at', { ascending: false }).order('id').limit(200);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) throw toAppError(error);
  return ((data ?? []) as Json[]).map(mapTransfer);
}
export async function getStockTransfer(id: string): Promise<StockTransfer | null> {
  const { data, error } = await db.from('stock_transfers').select('*, stock_transfer_lines(*)').eq('id', id).maybeSingle();
  if (error) throw toAppError(error);
  return data ? mapTransfer(data) : null;
}
export async function listHandoverConfirmations(transferId: string): Promise<HandoverConfirmation[]> {
  const { data, error } = await db.from('stock_handover_confirmations').select('*').eq('transfer_id', transferId).order('confirmed_at').limit(200);
  if (error) throw toAppError(error);
  return ((data ?? []) as Json[]).map((c) => ({
    id: c.id, transferId: c.transfer_id, stage: c.stage, proofType: c.proof_type, signerKind: c.signer_kind, signerName: c.signer_name,
    recordedBy: c.recorded_by, confirmedAt: c.confirmed_at, goodsPhotoPath: c.goods_photo_path ?? null, signerPhotoPath: c.signer_photo_path ?? null,
    paperPhotoPath: c.paper_photo_path ?? null,
  }));
}

export async function sendStockTransfer(i: SendTransferInput, clientRequestId: string): Promise<string> {
  return rpc('send_stock_transfer', {
    p_header: { warehouse_id: i.fromWarehouseId, to_warehouse_id: i.toWarehouseId, to_user_id: i.toUserId ?? '', note: i.note.trim() },
    p_lines: i.lines.map((l) => ({ item_id: l.itemId, quantity: l.quantity })),
    p_client_request_id: clientRequestId,
  });
}
export async function receiveStockTransfer(transferId: string, lines: ReceiveLineInput[], confirmation: ConfirmationPayload | null): Promise<void> {
  await rpc('receive_stock_transfer', {
    p_transfer: transferId,
    p_lines: lines.map((l) => ({
      line_id: l.lineId, counted: l.counted, accepted: l.accepted, reject_reason: l.rejectReason.trim(), quality_result: l.qualityResult ?? '',
    })),
    p_confirmation: confirmation,
  });
}
export const recallStockTransfer = (transferId: string, reason: string): Promise<void> => rpc('recall_stock_transfer', { p_transfer: transferId, p_reason: reason });
export const resolveStockShortfall = (lineId: string, resolution: ShortResolution, reason: string): Promise<void> =>
  rpc('resolve_stock_transfer_shortfall', { p_line: lineId, p_resolution: resolution, p_reason: reason.trim() || null });
export const recordStockHandover = (transferId: string, confirmation: ConfirmationPayload & { stage: HandoverStage }): Promise<string> =>
  rpc('record_stock_handover', { p_transfer: transferId, p_confirmation: confirmation });

export async function getMovementProofStatus(f: { status?: 'outstanding' | 'complete'; from?: string; to?: string } = {}): Promise<ProofStatusRow[]> {
  const data = await rpc('get_stock_movement_proof_status', { p_status: f.status ?? null, p_from: f.from ?? null, p_to: f.to ?? null });
  return ((data ?? []) as Json[]).map((r) => ({
    movementId: r.movement_id, number: r.movement_number, mode: r.mode, status: r.transfer_status, movementDate: r.movement_date,
    fromWarehouseId: r.from_warehouse_id, fromWarehouseName: r.from_warehouse_name, toWarehouseId: r.to_warehouse_id, toWarehouseName: r.to_warehouse_name,
    tagRules: r.tag_rules ?? [], requiredProof: r.required_proof, hasPaper: r.has_paper === true, hasConfirmation: r.has_confirmation === true,
    proofStatus: r.proof_status, missing: r.missing ?? null, proofCompletedAt: r.proof_completed_at ?? null,
  }));
}

/** The photo goes to the private bucket first, under {org}/{transfer}/{confirmation}/{file}; the RPC then links the path. */
export async function uploadHandoverPhoto(orgId: string, transferId: string, confirmationId: string, kind: 'goods' | 'person' | 'paper', file: File): Promise<string> {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120) || 'photo.jpg';
  const path = `${orgId}/${transferId}/${confirmationId}/${kind}-${safeName}`;
  const { error } = await db.storage.from('stock-handover').upload(path, file);
  if (error) throw toAppError(error);
  return path;
}
export async function handoverPhotoUrl(path: string): Promise<string> {
  const { data, error } = await db.storage.from('stock-handover').createSignedUrl(path, 300);
  if (error) throw toAppError(error);
  return data.signedUrl;
}

export async function setTagProofRule(tagId: string, rule: ProofRule): Promise<void> {
  const { data, error } = await db.from('stock_tags').update({ proof_required: rule }).eq('id', tagId).select('id');
  if (error) throw toAppError(error);
  if (!data || data.length === 0) throw toAppError({ message: 'You cannot change this tag.', code: '42501' });
}
export async function setItemQualityCheck(itemId: string, needs: boolean): Promise<void> {
  const { data, error } = await db.from('stock_items').update({ needs_quality_check: needs }).eq('id', itemId).select('id');
  if (error) throw toAppError(error);
  if (!data || data.length === 0) throw toAppError({ message: 'You cannot change this item.', code: '42501' });
}
