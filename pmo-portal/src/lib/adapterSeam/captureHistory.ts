/** Neutral read-only history. Evidence must come from a server-authorized scoped reader, never a request payload. */
export type CaptureKind = 'order' | 'receipt' | 'supplier_invoice' | 'supplier_payment' | 'journal' | 'adjustment' | 'other';
export type CaptureState = 'draft' | 'ordered' | 'received' | 'invoiced' | 'part_paid' | 'paid' | 'cancelled' | 'unknown';
export interface CaptureLine { id: string; description: string | null; projectShares: ReadonlyArray<{ projectId: string; amountMinor: string | null }> }
export interface CaptureSource {
  id: string; sourceId: string; version: string; kind: CaptureKind; state: CaptureState; projectIds: string[];
  supplierId: string | null; currency: string | null; faceMinor: string | null; faceScale: number | null; familyId: string | null; purchaseId: string | null; purchaseOrigin?: 'ordinary' | 'captured' | 'erp_link' | null;
  reference?: string | null; supplierReference?: string | null; supplierName?: string | null; date?: string | null; description?: string | null; lines?: CaptureLine[] | null; missing?: string[];
}
export interface CaptureLedgerLine { id: string; sourceId: string; currency: string; projectId: string | null; documentId: string | null; amountMinor: string; kind: CaptureKind; classification: 'mapped' | 'capital_spending' | 'overhead' | 'unmapped' | 'unknown' }
export interface CaptureScope { sourceId: string; projectId: string; currency: string; scale: number; accountScope: string; generation: string; asOf: string }
export interface CaptureProposal { id: string; version: string; sourceId: string; generation: string; outcome: 'propose' | 'matched' | 'remainder'; familyId?: string; projectId?: string; purchaseId?: string; reason?: string }
const valid = (s: string | null | undefined): s is string => typeof s === 'string' && s.trim().length > 0;
const integer = (s: string): boolean => /^-?\d+$/.test(s);
function uniqueIds(items: ReadonlyArray<{ id: string }>): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (!valid(item.id) || seen.has(item.id)) throw new Error('duplicate or empty identity');
    seen.add(item.id);
  }
}

