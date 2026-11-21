import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const queue: Array<{ data: unknown; error: unknown }> = [];
  const rpc = vi.fn(async () => queue.shift() ?? { data: null, error: null });
  return { rpc, queue, upload: vi.fn(), remove: vi.fn() };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc, storage: { from: () => ({ upload: h.upload, remove: h.remove }) } } }));

import { buildCheckpointPhotoPath, getCrewPunctuality, getLostTimeByCause, listDayCheckpoints, recordCheckpoint, setCheckpointList } from './siteCheckpoints';

beforeEach(() => { h.queue.length = 0; h.rpc.mockClear(); h.upload.mockReset(); h.remove.mockReset(); });

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
