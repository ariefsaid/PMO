import { beforeEach, describe, it, expect, vi } from 'vitest';

// Chainable PostgREST builder + storage mock (the agentRuns.test.ts reference pattern), so the
// whole DAL surface can be exercised: rpc shapes, from-chain shapes, the photo bucket rollback.
const h = vi.hoisted(() => {
  type Res = { data: unknown; error: unknown };
  const results: Res[] = [];
  const calls: Record<string, unknown[]> = {
    from: [], rpc: [], select: [], insert: [], update: [], delete: [], eq: [], is: [], order: [], range: [], single: [], maybeSingle: [],
  };
  const next = (): Res => (results.length ? (results.shift() as Res) : { data: null, error: null });
  const builder: Record<string, unknown> = {};
  const rec = (name: keyof typeof calls) => (...args: unknown[]) => {
    calls[name].push(args.length <= 1 ? args[0] : args);
    return builder;
  };
  for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'is', 'order', 'range'] as const) builder[m] = rec(m);
  builder.maybeSingle = () => { calls.maybeSingle.push(true); return Promise.resolve(next()); };
  builder.single = () => { calls.single.push(true); return Promise.resolve(next()); };
  builder.then = (res: (v: Res) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(next()).then(res, rej);
  const from = vi.fn((table: string) => { calls.from.push(table); return builder; });
  const rpc = vi.fn((fn: string, args?: unknown) => { calls.rpc.push(args ? [fn, args] : fn); return Promise.resolve(next()); });
  const storage = { upload: vi.fn(), remove: vi.fn(), createSignedUrl: vi.fn() };
  return {
    from, rpc, calls, results, push: (r: Res) => results.push(r),
    storageFrom: vi.fn(() => storage), storage,
  };
});

vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from, rpc: h.rpc, storage: { from: h.storageFrom } } }));

import {
  addItem, addOfficerEntry, answerChecklist, buildSafetyPhotoPath, correctDay, createDay, deleteFitness, deletePermit,
  deletePhoto, deleteTalk, getDay, getSummary, getSummaryDetail, isEnabled, listItems, parseSafetySummary, photoUrl,
  renameItem, rosterWorkers, saveFitness, savePermit, saveTalk, setEnabled, setItemArchived, setPermitState,
  submitDay, updateFitness, uploadTalkPhoto, workOrderDays,
} from './safetyDays';
import { AppError } from '@/src/lib/appError';

/** #2596 NFR: every summary figure is validated; a malformed or missing number is an error, never a plausible 0. */
const raw = { month: '2026-03-01', timezone: 'UTC', project_id: null, worked_minutes: 1200, safe_minutes: 600, lost_time_incidents: 1, recordable_incidents: 0,
  near_misses: 2, toolbox_talks: 4, complete_days: 3, days_without_record: 1, hidden: {} };

beforeEach(() => {
  h.from.mockClear(); h.rpc.mockClear();
  h.storage.upload.mockReset(); h.storage.remove.mockReset(); h.storage.createSignedUrl.mockReset();
  for (const k of Object.keys(h.calls) as (keyof typeof h.calls)[]) h.calls[k].length = 0;
  h.results.length = 0;
});

describe('parseSafetySummary', () => {
  it('maps the database figures', () => {
    expect(parseSafetySummary(raw)).toMatchObject({ workedMinutes: 1200, safeMinutes: 600, lostTimeIncidents: 1, daysWithoutRecord: 1, projectId: null });
  });
  it('keeps a hidden figure null with its reason', () => {
    const s = parseSafetySummary({ ...raw, worked_minutes: null, hidden: { worked_minutes: 'no attendance' } });
    expect(s.workedMinutes).toBeNull();
    expect(s.hidden.workedMinutes).toBe('no attendance');
  });
  it('refuses a missing or malformed count instead of defaulting to 0', () => {
    expect(() => parseSafetySummary({ ...raw, near_misses: undefined })).toThrow();
    expect(() => parseSafetySummary({ ...raw, toolbox_talks: 'many' })).toThrow();
    expect(() => parseSafetySummary({ ...raw, complete_days: -1 })).toThrow();
    expect(() => parseSafetySummary(null)).toThrow();
  });
});

