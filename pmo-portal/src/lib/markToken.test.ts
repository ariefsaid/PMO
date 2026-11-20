import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..', '..');
const css = readFileSync(join(root, 'index.css'), 'utf8');

function lightValue(name: string): [number, number, number] {
  const m = css.match(new RegExp(`--${name}:\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%`));
  if (!m) throw new Error(`token ${name} missing`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}
function lum([h, s, l]: [number, number, number]) {
  const S = s / 100, L = l / 100, a = S * Math.min(L, 1 - L);
  const f = (n: number) => { const k = (n + h / 30) % 12; return L - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  const c = [f(0), f(8), f(4)].map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

describe('non-text marks use their own neutral token (#2418)', () => {
  it('defines a mark token that clears 3:1 on white even at the lightest alpha in use', () => {
    const l = lum(lightValue('mark-neutral'));
    // lightest alpha used on a mark is 0.4 over white
    const eff = 1 - 0.4 * (1 - l);
    expect(1.05 / (eff + 0.05)).toBeGreaterThanOrEqual(1.3);
    expect(1.05 / (l + 0.05)).toBeGreaterThanOrEqual(3);
  });

  it('keeps the text grey out of status dots, bars and switch marks', () => {
    const files = [
      'pages/Administration.tsx', 'pages/sales/DealParts.tsx', 'pages/expenses/AdvanceAgingCard.tsx',
      'pages/project-detail/ProjectBlocks.tsx', 'src/components/procurement/DecisionSupportPanel.tsx',
      'src/components/ui/Switch.tsx', 'src/components/ui/ProgressBar.tsx',
      'src/components/dashboard/hub/company/SalesFunnel.tsx', 'src/components/procurement/ProcurementBlock.tsx',
      'components/ProjectKanbanBoard.tsx', 'components/salesPipeline.ts', 'components/ProcurementBoard.tsx',
      'src/components/ui/Kanban.tsx', 'src/components/reui/gantt/gantt-view.tsx',
    ];
    const offenders = files.filter((f) => /bg-muted-foreground|border-muted-foreground|dotColor[^\n]*muted-foreground/.test(readFileSync(join(root, f), 'utf8').split('\n').filter((ln) => !ln.includes('hover:')).join('\n')));
    expect(offenders).toEqual([]);
  });
});
