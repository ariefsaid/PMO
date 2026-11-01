/**
 * The seam every ERP adapter plugs into to run the shared suites (spec §6.2). PMO terms only: a harness
 * translates these calls into its own tier's wire format over a mocked transport and translates the outcome
 * back. A suite never imports a tier, so the same assertions run for ERPNext and Odoo.
 */
import type { ConnectAdapter, MasterKind, NormalisedMaster } from '../connect/types.ts';

export type PartyRole = 'client' | 'vendor';

/** A party as the ERP holds it. `externalId` is opaque to the suite. */
export interface ErpPartyInput {
  role: PartyRole;
  externalId: string;
  name: string;
  taxId?: string | null;
  /** The ERP flags this party as PMO's own organisation. */
  internal?: boolean;
}

/** A PMO company the party might already be. */
export interface PmoPartyCandidate {
  pmoId: string;
  taxId: string | null;
}

export type PartyMatchResult =
  | { outcome: 'link'; pmoId: string; externalId: string; role: PartyRole }
  | { outcome: 'bring-in'; externalId: string; role: PartyRole }
  | { outcome: 'review' }
  | { outcome: 'refused' };

export type ProjectLinkResult = { status: 'linked'; pmoProjectId: string } | { status: 'ambiguous' } | { status: 'none' };

/** A budget push meeting what the ERP already holds for the same project, account and year. */
export interface BudgetPushScenario {
  account: string;
  fiscalYear: string;
  /** Documents already live on that grain, none created by PMO. */
  occupant: 'none' | 'one-live' | 'two-live' | 'draft';
}

export interface BudgetPushResult {
  outcome: 'pushed' | 'refused';
  /** The classified refusal code when refused. */
  code?: string;
  message?: string;
  /** Create or update calls that reached the ERP. */
  erpWrites: number;
}

export interface PushBeforeConnectionResult {
  outcome: 'pushed' | 'refused';
  code?: string;
  /** Calls of any kind that reached the ERP. */
  erpCalls: number;
}

/** A fresh fake ERP behind a `ConnectAdapter`, for the master-send suites (ECA §6.2). */
export interface ConnectHarness {
  adapter: ConnectAdapter;
  /** What the fake ERP now holds for a kind, normalised to PMO terms, read without going through `adapter`. */
  documents(kind: MasterKind): NormalisedMaster[];
  /** The next create or update fails: before it reaches the ERP (`transport`), or after the ERP applied it (`lost-response`). */
  failNextWrite(fault: 'transport' | 'lost-response'): void;
}

/** An ERP invoice as the ERP states it, in PMO terms. `total` is the tax-inclusive grand total. */
export interface InboundInvoiceDoc {
  client: string;
  number: string;
  poRef: string | null;
  total: string;
  taxAmount: string;
  date: string;
  currency: string;
}

export interface ErpHarness {
  readonly tier: string;
  /** party.match */
  matchParty(party: ErpPartyInput, existing: readonly PmoPartyCandidate[]): Promise<PartyMatchResult>;
  /** party.bring-in: apply ERP parties to a PMO store that enforces uniqueness like the database (one ref per
   *  external id, one company id). Each call starts an empty store seeded with `existing`. */
  bringIn?: (parties: readonly ErpPartyInput[], existing: readonly PmoPartyCandidate[], runs?: number) =>
    Promise<{ companies: number; refs: number; linked: string[]; review: number }>;
  /** project.match: `links` maps PMO project id to the ERP project name it is linked to. */
  resolveProjectLink(links: Readonly<Record<string, unknown>> | undefined, erpProjectName: string): ProjectLinkResult;
  /** budget.unowned-occupant */
  pushBudget(scenario: BudgetPushScenario): Promise<BudgetPushResult>;
  /** cutover.activation: a purchase push on a connection that is `activated` or not. */
  pushPurchase(connection: 'activated' | 'not-activated' | 'absent'): Promise<PushBeforeConnectionResult>;
  /** party.send, project.send, item.send: each call starts an empty fake ERP. Absent until the tier sends masters. */
  connect?: () => ConnectHarness;
  /** invoice.pair-existing: the tier's inbound mapper applied to an ERP invoice; the row the feed writes, in PMO column names. */
  mapInboundInvoice?: (doc: InboundInvoiceDoc) => Promise<Record<string, unknown>>;
  /** imprest.transfer: each call starts an empty fake ERP. Absent until the tier posts site cash. */
  transfer?: () => TransferHarness;
}

export interface TransferHarness {
  post(t: import('../imprestTransfer.ts').ImprestTransfer): Promise<{ externalId: string }>;
  /** Plant a document the ERP already holds under another key (nothing PMO posted). */
  seed(t: import('../imprestTransfer.ts').ImprestTransfer): void;
  /** Ledger lines the fake ERP now holds for the key, normalised: account, debit and credit as 2-decimal strings. */
  lines(key: string): Array<{ account: string; debit: string; credit: string }>;
  documents(): Array<{ externalId: string; key: string }>;
  failNextWrite(fault: 'transport' | 'lost-response'): void;
}

export type Suite = (harness: ErpHarness) => void;
