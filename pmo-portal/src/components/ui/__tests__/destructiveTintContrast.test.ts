import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * AC-A11Y-CONTRAST-001 (#692) — the destructive-tint contrast class.
 *
 * DESIGN.md (Modal dialog rule 3): "Text on a destructive tint always uses `destructive-text`,
 * never `destructive`" — the raw `destructive` hue measures ~4.2:1 on a `bg-destructive/*` tint,
 * below WCAG AA (4.5:1) for 14px text. The #689 rendered pass found the same defect in two
 * surfaces that no test connected (`CommandPalette`, `ProjectIntegrationsCard`).
 *
 * This gate turns the rule into a deterministic check over the source: no single class string may
 * apply `text-destructive` AND a `bg-destructive/<alpha>` tint in the SAME state. Only unprefixed
 * utilities are compared, so:
 *   - `hover:bg-destructive/10` (a transient hover wash on a ghost button) is out of scope;
 *   - `[&_svg]:text-destructive` (a glyph, held to the 3:1 non-text bar) is out of scope.
 *
 * Scope is deliberate and stated: it inspects string literals (single, double, template). A class
 * assembled across separate literals (`cn('text-destructive', hot && 'bg-destructive/10')`) is
 * not caught — that shape needs a review, not a regex.
 */

const APP_ROOT = process.cwd();
const SCAN_ROOTS = ['src', 'pages', 'components'];

/**
 * Reviewed exceptions. Each names WHY the raw hue is acceptable — the only sanctioned reason is
 * that the coloured element is a decorative/graphic glyph (WCAG 1.4.11, 3:1), never text.
 */
const ALLOWLIST: Array<{ file: string; snippet: string; reason: string }> = [
  {
    file: 'src/components/ui/KPITile.tsx',
    snippet: "red: 'bg-destructive/[0.12] text-destructive'",
    reason: 'icon-tile tone: the tinted square carries a single aria-hidden glyph, no text',
  },
];

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === 'node_modules' || name === '__tests__' || name === 'dist') continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.tsx$/.test(name) && !/\.(test|spec|stories)\.tsx$/.test(name)) out.push(full);
  }
  return out;
}

/** Every string literal body in the source (single, double or template quoted, no nesting). */
export function literalBodies(src: string): Array<{ body: string; index: number }> {
  const found: Array<{ body: string; index: number }> = [];
  const re = /'([^'\\\n]*(?:\\.[^'\\\n]*)*)'|"([^"\\\n]*(?:\\.[^"\\\n]*)*)"|`([^`\\]*(?:\\.[^`\\]*)*)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    found.push({ body: m[1] ?? m[2] ?? m[3] ?? '', index: m.index });
  }
  return found;
}

/** True when one class string applies raw `text-destructive` and an unprefixed destructive tint. */
export function combinesDestructiveTextWithTint(classString: string): boolean {
  const tokens = classString.split(/\s+/).filter(Boolean);
  const hasText = tokens.includes('text-destructive');
  const hasTint = tokens.some((t) => /^bg-destructive\//.test(t));
  return hasText && hasTint;
}

interface Offender {
  file: string;
  line: number;
  snippet: string;
}

function findOffenders(files: string[]): Offender[] {
  const offenders: Offender[] = [];
  for (const abs of files) {
    const file = relative(APP_ROOT, abs);
    const src = readFileSync(abs, 'utf8');
    for (const { body, index } of literalBodies(src)) {
      if (!combinesDestructiveTextWithTint(body)) continue;
      const line = src.slice(0, index).split('\n').length;
      const lineText = src.split('\n')[line - 1].trim();
      if (ALLOWLIST.some((a) => a.file === file && lineText.includes(a.snippet))) continue;
      offenders.push({ file, line, snippet: body.trim() });
    }
  }
  return offenders;
}

describe('AC-A11Y-CONTRAST-001: text-destructive is never placed on a destructive tint', () => {
  it('AC-A11Y-CONTRAST-001: the detector flags the defect and ignores the sanctioned shapes', () => {
    // The planted defect, exactly as it shipped in CommandPalette / ProjectIntegrationsCard.
    expect(combinesDestructiveTextWithTint('bg-destructive/10 px-2.5 text-destructive')).toBe(true);
    expect(combinesDestructiveTextWithTint('text-destructive bg-destructive/[0.07]')).toBe(true);
    // The DESIGN.md-sanctioned pairing, hover washes and glyph-only colouring are not defects.
    expect(combinesDestructiveTextWithTint('bg-destructive/10 text-destructive-text')).toBe(false);
    expect(combinesDestructiveTextWithTint('text-destructive hover:bg-destructive/10')).toBe(false);
    expect(combinesDestructiveTextWithTint('bg-destructive/10 [&_svg]:text-destructive')).toBe(false);
    expect(combinesDestructiveTextWithTint('text-destructive')).toBe(false);
  });

  it('AC-A11Y-CONTRAST-001: no source class string combines text-destructive with a bg-destructive/ tint', () => {
    const files = SCAN_ROOTS.flatMap((root) => walk(join(APP_ROOT, root)));
    expect(files.length).toBeGreaterThan(50); // the walk found the app, not an empty tree
    const offenders = findOffenders(files);
    expect(
      offenders,
      `Use \`text-destructive-text\` on a destructive tint (DESIGN.md):\n${offenders
        .map((o) => `  ${o.file}:${o.line}  ${o.snippet}`)
        .join('\n')}`,
    ).toEqual([]);
  });

  it('AC-A11Y-CONTRAST-001: every allowlist entry still matches the source (no stale exemption)', () => {
    for (const entry of ALLOWLIST) {
      const src = readFileSync(join(APP_ROOT, entry.file), 'utf8');
      expect(src, `${entry.file} no longer contains the exempted snippet — delete the entry`).toContain(
        entry.snippet,
      );
    }
  });
});
