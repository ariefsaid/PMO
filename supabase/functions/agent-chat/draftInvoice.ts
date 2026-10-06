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
import type { AgentAction, DeputyContext } from '../../../pmo-portal/src/lib/agent/runtime/port.ts';
import { AGENT_REVENUE_WRITE_ROLES } from '../../../pmo-portal/src/auth/agentRoles.ts';
import { normalizeTaxAmount } from '../../../pmo-portal/src/lib/taxNormalize.ts';
import { salesInvoiceCreateFields } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/salesInvoiceCommand.ts';
import { DRAFT_INVOICE_SCHEMA } from './schema.ts';
import { formatMoney, isMoney, resolveNumberLocale } from './agentFormat.ts';
import {
  asFunctions, asLoose, readOne, readRows, toLikeTerm, UUID_RE, withTimeout,
  type LooseClient, type LooseQuery,
} from './looseClient.ts';

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
  display: { customerName: string; projectName: string; sourceLabel: string; amountText: string; itemLabel?: string };
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
  if (d.itemLabel !== undefined && !shortText(d.itemLabel, 200)) return bad('display is invalid');
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
        ...(d.itemLabel !== undefined ? { itemLabel: d.itemLabel as string } : {}),
      },
    },
  };
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * FR-AIN-024: server-composed chip text, ≤120 chars (ApprovalChip truncates at 120). When the draft is not on the
 * org's only sales item, the item is shown too — the user must see which item (income account / tax template)
 * the Draft lands on (M1).
 */
export function summarizeDraft(p: DraftInvoicePrepared): string {
  const d = p.display;
  if (d.itemLabel) {
    return `Save as Draft: invoice ${clip(d.customerName, 14)} ${clip(d.amountText, 16)} excl. tax for ${clip(d.sourceLabel, 14)} (item ${clip(d.itemLabel, 12)}). Not submitted.`;
  }
  return `Save as Draft: invoice ${clip(d.customerName, 23)} ${clip(d.amountText, 22)} excl. tax for ${clip(d.sourceLabel, 20)}. Not submitted.`;
}

export type Candidate = { id: string; label: string };
/** A refusal the model can act on (FR-AIN-023). A type alias (not an interface) so it fits PrepareResult. */
export type PrepareRefusal = { error: string; needs?: 'amount' | 'itemCode' | 'choice'; candidates?: Candidate[] };
export type Resolved<T> = { ok: true; value: T } | { ok: false; error: PrepareRefusal };
export type PrepareOutcome = { ok: true; value: DraftInvoicePrepared; summary: string } | { ok: false; error: PrepareRefusal };

export const refuse = (error: string, needs?: PrepareRefusal['needs'], candidates?: Candidate[]) => ({
  ok: false as const,
  error: { error, ...(needs ? { needs } : {}), ...(candidates?.length ? { candidates: candidates.slice(0, 8) } : {}) } as PrepareRefusal,
});

/** DD-AIN-3: Finance/Admin only; Revenue on; revenue owned by ERPNext (the only create path until #784). */
async function gate(sb: LooseClient, ctx: DeputyContext): Promise<PrepareRefusal | null> {
  if (!ctx.role || !AGENT_REVENUE_WRITE_ROLES.includes(ctx.role)) return { error: 'Only Finance or Admin can raise an invoice.' };
  const [feature, owned] = await Promise.all([
    readOne<{ enabled: boolean }>(sb.from('org_features').select('enabled').eq('feature_key', 'revenue').maybeSingle()),
    readRows<{ external_tier: string }>(
      sb.from('external_domain_ownership').select('external_tier').eq('domain', 'revenue').eq('external_tier', 'erpnext').limit(1),
    ),
  ]);
  if (feature?.enabled !== true) return { error: 'Invoicing is not turned on for this organisation.' };
  if (owned.length === 0) return { error: 'Invoices are raised in ERPNext, and this organisation has not connected revenue to ERPNext yet.' };
  return null;
}

