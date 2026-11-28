import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import { wireValidator } from '@/src/lib/wireDoc';

/**
 * Opening balances (FR-OBS-001, migration 2161): what the CLI loaders put in at go-live, read-only. One security-definer read
 * (stock value is cost, which clients do not read); the database gates it to Admin and Finance and scopes it to the caller's
 * organisation, so no org id is sent. Every number is validated: a missing figure is an error, never a plausible 0.
 */
export interface OpeningStockLine { itemCode: string; itemName: string; quantity: number; value: number }
export interface OpeningWorkOrderLine { itemCode: string; description: string; certifiedQuantity: number; claimedQuantity: number; claimedAmount: number }

interface OpeningBase {
  id: string;
  /** The go-live date every opening carries. */
  asOf: string;
  loadedAt: string;
  loadedBy: string | null;
  /** Stock location code, or the work order's number (its title while a number is not yet minted). */
  label: string;
  /** Stock location name, or the project's name. */
  subLabel: string | null;
  currency: string;
  lineCount: number;
  note: string | null;
}
export interface OpeningStock extends OpeningBase { kind: 'stock'; quantity: number; value: number; lines: OpeningStockLine[] }
export interface OpeningWorkOrder extends OpeningBase { kind: 'work_order'; certifiedValue: number; claimedValue: number; lines: OpeningWorkOrderLine[] }
export type OpeningBalance = OpeningStock | OpeningWorkOrder;

const v = wireValidator('Opening balances', 'invalid');
const { num, text: str } = v;

export async function listOpeningBalances(): Promise<OpeningBalance[]> {
  const { data, error } = await supabase.rpc('opening_balances_overview');
  if (error) throw new AppError(error.message, error.code);
  return (data ?? []).map((r): OpeningBalance => {
    const base: OpeningBase = {
      id: r.id, asOf: r.as_of, loadedAt: r.loaded_at, loadedBy: r.loaded_by_name ?? null, label: str(r.label, 'label'), subLabel: r.sub_label ?? null,
      currency: str(r.currency, 'currency'), lineCount: num(r.line_count, 'line count'), note: r.note ?? null,
    };
    const lines = Array.isArray(r.lines) ? (r.lines as Record<string, unknown>[]) : [];
    if (r.kind === 'stock') {
      return {
        ...base, kind: 'stock', quantity: num(r.stock_quantity, 'stock quantity'), value: num(r.stock_value, 'stock value'),
        lines: lines.map((l) => ({ itemCode: str(l.item_code, 'item code'), itemName: str(l.item_name, 'item name'), quantity: num(l.quantity, 'quantity'), value: num(l.value, 'value') })),
      };
    }
    return {
      ...base, kind: 'work_order', certifiedValue: num(r.certified_value, 'certified value'), claimedValue: num(r.claimed_value, 'claimed value'),
      lines: lines.map((l) => ({
        itemCode: str(l.item_code, 'item code'), description: str(l.description, 'description'), certifiedQuantity: num(l.certified_quantity, 'certified quantity'),
        claimedQuantity: num(l.claimed_quantity, 'claimed quantity'), claimedAmount: num(l.claimed_amount, 'claimed amount'),
      })),
    };
  });
}
