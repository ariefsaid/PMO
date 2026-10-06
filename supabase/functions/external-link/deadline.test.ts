/** AC-OUT-841 — external-link ClickUp reads are deadline-bounded (a hung host rejects, never hangs). */
import { assertRejects } from '@std/assert';
import { validateClickUpLinkDirection } from './index.ts';
import { FetchDeadlineError } from '../_shared/fetchWithDeadline.ts';
import { hungFetch, withShortOutboundDeadline } from '../_shared/testing/hungFetch.ts';

Deno.test('AC-OUT-841: external-link direction validation rejects within the deadline when ClickUp never answers', async () => {
  await withShortOutboundDeadline(() =>
    assertRejects(
      () =>
        validateClickUpLinkDirection(
          { fetchImpl: hungFetch(), token: 't' },
          {} as never,
          'org-1',
          'proj-1',
          'list-1',
          'push-seed',
        ),
      FetchDeadlineError,
    )
  );
});
