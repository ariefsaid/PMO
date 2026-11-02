/** Synthetic JSON-2 shapes observed on the Odoo Community purchase bed. */
export const PURCHASE_ORDER = {
  id: 101,
  name: 'P00001',
  state: 'purchase',
  amount_total: 100,
  origin: 'po:synthetic',
  order_line: [201],
  picking_ids: [301],
  invoice_status: 'to invoice',
  write_date: '2026-01-01 00:00:00',
};

export const INCOMING_TRANSFER = {
  id: 301,
  state: 'done',
  origin: 'gr:synthetic',
  move_ids: [401],
  backorder_id: false,
  write_date: '2026-01-01 00:00:00',
};

export const STOCK_MOVE = { id: 401, product_uom_qty: 6, quantity: 6, state: 'done' };

export const BACKORDER_ACTION = {
  type: 'ir.actions.act_window',
  res_model: 'stock.backorder.confirmation',
  context: { button_validate_picking_ids: [301], default_show_transfers: false, default_pick_ids: [[4, 301]] },
};

export const VENDOR_BILL = {
  id: 501,
  move_type: 'in_invoice',
  state: 'posted',
  invoice_origin: 'bill:synthetic',
  amount_untaxed: 100,
  amount_tax: 9,
  amount_total: 109,
  amount_residual: 109,
  payment_state: 'not_paid',
  write_date: '2026-01-01 00:00:00',
};

export const BILL_TAX_LINES = [
  { id: 601, tax_line_id: [701, 'Synthetic VAT'], tax_base_amount: 100, balance: 11 },
  { id: 602, tax_line_id: [702, 'Synthetic withholding'], tax_base_amount: 100, balance: -2 },
];

export const SUPPLIER_PAYMENT = {
  id: 801,
  payment_type: 'outbound',
  partner_type: 'supplier',
  state: 'paid',
  amount: 40,
  memo: 'pay:synthetic',
  move_id: [901, 'Synthetic payment'],
  write_date: '2026-01-01 00:00:00',
};

export const VALIDATION_ERROR = {
  name: 'odoo.exceptions.ValidationError',
  message: 'Synthetic validation error',
  arguments: ['Synthetic validation error'],
  timestamp: 0,
  context: {},
  debug: '',
};

export const EXTERNAL_IDENTIFIER = {
  id: 1001,
  module: 'pmo_probe',
  name: 'synthetic_key',
  model: 'purchase.order',
  res_id: 101,
};
