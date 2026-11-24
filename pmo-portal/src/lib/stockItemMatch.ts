/** Pure matcher offering active organisation stock items for exact, code, reordered, and near-duplicate queries. */

export interface StockItemOption {
  id: string;
  code: string;
  name: string;
  unitCode?: string | null;
  archived?: boolean;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function compact(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** Bounded Levenshtein distance; returns `maxDist + 1` as soon as the bound is exceeded. */
function editDistanceWithin(a: string, b: string, maxDist: number): number {
  const lenA = a.length;
  const lenB = b.length;
  if (Math.abs(lenA - lenB) > maxDist) return maxDist + 1;
  if (a === b) return 0;
  let prev = new Array<number>(lenB + 1);
  let curr = new Array<number>(lenB + 1);
  for (let j = 0; j <= lenB; j++) prev[j] = j;
  for (let i = 1; i <= lenA; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= lenB; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      const v = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      curr[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > maxDist) return maxDist + 1;
    [prev, curr] = [curr, prev];
  }
  return prev[lenB];
}

function scoreToken(qt: string, candidateTokens: readonly string[]): number {
  let best = 0;
  for (const ct of candidateTokens) {
    if (ct === qt) return 1;
    if (ct.startsWith(qt) || (ct.length >= 2 && qt.length >= 3 && qt.startsWith(ct))) {
      best = Math.max(best, 0.92);
      continue;
    }
    if (qt.length >= 3 && (ct.includes(qt) || (ct.length >= 3 && qt.includes(ct)))) {
      best = Math.max(best, 0.85);
      continue;
    }
    if (qt.length >= 4 && ct.length >= 4) {
      const limit = qt.length >= 6 && ct.length >= 6 ? 2 : 1;
      const dist = editDistanceWithin(qt, ct, limit);
      if (dist <= limit) {
        best = Math.max(best, dist === 1 ? 0.78 : 0.68);
      }
    }
  }
  return best;
}

function scoreItem(item: StockItemOption, qNorm: string, qCompact: string, qTokens: readonly string[]): number {
  const codeNorm = normalize(item.code);
  const nameNorm = normalize(item.name);
  const codeCompact = compact(item.code);
  const nameCompact = compact(item.name);

  if (codeNorm === qNorm || nameNorm === qNorm) return 100;
  if (qCompact.length >= 2 && (codeCompact === qCompact || nameCompact === qCompact)) return 95;
  if (nameNorm.startsWith(qNorm) || codeNorm.startsWith(qNorm)) return 88;
  if (qCompact.length >= 3 && (codeCompact.includes(qCompact) || nameCompact.includes(qCompact))) return 84;
  if (nameNorm.includes(qNorm) || codeNorm.includes(qNorm)) return 78;

  if (qTokens.length === 0) return 0;
  const candidateTokens = [...codeNorm.split(' '), ...nameNorm.split(' ')].filter(Boolean);
  let matched = 0;
  let total = 0;
  for (const qt of qTokens) {
    const s = scoreToken(qt, candidateTokens);
    if (s > 0) {
      matched++;
      total += s;
    }
  }
  const requiredMatches = qTokens.length === 1 ? 1 : Math.ceil(qTokens.length * 0.6);
  if (matched < requiredMatches) return 0;
  const avg = total / qTokens.length;
  return avg >= 0.55 ? Math.round(avg * 72) : 0;
}

export function matchStockItems(items: readonly StockItemOption[], query: string, limit = 8): StockItemOption[] {
  const active = items.filter((item) => !item.archived);
  const qNorm = normalize(query);
  if (!qNorm) return active.slice(0, limit);
  const qCompact = compact(query);
  const rawTokens = qNorm.split(' ').filter(Boolean);
  const qTokens = rawTokens.length > 1 ? rawTokens.filter((tok) => tok.length >= 2) : rawTokens;

  return active
    .map((item) => ({ item, score: scoreItem(item, qNorm, qCompact, qTokens) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name))
    .slice(0, limit)
    .map((entry) => entry.item);
}
