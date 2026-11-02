import type { TFunction } from 'i18next';

/** SC001 / SC002 refusals as product copy; null for any other error (the caller classifies it as usual). */
export function classifySubcontractBillError(err: unknown, t: TFunction): { headline: string; detail: string } | null {
  const code = (err as { code?: unknown } | null)?.code;
  const message = err instanceof Error ? err.message : '';
  if (code === 'SC001') {
    return { headline: t('subcontract.cap.capRefused', 'This bill is more than the accepted work allows'), detail: message };
  }
  if (code === 'SC002') {
    return { headline: t('subcontract.cap.linesRequired', 'This purchase has no issued BoQ lines to bill against'), detail: message };
  }
  return null;
}
