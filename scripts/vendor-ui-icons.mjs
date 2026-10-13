#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join(root, 'scripts/ui-icon-manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const temp = mkdtempSync(join(tmpdir(), 'pmo-ui-icons-'));
try {
  execFileSync('npm', ['pack', `${manifest.package}@${manifest.version}`, '--silent', '--pack-destination', temp], { stdio: 'inherit' });
  const tarball = join(temp, `${manifest.package}-${manifest.version}.tgz`);
  execFileSync('tar', ['-xzf', tarball, '-C', temp]);
  const packageDir = join(temp, 'package');
  const names = Object.keys(manifest.icons);
  const jsxAttributes = {
    'stroke-width': 'strokeWidth', 'stroke-linecap': 'strokeLinecap', 'stroke-linejoin': 'strokeLinejoin',
    'fill-rule': 'fillRule', 'clip-rule': 'clipRule', 'stroke-dasharray': 'strokeDasharray',
    'stroke-dashoffset': 'strokeDashoffset', 'stroke-miterlimit': 'strokeMiterlimit',
  };
  const renderChildren = (svg) => {
    const body = svg.match(/<svg\b[^>]*>([\s\S]*?)<\/svg>/)?.[1];
    if (!body) throw new Error('Unable to parse source SVG');
    const elements = [...body.matchAll(/<([a-zA-Z][\w-]*)([^>]*)\/?\s*>/g)];
    if (!elements.length) throw new Error('SVG has no child elements');
    return elements.map(([, tag, rawAttrs]) => {
      if (!['path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse', 'g'].includes(tag)) {
        throw new Error(`Unsupported SVG element <${tag}>`);
      }
      const attrs = [...rawAttrs.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) =>
        `${jsxAttributes[key] ?? key}=${JSON.stringify(value)}`,
      ).join(' ');
      return `      <${tag}${attrs ? ` ${attrs}` : ''} />`;
    }).join('\n');
  };
  const entries = names.map((name) => {
    const source = join(packageDir, 'icons', manifest.icons[name]);
    return `  ${JSON.stringify(name)}: (\n    <>\n${renderChildren(readFileSync(source, 'utf8'))}\n    </>\n  ),`;
  }).join('\n');
  const output = `import React from 'react';\n\n/** Selected Lucide SVG geometry, vendored from ${manifest.package}@${manifest.version}; source mapping: scripts/ui-icon-manifest.json. */\nexport const ICON_NAMES = ${JSON.stringify(names)} as const;\nexport type IconName = (typeof ICON_NAMES)[number];\n\nexport const ICON_PATHS: Record<IconName, React.ReactNode> = {\n${entries}\n};\n`;
  const outputPath = join(root, 'pmo-portal/src/components/ui/iconPaths.tsx');
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, output);
  const licensePath = join(root, 'pmo-portal/public/licenses/lucide-icons.txt');
  mkdirSync(dirname(licensePath), { recursive: true });
  copyFileSync(join(packageDir, 'LICENSE'), licensePath);
  console.log(`Generated ${names.length} icon keys from ${manifest.package}@${manifest.version}.`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
