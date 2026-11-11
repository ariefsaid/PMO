/** Synthetic JSON-2 shapes observed on the Odoo Community revenue bed (#1506 C0). Invented values only. */
export const INVOICE_DRAFT_READ = {
  id: 501,
  state: 'draft',
  name: false,
  amount_untaxed: 1000,
  amount_tax: 110,
  amount_total: 1110,
  amount_residual: 1110,
  payment_state: 'not_paid',
};

export const INVOICE_POSTED_READ = { ...INVOICE_DRAFT_READ, state: 'posted', name: 'INV/2026/00001' };

export const INVOICE_PAID_READ = { ...INVOICE_POSTED_READ, amount_residual: 0, payment_state: 'paid' };

export const INVOICE_PARTIAL_READ = { ...INVOICE_POSTED_READ, amount_residual: 710, payment_state: 'partial' };

/** A zero-total invoice posts and reads paid. A negative-total post is refused with INVOICE_POST_ERROR. */
export const INVOICE_ZERO_POSTED_READ = {
  ...INVOICE_POSTED_READ,
  amount_untaxed: 0,
  amount_tax: 0,
  amount_total: 0,
  amount_residual: 0,
  payment_state: 'paid',
};

/** One tax line per tax; the product line carries the posted account. */
export const INVOICE_LINES = [
  { id: 1, display_type: 'product', tax_ids: [5], account_id: [149, 'Sales'], price_unit: 1000, balance: -1000, analytic_distribution: { '4': 100 } },
  { id: 2, display_type: 'tax', tax_ids: [], account_id: [122, 'VAT Sales'], price_unit: 0, balance: -110 },
  { id: 3, display_type: 'payment_term', tax_ids: [], account_id: [57, 'Account Receivable'], price_unit: 0, balance: 1110 },
];

/** The effective 11% sale tax carries the name "12% (Non-Luxury Good)" in the stock Indonesian chart. */
export const SALE_TAXES = [
  { id: 5, name: '12% (Non-Luxury Good)', amount: 11, amount_type: 'percent', price_include: false },
  { id: 7, name: '12%', amount: 12, amount_type: 'percent', price_include: false },
  { id: 10, name: '0%', amount: 0, amount_type: 'percent', price_include: false },
];

export const PAYMENT_READ = {
  id: 601,
  state: 'paid',
  amount: 1110,
  memo: 'synthetic memo',
  payment_reference: false,
  is_reconciled: false,
  is_matched: false,
  move_id: [701, 'PBNK1/2026/00001'],
};

/** account.payment.register action_create_payments returns an act_window dict. */
export const REGISTER_PAYMENT_ACTION = {
  name: 'Payments',
  type: 'ir.actions.act_window',
  res_model: 'account.payment',
  context: { create: false },
  view_mode: 'form',
  res_id: 601,
};

/** The credit note from the reversal wizard: out_refund, draft, linked to the original. */
export const CREDIT_NOTE_READ = { move_type: 'out_refund', state: 'draft', reversed_entry_id: [501, 'INV/2026/00001'], amount_total: 1110, ref: 'Reversal of: INV/2026/00001, synthetic credit note' };

/** download_efaktur returns a session URL, not a file; the document is read through ir.attachment `raw`. */
export const CORETAX_EXPORT_ACTION = { type: 'ir.actions.act_url', url: '/l10n_id_efaktur_coretax/download_attachments/301' };

export const CORETAX_ATTACHMENT_READ = { id: 301, mimetype: 'application/xml', file_size: 1486, type: 'binary', res_model: 'l10n_id_efaktur_coretax.document' };

export const CORETAX_ATTACHMENT_RAW = { id: 301, raw: { filename: 'efaktur_2026-11-02_00:00:00.xml', content: 'PD94bWw=', size: 1486 } };

/** Tax-invoice facts an Odoo 20 Community invoice exposes. There is no tax-invoice number or status field. */
export const INVOICE_TAX_DOCUMENT_FACTS = {
  l10n_id_kode_transaksi: '04',
  l10n_id_coretax_efaktur_available: true,
  l10n_id_coretax_document: false,
  l10n_id_coretax_add_info_07: false,
  l10n_id_coretax_facility_info_07: false,
};

/** Failure body: six keys; classify on `name`, never echo `message`. */
export const INVOICE_POST_ERROR = {
  name: 'odoo.exceptions.UserError',
  message: 'synthetic validation message',
  arguments: ['synthetic validation message'],
  timestamp: 1793660040,
  context: {},
  debug: 'synthetic traceback',
};

/** HTTP status per exercised failure class. */
export const ERROR_STATUS_BY_CLASS = {
  'odoo.exceptions.UserError': 422,
  'odoo.exceptions.ValidationError': 422,
  'odoo.exceptions.MissingError': 404,
  'odoo.exceptions.AccessError': 403,
  'werkzeug.exceptions.NotFound': 404,
} as const;

/** The anchor decision from C0-T2 (see plan section 1 and the research doc). */
export const ODOO_REVENUE_ANCHOR_VERDICT = {
  invoice: { primary: 'external-identifier', probe: 'composite-hold-on-doubt', notChosen: ['ref', 'payment_reference', 'invoice_origin', 'narration'] },
  payment: { primary: 'external-identifier', probe: 'composite-hold-on-doubt', notChosen: ['memo', 'payment_reference'] },
} as const;
