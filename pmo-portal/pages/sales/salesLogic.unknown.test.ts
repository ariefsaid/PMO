import { expect, it } from 'vitest';
import type { PipelineProject } from '@/src/lib/db/dashboard';
import type { SalesModel } from './useSalesModel';
import { attentionReason } from './salesLogic';

it('F12 uses an unknown marker when no age is recorded', () => {
  const model = { t: (_key: string, fallback: string, values: { days: string }) => fallback.replace('{{days}}', String(values.days)) } as unknown as SalesModel;
  const project = { stage_started_at: null, last_update: null } as unknown as PipelineProject;
  expect(attentionReason(model, project)).toBe('Untouched for — days');
});
