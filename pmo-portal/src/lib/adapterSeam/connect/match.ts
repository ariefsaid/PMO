import type { MasterKind, MatchOutcome, NormalisedMaster, PmoMaster, ReviewReason } from './types.ts';

// PD-ECA-16: trailing legal forms only. A leading PT / CV / UD names a different legal entity and is kept.
const LEGAL_SUFFIXES = new Set(['tbk', 'persero', 'ltd', 'limited', 'inc', 'llc', 'co', 'corp', 'gmbh', 'bv', 'sa', 'plc']);
export function normaliseName(name: string): string {
  const words = name.toLowerCase().replace(/[.,()]/g, ' ').split(/\s+/).filter(Boolean);
  while (words.length > 1 && LEGAL_SUFFIXES.has(words[words.length - 1])) words.pop();
  return words.join(' ');
}
const normTax = (t?: string | null) => (t ?? '').replace(/[^0-9a-z]/gi, '').toLowerCase();
const normCode = (c?: string | null) => (c ?? '').trim().toLowerCase();

/** PD-ECA-4: which outcomes each kind can have. */
const POLICY: Record<MasterKind, { bringIn: boolean; send: boolean; nameLinks: boolean }> = {
  party: { bringIn: true, send: true, nameLinks: true }, contact: { bringIn: false, send: false, nameLinks: true },
  item: { bringIn: false, send: true, nameLinks: true }, project: { bringIn: false, send: true, nameLinks: true },
  // A person's cost identity and a budget account never link on a name (OQ-TSP-10(C)): a name hit is a review for a person to decide.
  employee: { bringIn: false, send: true, nameLinks: false }, account: { bringIn: false, send: false, nameLinks: false },
};

type Claim = { erp: NormalisedMaster; pmoIds: string[]; key: 'tax' | 'code' | 'name'; conflict: boolean; nameOnly: boolean };

/** The one matcher (DD-ECA-2, FR-ECA-010/011). Deterministic: tax id, then code, then normalised name. A key that matches
 *  several rows, a name match whose tax ids differ, a name match for a person or an account, or two ERP rows claiming one PMO row is a review. */
