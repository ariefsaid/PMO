/**
 * repositories/paymentChannels.ts (#2698) — the seam over the payment channel feature (1355/1356): the org switch and
 * list, and the channel on a request. Standalone module (same shape as `threeWayMatch.ts`); errors keep their code via `wrap`.
 */
import * as db from '@/src/lib/db/paymentChannels';
import type { PaymentChannel, ProcurementPaymentChannel } from '@/src/lib/db/paymentChannels';
import { wrap } from './repositoryErrors';

export type { PaymentChannel, ProcurementPaymentChannel };

export const paymentChannelRepository = {
  enabled: (): Promise<boolean> => wrap(() => db.getPaymentChannelsEnabled()),
  list: (): Promise<PaymentChannel[]> => wrap(() => db.listPaymentChannels()),
  setEnabled: (enabled: boolean): Promise<void> => wrap(() => db.setPaymentChannelsEnabled(enabled)),
  save: (id: string | null, name: string): Promise<void> => wrap(() => db.savePaymentChannel(id, name)),
  archive: (id: string, archived: boolean): Promise<void> => wrap(() => db.archivePaymentChannel(id, archived)),
  setOnRequest: (procurementId: string, channelId: string | null): Promise<void> => wrap(() => db.setProcurementPaymentChannel(procurementId, channelId)),
  onRequest: (procurementId: string): Promise<ProcurementPaymentChannel> => wrap(() => db.getProcurementPaymentChannel(procurementId)),
  namesFor: (procurementIds: readonly string[]): Promise<Record<string, string>> => wrap(() => db.getPaymentChannelNames(procurementIds)),
};
