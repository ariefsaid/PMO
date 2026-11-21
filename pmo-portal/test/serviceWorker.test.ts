import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SW_PATH = path.resolve(__dirname, '../public/sw.js');

describe('Minimal Service Worker (#2713)', () => {
  it('AC-PWA-004: sw.js exists, handles install/activate/fetch, and performs NO offline caching of data', () => {
    expect(fs.existsSync(SW_PATH), 'public/sw.js must exist').toBe(true);
    const swContent = fs.readFileSync(SW_PATH, 'utf8');

    // Event listeners
    expect(swContent).toMatch(/addEventListener\(\s*['"]install['"]/);
    expect(swContent).toMatch(/addEventListener\(\s*['"]activate['"]/);
    expect(swContent).toMatch(/addEventListener\(\s*['"]fetch['"]/);

    // Lifecycle handling: skipWaiting and clients.claim
    expect(swContent).toMatch(/skipWaiting/);
    expect(swContent).toMatch(/clients\.claim/);

    // CRITICAL: Explicitly NO offline caching of data (#2713 / OD-SCOPE-15 / OD-SCOPE-16)
    // No CacheStorage API writes
    expect(swContent).not.toMatch(/caches\.open/);
    expect(swContent).not.toMatch(/cache\.put/);
    expect(swContent).not.toMatch(/cache\.add/);
    expect(swContent).not.toMatch(/cache\.addAll/);
    // No IndexedDB usage
    expect(swContent).not.toMatch(/indexedDB/i);
  });
});