export interface ProjectRow { id: string; name: string; client_id: string | null; currency: string }
const PROJECT_COLS = 'id, name, client_id, currency';
const CANDIDATE_LIMIT = 6;

export async function resolveProject(sb: LooseClient, term: string): Promise<Resolved<ProjectRow>> {
  const live = () => sb.from('projects').select(PROJECT_COLS).is('archived_at', null);
  if (UUID_RE.test(term)) {
    const rows = await readRows<ProjectRow>(live().eq('id', term).limit(1));
    return rows[0] ? { ok: true, value: rows[0] } : refuse('That project was not found.');
  }
  for (const column of ['pmo_project_number', 'code']) {
    const rows = await readRows<ProjectRow>(live().eq(column, term).limit(2));
    if (rows.length === 1) return { ok: true, value: rows[0] };
  }
  const like = toLikeTerm(term);
  const rows = like ? await readRows<ProjectRow>(live().ilike('name', `%${like}%`).limit(CANDIDATE_LIMIT)) : [];
  if (rows.length === 1) return { ok: true, value: rows[0] };
  if (rows.length === 0) return refuse(`No project matches "${term}".`);
  return refuse('Which project?', 'choice', rows.map((p) => ({ id: p.id, label: p.name })));
}

export interface WorkOrderRow {
  id: string; wo_number: string | null; title: string; project_id: string; status: string;
  order_value: number; tax_amount: number; tax_treatment: string; currency: string; client_po_number: string | null;
}
const WO_COLS = 'id, wo_number, title, project_id, status, order_value, tax_amount, tax_treatment, currency, client_po_number';
const INVOICEABLE_WO_STATUSES = ['Issued', 'Closed'];
export const woLabel = (w: WorkOrderRow) => `${w.wo_number ?? 'Work order'} — ${w.title}`;

export async function resolveWorkOrder(sb: LooseClient, term: string, project: ProjectRow | null): Promise<Resolved<WorkOrderRow>> {
  const scoped = (q: LooseQuery) => (project ? q.eq('project_id', project.id) : q);
  let rows: WorkOrderRow[];
  const like = UUID_RE.test(term) ? '' : toLikeTerm(term);
  if (UUID_RE.test(term)) {
    // A candidate id from a previous "Which work order?" round (M2).
    rows = await readRows<WorkOrderRow>(scoped(sb.from('work_orders').select(WO_COLS).eq('id', term)).limit(1));
  } else if (!like) {
    return refuse(`No work order matches "${term}".`);
  } else {
    rows = await readRows<WorkOrderRow>(scoped(sb.from('work_orders').select(WO_COLS).ilike('wo_number', like)).limit(CANDIDATE_LIMIT));
  }
  if (rows.length === 0 && like) {
    rows = await readRows<WorkOrderRow>(scoped(sb.from('work_orders').select(WO_COLS).ilike('title', `%${like}%`)).limit(CANDIDATE_LIMIT));
  }
  if (rows.length === 0) return refuse(`No work order matches "${term}".`);
  if (rows.length > 1) return refuse('Which work order?', 'choice', rows.map((w) => ({ id: w.id, label: woLabel(w) })));
  const wo = rows[0];
  if (!INVOICEABLE_WO_STATUSES.includes(wo.status)) {
    return refuse(`${woLabel(wo)} is ${wo.status}; only an Issued or Closed work order can be invoiced.`);
  }
  return { ok: true, value: wo };
}

export interface MilestoneRow { id: string; name: string; project_id: string; sort_order: number }
const MS_COLS = 'id, name, project_id, sort_order';
const POSITION_RE = /^(?:m|milestone)?\s*#?\s*(\d{1,3})$/i;

