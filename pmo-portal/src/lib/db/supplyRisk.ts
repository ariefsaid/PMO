/**
 * #2583 — supplier supply-risk DAL: the suggestion and exposure reads (migration 1066), the governed status write
 * (1067) and the work-order warning read. RLS scopes every read; org_id is never sent. The status is changed ONLY through
 * `set_vendor_supply_status` (Admin/Finance, audited); `companies_supply_risk_guard` refuses a direct write.
 */
import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import type { SupplyRiskCurrency, SupplyRiskStatus, SupplyRiskSuggestion } from '@/src/lib/supplyRisk';

export interface ExposedWorkOrderRow {
  kind: 'work_order' | 'project';
  workOrderId: string | null;
  woNumber: string | null;
  title: string | null;
  woStatus: string | null;
  projectId: string;
  projectName: string;
  openOrderCount: number;
  orderTotal: number | null;
  currency: string | null;
}

/** A work order warned about a supplier whose status is at_risk or inactive (FR-VSR-012). */
export interface SupplyRiskWarning {
  workOrderId: string;
  supplierId: string;
  supplierName: string;
  status: Exclude<SupplyRiskStatus, 'active'>;
}

interface SuggestionJson {
  basis: 'pmo' | 'erp';
  suggested_status: 'active' | 'at_risk' | null;
  no_aging_data: boolean;
  unknown_count: number;
  oldest_age_days: number | null;
  currencies: {
    currency: string;
    unpaid_amount: number;
    over60_amount: number;
    invoice_count: number | null;
    oldest_age_days: number | null;
  }[];
}

/** The database's suggestion (authoritative), or null when the company is not a readable Vendor of the caller's org. */
export async function getSupplyRiskSuggestion(companyId: string): Promise<SupplyRiskSuggestion | null> {
  const { data, error } = await supabase.rpc('vendor_supply_risk_suggestion', { p_company_id: companyId });
  if (error) throw new AppError(error.message, error.code);
  if (data == null) return null;
  const j = data as unknown as SuggestionJson;
  const currencies: SupplyRiskCurrency[] = (j.currencies ?? []).map((c) => ({
    currency: c.currency,
    unpaidAmount: Number(c.unpaid_amount),
    over60Amount: Number(c.over60_amount),
    invoiceCount: c.invoice_count == null ? null : Number(c.invoice_count),
    oldestAgeDays: c.oldest_age_days == null ? null : Number(c.oldest_age_days),
  }));
  return {
    basis: j.basis,
    suggestedStatus: j.suggested_status,
    noAgingData: j.no_aging_data,
    unknownCount: Number(j.unknown_count ?? 0),
    oldestAgeDays: j.oldest_age_days == null ? null : Number(j.oldest_age_days),
    currencies,
  };
}

export async function listExposedWorkOrders(companyId: string): Promise<ExposedWorkOrderRow[]> {
  const { data, error } = await supabase.rpc('vendor_exposed_work_orders', { p_company_id: companyId });
  if (error) throw new AppError(error.message, error.code);
  return (data ?? []).map((r) => ({
    kind: r.kind as ExposedWorkOrderRow['kind'],
    workOrderId: r.work_order_id,
    woNumber: r.wo_number,
    title: r.title,
    woStatus: r.wo_status,
    projectId: r.project_id,
    projectName: r.project_name,
    openOrderCount: Number(r.open_order_count),
    orderTotal: r.order_total == null ? null : Number(r.order_total),
    currency: r.currency,
  }));
}

/** Sets the status through the governed function; a reason is required unless the status is `active`. */
export async function setSupplyRiskStatus(companyId: string, status: SupplyRiskStatus, reason: string | null): Promise<void> {
  const { error } = await supabase.rpc('set_vendor_supply_status', {
    p_company_id: companyId,
    p_status: status,
    p_reason: reason ?? undefined,
  });
  if (error) throw new AppError(error.message, error.code);
}

interface WarningRaw {
  work_order_id: string | null;
  procurements: { vendor_id: string | null; companies: { id: string; name: string; supply_risk_status: string } | null } | null;
}

/**
 * Work orders of one project (or one work order) with an open order (Issued/Acknowledged) from a supplier whose status
 * is at_risk or inactive. Read-time (FR-VSR-012/014): nothing is stored on the work order. RLS-scoped.
 */
export async function listSupplyRiskWarnings(scope: { projectId?: string; workOrderId?: string }): Promise<SupplyRiskWarning[]> {
  if (!scope.projectId && !scope.workOrderId) return [];
  let q = supabase
    .from('purchase_orders')
    .select('work_order_id, procurements!inner(vendor_id, project_id, companies!procurements_vendor_id_fkey!inner(id, name, supply_risk_status))')
    .in('status', ['Issued', 'Acknowledged'])
    .not('work_order_id', 'is', null)
    .in('procurements.companies.supply_risk_status', ['at_risk', 'inactive']);
  if (scope.workOrderId) q = q.eq('work_order_id', scope.workOrderId);
  if (scope.projectId) q = q.eq('procurements.project_id', scope.projectId);
  // Bounded: one project's open orders from flagged suppliers (a handful in practice); never an unbounded org read.
  const { data, error } = await q.limit(500);
  if (error) throw new AppError(error.message, error.code);
  const seen = new Set<string>();
  const out: SupplyRiskWarning[] = [];
  for (const row of (data ?? []) as unknown as WarningRaw[]) {
    const company = row.procurements?.companies;
    if (!row.work_order_id || !company) continue;
    const key = `${row.work_order_id}|${company.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      workOrderId: row.work_order_id,
      supplierId: company.id,
      supplierName: company.name,
      status: company.supply_risk_status as SupplyRiskWarning['status'],
    });
  }
  return out;
}

/** The display name of whoever last changed a supplier's status (profiles are org-readable). Null when unreadable. */
export async function getSupplyRiskSetterName(profileId: string): Promise<string | null> {
  const { data, error } = await supabase.from('profiles').select('full_name').eq('id', profileId).maybeSingle();
  if (error) throw new AppError(error.message, error.code);
  return data?.full_name ?? null;
}
