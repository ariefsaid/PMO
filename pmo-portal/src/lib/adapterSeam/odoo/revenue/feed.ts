/** The Odoo revenue feed's models, filters, fields and row parser (FR-OCI-080/081/084). */
import type { OdooCall } from '../client.ts';
import { companyDomain, type DirectoryRow, type KindSpec } from '../kinds.ts';
import type { KindReaders } from '../sweep.ts';
import { keyFromExternalIdentifier } from './anchors.ts';
import { creditNoteStatus, invoiceStatus, paymentStatus } from './status.ts';

export const REVENUE_FEED_DOMAINS = ['sales-invoice', 'credit-note', 'incoming-payment'] as const;
export type RevenueFeedDomain = (typeof REVENUE_FEED_DOMAINS)[number];

type Raw = Record<string, unknown>;
const WRITE_DATE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const m2o = (value: unknown): string | null | undefined =>
  value === false || value == null ? null : Array.isArray(value) && typeof value[0] === 'number' ? String(value[0]) : undefined;
const m2oName = (value: unknown): string | null | undefined =>
  value === false || value == null ? null : Array.isArray(value) && typeof value[0] === 'number' && typeof value[1] === 'string' ? value[1] : undefined;
const text = (value: unknown): string | null => typeof value === 'string' && value !== '' ? value : null;
const money = (value: unknown): string | null => typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : null;
const day = (value: unknown): string | null => typeof value === 'string' && DAY.test(value) ? value : null;

export interface RevenueFeedSpec extends KindSpec {
  domain: RevenueFeedDomain;
  filter: unknown[];
  anchored: boolean;
}

function docstatus(state: string, domain: RevenueFeedDomain): 0 | 1 | 2 | null {
  if (state === 'draft') return 0;
  if (domain === 'incoming-payment') {
    const payment = paymentStatus(state);
    if (payment.cancelled) return 2;
    return payment.status === 'Posted' ? 1 : null;
  }
  if (state === 'posted' || state === 'paid' || state === 'in_process') return 1;
  if (state === 'cancel' || state === 'cancelled' || state === 'canceled') return 2;
  return null;
}

function parseRow(spec: RevenueFeedSpec, raw: Raw): DirectoryRow | null {
  if (typeof raw.id !== 'number' || !Number.isSafeInteger(raw.id) || raw.id <= 0 || typeof raw.name !== 'string' || !raw.name
    || typeof raw.write_date !== 'string' || !WRITE_DATE.test(raw.write_date) || typeof raw.state !== 'string') return null;
  if (spec.domain === 'sales-invoice' && raw.move_type !== 'out_invoice') return null;
  if (spec.domain === 'credit-note' && raw.move_type !== 'out_refund') return null;
  const partner = m2o(raw.partner_id);
  const partnerName = m2oName(raw.partner_id);
  const statusCode = docstatus(raw.state, spec.domain);
  if (partner === undefined || partnerName === undefined || statusCode === null) return null;

  const attrs: Record<string, unknown> = {
    state: raw.state,
    docstatus: statusCode,
    partner,
    partner_name: partnerName,
    date: day(raw.invoice_date ?? raw.date),
    due_date: day(raw.invoice_date_due),
    reference_number: text(raw.ref),
    currency: Array.isArray(raw.currency_id) && typeof raw.currency_id[1] === 'string' ? raw.currency_id[1] : null,
    anchor_key: text(raw._anchor),
  };

  if (spec.domain === 'sales-invoice' || spec.domain === 'credit-note') {
    const total = money(raw.amount_total), untaxed = money(raw.amount_untaxed), tax = money(raw.amount_tax), residual = money(raw.amount_residual);
    Object.assign(attrs, {
      amount_total: total,
      amount_untaxed: untaxed,
      amount_tax: tax,
      residual,
      status: spec.domain === 'credit-note'
        ? (creditNoteStatus(raw.state).status ?? 'Draft')
        : (statusCode === 0 ? 'Submitted' : residual === null ? null : invoiceStatus(raw.state, residual).status),
    });
    if (spec.domain === 'credit-note') {
      const reversed = m2o(raw.reversed_entry_id);
      if (reversed === undefined) return null;
      attrs.reversed_entry_ref = reversed === null ? null : `account.move:${reversed}`;
    }
  } else {
    const paymentType = text(raw.payment_type), partnerType = text(raw.partner_type);
    if (paymentType !== 'inbound' || partnerType !== 'customer') return null;
    const amount = money(raw.amount);
    const payment = paymentStatus(raw.state);
    Object.assign(attrs, {
      amount,
      status: payment.cancelled ? 'Cancelled' : payment.status === 'Posted' ? 'Paid' : 'Scheduled',
      payment_type: paymentType,
      partner_type: partnerType,
    });
  }

  return {
    external_id: String(raw.id), code: null, name: raw.name, parent_external_id: null,
    active: true, attrs, source_write_date: raw.write_date,
  };
}