export async function resolveMilestone(sb: LooseClient, term: string, project: ProjectRow | null): Promise<Resolved<MilestoneRow>> {
  const pos = POSITION_RE.exec(term.trim());
  if (pos) {
    if (!project) return refuse('Which project is the milestone on?', 'choice');
    const all = await readRows<MilestoneRow>(
      sb.from('project_milestones').select(MS_COLS).eq('project_id', project.id)
        .order('sort_order', { ascending: true }).order('created_at', { ascending: true }).limit(200),
    );
    const n = Number(pos[1]);
    const m = all[n - 1];
    return m ? { ok: true, value: m } : refuse(`${project.name} has ${all.length} milestones; there is no milestone ${n}.`);
  }
  let q = sb.from('project_milestones').select(MS_COLS);
  if (UUID_RE.test(term.trim())) {
    // A candidate id from a previous "Which milestone?" round (M2).
    q = q.eq('id', term.trim());
  } else {
    const like = toLikeTerm(term);
    if (!like) return refuse(`No milestone matches "${term}".`);
    q = q.ilike('name', `%${like}%`);
  }
  if (project) q = q.eq('project_id', project.id);
  const rows = await readRows<MilestoneRow>(q.limit(CANDIDATE_LIMIT));
  if (rows.length === 1) return { ok: true, value: rows[0] };
  if (rows.length === 0) return refuse(`No milestone matches "${term}".`);
  // Same-named milestones on different projects must stay distinguishable: label with the project (M2).
  const names = new Map<string, string>();
  const ids = [...new Set(rows.map((m) => m.project_id))];
  for (const pr of await readRows<{ id: string; name: string }>(sb.from('projects').select('id, name').in('id', ids))) names.set(pr.id, pr.name);
  return refuse('Which milestone?', 'choice', rows.map((m) => ({ id: m.id, label: names.has(m.project_id) ? `${names.get(m.project_id)} — ${m.name}` : m.name })));
}

export const ITEM_CATALOG_TIMEOUT_MS = 10_000;

export interface ResolvedItem { code: string; name: string; /** the org has exactly one sales item */ only: boolean }

/**
 * DD-AIN-5 + M1: always read the org's sales-item catalogue under the caller's JWT. A model-named code must be in
 * it (never trusted on the prompt alone — it picks the income account / Item Tax Template); with no name, the org's
 * only item is used, else ask (candidates are ask_user options).
 */
export async function resolveItem(ctx: DeputyContext, named?: string): Promise<Resolved<ResolvedItem>> {
  const fns = asFunctions(ctx.supabase);
  const ask = (msg: string) => refuse(msg, 'itemCode');
  if (!fns) return ask('Which ERPNext item should the invoice use?');
  let items: Array<{ code: string; name: string }> | undefined;
  try {
    const { data, error } = await withTimeout(
      fns.functions.invoke('external-items', { body: { purpose: 'sales' } }),
      ITEM_CATALOG_TIMEOUT_MS,
    );
    items = error ? undefined : (data as { items?: Array<{ code: string; name: string }> } | null)?.items;
  } catch {
    items = undefined;
  }
  if (!items) return ask('I could not read the ERPNext item list. Which item code should the invoice use?');
  if (items.length === 0) return refuse('ERPNext has no sales item to bill against. Ask an admin to add one.');
  const candidates = items.map((i) => ({ id: i.code, label: `${i.code} — ${i.name}` }));
  if (named) {
    const hit = items.find((i) => i.code === named);
    if (!hit) return refuse(`ERPNext has no sales item "${named}". Which item should the invoice use?`, 'itemCode', candidates);
    return { ok: true, value: { code: hit.code, name: hit.name, only: items.length === 1 } };
  }
  if (items.length > 1) return refuse('Which ERPNext item should the invoice use?', 'itemCode', candidates);
  return { ok: true, value: { code: items[0].code, name: items[0].name, only: true } };
}

