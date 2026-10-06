/**
 * draft_invoice — the ONE coarse write tool for "invoice this work order / milestone" (#787, ADR-0079).
 *
 *   request → validate → prepare (server-side resolution under the CALLER's JWT) → chip shows the resolved draft
 *   → approve → validatePrepared (allow-list rebuild of the replayed draft) → run: adapter-dispatch create.
 *
 * It only ever CREATES. A sales invoice created through adapter-dispatch is an ERPNext Draft (docstatus 0)
 * authored by the caller; submitting it is a separate SoD-gated act by a DIFFERENT Finance/Admin user. No code
 * path here sends a transition (NFR-AIN-SEC-003, mutation-checked in draftInvoice.run.test.ts).
 */
import { isMoney } from './agentFormat.ts';
import { UUID_RE } from './looseClient.ts';

export interface DraftInvoiceRequest {
  workOrder?: string; milestone?: string; project?: string; amount?: number; itemCode?: string;
}

/** undefined/blank → null (absent); non-string or too long → false (invalid). */
function text(v: unknown, max: number): string | null | false {
  if (v === undefined) return null;
  if (typeof v !== 'string') return false;
  const t = v.trim();
  if (t.length === 0) return null;
  return t.length > max ? false : t;
}

export function validateDraftRequest(
  input: unknown,
): { ok: true; value: DraftInvoiceRequest } | { ok: false; error: string } {
  const i = (input ?? {}) as Record<string, unknown>;
  const workOrder = text(i.workOrder, 100);
  const milestone = text(i.milestone, 100);
  const project = text(i.project, 200);
  const itemCode = text(i.itemCode, 140);
  if (workOrder === false || milestone === false || project === false || itemCode === false) {
    return { ok: false, error: 'text fields must be short strings' };
  }
  if (!!workOrder === !!milestone) return { ok: false, error: 'give exactly one of workOrder or milestone' };
  if (i.amount !== undefined && !isMoney(i.amount)) {
    return { ok: false, error: 'amount must be a positive number with at most 2 decimals' };
  }
  return {
    ok: true,
    value: {
      ...(workOrder ? { workOrder } : {}),
      ...(milestone ? { milestone } : {}),
      ...(project ? { project } : {}),
      ...(i.amount !== undefined ? { amount: i.amount as number } : {}),
      ...(itemCode ? { itemCode } : {}),
    },
  };
}

export interface DraftInvoiceLine { item_code: string; qty: 1; rate: number; description: string }
export interface DraftInvoicePrepared {
  kind: 'prepared-draft-invoice';
  commandId: string;
  idempotencyKey: string;
  customerId: string;
  projectId: string;
  items: [DraftInvoiceLine];
  reference_number: string | null;
  display: { customerName: string; projectName: string; sourceLabel: string; amountText: string };
}

const bad = (error: string) => ({ ok: false as const, error });
const shortText = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;

/** ADR-0079 §2: the REPLAYED draft is client-controlled — rebuild it from an allow-list (AC-AIN-011). */
export function validatePreparedDraft(
  input: unknown,
): { ok: true; value: DraftInvoicePrepared } | { ok: false; error: string } {
  const p = (input ?? {}) as Record<string, unknown>;
  if (p.kind !== 'prepared-draft-invoice') return bad('not a prepared draft invoice');
  for (const k of ['commandId', 'idempotencyKey', 'customerId', 'projectId']) {
    if (typeof p[k] !== 'string' || !UUID_RE.test(p[k] as string)) return bad(`${k} must be a uuid`);
  }
  const items = Array.isArray(p.items) ? p.items : [];
  if (items.length !== 1) return bad('exactly one line is required');
  const line = (items[0] ?? {}) as Record<string, unknown>;
  if (!shortText(line.item_code, 140) || !line.item_code.trim()) return bad('item_code is required');
  if (line.qty !== 1) return bad('qty must be 1');
  if (!isMoney(line.rate)) return bad('rate must be a positive amount with at most 2 decimals');
  if (!shortText(line.description, 140)) return bad('description must be at most 140 characters');
  const ref = p.reference_number ?? null;
  if (ref !== null && !shortText(ref, 140)) return bad('reference_number is invalid');
  const d = (p.display ?? {}) as Record<string, unknown>;
  const fields = ['customerName', 'projectName', 'sourceLabel', 'amountText'] as const;
  if (!fields.every((f) => shortText(d[f], 200))) return bad('display is invalid');
  return {
    ok: true,
    value: {
      kind: 'prepared-draft-invoice',
      commandId: p.commandId as string,
      idempotencyKey: p.idempotencyKey as string,
      customerId: p.customerId as string,
      projectId: p.projectId as string,
      items: [{ item_code: (line.item_code as string).trim(), qty: 1, rate: line.rate as number, description: line.description as string }],
      reference_number: ref as string | null,
      display: {
        customerName: d.customerName as string,
        projectName: d.projectName as string,
        sourceLabel: d.sourceLabel as string,
        amountText: d.amountText as string,
      },
    },
  };
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** FR-AIN-024: server-composed chip text, ≤120 chars (ApprovalChip truncates at 120). */
export function summarizeDraft(p: DraftInvoicePrepared): string {
  return `Save as Draft: invoice ${clip(p.display.customerName, 23)} ${clip(p.display.amountText, 22)} excl. tax for ${clip(p.display.sourceLabel, 20)}. Not submitted.`;
}
