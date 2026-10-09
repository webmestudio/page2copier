/**
 * Functions injected into the page before capture.
 *
 * Every function here is serialised by chrome.scripting.executeScript, so each
 * one must be completely self contained: no imports, no closure variables.
 * State that needs to survive between injections is parked on the isolated
 * world's `window.__page2copier` (or fallback `window.__page2pdf`), which persists for the lifetime of the frame.
 */

/** Measures the real painted size of the document. */
export function measurePage() {
  const de = document.documentElement;
  const body = document.body;
  const viewportW = window.innerWidth || (de ? de.clientWidth : 1280);
  const viewportH = window.innerHeight || (de ? de.clientHeight : 800);

  const deClientW = de ? de.clientWidth : 0;
  const bodyClientW = body ? body.clientWidth : 0;
  const baseWidth = Math.max(deClientW, bodyClientW, viewportW);

  // If scrollWidth is moderately larger (e.g. wide table, pre block up to 1.35x), allow it.
  // Clamp extreme overflows (e.g. offscreen drawers or negative margins) to prevent shrinking PDF scale or giant blank margins.
  const deScrollW = de ? de.scrollWidth : 0;
  const bodyScrollW = body ? body.scrollWidth : 0;
  const maxScrollW = Math.max(deScrollW, bodyScrollW, baseWidth);
  const width = maxScrollW > baseWidth && maxScrollW <= baseWidth * 1.35 ? maxScrollW : baseWidth;

  const height = Math.max(
    de ? de.scrollHeight : 0,
    de ? de.offsetHeight : 0,
    de ? de.clientHeight : 0,
    body ? body.scrollHeight : 0,
    body ? body.offsetHeight : 0,
    viewportH
  );

  return {
    width: Math.max(320, Math.round(width)),
    height: Math.max(200, Math.round(height)),
    viewportWidth: viewportW,
    viewportHeight: viewportH,
    dpr: window.devicePixelRatio || 1,
    title: document.title || '',
    url: location.href,
    host: location.hostname,
    hasSelection: !window.getSelection().isCollapsed,
  };
}

/**
 * Walks the whole document so lazy loaders fire, forces deferred images to
 * load, then waits for images and fonts to settle. This is what stops the
 * classic half empty PDF of an infinite scroll article.
 */
export async function primePage(options) {
  const opts = options || {};
  const store = (window.__page2copier = window.__page2copier || window.__page2pdf || { undo: [] });
  const record = (el, prop, isAttr) => {
    store.undo.push({
      el,
      prop,
      isAttr: Boolean(isAttr),
      prev: isAttr ? el.getAttribute(prop) : el.style.getPropertyValue(prop),
      priority: isAttr ? '' : el.style.getPropertyPriority(prop),
    });
  };
  store.record = record;

  const startX = window.scrollX;
  const startY = window.scrollY;

  // Unlock scroll containers that pages lock while a modal or banner is open.
  for (const el of [document.documentElement, document.body]) {
    if (!el) continue;
    const cs = getComputedStyle(el);
    if (cs.overflow === 'hidden' || cs.overflowY === 'hidden' || cs.position === 'fixed') {
      record(el, 'overflow');
      record(el, 'position');
      record(el, 'height');
      el.style.setProperty('overflow', 'visible', 'important');
      if (cs.position === 'fixed') el.style.setProperty('position', 'static', 'important');
      el.style.setProperty('height', 'auto', 'important');
    }
  }

  // Force every deferred image and responsive picture source to load.
  for (const img of document.images) {
    if (img.loading === 'lazy') {
      record(img, 'loading', true);
      img.loading = 'eager';
    }
    if (img.decoding === 'async') img.decoding = 'sync';

    const lazySrc =
      img.dataset.src ||
      img.dataset.original ||
      img.dataset.lazySrc ||
      img.getAttribute('data-src');
    if (lazySrc && !img.getAttribute('src')) {
      record(img, 'src', true);
      img.setAttribute('src', lazySrc.split(' ')[0]);
    }

    const lazySrcset = img.dataset.srcset || img.getAttribute('data-srcset');
    if (lazySrcset && !img.getAttribute('srcset')) {
      record(img, 'srcset', true);
      img.setAttribute('srcset', lazySrcset);
    }
  }

  for (const source of document.querySelectorAll('picture source[data-srcset]')) {
    const lss = source.getAttribute('data-srcset');
    if (lss && !source.getAttribute('srcset')) {
      record(source, 'srcset', true);
      source.setAttribute('srcset', lss);
    }
  }

  for (const frame of document.querySelectorAll('iframe[loading="lazy"]')) {
    record(frame, 'loading', true);
    frame.loading = 'eager';
  }

  // Scroll the document end to end so viewport driven loaders run.
  if (opts.scrollThrough !== false) {
    const step = Math.max(200, Math.round(window.innerHeight * 0.9));
    const limit = Math.max(1, Math.ceil(document.documentElement.scrollHeight / step)) + 2;
    let previousHeight = 0;
    for (let i = 0; i < Math.min(limit, 400); i += 1) {
      window.scrollTo(0, i * step);
      await new Promise((r) => setTimeout(r, opts.scrollDelay || 60));
      const h = document.documentElement.scrollHeight;
      if (i * step > h) break;
      // Guard against pages that keep growing forever.
      if (h > previousHeight * 4 && previousHeight > 0 && h > 200000) break;
      previousHeight = h;
    }
  }
  window.scrollTo(startX, startY);

  // Give images and webfonts a chance to finish.
  const pending = Array.from(document.images)
    .filter((img) => !img.complete && img.src)
    .map(
      (img) =>
        new Promise((resolve) => {
          const done = () => resolve();
          img.addEventListener('load', done, { once: true });
          img.addEventListener('error', done, { once: true });
          setTimeout(done, opts.imageTimeout || 6000);
        })
    );
  await Promise.all(pending);
  if (document.fonts && document.fonts.ready) {
    await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 3000))]);
  }
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  return true;
}

