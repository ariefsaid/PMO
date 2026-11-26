import type { SupabaseClient } from '@supabase/supabase-js';
import { need, ok } from './jobFixtures';

export async function captureMaterialRequestApproval(admin: SupabaseClient, orgId: string) {
  const steps = need('read approval chain', await admin.from('approval_chain_steps')
    .select('role, job_role, label, only_over_plan').eq('org_id', orgId).order('position'));
  const inbox = await admin.from('material_request_settings')
    .select('approver_inbox').eq('org_id', orgId).maybeSingle();
  ok('read approvals inbox setting', inbox);

  return async () => {
    try {
      ok('restore approval chain', await admin.rpc('mrq_set_chain', { p_steps: steps }));
    } finally {
      ok('restore approvals inbox setting', await admin.rpc('mrq_set_approver_inbox', {
        p_on: inbox.data?.approver_inbox ?? false,
      }));
    }
  };
}
