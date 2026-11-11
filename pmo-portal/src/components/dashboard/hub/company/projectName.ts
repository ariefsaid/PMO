export function wrapProjectName(name: string, maxChars = 22): string[] {
  const words = name.trim().split(/\s+/u).filter(Boolean);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }
    if (lines.length === 0) {
      lines.push(current || word);
      current = current ? word : '';
      continue;
    }
    lines.push(`${candidate.slice(0, maxChars - 1).trimEnd()}…`);
    return lines;
  }
  if (current) lines.push(current);
  return lines.slice(0, 2);
}
