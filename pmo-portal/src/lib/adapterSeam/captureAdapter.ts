/** Capture capability selected for one binding and one request. */
export type CaptureAdapter =
  | { supported: false; missing: string[]; status: number }
  | { supported: true; company: string; precision: { read(company: string, kind: 'order' | 'supplier_invoice' | 'journal'): Promise<{ ok: true; scale: number } | { ok: false; reason: string }> } };
