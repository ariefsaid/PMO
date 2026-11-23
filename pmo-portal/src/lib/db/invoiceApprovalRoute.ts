import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';

/**
 * fix-waiting item 3 (FR-WAIT-006) — who ONE visible PMO-native Draft customer invoice waits for, from the
 * server-computed route (`get_invoice_approval_route`, migration 1569). The RPC is SECURITY INVOKER and reads
 * the invoice and its author set through their existing RLS policies; it takes only the invoice id, never an
 * org id. Its decider population mirrors `transition_native_sales_invoice` (role in Admin/Finance, an active,
 * non-field account) and `assert_sales_invoice_approver` (the primary author and every recorded co-author are
 * excluded; an invoice with no recorded author names nobody).
 *
 * The wire body is validated here: a malformed response is an error the screen can offer to retry, never a
 * fabricated approver or an empty route that reads as "nobody is needed".
 */

/** How the server described the route; `unavailable` is the non-leaking empty shape. */
export type InvoiceApprovalRouteKind = 'named' | 'nobody' | 'missing_author' | 'unavailable';

export interface InvoiceApprovalRouteApprover {
  id: string;
  name: string;
  /** The coarse user_role ("Finance", "Admin"), as the database stores it. */
  role: string;
}

export interface InvoiceApprovalRoute {
  approvers: InvoiceApprovalRouteApprover[];
  routeKind: InvoiceApprovalRouteKind;
}

const ROUTE_KINDS: readonly InvoiceApprovalRouteKind[] = ['named', 'nobody', 'missing_author', 'unavailable'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/** Narrow the RPC's jsonb to the route shape. A malformed body is an error, never a fabricated route. */
export function parseInvoiceApprovalRoute(data: unknown): InvoiceApprovalRoute {
  if (!isRecord(data) || !Array.isArray(data.approvers) || !nonEmptyString(data.route_kind)) {
    throw new AppError('The invoice approval route response was malformed', 'invoice-route-malformed');
  }
  if (!ROUTE_KINDS.includes(data.route_kind as InvoiceApprovalRouteKind)) {
    throw new AppError('The invoice approval route response was malformed', 'invoice-route-malformed');
  }
  const approvers: InvoiceApprovalRouteApprover[] = data.approvers.map((entry) => {
    // `profiles.full_name` is NOT NULL but has no non-blank invariant: a blank name is a valid server value,
    // so it is accepted and the sentence falls back to the role word. Every other field shape is still strict.
    if (!isRecord(entry) || !nonEmptyString(entry.id) || typeof entry.name !== 'string' || !nonEmptyString(entry.role)) {
      throw new AppError('The invoice approval route response was malformed', 'invoice-route-malformed');
    }
    return { id: entry.id, name: entry.name.trim(), role: entry.role };
  });
  return { approvers, routeKind: data.route_kind as InvoiceApprovalRouteKind };
}

/**
 * Reads the route for ONE visible invoice. org_id is NEVER sent — the invoker RPC's RLS (and its active-caller
 * assert) is the whole scope. A refusal (an inactive or field session) or a read failure throws a code-bearing
 * AppError so the screen can stay honest (plain pending text + a retry), never invent names.
 */
export async function getInvoiceApprovalRoute(invoiceId: string): Promise<InvoiceApprovalRoute> {
  const { data, error } = await supabase.rpc('get_invoice_approval_route', { p_invoice_id: invoiceId });
  if (error) throw new AppError(error.message, error.code);
  return parseInvoiceApprovalRoute(data);
}