/**
 * Removes the furniture that makes a saved page look broken: sticky headers
 * repeated on every sheet, cookie walls, chat bubbles, newsletter overlays.
 */
export function declutterPage(options) {
  const opts = options || {};
  const store = (window.__page2copier = window.__page2copier || window.__page2pdf || { undo: [] });
  const record =
    store.record ||
    ((el, prop, isAttr) => {
      store.undo.push({
        el,
        prop,
        isAttr: Boolean(isAttr),
        prev: isAttr ? el.getAttribute(prop) : el.style.getPropertyValue(prop),
        priority: '',
      });
    });
  store.record = record;

  const hide = (el) => {
    record(el, 'display');
    el.style.setProperty('display', 'none', 'important');
  };

  const NOISE = [
    'cookie', 'consent', 'gdpr', 'cmp-', 'onetrust', 'didomi', 'usercentrics', 'cookiebot',
    'newsletter', 'subscribe-overlay', 'paywall-prompt', 'interstitial', 'signup-modal',
    'chat-widget', 'intercom', 'drift-', 'zendesk', 'livechat', 'hubspot-messages', 'crisp-client',
    'back-to-top', 'scroll-to-top', 'social-share-float', 'sticky-ad', 'ad-slot',
    'banner-app', 'smart-banner', 'notification-bar', 'toast-container',
  ];

  const viewportH = window.innerHeight;
  const viewportW = window.innerWidth;

  for (const el of document.body ? document.body.querySelectorAll('*') : []) {
    if (!(el instanceof HTMLElement)) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;

    const id = `${el.id} ${el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className}`.toLowerCase();
    const looksNoisy = NOISE.some((n) => id.includes(n));
    const isFixed = cs.position === 'fixed';
    const isSticky = cs.position === 'sticky';
    const rect = el.getBoundingClientRect();

    if (looksNoisy && (isFixed || isSticky || rect.height > 0)) {
      hide(el);
      continue;
    }

    if (!isFixed && !isSticky) continue;

    // Fullscreen/modal overlays
    const covers = rect.width >= viewportW * 0.8 && rect.height >= viewportH * 0.7;
    const isDialog = el.getAttribute('role') === 'dialog' || el.tagName === 'DIALOG';
    if (opts.removeOverlays !== false && (covers || isDialog)) {
      hide(el);
      continue;
    }

    // Ignore off-screen elements (drawers/menus hidden offscreen)
    if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= viewportW) {
      continue;
    }

    // Floating small action buttons / chat launchers pinned near bottom corners
    if (isFixed && rect.top > viewportH * 0.7 && rect.width < 180 && rect.height < 180) {
      hide(el);
      continue;
    }

    // Fixed top navigation bars: anchor as absolute at top of page 1 so they don't repeat on every PDF page
    // and don't distort standard document flow as static elements would.
    if (isFixed && opts.unpin !== false) {
      if (rect.top <= 10 && rect.width >= viewportW * 0.4) {
        record(el, 'position');
        record(el, 'top');
        el.style.setProperty('position', 'absolute', 'important');
        el.style.setProperty('top', '0px', 'important');
      }
    }
  }

  // Backdrops left behind by removed modals.
  for (const el of document.querySelectorAll('[class*="backdrop"], [class*="overlay"]')) {
    if (!(el instanceof HTMLElement)) continue;
    const cs = getComputedStyle(el);
    if (cs.position === 'fixed' && parseFloat(cs.zIndex || '0') > 100) hide(el);
  }
  return true;
}

