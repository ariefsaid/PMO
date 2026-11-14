import type { CaptureAdapter } from '../captureAdapter.ts';
import { createCaptureAdapter as createHistoryAdapter } from './captureHistory.ts';

export async function createCaptureAdapter(): Promise<CaptureAdapter> {
  const capability = await createHistoryAdapter().listSources();
  return { supported: false, missing: ['odoo_purchase_capture', ...(!capability.supported ? capability.missing : [])], status: 409 };
}
