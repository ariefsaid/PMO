import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const PUBLIC_DIR = path.resolve(__dirname, '../public');
const MANIFEST_PATH = path.join(PUBLIC_DIR, 'manifest.webmanifest');

function readPngDimensions(filePath: string): { width: number; height: number } {
  const buffer = fs.readFileSync(filePath);
  // PNG signature: 89 50 4E 47 0D 0A 1A 0A
  const isPng =
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a;
  if (!isPng) {
    throw new Error(`${filePath} is not a valid PNG`);
  }
  // IHDR chunk starts at offset 12, width at 16 (4 bytes), height at 20 (4 bytes)
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return { width, height };
}

describe('Web App Manifest & Icon Assets (#2713)', () => {
  it('AC-PWA-001: manifest exists, is valid JSON, and declares required PWA metadata', () => {
    expect(fs.existsSync(MANIFEST_PATH), 'manifest.webmanifest must exist').toBe(true);
    const content = fs.readFileSync(MANIFEST_PATH, 'utf8');
    const manifest = JSON.parse(content);

    expect(manifest.name).toBe('PMO Portal');
    expect(manifest.short_name).toBe('PMO');
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
    expect(manifest.display).toBe('standalone');
    expect(manifest.background_color).toBe('#ffffff');
    expect(manifest.theme_color).toBe('#4B61DC');

    expect(Array.isArray(manifest.icons)).toBe(true);
    expect(manifest.icons.length).toBeGreaterThanOrEqual(4);

    const icon192Any = manifest.icons.find(
      (icon: { sizes: string; purpose?: string }) =>
        icon.sizes === '192x192' && (!icon.purpose || icon.purpose.includes('any'))
    );
    expect(icon192Any, '192x192 any-purpose icon').toBeDefined();

    const icon512Any = manifest.icons.find(
      (icon: { sizes: string; purpose?: string }) =>
        icon.sizes === '512x512' && (!icon.purpose || icon.purpose.includes('any'))
    );
    expect(icon512Any, '512x512 any-purpose icon').toBeDefined();

    const icon192Maskable = manifest.icons.find(
      (icon: { sizes: string; purpose?: string }) =>
        icon.sizes === '192x192' && icon.purpose?.includes('maskable')
    );
    expect(icon192Maskable, '192x192 maskable icon').toBeDefined();

    const icon512Maskable = manifest.icons.find(
      (icon: { sizes: string; purpose?: string }) =>
        icon.sizes === '512x512' && icon.purpose?.includes('maskable')
    );
    expect(icon512Maskable, '512x512 maskable icon').toBeDefined();
  });

  it('AC-PWA-002: required icon assets exist on disk with valid formats and dimensions', () => {
    // Favicon SVG exists and has SVG markup
    const faviconPath = path.join(PUBLIC_DIR, 'favicon.svg');
    expect(fs.existsSync(faviconPath), 'favicon.svg must exist').toBe(true);
    const faviconContent = fs.readFileSync(faviconPath, 'utf8');
    expect(faviconContent).toContain('<svg');
    expect(faviconContent).toContain('#4B61DC');

    // Apple touch icon exists and is 180x180 PNG
    const appleTouchPath = path.join(PUBLIC_DIR, 'apple-touch-icon.png');
    expect(fs.existsSync(appleTouchPath), 'apple-touch-icon.png must exist').toBe(true);
    const appleDims = readPngDimensions(appleTouchPath);
    expect(appleDims.width).toBe(180);
    expect(appleDims.height).toBe(180);

    // 192x192 any and maskable
    const icon192Path = path.join(PUBLIC_DIR, 'icon-192.png');
    expect(fs.existsSync(icon192Path), 'icon-192.png must exist').toBe(true);
    const dims192 = readPngDimensions(icon192Path);
    expect(dims192.width).toBe(192);
    expect(dims192.height).toBe(192);

    const icon192MaskablePath = path.join(PUBLIC_DIR, 'icon-192-maskable.png');
    expect(fs.existsSync(icon192MaskablePath), 'icon-192-maskable.png must exist').toBe(true);
    const dims192M = readPngDimensions(icon192MaskablePath);
    expect(dims192M.width).toBe(192);
    expect(dims192M.height).toBe(192);

    // 512x512 any and maskable
    const icon512Path = path.join(PUBLIC_DIR, 'icon-512.png');
    expect(fs.existsSync(icon512Path), 'icon-512.png must exist').toBe(true);
    const dims512 = readPngDimensions(icon512Path);
    expect(dims512.width).toBe(512);
    expect(dims512.height).toBe(512);

    const icon512MaskablePath = path.join(PUBLIC_DIR, 'icon-512-maskable.png');
    expect(fs.existsSync(icon512MaskablePath), 'icon-512-maskable.png must exist').toBe(true);
    const dims512M = readPngDimensions(icon512MaskablePath);
    expect(dims512M.width).toBe(512);
    expect(dims512M.height).toBe(512);
  });
});
