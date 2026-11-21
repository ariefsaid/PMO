import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';

/**
 * Purchase types (#2697, migrations 1350-1352; spec docs/specs/purchase-type-rental-extension.spec.md).
 * The list is the organisation's data; nothing here compares a type's name. Behaviour hangs off `isRental`.
 * Every rule (Admin-only edits, period rules, extension order and overlap) is held by the database; this module carries
 * the call and keeps the refusal's Postgres code. org_id is never sent.
 */
export interface PurchaseType {
  id: string;
  name: string;
  nameId: string | null;
  isRental: boolean;
  position: number;
  active: boolean;
}

type DbResult<T> = PromiseLike<{ data: T | null; error: { message: string; code?: string } | null }>;
const fail = (error: { message: string; code?: string }): never => { throw new AppError(error.message, error.code); };

/** Stable key for a refusal, from the database message prefix (`PTYPE_…:`). */
export type PurchaseTypeRefusal =
  | 'ADMIN_ONLY' | 'OFF' | 'UNAVAILABLE' | 'PERIOD_REQUIRED' | 'PERIOD_NOT_ALLOWED' | 'FIXED' | 'IN_USE' | 'INVALID'
  | 'EXT_NOT_FOUND' | 'EXT_NOT_LIVE_RENTAL' | 'EXT_SAME_TYPE' | 'EXT_ORDER' | 'EXT_OVERLAP';

export function purchaseTypeRefusal(error: unknown): { key: PurchaseTypeRefusal; message: string } | null {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const m = /PTYPE_([A-Z_]+):\s*(.*)$/s.exec(message);
  return m ? { key: m[1] as PurchaseTypeRefusal, message: m[2] } : null;
}

interface TypeDbRow { id: string; name: string; name_id: string | null; is_rental: boolean; position: number; active: boolean }
const toType = (r: TypeDbRow): PurchaseType => ({ id: r.id, name: r.name, nameId: r.name_id, isRental: r.is_rental, position: r.position, active: r.active });

/** Whether purchase types are on for the caller's organisation. No settings row means off. */
export async function getPurchaseTypesEnabled(): Promise<boolean> {
  const { data, error } = await (supabase.from('org_purchase_type_settings').select('enabled').limit(1) as unknown as DbResult<Array<{ enabled: boolean }>>);
  if (error) fail(error);
  return data?.[0]?.enabled ?? false;
}

export async function listPurchaseTypes(): Promise<PurchaseType[]> {
  const { data, error } = await (supabase.from('purchase_types').select('id, name, name_id, is_rental, position, active')
    .order('position', { ascending: true }).order('name', { ascending: true }).limit(200) as unknown as DbResult<TypeDbRow[]>);
  if (error) fail(error);
  return (data ?? []).map(toType);
}

export async function setPurchaseTypesEnabled(enabled: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_purchase_types_enabled', { p_enabled: enabled });
  if (error) fail(error);
}

export interface PurchaseTypeInput { id: string | null; name: string; nameId: string | null; isRental: boolean; position: number }

export async function upsertPurchaseType(input: PurchaseTypeInput): Promise<void> {
  const { error } = await supabase.rpc('upsert_purchase_type', {
    p_id: input.id, p_name: input.name, p_name_id: input.nameId, p_is_rental: input.isRental, p_position: input.position,
  });
  if (error) fail(error);
}

export async function setPurchaseTypeActive(id: string, active: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_purchase_type_active', { p_id: id, p_active: active });
  if (error) fail(error);
}

export interface RentalExtensionInput {
  id: string;
  originalId: string;
  from: string;
  to: string;
  /** Omit to carry the original's lines over as defaults. */
  lines?: Array<{ id: string; name: string; quantity: number; rate: number; description?: string | null }>;
}

/** FR-PTR-010: one new Draft purchase linked to the rental it extends. Returns the new purchase id. */
export async function extendRentalProcurement(input: RentalExtensionInput): Promise<string> {
  const { data, error } = await supabase.rpc('extend_rental_procurement', {
    p_id: input.id, p_original: input.originalId, p_from: input.from, p_to: input.to,
    ...(input.lines ? { p_items: input.lines.map((l) => ({ id: l.id, name: l.name, quantity: l.quantity, rate: l.rate, description: l.description ?? null })) } : {}),
  });
  if (error) fail(error);
  return (data as { id: string }).id;
}

export interface RentalLink { id: string; title: string; rentalFrom: string | null; rentalTo: string | null; status: string }

/** FR-PTR-013: the purchase this one extends and the purchases that extend it (both, with periods). */
export async function getRentalLinks(procurementId: string, extendsId: string | null): Promise<{ extends: RentalLink | null; extensions: RentalLink[] }> {
  const cols = 'id, title, rental_from, rental_to, status';
  type Row = { id: string; title: string; rental_from: string | null; rental_to: string | null; status: string };
  const map = (r: Row): RentalLink => ({ id: r.id, title: r.title, rentalFrom: r.rental_from, rentalTo: r.rental_to, status: r.status });
  const [exts, parent] = await Promise.all([
    supabase.from('procurements').select(cols).eq('extends_procurement_id' as never, procurementId as never).order('rental_from' as never, { ascending: true }).limit(50) as unknown as DbResult<Row[]>,
    extendsId ? (supabase.from('procurements').select(cols).eq('id', extendsId).limit(1) as unknown as DbResult<Row[]>) : Promise.resolve({ data: [] as Row[], error: null }),
  ]);
  if (exts.error) fail(exts.error);
  if (parent.error) fail(parent.error);
  return { extends: parent.data?.[0] ? map(parent.data[0]) : null, extensions: (exts.data ?? []).map(map) };
}
