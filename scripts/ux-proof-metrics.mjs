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
    // Per route: the gate fails on any fingerprint that is not in the route's baseline list; a route
    // with no baseline (or one under redesign, an empty list) must be clean. Counts never decide.
    const report = layoutReport(metrics.layout, label, layoutState);
    const allowed = new Set(layoutBaseline ?? []);
    const fresh = report.fingerprints.filter((fp) => !allowed.has(fp));
    if (fresh.length) failures.push(`${label}: layoutFingerprints=${fresh.length} not in the baseline [${layoutState}]`, ...new Set(fresh.map((fp) => report.items[fp])));
  }
  return failures;
}

// ---------------------------------------------------------------------------------------------
// Layout checks (docs/ux/screen-rules.md "Layout"; DESIGN.md spacing). Of the eleven layout rules in that file:
//   MEASURED (fails)   1 one left edge per surface (`leftEdges`) · 2 spacing between painted content (`gaps`: heading
//                      to content, section scale, white-space hole) · 6 figure and action share a centre (`rowCentre`)
//                      · 7 columns end level (`columnsLevel`)
//   WARNS only         3 a section for one label/value pair (`loneSection`)
//   NOT MEASURED       4 every action has a place · 5 one surface language per page · 8 a message fits its cell ·
//                      9 removing words re-flows the screen · 10 secondary text uses the supporting token (the font
//                      size and weight are covered by the text gate, not here) · 11 long lists use numbered pages;
//                      the reviewer's eye and the e2e journeys hold these.
// measureLayout runs IN THE
// PAGE (serialized by page.evaluate), so it must stay self-contained: no imports, no module scope.
// It returns numbers + short element descriptions; layoutReport() turns them into failures and
// fingerprints. The numbers below are the ONE source for code, self-tests and screen-rules.md.
//
// Exemptions, by check (each is in the code below next to the condition):
//   leftEdges   tables (flush; cells keep their own 16px inset) · a chip's or tab link's own padding · a column
//               beside an earlier block on the same line · KPI tiles (their own surface, DESIGN.md 16px inset)
//               · a row's leading checkbox, avatar or colour swatch (the row starts at the mark) · a bordered
//               field's inner padding (its box is the edge) · a narrow control centred or right-aligned in its
//               row, and centred or right-aligned text
//   gaps        gaps under 12px (inside one group) · the end of the page · children of a flex/grid item
//               stretched to its row's height · a child pushed down by margin-top:auto · lists and tables.
//               Wrapped text counts to its last line and aria-hidden figures count (they are painted); a block
//               is measured to the nearest block above that shares any of its column, so a field is never
//               measured past the one between
//   columnsLevel the last row of the page (nothing below it) · KPI tile rows (tiles stretch to the row height)
//   rowCentre   a figure in a shared right-aligned numeric column · a menu · a closed disclosure
//   everywhere  [data-layout-ignore] (counted and reported; may not cover a panel or >30% of main),
//               sr-only, svg, dialogs, trees (aria-hidden text counts: it is painted)
// ---------------------------------------------------------------------------------------------
export const LAYOUT_NUMBERS = {
  headingMin: 12, headingMax: 16, // heading to the content it introduces
  scale: [16, 24, 32], // sibling sections or panels: phone panel gap 16, desktop panel gap 24, section gap 32
  tolerance: 2,
  maxGap: 48, // painted white space between two blocks, with content below
  minJudged: 12, // gaps under this are inside one group (label to value, icon to text) and not judged
  columnLevel: 24, // columns of one row end within one panel gap of each other
  ignoreShare: 0.3, // a [data-layout-ignore] may not cover more than this share of main
  rowCentre: 4,
};

