export type Hsl = [number, number, number];
export type Rgb = [number, number, number];

function hslToRgb([h, s, l]: Hsl): Rgb {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [255 * f(0), 255 * f(8), 255 * f(4)];
}

function relativeLuminance([r, g, b]: Rgb): number {
  const linear = [r, g, b].map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

export function contrastRatio(a: Hsl, b: Hsl): number {
  const [la, lb] = [relativeLuminance(hslToRgb(a)), relativeLuminance(hslToRgb(b))];
  const [lighter, darker] = la >= lb ? [la, lb] : [lb, la];
  return (lighter + 0.05) / (darker + 0.05);
}

export function themeTokens(cssBlock: string, selector: string): Record<string, Hsl> {
  const start = cssBlock.indexOf(selector);
  if (start < 0) throw new Error(`${selector} missing from index.css`);
  const open = cssBlock.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < cssBlock.length; i++) {
    if (cssBlock[i] === '{') depth++;
    if (cssBlock[i] === '}' && --depth === 0) {
      const tokens: Record<string, Hsl> = {};
      const re = /--([a-z0-9-]+):\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/g;
      let match: RegExpExecArray | null;
      const block = cssBlock.slice(open + 1, i);
      while ((match = re.exec(block))) tokens[match[1]!] = [Number(match[2]), Number(match[3]), Number(match[4])];
      return tokens;
    }
  }
  throw new Error(`unbalanced braces for ${selector}`);
}
