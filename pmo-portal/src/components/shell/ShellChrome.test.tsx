/**
 * ShellChrome palette "Views" group unit test.
 * AC-VR-016 (FR-VR-070, FR-VR-071, FR-VR-072, FR-VR-073)
 *
 * Tests the buildViewsPaletteItems() pure helper extracted in App.tsx.
 */
import { describe, it, expect } from 'vitest';
import { buildViewsPaletteItems } from '@/src/lib/viewspec/paletteItems';
import type { UserViewRow } from '@/src/lib/db/userViews';

// Minimal stub of the fields we use from UserViewRow
const makeView = (id: string, name: string, description: string | null = null): Pick<UserViewRow, 'id' | 'name' | 'description'> =>
  ({ id, name, description } as Pick<UserViewRow, 'id' | 'name' | 'description'>);

describe('buildViewsPaletteItems — AC-VR-016', () => {
  it('returns Views palette items when feature is on and views exist', () => {
    const views = [makeView('v1', 'Revenue View', 'Monthly revenue')];
    const items = buildViewsPaletteItems(views, () => {});
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('view-v1');
    expect(items[0].group).toBe('Views');
    expect(items[0].title).toBe('Revenue View');
    expect(items[0].sub).toBe('Monthly revenue');
    expect(items[0].icon).toBe('grid');
  });

  it('returns empty array when views is empty or undefined', () => {
    expect(buildViewsPaletteItems([], () => {})).toEqual([]);
    expect(buildViewsPaletteItems(undefined, () => {})).toEqual([]);
  });

  it('sub is undefined when description is null', () => {
    const items = buildViewsPaletteItems([makeView('v1', 'My View')], () => {});
    expect(items[0].sub).toBeUndefined();
  });

  it('includes all views (no cap unlike the rail)', () => {
    const views = Array.from({ length: 20 }, (_, i) => makeView(`v${i}`, `View ${i}`));
    const items = buildViewsPaletteItems(views, () => {});
    expect(items).toHaveLength(20);
  });
});
