import { describe, it, expect, vi, beforeEach } from 'vitest';

// A flexible chainable mock of the supabase query builder (the companies.test.ts idiom, plus the
// meetings-specific terminals: textSearch / or / limit). Each awaited chain resolves the next
// queued result (or the last one), so the search-fallback path can see error-then-success.
const h = vi.hoisted(() => {
  const queue: { data: unknown; error: unknown }[] = [];
  const calls = {
    from: [] as unknown[],
    select: [] as unknown[],
    eq: [] as unknown[],
    is: [] as unknown[],
    or: [] as unknown[],
    textSearch: [] as unknown[],
    order: [] as unknown[],
    limit: [] as unknown[],
    insert: [] as unknown[],
    update: [] as unknown[],
    delete: 0,
    single: 0,
    maybeSingle: 0,
  };
  const builder: Record<string, unknown> = {};
  const chain = (name: keyof typeof calls) => (...args: unknown[]) => {
    if (name === 'delete' || name === 'single' || name === 'maybeSingle') {
      (calls[name] as number)++;
    } else {
      (calls[name] as unknown[]).push(args.length === 1 ? args[0] : args);
    }
    return builder;
  };
  builder.select = chain('select');
  builder.eq = chain('eq');
  builder.is = chain('is');
  builder.or = chain('or');
  builder.textSearch = chain('textSearch');
  builder.order = chain('order');
  builder.limit = chain('limit');
  builder.insert = chain('insert');
  builder.update = chain('update');
  builder.delete = chain('delete');
  builder.single = chain('single');
  builder.maybeSingle = chain('maybeSingle');
  builder.then = (resolve: (v: unknown) => unknown) =>
    resolve(queue.length > 1 ? queue.shift() : queue[0]);
  const from = vi.fn((table: string) => {
    calls.from.push(table);
    return builder;
  });
  return { from, calls, queue };
});

vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from } }));

import {
  MEETING_LIST_CAP,
  parseNoteBlocks,
  listMeetings,
  listMeetingsForContact,
  getMeeting,
  createMeeting,
  updateMeeting,
  archiveMeeting,
  deleteMeeting,
  listMeetingAttendees,
  addMeetingAttendee,
  removeMeetingAttendee,
  listMeetingGrants,
  addMeetingGrant,
  revokeMeetingGrant,
} from './meetings';
import { AppError } from '@/src/lib/appError';

beforeEach(() => {
  h.from.mockClear();
  for (const k of Object.keys(h.calls) as (keyof typeof h.calls)[]) {
    if (typeof h.calls[k] === 'number') (h.calls[k] as unknown) = 0;
    else (h.calls[k] as unknown[]).length = 0;
  }
  h.queue.length = 0;
  h.queue.push({ data: null, error: null });
});

describe('parseNoteBlocks (FR-MTG-002 — the schema asserts only "array")', () => {
  it('coerces a valid block array', () => {
    expect(parseNoteBlocks([{ type: 'p', text: 'Kickoff' }])).toEqual([
      { type: 'p', text: 'Kickoff' },
    ]);
  });
  it('non-array notes flatten to an empty document, never a crash', () => {
    expect(parseNoteBlocks({} as never)).toEqual([]);
    expect(parseNoteBlocks(null as never)).toEqual([]);
  });
  it('unknown block shapes keep their text (or empty), never crash the page', () => {
    expect(parseNoteBlocks([{ type: 'h1', text: 'Heading' }, { bogus: true }, 'raw'])).toEqual([
      { type: 'p', text: 'Heading' },
      { type: 'p', text: '' },
      { type: 'p', text: 'raw' },
    ]);
  });
});