describe('buildSafetyPhotoPath', () => {
  it('keys the object at org, day, photo and a sanitised file name', () => {
    expect(buildSafetyPhotoPath('o1', 'd1', 'p1', 'a b.png').split('/').slice(0, 3)).toEqual(['o1', 'd1', 'p1']);
  });
});

describe('the enable switch and the admin lists', () => {
  it('isEnabled is true only for an explicit true from the database', async () => {
    h.push({ data: true, error: null });
    await expect(isEnabled()).resolves.toBe(true);
    expect(h.calls.rpc).toEqual([['safety_records_enabled', {}]]);
    h.push({ data: null, error: null });
    await expect(isEnabled()).resolves.toBe(false);
  });

  it('setEnabled goes through its RPC with the boolean', async () => {
    h.push({ data: null, error: null });
    await setEnabled(false);
    expect(h.calls.rpc).toEqual([['set_safety_records_enabled', { p_enabled: false }]]);
  });

  it('listItems archives only on the admin request, ordered by position', async () => {
    h.push({ data: [{ id: 'i1', kind: 'check_type', label: 'PPE', position: 1, archived_at: null }], error: null });
    await expect(listItems('check_type')).resolves.toEqual([{ id: 'i1', kind: 'check_type', label: 'PPE', position: 1, archived_at: null }]);
    expect(h.calls.from).toEqual(['safety_list_items']);
    expect(h.calls.eq).toContainEqual(['kind', 'check_type']);
    expect(h.calls.is).toContainEqual(['archived_at', null]);
    expect(h.calls.order).toContain('position');
    expect(h.calls.range).toContainEqual([0, 999]);

    const isCalls = h.calls.is.length;
    h.push({ data: [], error: null });
    await listItems('permit_type', true);
    expect(h.calls.is.length).toBe(isCalls); // the admin editor sees archived entries too
  });

  it('add trims the label; rename trims; archive stamps or clears', async () => {
    h.push({ data: null, error: null });
    await addItem('checklist_item', '  Harness ok  ');
    expect(h.calls.insert).toEqual([{ kind: 'checklist_item', label: 'Harness ok' }]);
    h.push({ data: null, error: null });
    await renameItem('i1', '  New  ');
    expect(h.calls.update).toEqual([{ label: 'New' }]);
    expect(h.calls.eq).toContainEqual(['id', 'i1']);
    h.push({ data: null, error: null });
    await setItemArchived('i1', true);
    expect((h.calls.update.at(-1) as Record<string, unknown>).archived_at).toBeTruthy();
    h.push({ data: null, error: null });
    await setItemArchived('i1', false);
    expect((h.calls.update.at(-1) as Record<string, unknown>).archived_at).toBeNull();
  });

  it('a refused write raises the AppError with the database code', async () => {
    h.push({ data: null, error: { message: 'no', code: '23505' } });
    await expect(addItem('check_type', 'x')).rejects.toMatchObject({ code: '23505' });
    h.push({ data: null, error: { message: 'no', code: '23505' } });
    await expect(addItem('check_type', 'x')).rejects.toBeInstanceOf(AppError);
  });
});

