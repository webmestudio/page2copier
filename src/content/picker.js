/**
 * Element picker.
 *
 * Hover to outline a block, click to save it as either a PDF, PNG image, or standalone HTML.
 * Keyboard shortcuts:
 *  - M: toggle between PDF, PNG, and HTML mode
 *  - Up/Down arrows: widen or narrow element hierarchy
 *  - Enter: confirm selection
 *  - Esc: cancel
 */
(() => {
  if (window.__page2copierPicker || window.__page2pdfPicker) {
    return;
  }

  const store = (window.__page2copier = window.__page2pdf = window.__page2copier || window.__page2pdf || { undo: [] });
  let host = null;
  let ui = null;
  let current = null;
  let active = false;
  let currentMode = 'pdf'; // 'pdf' | 'png' | 'html'

  const STYLE = `
    :host {
      all: initial;
      position: fixed;
      z-index: 2147483647;
      pointer-events: none;
    }
    .box {
      position: fixed;
      pointer-events: none;
      border-radius: 6px;
      transition: all .08s linear;
      z-index: 2147483646;
    }
    .box.mode-pdf {
      border: 2px solid rgba(99, 102, 241, .95);
      background: linear-gradient(140deg, rgba(99, 102, 241, .16), rgba(34, 211, 238, .14));
      box-shadow: 0 0 0 100vmax rgba(9, 12, 28, .34), 0 10px 30px rgba(8, 12, 30, .3);
    }
    .box.mode-png {
      border: 2px solid rgba(14, 165, 233, .95);
      background: linear-gradient(140deg, rgba(14, 165, 233, .16), rgba(56, 189, 248, .14));
      box-shadow: 0 0 0 100vmax rgba(9, 12, 28, .34), 0 10px 30px rgba(8, 12, 30, .3);
    }
    .box.mode-html {
      border: 2px solid rgba(16, 185, 129, .95);
      background: linear-gradient(140deg, rgba(16, 185, 129, .16), rgba(20, 184, 166, .14));
      box-shadow: 0 0 0 100vmax rgba(9, 12, 28, .34), 0 10px 30px rgba(8, 12, 30, .3);
    }
    .tag {
      position: fixed;
      z-index: 2147483647;
      pointer-events: none;
      font: 600 11px/1.3 ui-monospace, Menlo, Consolas, monospace;
      color: #f3f7ff;
      background: rgba(30, 34, 66, .92);
      border: 1px solid rgba(255, 255, 255, .18);
      backdrop-filter: blur(10px);
      padding: 5px 9px;
      border-radius: 7px;
      white-space: nowrap;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .badge {
      font-size: 10px;
      font-weight: 700;
      padding: 2px 5px;
      border-radius: 4px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .badge.mode-pdf {
      background: #4f46e5;
      color: #ffffff;
    }
    .badge.mode-png {
      background: #0284c7;
      color: #ffffff;
    }
    .badge.mode-html {
      background: #059669;
      color: #ffffff;
    }
    .hint {
      position: fixed;
      left: 50%;
      top: 22px;
      transform: translateX(-50%);
      z-index: 2147483647;
      pointer-events: none;
      display: flex;
      align-items: center;
      gap: 12px;
      font: 500 13px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      color: #eaf2ff;
      background: linear-gradient(140deg, rgba(38, 44, 84, .9), rgba(18, 22, 44, .94));
      backdrop-filter: blur(18px) saturate(150%);
      border: 1px solid rgba(255, 255, 255, .18);
      box-shadow: 0 14px 36px rgba(6, 10, 26, .45);
      padding: 10px 16px;
      border-radius: 13px;
    }
    .hint-title {
      font-weight: 600;
    }
    kbd {
      font: 600 11px/1 ui-monospace, Menlo, Consolas, monospace;
      background: rgba(255, 255, 255, .14);
      border: 1px solid rgba(255, 255, 255, .22);
      border-radius: 5px;
      padding: 3px 6px;
      color: #ffffff;
    }
  `;

  function makeAbsolute(urlStr, baseUrl = document.baseURI) {
    if (!urlStr || urlStr.startsWith('data:') || urlStr.startsWith('blob:') || urlStr.startsWith('javascript:')) {
      return urlStr;
    }
    try {
      return new URL(urlStr, baseUrl).href;
    } catch {
      return urlStr;
    }
  }

  function absolutizeSrcset(srcsetStr, baseUrl = document.baseURI) {
    if (!srcsetStr) return srcsetStr;
    return srcsetStr
      .split(',')
      .map((part) => {
        const trimmed = part.trim();
        if (!trimmed) return '';
        const segments = trimmed.split(/\s+/);
        segments[0] = makeAbsolute(segments[0], baseUrl);
        return segments.join(' ');
      })
      .filter(Boolean)
      .join(', ');
  }

  function absolutizeCssUrls(cssText, baseUrl = document.baseURI) {
    if (!cssText) return '';
    return cssText.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (match, quote, url) => {
      const clean = url.trim();
      if (clean.startsWith('data:') || clean.startsWith('blob:') || clean.startsWith('#')) {
        return match;
      }
      return `url("${makeAbsolute(clean, baseUrl)}")`;
    });
  }

  function exportElementToHtml(element) {
    let clone = element.cloneNode(true);

    // Replace live canvas elements with data URL images
    const liveCanvases = [element, ...element.querySelectorAll('canvas')].filter(
      (el) => el instanceof HTMLCanvasElement
    );
    const cloneCanvases = [clone, ...clone.querySelectorAll('canvas')].filter(
      (el) => el instanceof HTMLCanvasElement
    );
    for (let i = 0; i < liveCanvases.length; i += 1) {
      const live = liveCanvases[i];
      const cln = cloneCanvases[i];
      if (!live || !cln) continue;
      try {
        const dataUrl = live.toDataURL();
        const img = document.createElement('img');
        img.src = dataUrl;
        img.alt = live.getAttribute('aria-label') || 'Canvas Export';
        if (live.className) img.className = live.className;
        if (live.getAttribute('style')) img.setAttribute('style', live.getAttribute('style'));
        img.width = live.width;
        img.height = live.height;
        if (cln === clone) {
          clone = img;
        } else {
          cln.replaceWith(img);
        }
      } catch {
        // Ignored if canvas is tainted by cross-origin images
      }
    }

    // Retain form element state (inputs, textareas, selects)
    const liveInputs = [element, ...element.querySelectorAll('input, textarea, select')].filter(
      (el) => el instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
    );
    const cloneInputs = [clone, ...clone.querySelectorAll('input, textarea, select')].filter(
      (el) => el instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
    );
    for (let i = 0; i < liveInputs.length; i += 1) {
      const live = liveInputs[i];
      const cln = cloneInputs[i];
      if (!live || !cln) continue;
      if (live.tagName === 'INPUT') {
        const type = (live.getAttribute('type') || 'text').toLowerCase();
        if (type === 'checkbox' || type === 'radio') {
          if (live.checked) cln.setAttribute('checked', '');
          else cln.removeAttribute('checked');
        } else {
          cln.setAttribute('value', live.value);
        }
      } else if (live.tagName === 'TEXTAREA') {
        cln.textContent = live.value;
      } else if (live.tagName === 'SELECT') {
        const liveOptions = live.querySelectorAll('option');
        const cloneOptions = cln.querySelectorAll('option');
        for (let j = 0; j < liveOptions.length; j += 1) {
          if (liveOptions[j].selected) cloneOptions[j]?.setAttribute('selected', '');
          else cloneOptions[j]?.removeAttribute('selected');
        }
      }
    }

    // Absolutize URL attributes
    const urlAttrs = [
      { selector: '[src]', attr: 'src' },
      { selector: '[href]', attr: 'href' },
      { selector: '[poster]', attr: 'poster' },
    ];
    for (const { selector, attr } of urlAttrs) {
      if (clone.matches && clone.matches(selector)) {
        clone.setAttribute(attr, makeAbsolute(clone.getAttribute(attr)));
      }
      for (const el of clone.querySelectorAll(selector)) {
        el.setAttribute(attr, makeAbsolute(el.getAttribute(attr)));
      }
    }
    if (clone.matches && clone.matches('[srcset]')) {
      clone.setAttribute('srcset', absolutizeSrcset(clone.getAttribute('srcset')));
    }
    for (const el of clone.querySelectorAll('[srcset]')) {
      el.setAttribute('srcset', absolutizeSrcset(el.getAttribute('srcset')));
    }
    if (clone.matches && clone.matches('[style]')) {
      clone.setAttribute('style', absolutizeCssUrls(clone.getAttribute('style')));
    }
    for (const el of clone.querySelectorAll('[style]')) {
      el.setAttribute('style', absolutizeCssUrls(el.getAttribute('style')));
    }

    // Remove executable scripts from standalone export
    if (clone.tagName === 'SCRIPT' || clone.tagName === 'NOSCRIPT') {
      clone = document.createElement('div');
    } else {
      for (const s of clone.querySelectorAll('script, noscript')) {
        s.remove();
      }
    }

    // Ensure SVGs have XML namespace
    if (clone.tagName === 'SVG' && !clone.getAttribute('xmlns')) {
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    }
    for (const svg of clone.querySelectorAll('svg:not([xmlns])')) {
      svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    }

    // Collect stylesheets
    const cssChunks = [];
    const externalLinks = [];
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        const rules = sheet.cssRules;
        if (rules) {
          const sheetBase = sheet.href || document.baseURI;
          const rulesText = Array.from(rules)
            .map((r) => r.cssText)
            .join('\n');
          cssChunks.push(absolutizeCssUrls(rulesText, sheetBase));
        }
      } catch {
        if (sheet.href) {
          externalLinks.push(`<link rel="stylesheet" href="${makeAbsolute(sheet.href)}">`);
        }
      }
    }

    // Inherit document body styling for natural appearance
    const bodyStyle = window.getComputedStyle(document.body);
    const htmlStyle = window.getComputedStyle(document.documentElement);
    const bgColor =
      bodyStyle.backgroundColor !== 'rgba(0, 0, 0, 0)' && bodyStyle.backgroundColor !== 'transparent'
        ? bodyStyle.backgroundColor
        : htmlStyle.backgroundColor !== 'rgba(0, 0, 0, 0)' && htmlStyle.backgroundColor !== 'transparent'
        ? htmlStyle.backgroundColor
        : '#ffffff';
    const textColor = bodyStyle.color || '#1e293b';
    const fontFamily = bodyStyle.fontFamily || "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    const fontSize = bodyStyle.fontSize || '16px';
    const lineHeight = bodyStyle.lineHeight || '1.5';

    const baseStyles = `
      :root {
        color-scheme: light dark;
      }
      body {
        margin: 0;
        padding: 32px 16px;
        background-color: ${bgColor};
        color: ${textColor};
        font-family: ${fontFamily};
        font-size: ${fontSize};
        line-height: ${lineHeight};
        display: flex;
        justify-content: center;
        align-items: flex-start;
        min-height: 100vh;
        box-sizing: border-box;
      }
      .page2pdf-extracted-container {
        box-sizing: border-box;
        max-width: 100%;
        width: fit-content;
      }
    `;

    const htmlContent = `<!DOCTYPE html>
<html lang="${document.documentElement.lang || 'en'}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(document.title || 'Extracted Element')} - Page2PDF</title>
  ${externalLinks.join('\n  ')}
  <style>
${baseStyles}
${cssChunks.join('\n')}
  </style>
</head>
<body>
  <div class="page2pdf-extracted-container">
    ${clone.outerHTML}
  </div>
</body>
</html>`;

    const filename = generateFilename(element);
    return { html: htmlContent, filename };
  }

  function escapeHtml(str) {
    return str.replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }

  function generateFilename(el) {
    let tag = el.tagName.toLowerCase();
    if (el.id) tag += `-${el.id}`;
    else if (typeof el.className === 'string' && el.className.trim()) {
      tag += `-${el.className.trim().split(/\s+/)[0]}`;
    }
    const pageTitle = (document.title || 'page')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 35);
    const cleanTag = tag.replace(/[^a-z0-9_-]+/gi, '-').slice(0, 25);
    return `${pageTitle || 'element'}-${cleanTag || 'block'}.html`;
  }

  function build() {
    host = document.createElement('div');
    host.id = 'page2copier-picker-host';
    host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;';
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = STYLE;
    const box = document.createElement('div');
    box.className = `box mode-${currentMode}`;
    const tag = document.createElement('div');
    tag.className = 'tag';
    const hint = document.createElement('div');
    hint.className = 'hint';

    shadow.append(style, box, tag, hint);
    document.documentElement.appendChild(host);
    ui = { box, tag, hint };
    updateHint();
  }

  function updateHint() {
    if (!ui) return;
    ui.box.className = `box mode-${currentMode}`;
    const targetFormat = currentMode.toUpperCase();
    const nextFormat = currentMode === 'pdf' ? 'PNG' : currentMode === 'png' ? 'HTML' : 'PDF';
    const badgeClass = `badge mode-${currentMode}`;
    ui.hint.innerHTML =
      `<span class="${badgeClass}">${targetFormat}</span>` +
      `<span class="hint-title">Click to save as ${targetFormat}</span>` +
      `<span><kbd>M</kbd> switch to ${nextFormat}</span>` +
      `<span><kbd>&uarr;</kbd><kbd>&darr;</kbd> resize</span>` +
      `<span><kbd>Esc</kbd> cancel</span>`;
  }

  function toggleMode() {
    if (currentMode === 'pdf') currentMode = 'png';
    else if (currentMode === 'png') currentMode = 'html';
    else currentMode = 'pdf';
    updateHint();
    if (current) highlight(current);
  }

  function describe(el) {
    let text = el.tagName.toLowerCase();
    if (el.id) text += `#${el.id}`;
    else if (typeof el.className === 'string' && el.className.trim()) {
      text += `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}`;
    }
    const r = el.getBoundingClientRect();
    return `${text}  ${Math.round(r.width)}×${Math.round(r.height)}`;
  }

  function highlight(el) {
    if (!el || !ui) return;
    current = el;
    const r = el.getBoundingClientRect();
    ui.box.style.left = `${r.left}px`;
    ui.box.style.top = `${r.top}px`;
    ui.box.style.width = `${r.width}px`;
    ui.box.style.height = `${r.height}px`;

    const targetFormat = currentMode.toUpperCase();
    const badgeClass = `badge mode-${currentMode}`;
    ui.tag.innerHTML = `<span class="${badgeClass}">${targetFormat}</span><span>${describe(el)}</span>`;

    const tagTop = r.top > 34 ? r.top - 30 : r.bottom + 8;
    ui.tag.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 240))}px`;
    ui.tag.style.top = `${tagTop}px`;
  }

  const onMove = (event) => {
    const el = document.elementFromPoint(event.clientX, event.clientY);
    if (el && el !== host && el.tagName !== 'HTML') highlight(el);
  };

  const onKey = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      stop();
      return;
    }
    if (event.key === 'm' || event.key === 'M') {
      event.preventDefault();
      toggleMode();
      return;
    }
    if (!current) return;
    if (event.key === 'ArrowUp' && current.parentElement && current.parentElement.tagName !== 'HTML') {
      event.preventDefault();
      highlight(current.parentElement);
    }
    if (event.key === 'ArrowDown') {
      const child = Array.from(current.children).find((c) => {
        const r = c.getBoundingClientRect();
        return r.width > 20 && r.height > 20;
      });
      if (child) {
        event.preventDefault();
        highlight(child);
      }
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      choose();
    }
  };

  const onClick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    choose();
  };

  function choose() {
    if (!current) return;
    const picked = current;
    const mode = currentMode;
    stop();

    if (mode === 'html') {
      const { html, filename } = exportElementToHtml(picked);
      chrome.runtime.sendMessage({ action: 'saveHtml', html, filename });
    } else if (mode === 'png') {
      store.pickedElement = picked;
      chrome.runtime.sendMessage({ action: 'capturePickedPng' });
    } else {
      store.pickedElement = picked;
      chrome.runtime.sendMessage({ action: 'capturePicked' });
    }
  }

  function start(mode = 'pdf') {
    currentMode = mode === 'html' ? 'html' : mode === 'png' ? 'png' : 'pdf';
    if (!active) {
      active = true;
      if (!host) build();
      host.style.display = 'block';
      document.addEventListener('mousemove', onMove, true);
      document.addEventListener('click', onClick, true);
      document.addEventListener('keydown', onKey, true);
    } else {
      updateHint();
      if (current) highlight(current);
    }
  }

  function stop() {
    active = false;
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKey, true);
    if (host) host.remove();
    host = null;
    ui = null;
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.target === 'picker') {
      if (message.action === 'start') {
        start(message.mode || 'pdf');
        sendResponse({ ok: true });
      } else if (message.action === 'stop') {
        stop();
        sendResponse({ ok: true });
      }
    }
  });

  window.__page2copierPicker = window.__page2pdfPicker = { start, stop };
  start(currentMode);
})();
