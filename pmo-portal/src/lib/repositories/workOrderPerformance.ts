/**
 * repositories/workOrderPerformance.ts (#2597) — the seam over the cost and schedule performance read and its
 * organisation settings (ADR-0017). Errors keep their Postgres code via `wrap`.
 */
import {
  getPerformanceSettings,
  getProjectPerformance,
  setPerformanceSettings,
  type PerformanceSettings,
  type ProjectPerformanceRead,
} from '@/src/lib/db/workOrderPerformance';
import { wrap } from './repositoryErrors';

export type { PerformanceSettings, ProjectPerformanceRead };

export const workOrderPerformanceRepository = {
  project: (projectId: string, asOf?: string): Promise<ProjectPerformanceRead> => wrap(() => getProjectPerformance(projectId, asOf)),
  getSettings: (): Promise<PerformanceSettings> => wrap(() => getPerformanceSettings()),
  setSettings: (patch: { enabled?: boolean; low?: number; high?: number }): Promise<void> => wrap(() => setPerformanceSettings(patch)),
};
