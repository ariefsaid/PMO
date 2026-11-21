import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const INDEX_HTML_PATH = path.resolve(__dirname, '../index.html');

describe('PWA HTML Link & Meta Tags (#2713)', () => {
  it('AC-PWA-003: index.html references manifest, favicon, apple-touch-icon, and theme-color', () => {
    expect(fs.existsSync(INDEX_HTML_PATH), 'index.html must exist').toBe(true);
    const html = fs.readFileSync(INDEX_HTML_PATH, 'utf8');

    // Manifest link
    expect(html).toMatch(/<link\s+[^>]*rel=["']manifest["'][^>]*href=["']\/manifest\.webmanifest["']/);

    // Favicon link (SVG)
    expect(html).toMatch(/<link\s+[^>]*rel=["']icon["'][^>]*href=["']\/favicon\.svg["']/);

    // Apple touch icon
    expect(html).toMatch(/<link\s+[^>]*rel=["']apple-touch-icon["'][^>]*href=["']\/apple-touch-icon\.png["']/);

    // Theme color matching DESIGN.md primary token
    expect(html).toMatch(/<meta\s+[^>]*name=["']theme-color["'][^>]*content=["']#4B61DC["']/);

    // Mobile web app capability
    expect(html).toMatch(/<meta\s+[^>]*name=["']apple-mobile-web-app-capable["'][^>]*content=["']yes["']/);
    expect(html).toMatch(/<meta\s+[^>]*name=["']apple-mobile-web-app-title["'][^>]*content=["']PMO["']/);
  });
});
