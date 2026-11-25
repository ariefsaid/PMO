import { normalizeDecimal } from '@/src/lib/stockFormat';

/** A receipt line's quality check, as typed: how many passed, how many were rejected, and why. */
export interface QualityValue { passed: string; rejected: string; reason: string }
export const NO_QUALITY: QualityValue = { passed: '', rejected: '', reason: '' };
export type QualityProblem = 'passed' | 'rejected' | 'add' | 'reason';

export const thousandths = (raw: string): number | null => {
  const v = normalizeDecimal(raw);
  return /^\d+(\.\d{1,3})?$/.test(v) ? Math.round(Number(v) * 1000) : null;
};

/** The one rule for a received quantity: passed and rejected are numbers, they add up to what was received, and a rejection says why. */
export function qualityProblem(received: string, q: QualityValue): QualityProblem | null {
  const total = thousandths(received); const passed = thousandths(q.passed); const rejected = thousandths(q.rejected);
  if (passed === null) return 'passed';
  if (rejected === null) return 'rejected';
  if (total === null || passed + rejected !== total) return 'add';
  if (rejected > 0 && !q.reason.trim()) return 'reason';
  return null;
}
/** What the database takes for a line that carries the check (the passed part is the rest). */
export const qualityWire = (q: QualityValue): { rejected: string; rejectNote?: string } => {
  const rejected = normalizeDecimal(q.rejected);
  return Number(rejected) > 0 ? { rejected, rejectNote: q.reason.trim() } : { rejected };
};
