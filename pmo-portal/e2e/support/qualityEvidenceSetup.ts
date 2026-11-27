import { seedSession } from './seedSession';
import { ok } from './jobFixtures';
import type { BillingFixture } from './billingFixture';

export async function prepareQualityEvidence(
  step: string,
  fixture: BillingFixture,
  stage: 'enabled' | 'attached' | 'firstClaim',
) {
  const admin = await seedSession('admin@acme.test');
  ok(
    'enable claim evidence',
    await admin.rpc('set_work_order_step_claim_evidence', { p_step: step, p_enabled: true }),
  );
  if (stage === 'enabled') return;
  ok(
    'attach quality evidence',
    await admin.rpc('attach_work_order_step_document', {
      p_step: step,
      p_slot: null,
      p_document: fixture.documentId,
    }),
  );
  if (stage === 'attached') return;
  const finance = await seedSession('finance@acme.test');
  ok(
    'first claim',
    await finance.rpc('create_progress_claim', {
      p_project_id: fixture.projectId,
      p_work_order_id: fixture.workOrderId,
      p_kind: 'progress',
      p_lines: [{ boq_item_id: fixture.boqId, quantity: 2 }],
    }),
  );
}
