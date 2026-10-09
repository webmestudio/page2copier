/**
 * The capture engine.
 *
 * Two paths, one goal: the PDF has to look like the tab.
 *
 *  - Text mode drives Page.printToPDF while the page is emulated as screen
 *    media, so the layout stays the one you were looking at, yet the output is
 *    real vector text with selectable characters and live links.
 *  - Snapshot mode asks the compositor for the painted pixels of each sheet
 *    sized slice of the document, then wraps them into a PDF. Canvas, WebGL,
 *    filters and anything else that only exists once rasterised survives.
 */

import * as cdp from './cdp.js';
import * as prep from './prepare.js';
import { paperInches, marginInches } from './settings.js';
import { buildPdf, PT_PER_INCH } from './pdf-writer.js';
import { savePdf, savePng, buildFilename, base64ChunksToBytes, base64ToBytes } from './download.js';

const CSS_PX_PER_INCH = 96;
const MAX_TEXTURE = 16000;
const MAX_PDF_INCHES = 200;

const BASE_CSS = `
  * { animation-play-state: paused !important; transition: none !important; }
  html { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  ::-webkit-scrollbar { display: none !important; }
  html, body { scrollbar-width: none !important; }
`;

const BREAK_CSS = `
  img, svg, video, canvas, figure, blockquote, li, tr {
    break-inside: avoid !important;
    page-break-inside: avoid !important;
  }
  table, pre, code {
    break-inside: auto !important;
    page-break-inside: auto !important;
  }
  th, td {
    break-inside: avoid !important;
    page-break-inside: avoid !important;
  }
  h1, h2, h3, h4, h5, h6 {
    break-after: avoid !important;
    page-break-after: avoid !important;
  }
  thead { display: table-header-group !important; }
  tfoot { display: table-footer-group !important; }
`;

async function inject(tabId, func, args = []) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func,
    args,
    world: 'ISOLATED',
  });
  return result ? result.result : undefined;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function marginTemplate(text, extraStyle = '') {
  const html = escapeHtml(text)
    .replace(/\{title\}/g, '<span class="title"></span>')
    .replace(/\{url\}/g, '<span class="url"></span>')
    .replace(/\{page\}/g, '<span class="pageNumber"></span>')
    .replace(/\{total\}/g, '<span class="totalPages"></span>')
    .replace(/\{date\}/g, '<span class="date"></span>');
  return (
    `<div style="font-size:8px;width:100%;padding:0 12mm;color:#6b7280;` +
    `font-family:-apple-system,'Segoe UI',Roboto,sans-serif;` +
    `display:flex;justify-content:center;gap:6px;${extraStyle}">${html}</div>`
  );
}

/**
 * Shared setup: emulate screen media, prime lazy content, tidy the page,
 * and hand back the measurements the capture needs.
 */
async function preparePage(tabId, settings, onProgress) {
  const features = [];
  if (settings.darkPages === 'light') {
    features.push({ name: 'prefers-color-scheme', value: 'light' });
  } else if (settings.darkPages === 'dark') {
    features.push({ name: 'prefers-color-scheme', value: 'dark' });
  }
  features.push({ name: 'prefers-reduced-motion', value: 'reduce' });

  await cdp.send(tabId, 'Emulation.setEmulatedMedia', {
    media: settings.media === 'print' ? 'print' : 'screen',
    features,
  });

  if (settings.forceWidth && settings.forceWidth > 320) {
    const probe = await inject(tabId, prep.measurePage);
    await cdp.send(tabId, 'Emulation.setDeviceMetricsOverride', {
      width: Math.round(settings.forceWidth),
      height: Math.round(probe.viewportHeight || 900),
      deviceScaleFactor: 0,
      mobile: false,
    });
  }

  onProgress('Loading the whole page');
  await inject(tabId, prep.primePage, [{ scrollThrough: true }]);

  if (settings.declutter) {
    onProgress('Clearing overlays');
    await inject(tabId, prep.declutterPage, [{ removeOverlays: true, unpin: true }]);
  }
  if (settings.expandScrollers !== false) {
    await inject(tabId, prep.expandContent);
  }

  const css = BASE_CSS + (settings.avoidBreakingElements ? BREAK_CSS : '');
  await inject(tabId, prep.applyPrintCss, [css]);

  // Re-measure after the tidy up, the document is usually taller now.
  const metrics = await inject(tabId, prep.measurePage);
  return metrics;
}