/** Matching and family ownership must have been established by the trusted reader. */
export function proposeCapture(sources: CaptureSource[], projectId: string | null, evidence: { sourceId: string; generation: string; accountScope: string; complete: boolean; classifications?: Readonly<Record<string, 'mapped' | 'unmapped' | 'capital_spending' | 'unknown'>> }): CaptureProposal[] {
  uniqueIds(sources);
  for (const source of sources) if (source.lines) uniqueIds(source.lines);
  const groups = new Map<string, CaptureSource[]>();
  for (const s of sources) if (valid(s.familyId)) groups.set(s.familyId, [...(groups.get(s.familyId) ?? []), s]);
  return sources.filter(s => !projectId || s.projectIds.length === 0 || s.projectIds.includes(projectId)).map(s => {
    const group = s.familyId ? groups.get(s.familyId) ?? [] : [];
    const conflict = group.some(x => x.sourceId !== s.sourceId || x.supplierId !== s.supplierId || x.currency !== s.currency || x.projectIds.length !== 1 || x.projectIds[0] !== s.projectIds[0])
      || new Set(group.map(x => x.purchaseId).filter(valid)).size > 1;
    let reason: string | undefined;
    if (!evidence.complete || !valid(evidence.sourceId) || !valid(evidence.generation) || !valid(evidence.accountScope)) reason = 'evidence_incomplete';
    else if (s.sourceId !== evidence.sourceId) reason = 'source_scope_mismatch';
    else if (!valid(s.version)) reason = 'revision_unknown';
    else if (s.state === 'cancelled') reason = 'cancelled';
    else if (s.state === 'draft') reason = 'unposted_source';
    else if (s.missing?.some(x => x !== 'line_evidence')) reason = s.missing.find(x => x !== 'line_evidence');
    else if (s.kind === 'adjustment' || (s.faceMinor !== null && integer(s.faceMinor) && BigInt(s.faceMinor) < 0n)) reason = 'adjustment_requires_source_link';
    else if (s.kind === 'journal') reason = 'journal';
    else if (s.kind === 'supplier_payment') reason = 'payment_without_invoice';
    else if (s.kind === 'receipt') reason = 'receipt_only';
    else if (s.kind !== 'order' && s.kind !== 'supplier_invoice') reason = 'unsupported_kind';
    else if (s.state === 'unknown') reason = 'state_unknown';
    else if ((s.kind === 'order' && s.state !== 'ordered') || (s.kind === 'supplier_invoice' && !['invoiced', 'part_paid', 'paid'].includes(s.state))) reason = 'state_unsupported';
    else if (!s.projectIds.length) reason = 'no_project';
    else if (s.projectIds.length !== 1) reason = 'spans_projects';
    else if (!valid(s.supplierId)) reason = 'supplier_unknown';
    else if (!valid(s.currency) || s.faceMinor === null || !integer(s.faceMinor) || s.faceScale === null || !Number.isInteger(s.faceScale) || s.faceScale < 0 || s.faceScale > 18) reason = 'amount_or_currency_unknown';
    else if (!valid(s.familyId)) reason = 'family_unknown';
    else if (conflict) reason = 'family_conflict';
    else if (!s.purchaseId && group.some(x => x.purchaseId && x.purchaseOrigin === 'ordinary')) reason = 'ordinary_purchase_requires_decision';
    else if (group.some(x => x.purchaseId && !x.purchaseOrigin)) reason = 'purchase_origin_unknown';
    else if (s.kind === 'supplier_invoice' && (!evidence.classifications?.[s.id] || evidence.classifications[s.id] === 'unknown')) reason = 'account_basis_unknown';
    else if (s.kind === 'supplier_invoice' && evidence.classifications?.[s.id] !== 'mapped') reason = evidence.classifications?.[s.id];
    if (reason) return { id: s.id, version: s.version, sourceId: evidence.sourceId, generation: evidence.generation, outcome: 'remainder', reason };
    const existing = group.find(x => valid(x.purchaseId))?.purchaseId;
    return { id: s.id, version: s.version, sourceId: evidence.sourceId, generation: evidence.generation, outcome: s.purchaseId ? 'matched' : 'propose', familyId: s.familyId!, projectId: s.projectIds[0], ...(existing ? { purchaseId: existing } : {}) };
  });
}
export function revisionsMatch(reviewedGeneration: string, currentGeneration: string, reviewed: CaptureSource[], current: CaptureSource[]): boolean {
  if (!valid(reviewedGeneration) || reviewedGeneration !== currentGeneration || reviewed.length !== current.length) return false;
  try { uniqueIds(reviewed); uniqueIds(current); } catch { return false; }
  const versions = new Map(reviewed.map(s => [s.id, s]));
  return current.every(s => valid(s.version) && valid(s.sourceId) && versions.get(s.id)?.version === s.version && versions.get(s.id)?.sourceId === s.sourceId);
}
export interface CaptureReport {
  complete: boolean; ledgerMinor: string | null; representedMinor: string | null; remainderMinor: string | null;
  remainder: Array<{ id: string; amountMinor: string; reason: string }>;
  excluded: Array<{ id: string; amountMinor: string; reason: string }>;
  documents: Array<Pick<CaptureSource, 'id' | 'kind' | 'state' | 'currency' | 'faceMinor' | 'faceScale'>>;
  documentOnly: string[]; missing: string[]; itemCoverage: { complete: boolean; missing: string[] }; scope: CaptureScope; assignmentBridge: Array<{ id: string; amountMinor: string }> | null;
}
/** Ledger input is already scoped to one project, binding, account scope, generation and ledger currency. */
export function reconcileCapture(input: { scope: CaptureScope; complete: boolean; documents: CaptureSource[]; lines: CaptureLedgerLine[]; ledgerGeneration: string; assignmentBridge?: Array<{ id: string; amountMinor: string }> | null }): CaptureReport {
  uniqueIds(input.documents); uniqueIds(input.lines);
  for (const source of input.documents) if (source.lines) uniqueIds(source.lines);
  if (input.assignmentBridge) { uniqueIds(input.assignmentBridge); if (input.assignmentBridge.some(x => !integer(x.amountMinor))) throw new Error('invalid assignment amount'); }
  const { scope } = input;
  const missing: string[] = [];
  const itemMissing: string[] = input.complete ? [] : ['incomplete_census'];
  if (!input.complete) missing.push('incomplete_census');
  if (!valid(input.ledgerGeneration) || input.ledgerGeneration !== scope.generation) { missing.push('generation_changed'); itemMissing.push('generation_changed'); }
  if (!valid(scope.sourceId) || !valid(scope.projectId) || !valid(scope.accountScope) || !valid(scope.generation) || !valid(scope.asOf)) missing.push('scope_unknown');
  if (!valid(scope.currency) || !Number.isInteger(scope.scale) || scope.scale < 0 || scope.scale > 18) missing.push('currency_unknown');
  if (input.documents.some(d => d.sourceId !== scope.sourceId)) { missing.push('source_scope_mismatch'); itemMissing.push('source_scope_mismatch'); }
  for (const doc of input.documents) {
    missing.push(...(doc.missing ?? []).filter(x => x !== 'line_evidence'));
    if (!Array.isArray(doc.lines) || doc.missing?.includes('line_evidence')) itemMissing.push('line_evidence');
    if ((doc.kind === 'order' || doc.kind === 'supplier_invoice') && (!valid(doc.currency) || doc.faceMinor === null || !integer(doc.faceMinor) || doc.faceScale === null || !Number.isInteger(doc.faceScale) || doc.faceScale < 0 || doc.faceScale > 18)) missing.push('face_currency_or_amount');
  }
  const docs = new Map(input.documents.map(d => [d.id, d]));
  const linked = new Set<string>();
  const remainder: CaptureReport['remainder'] = [], excluded: CaptureReport['excluded'] = [];
  let represented = 0n, remaining = 0n;
  for (const line of input.lines) {
    if (line.sourceId !== scope.sourceId || line.currency !== scope.currency || line.projectId !== scope.projectId) { missing.push('line_scope_mismatch'); continue; }
    if (!integer(line.amountMinor)) { missing.push('amount_unknown'); continue; }
    const amount = BigInt(line.amountMinor);
    if (line.documentId) linked.add(line.documentId);
    if (!['mapped', 'capital_spending', 'overhead', 'unmapped'].includes(line.classification)) { missing.push('classification_unknown'); continue; }
    if (line.classification !== 'mapped') { excluded.push({ id: line.id, amountMinor: line.amountMinor, reason: line.classification }); continue; }
    const doc = line.documentId ? docs.get(line.documentId) : undefined;
    if (!(line.kind === 'journal' && amount < 0n) && doc?.purchaseId && doc.projectIds.length === 1 && doc.projectIds[0] === scope.projectId) { represented += amount; continue; }
    remaining += amount;
    const reason = line.kind === 'journal' && amount < 0n ? 'negative_journal_not_capturable' : line.kind === 'journal' ? 'journal' : line.kind === 'supplier_payment' ? 'payment_without_invoice' : doc ? 'not_captured' : 'source_unmatched';
    remainder.push({ id: line.id, amountMinor: line.amountMinor, reason });
  }
  const complete = missing.length === 0;
  return { complete, ledgerMinor: complete ? (represented + remaining).toString() : null, representedMinor: complete ? represented.toString() : null, remainderMinor: complete ? remaining.toString() : null, remainder, excluded, documents: input.documents.map(({ id, kind, state, currency, faceMinor, faceScale }) => ({ id, kind, state, currency, faceMinor, faceScale })), documentOnly: input.documents.filter(d => !linked.has(d.id)).map(d => d.id), missing: [...new Set(missing)], itemCoverage: { complete: itemMissing.length === 0, missing: [...new Set(itemMissing)] }, scope, assignmentBridge: input.assignmentBridge ?? null };
}