describe('listMeetings (FR-MTG-028/029/035)', () => {
  it('excludes templates + archived, orders occurred_at DESC, and caps rows explicitly', async () => {
    h.queue[0] = { data: [{ id: 'm1', title: 'Kickoff' }], error: null };
    const rows = await listMeetings();
    expect(h.calls.from).toEqual(['meetings']);
    expect(h.calls.eq).toContainEqual(['is_template', false]);
    expect(h.calls.is).toContainEqual(['archived_at', null]);
    expect(h.calls.order).toContainEqual(['occurred_at', { ascending: false }]);
    expect(h.calls.limit).toContainEqual(MEETING_LIST_CAP);
    expect(rows[0].title).toBe('Kickoff');
  });

  it('applies the project filter when given (FR-MTG-029)', async () => {
    h.queue[0] = { data: [], error: null };
    await listMeetings({ projectId: 'p1' });
    expect(h.calls.eq).toContainEqual(['project_id', 'p1']);
  });

  it('never sends a project filter when not given — project-less meetings stay included', async () => {
    h.queue[0] = { data: [], error: null };
    await listMeetings();
    expect(h.calls.eq.filter((c) => (c as unknown[])[0] === 'project_id')).toEqual([]);
  });

  it('searches notes_search with websearch semantics on the simple config (FR-MTG-011; #708 supersedes fallback-only substring)', async () => {
    h.queue[0] = { data: [], error: null };
    await listMeetings({ search: 'pipeline -old' });
    expect(h.calls.textSearch).toContainEqual([
      'notes_search',
      'pipeline -old',
      { type: 'websearch', config: 'simple' },
    ]);
    // #708: the substring leg ALWAYS runs alongside full-text (it used to be an infra-fault-only
    // fallback), so a partial word matches like the other list searches.
    expect(h.calls.or).toHaveLength(1);
    expect(String(h.calls.or[0])).toContain('title.ilike.');
    expect(String(h.calls.or[0])).toContain('notes_text.ilike.');
  });

  describe('#708 — search is the union of the full-text leg and the substring leg', () => {
    const row = (id: string, occurred_at: string, title = id) => ({ id, title, occurred_at });

    it('#708: a partial word ("coord") finds "coordination" through the substring leg', async () => {
      h.queue.length = 0;
      h.queue.push({ data: [], error: null }); // full-text: no whole-word match for "coord"
      h.queue.push({ data: [row('m1', '2026-09-01T10:00:00Z', 'Site coordination')], error: null });
      const rows = await listMeetings({ search: 'coord' });
      expect(h.calls.textSearch).toHaveLength(1);
      expect(String(h.calls.or[0])).toContain('title.ilike."%coord%"');
      expect(rows.map((r) => r.id)).toEqual(['m1']);
    });

    it('#708: a search of only wildcard/escape symbols runs no substring leg (never "%%" = every row)', async () => {
      h.queue.length = 0;
      h.queue.push({ data: [], error: null }); // full-text only
      const rows = await listMeetings({ search: ' %_*\\ ' });
      expect(h.calls.textSearch).toHaveLength(1);
      expect(h.calls.or).toEqual([]);
      expect(rows).toEqual([]);
    });

    it('#708: the union de-duplicates by id and is ordered newest-first', async () => {
      h.queue.length = 0;
      h.queue.push({
        data: [row('a', '2026-09-02T00:00:00Z'), row('b', '2026-09-01T00:00:00Z')],
        error: null,
      });
      h.queue.push({
        data: [row('b', '2026-09-01T00:00:00Z'), row('c', '2026-09-03T00:00:00Z')],
        error: null,
      });
      const rows = await listMeetings({ search: 'plan' });
      expect(rows.map((r) => r.id)).toEqual(['c', 'a', 'b']);
    });

    it('#708: the merged result is re-capped to MEETING_LIST_CAP, keeping the newest', async () => {
      const at = (i: number) => new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString();
      h.queue.length = 0;
      h.queue.push({
        data: Array.from({ length: 150 }, (_, i) => row(`f${i}`, at(i))),
        error: null,
      });
      h.queue.push({
        data: Array.from({ length: 150 }, (_, i) => row(`s${i}`, at(1000 + i))),
        error: null,
      });
      const rows = await listMeetings({ search: 'plan' });
      expect(rows).toHaveLength(MEETING_LIST_CAP);
      expect(rows[0].id).toBe('s149');
      // All 150 (newer) substring rows survive; only the 50 newest full-text rows fill the rest.
      expect(rows.filter((r) => r.id.startsWith('s'))).toHaveLength(150);
      expect(rows.filter((r) => r.id.startsWith('f'))).toHaveLength(50);
    });

    it('#708: a full-text error returns the substring leg alone', async () => {
      h.queue.length = 0;
      h.queue.push({ data: null, error: { message: 'fts unavailable' } });
      h.queue.push({ data: [row('s1', '2026-09-01T00:00:00Z')], error: null });
      const rows = await listMeetings({ search: 'plan' });
      expect(rows.map((r) => r.id)).toEqual(['s1']);
    });

    it('#708: a substring error throws with the code preserved, even when full-text succeeded', async () => {
      h.queue.length = 0;
      h.queue.push({ data: [row('a', '2026-09-01T00:00:00Z')], error: null });
      h.queue.push({ data: null, error: { message: 'denied', code: '42501' } });
      await expect(listMeetings({ search: 'plan' })).rejects.toMatchObject({ code: '42501' });
    });
  });

  it('falls back to ilike over title + notes_text when the FTS PATH itself errors (infra fault)', async () => {
    // ⚑ Not bad user input: websearch_to_tsquery is the forgiving parser and never raises on a
    // malformed query. This simulates an INFRA fault on the FTS path (index unavailable /
    // transient DB error) — the only thing that reaches the ilike fallback. See the DAL header.
    h.queue.length = 0;
    h.queue.push({ data: null, error: { message: 'index "meetings_notes_search_idx" is not available' } });
    h.queue.push({ data: [{ id: 'm2', title: 'Fallback hit' }], error: null });
    const rows = await listMeetings({ search: 'pipeline' });
    expect(h.calls.or.length).toBe(1);
    expect(String(h.calls.or[0])).toContain('title.ilike.');
    expect(String(h.calls.or[0])).toContain('notes_text.ilike.');
    expect(rows[0].title).toBe('Fallback hit');
  });

  describe('the ilike fallback term is user-controlled (search box or URL ?q=) and cannot add conditions', () => {
    /** Split a PostgREST logic-tree body at its top-level commas, honouring quoted values. */
    const splitConditions = (body: string): string[] => {
      const out: string[] = [];
      let cur = '';
      let depth = 0;
      let quoted = false;
      for (let i = 0; i < body.length; i++) {
        const c = body[i];
        if (quoted) {
          if (c === '\\') {
            cur += c + body[++i];
            continue;
          }
          if (c === '"') quoted = false;
          cur += c;
          continue;
        }
        if (c === '"') quoted = true;
        else if (c === '(') depth++;
        else if (c === ')') depth--;
        else if (c === ',' && depth === 0) {
          out.push(cur);
          cur = '';
          continue;
        }
        if (depth < 0) throw new Error(`unbalanced ")" in ${body}`);
        cur += c;
      }
      if (quoted || depth !== 0) throw new Error(`unterminated filter: ${body}`);
      out.push(cur);
      return out;
    };
    const CONDITION = /^(title|notes_text)\.ilike\."((?:[^"\\]|\\.)*)"$/;
    const unescape = (v: string) => v.replace(/\\(.)/g, '$1');

    const fallbackFilter = async (search: string): Promise<string> => {
      h.queue.length = 0;
      h.queue.push({ data: null, error: { message: 'fts unavailable' } });
      h.queue.push({ data: [], error: null });
      await listMeetings({ search });
      expect(h.calls.or.length).toBe(1);
      return String(h.calls.or[0]);
    };

    it('a term shaped like a filter stays ONE quoted value per column (no extra condition)', async () => {
      const body = await fallbackFilter('x,is_template.eq.true)');
      const conditions = splitConditions(body);
      expect(conditions).toHaveLength(2);
      const parsed = conditions.map((c) => c.match(CONDITION));
      expect(parsed.map((m) => m?.[1])).toEqual(['title', 'notes_text']);
      // The user's text survives inside the quoted value — searched for, never parsed. (The LIKE
      // single-character wildcard `_` is neutralised to a space, as before.)
      for (const m of parsed) expect(unescape(m![2])).toBe('%x,is template.eq.true)%');
    });

    it('quotes and backslashes in the term cannot close the quoted value', async () => {
      const body = await fallbackFilter('a"),is_template.eq.true,title.ilike.("b\\');
      const conditions = splitConditions(body);
      expect(conditions).toHaveLength(2);
      for (const c of conditions) expect(c).toMatch(CONDITION);
    });

    it('a NUL (and other control characters) never reach the filter', async () => {
      const body = await fallbackFilter('plan\u0000ning\u0007');
      expect(body).not.toMatch(/\p{Cc}/u);
      const conditions = splitConditions(body);
      expect(conditions).toHaveLength(2);
      for (const c of conditions) expect(c).toMatch(CONDITION);
    });
  });

  it('a non-search query error is NOT retried — it throws with the code preserved', async () => {
    h.queue[0] = { data: null, error: { message: 'denied', code: '42501' } };
    await expect(listMeetings()).rejects.toMatchObject({ code: '42501' });
  });
});

