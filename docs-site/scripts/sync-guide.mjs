// Copies docs/user-guide (the source of truth, readable on GitHub) into Starlight's content folder.
// Per page: the first "# Heading" becomes the frontmatter title, and relative .md links become site URLs.
// ponytail: regex link rewrite, covers the guide's plain [text](path.md#anchor) links; reference-style links are not rewritten.
import { readdir, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join, posix, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '../../docs/user-guide');
const OUT = join(here, '../src/content/docs');

const slugOf = (rel) => rel.replace(/\.md$/, '').replace(/(^|\/)README$/, '');

export function convert(text, rel) {
  const lines = text.split('\n');
  const h1 = lines.findIndex((l) => l.startsWith('# '));
  if (h1 === -1) throw new Error(`${rel}: no "# Title" line`);
  const title = lines[h1].slice(2).trim();
  lines.splice(h1, 1);
  const pageDir = posix.dirname(rel);
  const body = lines.join('\n').replace(/\]\((?!https?:|#|\/)([^)\s]+?\.md)(#[^)]*)?\)/g, (_, target, hash = '') => {
    const slug = slugOf(posix.normalize(posix.join(pageDir, target)));
    return `](/${slug ? slug + '/' : ''}${hash})`;
  });
  return `---\ntitle: ${JSON.stringify(title)}\n---\n${body}`;
}

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await rm(OUT, { recursive: true, force: true });
  const files = await walk(SRC);
  for (const file of files) {
    const rel = relative(SRC, file).split('\\').join('/');
    const dest = join(OUT, rel.replace(/(^|\/)README\.md$/, '$1index.md'));
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, convert(await readFile(file, 'utf8'), rel));
  }
  console.log(`sync-guide: ${files.length} pages`);
}