const moveFields = ['move_type','name','state','partner_id','invoice_date','invoice_date_due','ref','currency_id',
  'amount_total','amount_untaxed','amount_tax','amount_residual','reversed_entry_id','write_date'];
const paymentFields = ['name','state','partner_id','payment_type','partner_type','amount','date','currency_id','write_date'];
const createSpec = (domain: RevenueFeedDomain, model: string, fields: string[], company: 'company_id', filter: unknown[], anchored: boolean): RevenueFeedSpec => {
  const spec: RevenueFeedSpec = { domain, model, fields, company, filter, anchored, parse: (raw) => parseRow(spec, raw) };
  return spec;
};

export const REVENUE_FEED_SPECS: Record<RevenueFeedDomain, RevenueFeedSpec> = {
  'sales-invoice': createSpec('sales-invoice', 'account.move', moveFields, 'company_id', [['move_type','=','out_invoice']], true),
  'credit-note': createSpec('credit-note', 'account.move', moveFields, 'company_id', [['move_type','=','out_refund']], false),
  'incoming-payment': createSpec('incoming-payment', 'account.payment', paymentFields, 'company_id', [['payment_type','=','inbound'],['partner_type','=','customer']], true),
};

async function withAnchors(call: OdooCall, spec: RevenueFeedSpec, rows: Raw[]): Promise<Raw[]> {
  if (!spec.anchored || rows.length === 0) return rows;
  const ids = rows.map((row) => row.id).filter((id): id is number => typeof id === 'number');
  if (ids.length === 0) return rows;
  const records = await call<Array<{ res_id: number; name: string }>>('ir.model.data','search_read', {
    domain: [['module','=','pmo'],['model','=',spec.model],['res_id','in',ids]], fields: ['res_id','name'],
  });
  const anchors = new Map<number,string>();
  for (const record of records) {
    const key = keyFromExternalIdentifier(record.name);
    if (key) anchors.set(record.res_id,key);
  }
  return rows.map((row) => ({ ...row, ...(anchors.has(row.id as number) ? { _anchor: anchors.get(row.id as number) } : {}) }));
}

/** Reader adapter shared by runKind and runCensus; the activated company always scopes both APIs. */
export function revenueFeedReaders(call: OdooCall, spec: RevenueFeedSpec, companyId: number): KindReaders {
  const scope = [...spec.filter, ...companyDomain(spec, companyId)];
  const context = { active_test: false, lang: 'en_US' };
  return {
    read: async (domain, order, limit) => withAnchors(call, spec,
      await call<Raw[]>(spec.model,'search_read',{ domain: [...domain,...scope], fields: ['id',...spec.fields], order, limit, context })),
    readIds: (afterId, limit) => call<number[]>(spec.model,'search',{ domain: [['id','>',afterId],...scope], order: 'id asc', limit, context }),
  };
}
