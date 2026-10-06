import { describe, it, expect } from 'vitest';
import { en } from '@blocknote/core/locales';
import { minutesDictionary, PALETTE_SLASH_KEYS } from './minutesDictionary';

describe('minutesDictionary (FR-MTG-023)', () => {
  it('AC-MTG-025 under id, no palette slash entry keeps its English title, subtext or group', () => {
    const id = minutesDictionary('id');
    for (const k of PALETTE_SLASH_KEYS) {
      const e = en.slash_menu[k];
      const t = id.slash_menu[k];
      // 'Emoji' is a loanword; every other title/subtext/group must differ from English.
      if (k !== 'emoji') expect(t.title, `${k}.title`).not.toBe(e.title);
      expect(t.subtext, `${k}.subtext`).not.toBe(e.subtext);
      expect(t.group, `${k}.group`).not.toBe(e.group);
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

  it('every other locale gets the stock English dictionary', () => {
    expect(minutesDictionary('en')).toBe(en);
    expect(minutesDictionary(undefined)).toBe(en);
  });
});
