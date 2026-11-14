import type { CaptureSource, CaptureKind, CaptureLedgerLine } from './captureHistory.ts';
export interface CaptureLedgerEvidence { id: string; version: string; company: string; projectId: string | null; reference: string | null; debit: string; credit: string; documentId: string | null; journalPurchaseId: string | null; kind: CaptureKind | null; classification: CaptureLedgerLine['classification'] }
/** Capture capability selected for one binding and one request. */
export type CaptureAdapter =
  | { supported: false; missing: string[]; status: number }
  | { supported: true; company: string; mapLedger(row: unknown): CaptureLedgerEvidence; mapSource(row: unknown, sourceId: string, precision: Partial<Record<'order' | 'supplier_invoice', number>>): CaptureSource; precision: { read(company: string, kind: 'order' | 'supplier_invoice' | 'journal'): Promise<{ ok: true; scale: number } | { ok: false; reason: string }> } };