export async function prepareDraftInvoice(
  req: DraftInvoiceRequest,
  ctx: DeputyContext,
  newId: () => string = () => crypto.randomUUID(),
): Promise<PrepareOutcome> {
  const sb = asLoose(ctx.supabase);
  const denied = await gate(sb, ctx);
  if (denied) return { ok: false, error: denied };

  let project: ProjectRow | null = null;
  if (req.project) {
    const p = await resolveProject(sb, req.project);
    if (!p.ok) return p;
    project = p.value;
  }

  type Source = { kind: 'workOrder'; wo: WorkOrderRow } | { kind: 'milestone'; ms: MilestoneRow };
  let source: Source;
  if (req.workOrder) {
    const r = await resolveWorkOrder(sb, req.workOrder, project);
    if (!r.ok) return r;
    source = { kind: 'workOrder', wo: r.value };
  } else {
    const r = await resolveMilestone(sb, req.milestone ?? '', project);
    if (!r.ok) return r;
    source = { kind: 'milestone', ms: r.value };
  }
  const sourceProjectId = source.kind === 'workOrder' ? source.wo.project_id : source.ms.project_id;
  if (!project || project.id !== sourceProjectId) {
    project = await readOne<ProjectRow>(sb.from('projects').select(PROJECT_COLS).eq('id', sourceProjectId).maybeSingle());
    if (!project) return refuse('The project for that item was not found.');
  }
  const clientId = project.client_id;
  if (!clientId) return refuse(`${project.name} has no client, so there is no one to invoice.`);

  const [customer, erpLink, org] = await Promise.all([
    readOne<{ name: string }>(sb.from('companies').select('name').eq('id', clientId).maybeSingle()),
    readRows<{ external_record_id: string }>(
      sb.from('external_refs').select('external_record_id').eq('domain', 'companies').eq('pmo_record_id', clientId).limit(1),
    ),
    readOne<{ default_locale: string | null; default_number_locale: string | null }>(
      sb.from('organizations').select('default_locale, default_number_locale').eq('id', ctx.orgId).maybeSingle(),
    ),
  ]);
  if (erpLink.length === 0) {
    return refuse(`${customer?.name ?? 'This client'} is not linked to ERPNext yet, so an invoice cannot be raised for them.`);
  }

  // DD-AIN-4: a stated amount wins; else a work order's value BEFORE tax from its own recorded tax facts.
  let rate: number | null = req.amount ?? null;
  if (rate === null && source.kind === 'workOrder') {
    const wo = source.wo;
    rate = normalizeTaxAmount(Number(wo.order_value), Number(wo.tax_amount), wo.tax_treatment, 'exclusive');
  }
  if (rate === null) {
    return source.kind === 'milestone'
      ? refuse("Milestones don't carry an amount yet. How much should this invoice be, before tax?", 'amount')
      : refuse(`I can't work out ${woLabel(source.wo)}'s value before tax. How much should this invoice be, before tax?`, 'amount');
  }
  if (!isMoney(rate)) return refuse('The amount to invoice must be more than zero.', 'amount');

  const poRef = source.kind === 'workOrder' ? source.wo.client_po_number ?? null : null;
  if (source.kind === 'workOrder' && poRef !== null && poRef.length > 140) {
    return refuse(`The client PO reference on ${source.wo.wo_number ?? source.wo.title} is longer than 140 characters, so it cannot go on an invoice. Shorten it on the work order first.`);
  }

  const item = await resolveItem(ctx, req.itemCode);
  if (!item.ok) return item;

  const currency = source.kind === 'workOrder' ? source.wo.currency : project.currency;
  const description = (source.kind === 'workOrder' ? woLabel(source.wo) : `${project.name} — ${source.ms.name}`).slice(0, 140);
  const sourceLabel = source.kind === 'workOrder' ? source.wo.wo_number ?? source.wo.title : source.ms.name;
  const value: DraftInvoicePrepared = {
    kind: 'prepared-draft-invoice',
    commandId: newId(),
    idempotencyKey: newId(),
    customerId: clientId,
    projectId: project.id,
    items: [{ item_code: item.value.code, qty: 1, rate, description }],
    reference_number: poRef,
    display: {
      customerName: clip(customer?.name ?? 'the client', 200),
      projectName: clip(project.name, 200),
      sourceLabel: clip(sourceLabel, 200),
      amountText: clip(formatMoney(rate, currency, resolveNumberLocale(org)), 200),
      ...(item.value.only ? {} : { itemLabel: clip(`${item.value.code} — ${item.value.name}`, 200) }),
    },
  };
  return { ok: true, value, summary: summarizeDraft(value) };
}