export function proposeMatches(kind: MasterKind, pmo: readonly PmoMaster[], erp: readonly NormalisedMaster[]): MatchOutcome[] {
  const policy = POLICY[kind];
  const live = pmo.filter((p) => p.active !== false);
  const sameRole = (p: PmoMaster, e: NormalisedMaster) => (p.role ?? null) === (e.role ?? null);
  const index = (key: (p: PmoMaster) => string) => {
    const m = new Map<string, PmoMaster[]>();
    for (const p of live) { const k = key(p); if (k) m.set(k, [...(m.get(k) ?? []), p]); }
    return m;
  };
  const byTax = index((p) => normTax(p.taxId)), byCode = index((p) => normCode(p.code)), byName = index((p) => normaliseName(p.name));
  const claims: Claim[] = [];
  const rows = erp.filter((e) => !e.internal).sort((a, b) => a.externalId.localeCompare(b.externalId));
  for (const e of rows) {
    const pick = (m: Map<string, PmoMaster[]>, k: string) => (k ? (m.get(k) ?? []).filter((p) => sameRole(p, e)) : []);
    const tax = pick(byTax, normTax(e.taxId));
    const code = tax.length ? [] : pick(byCode, normCode(e.code));
    // PQ-ECA-2: an inactive ERP row is a link target for a strong key only.
    const name = tax.length || code.length || !e.active ? [] : pick(byName, normaliseName(e.name));
    const hit = tax.length ? { c: tax, key: 'tax' as const } : code.length ? { c: code, key: 'code' as const } : { c: name, key: 'name' as const };
    if (hit.c.length === 0) continue;
    // Both tax ids set on a name match means they differ (equal ids would have matched on tax): a review.
    // A person whose two work emails are both set and differ is a conflict too.
    const conflict = hit.key === 'name' && ((normTax(e.taxId) !== '' && hit.c.some((p) => normTax(p.taxId) !== ''))
      || (kind === 'employee' && normCode(e.code) !== '' && hit.c.some((p) => normCode(p.code) !== '')));
    claims.push({ erp: e, pmoIds: hit.c.map((p) => p.id).sort(), key: hit.key, conflict, nameOnly: hit.key === 'name' && !policy.nameLinks });
  }
  // A PMO row claimed by more than one ERP row is doubtful for all of them.
  const claimCount = new Map<string, number>();
  for (const c of claims) for (const id of c.pmoIds) claimCount.set(id, (claimCount.get(id) ?? 0) + 1);
  const out: MatchOutcome[] = []; const touchedPmo = new Set<string>(); const touchedErp = new Set<string>();
  const doubtful: Claim[] = [];
  for (const c of claims) {
    touchedErp.add(c.erp.externalId); c.pmoIds.forEach((id) => touchedPmo.add(id));
    if (!c.conflict && !c.nameOnly && c.pmoIds.length === 1 && claimCount.get(c.pmoIds[0]) === 1) out.push({ outcome: 'link', pmoId: c.pmoIds[0], externalId: c.erp.externalId, key: c.key });
    else doubtful.push(c);
  }
  // Doubtful claims sharing a PMO row merge into one review (union-find on PMO ids): every row gets exactly one outcome.
  const root = new Map<string, string>();
  const find = (id: string): string => { const r = root.get(id) ?? id; return r === id ? id : find(r); };
  for (const c of doubtful) for (const id of c.pmoIds.slice(1)) root.set(find(id), find(c.pmoIds[0]));
  const reviews = new Map<string, Claim[]>();
  for (const c of doubtful) { const k = find(c.pmoIds[0]); reviews.set(k, [...(reviews.get(k) ?? []), c]); }
  for (const cs of reviews.values()) out.push({ outcome: 'review', pmoIds: [...new Set(cs.flatMap((c) => c.pmoIds))].sort(),
    externalIds: cs.map((c) => c.erp.externalId).sort(), reason: cs.some((c) => c.conflict) ? 'tax-conflict' : 'ambiguous' });
  if (policy.bringIn) for (const e of rows) if (e.active && !touchedErp.has(e.externalId)) out.push({ outcome: 'bring-in', externalId: e.externalId });
  if (policy.send) for (const p of live) if (!touchedPmo.has(p.id)) out.push({ outcome: 'send', pmoId: p.id });
  return out;
}

export type PartyPick<C> =
  | { outcome: 'link'; candidate: C }
  | { outcome: 'none' }
  | { outcome: 'review'; reason: 'tax-conflict' | 'ambiguous'; eligible: number };

/** The shipped single-party entry point (feed, onboarding, Odoo harness), now a thin wrapper so every caller is v2.
 *  The caller's lookup supplies same-name, same-role candidates (and, after ECA2-T14, same-tax-id ones). */
export function pickPartyCandidate<C extends { taxId: string | null }>(taxId: string | null | undefined, candidates: readonly C[]): PartyPick<C> {
  if (candidates.length === 0) return { outcome: 'none' };
  const out = proposeMatches('party', candidates.map((c, i) => ({ id: String(i), name: 'candidate', taxId: c.taxId })),
    [{ kind: 'party', externalId: 'source', name: 'candidate', taxId: taxId ?? null, active: true }]);
  const hit = out.find((o) => o.outcome === 'link' || o.outcome === 'review');
  if (hit?.outcome === 'link') return { outcome: 'link', candidate: candidates[Number(hit.pmoId)] };
  if (hit?.outcome === 'review') return { outcome: 'review', reason: hit.reason === 'tax-conflict' ? 'tax-conflict' : 'ambiguous', eligible: hit.pmoIds.length };
  return { outcome: 'none' };
}

/** FR-ECA-022: why a row needs a person, in PMO's words. A one-to-one review is a name hit on a kind that never links on a name. */
export function reviewReasonText(kind: MasterKind, o: { reason: ReviewReason | 'held'; pmoIds: readonly string[]; externalIds: readonly string[] }): string {
  if (o.reason === 'held') return 'We could not confirm whether the ERP created this record';
  if (o.reason === 'rejected') return 'An administrator declined this pairing';
  if (o.reason === 'tax-conflict') return kind === 'employee' ? 'Work emails do not match' : 'Tax numbers do not match';
  return o.pmoIds.length === 1 && o.externalIds.length === 1
    ? 'The names match, but nothing else confirms it is the same record' : 'Two or more records could be this one';
}
