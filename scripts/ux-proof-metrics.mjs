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

export function violations(metrics, baseline, label, chartBaseline, targetBaseline, layoutBaseline, layoutState = 'default') {
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
  if (metrics.layout) {
    // Shrink-only per route: a route may not get worse than its baseline, and a route with no
    // baseline (or one under redesign, baseline 0) must be clean.
    const found = layoutReport(metrics.layout, label, layoutState).failures;
    const allowed = layoutBaseline ?? 0;
    if (found.length > allowed) {
      failures.push(`${label}: layoutFailures=${found.length} [${layoutState}] (> shrink-only baseline ${allowed})`, ...found);
    }
  }
  return failures;
}

// ---------------------------------------------------------------------------------------------
// Layout checks (docs/ux/screen-rules.md "Layout"; DESIGN.md spacing). measureLayout runs IN THE
// PAGE (serialized by page.evaluate), so it must stay self-contained: no imports, no module scope.
// It returns numbers + short element descriptions; layoutReport() turns them into failures.
// ---------------------------------------------------------------------------------------------
export function measureLayout() {
  const main = document.querySelector('main');
  if (!main) throw new Error('No main element to measure');
  const IGNORE = '[data-layout-ignore], .sr-only, svg, [role="dialog"], [role="tree"], [role="treegrid"], [role="treeitem"], [aria-hidden="true"]';
  const isVisible = (el) => {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility !== 'visible' || Number(s.opacity) === 0) return false;
    for (let n = el; n && n !== main; n = n.parentElement) {
      if (n.tagName === 'DETAILS' && !n.open && ![...n.children].some((c) => c.tagName === 'SUMMARY' && c.contains(el))) return false; // closed disclosure
    }
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const ignored = (el) => !!el.closest(IGNORE);
  const inFlow = (el) => { const p = getComputedStyle(el).position; return p !== 'fixed' && p !== 'absolute'; };
  // display:contents wrappers (tab strips, fragments) have no box; their children take their place.
  const flatKids = (el) => [...el.children].flatMap((c) => (getComputedStyle(c).display === 'contents' ? flatKids(c) : [c]));
  const visibleKids = (el) => flatKids(el).filter((c) => isVisible(c) && inFlow(c) && !ignored(c));
  const paintedDeep = (el) => { for (let n = el; n && n !== main; n = n.parentElement) { if (Number(getComputedStyle(n).opacity) === 0) return false; } return true; };
  const shortText = (el, n = 28) => (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, n);
  const sel = (el) => {
    if (!el || el === main) return 'main';
    const cls = [...el.classList].filter((c) => !/[:[\]/]/.test(c)).slice(0, 2).map((c) => `.${c}`).join('');
    return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${cls} "${shortText(el)}"`;
  };

  // Every painted text run, once: [left, top, right, bottom].
  const texts = [];
  const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
  for (let node; (node = walker.nextNode());) {
    if (!node.textContent.trim()) continue;
    const el = node.parentElement;
    if (!el || ignored(el) || !isVisible(el)) continue;
    const range = document.createRange(); range.selectNodeContents(node);
    const rect = [...range.getClientRects()].find((r) => r.width > 0 && r.height > 0);
    if (rect) texts.push({ node, el, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });
  }
  const isControl = (el) => /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(el.tagName);
  // Left of a block's first line: its first text, or the icon/image/control that comes before it.
  const leftOf = (block) => {
    const text = texts.find((x) => block.contains(x.node));
    const chip = text && text.el.closest('button, [role="tab"], [role="button"]');
    if (chip && block.contains(chip) && !block.querySelector('svg:not(button svg), img')) return chip.getBoundingClientRect().left; // a chip's own padding is structural
    const lead = [...block.querySelectorAll('svg, img')].find((e) => isVisible(e) && !e.closest('button'));
    if (lead && (!text || (lead.compareDocumentPosition(text.node) & Node.DOCUMENT_POSITION_FOLLOWING))) return lead.getBoundingClientRect().left;
    if (text) return text.left;
    return isControl(block) ? block.getBoundingClientRect().left : null;
  };

  const isPanel = (el) => {
    if (el.hasAttribute('data-layout-surface')) return true;
    if (/^(BUTTON|INPUT|SELECT|TEXTAREA|A|TH|TD|TR|LI|TABLE|SPAN|LABEL)$/.test(el.tagName) || el.getAttribute('role') === 'button') return false;
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (r.width < 240 || r.height < 56) return false;
    const bordered = parseFloat(s.borderTopWidth) > 0 && s.borderTopStyle !== 'none' && parseFloat(s.borderTopLeftRadius) > 0;
    const shadowed = s.boxShadow !== 'none' && s.backgroundColor !== 'rgba(0, 0, 0, 0)';
    return bordered || shadowed;
  };
  const isRowLayout = (el) => {
    const s = getComputedStyle(el);
    if (s.display.includes('flex')) return !s.flexDirection.startsWith('column');
    if (s.display.includes('grid')) return s.gridTemplateColumns.split(' ').filter(Boolean).length > 1;
    return false;
  };
  const hasOwnText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());

  // The direct content blocks of a container. Wrappers are looked through; a row of columns
  // contributes only its first column (later columns are structural); a nested panel is a block of
  // the page column but its own surface, so a surface skips it.
  const blocksOf = (container, panelsAsBlocks, out = []) => {
    let kidsOfContainer = visibleKids(container);
    if (kidsOfContainer.length > 1 && container !== main && isRowLayout(container)) kidsOfContainer = [kidsOfContainer[0]];
    for (const child of kidsOfContainer) {
      if (isPanel(child)) { if (panelsAsBlocks) out.push({ el: child, panel: true }); continue; }
      const tag = child.tagName;
      if (/^(H[1-6]|P|TABLE|UL|OL|DL|PRE|BLOCKQUOTE|LABEL|INPUT|SELECT|TEXTAREA|BUTTON|FIGURE)$/.test(tag) || hasOwnText(child)) { out.push({ el: child }); continue; }
      const kids = visibleKids(child);
      if (!kids.length) continue;
      if (isRowLayout(child) && kids.length > 1) {
        const first = kids[0];
        if (isPanel(first)) { if (panelsAsBlocks) out.push({ el: first, panel: true }); } else blocksOf({ children: [first] }, panelsAsBlocks, out);
      } else blocksOf(child, panelsAsBlocks, out);
    }
    return out;
  };

  // 1. leftEdges ------------------------------------------------------------------------------
  const leftEdges = [];
  const edgesOf = (blocks, boxLeftForPanels) => {
    const edges = {};
    const seen = [];
    for (const b of blocks) {
      const x = b.panel && boxLeftForPanels ? b.el.getBoundingClientRect().left : leftOf(b.el);
      if (x === null || b.el.tagName === 'TABLE' || b.el.querySelector(':scope > table')) continue; // tables sit flush to the panel edge by design
      // A block beside an earlier one on the same line is a column, not a new line start.
      const rect = b.el.getBoundingClientRect();
      if (seen.some((o) => rect.top < o.bottom - 2 && rect.left > o.left)) { seen.push(rect); continue; }
      seen.push(rect);
      const near = Object.keys(edges).map(Number).find((e) => Math.abs(e - x) <= 4); // optical drift (icon glyph inside its box) is one edge
      const k = near ?? Math.round(x);
      (edges[k] ||= []).push(sel(b.el));
    }
    return edges;
  };
  // In the page column a panel shows two edges: its own box (the gutter) and where its content
  // starts (its inset). Flat sections add their own first line. More than two means a stray edge.
  const pageBlocks = blocksOf(main, true);
  const pageEdges = edgesOf(pageBlocks, true);
  for (const b of pageBlocks) {
    if (!b.panel) continue;
    const inner = edgesOf(blocksOf(b.el, false), false);
    const first = Object.keys(inner).map(Number).sort((x, y) => x - y)[0];
    if (first !== undefined) { const near = Object.keys(pageEdges).map(Number).find((e) => Math.abs(e - first) <= 4); (pageEdges[near ?? first] ||= []).push(`${sel(b.el)} content`); }
  }
  leftEdges.push({ surface: 'page column', limit: 2, edges: Object.fromEntries(Object.entries(pageEdges).map(([k, v]) => [k, v.slice(0, 3)])) });
  for (const panel of [...main.querySelectorAll('*')].filter((el) => !ignored(el) && isVisible(el) && isPanel(el) && !el.closest('table'))) {
    const edges = edgesOf(blocksOf(panel, false), false);
    if (Object.keys(edges).length) leftEdges.push({ surface: sel(panel), limit: 1, edges: Object.fromEntries(Object.entries(edges).map(([k, v]) => [k, v.slice(0, 3)])) });
  }

  // 2. gaps -----------------------------------------------------------------------------------
  const gaps = [];
  const headingLike = (el) => {
    if (/^H[2-6]$/.test(el.tagName) || (el.getAttribute('role') === 'heading')) return true;
    const h = el.querySelector('h2, h3, h4, h5, h6, [role="heading"]');
    return !!h && el.getBoundingClientRect().height <= 96 && !el.querySelector('table, input, select, textarea');
  };
  for (const parent of [main, ...main.querySelectorAll('*')]) {
    if (/^(TABLE|THEAD|TBODY|TR|UL|OL|SELECT|SVG|svg)$/.test(parent.tagName) || ignored(parent) || !isVisible(parent)) continue;
    if (parent !== main && parent.closest('table, ul, ol')) continue;
    const kids = visibleKids(parent).filter((k) => k.getBoundingClientRect().height > 0);
    if (kids.length < 2) continue;
    for (const b of kids) {
      const rb = b.getBoundingClientRect();
      let a = null; let aBottom = -Infinity;
      for (const c of kids) {
        if (c === b) continue;
        const rc = c.getBoundingClientRect();
        const overlap = Math.min(rb.right, rc.right) - Math.max(rb.left, rc.left);
        if (overlap < 0.4 * Math.min(rb.width, rc.width)) continue;
        if (rc.bottom <= rb.top + 1 && rc.bottom > aBottom) { a = c; aBottom = rc.bottom; }
      }
      if (!a) continue;
      const gap = Math.round(rb.top - aBottom);
      const follows = texts.some((t) => t.top >= rb.bottom - 1);
      if (gap > 48 && follows) gaps.push({ kind: 'gap', gap, above: sel(a), below: sel(b) });
      else if (gap > 24 && headingLike(a) && !/^H1$/.test(a.tagName) && !a.querySelector('h1')) gaps.push({ kind: 'heading', gap, above: sel(a), below: sel(b) });
    }
  }

  // 3. columnsLevel ---------------------------------------------------------------------------
  const columnsLevel = [];
  const bottomOfContent = (col) => {
    let m = -Infinity;
    for (const t of texts) if (col.contains(t.node) && t.bottom > m) m = t.bottom;
    for (const e of col.querySelectorAll('img, canvas, svg, input, select, textarea')) if (isVisible(e)) m = Math.max(m, e.getBoundingClientRect().bottom);
    return m;
  };
  for (const row of [main, ...main.querySelectorAll('*')]) {
    if (ignored(row) || !isVisible(row) || !isRowLayout(row) || row.closest('table')) continue;
    const all = visibleKids(row).filter((c) => { const r = c.getBoundingClientRect(); return r.width >= 180 && r.height >= 80; });
    // columns of one visual row share a top; a grid of several rows is judged row by row
    const lines = [];
    for (const c of all) {
      const top = c.getBoundingClientRect().top;
      const line = lines.find((l) => Math.abs(l.top - top) <= 8);
      if (line) line.cols.push(c); else lines.push({ top, cols: [c] });
    }
    for (const { cols } of lines) {
      if (cols.length < 2) continue;
      const ends = cols.map((c) => bottomOfContent(c));
      if (ends.some((e) => !Number.isFinite(e))) continue;
      const tallest = Math.max(...ends);
      const rowBottom = Math.max(...cols.map((c) => c.getBoundingClientRect().bottom));
      if (!texts.some((t) => t.top >= rowBottom - 1)) continue;
      cols.forEach((c, i) => {
        const diff = Math.round(tallest - ends[i]);
        if (diff > 48) columnsLevel.push({ row: sel(row), column: sel(c), ends: Math.round(ends[i]), tallest: Math.round(tallest), diff });
      });
    }
  }

  // 4. rowCentre ------------------------------------------------------------------------------
  const rowCentre = [];
  const FIGURE = /^[-+(]?\s*(?:[\p{Sc}]|[A-Z]{3})?\s*[-+]?\d[\d.,\s]*\)?\s*(?:%|[A-Za-z]{1,3})?$/u;
  const centreY = (el) => { const r = el.getBoundingClientRect(); return r.top + r.height / 2; };
  const figureIn = (row) => texts.find((t) => row.contains(t.node) && FIGURE.test(t.node.textContent.trim()) && t.node.textContent.trim().length <= 20);
  const rowsOf = (parent) => {
    const kids = visibleKids(parent);
    const groups = {};
    for (const k of kids) (groups[`${k.tagName}|${k.getAttribute('class') || ''}|${k.getAttribute('role') || ''}`] ||= []).push(k);
    return Object.values(groups).filter((g) => g.length >= 2);
  };
  const seenRows = new Set();
  for (const parent of [main, ...main.querySelectorAll('*')]) {
    if (ignored(parent) || !isVisible(parent) || /^(THEAD|SELECT|svg)$/.test(parent.tagName)) continue;
    for (const group of rowsOf(parent)) {
      const withBoth = group.filter((row) => row.getBoundingClientRect().height <= 80).map((row) => {
        const actions = [...row.querySelectorAll('button, a[role="button"], [role="button"]')].filter((a) => isVisible(a) && paintedDeep(a) && !a.closest('[role="menu"]') && a.getBoundingClientRect().height <= 48);
        const figure = figureIn(row);
        return actions.length && figure ? { row, action: actions[0], figure } : null;
      }).filter(Boolean);
      if (!withBoth.length || withBoth.some((r) => [...seenRows].some((s) => s.contains(r.row)))) continue;
      // a figure in its own right-aligned numeric column shared by every row is exempt
      const rights = group.map((row) => figureIn(row)?.right);
      const colOf = (row) => { const f = figureIn(row); const cell = f && f.el.closest('td, th, [role="cell"], [role="gridcell"]'); return cell ? [...cell.parentElement.children].indexOf(cell) : -1; };
      const cols = group.map(colOf);
      const sharedColumn = cols[0] >= 0 && cols.every((c) => c === cols[0]);
      const rightAligned = group.every((row) => { const f = figureIn(row); return f && ['right', 'end'].includes(getComputedStyle(f.el).textAlign); });
      const shared = sharedColumn || (rightAligned && rights.every((x) => x !== undefined) && Math.max(...rights) - Math.min(...rights) <= 1);
      if (shared) continue;
      for (const { row, action, figure } of withBoth) {
        seenRows.add(row);
        const dy = Math.round(Math.abs(centreY(action) - (figure.top + figure.bottom) / 2) * 10) / 10;
        if (dy > 4) rowCentre.push({ row: sel(row), figure: figure.node.textContent.trim().slice(0, 20), action: sel(action), dy });
      }
    }
  }

  // 5. loneSection (warning) ------------------------------------------------------------------
  const loneSection = [];
  for (const h of main.querySelectorAll('h2, h3, h4')) {
    if (ignored(h) || !isVisible(h)) continue;
    let host = h; if (host.parentElement !== main && visibleKids(host.parentElement).length === 1) host = host.parentElement;
    const next = host.nextElementSibling;
    if (!next || !isVisible(next) || next.querySelector('table, ul, ol, input, select, textarea, button, a, svg, h2, h3, h4')) continue;
    const runs = texts.filter((t) => next.contains(t.node));
    if (runs.length === 2) loneSection.push({ heading: shortText(h, 40), label: runs[0].node.textContent.trim().slice(0, 40), value: runs[1].node.textContent.trim().slice(0, 40) });
  }

  return { leftEdges, gaps, columnsLevel, rowCentre, loneSection };
}

/** Failures + warnings for one measured layout. `state` names the page state ("default", "reads failing"). */
export function layoutReport(layout, label, state = 'default') {
  const failures = [];
  const warnings = [];
  const where = `${label} [${state}]`;
  for (const surface of layout.leftEdges) {
    const xs = Object.keys(surface.edges);
    if (xs.length > surface.limit) {
      failures.push(`${where}: leftEdges ${surface.surface}: ${xs.length} left edges (max ${surface.limit}) ${xs.map((x) => `x=${x}: ${surface.edges[x].join(' | ')}`).join('; ')}`);
    }
  }
  for (const g of layout.gaps) {
    failures.push(g.kind === 'heading'
      ? `${where}: gaps heading content starts ${g.gap}px below it (max 24): ${g.above} -> ${g.below}`
      : `${where}: gaps ${g.gap}px between blocks (max 48 with content below): ${g.above} -> ${g.below}`);
  }
  for (const c of layout.columnsLevel) {
    failures.push(`${where}: columnsLevel column ends ${c.diff}px above its tallest neighbour (max 48; ends y=${c.ends}, tallest y=${c.tallest}): ${c.column} in ${c.row}`);
  }
  for (const r of layout.rowCentre) {
    failures.push(`${where}: rowCentre figure "${r.figure}" and action centres differ by ${r.dy}px (max 4): ${r.action} in ${r.row}`);
  }
  for (const s of layout.loneSection) {
    warnings.push(`${where}: loneSection "${s.heading}" holds one label/value pair: ${s.label} = ${s.value}`);
  }
  return { failures, warnings };
}