/**
 * Opens collapsed regions and expands inner scroll panes, so content that is
 * reachable on screen is not silently cropped in the PDF.
 */
export function expandContent() {
  const store = (window.__page2copier = window.__page2copier || window.__page2pdf || { undo: [] });
  const record = store.record;
  let expanded = 0;

  for (const details of document.querySelectorAll('details:not([open])')) {
    if (record) record(details, 'open', true);
    details.open = true;
    expanded += 1;
  }

  const viewportW = window.innerWidth;
  const IGNORE_TAGS = new Set(['NAV', 'ASIDE', 'HEADER', 'FOOTER', 'MENU', 'SELECT']);
  const IGNORE_HINTS = /sidebar|menu|nav|toc|tree|tab|pagination|dropdown|select|toolbar|drawer|breadcrumb/i;

  for (const el of document.body ? document.body.querySelectorAll('*') : []) {
    if (!(el instanceof HTMLElement)) continue;
    if (el === document.body) continue;
    if (IGNORE_TAGS.has(el.tagName)) continue;

    const role = (el.getAttribute('role') || '').toLowerCase();
    if (role === 'navigation' || role === 'complementary' || role === 'banner' || role === 'search') continue;

    const idClass = `${el.id} ${typeof el.className === 'string' ? el.className : ''}`;
    if (IGNORE_HINTS.test(idClass)) continue;

    const cs = getComputedStyle(el);
    const scrolls =
      (cs.overflowY === 'auto' || cs.overflowY === 'scroll' || cs.overflow === 'auto' || cs.overflow === 'scroll') &&
      el.scrollHeight > el.clientHeight + 16 &&
      el.clientHeight > 50;
    if (!scrolls) continue;

    const rect = el.getBoundingClientRect();
    // Only expand substantial content panes (taking at least 45% of viewport width),
    // avoiding narrow sidebars or tiny widget scrollers that distort grid/flex layouts.
    if (rect.width < viewportW * 0.45 && rect.width < 500) continue;

    // Leave massive virtualized scrollers alone
    if (el.scrollHeight > 30000) continue;

    if (record) {
      record(el, 'max-height');
      record(el, 'height');
      record(el, 'overflow');
    }
    el.style.setProperty('max-height', 'none', 'important');
    el.style.setProperty('height', 'auto', 'important');
    el.style.setProperty('overflow', 'visible', 'important');
    expanded += 1;
  }
  return expanded;
}

/** Injects the stylesheet that governs how content breaks across sheets. */
export function applyPrintCss(css) {
  const existing = document.getElementById('page2pdf-print-css');
  if (existing) existing.remove();
  const style = document.createElement('style');
  style.id = 'page2pdf-print-css';
  style.textContent = css;
  document.documentElement.appendChild(style);
  return true;
}

/**
 * Collects link rectangles in document coordinates so snapshot PDFs can carry
 * real clickable areas instead of dead pictures of links.
 */
