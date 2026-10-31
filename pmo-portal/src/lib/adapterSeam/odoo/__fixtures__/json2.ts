// Synthetic shapes recorded from the stock Odoo 20 bed (S0). Values are invented; keys and types are real.
export const ERR_404_JSON = { name: 'werkzeug.exceptions.NotFound', message: 'x', arguments: ['x', 404], context: {}, debug: '', timestamp: 0 };
// Unknown model and unknown method share `name`; only `message` differs.
export const ERR_404_UNKNOWN_MODEL = { ...ERR_404_JSON, message: "the model 'x.y' does not exist" };
export const ERR_404_UNKNOWN_METHOD = { ...ERR_404_JSON, message: "The method 'x.y.z' does not exist" };
// Bad, revoked and expired keys are all the same 401 body.
export const ERR_401_JSON = { ...ERR_404_JSON, name: 'werkzeug.exceptions.Unauthorized', message: 'Invalid apikey', arguments: ['Invalid apikey', 401] };
export const ERR_USER_ERROR_422 = { ...ERR_404_JSON, name: 'odoo.exceptions.UserError', message: 'x', arguments: ['x', 422] };
export const ERR_ACCESS_ERROR = { ...ERR_404_JSON, name: 'odoo.exceptions.AccessError', message: 'You are not allowed to access x' };

export const COMPANY_ROWS = [{ id: 1, name: 'Contoh Konstruksi', currency_id: [12, 'IDR'], write_date: '2026-10-31 01:02:03' }];
export const VERSION_INFO = { jsonrpc: '2.0', id: null, result: { server_version: '20.0', server_version_info: [20, 0, 0, 'final', 0, ''], server_serie: '20.0' } };

export const PRODUCT_FIELDS_TYPES = { default_code: 'char', purchase_ok: 'boolean', sale_ok: 'boolean', is_storable: 'boolean', type: 'selection', uom_id: 'many2one', active: 'boolean' };
export const PRODUCT_READBACK = { id: 7, default_code: 'ITM-1', type: 'consu', is_storable: false, uom_id: [1, 'Units'], purchase_ok: true, sale_ok: true };

export const PARTNER_FIELDS_TYPES = { is_company: 'boolean', parent_id: 'many2one', vat: 'char', ref: 'char', active: 'boolean', supplier_rank: 'integer', customer_rank: 'integer', property_payment_term_id: 'many2one' };
export const PARTNER_CREATED_RANKS = { supplier_rank: 0, customer_rank: 0 };

export const UOM_ROWS = [{ id: 1, name: 'Units', relative_factor: 1, relative_uom_id: false, active: true }, { id: 2, name: 'Dozens', relative_factor: 12, relative_uom_id: [1, 'Units'], active: true }];

// account.account: `company_ids` (many2many), no `company_id`, no `deprecated`.
export const ACCOUNT_TYPES = ['asset_receivable', 'asset_cash', 'asset_current', 'asset_non_current', 'asset_prepayments', 'asset_fixed', 'liability_payable', 'liability_credit_card', 'liability_current', 'liability_non_current', 'equity', 'equity_unaffected', 'income', 'income_other', 'expense', 'expense_other', 'expense_depreciation', 'expense_direct_cost', 'off_balance'];
export const ANALYTIC_PLAN_ROWS = [{ id: 1, name: 'Project Plan', parent_id: false }];
export const ANALYTIC_ACCOUNT_CREATE_RESULT = [42];
export const PARTNER_CREATE_RESULT = [43];
export const TAX_ROWS = [{ id: 5, name: '12%', amount: 12, type_tax_use: 'purchase', active: true, company_id: [1, 'Contoh Konstruksi'] }];

// search_count takes a required `domain` argument (422 without).
export const SEARCH_COUNT_RESULT = 14;
