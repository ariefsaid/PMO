/**
 * #1515 §9 — the canonical site-cash transfer (`imprest.transfer`): head office bank → a float's cash account, once per
 * key. PMO terms only; each ERP adapter maps it to its own document (ERPNext: Journal Entry; Odoo: #1509).
 */
export interface ImprestTransfer {
  /** `impt:<replenishment uuid>:<paid_at epoch ms>` — the ADR-0058 idempotency key and the ERP anchor. */
  key: string;
  fromAccount: string;
  toAccount: string;
  /** 2-decimal string, > 0. */
  amount: string;
  /** YYYY-MM-DD, org timezone. */
  date: string;
  reference: string;
}

export const IMPREST_TRANSFER_KEY_RE = /^impt:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9]{4,20}$/;
const MONEY = /^\d{1,12}\.\d{2}$/;

export function assertImprestTransfer(t: ImprestTransfer): ImprestTransfer {
  if (!IMPREST_TRANSFER_KEY_RE.test(t.key)) throw new Error(`imprest.transfer: bad key ${t.key}`);
  if (!MONEY.test(t.amount) || Number(t.amount) <= 0) throw new Error(`imprest.transfer: bad amount ${t.amount}`);
  if (!t.fromAccount || !t.toAccount || t.fromAccount === t.toAccount) throw new Error('imprest.transfer: the two accounts must differ');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t.date)) throw new Error(`imprest.transfer: bad date ${t.date}`);
  return t;
}