export function collectLinks() {
  const out = [];
  const seen = new Set();
  for (const a of document.querySelectorAll('a[href]')) {
    const href = a.href;
    if (!href || href.startsWith('javascript:')) continue;
    const rects = a.getClientRects();
    for (const r of rects) {
      if (r.width < 2 || r.height < 2) continue;
      const x = r.left + window.scrollX;
      const y = r.top + window.scrollY;
      const key = `${Math.round(x)}:${Math.round(y)}:${Math.round(r.width)}:${href}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ x, y, width: r.width, height: r.height, url: href });
      if (out.length > 3000) return out;
    }
  }
  return out;
}

/**
 * Isolates one element so the PDF contains only that region.
 *
 * Rather than resetting styles, which would wreck the element's own layout,
 * this hides everything alongside the ancestor chain and unclips the path down
 * to the target. The element keeps every rule the page gave it.
 */
export function isolateElement() {
  const store = (window.__page2copier = window.__page2copier || window.__page2pdf || { undo: [] });
  const record = store.record;
  const target = store.pickedElement;
  if (!target || !target.isConnected) return null;

  const setProp = (el, prop, value) => {
    if (record) record(el, prop);
    el.style.setProperty(prop, value, 'important');
  };

  let node = target;
  while (node && node.parentElement) {
    const parent = node.parentElement;
    for (const sibling of parent.children) {
      if (sibling === node) continue;
      if (!(sibling instanceof HTMLElement) && !(sibling instanceof SVGElement)) continue;
      if (sibling.tagName === 'STYLE' || sibling.tagName === 'LINK' || sibling.tagName === 'SCRIPT') continue;
      setProp(sibling, 'display', 'none');
    }
    // Unclip and unpad the path so the target sits flush at the top left.
    setProp(parent, 'overflow', 'visible');
    setProp(parent, 'max-height', 'none');
    setProp(parent, 'height', 'auto');
    if (parent !== document.body && parent !== document.documentElement) {
      setProp(parent, 'padding', '0');
      setProp(parent, 'margin', '0');
      setProp(parent, 'border', '0');
      setProp(parent, 'width', 'auto');
    }
    node = parent;
    if (parent === document.documentElement) break;
  }

  for (const el of [document.documentElement, document.body]) {
    if (!el) continue;
    setProp(el, 'margin', '0');
    setProp(el, 'padding', '0');
    setProp(el, 'background', '#ffffff');
    setProp(el, 'height', 'auto');
    setProp(el, 'min-height', '0');
    setProp(el, 'overflow', 'visible');
  }
  setProp(target, 'margin', '0');

  // Shrink the document to the target so the sheet is not mostly blank.
  const first = target.getBoundingClientRect();
  if (first.width > 40) {
    const width = `${Math.ceil(first.width)}px`;
    for (const el of [document.documentElement, document.body]) {
      if (!el) continue;
      setProp(el, 'width', width);
      setProp(el, 'min-width', '0');
      setProp(el, 'max-width', 'none');
    }
  }

  // Force a reflow so the measurement below is the settled one.
  void document.documentElement.offsetHeight;
  const rect = target.getBoundingClientRect();
  return {
    x: rect.left + window.scrollX,
    y: rect.top + window.scrollY,
    width: rect.width,
    height: rect.height,
  };
}

/** Lifts the current selection into a standalone block, then isolates it. */
export function isolateSelection() {
  const store = (window.__page2copier = window.__page2copier || window.__page2pdf || { undo: [] });
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;

  const holder = document.createElement('div');
  holder.setAttribute('data-page2copier-holder', '');
  holder.setAttribute('data-page2pdf-holder', '');
  holder.style.cssText = 'padding:0;margin:0;background:#fff;';
  for (let i = 0; i < selection.rangeCount; i += 1) {
    holder.appendChild(selection.getRangeAt(i).cloneContents());
  }
  // Anchor it inside the original container so inherited styling still applies.
  const anchor = selection.getRangeAt(0).commonAncestorContainer;
  const host =
    (anchor.nodeType === 1 ? anchor : anchor.parentElement) || document.body;
  host.appendChild(holder);

  store.injected = store.injected || [];
  store.injected.push(holder);
  store.pickedElement = holder;
  selection.removeAllRanges();
  return true;
}

/**
 * Reader mode: finds the block that actually holds the article, gives it book
 * typography and marks it as the capture target. Everything is done through the
 * same undo log, so the tab goes back to normal the moment the PDF is written.
 */
export function applyReaderMode() {
  const store = (window.__page2copier = window.__page2copier || window.__page2pdf || { undo: [] });

  const scores = new Map();
  const bump = (el, amount) => {
    if (!el || el === document.body || el === document.documentElement) return;
    scores.set(el, (scores.get(el) || 0) + amount);
  };

  const blocks = document.querySelectorAll('p, pre, blockquote, li > p, td');
  for (const block of blocks) {
    const text = (block.innerText || '').trim();
    if (text.length < 25) continue;
    const points = 1 + Math.min(3, text.split(',').length - 1) + Math.min(3, text.length / 100);
    bump(block.parentElement, points);
    bump(block.parentElement ? block.parentElement.parentElement : null, points / 2);
    bump(
      block.parentElement && block.parentElement.parentElement
        ? block.parentElement.parentElement.parentElement
        : null,
      points / 4
    );
  }

  let best = null;
  let bestScore = 0;
  for (const [el, rawScore] of scores) {
    const textLength = (el.innerText || '').length;
    if (textLength < 140) continue;
    let linkLength = 0;
    for (const a of el.querySelectorAll('a')) linkLength += (a.innerText || '').length;
    const linkDensity = textLength ? linkLength / textLength : 1;
    let score = rawScore * (1 - Math.min(1, linkDensity));
    const tag = el.tagName;
    if (tag === 'ARTICLE' || el.getAttribute('role') === 'main' || tag === 'MAIN') score *= 1.6;
    const hint = `${el.id} ${typeof el.className === 'string' ? el.className : ''}`.toLowerCase();
    if (/article|content|post|entry|story|body|markdown|prose/.test(hint)) score *= 1.3;
    if (/comment|sidebar|footer|nav|promo|related|share/.test(hint)) score *= 0.3;
    if (score > bestScore) {
      bestScore = score;
      best = el;
    }
  }

  // The densest block is often only the paragraph run. Climb a little so the
  // headline, lead image and tables that belong to the piece come along too.
  let article =
    best || document.querySelector('article') || document.querySelector('main') || document.body;
  const linkDensityOf = (el) => {
    const total = (el.innerText || '').length;
    if (!total) return 1;
    let linkLength = 0;
    for (const a of el.querySelectorAll('a')) linkLength += (a.innerText || '').length;
    return linkLength / total;
  };
  for (let step = 0; step < 3; step += 1) {
    const parent = article.parentElement;
    if (!parent || parent === document.body || parent === document.documentElement) break;
    const childText = (article.innerText || '').length;
    const parentText = (parent.innerText || '').length;
    if (childText === 0) break;
    const gain = (parentText - childText) / childText;
    if (gain > 0.35) break;                       // parent drags in a lot of other stuff
    if (linkDensityOf(parent) > 0.28) break;      // parent is mostly navigation
    if ((scores.get(parent) || 0) < bestScore * 0.4) break;
    article = parent;
  }
  if (!article) return null;

  const style = document.createElement('style');
  style.id = 'page2pdf-reader-css';
  style.textContent = `
    [data-page2pdf-reader] {
      font-family: Georgia, 'Iowan Old Style', 'Times New Roman', serif !important;
      font-size: 17px !important;
      line-height: 1.65 !important;
      color: #14181f !important;
      background: #ffffff !important;
      max-width: 40em !important;
      margin: 0 auto !important;
      padding: 0 !important;
      letter-spacing: 0 !important;
    }
    [data-page2pdf-reader] * {
      background: transparent !important;
      color: inherit !important;
      max-width: 100% !important;
      float: none !important;
      position: static !important;
      font-family: inherit !important;
    }
    [data-page2pdf-reader] h1, [data-page2pdf-reader] h2,
    [data-page2pdf-reader] h3, [data-page2pdf-reader] h4 {
      font-family: -apple-system, 'Segoe UI', Roboto, sans-serif !important;
      line-height: 1.25 !important;
      margin: 1.6em 0 0.5em !important;
      color: #0b0e14 !important;
    }
    [data-page2pdf-reader] p { margin: 0 0 1.05em !important; }
    [data-page2pdf-reader] a { color: #1d4ed8 !important; text-decoration: underline !important; }
    [data-page2pdf-reader] img, [data-page2pdf-reader] svg, [data-page2pdf-reader] video {
      display: block !important;
      height: auto !important;
      margin: 1.4em auto !important;
      border-radius: 6px !important;
    }
    [data-page2pdf-reader] pre {
      background: #f4f6fa !important;
      padding: 12px 14px !important;
      border-radius: 8px !important;
      overflow: visible !important;
      white-space: pre-wrap !important;
      word-break: break-word !important;
      font-family: ui-monospace, 'SF Mono', Menlo, monospace !important;
      font-size: 13px !important;
    }
    [data-page2pdf-reader] code { font-family: ui-monospace, Menlo, monospace !important; font-size: 0.92em !important; }
    [data-page2pdf-reader] blockquote {
      border-left: 3px solid #cbd5e1 !important;
      margin: 1.4em 0 !important;
      padding: 0.2em 0 0.2em 1.1em !important;
      color: #3f4854 !important;
      font-style: italic !important;
    }
    [data-page2pdf-reader] table { width: 100% !important; border-collapse: collapse !important; font-size: 14px !important; }
    [data-page2pdf-reader] th, [data-page2pdf-reader] td { border: 1px solid #dde3ec !important; padding: 6px 9px !important; }
    [data-page2pdf-reader] nav, [data-page2pdf-reader] aside, [data-page2pdf-reader] form,
    [data-page2pdf-reader] iframe, [data-page2pdf-reader] button,
    [data-page2pdf-reader] [class*="share"], [data-page2pdf-reader] [class*="related"],
    [data-page2pdf-reader] [class*="newsletter"], [data-page2pdf-reader] [class*="promo"],
    [data-page2pdf-reader] [id*="comment"], [data-page2pdf-reader] [class*="comment"] {
      display: none !important;
    }
    .page2pdf-reader-head {
      font-family: -apple-system, 'Segoe UI', Roboto, sans-serif !important;
      border-bottom: 1px solid #e2e8f0;
      padding-bottom: 14px;
      margin-bottom: 26px;
    }
    .page2pdf-reader-head h1 {
      font-size: 27px !important;
      line-height: 1.2 !important;
      margin: 0 0 8px !important;
      color: #0b0e14 !important;
    }
    .page2pdf-reader-head .meta { font-size: 12px; color: #64748b; word-break: break-all; }
  `;
  document.documentElement.appendChild(style);
  article.setAttribute('data-page2pdf-reader', '');

  // A masthead so the saved article says where it came from.
  const heading = article.querySelector('h1');
  const title =
    (heading && heading.innerText.trim()) ||
    document.title ||
    location.hostname;
  if (heading) heading.style.setProperty('display', 'none', 'important');

  const head = document.createElement('header');
  head.className = 'page2pdf-reader-head';
  const h1 = document.createElement('h1');
  h1.textContent = title;
  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = `${location.hostname} · ${new Date().toLocaleDateString()} · ${location.href}`;
  head.append(h1, meta);
  article.insertBefore(head, article.firstChild);

  store.injected = store.injected || [];
  store.injected.push(head, style);
  store.pickedElement = article;
  return { title };
}

/** Re-measures the isolated target once the layout has settled. */
export function measureTarget() {
  const store = window.__page2copier || window.__page2pdf;
  const target = store && store.pickedElement;
  if (!target || !target.isConnected) return null;
  const rect = target.getBoundingClientRect();
  return {
    x: Math.max(0, rect.left + window.scrollX),
    y: Math.max(0, rect.top + window.scrollY),
    width: Math.max(1, rect.width),
    height: Math.max(1, rect.height),
  };
}

/** Hides the progress pill so it never ends up inside the PDF. */
export function toggleHud(visible) {
  const host = document.getElementById('page2copier-hud-host') || document.getElementById('page2pdf-hud-host');
  if (host) host.style.setProperty('display', visible ? 'block' : 'none', 'important');
  return Boolean(host);
}

/** Marks an element, addressed by a stable path, as the capture target. */
export function markTarget(path) {
  const store = (window.__page2copier = window.__page2copier || window.__page2pdf || { undo: [] });
  const el = path ? document.querySelector(path) : null;
  if (el) store.pickedElement = el;
  return Boolean(store.pickedElement);
}

/** Reverts every mutation made by the functions above. */
export function restorePage() {
  const store = window.__page2copier || window.__page2pdf;
  for (const id of [
    'page2copier-print-css',
    'page2pdf-print-css',
    'page2copier-isolate',
    'page2pdf-isolate',
    'page2copier-reader-css',
    'page2pdf-reader-css',
  ]) {
    const el = document.getElementById(id);
    if (el) el.remove();
  }
  for (const el of document.querySelectorAll('[data-page2copier-reader], [data-page2pdf-reader]')) {
    el.removeAttribute('data-page2copier-reader');
    el.removeAttribute('data-page2pdf-reader');
  }
  if (!store) return true;
  for (const node of store.injected || []) {
    if (node && node.remove) node.remove();
  }
  store.injected = [];
  if (!store.undo) return true;
  for (let i = store.undo.length - 1; i >= 0; i -= 1) {
    const entry = store.undo[i];
    try {
      if (entry.isAttr) {
        if (entry.prev === null) entry.el.removeAttribute(entry.prop);
        else entry.el.setAttribute(entry.prop, entry.prev);
      } else if (entry.prev) {
        entry.el.style.setProperty(entry.prop, entry.prev, entry.priority || '');
      } else {
        entry.el.style.removeProperty(entry.prop);
      }
    } catch {
      /* element gone, nothing to restore */
    }
  }
  // Drop style attributes we emptied out, so the DOM is byte for byte as found.
  for (const entry of store.undo) {
    try {
      if (!entry.isAttr && entry.el.getAttribute && entry.el.getAttribute('style') === '') {
        entry.el.removeAttribute('style');
      }
    } catch {
      /* element gone */
    }
  }
  store.undo = [];
  store.pickedElement = null;
  return true;
}

/**
 * Serializes the entire page into a clean, standalone HTML document string.
 * Resolves relative URLs to absolute URLs, embeds live form values,
 * inlines stylesheets with absolutized URLs, converts canvases to data URLs,
 * and strips runtime script tags and extension artifacts.
 */
export function exportPageHtml() {
  const clone = document.documentElement.cloneNode(true);

  // Remove extension-injected elements
  const removeSelectors = [
    '#page2copier-hud-host',
    '#page2pdf-hud-host',
    '#page2copier-picker-host',
    '#page2pdf-picker-host',
    '#page2copier-print-css',
    '#page2pdf-print-css',
    '#page2copier-reader-css',
    '#page2pdf-reader-css',
    '#page2copier-isolate',
    '#page2pdf-isolate',
    '[data-page2copier-holder]',
    '[data-page2pdf-holder]',
  ];
  for (const sel of removeSelectors) {
    for (const el of clone.querySelectorAll(sel)) {
      el.remove();
    }
  }

  // Remove all script tags so saved HTML is inert and secure
  for (const script of clone.querySelectorAll('script')) {
    script.remove();
  }

  // Synchronize live form values to cloned elements
  const liveInputs = Array.from(document.querySelectorAll('input, textarea, select'));
  const cloneInputs = Array.from(clone.querySelectorAll('input, textarea, select'));
  for (let i = 0; i < liveInputs.length && i < cloneInputs.length; i += 1) {
    const live = liveInputs[i];
    const cl = cloneInputs[i];
    const tag = live.tagName.toLowerCase();
    if (tag === 'textarea') {
      cl.textContent = live.value;
    } else if (tag === 'select') {
      const liveOptions = Array.from(live.options);
      const clOptions = Array.from(cl.querySelectorAll('option'));
      for (let j = 0; j < liveOptions.length && j < clOptions.length; j += 1) {
        if (liveOptions[j].selected) {
          clOptions[j].setAttribute('selected', '');
        } else {
          clOptions[j].removeAttribute('selected');
        }
      }
    } else if (tag === 'input') {
      const type = (live.type || '').toLowerCase();
      if (type === 'checkbox' || type === 'radio') {
        if (live.checked) {
          cl.setAttribute('checked', '');
        } else {
          cl.removeAttribute('checked');
        }
      } else {
        cl.setAttribute('value', live.value);
      }
    }
  }

  // Replace canvases with <img> data URLs
  const liveCanvases = Array.from(document.querySelectorAll('canvas'));
  const cloneCanvases = Array.from(clone.querySelectorAll('canvas'));
  for (let i = 0; i < liveCanvases.length && i < cloneCanvases.length; i += 1) {
    try {
      const dataUrl = liveCanvases[i].toDataURL('image/png');
      const img = document.createElement('img');
      img.src = dataUrl;
      img.alt = liveCanvases[i].getAttribute('aria-label') || 'Canvas Export';
      if (cloneCanvases[i].className) img.className = cloneCanvases[i].className;
      if (cloneCanvases[i].style.cssText) img.style.cssText = cloneCanvases[i].style.cssText;
      cloneCanvases[i].replaceWith(img);
    } catch {
      // tainted or failed canvas export; keep as-is
    }
  }

  // Helper to absolutize a URL relative to document.baseURI
  const toAbs = (url) => {
    if (!url || typeof url !== 'string') return url;
    const trimmed = url.trim();
    if (
      trimmed.startsWith('data:') ||
      trimmed.startsWith('blob:') ||
      trimmed.startsWith('javascript:') ||
      trimmed.startsWith('#')
    ) {
      return trimmed;
    }
    try {
      return new URL(trimmed, document.baseURI).href;
    } catch {
      return trimmed;
    }
  };

  // Convert srcset to absolute URLs
  const absolutizeSrcset = (srcset) => {
    if (!srcset) return srcset;
    return srcset
      .split(',')
      .map((part) => {
        const item = part.trim();
        const firstSpace = item.indexOf(' ');
        if (firstSpace === -1) return toAbs(item);
        const url = item.slice(0, firstSpace);
        const desc = item.slice(firstSpace);
        return `${toAbs(url)}${desc}`;
      })
      .join(', ');
  };

  // Absolutize HTML attributes
  for (const el of clone.querySelectorAll('*')) {
    if (el.hasAttribute('src')) el.setAttribute('src', toAbs(el.getAttribute('src')));
    if (el.hasAttribute('href')) el.setAttribute('href', toAbs(el.getAttribute('href')));
    if (el.hasAttribute('poster')) el.setAttribute('poster', toAbs(el.getAttribute('poster')));
    if (el.hasAttribute('srcset')) el.setAttribute('srcset', absolutizeSrcset(el.getAttribute('srcset')));

    const styleAttr = el.getAttribute('style');
    if (styleAttr && styleAttr.includes('url(')) {
      const rewritten = styleAttr.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (_m, _q, relUrl) => {
        return `url("${toAbs(relUrl)}")`;
      });
      el.setAttribute('style', rewritten);
    }
  }

  // Absolutize URLs inside CSS text
  const absolutizeCss = (cssText, baseUrl) => {
    if (!cssText) return '';
    return cssText.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (_m, _q, relUrl) => {
      const cleanUrl = relUrl.trim();
      if (
        cleanUrl.startsWith('data:') ||
        cleanUrl.startsWith('blob:') ||
        cleanUrl.startsWith('#')
      ) {
        return `url("${cleanUrl}")`;
      }
      try {
        const abs = new URL(cleanUrl, baseUrl || document.baseURI).href;
        return `url("${abs}")`;
      } catch {
        return `url("${cleanUrl}")`;
      }
    });
  };

  // Inline accessible stylesheet rules
  let inlinedStyles = '';
  for (let i = 0; i < document.styleSheets.length; i += 1) {
    const sheet = document.styleSheets[i];
    try {
      const rules = sheet.cssRules;
      if (rules) {
        let sheetCss = '';
        for (let j = 0; j < rules.length; j += 1) {
          sheetCss += rules[j].cssText + '\n';
        }
        inlinedStyles += absolutizeCss(sheetCss, sheet.href || document.baseURI) + '\n';
      }
    } catch {
      // Cross-origin stylesheet rules cannot be read directly; keep original links absolutized
    }
  }

  let head = clone.querySelector('head');
  if (!head) {
    head = document.createElement('head');
    clone.insertBefore(head, clone.firstChild);
  }

  if (!head.querySelector('meta[charset]')) {
    const meta = document.createElement('meta');
    meta.setAttribute('charset', 'UTF-8');
    head.insertBefore(meta, head.firstChild);
  }

  if (inlinedStyles) {
    const styleTag = document.createElement('style');
    styleTag.setAttribute('type', 'text/css');
    styleTag.setAttribute('data-page2copier-inlined', '');
    styleTag.textContent = inlinedStyles;
    head.appendChild(styleTag);
  }

  const doctype = document.doctype
    ? `<!DOCTYPE ${document.doctype.name}${document.doctype.publicId ? ` PUBLIC "${document.doctype.publicId}"` : ''}${document.doctype.systemId ? ` "${document.doctype.systemId}"` : ''}>`
    : '<!DOCTYPE html>';

  return `${doctype}\n${clone.outerHTML}`;
}
