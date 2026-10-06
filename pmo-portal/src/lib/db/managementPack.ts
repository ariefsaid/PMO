import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';

/**
 * #765 — facts for the monthly management pack (ADR-0076). One SECURITY INVOKER RPC: RLS scopes the org,
 * the server normalises every amount to NET of tax and buckets invoices by `invoice_date` month. The time
 * series is derived client-side by `buildManagementPack` (src/lib/reports/managementPack.ts).
 */

/** First-of-month ISO dates (`YYYY-MM-01`). Omitted → server default (org timezone, FR-MMP-002). */
export interface ManagementPackRange {
  from?: string | null;
  to?: string | null;
}

export interface PackFactsProject {
  id: string;
  name: string;
  pmo_project_number: string | null;
  code: string | null;
  status: string;
  currency: string;
  /** Contract value NET of tax (0197's formula, computed server-side). */
  contract_net: number;
  start_date: string | null;
  end_date: string | null;
  project_manager_id: string | null;
  client_name: string | null;
}

export interface PackFactsInvoiced {
  project_id: string | null;
  currency: string;
  month: string;
  net: number;
  invoice_count: number;
}

export interface PackFactsInvoicedBefore {
  project_id: string | null;
  currency: string;
  net: number;
}

export interface PackFactsProgress {
  project_id: string;
  month: string;
  pct_complete: number;
  entered_at: string;
  entered_by_name: string | null;
}

export interface ManagementPackFacts {
  from: string;
  to: string;
  timezone: string;
  org_currency: string;
  undated_invoice_count: number;
  projects: PackFactsProject[];
  invoiced: PackFactsInvoiced[];
  invoiced_before: PackFactsInvoicedBefore[];
  progress: PackFactsProgress[];
}

export interface ProjectProgressInput {
  projectId: string;
  /** `YYYY-MM-01`; the server also normalises any day to the first. */
  month: string;
  pctComplete: number;
  note: string | null;
}

const ARRAY_KEYS = ['projects', 'invoiced', 'invoiced_before', 'progress'] as const;

/** Narrow the RPC's jsonb to the facts shape. A malformed body is an error, never an empty pack. */
export function parseManagementPackFacts(data: unknown): ManagementPackFacts {
  const d = data as Record<string, unknown> | null;
  const ok =
    d != null &&
    typeof d === 'object' &&
    typeof d.from === 'string' &&
    typeof d.to === 'string' &&
    typeof d.timezone === 'string' &&
    typeof d.org_currency === 'string' &&
    typeof d.undated_invoice_count === 'number' &&
    ARRAY_KEYS.every((k) => Array.isArray(d[k]));
  if (!ok) throw new AppError('The management pack response was malformed', 'pack-malformed');
  return d as unknown as ManagementPackFacts;
}

export async function getManagementPackFacts(range: ManagementPackRange = {}): Promise<ManagementPackFacts> {
  const args: { p_from?: string; p_to?: string } = {};
  if (range.from) args.p_from = range.from;
  if (range.to) args.p_to = range.to;
  const { data, error } = await supabase.rpc('get_management_pack', args);
  if (error) throw new AppError(error.message, error.code);
  return parseManagementPackFacts(data);
}

export async function recordProjectProgress(input: ProjectProgressInput): Promise<void> {
  const args: { p_project_id: string; p_month: string; p_pct_complete: number; p_note?: string } = {
    p_project_id: input.projectId,
    p_month: input.month,
    p_pct_complete: input.pctComplete,
  };
  const note = input.note?.trim();
  if (note) args.p_note = note;
  const { error } = await supabase.rpc('record_project_progress', args);
  if (error) throw new AppError(error.message, error.code);
}