export function measureLayout(N) {
  const main = document.querySelector('main');
  if (!main) throw new Error('No main element to measure');
  const IGNORE = '[data-layout-ignore], .sr-only, svg, [role="dialog"], [role="tree"], [role="treegrid"], [role="treeitem"]';
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
  const stable = (c) => !/[:[\]/%.]/.test(c);
  const one = (el) => {
    const cls = [...el.classList].filter(stable).slice(0, 2).map((c) => `.${c}`).join('');
    const hook = el.getAttribute('data-testid') || el.getAttribute('aria-label') || el.getAttribute('role');
    const id = el.id && !/_r_|^base-ui|^radix|^:r|\d{3,}/.test(el.id) ? `#${el.id}` : ''; // generated ids change per render
    return `${el.tagName.toLowerCase()}${id}${cls}${hook ? `[${hook.slice(0, 24)}]` : ''}`;
  };
  // Fingerprint selector: the element and up to three ancestors, never its text (text changes with data and language).
  const path = (el) => {
    const parts = [];
    for (let n = el, i = 0; n && n !== main && i < 4; n = n.parentElement, i++) parts.unshift(one(n));
    return `main>${parts.join('>')}`;
  };
  const sel = (el) => (!el || el === main ? 'main' : `${one(el)} "${shortText(el)}"`);

  // Every painted text run, once: [left, top, right, bottom].
  const texts = [];
  const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
  for (let node; (node = walker.nextNode());) {
    if (!node.textContent.trim()) continue;
    const el = node.parentElement;
    if (!el || ignored(el) || !isVisible(el)) continue;
    const range = document.createRange(); range.selectNodeContents(node);
    const lines = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
    if (lines.length) texts.push({ node, el, left: Math.min(...lines.map((r) => r.left)), top: Math.min(...lines.map((r) => r.top)), right: Math.max(...lines.map((r) => r.right)), bottom: Math.max(...lines.map((r) => r.bottom)) }); // every wrapped line, not the first
  }
  const isControl = (el) => /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(el.tagName);
  // A field's visible edge is its bordered wrapper (search icon + input), and a pill's is its own box: the padding inside
  // either is structural, never a content edge.
  const hasFill = (el) => { const bg = getComputedStyle(el).backgroundColor; return bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent'; };
  const fieldEdge = (control) => {
    for (let n = control.parentElement, i = 0; n && n !== main && i < 3; n = n.parentElement, i++) {
      const s = getComputedStyle(n);
      if (parseFloat(s.borderLeftWidth) > 0 && parseFloat(s.borderTopLeftRadius) > 0 && !texts.some((x) => n.contains(x.node) && !control.contains(x.node))) return n.getBoundingClientRect().left;
    }
    return control.getBoundingClientRect().left;
  };
  const pillOf = (text, block) => {
    for (let n = text.el; n && n !== block; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (hasFill(n) && parseFloat(s.borderTopLeftRadius) >= 8 && parseFloat(s.paddingLeft) >= 4 && n.getBoundingClientRect().height <= 40) return n;
    }
    return null;
  };
  // A leading mark is a small decoration that starts a row: a checkbox or radio, an avatar (a round box, with initials
  // or an image), or a colour swatch (a small filled box with no text). The row starts at the mark, not at the text after it.
  const isMark = (e) => {
    if (!isVisible(e)) return false;
    const r = e.getBoundingClientRect();
    if (r.width > 48 || r.height > 48 || r.width < 6 || r.height < 6 || e.closest('.sr-only')) return false; // not a hidden "select all" box
    if (e.tagName === 'INPUT') return /^(checkbox|radio)$/.test(e.type);
    if (e.tagName === 'IMG') return true;
    if (e.querySelector('input, button, a, select')) return false;
    const s = getComputedStyle(e);
    const round = parseFloat(s.borderTopLeftRadius) >= Math.min(r.width, r.height) / 2 - 1;
    const txt = (e.textContent || '').trim();
    return hasFill(e) && ((!txt && !e.children.length) || (round && txt.length <= 3));
  };
  const leadMark = (block, text) => {
    for (const e of block.querySelectorAll('input, img, span, div, i, b')) {
      if (!isMark(e) || e.getBoundingClientRect().left < block.getBoundingClientRect().left - 1) continue;
      if (text && !(e.compareDocumentPosition(text.node) & Node.DOCUMENT_POSITION_FOLLOWING) && !e.contains(text.node)) continue;
      return e;
    }
    return null;
  };
  // A field wrapper (search icon + input in one bordered or filled box): its own box is the edge, not the icon inside it.
  const isFieldBox = (el) => {
    if (!/^(LABEL|DIV|SPAN)$/.test(el.tagName) || !el.querySelector('input, select, textarea')) return false;
    const s = getComputedStyle(el);
    return parseFloat(s.borderLeftWidth) > 0 && parseFloat(s.borderTopLeftRadius) > 0 && !texts.some((x) => el.contains(x.node));
  };
  // A tab link carries its own padding and underline: its box is the edge, as a button tab's is.
  const tabLink = (el) => {
    const a = el.closest('a');
    if (!a) return null;
    const s = getComputedStyle(a);
    return (a.closest('[role="tablist"], nav') || parseFloat(s.borderBottomWidth) > 0) && parseFloat(s.paddingLeft) > 0 ? a : null;
  };
  // Left of a block's first line: its first text, or the icon/image/control that comes before it.
  const leftOf = (block) => {
    if (isFieldBox(block)) return block.getBoundingClientRect().left;
    const text = texts.find((x) => block.contains(x.node));
    const mark = leadMark(block, text);
    if (mark) return mark.getBoundingClientRect().left;
    const tab = text && tabLink(text.el);
    if (tab && block.contains(tab)) return tab.getBoundingClientRect().left;
    const chip = text && text.el.closest('button, [role="tab"], [role="button"]');
    if (chip && block.contains(chip) && !block.querySelector('svg:not(button svg), img')) return chip.getBoundingClientRect().left; // a chip's own padding is structural
    const pill = text && pillOf(text, block);
    if (pill && block.contains(pill) && pill !== block && !block.querySelector('svg:not(button svg), img')) return pill.getBoundingClientRect().left;
    const lead = [...block.querySelectorAll('svg, img')].find((e) => isVisible(e) && !e.closest('button'));
    if (lead && (!text || (lead.compareDocumentPosition(text.node) & Node.DOCUMENT_POSITION_FOLLOWING))) return lead.getBoundingClientRect().left;
    if (text) return text.left;
    return isControl(block) ? fieldEdge(block) : null;
  };

  const isPanel = (el) => {
    if (el.hasAttribute('data-layout-surface')) return true; // opt-in surface (docs/ux/screen-rules.md "Layout")
    if (/^(BUTTON|INPUT|SELECT|TEXTAREA|A|TH|TD|TR|LI|TABLE|SPAN|LABEL)$/.test(el.tagName) || el.getAttribute('role') === 'button') return false;
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (r.width < 240 || r.height < 56) return false;
    const bordered = parseFloat(s.borderTopWidth) > 0 && s.borderTopStyle !== 'none' && parseFloat(s.borderTopLeftRadius) > 0;
    const shadowed = s.boxShadow !== 'none' && s.backgroundColor !== 'rgba(0, 0, 0, 0)';
    return bordered || shadowed;
  };
  // A KPI tile (DESIGN.md: its own surface with a 16px inset): the KPI row grid (1px rules between
  // tiles) or a standalone tile (a small panel with a testid and a large figure). Its inset is not
  // one of the page column's left edges.
  const isKpiSurface = (el) => {
    const s = getComputedStyle(el);
    if (s.display.includes('grid') && el.tagName === 'SECTION' && parseFloat(s.columnGap) <= 1 && visibleKids(el).length >= 2) return true;
    if (!el.hasAttribute('data-testid') || el.getBoundingClientRect().width > 480) return false;
    return texts.some((t) => el.contains(t.node) && parseFloat(getComputedStyle(t.el).fontSize) >= 24);
  };
  const isRowLayout = (el) => {
    const s = getComputedStyle(el);
    if (s.display.includes('flex')) return !s.flexDirection.startsWith('column');
    if (s.display.includes('grid')) return s.gridTemplateColumns.split(' ').filter(Boolean).length > 1;
    return false;
  };
  const hasOwnText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
  const allPanels = [...main.querySelectorAll('*')].filter((el) => !ignored(el) && isVisible(el) && isPanel(el) && !el.closest('table'));

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
  // A block that is centred or right-aligned in the room its parent gives it does not start a line at the left edge.
  // The block, or a group it sits in (a logo mark inside a centred logo-and-name pair), is centred or right-aligned.
  const offStart = (el) => {
    for (let n = el, i = 0; n && n !== main && i < 3 && (i === 0 || !isPanel(n)); n = n.parentElement, i++) if (offStartSelf(n)) return true; // never through a panel: its contents are judged against the panel's own edges
    return false;
  };
  const offStartSelf = (el) => {
    const text = texts.find((x) => el.contains(x.node));
    if (text) {
      const align = getComputedStyle(text.el).textAlign;
      const rect = el.getBoundingClientRect();
      if (/^(center|right|end)$/.test(align) && rect.width - (text.right - text.left) > 16) return true;
    }
    const rect = el.getBoundingClientRect();
    for (let host = el.parentElement; host && host !== main.parentElement; host = host.parentElement) {
      const hs = getComputedStyle(host);
      const hr = host.getBoundingClientRect();
      const left = hr.left + parseFloat(hs.borderLeftWidth) + parseFloat(hs.paddingLeft);
      const right = hr.right - parseFloat(hs.borderRightWidth) - parseFloat(hs.paddingRight);
      if (right - left <= rect.width + 16) { if (left === hr.left && right === hr.right) continue; return false; } // look through bare wrappers only; a padded surface that the block fills is not a room to align in
      const freeLeft = rect.left - left; const freeRight = right - rect.right;
      // narrow and more than one indent step in: a control pushed or centred in its row. A full-width block with a margin-left indent stays a stray edge.
      return rect.width <= 0.6 * (right - left) && freeLeft > 24 && (freeRight <= 4 || Math.abs(freeLeft - freeRight) <= 4);
    }
    return false;
  };
  const edgesOf = (blocks, boxLeftForPanels) => {
    const edges = {};
    const seen = [];
    for (const b of blocks) {
      if (!b.panel && offStart(b.el)) continue;
      const x = b.panel && boxLeftForPanels ? b.el.getBoundingClientRect().left : leftOf(b.el);
      if (x === null || b.el.tagName === 'TABLE' || b.el.querySelector(':scope > table')) continue; // tables sit flush to the panel edge by design
      // A block beside an earlier one on the same line is a column, not a new line start.
      const rect = b.el.getBoundingClientRect();
      if (seen.some((o) => rect.top < o.bottom - 2 && rect.left > o.left)) { seen.push(rect); continue; }
      seen.push(rect);
      const near = Object.keys(edges).map(Number).find((e) => Math.abs(e - x) <= 4); // optical drift (icon glyph inside its box) is one edge
      const k = near ?? Math.round(x);
      (edges[k] ||= []).push({ sel: sel(b.el), path: path(b.el) });
    }
    return edges;
  };
  const edgeRecord = (surface, surfacePath, limit, edges) => {
    // The edges beyond the `limit` most-used ones are the stray ones; each stray block is one fingerprint part,
    // named by its offset from the most-used edge.
    const ranked = Object.entries(edges).sort(([ax, a], [bx, b]) => b.length - a.length || Number(ax) - Number(bx));
    const lead = ranked.length ? Number(ranked[0][0]) : 0;
    return {
      surface, surfacePath, limit,
      edges: Object.fromEntries(Object.entries(edges).map(([k, v]) => [k, v.map((e) => e.sel).slice(0, 3)])),
      strays: ranked.slice(limit).flatMap(([k, v]) => v.map((e) => ({ path: e.path, offset: Number(k) - lead }))),
    };
  };
  // In the page column a panel shows two edges: its own box (the gutter) and where its content
  // starts (its inset). Flat sections add their own first line. More than two means a stray edge.
  const pageBlocks = blocksOf(main, true);
  const pageEdges = edgesOf(pageBlocks, true);
  for (const b of pageBlocks) {
    if (!b.panel || isKpiSurface(b.el)) continue;
    const inner = edgesOf(blocksOf(b.el, false), false);
    const first = Object.keys(inner).map(Number).sort((x, y) => x - y)[0];
    if (first !== undefined) { const near = Object.keys(pageEdges).map(Number).find((e) => Math.abs(e - first) <= 4); (pageEdges[near ?? first] ||= []).push({ sel: `${sel(b.el)} content`, path: `${path(b.el)} content` }); }
  }
  leftEdges.push(edgeRecord('page column', 'page column', 2, pageEdges));
  for (const panel of allPanels) {
    if (isKpiSurface(panel)) continue;
    const edges = edgesOf(blocksOf(panel, false), false);
    if (Object.keys(edges).length) leftEdges.push(edgeRecord(sel(panel), path(panel), 1, edges));
  }

  // 2. gaps -----------------------------------------------------------------------------------
  // The gap is the painted white space between two blocks: from the last painted content of the
  // block above (text, image, control, icon, or the edge of a bordered/shadowed surface) to the
  // first painted content of the block below. Padding and margins stack into it, so a padded
  // wrapper cannot hide a hole.
  const gaps = [];
  const contentEls = [...main.querySelectorAll('img, canvas, svg, input, select, textarea, button, [role="button"]')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility === 'visible' && paintedDeep(e); });
  const extent = (el) => {
    let top = Infinity; let bottom = -Infinity;
    const add = (r) => { top = Math.min(top, r.top); bottom = Math.max(bottom, r.bottom); };
    for (const t of texts) if (el.contains(t.node)) add(t);
    for (const e of contentEls) if (el.contains(e)) add(e.getBoundingClientRect());
    for (const p of allPanels) if (el.contains(p)) add(p.getBoundingClientRect());
    return Number.isFinite(top) ? { top, bottom } : null;
  };
  const headingLike = (el) => {
    if (/^H[2-6]$/.test(el.tagName) || (el.getAttribute('role') === 'heading')) return true;
    const h = el.querySelector('h2, h3, h4, h5, h6, [role="heading"]');
    return !!h && el.getBoundingClientRect().height <= 96 && !el.querySelector('table, input, select, textarea');
  };
  const sectionLike = (el) => isPanel(el) || el.tagName === 'SECTION' || (!!el.querySelector(':scope > h2, :scope > h3, :scope > header h2, :scope > header h3') && !headingLike(el));
  // margin-top:auto pins a child to the foot of its flex column; the space above it is free space, not a gap.
  const autoMargins = [];
  for (const sheet of document.styleSheets) {
    let rules; try { rules = [...sheet.cssRules]; } catch { continue; }
    for (const rule of rules) if (rule.selectorText && (rule.style?.marginTop === 'auto' || rule.style?.marginBlockStart === 'auto')) autoMargins.push(rule.selectorText);
  }
  const pinnedDown = (el) => el.style.marginTop === 'auto' || autoMargins.some((s) => { try { return el.matches(s); } catch { return false; } });
  // A flex/grid item stretched to its row's height holds free space at its foot or between its children.
  const stretchedItem = (parent) => {
    const row = parent.parentElement;
    if (!row || row === main || !isRowLayout(row)) return false;
    const siblings = visibleKids(row);
    if (siblings.length < 2) return false;
    const rp = parent.getBoundingClientRect();
    const ex = extent(parent);
    return !!ex && rp.height - (ex.bottom - ex.top) > 24 && siblings.some((s) => s !== parent && s.getBoundingClientRect().height >= rp.height - 1);
  };
  const scaleOk = (g) => N.scale.some((s) => Math.abs(g - s) <= N.tolerance);
  for (const parent of [main, ...main.querySelectorAll('*')]) {
    if (/^(TABLE|THEAD|TBODY|TR|UL|OL|SELECT|SVG|svg)$/.test(parent.tagName) || ignored(parent) || !isVisible(parent)) continue;
    if (parent !== main && parent.closest('table, ul, ol')) continue;
    const kids = visibleKids(parent).filter((k) => k.getBoundingClientRect().height > 0);
    if (kids.length < 2) continue;
    if (parent !== main && stretchedItem(parent)) continue;
    for (const b of kids) {
      const rb = b.getBoundingClientRect();
      let a = null; let aBottom = -Infinity;
      for (const c of kids) {
        if (c === b) continue;
        const rc = c.getBoundingClientRect();
        const overlap = Math.min(rb.right, rc.right) - Math.max(rb.left, rc.left);
        if (overlap < 1) continue; // any block above that shares a column counts, even a partial one: it is what sits between
        if (rc.bottom <= rb.top + 1 && rc.bottom > aBottom) { a = c; aBottom = rc.bottom; }
      }
      if (!a || pinnedDown(b)) continue;
      const ea = extent(a); const eb = extent(b);
      if (!ea || !eb) continue;
      const gap = Math.round(eb.top - ea.bottom);
      if (gap < 0) continue;
      const follows = texts.some((t) => t.top >= eb.bottom - 1);
      const base = { gap, above: sel(a), below: sel(b), aboveSel: path(a), belowSel: path(b) };
      if (gap > N.maxGap && follows) gaps.push({ kind: 'gap', ...base });
      else if (headingLike(a) && !/^H1$/.test(a.tagName) && !a.querySelector('h1') && !headingLike(b) && (gap < N.headingMin - N.tolerance || gap > N.headingMax + N.tolerance)) gaps.push({ kind: 'heading', ...base });
      else if (!headingLike(a) && !headingLike(b) && sectionLike(a) && sectionLike(b) && gap >= N.minJudged && !scaleOk(gap)) gaps.push({ kind: 'scale', ...base });
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
    if (isKpiSurface(row)) continue; // tiles stretch to the row's height; their figures sit at the top by design
    const all = visibleKids(row).filter((c) => { const r = c.getBoundingClientRect(); return r.width >= 180 && r.height >= 80 && !isKpiSurface(c); });
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
        if (diff > N.columnLevel) columnsLevel.push({ row: sel(row), column: sel(c), rowSel: path(row), columnSel: path(c), ends: Math.round(ends[i]), tallest: Math.round(tallest), diff });
      });
    }
  }

  // 4. rowCentre ------------------------------------------------------------------------------
  const rowCentre = [];
  // A figure carries a currency or ISO prefix, a thousands/decimal separator, or a %, or sits in a tabular-nums element:
  // "15 Nov", "2h" and a count badge "3" are not figures.
  const FIGURE = /^[-+(]?\s*(?:\p{Sc}|[A-Z]{3})\s*[-+]?\d[\d.,\s]*\)?$|^[-+(]?\d{1,3}(?:[,\s]\d{3})+(?:\.\d+)?\)?$|^[-+(]?\d+\.\d+\)?$|^[-+]?\d+(?:\.\d+)?\s*%$/u;
  const isFigure = (t) => {
    const text = t.node.textContent.trim();
    if (text.length > 20 || !/\d/.test(text)) return false;
    return FIGURE.test(text) || (/^[-+(]?[\d.,\s]+\)?$/.test(text) && getComputedStyle(t.el).fontVariantNumeric.includes('tabular-nums'));
  };
  const centreY = (el) => { const r = el.getBoundingClientRect(); return r.top + r.height / 2; };
  const figureIn = (row) => texts.find((t) => row.contains(t.node) && isFigure(t));
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
        if (dy > N.rowCentre) rowCentre.push({ row: sel(row), rowSel: path(row), figure: figure.node.textContent.trim().slice(0, 20), action: sel(action), dy });
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

  // 6. ignored (reported per route; a marker may not hide a panel or most of the page) ------------
  const marked = [...main.querySelectorAll('[data-layout-ignore]')].filter((el) => !el.parentElement?.closest('[data-layout-ignore]'));
  const mainArea = Math.max(1, main.getBoundingClientRect().width * main.scrollHeight);
  const ignoredInfo = {
    count: main.querySelectorAll('[data-layout-ignore]').length,
    share: Math.round(marked.reduce((sum, el) => { const r = el.getBoundingClientRect(); return sum + r.width * r.height; }, 0) / mainArea * 100) / 100,
    coversPanel: marked.some((el) => isPanel(el) || [...el.querySelectorAll('*')].some((c) => isPanel(c))),
  };

  return { leftEdges, gaps, columnsLevel, rowCentre, loneSection, ignored: ignoredInfo };
}

