import { test } from '@playwright/test';

test('standalone-second', () => {
  throw new Error('SHARDING_FIXTURE_BODY_SENTINEL');
});
