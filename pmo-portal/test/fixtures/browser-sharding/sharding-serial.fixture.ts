import { test } from '@playwright/test';

test.describe.serial('serial dependency group', () => {
  test('serial-first', () => {
    throw new Error('SHARDING_FIXTURE_BODY_SENTINEL');
  });

  test('serial-second', () => {
    throw new Error('SHARDING_FIXTURE_BODY_SENTINEL');
  });
});
