/**
 * The vendor-payment half of the test-only Odoo (fakeOdoo.ts), as the bed shows it (V-OPP7): a payment is a draft with its own journal
 * entry; posting gives that entry a payable line; reconciling a payment's payable line with a bill's moves the bill's residual and
 * payment state. Odoo ACCEPTS an overpayment (the surplus stays on the payment line), so refusing it is PMO's job. Reposting a
 * posted payment is accepted and changes nothing.
 */
type Row = Record<string, unknown> & { id: number };
export class RejectedPayment extends Error {}

interface Env { table(model: string): Map<number, Row>; nextId(model: string): number; stamp(): string }

const cents = (v: unknown) => Math.round(Number(v) * 100);

/** The payable line a bill carries from its creation (the payment term), credit-signed. */
export function addPayableLine(env: Env, billId: number, total: number): void {
  const id = env.nextId('account.move.line');
  env.table('account.move.line').set(id, { id, move_id: billId, display_type: 'payment_term', account_type: 'liability_payable', tax_line_id: false, balance: -total, amount_residual: -total, reconciled: false, write_date: env.stamp() });
}

export const isModelledPayment = (vals: Record<string, unknown>) => ['inbound', 'outbound'].includes(String(vals.payment_type)) && 'amount' in vals;

export function createPayment(env: Env, vals: Record<string, unknown>): number {
  if (!(Number(vals.amount) > 0)) throw new RejectedPayment('The payment amount must be strictly positive.');
  const id = env.nextId('account.payment');
  const moveId = env.nextId('account.move');
  const stamp = env.stamp();
  env.table('account.move').set(moveId, { id: moveId, active: true, move_type: 'entry', state: 'draft', name: '/', create_date: stamp, write_date: stamp });
  env.table('account.payment').set(id, { active: true, state: 'draft', name: '/', memo: false, ...vals, id, move_id: [moveId, '/'], reconciled_bill_ids: [], create_date: stamp, write_date: stamp });
  return id;
}

export function postPayment(env: Env, payment: Row): void {
  if (payment.state !== 'draft') return;   // a repeat post is accepted, with nothing to do (bed V-OPP11)
  const moveId = (payment.move_id as number[])[0];
  const move = env.table('account.move').get(moveId)!;
  Object.assign(move, { state: 'posted', name: `PBNK1/2026/${String(moveId).padStart(5, '0')}`, write_date: env.stamp() });
  Object.assign(payment, { state: 'paid', name: move.name, write_date: env.stamp() });
  const lineId = env.nextId('account.move.line');
  env.table('account.move.line').set(lineId, { id: lineId, move_id: moveId, display_type: 'payment_term', account_type: 'liability_payable', tax_line_id: false, balance: Number(payment.amount), amount_residual: Number(payment.amount), reconciled: false, write_date: env.stamp() });
}

/** `account.move.line/reconcile`: debits meet credits; each bill touched takes its new residual and payment state. */
export function reconcileLines(env: Env, rows: Row[]): void {
  if (rows.some((r) => r.reconciled === true)) throw new RejectedPayment('You are trying to reconcile some entries that are already reconciled.');
  const debits = rows.filter((r) => Number(r.amount_residual ?? r.balance) > 0);
  const credits = rows.filter((r) => Number(r.amount_residual ?? r.balance) < 0);
  for (const debit of debits) for (const credit of credits) {
    const d = cents(debit.amount_residual ?? debit.balance);
    const c = cents(credit.amount_residual ?? credit.balance);
    const applied = Math.min(d, -c);
    debit.amount_residual = (d - applied) / 100;
    credit.amount_residual = (c + applied) / 100;
  }
  for (const r of rows) Object.assign(r, { reconciled: cents(r.amount_residual) === 0, write_date: env.stamp() });
  const moves = env.table('account.move');
  const bills = [...new Set(rows.map((r) => r.move_id as number))].map((id) => moves.get(id)).filter((m): m is Row => !!m && m.move_type === 'in_invoice');
  for (const bill of bills) {
    const residual = [...env.table('account.move.line').values()].filter((l) => l.move_id === bill.id && l.account_type === 'liability_payable').reduce((sum, l) => sum + cents(l.amount_residual), 0);
    Object.assign(bill, { amount_residual: (-residual || 0) / 100, payment_state: residual === 0 ? 'paid' : -residual < cents(bill.amount_total) ? 'partial' : 'not_paid', write_date: env.stamp() });
    for (const payment of env.table('account.payment').values()) {
      if (!rows.some((r) => r.move_id === (payment.move_id as number[])[0])) continue;
      payment.reconciled_bill_ids = [...new Set([...(payment.reconciled_bill_ids as number[]), bill.id])];
      if (payment.state === 'paid' && residual === 0) payment.state = 'reconciled';   // the bed's word for a payment whose bill is settled (P6)
    }
  }
}
