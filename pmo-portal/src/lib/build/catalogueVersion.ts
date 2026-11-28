import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

/** URL prefix under which a build publishes its language catalogues. Matched by `public/_headers`. */
export const CATALOGUE_PREFIX = '/catalogues';

function listFiles(dir: string, rel = ''): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(path.join(dir, rel), { withFileTypes: true })
    .flatMap((entry) => {
      const next = path.posix.join(rel, entry.name);
      return entry.isDirectory() ? listFiles(dir, next) : [next];
    })
    .sort();
}

/** Short content hash of every catalogue file (names and bytes): changes exactly when a catalogue changes. */
export function catalogueHash(localesDir: string): string {
  const hash = createHash('sha256');
  for (const file of listFiles(localesDir)) {
    hash.update(file).update('\0').update(fs.readFileSync(path.join(localesDir, file))).update('\0');
  }
  return hash.digest('hex').slice(0, 12);
}

/** The versioned address catalogues are fetched from, e.g. `/catalogues/3fa9c1d2b4e0`. */
export function catalogueBase(localesDir: string): string {
  return `${CATALOGUE_PREFIX}/${catalogueHash(localesDir)}`;
}

/**
 * Publishes the language catalogues at a content-addressed path so the browser can cache them for a
 * year: a changed catalogue is a new address. The unversioned `/locales` copy stays for older
 * clients and revalidates. The dev server answers the same versioned path from `public/locales`.
 */
export function versionedCatalogues(root: string): Plugin {
  const localesDir = path.join(root, 'public/locales');
  return {
    name: 'versioned-catalogues',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const match = req.url?.match(new RegExp(`^${CATALOGUE_PREFIX}/[0-9a-f]+/(.*)$`));
        if (match) req.url = `/locales/${match[1]}`;
        next();
      });
    },
    closeBundle() {
      const outDir = path.join(root, 'dist');
      if (!fs.existsSync(outDir)) return;
      fs.cpSync(localesDir, path.join(outDir, catalogueBase(localesDir)), { recursive: true });
    },
  };
}
