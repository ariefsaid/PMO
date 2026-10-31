import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ownedContextOptions } from '../pmo-portal/e2e/helpers.ts';

test('AC-1210: owned context options carry project locale and timezone while excluding test-only settings', () => {
  const options = ownedContextOptions({ project: { use: {
    locale: 'en-GB', timezoneId: 'Asia/Jakarta', baseURL: 'http://localhost:3000',
    trace: 'on', screenshot: 'on', video: 'on',
  } } });
  assert.equal(options.locale, 'en-GB');
  assert.equal(options.timezoneId, 'Asia/Jakarta');
  assert.equal(options.baseURL, 'http://localhost:3000');
  assert.ok(!('trace' in options));
  assert.ok(!('screenshot' in options));
  assert.ok(!('video' in options));
});
