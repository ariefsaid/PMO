import { BaseSequencer } from 'vitest/node';
import { relative } from 'node:path';
import { partition } from './unit-shard-balance.mjs';
export default class BalancedSequencer extends BaseSequencer {
  shard(tests) {
    const { index, count } = this.ctx.config.shard;
    const paths = tests.map(test => relative(this.ctx.config.root, test.moduleId).replaceAll('\\', '/'));
    const selected = new Set(partition(paths, count)[index - 1].files);
    return tests.filter((test, i) => selected.has(paths[i]));
  }
}
