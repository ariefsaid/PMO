import { test } from '@playwright/test';

test('standalone-first', () => {
  throw new Error('SHARDING_FIXTURE_BODY_SENTINEL');
});

test('standalone-second', () => {
  throw new Error('SHARDING_FIXTURE_BODY_SENTINEL');
});

test.describe.serial('serial dependency group', () => {
  test('serial-first', () => {
    throw new Error('SHARDING_FIXTURE_BODY_SENTINEL');
  });

  test('serial-second', () => {
    throw new Error('SHARDING_FIXTURE_BODY_SENTINEL');
  });
});
