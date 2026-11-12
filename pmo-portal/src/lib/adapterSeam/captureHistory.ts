/** ERP-neutral purchase-history census and reconciliation. Amounts are integer minor-unit strings. */
export type CaptureKind = 'order' | 'receipt' | 'supplier_invoice' | 'supplier_payment' | 'journal' | 'adjustment' | 'capital_spending' | 'other';
export type CaptureState = 'draft' | 'ordered' | 'received' | 'invoiced' | 'part_paid' | 'paid' | 'cancelled';

export interface CaptureDocument {
  id: string;
  projectId: string | null;
  purchaseId: string | null;
  kind: CaptureKind;
  state: CaptureState;
}

export interface CaptureLedgerLine {
  id: string;
  documentId: string | null;
  amountCents: string;
  kind: CaptureKind;
}

export interface CaptureCensus {
  projectId: string;
  currency: string;
  /** False whenever a page, account classification, or source generation could not be verified. */
  complete: boolean;
  ledger: CaptureLedgerLine[];
  documents: CaptureDocument[];
}

export interface CaptureRemainder extends CaptureLedgerLine { reason: string }
export interface CaptureReport {
  projectId: string;
  currency: string;
  complete: boolean;
  ledgerTotalCents: string | null;
  coveredTotalCents: string | null;
  remainderTotalCents: string | null;
  remainder: CaptureRemainder[];
  openOrders: CaptureDocument[];
}

/** A partial census retains its observed lines but withholds totals; absence is not proof of zero. */
export function reconcileCapture(census: CaptureCensus): CaptureReport {
  const documents = new Map<string, CaptureDocument>();
  for (const document of census.documents) {
    if (!document.id || documents.has(document.id)) throw new Error('duplicate or empty document identity');
    documents.set(document.id, document);
  }
  const seen = new Set<string>();
  const remainder: CaptureRemainder[] = [];
  let covered = 0n;
  let remaining = 0n;
  for (const line of census.ledger) {
    if (!line.id || seen.has(line.id)) throw new Error('duplicate or empty ledger identity');
    if (!/^-?\d+$/.test(line.amountCents)) throw new Error('amount must be integer minor units');
    seen.add(line.id);
    const amount = BigInt(line.amountCents);
    const document = line.documentId === null ? undefined : documents.get(line.documentId);
    if (line.kind === 'capital_spending') {
      remainder.push({ ...line, reason: 'capital_spending' });
      continue;
    }
    if (document?.purchaseId && document.projectId === census.projectId) {
      covered += amount;
      continue;
    }
    remaining += amount;
    const reason = line.kind === 'journal' ? 'journal'
      : line.kind === 'supplier_payment' ? 'payment_without_invoice'
      : document?.projectId === null ? 'no_project'
      : document ? 'not_captured' : 'other';
    remainder.push({ ...line, reason });
  }
  return {
    projectId: census.projectId,
    currency: census.currency,
    complete: census.complete,
    ledgerTotalCents: census.complete ? (covered + remaining).toString() : null,
    coveredTotalCents: census.complete ? covered.toString() : null,
    remainderTotalCents: census.complete ? remaining.toString() : null,
    remainder,
    openOrders: census.documents.filter((d) => d.projectId === census.projectId && d.purchaseId !== null && d.kind === 'order' && d.state === 'ordered'),
  };
}

/** Neutral identity and revision: only an adapter translates its own source types into these values. */
export interface CaptureSource {
  id: string;
  kind: CaptureKind;
  state: CaptureState;
  projectIds: string[];
  version: string;
  purchaseId: string | null;
  reference?: string;
  supplier?: string | null;
  supplierName?: string | null;
  date?: string | null;
  currency?: string | null;
  amount?: string | null;
  parentIds?: string[];
}
export interface CaptureProposal {
  id: string;
  version: string;
  outcome: 'propose' | 'matched' | 'remainder';
  projectId?: string;
  purchaseId?: string;
  reason?: string;
}

/** Propose only unambiguous source identities. Matching is supplied by the shared connect matcher. */
export function proposeCapture(sources: CaptureSource[], projectId: string | null): CaptureProposal[] {
  const seen = new Set<string>();
  const proposals: CaptureProposal[] = [];
  for (const source of sources) {
    if (!source.id || !source.version || seen.has(source.id)) throw new Error('missing or duplicate source identity or revision');
    seen.add(source.id);
    if (projectId && source.projectIds.length > 0 && !source.projectIds.includes(projectId)) continue;
    let reason: string | undefined;
    if (source.kind === 'capital_spending') reason = 'capital_spending';
    else if (source.state === 'cancelled') reason = 'cancelled';
    else if (source.state === 'draft') reason = 'unposted_source';
    else if (source.kind === 'journal') reason = 'journal';
    else if (source.kind === 'supplier_payment') reason = 'payment_without_invoice';
    else if (source.kind === 'adjustment') reason = 'adjustment_requires_source_link';
    else if (source.kind !== 'order' && source.kind !== 'supplier_invoice') reason = 'unsupported';
    else if (source.projectIds.length === 0) reason = 'no_project';
    else if (source.projectIds.length !== 1) reason = 'spans_projects';
    if (reason) {
      proposals.push({ id: source.id, version: source.version, outcome: 'remainder', reason });
    } else if (source.purchaseId) {
      proposals.push({ id: source.id, version: source.version, outcome: 'matched', projectId: source.projectIds[0], purchaseId: source.purchaseId });
    } else {
      proposals.push({ id: source.id, version: source.version, outcome: 'propose', projectId: source.projectIds[0] });
    }
  }
  return proposals;
}

export type CaptureSourcePage =
  | { supported: true; sources: CaptureSource[]; nextCursor: string | null; revision: string }
  | { supported: false; missing: string[] };
export interface CaptureAdapter {
  listSources(cursor: string | null): Promise<CaptureSourcePage>;
}
export interface CaptureSourceCensus { complete: boolean; sources: CaptureSource[]; missing: string[]; revision?: string }

/** Reads every page; an unavailable, failed or cyclic feed remains explicitly incomplete. */
export async function collectCaptureSources(adapter: CaptureAdapter): Promise<CaptureSourceCensus> {
  const sources: CaptureSource[] = [];
  const seen = new Set<string>();
  const sourceIds = new Set<string>();
  let cursor: string | null = null;
  let revision: string | undefined;
  try {
    do {
      const page = await adapter.listSources(cursor);
      if (!page.supported) return { complete: false, sources, missing: page.missing };
      if (!page.revision || (revision !== undefined && page.revision !== revision)) {
        return { complete: false, sources, missing: ['source generation changed'] };
      }
      revision = page.revision;
      for (const source of page.sources) {
        if (!source.id || sourceIds.has(source.id)) {
          return { complete: false, sources, missing: ['duplicate source identity'] };
        }
        sourceIds.add(source.id);
        sources.push(source);
      }
      cursor = page.nextCursor;
      if (cursor !== null && seen.has(cursor)) return { complete: false, sources, missing: ['repeated source cursor'] };
      if (cursor !== null) seen.add(cursor);
    } while (cursor !== null);
    return { complete: true, sources, missing: [], revision };
  } catch {
    return { complete: false, sources, missing: ['source read failed'] };
  }
}
