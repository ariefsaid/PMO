import { describe, expect, it } from 'vitest';
import { draftsToItems, type Draft } from './siteCheckpointDraft';

const d = (over: Partial<Draft> = {}): Draft => ({ name: 'Gate', time: '06:30', grace: '10', photo: true, start: false, ...over });

describe('checkpoint list draft', () => {
  it('turns typed rows into items in order', () => {
    expect(draftsToItems([d(), d({ name: ' Start ', time: '07:00', grace: '', start: true, photo: false })])).toEqual({
      items: [
        { name: 'Gate', marks_work_start: false, due_time: '06:30', grace_minutes: 10, photo_required: true },
        { name: 'Start', marks_work_start: true, due_time: '07:00', grace_minutes: 0, photo_required: false },
      ],
    });
  });
  it('names the first thing wrong', () => {
    expect(draftsToItems([d({ name: ' ' })])).toEqual({ error: 'name' });
    expect(draftsToItems([d({ time: '' })])).toEqual({ error: 'time' });
    expect(draftsToItems([d({ grace: '121' })])).toEqual({ error: 'grace' });
    expect(draftsToItems([d({ grace: '1.5' })])).toEqual({ error: 'grace' });
    expect(draftsToItems([d({ start: true }), d({ start: true })])).toEqual({ error: 'start' });
  });
  it('accepts an empty list: the feature is off', () => {
    expect(draftsToItems([])).toEqual({ items: [] });
  });
});
