/**
 * ERP journal-entry cost lines on a project (0687, #1919). Read: `project_erp_journal_lines` (ERP-purchase audience only).
 * Write: only through the attach/detach RPCs, link only. A journal's cost reaches Actuals through the GL mirror, so
 * nothing here is summed into spent; an attached line lowers the purchase's open commitment on the server.
 */
import { supabase } from '@/src/lib/supabase/client';
import type { Json } from '@/src/lib/supabase/database.types';
import { AppError } from '@/src/lib/appError';

export interface ErpJournalLine {
  erpDoctype: string;
  voucherNo: string;
  projectId: string;
  account: string;
  category: string;
  postingDate: string | null;
  amount: number;
  currency: string | null;
  remarks: string | null;
  party: string | null;
  isCancelled: boolean;
  /** Link to the document in the ERP; null when the binding records no site address. */
  erpUrl: string | null;
  /** The attachment, when the line is attached to a purchase. */
  linkId: string | null;
  procurementId: string | null;
  procurementTitle: string | null;
  /** Attached, and a later negative journal line sits on the same project and account: the hold is kept, the user is told. */
  possiblyReversed: boolean;
}

/** One line to attach: the line key plus the purchase. */
export interface ErpJournalAttachRow {
  erp_doctype?: string;
  voucher_no: string;
  project_id: string;
  account: string;
  procurement_id: string;
}

export interface ErpJournalAttachResult {
  row: number;
  outcome: 'attach' | 'skip' | 'refused';
  /** `journal_posted_by_pmo`, `line_not_found`, `line_attached_to_another_purchase`, `already_attached`, … */
  reason: string | null;
  voucher_no: string | null;
  procurement_id: string | null;
  amount: number | null;
}

export interface ErpJournalAttachResponse { dry_run: boolean; results: ErpJournalAttachResult[] }

type Raw = {
  erp_doctype: string; voucher_no: string; project_id: string; account: string; category: string;
  posting_date: string | null; amount: number | string; currency: string | null; remarks: string | null; party: string | null;
  is_cancelled: boolean | null; erp_url: string | null; link_id: string | null; procurement_id: string | null; procurement_title: string | null;
  possibly_reversed: boolean | null;
};

const toLine = (r: Raw): ErpJournalLine => ({
  erpDoctype: r.erp_doctype,
  voucherNo: r.voucher_no,
  projectId: r.project_id,
  account: r.account,
  category: r.category,
  postingDate: r.posting_date,
  amount: Number(r.amount),
  currency: r.currency,
  remarks: r.remarks,
  party: r.party,
  isCancelled: r.is_cancelled === true,
  erpUrl: r.erp_url,
  linkId: r.link_id,
  procurementId: r.procurement_id,
  procurementTitle: r.procurement_title,
  possiblyReversed: r.possibly_reversed === true,
});

/** NFR-JEC-002: paged by range past PostgREST's `max_rows` (an unpaged read would silently truncate). The RPC's order
 *  (date, journal, account) is total within one project — (journal, account) is the line key — so pages never repeat or skip. */
const PAGE = 1000;
export async function listProjectJournalLines(projectId: string): Promise<ErpJournalLine[]> {
  const out: Raw[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.rpc('project_erp_journal_lines', { p_project_id: projectId }).range(from, from + PAGE - 1);
    if (error) throw new AppError(error.message, error.code);
    const page = (data ?? []) as unknown as Raw[];
    out.push(...page);
    if (page.length < PAGE) break;
  }
  return out.map(toLine);
}

/** FR-JEC-013 — attach (or dry-run) lines; per-row outcomes come back, refusals included. */
export async function attachErpJournalLines(rows: ErpJournalAttachRow[], dryRun = false): Promise<ErpJournalAttachResponse> {
  const { data, error } = await supabase.rpc('attach_erp_journal_lines', { p_rows: rows as unknown as Json, p_dry_run: dryRun });
  if (error) throw new AppError(error.message, error.code);
  return data as unknown as ErpJournalAttachResponse;
}

/** FR-JEC-014 — Admin/Finance; the RPC is the authority. */
export async function detachErpJournalLine(linkId: string): Promise<void> {
  const { error } = await supabase.rpc('detach_erp_journal_line', { p_link_id: linkId });
  if (error) throw new AppError(error.message, error.code);
}

import { wrap } from './repositoryErrors';
import type { ErpJournalLineRepository } from './contracts/erpJournalLines';

export const erpJournalLinesRepository: ErpJournalLineRepository = {
  listProject: (projectId) => wrap(() => listProjectJournalLines(projectId)),
  // One RPC: the project's lines already carry their purchase, so a purchase's lines are a filter of them.
  listForPurchase: (procurementId, projectId) => wrap(async () => (await listProjectJournalLines(projectId)).filter((l) => l.procurementId === procurementId)),
  attach: (rows, dryRun) => wrap(() => attachErpJournalLines(rows, dryRun ?? false)),
  detach: (linkId) => wrap(() => detachErpJournalLine(linkId)),
};
