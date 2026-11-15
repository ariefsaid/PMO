import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** #2125: figures people read are drawn on the first painted frame, with or without reduced motion. */
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

const chartFiles = ['src', 'pages', 'components']
  .flatMap(walk)
  .filter((f) => /\.tsx$/.test(f) && !/\.test\./.test(f) && !f.includes('__tests__'))
  .filter((f) => /from 'recharts'/.test(readFileSync(f, 'utf8')));

describe('#2125 charts render without entrance animation', () => {
  it('finds the recharts files', () => {
    expect(chartFiles.length).toBeGreaterThanOrEqual(5);
  });

  it.each(chartFiles)('%s: every Bar/Line/Area/Pie series turns animation off', (f) => {
    const src = readFileSync(f, 'utf8');
    const tags = src.match(/<(Bar|Line|Area|Pie|Scatter|Radar)\b[^>]*?>/gs) ?? [];
    for (const tag of tags) expect(tag, tag.slice(0, 80)).toContain('isAnimationActive={false}');
    expect(src).not.toMatch(/isAnimationActive=\{!/);
    expect(src).not.toContain('usePrefersReducedMotion');
  });
});
