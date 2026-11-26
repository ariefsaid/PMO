import type { StockTransfer, StockTransferLine, TransferStatus } from '@/src/lib/repositories/stockTransfers';

/** One pill per transfer state: an open shortfall waits on a decision (amber), closed is done (green), the rest neutral. */
export const TRANSFER_VARIANT: Record<TransferStatus, 'neutral' | 'warn' | 'won'> = { Sent: 'neutral', Received: 'warn', Closed: 'won', Cancelled: 'neutral' };

/** Lines counted short whose shortfall nobody has resolved yet. */
export const openShortfalls = (t: Pick<StockTransfer, 'lines'>): StockTransferLine[] =>
  t.lines.filter((l) => l.qtyCounted !== null && Number(l.qtyCounted) !== Number(l.qtySent) && l.shortResolution === null);