/**
 * Failures, warnings and fingerprints for one measured layout. `state` names the page state
 * ("default", "reads failing"). A fingerprint is `check|selector` with no text sample; repeats of one
 * row group or card class share one. The gate compares fingerprints, never counts.
 */
export function layoutReport(layout, label, state = 'default') {
  const items = new Map();
  const warnings = [];
  const where = `${label} [${state}]`;
  const add = (fp, message) => { if (!items.has(fp)) items.set(fp, message); };
  const N = LAYOUT_NUMBERS;
  for (const surface of layout.leftEdges) {
    const xs = Object.keys(surface.edges);
    if (xs.length <= surface.limit) continue;
    const message = `${where}: leftEdges ${surface.surface}: ${xs.length} left edges (max ${surface.limit}) ${xs.map((x) => `x=${x}: ${surface.edges[x].join(' | ')}`).join('; ')}`;
    const strays = surface.strays?.length ? surface.strays : [{ path: '', offset: 0 }];
    for (const stray of strays) add(`leftEdges|${surface.surfacePath ?? surface.surface}|${stray.path}|${stray.offset >= 0 ? '+' : ''}${stray.offset}`, message);
  }
  for (const g of layout.gaps) {
    const message = g.kind === 'heading'
      ? `${where}: gaps heading content starts ${g.gap}px below it (want ${N.headingMin}-${N.headingMax}px): ${g.above} -> ${g.below}`
      : g.kind === 'scale'
        ? `${where}: gaps ${g.gap}px between sections or panels (want ${N.scale.join(', ')}px): ${g.above} -> ${g.below}`
        : `${where}: gaps ${g.gap}px of white space between blocks (max ${N.maxGap} with content below): ${g.above} -> ${g.below}`;
    add(`gaps-${g.kind}|${g.aboveSel ?? g.above}|${g.belowSel ?? g.below}`, message);
  }
  for (const c of layout.columnsLevel) {
    add(`columnsLevel|${c.rowSel ?? c.row}|${c.columnSel ?? c.column}`, `${where}: columnsLevel column ends ${c.diff}px above its tallest neighbour (max ${N.columnLevel}; ends y=${c.ends}, tallest y=${c.tallest}): ${c.column} in ${c.row}`);
  }
  for (const r of layout.rowCentre) {
    add(`rowCentre|${r.rowSel ?? r.row}`, `${where}: rowCentre figure "${r.figure}" and action centres differ by ${r.dy}px (max ${N.rowCentre}): ${r.action} in ${r.row}`);
  }
  for (const s of layout.loneSection) {
    warnings.push(`${where}: loneSection "${s.heading}" holds one label/value pair: ${s.label} = ${s.value}`);
  }
  for (const r of layout.reused ?? []) add(r.fp, r.message);
  const ign = layout.ignored;
  if (ign?.count) {
    warnings.push(`${where}: ${ign.count} element(s) marked data-layout-ignore cover ${Math.round(ign.share * 100)}% of main`);
    if (ign.coversPanel) add('ignoreMarker|covers-panel', `${where}: ignoreMarker a data-layout-ignore marker covers a panel; mark the stray element, not the surface`);
    if (ign.share > N.ignoreShare) add('ignoreMarker|share', `${where}: ignoreMarker data-layout-ignore covers ${Math.round(ign.share * 100)}% of main (max ${Math.round(N.ignoreShare * 100)}%)`);
  }
  return { failures: [...items.values()], fingerprints: [...items.keys()].sort(), items: Object.fromEntries(items), warnings };
}

