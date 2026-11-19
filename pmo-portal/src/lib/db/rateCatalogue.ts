import { supabase } from '@/src/lib/supabase/client';
import { fetchAllPages } from '@/src/lib/pagedRead';
import { AppError } from '@/src/lib/appError';

/**
 * Unit-rate catalogue DAL (#2520, migration 0955). Reads are RLS-scoped table selects; every write goes through a
 * definer/invoker RPC (no client write grant exists). org_id is never sent from the client.
 * The generated types predate 0955, so this module talks to the client through a narrow local shape.
 */
export interface CatalogueVariant { id: string; project_id: string; name: string }
export interface CatalogueItem {
  id: string; project_id: string; category: string; class: string; item_code: string;
  description: string; unit: string; work_method: string; test_type: string;
}
export interface CatalogueRate { item_id: string; variant_id: string; rate: number; effective_from: string }
export interface CatalogueStageWeight { item_id: string; effective_from: string; position: number; stage: string; weight_pct: number }

/** One catalogue item as the import / form writes it: rates keyed by variant NAME, all effective from one date. */
export interface CatalogueItemInput {
  category: string; class: string; itemCode: string; description: string; unit: string;
  workMethod: string; testType: string; effectiveFrom: string;
  rates: Record<string, number>;
  stages: { stage: string; weightPct: number }[];
}

type Err = { message: string; code?: string } | null;
interface Loose {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the PostgREST builder chain; generated types predate 0955
  from(table: string): { select(cols: string): any };
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: Err }>;
}
const db = supabase as unknown as Loose;
const fail = (error: { message: string; code?: string }): never => { throw new AppError(error.message, error.code); };

export async function listVariants(projectId: string): Promise<CatalogueVariant[]> {
  return fetchAllPages<CatalogueVariant>((from, to) =>
    db.from('rate_catalogue_variants').select('id, project_id, name').eq('project_id', projectId).order('name').order('id').range(from, to));
}

export async function listItems(projectId: string): Promise<CatalogueItem[]> {
  return fetchAllPages<CatalogueItem>((from, to) =>
    db.from('rate_catalogue_items').select('id, project_id, category, class, item_code, description, unit, work_method, test_type')
      .eq('project_id', projectId).order('category').order('class').order('item_code').order('id').range(from, to));
}

/** Every rate of the contract's items, oldest first: the whole history, so a screen can show "as of" any date. */
export async function listRates(projectId: string): Promise<CatalogueRate[]> {
  const rows = await fetchAllPages<CatalogueRate & { rate_catalogue_items: { project_id: string } }>((from, to) =>
    db.from('rate_catalogue_rates').select('item_id, variant_id, rate, effective_from, rate_catalogue_items!inner(project_id)')
      .eq('rate_catalogue_items.project_id', projectId).order('effective_from').order('id').range(from, to));
  return rows.map((r) => ({ item_id: r.item_id, variant_id: r.variant_id, rate: Number(r.rate), effective_from: r.effective_from }));
}

export async function addVariants(projectId: string, names: string[]): Promise<number> {
  const { data, error } = await db.rpc('rate_catalogue_add_variants', { p_project: projectId, p_names: names });
  if (error) fail(error);
  return Number(data);
}

export async function upsertItem(projectId: string, input: CatalogueItemInput): Promise<{ itemId: string; created: boolean; ratesAdded: number }> {
  const { data, error } = await db.rpc('rate_catalogue_upsert_item', {
    p_project: projectId,
    p_item: {
      category: input.category, class: input.class, item_code: input.itemCode, description: input.description, unit: input.unit,
      work_method: input.workMethod, test_type: input.testType, effective_from: input.effectiveFrom, rates: input.rates,
      stages: input.stages.map((s) => ({ stage: s.stage, weight_pct: s.weightPct })),
    },
  });
  if (error) fail(error);
  const r = data as { item_id: string; created: boolean; rates_added: number };
  return { itemId: r.item_id, created: r.created, ratesAdded: r.rates_added };
}

/** Price one contract line from the catalogue at a location variant; returns the rate the line now carries. */
export async function priceBoqLine(boqItemId: string, catalogueItemId: string, variantId: string, asOf: string): Promise<number> {
  const { data, error } = await db.rpc('price_boq_line_from_catalogue', {
    p_boq_item: boqItemId, p_catalogue_item: catalogueItemId, p_variant: variantId, p_as_of: asOf,
  });
  if (error) fail(error);
  return Number(data);
}

/** The rate in force on a date from an already-read rate list (pure; the screen's "as of" column). */
export function rateAt(rates: CatalogueRate[], itemId: string, variantId: string, asOf: string): number | null {
  let best: CatalogueRate | null = null;
  for (const r of rates) {
    if (r.item_id === itemId && r.variant_id === variantId && r.effective_from <= asOf && (!best || r.effective_from > best.effective_from)) best = r;
  }
  return best ? best.rate : null;
}
