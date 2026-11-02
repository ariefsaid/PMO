import { describe, it, expect, vi } from 'vitest';
import { en } from '@blocknote/core/locales';
import { BlockNoteEditor } from '@blocknote/core';
import { minutesSchema } from './minutesSchema';
import { minutesSlashItems } from './minutesSlashMenu';
import { minutesDictionary } from './minutesDictionary';

const editor = () => BlockNoteEditor.create({ schema: minutesSchema });
const t = ((_key: string, fallback: string) => fallback) as never;

describe('minutesDictionary (FR-MTG-023)', () => {
  it('AC-MTG-025 under id, no palette slash entry keeps its English title, subtext or group', () => {
    const id = minutesDictionary('id');
    const items = minutesSlashItems(editor(), { t, tasksExternal: false, onRequestAction: vi.fn() });
    const paletteKeys = items
      .map((i) => (i as { key?: string }).key)
      .filter((k): k is keyof typeof en.slash_menu => Boolean(k && k in en.slash_menu));

    expect(paletteKeys.length).toBeGreaterThan(0);
    for (const k of paletteKeys) {
      const e = en.slash_menu[k];
      const trans = id.slash_menu[k];
      // 'Emoji' is a loanword; every other title/subtext/group must differ from English.
      if (k !== 'emoji') expect(trans.title, `${k}.title`).not.toBe(e.title);
      expect(trans.subtext, `${k}.subtext`).not.toBe(e.subtext);
      expect(trans.group, `${k}.group`).not.toBe(e.group);
    }
  });

  it('AC-MTG-025 slash aliases are translated and keep the English ones (muscle memory)', () => {
    const id = minutesDictionary('id');
    expect(id.slash_menu.table.aliases).toContain('tabel');
    expect(id.slash_menu.heading.aliases).toContain('judul');
  });

  it('AC-MTG-025 toolbar, placeholders and table menus are Bahasa under id', () => {
    const id = minutesDictionary('id-ID');
    expect(id.formatting_toolbar.bold.tooltip).toBe('Tebal');
    expect(id.placeholders.default).toMatch(/Ketik/);
    expect(id.table_handle.delete_row_menuitem).toBe('Hapus baris');
    // untouched shortcut hints survive the merge
    expect(id.formatting_toolbar.bold.secondary_tooltip).toBe('Mod+B');
  });

  it('every other locale gets the stock English dictionary (placeholders aside)', () => {
    expect({ ...minutesDictionary('en'), placeholders: null }).toEqual({ ...en, placeholders: null });
    expect({ ...minutesDictionary(undefined), placeholders: null }).toEqual({ ...en, placeholders: null });
  });

  // BlockNote paints a per-block-type placeholder ("List", "Heading"…) on EVERY empty block of that type, focused or
  // not, and even in a read-only view. Only the `default` (focused block) and `emptyDocument` keys are focus-scoped.
  it.each(['en', 'id'])('AC-MTG-022 (%s) only focus-scoped placeholders remain — no "List" on every empty bullet', (lang) => {
    const keys = Object.keys(minutesDictionary(lang).placeholders);
    for (const k of ['bulletListItem', 'numberedListItem', 'checkListItem', 'toggleListItem', 'heading']) {
      expect(keys, k).not.toContain(k);
    }
    expect(minutesDictionary(lang).placeholders.default).toBeTruthy();
  });
});