async function teardownPage(tabId, settings) {
  await inject(tabId, prep.restorePage).catch(() => {});
  await cdp.send(tabId, 'Emulation.setEmulatedMedia', { media: '' }).catch(() => {});
  if (settings.forceWidth && settings.forceWidth > 320) {
    await cdp.send(tabId, 'Emulation.clearDeviceMetricsOverride').catch(() => {});
  }
}

/* ------------------------------------------------------------------ */
/* Text mode                                                           */
/* ------------------------------------------------------------------ */

async function captureText(tabId, settings, metrics, region, onProgress) {
  const contentWidth = region ? region.width : metrics.width;
  const paper = paperInches(settings, contentWidth);
  let margin = marginInches(settings);
  if (settings.headerFooter && margin < 0.5) margin = 0.5;

  // "Fit" means the sheet is cut to the content, so nothing is scaled at all.
  if (settings.paper === 'fit') paper.width = contentWidth / CSS_PX_PER_INCH + margin * 2;

  const printableWidthIn = Math.max(1, paper.width - margin * 2);
  const printableWidthPx = printableWidthIn * CSS_PX_PER_INCH;

  let scale = 1;
  if (settings.fitWidth && contentWidth > 0) {
    scale = printableWidthPx / contentWidth;
    scale = Math.min(1, Math.max(0.35, scale));
  }

  let paperHeight = paper.height;
  if (settings.singlePage) {
    const contentHeight = region ? region.height : metrics.height;
    const contentHeightIn = (contentHeight * scale) / CSS_PX_PER_INCH;
    paperHeight = Math.min(MAX_PDF_INCHES, contentHeightIn + margin * 2 + 0.35);
  }

  onProgress('Rendering PDF');
  const params = {
    landscape: settings.orientation === 'landscape' && settings.paper !== 'fit',
    printBackground: settings.printBackground !== false,
    scale: Number(scale.toFixed(4)),
    paperWidth: paper.width,
    paperHeight,
    marginTop: margin,
    marginBottom: margin,
    marginLeft: margin,
    marginRight: margin,
    preferCSSPageSize: false,
    displayHeaderFooter: Boolean(settings.headerFooter),
    transferMode: 'ReturnAsStream',
    generateTaggedPDF: true,
  };
  if (settings.headerFooter) {
    params.headerTemplate = marginTemplate(settings.headerText || '', 'margin-top:4mm;');
    params.footerTemplate = marginTemplate(settings.footerText || '', 'margin-bottom:4mm;');
  } else {
    params.headerTemplate = '<span></span>';
    params.footerTemplate = '<span></span>';
  }

  let result;
  try {
    result = await cdp.send(tabId, 'Page.printToPDF', params);
  } catch (err) {
    // generateTaggedPDF is not on every Chrome build, retry without it.
    delete params.generateTaggedPDF;
    result = await cdp.send(tabId, 'Page.printToPDF', params);
  }

  if (result.stream) {
    const chunks = await cdp.readStream(tabId, result.stream);
    return base64ChunksToBytes(chunks);
  }
  return base64ToBytes(result.data);
}

/* ------------------------------------------------------------------ */
/* Snapshot mode                                                       */
/* ------------------------------------------------------------------ */

function jpegSize(data) {
  let i = 2;
  while (i < data.length) {
    if (data[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = data[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return {
        height: (data[i + 5] << 8) | data[i + 6],
        width: (data[i + 7] << 8) | data[i + 8],
      };
    }
    const length = (data[i + 2] << 8) | data[i + 3];
    i += 2 + length;
  }
  return null;
}

async function pngToRgb(pngBytes) {
  const bitmap = await createImageBitmap(new Blob([pngBytes], { type: 'image/png' }));
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, bitmap.width, bitmap.height);
  ctx.drawImage(bitmap, 0, 0);
  const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  const rgb = new Uint8Array(bitmap.width * bitmap.height * 3);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
    rgb[j] = data[i];
    rgb[j + 1] = data[i + 1];
    rgb[j + 2] = data[i + 2];
  }
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return { data: rgb, format: 'rgb', ...size };
}