describe('listMeetingsForContact (DD-MTG-6 — the contact-timeline union source)', () => {
  it('inner-joins attendees by contact_id via a CONSTRAINT-QUALIFIED embed, newest-first, unarchived', async () => {
    h.queue[0] = {
      data: [{ id: 'm1', title: 'Kickoff', occurred_at: '2026-08-01T00:00:00Z', attendees: [{ contact_id: 'ct1' }] }],
      error: null,
    };
    const rows = await listMeetingsForContact('ct1');
    const sel = String(h.calls.select[0]);
    expect(sel).toContain('meeting_attendees!meeting_attendees_meeting_id_fkey!inner');
    expect(h.calls.eq).toContainEqual(['attendees.contact_id', 'ct1']);
    expect(h.calls.is).toContainEqual(['archived_at', null]);
    expect(h.calls.order).toContainEqual(['occurred_at', { ascending: false }]);
    // The slim ref shape only — the embed ride-along never leaks to the timeline.
    expect(rows).toEqual([{ id: 'm1', title: 'Kickoff', occurred_at: '2026-08-01T00:00:00Z' }]);
  });
});

describe('getMeeting', () => {
  it('resolves null when absent / RLS-scoped out (FR-MTG-031 — a calm not-found)', async () => {
    h.queue[0] = { data: null, error: null };
    await expect(getMeeting('mx')).resolves.toBeNull();
    expect(h.calls.maybeSingle).toBe(1);
  });
});

