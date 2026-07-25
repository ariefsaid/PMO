/**
 * MEDIUM-6 integration seam.
 *
 * `tasks.archived_at` is supplied by origin/feat/task-model-fields (migration 0123), not this branch.
 * Keep the shipped function import and the intended DB assertion documented without pretending the
 * current dev schema can execute it.
 */
import { archiveMirror } from './index.ts';

Deno.test({
  name: 'MEDIUM-6: archiveMirror writes tasks.archived_at (requires origin/feat/task-model-fields migration 0123)',
  ignore: true,
}, () => {
  void archiveMirror;
});