export type Page<T> = { supported: true; generation: string; items: T[]; nextCursor: string | null } | { supported: false; missing: string[] };
export interface PageResult<T> { complete: boolean; items: T[]; missing: string[]; generation?: string; nextCursor: string | null; cursors: string[] }
/** Bound each invocation and retain state for safe continuation; never treat a failed page as a complete read. */
export async function collectPages<T extends { id: string }>(read: (cursor: string | null) => Promise<Page<T>>, options: { limit: number; resume?: PageResult<T>; expectedGeneration?: string }): Promise<PageResult<T>> {
  const prior = options.resume;
  const items = [...(prior?.items ?? [])], cursors = [...(prior?.cursors ?? [])];
  let generation = prior?.generation, cursor = prior?.nextCursor ?? null;
  const fail = (reason: string[]): PageResult<T> => ({ complete: false, items, missing: reason, generation, nextCursor: cursor, cursors });
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 1000) return fail(['invalid_page_limit']);
  if (prior && (prior.complete || prior.missing.length !== 1 || prior.missing[0] !== 'page_limit' || cursor === null)) return fail(['invalid_resume']);
  try { uniqueIds(items); } catch { return fail(['duplicate_or_empty_identity']); }
  const ids = new Set(items.map(x => x.id));
  try {
    for (let n = 0; n < options.limit; n++) {
      const page = await read(cursor);
      if (!page.supported) return fail(page.missing.length ? page.missing : ['unsupported']);
      if (page.items.length > 500) return fail(['page_size_exceeded']);
      if (!valid(page.generation) || (generation && generation !== page.generation) || (options.expectedGeneration && options.expectedGeneration !== page.generation)) return fail(['generation_changed']);
      generation = page.generation;
      for (const item of page.items) {
        if (!valid(item.id) || ids.has(item.id)) return fail(['duplicate_or_empty_identity']);
        ids.add(item.id); items.push(item);
      }
      cursor = page.nextCursor;
      if (cursor === null) return { complete: true, items, missing: [], generation, nextCursor: null, cursors };
      if (!valid(cursor) || cursors.includes(cursor)) return fail(['repeated_cursor']);
      cursors.push(cursor);
    }
    return fail(['page_limit']);
  } catch { return fail(['read_failed']); }
}
