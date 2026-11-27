import { seedSession } from './seedSession';
import { need, ok, ORG_ID } from './jobFixtures';
import { orgToday } from './jobJourney';

export async function prepareImprestTopUp(
  floatId: string,
  stage: 'requested' | 'approved' | 'paid',
) {
  const pm = await seedSession('pm@acme.test');
  const id = need(
    'request topup',
    await pm.rpc('request_imprest_replenishment', { p_float: floatId, p_kind: 'replenishment' }),
  );
  if (stage === 'requested') return;
  const finance = await seedSession('finance@acme.test');
  ok(
    'approve topup',
    await finance.rpc('transition_imprest_replenishment', { p_id: id, p_to: 'Approved' }),
  );
  if (stage === 'approved') return;
  const admin = await seedSession('admin@acme.test');
  ok(
    'pay topup',
    await admin.rpc('transition_imprest_replenishment', {
      p_id: id,
      p_to: 'Paid',
      p_payment_reference: 'Journey setup',
    }),
  );
}

export async function prepareOutOfPlanClaim(fx: {
  projectId: string;
  floatId: string;
  tag: string;
}) {
  const engineer = await seedSession('engineer@acme.test');
  const claim = need(
    'out of plan claim',
    await engineer
      .from('expense_claims')
      .insert({
        kind: 'claim',
        title: `${fx.tag} out of plan`,
        project_id: fx.projectId,
        budget_category: 'Vehicle',
        imprest_float_id: fx.floatId,
      })
      .select('id')
      .single(),
  );
  ok(
    'out of plan line',
    await engineer
      .from('expense_claim_lines')
      .insert({
        claim_id: claim.id,
        expense_date: orgToday(),
        expense_type: 'Travel',
        description: 'Truck hire',
        amount: 1_700_000,
      }),
  );
  // This lane records receipt metadata; storage upload has its own journey.
  ok(
    'out of plan receipt',
    await engineer
      .from('expense_claim_files')
      .insert({
        claim_id: claim.id,
        title: 'receipt',
        file_path: `${ORG_ID}/${claim.id}/${crypto.randomUUID()}/receipt.png`,
      }),
  );
  ok(
    'submit out of plan',
    await engineer.rpc('transition_expense_claim', { p_id: claim.id, p_to: 'Submitted' }),
  );
  return `/expenses/${claim.id}`;
}