describe('createMeeting (FR-MTG-014 / 0205 stamps)', () => {
  it('never sends org_id, created_by_id, notes_text, notes_search or notes_schema_version', async () => {
    h.queue[0] = { data: { id: 'm1', title: 'T' }, error: null };
    await createMeeting({ title: 'T', project_id: 'p1', location: ' ', occurred_at: '2026-08-25T02:00:00.000Z' });
    const sent = h.calls.insert[0] as Record<string, unknown>;
    expect(sent.title).toBe('T');
    expect(sent.project_id).toBe('p1');
    expect(sent.occurred_at).toBe('2026-08-25T02:00:00.000Z');
    for (const forbidden of ['org_id', 'created_by_id', 'notes_text', 'notes_search', 'notes_schema_version']) {
      expect(sent).not.toHaveProperty(forbidden);
    }
  });

  it('trims a whitespace-only location to null (never stored verbatim)', async () => {
    h.queue[0] = { data: { id: 'm1', title: 'T' }, error: null };
    await createMeeting({ title: 'T', location: '   ' });
    expect((h.calls.insert[0] as Record<string, unknown>).location).toBeNull();
  });
});

describe('updateMeeting (FR-MTG-005/007 — DB-owned projections stay DB-owned)', () => {
  it('sends only the given keys; notes go verbatim; projections are never client-written', async () => {
    h.queue[0] = { data: [{ id: 'm1' }], error: null };
    await updateMeeting('m1', { notes: [{ type: 'p', text: 'pipeline' }] });
    const sent = h.calls.update[0] as Record<string, unknown>;
    expect(Object.keys(sent)).toEqual(['notes']);
    expect(sent.notes).toEqual([{ type: 'p', text: 'pipeline' }]);
  });

  it('a 0-row update (RLS using-denied silent no-op) throws instead of claiming success', async () => {
    h.queue[0] = { data: [], error: null };
    await expect(updateMeeting('m1', { title: 'X' })).rejects.toBeInstanceOf(AppError);
  });
});

