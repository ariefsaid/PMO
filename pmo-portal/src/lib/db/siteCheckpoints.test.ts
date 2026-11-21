import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const queue: Array<{ data: unknown; error: unknown }> = [];
  const rpc = vi.fn(async () => queue.shift() ?? { data: null, error: null });
  const calls: Record<string, unknown[]> = { from: [], select: [], eq: [], order: [], limit: [], maybeSingle: [] };
  const builder: Record<string, unknown> = {};
  const next = () => queue.shift() ?? { data: null, error: null };
  for (const m of ['select', 'eq', 'order', 'limit'] as const) builder[m] = (...a: unknown[]) => { calls[m].push(a.length <= 1 ? a[0] : a); return builder; };
  builder.maybeSingle = () => { calls.maybeSingle.push(true); return Promise.resolve(next()); };
  builder.then = (res: (v: { data: unknown; error: unknown }) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(next()).then(res, rej);
  const from = vi.fn((t: string) => { calls.from.push(t); return builder; });
  return { rpc, queue, upload: vi.fn(), remove: vi.fn(), signed: vi.fn(), from, calls };
});
vi.mock('@/src/lib/supabase/client', () => ({
  supabase: {
    rpc: h.rpc,
    from: h.from,
    storage: { from: () => ({ upload: h.upload, remove: h.remove, createSignedUrl: h.signed }) },
  },
}));

import { buildCheckpointPhotoPath, checkpointPhotoUrl, getCheckpointList, getCrewPunctuality, getCheckpointRecordRefs, getLostTimeByCause, getWorkOrderFlag, listDayCheckpoints, recordCheckpoint, setCheckpointList } from './siteCheckpoints';

beforeEach(() => {
  h.queue.length = 0; h.rpc.mockClear(); h.upload.mockReset(); h.remove.mockReset(); h.from.mockClear();
  for (const k of Object.keys(h.calls) as (keyof typeof h.calls)[]) h.calls[k].length = 0;
});

const refs = { id: 'c1', org_id: 'o1', work_order_id: 'w1', crew_id: 'cr1', work_date: '2026-03-10' };