describe('days', () => {
  it('workOrderDays normalises the crew figure and a missing missing-list', async () => {
    h.push({ data: [{ work_date: '2026-03-02', day_id: 'd1', status: 'draft', version: 1, workers_present: '7', missing: null, complete: false }], error: null });
    await expect(workOrderDays('wo1', '2026-03-01', '2026-03-07')).resolves.toEqual([
      { work_date: '2026-03-02', day_id: 'd1', status: 'draft', version: 1, workers_present: 7, missing: [], complete: false },
    ]);
    expect(h.calls.rpc).toEqual([['safety_work_order_days', { p_work_order_id: 'wo1', p_from: '2026-03-01', p_to: '2026-03-07' }]]);
  });

  it('createDay inserts only the two keys and returns the generated id', async () => {
    h.push({ data: { id: 'd1' }, error: null });
    await expect(createDay('wo1', '2026-03-02')).resolves.toBe('d1');
    expect(h.calls.insert).toEqual([{ work_order_id: 'wo1', work_date: '2026-03-02' }]);
    expect(h.calls.single).toHaveLength(1);
    expect(JSON.stringify(h.calls)).not.toContain('org_id');
  });

  it('getDay returns null for an absent day and otherwise assembles the detail with each talk owning its attendees and photos', async () => {
    h.push({ data: null, error: null });
    await expect(getDay('d0')).resolves.toBeNull();

    h.push({ data: { id: 'd1', org_id: 'o1' }, error: null }); // the day row
    h.push({ data: [{ id: 'f1', worker_id: 'w1', visitor_name: null, check_type_id: 'c1', result: 'fit', note: null }], error: null }); // fitness
    h.push({ data: [{ id: 't1', topic: 'Ladders', presenter: 'Dewi', held_at: '2026-03-02T08:00:00Z' }, { id: 't2', topic: 'Rigging', presenter: 'Budi', held_at: '2026-03-02T09:00:00Z' }], error: null }); // talks
    h.push({ data: [{ id: 'a1', talk_id: 't1', worker_id: 'w1', visitor_name: null }, { id: 'a2', talk_id: 't2', worker_id: null, visitor_name: 'Inspector' }], error: null }); // attendees
    h.push({ data: [{ id: 'p1', talk_id: 't1', file_path: 'o1/d1/ph/a.png' }], error: null }); // photos
    h.push({ data: [{ id: 'q1', label: 'Housekeeping', position: 1, answer: 'yes', note: null }], error: null }); // checklist
    h.push({ data: [{ id: 'pm1', permit_number: 'HW-1', type_id: 't', valid_from: '2026-03-02', valid_to: '2026-03-02', issued_by: 'w1', state: 'open' }], error: null }); // permits
    h.push({ data: [{ id: 'oe1', body: 'quiet day', near_misses: 0, observations: 1, incident_id: null, author_id: 'w1', created_at: '2026-03-02T10:00:00Z' }], error: null }); // officer
    const detail = await getDay('d1');
    expect(detail).not.toBeNull();
    expect(detail?.talks).toEqual([
      {
        id: 't1', topic: 'Ladders', presenter: 'Dewi', held_at: '2026-03-02T08:00:00Z',
        attendees: [{ id: 'a1', worker_id: 'w1', visitor_name: null }],
        photos: [{ id: 'p1', file_path: 'o1/d1/ph/a.png' }],
      },
      {
        id: 't2', topic: 'Rigging', presenter: 'Budi', held_at: '2026-03-02T09:00:00Z',
        attendees: [{ id: 'a2', worker_id: null, visitor_name: 'Inspector' }],
        photos: [],
      },
    ]);
    expect(detail?.fitness).toHaveLength(1);
    expect(detail?.checklist).toHaveLength(1);
    expect(detail?.permits).toHaveLength(1);
    expect(detail?.officer).toHaveLength(1);
    expect(h.calls.from.slice(0, 1)).toEqual(['safety_days']);
    expect(h.calls.from.slice(-7)).toEqual(['safety_fitness_checks', 'safety_toolbox_talks', 'safety_toolbox_attendees', 'safety_toolbox_photos', 'safety_checklist_answers', 'safety_permits', 'safety_officer_entries']);
  });

  it('rosterWorkers flattens the crew rosters, dedupes a worker in two crews, sorts by display name', async () => {
    h.push({
      data: [
        { members: [{ worker_id: 'w2', display_name: 'Budi' }, { worker_id: 'w1', display_name: 'Ani' }] },
        { members: [{ worker_id: 'w1', display_name: 'Ani' }, { worker_id: 'w3', display_name: 'Citra' }] },
        { members: null },
      ],
      error: null,
    });
    await expect(rosterWorkers('wo1', '2026-03-02')).resolves.toEqual([
      { worker_id: 'w1', display_name: 'Ani' },
      { worker_id: 'w2', display_name: 'Budi' },
      { worker_id: 'w3', display_name: 'Citra' },
    ]);
    expect(h.calls.rpc).toEqual([['work_order_roster', { p_work_order_id: 'wo1', p_date: '2026-03-02' }]]);
  });
});

