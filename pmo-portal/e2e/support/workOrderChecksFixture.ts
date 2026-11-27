import { test as base } from '@playwright/test';
import { cleanupAll, need, ok, ORG_ID, runId, serviceClient } from './jobFixtures';
import { seedSession } from './seedSession';
import { roleJobUser } from './roleJobUser';

async function createChecksFixture() {
  const svc = serviceClient('JOB-PC12');
  const run = runId('JOBPC12');
  const pcm = await roleJobUser(svc, 'project_control_manager', `${run}-pcm`);
  const pm = await roleJobUser(svc, 'project_manager', `${run}-pm`);
  const owners: Array<{ user: Awaited<ReturnType<typeof roleJobUser>>; name: string; check: string }> = [];
  for (const [key, suffix, label] of [
    ['engineer', 'eng', 'drawings and scope'],
    ['storekeeper', 'mat', 'material availability'],
    ['hr_officer', 'hr', 'crew availability'],
  ]) {
    owners.push({
      user: await roleJobUser(svc, key, `${run}-${suffix}`),
      name: `${run}-${suffix}`,
      check: `${run} ${label} checked`,
    });
  }
  ok('line manager', await svc.from('profiles').update({ manager_id: pcm.id }).eq('id', pm.id));
  const projectId = need(
    'project',
    await svc
      .from('projects')
      .insert({
        org_id: ORG_ID,
        name: `${run} project`,
        status: 'Ongoing Project',
        currency: 'USD',
        contract_value: 900_000_000_000,
        tax_treatment: 'exclusive',
        tax_amount: 0,
        project_manager_id: pm.id,
      })
      .select('id')
      .single(),
  ).id as string;
  return {
    svc,
    run,
    pcm,
    pm,
    owners,
    projectId,
    async draft() {
      const issuer = await seedSession(pcm.email, pcm.password);
      return need(
        'draft',
        await issuer
          .from('work_orders')
          .insert({
            project_id: projectId,
            title: `${run} site works`,
            client_po_number: `${run}/WO/001`,
            order_value: 150_000_000,
            tax_treatment: 'exclusive',
            tax_amount: 0,
          })
          .select('id')
          .single(),
      ).id as string;
    },
    async checks(workOrderId: string, status = 'To Do') {
      const issuer = await seedSession(pcm.email, pcm.password);
      ok(
        'checks',
        await issuer.from('tasks').insert(
          owners.map((o) => ({
            project_id: projectId,
            work_order_id: workOrderId,
            name: o.check,
            status,
            assignee_id: o.user.id,
            end_date: '2026-12-10',
          })),
        ),
      );
    },
    async cleanup() {
      const docs = need(
        'documents',
        await svc.from('project_documents').select('id').eq('project_id', projectId),
      );
      await cleanupAll(svc, [
        ['tasks', 'project_id', [projectId]],
        ['project_documents', 'id', docs.map((d) => d.id)],
        ['work_orders', 'project_id', [projectId]],
        ['projects', 'id', [projectId]],
      ]);
      for (const o of owners) await o.user.cleanup();
      await pm.cleanup();
      await pcm.cleanup();
    },
  };
}

export const test = base.extend<{ checksFixture: Awaited<ReturnType<typeof createChecksFixture>> }>(
  {
    checksFixture: async ({ request: _request }, runFixture) => {
      const fixture = await createChecksFixture();
      try {
        await runFixture(fixture);
      } finally {
        await fixture.cleanup();
      }
    },
  },
);
