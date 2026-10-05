import { repositories } from './index';
import { DEFAULT_MUTATION_TIMEOUT_MS, withTimeout } from '../withTimeout';

/** A native save remains successful when the separate ERP master write needs a retry. */
export async function synchronizeErpProject(projectId: string, orgId: string | undefined): Promise<'not-connected' | 'linked' | 'pending'> {
  if (!orgId) return 'not-connected';
  try {
    const binding = await withTimeout(repositories.integrations.getBinding(orgId, 'erpnext'), DEFAULT_MUTATION_TIMEOUT_MS);
    if (binding?.status !== 'active' || !binding.config.company) return 'not-connected';
    await repositories.integrations.ensureErpProject(projectId);
    return 'linked';
  } catch {
    return 'pending';
  }
}
