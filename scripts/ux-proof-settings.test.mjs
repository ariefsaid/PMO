import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { baselineKey, routePattern } from './ux-proof-settings.mjs';

test('record baselines apply to other IDs while query views stay distinct', () => {
  const budget = JSON.parse(readFileSync(new URL('../docs/ux/word-budget.json', import.meta.url)));
  const route = '/projects/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const key = baselineKey(budget, route, 390, 'pm@acme.test');
  assert.equal(budget[key], 133);
  assert.equal(budget.targets[key], 0);
  assert.equal(routePattern(`${route}/tasks?view=board&scope=all`), '/projects/:id/tasks?view=board&scope=all');
  const boardKey = baselineKey(budget, `${route}/tasks?view=board&scope=all`, 390, 'pm@acme.test');
  assert.equal(budget[boardKey], 70);
});
