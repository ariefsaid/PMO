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
  /** Snapshot-derived actuals, excluding non-ledger charges; absent when not yet coherent. */
  expectedActualsCents?: string | null;
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
  const total = covered + remaining;
  const coherent = census.complete && typeof census.expectedActualsCents === 'string'
    && /^-?\d+$/.test(census.expectedActualsCents) && BigInt(census.expectedActualsCents) === total;
  return {
    projectId: census.projectId,
    currency: census.currency,
    complete: coherent,
    ledgerTotalCents: coherent ? total.toString() : null,
    coveredTotalCents: coherent ? covered.toString() : null,
    remainderTotalCents: coherent ? remaining.toString() : null,
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
  accountClass?: 'expense' | 'capital_spending' | 'mixed' | 'unknown';
  unavailableReason?: string;
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
    if (source.unavailableReason) reason = source.unavailableReason;
    else if (source.kind === 'capital_spending') reason = 'capital_spending';
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
export interface CaptureLedgerFact { projectId: string | null; line: CaptureLedgerLine; reason?: string }
export type CaptureLedgerPage =
  | { supported: true; lines: CaptureLedgerFact[]; nextCursor: string | null; revision: string }
  | { supported: false; missing: string[] };
export interface CaptureAdapter {
  listSources(cursor: string | null): Promise<CaptureSourcePage>;
  listLedger?(cursor: string | null): Promise<CaptureLedgerPage>;
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

/** Compare the whole reviewed census with a fresh one before attempting a write. */
export function verifyCaptureRevision(
  reviewedRevision: string,
  currentRevision: string,
  reviewed: ReadonlyArray<{ id: string; version: string }>,
  current: ReadonlyArray<{ id: string; version: string }>,
): boolean {
  if (!reviewedRevision || reviewedRevision !== currentRevision || reviewed.length !== current.length) return false;
  const versions = new Map<string, string>();
  for (const source of reviewed) {
    if (!source.id || !source.version || versions.has(source.id)) return false;
    versions.set(source.id, source.version);
  }
  const seen = new Set<string>();
  for (const source of current) {
    if (!source.id || !source.version || seen.has(source.id) || versions.get(source.id) !== source.version) return false;
    seen.add(source.id);
  }
  return true;
}

/** A ledger page must belong to the same source generation as the document census. */
export async function collectCaptureLedger(adapter: CaptureAdapter, revision: string): Promise<{ complete: boolean; lines: CaptureLedgerFact[]; missing: string[] }> {
  const lines: CaptureLedgerFact[] = [];
  const cursors = new Set<string>();
  const ids = new Set<string>();
  let cursor: string | null = null;
  if (!adapter.listLedger) return { complete: false, lines, missing: ['ledger source unsupported'] };
  try {
    do {
      const page = await adapter.listLedger(cursor);
      if (!page.supported) return { complete: false, lines, missing: page.missing };
      if (!page.revision || page.revision !== revision) return { complete: false, lines, missing: ['source generation changed'] };
      for (const fact of page.lines) {
        if (!fact.line.id || ids.has(fact.line.id)) return { complete: false, lines, missing: ['duplicate ledger identity'] };
        ids.add(fact.line.id);
        lines.push(fact);
      }
      cursor = page.nextCursor;
      if (cursor !== null && cursors.has(cursor)) return { complete: false, lines, missing: ['repeated ledger cursor'] };
      if (cursor !== null) cursors.add(cursor);
    } while (cursor !== null);
    return { complete: true, lines, missing: [] };
  } catch {
    return { complete: false, lines, missing: ['ledger read failed'] };
  }
}