describe('siteCheckpoints DAL', () => {
  it('builds the photo path the bucket policy expects', () => {
    expect(buildCheckpointPhotoPath(refs, new File(['x'], 'Photo One.JPG'))).toBe('o1/w1/cr1/2026-03-10/c1.jpg');
    expect(buildCheckpointPhotoPath(refs, new File(['x'], 'noext', { type: 'image/png' }))).toBe('o1/w1/cr1/2026-03-10/c1.png');
  });

  it('records without a time: the call carries only the checkpoint, the photo path and the note', async () => {
    h.upload.mockResolvedValue({ error: null });
    h.queue.push({ data: null, error: null });
    await recordCheckpoint({ checkpoint: refs, file: new File(['x'], 'p.jpg'), note: 'hi' });
    expect(h.rpc).toHaveBeenCalledWith('record_site_checkpoint', { p_checkpoint: 'c1', p_photo_path: 'o1/w1/cr1/2026-03-10/c1.jpg', p_note: 'hi' });
  });

  it('removes the uploaded photo when the record is refused, and keeps the Postgres code', async () => {
    h.upload.mockResolvedValue({ error: null });
    h.queue.push({ data: null, error: { message: 'not yours', code: '42501' } });
    await expect(recordCheckpoint({ checkpoint: refs, file: new File(['x'], 'p.jpg'), note: null })).rejects.toMatchObject({ code: '42501' });
    expect(h.remove).toHaveBeenCalledWith(['o1/w1/cr1/2026-03-10/c1.jpg']);
  });

  it('does not record when the upload fails', async () => {
    h.upload.mockResolvedValue({ error: { message: 'too large' } });
    await expect(recordCheckpoint({ checkpoint: refs, file: new File(['x'], 'p.jpg'), note: null })).rejects.toThrow('too large');
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it('sends the whole list and returns the saved count', async () => {
    h.queue.push({ data: 2, error: null });
    expect(await setCheckpointList([{ name: 'A', marks_work_start: false, due_time: '06:00', grace_minutes: 0, photo_required: true }])).toBe(2);
  });

  it('refuses a malformed day row instead of defaulting a field', async () => {
    h.queue.push({ data: [{ id: 'c1' }], error: null });
    await expect(listDayCheckpoints('w1', '2026-03-10')).rejects.toThrow(/Unexpected/);
  });

  it('reads the crews view and the lost-time breakdown', async () => {
    h.queue.push({ data: { from: 'a', to: 'b', truncated: false, crews: [{ crew_id: 'x', crew_name: 'X', days: 3, on_time: 1, share_on_time: 0.3333,
      day_rows: [{ work_date: '2026-02-02', work_order_id: 'w', due_at: 'd', recorded_at: null, status: 'not_started', minutes_late: null }] }] }, error: null });
    expect((await getCrewPunctuality({ from: 'a', to: 'b' })).crews[0].day_rows[0].status).toBe('not_started');
    h.queue.push({ data: { from: 'a', to: 'b', total_minutes: 135, report_count: 2, rows: [{ reason_id: 'r', label: 'Cause A', archived: false, minutes: 90 }] }, error: null });
    expect((await getLostTimeByCause({ from: 'a', to: 'b' })).rows[0]).toMatchObject({ label: 'Cause A', minutes: 90 });
  });

  it('surfaces a refused read with its code', async () => {
    h.queue.push({ data: null, error: { message: 'no', code: '42501' } });
    await expect(getLostTimeByCause({ from: 'a', to: 'b' })).rejects.toMatchObject({ code: '42501' });
  });
});

describe('siteCheckpoints template list, flag, photo and record refs', () => {
  it('the template list maps every column and truncates 07:00:00 to a time-input value', async () => {
    h.queue.push({ data: [{ name: 'Start', marks_work_start: true, due_time: '07:00:00', grace_minutes: 10, photo_required: false }], error: null });
    await expect(getCheckpointList()).resolves.toEqual([
      { name: 'Start', marks_work_start: true, due_time: '07:00', grace_minutes: 10, photo_required: false },
    ]);
    expect(h.calls.from).toEqual(['site_checkpoint_templates']);
    expect(h.calls.order).toContainEqual(['position', { ascending: true }]);
    expect(h.calls.limit).toContainEqual(12);
  });

  it('a non-array or malformed template row is refused, never defaulted', async () => {
    h.queue.push({ data: null, error: null }); // not an array
    await expect(getCheckpointList()).rejects.toThrow(/Unexpected/);
    h.queue.push({ data: [{ name: 'A' }], error: null }); // missing columns
    await expect(getCheckpointList()).rejects.toThrow(/Unexpected/);
  });

  it('the work order flag is a boolean from its RPC; a date is passed only when given', async () => {
    h.queue.push({ data: true, error: null });
    await expect(getWorkOrderFlag('w1')).resolves.toBe(true);
    expect(h.rpc).toHaveBeenLastCalledWith('work_order_checkpoint_flag', { p_work_order: 'w1', p_date: null });
    h.queue.push({ data: false, error: null });
    await expect(getWorkOrderFlag('w1', '2026-03-10')).resolves.toBe(false);
    expect(h.rpc).toHaveBeenLastCalledWith('work_order_checkpoint_flag', { p_work_order: 'w1', p_date: '2026-03-10' });
    h.queue.push({ data: 'yes', error: null });
    await expect(getWorkOrderFlag('w1')).rejects.toThrow(/Unexpected/);
  });

  it('a photo opens only through a signed link, else refuses', async () => {
    h.signed.mockResolvedValue({ data: { signedUrl: 'https://signed/cp' }, error: null });
    await expect(checkpointPhotoUrl('o/w/c/d/c1.jpg')).resolves.toBe('https://signed/cp');
    h.signed.mockResolvedValue({ data: null, error: { message: 'gone' } });
    await expect(checkpointPhotoUrl('x')).rejects.toThrow('gone');
  });

  it('the record refs read gives exactly the columns the record call needs; an absent row is refused', async () => {
    h.queue.push({ data: refs, error: null });
    await expect(getCheckpointRecordRefs('c1')).resolves.toEqual(refs);
    expect(h.calls.from).toEqual(['site_checkpoints']);
    expect(h.calls.eq).toContainEqual(['id', 'c1']);
    h.queue.push({ data: null, error: null });
    await expect(getCheckpointRecordRefs('c1')).rejects.toThrow(/Unexpected/);
  });

  it('punctuality maps minutes late as a number or null, and refuses an unknown status', async () => {
    h.queue.push({ data: { from: 'a', to: 'b', truncated: true, crews: [{ crew_id: 'x', crew_name: 'X', days: 2, on_time: 1, share_on_time: 0.5,
      day_rows: [
        { work_date: 'd1', work_order_id: 'w', due_at: '07:00', recorded_at: '07:05', status: 'late', minutes_late: 5 },
        { work_date: 'd2', work_order_id: 'w', due_at: '07:00', recorded_at: '06:55', status: 'on_time', minutes_late: null },
      ] }] }, error: null });
    const res = await getCrewPunctuality({ from: 'a', to: 'b' });
    expect(res.truncated).toBe(true);
    expect(res.crews[0].day_rows[0]).toMatchObject({ status: 'late', minutes_late: 5 });
    expect(res.crews[0].day_rows[1]).toMatchObject({ status: 'on_time', minutes_late: null });
    h.queue.push({ data: { from: 'a', to: 'b', truncated: false, crews: [{ crew_id: 'x', crew_name: 'X', days: 1, on_time: 0, share_on_time: 0,
      day_rows: [{ work_date: 'd1', work_order_id: 'w', due_at: '07:00', recorded_at: null, status: 'ghost', minutes_late: null }] }] }, error: null });
    await expect(getCrewPunctuality({ from: 'a', to: 'b' })).rejects.toThrow(/Unexpected/);
  });
});