async function captureSnapshot(tabId, settings, metrics, region, onProgress) {
  const originX = region ? region.x : 0;
  const originY = region ? region.y : 0;
  const contentWidth = Math.max(1, region ? region.width : metrics.width);
  const contentHeight = Math.max(1, region ? region.height : metrics.height);

  const paper = paperInches(settings, contentWidth);
  const margin = marginInches(settings);
  if (settings.paper === 'fit') paper.width = contentWidth / CSS_PX_PER_INCH + margin * 2;
  const printableWidthIn = Math.max(1, paper.width - margin * 2);
  const printableHeightIn = Math.max(1, paper.height - margin * 2);

  // How many CSS pixels of document fit on one sheet, keeping the aspect ratio.
  let sliceHeight = settings.singlePage
    ? contentHeight
    : Math.max(200, Math.round((contentWidth * printableHeightIn) / printableWidthIn));
  if (settings.singlePage) sliceHeight = Math.min(sliceHeight, 30000);

  // Keep every rasterised slice inside the compositor's texture limits.
  let scale = Math.max(1, Math.min(4, Number(settings.snapshotScale) || 2));
  while (scale > 0.5 && (contentWidth * scale > MAX_TEXTURE || sliceHeight * scale > MAX_TEXTURE)) {
    scale -= 0.25;
  }
  while (sliceHeight * scale > MAX_TEXTURE) sliceHeight = Math.floor(sliceHeight * 0.8);

  const sliceCount = Math.max(1, Math.ceil(contentHeight / sliceHeight));
  const lossless = Boolean(settings.snapshotLossless);
  const links = settings.keepLinks ? await inject(tabId, prep.collectLinks) : [];

  const pages = [];
  for (let i = 0; i < sliceCount; i += 1) {
    onProgress(`Capturing sheet ${i + 1} of ${sliceCount}`, (i + 1) / sliceCount);
    const y = originY + i * sliceHeight;
    const h = Math.min(sliceHeight, originY + contentHeight - y);
    if (h <= 1) break;

    const shot = await cdp.send(tabId, 'Page.captureScreenshot', {
      format: lossless ? 'png' : 'jpeg',
      quality: lossless ? undefined : Math.max(40, Math.min(100, settings.snapshotQuality || 92)),
      captureBeyondViewport: true,
      fromSurface: true,
      optimizeForSpeed: false,
      clip: { x: originX, y, width: contentWidth, height: h, scale },
    });

    const raw = base64ToBytes(shot.data);
    let image;
    if (lossless) {
      image = await pngToRgb(raw);
    } else {
      const size = jpegSize(raw) || {
        width: Math.round(contentWidth * scale),
        height: Math.round(h * scale),
      };
      image = { data: raw, format: 'jpeg', width: size.width, height: size.height };
    }

    // Place the slice on the sheet, top aligned, preserving aspect ratio.
    const drawW = printableWidthIn * PT_PER_INCH;
    const drawH = (image.height / image.width) * drawW;
    const pageHeightPt = settings.singlePage
      ? Math.min(MAX_PDF_INCHES * PT_PER_INCH, drawH + margin * 2 * PT_PER_INCH)
      : paper.height * PT_PER_INCH;
    const pageWidthPt = paper.width * PT_PER_INCH;
    const drawX = margin * PT_PER_INCH;
    const drawY = pageHeightPt - margin * PT_PER_INCH - drawH;

    const ptPerCssPx = drawW / contentWidth;
    const pageLinks = [];
    for (const link of links || []) {
      if (link.y + link.height < y || link.y > y + h) continue;
      const x1 = drawX + (link.x - originX) * ptPerCssPx;
      const x2 = x1 + link.width * ptPerCssPx;
      const top = pageHeightPt - margin * PT_PER_INCH - (link.y - y) * ptPerCssPx;
      const y2 = top;
      const y1 = top - link.height * ptPerCssPx;
      if (x2 < 0 || x1 > pageWidthPt) continue;
      pageLinks.push({ rect: [x1, Math.max(0, y1), x2, Math.min(pageHeightPt, y2)], url: link.url });
    }

    pages.push({
      widthPt: pageWidthPt,
      heightPt: pageHeightPt,
      image: { ...image, drawX, drawY, drawW, drawH },
      links: pageLinks,
    });
  }

  onProgress('Assembling PDF');
  return buildPdf({
    pages,
    title: (metrics && metrics.title) || '',
    subject: (metrics && metrics.url) || '',
  });
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

/**
 * Captures a tab and saves the PDF.
 *
 * @param {number} tabId
 * @param {Object} settings   Effective settings for this capture.
 * @param {Object} [options]
 * @param {'page'|'element'|'selection'} [options.scope]
 * @param {Function} [options.onProgress]
 */
export async function capturePage(tabId, settings, options = {}) {
  const onProgress = options.onProgress || (() => {});
  const scope = options.scope || 'page';

  return cdp.withDebugger(tabId, async () => {
    await cdp.send(tabId, 'Page.enable').catch(() => {});
    let metrics;
    try {
      metrics = await preparePage(tabId, settings, onProgress);

      let region = null;
      if (scope === 'page' && settings.readerMode) {
        onProgress('Extracting the article');
        const article = await inject(tabId, prep.applyReaderMode);
        if (article) {
          region = await inject(tabId, prep.isolateElement);
          await new Promise((r) => setTimeout(r, 120));
          metrics = await inject(tabId, prep.measurePage);
          region = { x: 0, y: 0, width: metrics.width, height: metrics.height };
        }
      }
      if (scope === 'selection') {
        const ok = await inject(tabId, prep.isolateSelection);
        if (!ok) throw new Error('Select some text on the page first.');
      }
      if (scope === 'element' || scope === 'selection') {
        region = await inject(tabId, prep.isolateElement);
        if (!region) throw new Error('Nothing was picked to capture. Try the element picker again.');
        // Isolation reflows the document, so settle and measure the target again.
        await new Promise((r) => setTimeout(r, 150));
        region = await inject(tabId, prep.measureTarget);
        if (!region) throw new Error('The picked element disappeared before it could be saved.');
        // A picked block deserves a sheet cut to its own size, not an A4 with a
        // stamp in the corner.
        settings = { ...settings, paper: 'fit', singlePage: true, orientation: 'portrait' };
      }

      await inject(tabId, prep.toggleHud, [false]);
      let bytes;
      try {
        bytes =
          settings.mode === 'snapshot'
            ? await captureSnapshot(tabId, settings, metrics, region, onProgress)
            : await captureText(tabId, settings, metrics, region, onProgress);
      } finally {
        await inject(tabId, prep.toggleHud, [true]).catch(() => {});
      }

      onProgress('Saving');
      const filename = buildFilename(settings.filenameTemplate, metrics || {});
      if (options.deliver === 'bytes') {
        return {
          bytes,
          filename,
          size: bytes.length,
          title: (metrics && metrics.title) || '',
          url: (metrics && metrics.url) || '',
        };
      }
      const saved = await savePdf(bytes, {
        filename,
        subfolder: settings.subfolder,
        saveAs: Boolean(settings.askWhereToSave),
      });
      return { ...saved, title: (metrics && metrics.title) || '', url: (metrics && metrics.url) || '' };
    } finally {
      await teardownPage(tabId, settings);
    }
  });
}

async function capturePngBytes(tabId, settings, metrics, region, onProgress) {
  const originX = region ? region.x : 0;
  const originY = region ? region.y : 0;
  const contentWidth = Math.max(1, Math.round(region ? region.width : (metrics && metrics.width) || 1280));
  const contentHeight = Math.max(1, Math.round(region ? region.height : (metrics && metrics.height) || 800));

  let scale = Math.max(1, Math.min(3, Number(settings.snapshotScale) || 2));
  while (scale > 0.5 && (contentWidth * scale > MAX_TEXTURE || contentHeight * scale > 32000)) {
    scale -= 0.25;
  }

  // Single shot if content fits in one texture slice
  if (contentHeight * scale <= MAX_TEXTURE) {
    onProgress('Capturing PNG image...', 0.5);
    const shot = await cdp.send(tabId, 'Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      fromSurface: true,
      optimizeForSpeed: false,
      clip: { x: originX, y: originY, width: contentWidth, height: contentHeight, scale },
    });
    return base64ToBytes(shot.data);
  }

  // Multi-slice capture and stitch for long pages
  const sliceHeight = Math.min(4000, Math.floor(MAX_TEXTURE / scale));
  const sliceCount = Math.max(1, Math.ceil(contentHeight / sliceHeight));
  const totalPxW = Math.round(contentWidth * scale);
  const totalPxH = Math.round(contentHeight * scale);

  const canvas = new OffscreenCanvas(totalPxW, totalPxH);
  const ctx = canvas.getContext('2d');
  let currentDrawY = 0;

  for (let i = 0; i < sliceCount; i += 1) {
    onProgress(`Capturing slice ${i + 1} of ${sliceCount}`, (i + 1) / sliceCount);
    const y = originY + i * sliceHeight;
    const h = Math.min(sliceHeight, originY + contentHeight - y);
    if (h <= 0) break;

    const shot = await cdp.send(tabId, 'Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      fromSurface: true,
      optimizeForSpeed: false,
      clip: { x: originX, y, width: contentWidth, height: h, scale },
    });

    const rawBytes = base64ToBytes(shot.data);
    const blob = new Blob([rawBytes], { type: 'image/png' });
    const bitmap = await createImageBitmap(blob);
    ctx.drawImage(bitmap, 0, currentDrawY);
    currentDrawY += bitmap.height;
    bitmap.close();
  }

  onProgress('Encoding PNG...', 0.9);
  const finalBlob = await canvas.convertToBlob({ type: 'image/png' });
  const arrayBuffer = await finalBlob.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

