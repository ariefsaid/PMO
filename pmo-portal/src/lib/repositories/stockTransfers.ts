/** repositories/stockTransfers.ts (#2690) — the seam over two-step transfers, handover confirmations and the proof status (ADR-0017). */
import * as db from '@/src/lib/db/stockTransfers';
import { wrap } from './repositoryErrors';

export type {
  TransferSettings, TransferMode, ProofTiming, HandoverScope, ProofRule, StockTransfer, StockTransferLine, HandoverConfirmation, SendTransferInput, ReceiveLineInput,
  ConfirmationPayload, ProofStatusRow, TransferStatus, ShortResolution, QualityResult, SignerKind, HandoverProofType, HandoverStage,
} from '@/src/lib/db/stockTransfers';

export const stockTransfersRepository = {
  settings: {
    get: () => wrap(() => db.getTransferSettings()),
    setMode: (m: db.TransferMode) => wrap(() => db.setTransferMode(m)),
    setTiming: (t: db.ProofTiming) => wrap(() => db.setProofTiming(t)),
    setScope: (s: db.HandoverScope) => wrap(() => db.setHandoverScope(s)),
    setTagProof: (tagId: string, rule: db.ProofRule) => wrap(() => db.setTagProofRule(tagId, rule)),
    setItemQuality: (itemId: string, needs: boolean) => wrap(() => db.setItemQualityCheck(itemId, needs)),
  },
  list: (status?: db.TransferStatus) => wrap(() => db.listStockTransfers(status)),
  get: (id: string) => wrap(() => db.getStockTransfer(id)),
  confirmations: (transferId: string) => wrap(() => db.listHandoverConfirmations(transferId)),
  send: (i: db.SendTransferInput, requestId: string) => wrap(() => db.sendStockTransfer(i, requestId)),
  receive: (id: string, lines: db.ReceiveLineInput[], confirmation: db.ConfirmationPayload | null) => wrap(() => db.receiveStockTransfer(id, lines, confirmation)),
  recall: (id: string, reason: string) => wrap(() => db.recallStockTransfer(id, reason)),
  resolveShortfall: (lineId: string, resolution: db.ShortResolution, reason: string) => wrap(() => db.resolveStockShortfall(lineId, resolution, reason)),
  recordHandover: (id: string, c: db.ConfirmationPayload & { stage: db.HandoverStage }) => wrap(() => db.recordStockHandover(id, c)),
  proofStatus: (f?: { status?: 'outstanding' | 'complete'; from?: string; to?: string }) => wrap(() => db.getMovementProofStatus(f)),
  photos: {
    upload: (orgId: string, transferId: string, confirmationId: string, kind: 'goods' | 'person' | 'paper', file: File) =>
      wrap(() => db.uploadHandoverPhoto(orgId, transferId, confirmationId, kind, file)),
    url: (path: string) => wrap(() => db.handoverPhotoUrl(path)),
  },
};