describe('parts', () => {
  it('saveFitness blanks a whitespace note, nulls missing worker/visitor, and leaves the name as the form sent it', async () => {
    h.push({ data: null, error: null });
    await saveFitness('d1', { visitorName: 'Inspector', result: 'not_fit', note: '  ' });
    expect(h.calls.insert.at(-1)).toEqual({ day_id: 'd1', worker_id: null, visitor_name: 'Inspector', check_type_id: null, result: 'not_fit', note: null });
    h.push({ data: null, error: null });
    await saveFitness('d1', { workerId: 'w1', checkTypeId: 'c1', result: 'fit' });
    expect(h.calls.insert.at(-1)).toEqual({ day_id: 'd1', worker_id: 'w1', visitor_name: null, check_type_id: 'c1', result: 'fit', note: null });
  });

  it('updateFitness patches result and note by id; deleteFitness deletes by id', async () => {
    h.push({ data: null, error: null });
    await updateFitness('f1', { result: 'not_fit', note: ' BP ' });
    expect(h.calls.update).toEqual([{ result: 'not_fit', note: 'BP' }]);
    expect(h.calls.eq).toContainEqual(['id', 'f1']);
    h.push({ data: null, error: null });
    await deleteFitness('f1');
    expect(h.calls.delete.length).toBe(1);
    expect(h.calls.eq).toContainEqual(['id', 'f1']);
  });

  it('answerChecklist writes the answer and trimmed note', async () => {
    h.push({ data: null, error: null });
    await answerChecklist('q1', 'not_applicable', ' n/a ');
    expect(h.calls.update).toEqual([{ answer: 'not_applicable', note: 'n/a' }]);
  });

  it('saveTalk sends the trimmed payload with camelCase mapped to the RPC arguments', async () => {
    h.push({ data: 42, error: null });
    await expect(saveTalk('d1', { topic: ' Ladders ', presenter: ' Dewi ', heldAt: '2026-03-02T08:00:00Z', attendees: [{ workerId: 'w1' }, { visitorName: 'Insp' }] }))
      .resolves.toBe('42');
    expect(h.calls.rpc).toEqual([['safety_save_talk', {
      p_day: 'd1', p_topic: 'Ladders', p_presenter: 'Dewi', p_held_at: '2026-03-02T08:00:00Z',
      p_attendees: [{ worker_id: 'w1', visitor_name: null }, { worker_id: null, visitor_name: 'Insp' }],
    }]]);
  });

  it('permits: save trims, set state writes the state, delete deletes; talks delete by id', async () => {
    h.push({ data: null, error: null });
    await savePermit('d1', { permitNumber: ' HW-2 ', validFrom: '2026-03-02', validTo: '2026-03-03', issuedBy: ' w1 ', typeId: 't1' });
    expect(h.calls.insert).toEqual([{ day_id: 'd1', permit_number: 'HW-2', type_id: 't1', valid_from: '2026-03-02', valid_to: '2026-03-03', issued_by: 'w1' }]);
    h.push({ data: null, error: null });
    await setPermitState('pm1', 'closed');
    expect(h.calls.update).toEqual([{ state: 'closed' }]);
    h.push({ data: null, error: null });
    await deletePermit('pm1');
    expect(h.calls.delete.length).toBe(1);
    h.push({ data: null, error: null });
    await deleteTalk('t1');
    expect(h.calls.from).toContain('safety_toolbox_talks');
    expect(h.calls.eq).toContainEqual(['id', 't1']);
  });

  it('addOfficerEntry trims the body and nulls an absent incident', async () => {
    h.push({ data: null, error: null });
    await addOfficerEntry('d1', { body: ' Quiet ', nearMisses: 1, observations: 2 });
    expect(h.calls.insert).toEqual([{ day_id: 'd1', body: 'Quiet', near_misses: 1, observations: 2, incident_id: null }]);
  });

  it('submit goes through its RPC; correct passes the reason and returns the new day id', async () => {
    h.push({ data: null, error: null });
    await submitDay('d1');
    expect(h.calls.rpc).toEqual([['submit_safety_day', { p_day: 'd1' }]]);
    h.push({ data: 'd2', error: null });
    await expect(correctDay('d1', 'wrong roster')).resolves.toBe('d2');
    expect(h.calls.rpc.at(-1)).toEqual(['correct_safety_day', { p_day: 'd1', p_reason: 'wrong roster' }]);
  });
});

