import type { CaptureSource, Page } from '../captureHistory';
/** No cross-tier fallback: the missing feeds and evidence must be implemented explicitly. */
export function createCaptureAdapter(): { listSources: () => Promise<Page<CaptureSource>>; listLedger: () => Promise<Page<{ id: string }>> } {
  const unsupported = () => ({ supported: false as const, missing: ['purchase_source_feed', 'ledger_feed', 'line_project_evidence', 'currency_and_generation_evidence'] });
  return { listSources: async () => unsupported(), listLedger: async () => unsupported() };
}
