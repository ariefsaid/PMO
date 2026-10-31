/**
 * The seam every ERP adapter plugs into to run the shared suites (spec §6.2). PMO terms only: a harness
 * translates these calls into its own tier's wire format over a mocked transport and translates the outcome
 * back. A suite never imports a tier, so the same assertions run for ERPNext and Odoo.
 */

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

export interface ErpHarness {
  readonly tier: string;
  /** party.match */
  matchParty(party: ErpPartyInput, existing: readonly PmoPartyCandidate[]): Promise<PartyMatchResult>;
  /** project.match: `links` maps PMO project id to the ERP project name it is linked to. */
  resolveProjectLink(links: Readonly<Record<string, unknown>> | undefined, erpProjectName: string): ProjectLinkResult;
  /** budget.unowned-occupant */
  pushBudget(scenario: BudgetPushScenario): Promise<BudgetPushResult>;
  /** cutover.activation: a purchase push on a connection that is `activated` or not. */
  pushPurchase(connection: 'activated' | 'not-activated' | 'absent'): Promise<PushBeforeConnectionResult>;
}

export type Suite = (harness: ErpHarness) => void;