describe('photos', () => {
  it('upload records the row after the object and rolls the object back when the row refuses', async () => {
    const file = new File(['x'], 'a b.png', { type: 'image/png' });
    h.storage.upload.mockResolvedValue({ data: { path: 'p' }, error: null });
    h.push({ data: null, error: { message: 'row refused', code: '23503' } });
    await expect(uploadTalkPhoto({ id: 'd1', org_id: 'o1' }, 't1', file)).rejects.toMatchObject({ code: '23503' });
    expect(h.storageFrom).toHaveBeenCalledWith('safety-photos');
    expect(h.storage.upload).toHaveBeenCalledTimes(1);
    const upPath = h.storage.upload.mock.calls[0]![0] as string;
    expect(upPath).toMatch(/^o1\/d1\/[0-9a-f-]{36}\/a-b\.png$/); // the file name is sanitised
    expect(h.storage.remove).toHaveBeenCalledWith([upPath]);
    expect(h.calls.insert).toEqual([{ id: expect.any(String), day_id: 'd1', talk_id: 't1', file_path: upPath }]);
  });

  it('upload refuses a failed object upload before any row is written', async () => {
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    h.storage.upload.mockResolvedValue({ data: null, error: { message: 'bucket denied' } });
    await expect(uploadTalkPhoto({ id: 'd1', org_id: 'o1' }, 't1', file)).rejects.toBeInstanceOf(AppError);
    expect(h.calls.insert).toEqual([]);
  });

  it('photoUrl signs for the shared expiry and refuses to invent a url', async () => {
    h.storage.createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://signed/p' }, error: null });
    await expect(photoUrl('o1/d1/p/a.png')).resolves.toBe('https://signed/p');
    expect(h.storage.createSignedUrl).toHaveBeenCalledWith('o1/d1/p/a.png', expect.any(Number));
    h.storage.createSignedUrl.mockResolvedValue({ data: null, error: { message: 'gone' } });
    await expect(photoUrl('x')).rejects.toMatchObject({ message: 'gone' });
  });

  it('deletePhoto deletes by id', async () => {
    h.push({ data: null, error: null });
    await deletePhoto('p1');
    expect(h.calls.from).toEqual(['safety_toolbox_photos']);
    expect(h.calls.eq).toContainEqual(['id', 'p1']);
  });
});

describe('the monthly summary reads', () => {
  it('getSummary sends the project/month keys and parses the figures', async () => {
    h.push({ data: raw, error: null });
    await expect(getSummary('p1', '2026-03-01')).resolves.toMatchObject({ workedMinutes: 1200, month: '2026-03-01' });
    expect(h.calls.rpc).toEqual([['get_safety_summary', { p_project: 'p1', p_month: '2026-03-01' }]]);
    h.push({ data: raw, error: null });
    await expect(getSummary(null, null)).resolves.toBeTruthy();
    expect(h.calls.rpc.at(-1)).toEqual(['get_safety_summary', { p_project: null, p_month: null }]);
  });

  it('a malformed summary from the database is an error, never a plausible zero report', async () => {
    h.push({ data: { ...raw, lost_time_incidents: 'three' }, error: null });
    await expect(getSummary('p1', '2026-03-01')).rejects.toBeInstanceOf(AppError);
  });

  it('getSummaryDetail passes the kind and tolerates a null set', async () => {
    h.push({ data: null, error: null });
    await expect(getSummaryDetail('toolbox_talks', 'p1', '2026-03-01')).resolves.toEqual([]);
    expect(h.calls.rpc).toEqual([['get_safety_summary_detail', { p_kind: 'toolbox_talks', p_project: 'p1', p_month: '2026-03-01' }]]);
  });
});
