export const CHART_SELECTOR = 'main svg.recharts-surface, main svg[role="img"]';

export function measureText(chartSelector) {
  const main = document.querySelector('main');
  if (!main) throw new Error('No main element to measure');
  const isVisible = (element) => {
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility === 'visible' && Number(style.opacity) !== 0 &&
      style.contentVisibility !== 'hidden' && element.getClientRects().length > 0;
  };
  // `wordCount` counts CHROME only: a screen's own words (headings, labels, captions, help), never
  // record data. Sample data grows as people work (rows, claims, review records), so counting it made
  // unchanged screens drift over budget. Font-size metrics still cover every painted word, data
  // included — a too-small cell is a real a11y finding.
  // A text node is data when any ancestor is a row repeated beyond the first of its collection.
  // Three row shapes exist in this app: <tbody> rows, ARIA rows (role=row/listitem), and card
  // layouts that repeat an identically-shaped div/button per record (approvals queue, the 390
  // timesheet grid). The last one is caught by shape (tag + class) because it carries no list
  // semantics — without it the gate would still count record data as chrome.
  // The phone card branch of the shared DataTable is marked explicitly (`data-record-row`): a
  // record card is data even when it is the ONLY one, and grouping must not decide it. Inference
  // alone left the first card (or a card list under a group heading) inside the chrome budget,
  // so /finance/receivables moved with which record came first. The attribute lives in this
  // function (not module scope) because measureText is serialized into the page.
  const shape = (element) => `${element.tagName}|${element.getAttribute('class') || ''}`;
  const isDataRow = (element) => {
    for (let node = element; node && node !== main; node = node.parentElement) {
      if (node.hasAttribute('data-record-row')) return true;
      const tag = node.tagName;
      const role = node.getAttribute('role');
      if (tag === 'TBODY') return true;
      if (role === 'rowgroup' && !node.querySelector('[role="columnheader"], th')) return true;
      if (tag === 'LI' || role === 'listitem' || tag === 'TR' || role === 'row') {
        const list = node.parentElement?.closest('ul, ol, menu, [role="list"], [role="listbox"], table, thead, [role="table"], [role="grid"], [role="rowgroup"]');
        if (list) {
          const items = [...list.children].filter((child) => child.tagName === tag && child.getAttribute('role') === role);
          if (items.length > 1 && items[0] !== node) return true;
        }
      }
      const siblings = node.parentElement ? [...node.parentElement.children].filter((child) => shape(child) === shape(node)) : [];
      if (siblings.length > 2 && siblings[0] !== node) return true;
    }
    return false;
  };
  const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
  const sizes = {}; const samples = {}; let words = 0; let total = 0; let small = 0;
  for (let node; (node = walker.nextNode());) {
    const text = node.textContent.trim();
    if (!text) continue;
    const element = node.parentElement;
    if (element.closest('.sr-only')) continue;
    // Chart data labels and ticks are measured by chartCount. Keeping them out of the page-copy
    // budget lets a data visualization carry its own readable labels without consuming copy space.
    if (element.closest(chartSelector)) continue;
    const style = getComputedStyle(element);
    if (style.visibility !== 'visible' || !element.getClientRects().length || Number(style.opacity) === 0) continue;
    let hidden = false;
    for (let parent = element; parent; parent = parent.parentElement) {
      const computed = getComputedStyle(parent);
      if (computed.display === 'none' || Number(computed.opacity) === 0 || computed.contentVisibility === 'hidden') { hidden = true; break; }
    }
    if (hidden) continue;
    const range = document.createRange(); range.selectNodeContents(node);
    if (![...range.getClientRects()].some((rect) => rect.width > 0 && rect.height > 0)) continue;
    const size = parseFloat(style.fontSize);
    sizes[size] = (sizes[size] || 0) + text.length;
    total += text.length;
    if (!isDataRow(element)) words += text.split(/\s+/u).length;
    if (size < 14) { small += text.length; (samples[size] ||= []).length < 5 && samples[size].push(text.slice(0, 40)); }
  }
  const distinctFontSizes = Object.keys(sizes).map(Number).sort((a, b) => a - b);
  if (!total) throw new Error('No visible text in main');
  const contentRoots = [main, ...document.querySelectorAll('[role="dialog"]')];
  const inContent = (selector) => [...new Set(contentRoots.flatMap((root) => [...root.querySelectorAll(selector)]))].filter(isVisible);
  const formInputs = inContent('input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="file"]):not([type="hidden"]):not([type="range"]):not([type="color"]), select, textarea, [role="combobox"]');
  const phoneWidth = window.innerWidth <= 640;
  const smallInputCount = phoneWidth ? formInputs.filter((element) => parseFloat(getComputedStyle(element).fontSize) < 16).length : 0;
  const actionTargets = inContent('button, a.touch-target[href], a[role="button"], [role="button"], [role="tab"], [role="switch"], summary.touch-target');
  const smallTargetCount = phoneWidth ? actionTargets.filter((element) => element.getBoundingClientRect().height < 44).length : 0;
  const horizontalOverflow = document.documentElement.scrollWidth > window.innerWidth + 1;
  const chartCount = [...main.querySelectorAll(chartSelector)]
    .filter((svg) => {
      const rect = svg.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      for (let parent = svg; parent && parent !== main.parentElement; parent = parent.parentElement) {
        const computed = getComputedStyle(parent);
        if (computed.display === 'none' || computed.visibility !== 'visible' || Number(computed.opacity) === 0 || computed.contentVisibility === 'hidden') return false;
      }
      return true;
    }).length;
  return { minFontPx: distinctFontSizes[0], pctCharsUnder14: small * 100 / total, distinctFontSizes, wordCount: words, chartCount, smallTextSamples: samples, smallInputCount, smallTargetCount, horizontalOverflow };
}

export function violations(metrics, baseline, label, chartBaseline, targetBaseline) {
  const failures = [];
  const samples = JSON.stringify(metrics.smallTextSamples);
  if (metrics.minFontPx < 12) failures.push(`${label}: minFontPx=${metrics.minFontPx} (<12); samples=${samples}`);
  if (metrics.pctCharsUnder14 > 15) failures.push(`${label}: pctCharsUnder14=${metrics.pctCharsUnder14.toFixed(2)} (>15); samples=${samples}`);
  if (metrics.smallInputCount > 0) failures.push(`${label}: smallInputCount=${metrics.smallInputCount} (input font size <16px)`);
  if (metrics.horizontalOverflow) failures.push(`${label}: horizontalOverflow=document wider than viewport`);
  if (targetBaseline !== undefined && metrics.smallTargetCount > targetBaseline) {
    failures.push(`${label}: smallTargetCount=${metrics.smallTargetCount} (> shrink-only baseline ${targetBaseline})`);
  }
  if (baseline !== undefined && metrics.wordCount > baseline * 1.05) failures.push(`${label}: wordCount=${metrics.wordCount} (>105% of ${baseline}); samples=${samples}`);
  if (chartBaseline !== undefined && metrics.chartCount < chartBaseline) {
    failures.push(`${label}: chartCount=${metrics.chartCount} (< baseline ${chartBaseline}); selector="${CHART_SELECTOR}"`);
  }
  return failures;
}
