/** AC-OUT-841 — external-lists ClickUp hierarchy reads are deadline-bounded (a hung host rejects, never hangs). */
import { assertRejects } from '@std/assert';
import { fetchTeams } from './index.ts';
import { FetchDeadlineError } from '../_shared/fetchWithDeadline.ts';
import { hungFetch, withShortOutboundDeadline } from '../_shared/testing/hungFetch.ts';

Deno.test('AC-OUT-841: external-lists fetchTeams rejects within the deadline when ClickUp never answers', async () => {
  await withShortOutboundDeadline(() =>
    assertRejects(() => fetchTeams({ fetchImpl: hungFetch(), token: 't' }), FetchDeadlineError)
  );
});
