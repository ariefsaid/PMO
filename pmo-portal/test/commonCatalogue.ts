import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** `common` is two files (`commonPages` is its second fallback namespace): tests that bind the whole catalogue read both. */
export function commonCatalogue(lng: 'en' | 'id'): Record<string, unknown> {
  const read = (name: string) => JSON.parse(readFileSync(join(process.cwd(), `public/locales/${lng}/${name}.json`), 'utf8')) as Record<string, unknown>;
  return { ...read('common'), ...read('commonPages') };
}
