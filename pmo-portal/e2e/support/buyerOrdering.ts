import { test as base } from '@playwright/test';
import { serviceClient, need, ok, ORG_ID } from './jobFixtures';
import { userClient } from './stockFixture';

/** Org-global authority setup: consumers belong in the serial lane. */
export const buyerTest = base.extend<{ buyerOrdering: void }>({
  // eslint-disable-next-line no-empty-pattern -- Playwright requires object destructuring for a fixture with no dependencies.
  buyerOrdering: [async ({}, runTest) => {
    const service = serviceClient('buyer ordering setup');
    const previous = await service.from('purchase_order_settings').select('order_job_roles').eq('org_id', ORG_ID).maybeSingle();
    ok('read ordering roles', previous);
    const org = need('read role setting', await service.from('organizations').select('built_in_roles_enabled').eq('id', ORG_ID).single());
    const admin = await userClient('admin@acme.test');
    const keys: string[] = previous.data?.order_job_roles ?? [];
    try {
      if (!org.built_in_roles_enabled) ok('Admin enables built-in roles', await admin.rpc('set_built_in_roles_enabled', { p_enabled: true }));
      ok('Admin grants Buyer ordering', await admin.rpc('po_set_order_job_roles', { p_keys: [...new Set([...keys, 'buyer'])] }));
      await runTest();
    }
    finally {
      try {
        if (previous.data) ok('Admin restores ordering roles', await admin.rpc('po_set_order_job_roles', { p_keys: keys }));
        else ok('remove own settings row', await service.from('purchase_order_settings').delete().eq('org_id', ORG_ID));
      } finally {
        if (!org.built_in_roles_enabled) ok('Admin restores built-in roles', await admin.rpc('set_built_in_roles_enabled', { p_enabled: false }));
      }
    }
  }, { auto: true }],
});
