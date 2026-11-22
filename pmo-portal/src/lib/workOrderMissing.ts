import type { ExportTable } from '@/src/lib/export';

/**
 * The work order's "still missing" list: a pure derivation over reads that already exist (scope progress and the billing
 * reconciliation) plus the work order's step list, which arrives through the typed `steps` seam. Nothing here is stored and
 * nothing here refuses anything: every row is advisory information (the close-out checklist keeps its own section and its own
 * database rule). Rows: open steps, a step's required attachment not yet attached, quantity reported but not accepted, and
 * quantity accepted but not claimed.
 */
export interface MissingStepAttachment { id: string; name: string; required: boolean; attached: boolean }
/** One step of the work order, as a step source supplies it. `ownerRole` is the role that adds it (a role name from the organisation's data). */
export interface MissingStep {
  id: string;
  position: number;
  name: string;
  ownerRole: string | null;
  done: boolean;
  attachments: MissingStepAttachment[];
}
export interface MissingScopeLine { id: string; boqItemId: string; itemCode: string | null; description: string | null; unit: string | null; accepted: number }
export interface MissingReconciliationRow {
  boqItemId: string; itemCode: string; description: string; unit: string;
  /** Reported progress to date; null when the item is shared with another work order (never apportioned). */
  progressQty: number | null;
  billedQty: number;
}

export type MissingKind = 'step' | 'step-attachment' | 'quantity-accept' | 'quantity-claim';
export type MissingWho = { key: 'role'; role: string } | { key: 'team' } | { key: 'finance' };
export type MissingReasonKey = 'stepOpen' | 'stepAttachment' | 'quantityAccept' | 'quantityClaim';

export interface MissingRow {
  id: string;
  kind: MissingKind;
  name: string;
  reasonKey: MissingReasonKey;
  reasonParams: Record<string, string | number>;
  who: MissingWho;
  ref: string | null;
}

export interface MissingInput {
  steps: readonly MissingStep[];
  scopeLines: readonly MissingScopeLine[];
  reconciliation: readonly MissingReconciliationRow[];
  status: string;
}

const label = (code: string | null, description: string | null) => [code, description].filter(Boolean).join(' · ') || '—';

export function deriveWorkOrderMissing(input: MissingInput): MissingRow[] {
  if (input.status === 'Closed' || input.status === 'Cancelled') return [];
  const rows: MissingRow[] = [];
  for (const s of [...input.steps].sort((a, b) => a.position - b.position)) {
    if (s.done) continue;
    const who: MissingWho = s.ownerRole ? { key: 'role', role: s.ownerRole } : { key: 'team' };
    rows.push({ id: `step:${s.id}`, kind: 'step', name: s.name, reasonKey: 'stepOpen', reasonParams: {}, who, ref: null });
    for (const a of s.attachments) {
      if (!a.required || a.attached) continue;
      rows.push({ id: `attachment:${a.id}`, kind: 'step-attachment', name: a.name, reasonKey: 'stepAttachment', reasonParams: { step: s.name }, who, ref: null });
    }
  }
  const progress = new Map(input.reconciliation.map((r) => [r.boqItemId, r]));
  const accepted = new Map(input.scopeLines.map((l) => [l.boqItemId, l]));
  for (const l of input.scopeLines) {
    const reported = progress.get(l.boqItemId)?.progressQty;
    if (reported === null || reported === undefined || !(reported - l.accepted > 0)) continue;
    rows.push({ id: `accept:${l.id}`, kind: 'quantity-accept', name: label(l.itemCode, l.description), reasonKey: 'quantityAccept',
      reasonParams: { quantity: reported - l.accepted, unit: l.unit ?? '' }, who: { key: 'team' }, ref: null });
  }
  for (const r of input.reconciliation) {
    const acc = accepted.get(r.boqItemId);
    if (!acc || !(acc.accepted - r.billedQty > 0)) continue;
    rows.push({ id: `claim:${r.boqItemId}`, kind: 'quantity-claim', name: label(r.itemCode, r.description), reasonKey: 'quantityClaim',
      reasonParams: { quantity: acc.accepted - r.billedQty, unit: r.unit }, who: { key: 'finance' }, ref: null });
  }
  return rows;
}

export interface MissingExportLabels {
  header: string[];
  describe: (row: MissingRow) => { kind: string; reason: string; who: string };
}

/** The screen's rows, in the screen's order, as the shared export table. */
export function toMissingExport(rows: readonly MissingRow[], labels: MissingExportLabels): ExportTable {
  return { header: labels.header, body: rows.map((r) => { const d = labels.describe(r); return [r.name, d.kind, d.reason, d.who]; }) };
}
