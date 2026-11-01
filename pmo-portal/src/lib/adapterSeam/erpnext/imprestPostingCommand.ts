/**
 * #1515 §9 — the replenishment posting: gate truth + resolved refs → the frozen outbox payload of an `imprest-transfer`
 * Journal Entry (head office bank → the float's cash account). The record is persisted VERBATIM as the outbox payload.
 */
import { AdapterError } from '../contract.ts';
import { imprestTransferKey } from './imprestTransferKey.ts';

/** What `imprest_posting_for_push` (0425 §3) returns — DB truth, never a payload. */
export interface ImprestGateTruth {
  mirror_id: string;
  posting_identity: string;
  subject_id: string;
  number: string;
  kind: string;
  amount: string;
  currency: string;
  float_id: string;
  float_cash_account: string;
  reference: string;
  state_stamp: string;
  posting_date: string;
  actor_id: string;
}

/** The head office side, resolved from the binding before the outbox row exists. */
export interface ImprestResolvedRefs {
  company: string;
  headOfficeAccount: string;
}

const GATE_MONEY = /^\d{1,12}\.\d{2}$/;
const GATE_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Check the gate's jsonb before anything is built from it: a money body must never come from an unchecked cast. */
export function parseImprestGateTruth(data: unknown): ImprestGateTruth {
  const bad = (field: string): never => {
    throw new AdapterError('commit-rejected', `imprest-gate-truth-malformed: ${field}`);
  };
  if (typeof data !== 'object' || data === null || Array.isArray(data)) bad('not an object');
  const d = data as Record<string, unknown>;
  const text = (field: string): string => (typeof d[field] === 'string' && d[field] !== '' ? (d[field] as string) : bad(field));
  const amount = text('amount');
  if (!GATE_MONEY.test(amount)) bad('amount');
  const postingDate = text('posting_date');
  if (!GATE_DATE.test(postingDate)) bad('posting_date');
  return {
    mirror_id: text('mirror_id'), posting_identity: text('posting_identity'), subject_id: text('subject_id'), number: text('number'),
    kind: text('kind'), amount, currency: text('currency'), float_id: text('float_id'), float_cash_account: text('float_cash_account'),
    reference: text('reference'), state_stamp: text('state_stamp'), posting_date: postingDate, actor_id: text('actor_id'),
  };
}

export interface ImprestPostingCommand {
  domain: 'expenses';
  operation: 'create';
  idempotencyKey: string;
  /** The outbox / external_refs identity (`<replenishment>:replenishment`). */
  outboxIdentity: string;
  record: { id: string; erp_doc_kind: 'imprest-transfer' } & Record<string, unknown>;
}

export function buildImprestPostingCommand(truth: ImprestGateTruth, refs: ImprestResolvedRefs): ImprestPostingCommand {
  const idempotencyKey = imprestTransferKey(truth);
  return {
    domain: 'expenses', operation: 'create', idempotencyKey, outboxIdentity: truth.posting_identity,
    record: {
      id: truth.subject_id.toLowerCase(), erp_doc_kind: 'imprest-transfer', idempotency_key: idempotencyKey,
      from_account: refs.headOfficeAccount, to_account: truth.float_cash_account, amount: truth.amount,
      posting_date: truth.posting_date, reference: truth.reference, company: refs.company, outbox_identity: truth.posting_identity,
      posting_identity: truth.posting_identity,
    },
  };
}
