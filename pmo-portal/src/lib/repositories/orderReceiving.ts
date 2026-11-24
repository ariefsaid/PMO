import * as db from '@/src/lib/db/orderReceiving';

export const orderReceivingRepository = {
  enabled: db.getReceivingEnabled, setEnabled: db.setReceivingEnabled, orders: db.listReceivingOrders,
  read: db.readOrderReceiving, map: db.mapOrderStock, receive: db.receiveOrderGoods,
  approve: db.approveOrderReceipt, reverse: db.reverseOrderReceipt,
};
