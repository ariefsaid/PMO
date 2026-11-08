import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const notesCss = stripComments(readFileSync(resolve(__dirname, 'richNote.css'), 'utf8'));
const appCss = stripComments(readFileSync(resolve(__dirname, '../../../index.css'), 'utf8'));

/**
 * #2062 — the same cascade-layer contract the minutes editor's sheet carries (#864): the lazy
 * notes-editor chunk ships BlockNote's own utilities, and its stylesheet loads AFTER the app's.
 * Inside one shared cascade layer the later sheet wins ties, so those utilities must live in a
 * layer of their own — ordered BELOW the app's `utilities` (the app's responsive variants win)
 * and ABOVE `components` (BlockNote's utilities still beat preflight). If `notes-editor` is ever
 * dropped from index.css's order statement, the lazy sheet's layer would be appended at load
 * time and win every tie against the app — the exact regression that hid the phone Back bar.
 */
describe('richNote.css — cascade layer (#2062, #864 pattern)', () => {
  const layerMatch = notesCss.match(/@import\s+["']tailwindcss\/utilities\.css["']\s+layer\(([\w-]+)\)/);
  const notesLayer = layerMatch?.[1];

  it('imports BlockNote’s utilities into a layer of their own, not the app’s `utilities`', () => {
    expect(notesLayer).toBeDefined();
    expect(notesLayer).not.toBe('utilities');
    // the scoping keeps nothing global: the sheet is imported by the lazy editor module only
    expect(notesCss).toMatch(/@source\s+["'][^"']*@blocknote\/shadcn\/dist["']/);
  });

  it('index.css orders that layer below the app’s `utilities`, before Tailwind declares its layers', () => {
    const order = appCss.match(/@layer\s+([\w\s,-]+);/);
    expect(order).not.toBeNull();
    expect(appCss.indexOf(order![0])).toBeLessThan(appCss.indexOf('@import "tailwindcss"'));
    const layers = order![1].split(',').map((l) => l.trim());
    expect(layers).toContain(notesLayer);
    expect(layers.indexOf(notesLayer!)).toBeLessThan(layers.indexOf('utilities'));
    expect(layers.indexOf(notesLayer!)).toBeGreaterThan(layers.indexOf('components'));
  });
});