// ---------------------------------------------------------------------------------------------
// Five fixed layout rules (owner, 16 Nov): each fails regardless of any baseline, because a screen compared with its
// own baseline passes whatever defect it already had. `measureRules` runs IN THE PAGE (serialized by page.evaluate:
// self-contained, no imports); `rulesReport` and `tabFrameFindings` are plain functions.
//   R1 card inset      inside a card with a heading, every direct content block starts at the heading's left x (±1),
//                      unless it is a table or media spanning the card edge to edge on BOTH sides, or a block that is
//                      centred, or narrow and right-aligned
//   R2 trailing tag    in a list / menu / picker option row, a trailing tag is one line (content height <= 1.5 x its
//                      line height) and the tags of one list share a right edge (±1)
//   R3 section frame   tab bars with the same labels sit at the same left x, top y and width (±1) across routes at one
//                      viewport (`tabFrameFindings`, fed the `tabBars` of every route)
//   R4 lone centring   one row or item in a container taller than twice its height and 64px starts within the
//                      container's top padding (not centred in the room)
//   R5 shared ends     stacked progress bars / tracks in one group share start x and end x (±1); right-aligned figures
//                      in one group of rows (same table column) share their right x (±1)
// Scope: `main`, plus every open dialog, listbox, menu and popover on the page (the opened states).
// ---------------------------------------------------------------------------------------------
export const RULE_NUMBERS = {
  tolerance: 1,
  tagLines: 1.5, // R2: a tag's content height may be at most this many line heights
  loneRatio: 2, // R4: container height over item height
  loneMinHeight: 64, // R4: shorter containers are bars, not panels
  trackMaxHeight: 16,
};

