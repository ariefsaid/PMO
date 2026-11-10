import { test } from '@playwright/test';

test('standalone-first', () => {
  throw new Error('SHARDING_FIXTURE_BODY_SENTINEL');
});
