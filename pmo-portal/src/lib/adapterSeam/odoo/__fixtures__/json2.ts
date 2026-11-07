/**
 * Synthetic Odoo JSON-2 response shapes, as recorded on the dev bed (docs/research/2026-10-31-odoo20-dev-bed-verification.md
 * §1). Shapes only, never data from a real instance.
 */

/** 404 for an unknown method or model: the JSON error body (`timestamp` is extra on v20). */
export const ERR_404_JSON = {
  name: 'werkzeug.exceptions.NotFound',
  message: '404 Not Found',
  arguments: ['404 Not Found', 'The requested URL was not found'],
  timestamp: 0,
  context: {},
  debug: '',
};

/**
 * Ledger shapes recorded on the dev bed for #1507 S0 (docs/research/2026-10-31-odoo20-dev-bed-verification.md §11).
 * Invented values, real shapes: many2one = [id, name]; `false` for an empty many2one or analytic key;
 * `move_name` is `false` while the move is a draft; write_date is `YYYY-MM-DD HH:MM:SS` UTC.
 */
export const LEDGER_LINE_POSTED_EXPENSE = {
  id: 2739,
  date: '2026-11-03',
  parent_state: 'posted',
  debit: 100.01,
  credit: 0,
  balance: 100.01,
  account_id: [301, '60100000 Contract labour'],
  move_id: [6170, 'BILL/2026/11/0001'],
  move_name: 'BILL/2026/11/0001',
  journal_id: [12, 'Vendor Bills'],
  partner_id: [88, 'PT Mitra Logam'],
  company_id: [7, 'PT Sinar Baja'],
  currency_id: [14, 'IDR'],
  amount_currency: 100.01,
  analytic_distribution: { '157': 60, '158': 40 },
  write_date: '2026-11-07 05:02:44',
  display_type: 'product',
  account_type: 'expense',
};
/** Same line while the bill is a draft: `move_name` is `false`. */
export const LEDGER_LINE_DRAFT = { ...LEDGER_LINE_POSTED_EXPENSE, parent_state: 'draft', move_name: false };
/** Payable counterpart line: no distribution, `display_type` payment_term, credit side. */
export const LEDGER_LINE_PAYABLE = {
  ...LEDGER_LINE_POSTED_EXPENSE,
  id: 2743,
  debit: 0,
  credit: 200.01,
  balance: -200.01,
  amount_currency: -200.01,
  account_id: [330, '21100000 Accounts payable'],
  analytic_distribution: false,
  display_type: 'payment_term',
  account_type: 'liability_payable',
};
/** A multi-plan key and an over/under-100 distribution are stored verbatim. */
export const LEDGER_DISTRIBUTION_FORMS = [{ '157,159': 100 }, { '157': 50 }, { '157': 150 }, { '157': 33.33, '158': 66.67 }];
/** `formatted_read_group` over `account.move.line`, groupby account_id and date:month. */
export const LEDGER_GROUPED_READ = [
  {
    account_id: [301, '60100000 Contract labour'],
    'date:month': ['2026-11-01', 'November 2026'],
    __extra_domain: ['&', '&', ['account_id', '=', 301], ['date', '>=', '2026-11-01'], ['date', '<', '2026-12-01']],
    'debit:sum': 180.01,
    'credit:sum': 0,
  },
];
/** `read_group` with `fields` is refused; `_read_group` is private. */
export const LEDGER_READ_GROUP_422 = { ...ERR_404_JSON, name: 'werkzeug.exceptions.UnprocessableEntity', message: "got an unexpected keyword argument 'fields'" };
export const LEDGER_PRIVATE_METHOD_403 = { ...ERR_404_JSON, name: 'odoo.exceptions.AccessError', message: "Private methods (such as 'account.move.line._read_group') cannot be called remotely." };
/** Unlink of a posted move: 422 UserError. */
export const LEDGER_DELETE_POSTED_422 = { ...ERR_404_JSON, name: 'odoo.exceptions.UserError', message: "You can't delete a posted journal item." };
