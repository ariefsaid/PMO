import { integrationsRepository } from './integrations';
import { withTimeout } from '../withTimeout';

/** A native save remains successful when the separate ERP master write needs a retry. */
export async function synchronizeErpProject(projectId: string, orgId: string | undefined): Promise<'not-connected' | 'linked' | 'pending'> {
  if (!orgId) return 'not-connected';
  try {
    const binding = await withTimeout(integrationsRepository.getBinding(orgId, 'erpnext'));
    if (binding?.status !== 'active' || !binding.config.company) return 'not-connected';
    await integrationsRepository.ensureErpProject(projectId);
    return 'linked';
  } catch {
    return 'pending';
  }
}