export const DRAFT_INVOICE_DISPATCH_TIMEOUT_MS = 25_000;

async function readDispatchError(error: unknown): Promise<{ message: string; code?: string }> {
  const res = (error as { context?: Response } | null)?.context;
  if (res && typeof res.clone === 'function') {
    try {
      const body = (await res.clone().json()) as { error?: string; message?: string };
      if (typeof body.message === 'string' && body.message.trim()) {
        return { message: body.message, ...(body.error ? { code: body.error } : {}) };
      }
    } catch {
      /* fall through to the generic message */
    }
  }
  return { message: 'The invoice could not be saved.' };
}

/** Approval execution: ONE revenue CREATE through the served write path, as the caller (ADR-0079 §4). */
export async function runDraftInvoice(input: unknown, ctx: DeputyContext): Promise<unknown> {
  const v = validatePreparedDraft(input);
  if (v.ok === false) return { error: v.error };
  const fns = asFunctions(ctx.supabase);
  if (!fns) return { error: 'The invoice could not be saved.' };
  const p = v.value;
  const body = {
    domain: 'revenue',
    operation: 'create', // NFR-AIN-SEC-003: the ONLY operation this tool may ever send.
    record: {
      ...salesInvoiceCreateFields({
        customerId: p.customerId,
        projectId: p.projectId,
        items: p.items,
        ...(p.reference_number ? { reference_number: p.reference_number } : {}),
      }),
      id: p.commandId,
    },
    idempotencyKey: p.idempotencyKey,
  };
  let out: { data: unknown; error: unknown };
  try {
    out = await withTimeout(fns.functions.invoke('adapter-dispatch', { body }), DRAFT_INVOICE_DISPATCH_TIMEOUT_MS);
  } catch {
    return { error: 'ERPNext did not answer in time. The draft may still appear — check Sales Invoices before asking again.', code: 'external-unreachable' };
  }
  if (out.error) {
    const { message, code } = await readDispatchError(out.error);
    return { error: message, ...(code ? { code } : {}) };
  }
  const canonical = (out.data as { canonical?: { id?: unknown; si_number?: unknown } } | null)?.canonical;
  const siNumber = typeof canonical?.si_number === 'string' ? canonical.si_number : null;
  return {
    ok: true,
    status: 'Draft',
    id: typeof canonical?.id === 'string' ? canonical.id : p.commandId,
    siNumber,
    link: siNumber ? `/sales-invoices?q=${encodeURIComponent(siNumber)}` : '/sales-invoices',
    note: "Saved as a Draft under the user's name. It is NOT submitted; a different Finance or Admin user submits it.",
  };
}

export const draftInvoiceAction: AgentAction & {
  validate: typeof validateDraftRequest;
  summarize: (i: unknown) => string;
} = {
  name: 'draft_invoice',
  description:
    'Prepare a DRAFT sales invoice for a work order or project milestone, for the user to confirm. Saves as Draft only — never submits or approves.',
  inputSchema: DRAFT_INVOICE_SCHEMA,
  surfaces: ['agent'],
  confirm: true,
  needsApproval: () => true,
  validate: validateDraftRequest,
  prepare: (input, ctx) => prepareDraftInvoice(input as DraftInvoiceRequest, ctx),
  validatePrepared: validatePreparedDraft,
  // Only reached if a caller bypasses `prepare` — the handler always uses prepare's summary.
  summarize: () => 'Save a draft invoice. Not submitted.',
  run: runDraftInvoice,
};
