import { supabase } from '@/src/lib/supabase/client';
import { toAppError } from '@/src/lib/appError';

export interface ReceivingLine {
  id: string; name: string; stock_item_id: string | null; stock_name: string | null; unit: string | null;
  ordered?: string; received?: string; outstanding?: string;
  status?: 'not_received' | 'partly_received' | 'fully_received';
}
export interface ReceiptCount {
  id: string; receiver_id: string; warehouse_id: string; date: string;
  lines: { item_id: string; quantity: number | string }[];
  approved: boolean; document_id: string | null; reversed: boolean;
}
export interface OrderReceiving { purchaser: boolean; lines: ReceivingLine[]; requests: ReceiptCount[] }
export interface CountInput { orderId: string; warehouseId: string; date: string; lines: { item_id: string; quantity: string }[]; requestId: string }
async function resolve<T>(request: PromiseLike<{ data: unknown; error: Parameters<typeof toAppError>[0] }>): Promise<T> {
  const result = await request;
  if (result.error) throw toAppError(result.error);
  return result.data as T;
}
export const getReceivingEnabled = () => resolve<boolean>(supabase.rpc('get_order_receiving_enabled'));
export const setReceivingEnabled = (enabled: boolean) => resolve<void>(supabase.rpc('set_order_receiving_enabled', { p_enabled: enabled }));
export const listReceivingOrders = () => resolve<{ id: string; number: string }[]>(supabase.rpc('list_receiving_orders'));
export const readOrderReceiving = (orderId: string) => resolve<OrderReceiving | null>(supabase.rpc('read_order_receiving', { p_po: orderId }));
export const mapOrderStock = (lineId: string, itemId: string | null) => resolve<void>(supabase.rpc('map_order_stock', { p_item: lineId, p_stock_item: itemId }));
export const receiveOrderGoods = (input: CountInput) => resolve<{ id: string; status: 'posted' | 'awaiting_approval'; document_id?: string }>(supabase.rpc('receive_order_goods', {
  p_po: input.orderId, p_warehouse: input.warehouseId, p_date: input.date, p_lines: input.lines, p_request: input.requestId,
}));
export const approveOrderReceipt = (id: string, reason: string) => resolve<void>(supabase.rpc('approve_order_receiving', { p_request: id, p_reason: reason }));
export const reverseOrderReceipt = (id: string, reason: string) => resolve<string>(supabase.rpc('reverse_order_receiving', { p_request: id, p_reason: reason }));