describe('archive / delete (FR-MTG-016)', () => {
  it('archive stamps archived_at (soft, ADR-0018)', async () => {
    h.queue[0] = { data: [{ id: 'm1' }], error: null };
    await archiveMeeting('m1');
    const sent = h.calls.update[0] as Record<string, unknown>;
    expect(typeof sent.archived_at).toBe('string');
  });

  it('delete preserves the 23503 FK-block code for the "in use" toast', async () => {
    h.queue[0] = { data: null, error: { message: 'violates foreign key', code: '23503' } };
    await expect(deleteMeeting('m1')).rejects.toMatchObject({ code: '23503' });
  });
});

describe('attendees (FR-MTG-015 / 0205 org stamp)', () => {
  it('add sends exactly the chosen identity and never org_id', async () => {
    h.queue[0] = { data: { id: 'a1' }, error: null };
    await addMeetingAttendee('m1', { profile_id: 'u2' });
    const sent = h.calls.insert[0] as Record<string, unknown>;
    expect(sent.meeting_id).toBe('m1');
    expect(sent.profile_id).toBe('u2');
    expect(sent.contact_id).toBeNull();
    expect(sent.display_name).toBeNull();
    expect(sent).not.toHaveProperty('org_id');
  });

  it('a whitespace-only display_name normalises to null (the CHECK counts it as unset)', async () => {
    h.queue[0] = { data: { id: 'a1' }, error: null };
    await addMeetingAttendee('m1', { display_name: '   ' });
    const sent = h.calls.insert[0] as Record<string, unknown>;
    expect(sent.display_name).toBeNull();
  });

  it('list embeds profile + contact via constraint-qualified paths', async () => {
    h.queue[0] = { data: [], error: null };
    await listMeetingAttendees('m1');
    const sel = String(h.calls.select[0]);
    expect(sel).toContain('profiles!meeting_attendees_profile_id_fkey');
    expect(sel).toContain('contacts!meeting_attendees_contact_id_fkey');
  });

  it('remove asserts the row actually went away', async () => {
    h.queue[0] = { data: [], error: null };
    await expect(removeMeetingAttendee('a1')).rejects.toBeInstanceOf(AppError);
  });
});

describe('grants (OD-MTG-2 / FR-MTG-032..033)', () => {
  it('⚑ BOTH profiles embeds are constraint-qualified — the table has TWO FKs to profiles (0177 class)', async () => {
    h.queue[0] = { data: [], error: null };
    await listMeetingGrants('m1');
    const sel = String(h.calls.select[0]);
    expect(sel).toContain('profiles!meeting_access_grants_user_id_fkey');
    expect(sel).toContain('profiles!meeting_access_grants_granted_by_fkey');
    expect(sel).not.toMatch(/[^!]profiles\(/); // no unqualified profiles embed anywhere
  });

  it('add sends only meeting_id + user_id — granted_by is trigger-stamped, never trusted', async () => {
    h.queue[0] = { data: { id: 'g1' }, error: null };
    await addMeetingGrant('m1', 'u9');
    const sent = h.calls.insert[0] as Record<string, unknown>;
    expect(Object.keys(sent).sort()).toEqual(['meeting_id', 'user_id']);
  });

  it('revoke asserts the row actually went away', async () => {
    h.queue[0] = { data: [], error: null };
    await expect(revokeMeetingGrant('g1')).rejects.toBeInstanceOf(AppError);
  });
});