/**
 * Captures a tab and saves the full page (or element/selection) as PNG.
 *
 * @param {number} tabId
 * @param {Object} settings   Effective settings for this capture.
 * @param {Object} [options]
 * @param {'page'|'element'|'selection'} [options.scope]
 * @param {Function} [options.onProgress]
 */
export async function captureImage(tabId, settings, options = {}) {
  const onProgress = options.onProgress || (() => {});
  const scope = options.scope || 'page';

  return cdp.withDebugger(tabId, async () => {
    await cdp.send(tabId, 'Page.enable').catch(() => {});
    let metrics;
    try {
      metrics = await preparePage(tabId, settings, onProgress);

      let region = null;
      if (scope === 'page' && settings.readerMode) {
        onProgress('Extracting the article');
        const article = await inject(tabId, prep.applyReaderMode);
        if (article) {
          region = await inject(tabId, prep.isolateElement);
          await new Promise((r) => setTimeout(r, 120));
          metrics = await inject(tabId, prep.measurePage);
          region = { x: 0, y: 0, width: metrics.width, height: metrics.height };
        }
      }
      if (scope === 'selection') {
        const ok = await inject(tabId, prep.isolateSelection);
        if (!ok) throw new Error('Select some text on the page first.');
      }
      if (scope === 'element' || scope === 'selection') {
        region = await inject(tabId, prep.isolateElement);
        if (!region) throw new Error('Nothing was picked to capture. Try the element picker again.');
        await new Promise((r) => setTimeout(r, 150));
        region = await inject(tabId, prep.measureTarget);
        if (!region) throw new Error('The picked element disappeared before it could be saved.');
      }

      await inject(tabId, prep.toggleHud, [false]);
      let bytes;
      try {
        bytes = await capturePngBytes(tabId, settings, metrics, region, onProgress);
      } finally {
        await inject(tabId, prep.toggleHud, [true]).catch(() => {});
      }

      onProgress('Saving');
      const filename = buildFilename(settings.filenameTemplate, metrics || {}, 'png');
      if (options.deliver === 'bytes') {
        return {
          bytes,
          filename,
          size: bytes.length,
          title: (metrics && metrics.title) || '',
          url: (metrics && metrics.url) || '',
        };
      }
      const saved = await savePng(bytes, {
        filename,
        subfolder: settings.subfolder,
        saveAs: Boolean(settings.askWhereToSave),
      });
      return { ...saved, title: (metrics && metrics.title) || '', url: (metrics && metrics.url) || '' };
    } finally {
      await teardownPage(tabId, settings);
    }
  });
}