export function measureRules(N) {
  const main = document.querySelector('main');
  const POPUP = '[role="dialog"], [role="listbox"], [role="menu"], [data-radix-popper-content-wrapper]';
  const isVisible = (el) => {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility !== 'visible' || Number(s.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const popups = [...document.querySelectorAll(POPUP)].filter((el) => isVisible(el) && !(main && main.contains(el) && !el.matches('[role="dialog"]')));
  const roots = [...(main ? [main] : []), ...popups].filter((el, i, all) => !all.some((o, j) => j !== i && o !== el && o.contains(el)));
  if (!roots.length) return { skipped: true, findings: [], tabBars: [] };
  const inScope = (el) => roots.some((r) => r.contains(el));
  const all = [...new Set(roots.flatMap((r) => [r, ...r.querySelectorAll('*')]))];

  const inFlow = (el) => { const p = getComputedStyle(el).position; return p !== 'fixed' && p !== 'absolute'; };
  const flatKids = (el) => [...el.children].flatMap((c) => (getComputedStyle(c).display === 'contents' ? flatKids(c) : [c]));
  const visibleKids = (el) => flatKids(el).filter((c) => isVisible(c) && inFlow(c) && !c.closest('.sr-only') && c.tagName !== 'SCRIPT' && c.tagName !== 'STYLE');
  const short = (el, n = 36) => (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, n);
  const stable = (c) => !/[:[\]/%.]/.test(c);
  const desc = (el) => {
    const cls = [...el.classList].filter(stable).slice(0, 2).map((c) => `.${c}`).join('');
    const hook = el.getAttribute('data-testid') || el.getAttribute('aria-label') || el.getAttribute('role');
    return `${el.tagName.toLowerCase()}${cls}${hook ? `[${hook.slice(0, 24)}]` : ''} "${short(el)}"`;
  };
  const box = (r) => ({ x: Math.round(r.left * 10) / 10, y: Math.round((r.top + scrollY) * 10) / 10, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 });
  const hasFill = (el) => { const bg = getComputedStyle(el).backgroundColor; return bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent'; };
  const hasBorder = (el) => { const s = getComputedStyle(el); return parseFloat(s.borderTopWidth) > 0 && s.borderTopStyle !== 'none'; };
  const isPanel = (el) => {
    if (/^(BUTTON|INPUT|SELECT|TEXTAREA|A|TH|TD|TR|LI|TABLE|SPAN|LABEL)$/.test(el.tagName) || el.getAttribute('role') === 'button') return false;
    const s = getComputedStyle(el); const r = el.getBoundingClientRect();
    if (r.width < 240 || r.height < 56) return false;
    return (hasBorder(el) && parseFloat(s.borderTopLeftRadius) > 0) || (s.boxShadow !== 'none' && hasFill(el));
  };
  const isRowLayout = (el) => {
    const s = getComputedStyle(el);
    if (s.display.includes('flex')) return !s.flexDirection.startsWith('column');
    if (s.display.includes('grid')) return s.gridTemplateColumns.split(' ').filter(Boolean).length > 1;
    return false;
  };
  // Every painted text run: { node, el, left, top, right, bottom, lines } (all wrapped lines).
  const textRuns = (root) => {
    const runs = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node; (node = walker.nextNode());) {
      if (!node.textContent.trim()) continue;
      const el = node.parentElement;
      if (!el || el.closest('.sr-only, script, style') || !isVisible(el)) continue;
      const range = document.createRange(); range.selectNodeContents(node);
      const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
      if (!rects.length) continue;
      runs.push({ node, el, left: Math.min(...rects.map((r) => r.left)), top: Math.min(...rects.map((r) => r.top)), right: Math.max(...rects.map((r) => r.right)), bottom: Math.max(...rects.map((r) => r.bottom)), lines: new Set(rects.map((r) => Math.round(r.top))).size });
    }
    return runs;
  };
  // Painted extent of a block: its text, media, controls, and any bordered or filled surface inside it (or itself).
  const extentOf = (block) => {
    let left = Infinity; let right = -Infinity; let top = Infinity; let bottom = -Infinity;
    const add = (r) => { left = Math.min(left, r.left); right = Math.max(right, r.right); top = Math.min(top, r.top); bottom = Math.max(bottom, r.bottom); };
    for (const t of textRuns(block)) add(t);
    for (const e of [block, ...block.querySelectorAll('*')]) {
      if (e.closest('.sr-only') || !isVisible(e) || !inFlow(e)) continue;
      const tag = e.tagName.toLowerCase();
      if (tag !== 'svg' && e.closest('svg')) continue; // an svg is one painted box
      if (/^(img|svg|canvas|video|input|select|textarea|button|progress|meter)$/.test(tag) || hasBorder(e) || hasFill(e)) add(e.getBoundingClientRect());
    }
    return Number.isFinite(left) ? { left, right, top, bottom } : null;
  };
  const findings = [];
  const unionRect = (src) => {
    const list = (Array.isArray(src) ? src : [src]).map((e) => (e.getBoundingClientRect ? e.getBoundingClientRect() : e));
    return { left: Math.min(...list.map((r) => r.left)), top: Math.min(...list.map((r) => r.top)), right: Math.max(...list.map((r) => r.right)), bottom: Math.max(...list.map((r) => r.bottom)), get width() { return this.right - this.left; }, get height() { return this.bottom - this.top; } };
  };
  const seen = new Set();
  const push = (rule, el, numbers, rectSource, extra = {}) => seen.has(`${rule}|${desc(el)}|${JSON.stringify(numbers)}`) ? 0 : seen.add(`${rule}|${desc(el)}|${JSON.stringify(numbers)}`) && findings.push({ rule, el: desc(el), numbers, rect: box(unionRect(rectSource)), ...extra });

  const stackedRects = (els) => { const rects = els.map((e) => e.getBoundingClientRect()); return rects.every((r, i) => rects.every((o, j) => i === j || r.bottom <= o.top + 1 || o.bottom <= r.top + 1)); };

  // R1 card inset ------------------------------------------------------------------------------
  const isHeading = (el) => /^H[1-6]$/.test(el.tagName) || el.getAttribute('role') === 'heading';
  const headingOf = (card) => {
    const kids = visibleKids(card);
    for (const k of kids.slice(0, 2)) {
      if (isHeading(k)) return { heading: k, wrap: null };
      if (k.getBoundingClientRect().height <= 96 && visibleKids(k).length <= 5) {
        const h = [...k.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]')].find((x) => isVisible(x));
        if (h) return { heading: h, wrap: k };
      }
      if (k === kids[0] && textRuns(k).length) break; // the first block is body text, not a heading
    }
    return null;
  };
  const cards = all.filter((el) => el !== main && isVisible(el) && !el.closest('table') && (isPanel(el) || el.tagName === 'SECTION' || el.tagName === 'ARTICLE' || el.getAttribute('role') === 'dialog') && !isRowLayout(el));
  for (const card of cards) {
    const found = headingOf(card);
    if (!found) continue;
    const { heading, wrap } = found;
    const hExt = extentOf(heading);
    if (!hExt) continue;
    // an avatar or icon that leads the heading's row starts the row: the heading's edge is the mark's
    const hr = heading.getBoundingClientRect();
    for (let n = heading; n && n !== card; n = n.parentElement) {
      for (let sib = n.previousElementSibling; sib; sib = sib.previousElementSibling) {
        if (!isVisible(sib)) continue;
        const r = sib.getBoundingClientRect();
        const markish = r.width <= 64 && r.height <= 64 && textRuns(sib).every((t) => t.node.textContent.trim().length <= 3);
        if (markish && r.bottom > hr.top && r.top < hr.bottom && r.right <= hExt.left + 1) hExt.left = Math.min(hExt.left, r.left);
      }
      if (n === (wrap || heading)) break;
    }
    const cr = card.getBoundingClientRect(); const cs = getComputedStyle(card);
    const innerRight = cr.right - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingRight);
    const innerLeft = cr.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft);
    if (Math.abs(hExt.left - innerLeft - (innerRight - hExt.right)) <= 4 && hExt.left - innerLeft > 8) continue; // a centred card has no left edge to share
    const edgeLeft = cr.left + parseFloat(cs.borderLeftWidth); const edgeRight = cr.right - parseFloat(cs.borderRightWidth);
    let past = false;
    for (const block of visibleKids(card)) {
      if (block === (wrap || heading)) { past = true; continue; }
      if (!past) continue;
      const ext = extentOf(block);
      if (!ext) continue;
      const tableEl = block.tagName === 'TABLE' ? block : block.querySelector('table');
      const mediaOnly = /^(IMG|SVG|CANVAS|VIDEO|FIGURE)$/.test(block.tagName.toUpperCase());
      if (tableEl || mediaOnly) {
        const r = (tableEl ?? block).getBoundingClientRect(); // a table or media starts at its own box, not at the text in it
        if (r.left <= edgeLeft + N.tolerance && r.right >= edgeRight - N.tolerance) continue; // full-bleed on both sides
        ext.left = r.left;
      }
      const listEl = /^(UL|OL)$/.test(block.tagName) ? block : block.querySelector(':scope > ul, :scope > ol');
      if (listEl && getComputedStyle(listEl).listStyleType !== 'none') ext.left = Math.min(ext.left, listEl.getBoundingClientRect().left); // a bullet hangs at the list's own edge
      const freeLeft = ext.left - hExt.left; const freeRight = innerRight - ext.right;
      if (Math.abs(freeLeft) <= N.tolerance) continue;
      if (Math.abs(freeLeft - freeRight) <= 4 && freeLeft > 8) continue; // centred: R4's concern, not an edge
      const br = block.getBoundingClientRect();
      if (Math.abs((ext.left - br.left) - (br.right - ext.right)) <= 4 && ext.left - br.left > 8) continue; // content centred inside its own box
      if (freeRight <= 4 && freeLeft > 24 && ext.right - ext.left <= 0.6 * (innerRight - hExt.left)) continue; // narrow, right-aligned
      push('R1', block, { headingX: Math.round(hExt.left * 10) / 10, blockX: Math.round(ext.left * 10) / 10, delta: Math.round((ext.left - hExt.left) * 10) / 10 }, [card], { card: desc(card), heading: short(heading, 40) });
    }
  }

  // R2 trailing tag ----------------------------------------------------------------------------
  const ROW = '[role="option"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="listitem"], li';
  const rows = all.filter((el) => el.matches(ROW) && isVisible(el) && !el.closest('table'));
  const isTag = (el, row) => {
    if (el === row || !isVisible(el) || /^(BUTTON|INPUT|SELECT|TEXTAREA|A|SVG|svg)$/.test(el.tagName)) return false;
    const r = el.getBoundingClientRect(); const rr = row.getBoundingClientRect();
    const text = (el.textContent || '').trim();
    if (!text || text.length > 40 || r.width > 0.5 * rr.width) return false;
    const s = getComputedStyle(el);
    if (!(hasFill(el) || hasBorder(el)) || parseFloat(s.borderTopLeftRadius) < 3) return false;
    return !el.querySelector('input, select, textarea, button');
  };
  const lists = new Map();
  for (const row of rows) {
    const tags = [...row.querySelectorAll('*')].filter((e) => isTag(e, row));
    const outer = tags.filter((e) => !tags.some((o) => o !== e && o.contains(e)));
    const rr = row.getBoundingClientRect();
    const trailing = outer.filter((e) => { const r = e.getBoundingClientRect(); return r.left + r.width / 2 > rr.left + rr.width / 2; }).sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right)[0];
    // A trailing label that is not a pill (a muted code, type or date after the row's main label) is a tag too.
    let host = row;
    while (visibleKids(host).length === 1 && ![...host.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) host = visibleKids(host)[0];
    const hostKids = visibleKids(host);
    const last = hostKids.length >= 2 ? hostKids[hostKids.length - 1] : null;
    const lastText = last ? (last.textContent || '').trim() : '';
    const others = last ? hostKids.slice(0, -1).reduce((sum, k) => sum + k.getBoundingClientRect().width, 0) : 0;
    // a secondary label: short, not interactive, in the row's right half, and no wider than what comes before it (a timeline's text after its date is content)
    const label = last && lastText && lastText.length <= 40 && !last.matches('button, a, svg, input, select, textarea') && !last.querySelector('button, a, input, select, textarea') && last.getBoundingClientRect().left + last.getBoundingClientRect().width / 2 > rr.left + rr.width / 2 && last.getBoundingClientRect().width <= others + 24 ? last : null;
    const tag = trailing && label ? (trailing.getBoundingClientRect().right >= label.getBoundingClientRect().right ? trailing : label) : trailing || label;
    if (!tag) continue;
    const key = row.closest('[role="listbox"], [role="menu"], ul, ol, [role="list"]') ?? row.parentElement;
    if (!lists.has(key)) lists.set(key, []);
    lists.get(key).push(tag);
  }
  for (const [list, tags] of lists) {
    const wrapped = [];
    for (const tag of tags) {
      const s = getComputedStyle(tag); const r = tag.getBoundingClientRect();
      const lh = s.lineHeight === 'normal' ? 1.2 * parseFloat(s.fontSize) : parseFloat(s.lineHeight);
      const runs = textRuns(tag); // the tag's text block, not its box: a flex row can stretch the box past one line
      const content = runs.length ? Math.max(...runs.map((t) => t.bottom)) - Math.min(...runs.map((t) => t.top)) : r.height;
      const lines = Math.max(...runs.map((t) => t.lines), 1);
      if (lines > 1 || content > N.tagLines * lh + 0.5) wrapped.push({ tag, lines, content, lh });
    }
    if (wrapped.length) { // one finding per list: the first tag that wraps, and how many do
      const w = wrapped[0];
      push('R2', w.tag, { check: 'one line', wrapped: wrapped.length, of: tags.length, lines: Math.max(...wrapped.map((x) => x.lines)), contentHeight: Math.round(w.content * 10) / 10, lineHeight: Math.round(w.lh * 10) / 10 }, [list], { list: desc(list) });
    }
    if (tags.length < 2 || !stackedRects(tags.map((t) => t.closest(ROW) ?? t))) continue; // a grid of items is not a column of rows
    const rights = tags.map((t) => t.getBoundingClientRect().right);
    const counts = new Map(); rights.forEach((x) => { const k = Math.round(x); counts.set(k, (counts.get(k) ?? 0) + 1); });
    const mode = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
    const off = tags.filter((t, i) => Math.abs(rights[i] - mode) > N.tolerance);
    if (off.length) push('R2', off[0], { check: 'shared right edge', edge: mode, rights: [...new Set(rights.map((x) => Math.round(x * 10) / 10))].slice(0, 6), tags: tags.length, off: off.length }, [list], { list: desc(list) });
  }

  // R3 tab bars (compared across routes by tabFrameFindings) ------------------------------------
  const tabBars = [];
  const barEls = new Set();
  for (const el of all) {
    if (el.getAttribute('role') === 'tablist' || (el.tagName === 'NAV' && el.querySelectorAll('a[href]').length >= 2)) barEls.add(el);
    if (el.getAttribute('role') === 'tab' && el.parentElement) barEls.add(el.parentElement);
  }
  for (const el of barEls) {
    if (!isVisible(el) || el.closest('[role="dialog"]')) continue;
    const labels = [...el.querySelectorAll('[role="tab"], a[href], button')].filter((x) => isVisible(x)).map((x) => short(x, 24)).filter(Boolean);
    if (labels.length < 2) continue;
    const r = el.getBoundingClientRect();
    tabBars.push({ labels: labels.join(' | '), x: Math.round(r.left * 10) / 10, y: Math.round((r.top + scrollY) * 10) / 10, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, el: desc(el).replace(/ ".*$/, '') });
  }

  // R4 lone centring ---------------------------------------------------------------------------
  for (const el of all) {
    if (roots.includes(el) || /^(TABLE|THEAD|TBODY|TR|TD|TH|UL|OL|SELECT|OPTION|BUTTON|INPUT|TEXTAREA|SVG|svg|HTML|BODY)$/.test(el.tagName) || el.closest('svg, table, .sr-only') || !isVisible(el)) continue;
    const s = getComputedStyle(el);
    if (s.position === 'fixed') continue;
    const r = el.getBoundingClientRect();
    if (r.height < N.loneMinHeight) continue;
    const kids = visibleKids(el);
    const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    let item = null;
    if (kids.length === 1 && !ownText) item = kids[0].getBoundingClientRect();
    else if (!kids.length && ownText) { const t = textRuns(el).filter((x) => x.el === el); if (t.length) item = { top: Math.min(...t.map((x) => x.top)), bottom: Math.max(...t.map((x) => x.bottom)), height: Math.max(...t.map((x) => x.bottom)) - Math.min(...t.map((x) => x.top)) }; }
    if (!item || item.height <= 0 || r.height <= N.loneRatio * item.height) continue;
    if (kids.length === 1 && kids[0].getAttribute('role') === 'dialog') continue;
    const padTop = r.top + parseFloat(s.borderTopWidth) + parseFloat(s.paddingTop);
    const above = item.top - padTop;
    if (above > N.tolerance) push('R4', el, { containerHeight: Math.round(r.height), itemHeight: Math.round(item.height), freeAbove: Math.round(above), paddingTop: Math.round(parseFloat(s.paddingTop)) }, el, { item: kids.length === 1 ? desc(kids[0]) : short(el) });
  }

  // R5 shared ends ----------------------------------------------------------------------------
  const tracks = all.filter((el) => {
    if (!isVisible(el) || el.closest('svg')) return false;
    if (el.matches('[role="progressbar"], [role="meter"], progress, meter')) return true;
    const s = getComputedStyle(el); const r = el.getBoundingClientRect();
    if (r.height > N.trackMaxHeight || r.height < 2 || r.width < 40 || s.overflow === 'visible' || !(parseFloat(s.borderTopLeftRadius) > 0)) return false;
    return visibleKids(el).length === 1 && /%$/.test(visibleKids(el)[0].style.width || '');
  }).filter((el, _i, list) => !list.some((o) => o !== el && o.contains(el)));
  const rowSig = (k) => `${k.tagName}|${k.getAttribute('class') || ''}|${k.getAttribute('role') || ''}`;
  // Stacked tracks form one group when they are direct siblings, or the first track of each row of one repeated row group.
  const claimed = new Set();
  const trackGroups = [];
  for (const parent of all) {
    const direct = tracks.filter((t) => t.parentElement === parent && !claimed.has(t));
    if (direct.length >= 2) { direct.forEach((t) => claimed.add(t)); trackGroups.push(direct); }
    const bySig = {};
    for (const k of visibleKids(parent)) (bySig[rowSig(k)] ||= []).push(k);
    for (const rows of Object.values(bySig)) {
      const items = rows.length < 2 ? [] : rows.map((r) => tracks.find((t) => r.contains(t) && !claimed.has(t))).filter(Boolean);
      if (items.length >= 2) { items.forEach((t) => claimed.add(t)); trackGroups.push(items); }
    }
  }
  for (const group of trackGroups) {
    if (!stackedRects(group)) continue;
    const rects = group.map((t) => t.getBoundingClientRect());
    for (const edge of ['left', 'right']) {
      const xs = rects.map((r) => r[edge]);
      const counts = new Map(); xs.forEach((x) => { const k = Math.round(x); counts.set(k, (counts.get(k) ?? 0) + 1); });
      const mode = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
      const off = group.filter((t, i) => Math.abs(xs[i] - mode) > N.tolerance);
      if (off.length) push('R5', off[0], { check: edge === 'left' ? 'track start' : 'track end', edge: mode, values: [...new Set(xs.map((x) => Math.round(x * 10) / 10))].slice(0, 6), tracks: group.length, off: off.length }, group);
    }
  }
  const FIGURE = /^[-+(]?\s*(?:\p{Sc}|[A-Z]{3})\s*[-+]?\d[\d.,\s]*\)?$|^[-+(]?\d{1,3}(?:[,\s]\d{3})+(?:\.\d+)?\)?$|^[-+(]?\d+\.\d+\)?$|^[-+]?\d+(?:\.\d+)?\s*%$/u;
  const isFigure = (t) => {
    const text = t.node.textContent.trim();
    if (text.length > 20 || !/\d/.test(text)) return false;
    return FIGURE.test(text) || (/^[-+(]?[\d.,\s]+\)?$/.test(text) && getComputedStyle(t.el).fontVariantNumeric.includes('tabular-nums'));
  };
  for (const parent of all) {
    if (/^(THEAD|SELECT|svg)$/.test(parent.tagName) || !isVisible(parent)) continue;
    const kids = visibleKids(parent);
    const groups = {};
    for (const k of kids) (groups[rowSig(k)] ||= []).push(k);
    for (const group of Object.values(groups)) {
      if (group.length < 2 || group.some((row) => row.getBoundingClientRect().height > 160) || !stackedRects(group)) continue;
      const byColumn = {};
      for (const row of group) {
        const rr = row.getBoundingClientRect(); const rs = getComputedStyle(row);
        const rowRight = rr.right - parseFloat(rs.borderRightWidth) - parseFloat(rs.paddingRight);
        let ordinal = 0;
        for (const t of textRuns(row).filter(isFigure)) {
          const align = getComputedStyle(t.el).textAlign;
          const cell = t.el.closest('td, th, [role="cell"], [role="gridcell"]');
          const er = t.el.getBoundingClientRect();
          const flush = Math.abs(er.right - rowRight) <= 1 && er.width - (t.right - t.left) <= 2; // pushed to the row's end and shrink-wrapped
          if (!(/^(right|end)$/.test(align) || flush)) continue;
          const key = cell && cell.parentElement ? `cell${[...cell.parentElement.children].indexOf(cell)}` : `n${ordinal++}`;
          (byColumn[key] ||= []).push({ row, t, right: cell ? Math.max(...textRuns(cell).map((x) => x.right)) : t.right }); // a unit after the figure ends the cell's text
        }
      }
      for (const [key, items] of Object.entries(byColumn)) {
        if (items.length < 2) continue;
        const counts = new Map(); items.forEach(({ right }) => { const k = Math.round(right); counts.set(k, (counts.get(k) ?? 0) + 1); });
        const mode = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
        const off = items.filter(({ right }) => Math.abs(right - mode) > N.tolerance);
        if (off.length) push('R5', off[0].t.el, { check: 'figure right edge', column: key, edge: mode, values: [...new Set(items.map(({ right }) => Math.round(right * 10) / 10))].slice(0, 6), figures: items.length, off: off.length }, items.map((i) => i.row), { figure: off[0].t.node.textContent.trim() });
      }
    }
  }
  return { skipped: false, findings, tabBars };
}

const RULE_NAMES = { R1: 'cardInset', R2: 'trailingTag', R3: 'sectionFrame', R4: 'loneCentring', R5: 'sharedEnds' };
const detail = (n) => Object.entries(n).map(([k, v]) => `${k}=${Array.isArray(v) ? `[${v.join(', ')}]` : v}`).join(' ');

/** One line per finding: `route @viewport: R1 cardInset: element; numbers`. `label` is "route @width". */
export function rulesReport(measured, label) {
  const lines = (measured?.findings ?? []).map((f) => `${label}: ${f.rule} ${RULE_NAMES[f.rule]}${f.card ? ` in ${f.card}` : ''}${f.list ? ` in ${f.list}` : ''}${f.item ? ` (item ${f.item})` : ''}: ${f.el}; ${detail(f.numbers)}`);
  return { findings: measured?.findings ?? [], failures: lines };
}

/**
 * R3 across routes. `bars` = [{ route, width, role, labels, x, y, w, el }] from every measured route; routes that
 * render the same tab labels at one viewport must agree on left x, top y and width (±1). The first route listed is
 * the reference; each route that differs is one finding.
 */
export function tabFrameFindings(bars, tolerance = RULE_NUMBERS.tolerance) {
  const out = [];
  const groups = new Map();
  for (const bar of bars) {
    const key = `${bar.width}|${bar.labels.replace(/[\d$.,]+[MKB]?/g, '')}`; // a count or amount in a label is data, not a different tab bar
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(bar);
  }
  for (const [, group] of groups) {
    const routes = new Set(group.map((b) => b.route));
    if (routes.size < 2) continue;
    const counts = new Map(); group.forEach((b) => { const k = `${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.w)}`; counts.set(k, (counts.get(k) ?? 0) + 1); });
    const [refKey] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    const ref = group.find((b) => `${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.w)}` === refKey);
    for (const b of group) {
      if (Math.abs(b.x - ref.x) <= tolerance && Math.abs(b.y - ref.y) <= tolerance && Math.abs(b.w - ref.w) <= tolerance) continue;
      out.push({ rule: 'R3', route: b.route, width: b.width, role: b.role, el: b.el, labels: b.labels, numbers: { x: b.x, y: b.y, w: b.w, refX: ref.x, refY: ref.y, refW: ref.w, refRoute: ref.route }, message: `${b.route} @${b.width}: R3 sectionFrame: tab bar "${b.labels}" at x=${b.x} y=${b.y} w=${b.w}, but ${ref.route} has it at x=${ref.x} y=${ref.y} w=${ref.w}` });
    }
  }
  return out;
}
