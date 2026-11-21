/** The state and the upload step of one handover confirmation (#2690); the form part is HandoverCapture.tsx. */
import { stockTransfersRepository, type ConfirmationPayload, type HandoverProofType, type HandoverStage } from '@/src/lib/repositories/stockTransfers';

/** What the person has entered for one handover. Photos are held as files until the confirmation is submitted. */
export interface HandoverValue {
  proofType: HandoverProofType;
  guest: boolean;              // the person signing has no account and signs on the logged-in person's phone
  guestName: string;           // typed by the host; required for a guest
  goods: File | null;
  person: File | null;
  paper: File | null;
}
export const emptyHandover = (proofType: HandoverProofType = 'in_app'): HandoverValue => ({ proofType, guest: false, guestName: '', goods: null, person: null, paper: null });

/** A handover is complete when the photos its proof type needs are taken and a guest has a typed name (2 characters or more, as the database requires). */
export function isHandoverComplete(v: HandoverValue): boolean {
  const named = !v.guest || v.guestName.trim().length >= 2;
  return named && (v.proofType === 'paper' ? v.paper !== null : v.goods !== null && v.person !== null);
}

/** Uploads the photos, then returns the payload the RPC links. A failed upload throws before anything is recorded. */
export async function buildConfirmation(orgId: string, transferId: string, v: HandoverValue, stage?: HandoverStage): Promise<ConfirmationPayload> {
  const id = crypto.randomUUID();
  const base: ConfirmationPayload = { id, proof_type: v.proofType, signer_kind: v.guest ? 'guest' : 'account', ...(stage ? { stage } : {}), ...(v.guest ? { signer_name: v.guestName.trim() } : {}) };
  if (v.proofType === 'paper') {
    return { ...base, paper_photo_path: await stockTransfersRepository.photos.upload(orgId, transferId, id, 'paper', v.paper!) };
  }
  const goods = await stockTransfersRepository.photos.upload(orgId, transferId, id, 'goods', v.goods!);
  const person = await stockTransfersRepository.photos.upload(orgId, transferId, id, 'person', v.person!);
  return { ...base, goods_photo_path: goods, signer_photo_path: person };
}
