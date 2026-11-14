import type { CaptureAdapter } from '../captureAdapter.ts';
import { createCapturePrecisionReader } from './captureEvidence.ts';
import type { ErpClientDeps } from './client.ts';

type Resolution = { refusal: string } | { client: ErpClientDeps; config: Record<string, unknown> | null };
export async function createCaptureAdapter(config: { company?: unknown } | null, resolve: () => Promise<Resolution>): Promise<CaptureAdapter> {
  if (typeof config?.company !== 'string' || !config.company.trim()) return { supported: false, missing: ['company_unknown'], status: 200 };
  const resolved = await resolve();
  if ('refusal' in resolved || resolved.config?.company !== config.company) return { supported: false, missing: ['erp_reader_unavailable'], status: 200 };
  return { supported: true, company: config.company, precision: createCapturePrecisionReader(resolved.client) };
}
