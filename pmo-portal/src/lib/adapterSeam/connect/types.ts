/**
 * The connect-time contract (ECA spec §6.2), in PMO terms only. ERPNext and Odoo each implement `ConnectAdapter`;
 * the shared census, matcher and sends call it and never branch on the tier (FR-ECA-053). Relative imports only so
 * the seam stays Deno-importable.
 */

export type MasterKind = 'party' | 'contact' | 'item' | 'project' | 'employee' | 'account';

/** One ERP master record, normalised. `externalId` is opaque above the adapter. */
export interface NormalisedMaster {
  kind: MasterKind;
  externalId: string;
  role?: 'client' | 'vendor';
  taxId?: string | null;
  code?: string | null;
  name: string;
  active: boolean;
  /** The ERP marks this party as PMO's own organisation: never brought in (FR-ENA-090). */
  internal?: boolean;
}

/** A PMO master record to send to the ERP. `code` is the project number or item code. */
export interface PmoMaster {
  id: string;
  name: string;
  role?: 'client' | 'vendor';
  taxId?: string | null;
  code?: string | null;
  /** Archived records are not candidates (ECA-2). Default true. */
  active?: boolean;
  /** The PMO unit of an item, mapped to the ERP's unit by the adapter. */
  unit?: string | null;
}

export interface ConnectAdapter {
  readonly tier: string;
  /** One page of a kind, keyset-paged; `nextCursor` is null on the last page. */
  listMasters(kind: MasterKind, cursor: string | null): Promise<{ rows: NormalisedMaster[]; nextCursor: string | null }>;
  /** Census, read-only: how many records `listMasters` would page through. */
  countDomain(domain: string): Promise<number>;
  /** Lookup-then-create: a retry with the same record finds the first attempt's document instead of creating another. */
  sendMaster(kind: MasterKind, record: PmoMaster, key: string): Promise<{ externalId: string }>;
  /** False for a kind this ERP cannot create yet: setup proposes no send for it. Absent means it can. */
  canSend?(kind: MasterKind): boolean;
}

export type MatchKey = 'tax' | 'code' | 'name';
export type ReviewReason = 'ambiguous' | 'tax-conflict' | 'rejected';
export type MatchOutcome =
  | { outcome: 'link'; pmoId: string; externalId: string; key: MatchKey }
  | { outcome: 'bring-in'; externalId: string }
  | { outcome: 'send'; pmoId: string }
  | { outcome: 'review'; pmoIds: string[]; externalIds: string[]; reason: ReviewReason };
export type Scenario = 'none' | 'S-A' | 'S-C' | 'S-D'; // 'none' = both sides empty
/** FR-ECA-001: money domains are counted on both sides too. */
export type CensusDomain = 'budget' | 'purchase' | 'invoice' | 'receipt' | 'payment' | 'timesheet';
/** `erpCount`/`scenario` null = this ERP cannot count the domain yet (shown as "not checked", never as 0). */
export interface CensusRow { kind: MasterKind | CensusDomain; pmoCount: number; erpCount: number | null; scenario: Scenario | null }
