/**
 * Subcontractor progress certificate figures (#2584). The database derives and stores every amount (FR-SPC-005); this
 * module only re-states the same exact-decimal rules so a screen can show a figure the server would produce and a test
 * can bind the rule: line amount = round(measured quantity x rate, 2), half away from zero (Postgres `numeric`).
 * Money is a decimal string or integer minor units, never a float (AC-SPC-003).
 */

const DEC = /^-?\d+(\.\d+)?$/;

/** Parse a decimal string into [integer units, scale]. */
function parse(value: string): { units: bigint; scale: number } {
  if (!DEC.test(value)) throw new Error(`not a decimal: ${value}`);
  const neg = value.startsWith('-');
  const [int, frac = ''] = value.replace('-', '').split('.');
  const units = BigInt(int + frac);
  return { units: neg ? -units : units, scale: frac.length };
}

function format(units: bigint, scale: number): string {
  const neg = units < 0n;
  const digits = (neg ? -units : units).toString().padStart(scale + 1, '0');
  const int = scale === 0 ? digits : digits.slice(0, digits.length - scale);
  const frac = scale === 0 ? '' : digits.slice(digits.length - scale);
  return `${neg ? '-' : ''}${int}${frac ? `.${frac}` : ''}`;
}

/** round(quantity x rate, 2) as a 2-decimal string; exact, half away from zero. */
export function certificateLineAmount(quantity: string, rate: string): string {
  const q = parse(quantity);
  const r = parse(rate);
  const product = q.units * r.units;           // scale q.scale + r.scale
  const scale = q.scale + r.scale;
  if (scale <= 2) return format(product * 10n ** BigInt(2 - scale), 2);
  const divisor = 10n ** BigInt(scale - 2);
  const abs = product < 0n ? -product : product;
  let rounded = abs / divisor;
  if ((abs % divisor) * 2n >= divisor) rounded += 1n;   // half away from zero
  return format(product < 0n ? -rounded : rounded, 2);
}

/** Exact sum of 2-decimal money strings. */
export function sumMoney(values: string[]): string {
  return format(values.reduce((s, v) => s + parse(parseTwo(v)).units, 0n), 2);
}

/** Exact `a - b` of 2-decimal money strings. */
export function subtractMoney(a: string, b: string): string {
  return format(parse(parseTwo(a)).units - parse(parseTwo(b)).units, 2);
}

function parseTwo(v: string): string {
  const p = parse(v);
  if (p.scale === 2) return v;
  if (p.scale < 2) return format(p.units * 10n ** BigInt(2 - p.scale), 2);
  throw new Error(`more than 2 decimals: ${v}`);
}

/** Net payable of a certificate: gross less the backcharges (never below what the server will accept: net >= 0, OD-SPC-8). */
export function certificateNet(gross: string, backcharges: string[]): { net: string; negative: boolean } {
  const net = subtractMoney(gross, sumMoney(backcharges));
  return { net, negative: net.startsWith('-') };
}
