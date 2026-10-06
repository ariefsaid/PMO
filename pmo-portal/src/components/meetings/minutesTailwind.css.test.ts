import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const minutesCss = stripComments(readFileSync(resolve(__dirname, 'minutesTailwind.css'), 'utf8'));
const appCss = stripComments(readFileSync(resolve(__dirname, '../../../index.css'), 'utf8'));

/**
 * The editor chunk's stylesheet loads AFTER the app's. Inside one cascade layer the later sheet wins
 * ties, so re-emitting BlockNote's utilities (`.hidden`, `.flex`, …) into the app's `utilities` layer
 * overrode the app's responsive variants app-wide once a meeting was opened — e.g. the phone Back bar
 * (`hidden max-[920px]:block`) vanished. Layer ORDER, not document order, must decide that tie.
 */
describe('minutesTailwind.css — cascade layer (#864)', () => {
  const layerMatch = minutesCss.match(/@import\s+["']tailwindcss\/utilities\.css["']\s+layer\(([\w-]+)\)/);
  const minutesLayer = layerMatch?.[1];

  it('imports BlockNote’s utilities into a layer of their own, not the app’s `utilities`', () => {
    expect(minutesLayer).toBeDefined();
    expect(minutesLayer).not.toBe('utilities');
  });

  it('index.css orders that layer below the app’s `utilities`, before Tailwind declares its layers', () => {
    const order = appCss.match(/@layer\s+([\w\s,-]+);/);
    expect(order).not.toBeNull();
    // The order statement must precede `@import "tailwindcss"`, whose own statement would otherwise
    // fix the order first (a layer's priority is set where it is first declared).
    expect(appCss.indexOf(order![0])).toBeLessThan(appCss.indexOf('@import "tailwindcss"'));
    const layers = order![1].split(',').map((l) => l.trim());
    expect(layers).toContain(minutesLayer);
    expect(layers.indexOf(minutesLayer!)).toBeLessThan(layers.indexOf('utilities'));
    // …and above the app's base/components, so BlockNote's own utilities still beat preflight.
    expect(layers.indexOf(minutesLayer!)).toBeGreaterThan(layers.indexOf('components'));
  });
});
