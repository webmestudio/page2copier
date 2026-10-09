/**
 * Page2Copier service worker.
 *
 * Owns every entry point (popup, keyboard shortcut, context menu), keeps one
 * capture per tab, and reports progress to both the in page pill and the popup.
 */

import { capturePage, captureImage } from './capture.js';
import { saveHtml, savePng, buildFilename } from './download.js';
import { exportPageHtml } from './prepare.js';
import * as settingsStore from './settings.js';

const busyTabs = new Set();

/* ------------------------------ helpers ------------------------------ */

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function capturable(url) {
  if (!url) return false;
  return /^(https?|file|ftp):/i.test(url) && !/^https?:\/\/chromewebstore\.google\.com/i.test(url);
}

async function ensureHud(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['src/content/hud.js'],
    });
  } catch {
    /* the page may block injection, progress simply stays in the badge */
  }
}

function toHud(tabId, text, progress, state) {
  chrome.tabs.sendMessage(tabId, { target: 'hud', action: 'progress', text, progress, state }).catch(() => {});
}

function toPopup(payload) {
  chrome.runtime.sendMessage({ target: 'popup', ...payload }).catch(() => {});
}

function setBadge(text, color = '#4f46e5') {
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeText({ text });
}

function clearBadgeSoon(delay = 2200) {
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), delay);
}

/* ------------------------------ capture ------------------------------ */

async function runCapture(tab, { scope = 'page', overrides = null, quiet = false } = {}) {
  if (!tab || !tab.id) throw new Error('No tab to capture.');
  if (!capturable(tab.url)) {
    throw new Error('Chrome does not let extensions read this page. Open a normal web page and try again.');
  }
  if (busyTabs.has(tab.id)) throw new Error('This tab is already being saved.');

  busyTabs.add(tab.id);
  const settings = { ...(await settingsStore.getForUrl(tab.url)), ...(overrides || {}) };

  if (!quiet) await ensureHud(tab.id);
  setBadge('...');

  const onProgress = (text, progress) => {
    if (!quiet) toHud(tab.id, text, progress);
    toPopup({ action: 'progress', text, progress, tabId: tab.id });
  };

  try {
    const result = await capturePage(tab.id, settings, { scope, onProgress });
    setBadge('OK', '#0d9488');
    clearBadgeSoon();
    if (!quiet) toHud(tab.id, `Saved ${result.filename}`, 1, 'done');
    toPopup({ action: 'done', result });
    return result;
  } catch (error) {
    setBadge('ERR', '#dc2626');
    clearBadgeSoon(4000);
    const message = error && error.message ? error.message : 'Capture failed.';
    if (!quiet) toHud(tab.id, message, 1, 'error');
    toPopup({ action: 'error', message });
    throw error;
  } finally {
    busyTabs.delete(tab.id);
  }
}

async function runCaptureHtml(tab, { overrides = null, quiet = false } = {}) {
  if (!tab || !tab.id) throw new Error('No tab to save as HTML.');
  if (!capturable(tab.url)) {
    throw new Error('Chrome does not let extensions read this page. Open a normal web page and try again.');
  }
  if (busyTabs.has(tab.id)) throw new Error('This tab is already being saved.');

  busyTabs.add(tab.id);
  const settings = { ...(await settingsStore.getForUrl(tab.url)), ...(overrides || {}) };

  if (!quiet) await ensureHud(tab.id);
  setBadge('...');

  const onProgress = (text, progress) => {
    if (!quiet) toHud(tab.id, text, progress);
    toPopup({ action: 'progress', text, progress, tabId: tab.id });
  };

  try {
    onProgress('Extracting page HTML...', 0.3);
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: exportPageHtml,
    });
    const html = (results && results[0] && results[0].result) || '';
    if (!html) throw new Error('Could not extract page content.');

    onProgress('Saving HTML file...', 0.7);
    const filename = buildFilename(
      settings.filenameTemplate || '{title}',
      { title: tab.title || 'page', url: tab.url },
      'html'
    );
    const result = await saveHtml(html, {
      filename,
      subfolder: settings.subfolder || '',
      saveAs: Boolean(settings.askWhereToSave),
    });

    setBadge('OK', '#0d9488');
    clearBadgeSoon();
    if (!quiet) toHud(tab.id, `Saved ${result.filename}`, 1, 'done');
    toPopup({ action: 'done', result });
    return result;
  } catch (error) {
    setBadge('ERR', '#dc2626');
    clearBadgeSoon(4000);
    const message = error && error.message ? error.message : 'Save as HTML failed.';
    if (!quiet) toHud(tab.id, message, 1, 'error');
    toPopup({ action: 'error', message });
    throw error;
  } finally {
    busyTabs.delete(tab.id);
  }
}

async function runCapturePng(tab, { scope = 'page', overrides = null, quiet = false } = {}) {
  if (!tab || !tab.id) throw new Error('No tab to save as PNG.');
  if (!capturable(tab.url)) {
    throw new Error('Chrome does not let extensions read this page. Open a normal web page and try again.');
  }
  if (busyTabs.has(tab.id)) throw new Error('This tab is already being saved.');

  busyTabs.add(tab.id);
  const settings = { ...(await settingsStore.getForUrl(tab.url)), ...(overrides || {}) };

  if (!quiet) await ensureHud(tab.id);
  setBadge('...');

  const onProgress = (text, progress) => {
    if (!quiet) toHud(tab.id, text, progress);
    toPopup({ action: 'progress', text, progress, tabId: tab.id });
  };

  try {
    const result = await captureImage(tab.id, settings, { scope, onProgress });
    setBadge('OK', '#0d9488');
    clearBadgeSoon();
    if (!quiet) toHud(tab.id, `Saved ${result.filename}`, 1, 'done');
    toPopup({ action: 'done', result });
    return result;
  } catch (error) {
    setBadge('ERR', '#dc2626');
    clearBadgeSoon(4000);
    const message = error && error.message ? error.message : 'Save as PNG failed.';
    if (!quiet) toHud(tab.id, message, 1, 'error');
    toPopup({ action: 'error', message });
    throw error;
  } finally {
    busyTabs.delete(tab.id);
  }
}

/** Opens a link in a background tab, saves it, then closes the tab again. */
async function captureUrl(url, overrides) {
  const tab = await chrome.tabs.create({ url, active: false });
  try {
    await waitForLoad(tab.id);
    await new Promise((r) => setTimeout(r, 400));
    const fresh = await chrome.tabs.get(tab.id);
    // A background tab has no live surface, so pixels are not available.
    return await runCapture(fresh, { overrides: { ...overrides, mode: 'text' }, quiet: true });
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

function waitForLoad(tabId, timeout = 30000) {
  return new Promise((resolve) => {
    const done = () => {
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timer);
      resolve();
    };
    const listener = (id, info) => {
      if (id === tabId && info.status === 'complete') done();
    };
    const timer = setTimeout(done, timeout);
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((t) => {
      if (t && t.status === 'complete') done();
    });
  });
}

/** Saves several tabs in a row, one file each, into a dated subfolder. */
async function runBatch(which = 'window') {
  const query = which === 'selected' ? { highlighted: true, currentWindow: true } : { currentWindow: true };
  const tabs = (await chrome.tabs.query(query)).filter((t) => capturable(t.url));
  if (tabs.length === 0) throw new Error('No savable tabs in this window.');

  const original = await activeTab();
  const stamp = new Date().toISOString().slice(0, 10);
  const results = [];
  const failures = [];

  for (let i = 0; i < tabs.length; i += 1) {
    const tab = tabs[i];
    setBadge(`${i + 1}/${tabs.length}`);
    toPopup({ action: 'progress', text: `Saving tab ${i + 1} of ${tabs.length}`, progress: (i + 1) / tabs.length });
    const settings = await settingsStore.getForUrl(tab.url);
    try {
      if (settings.mode === 'snapshot') await chrome.tabs.update(tab.id, { active: true });
      const result = await runCapture(tab, {
        overrides: { subfolder: `Page2Copier ${stamp}` },
        quiet: settings.mode !== 'snapshot',
      });
      results.push(result);
    } catch (error) {
      failures.push({ title: tab.title, message: error.message });
    }
  }

  if (original && original.id) await chrome.tabs.update(original.id, { active: true }).catch(() => {});
  setBadge(failures.length ? 'ERR' : 'OK', failures.length ? '#dc2626' : '#0d9488');
  clearBadgeSoon(3000);
  toPopup({ action: 'batchDone', saved: results.length, failed: failures });
  return { saved: results.length, failed: failures };
}

async function startPicker(tab, mode = 'pdf') {
  if (!capturable(tab.url)) throw new Error('The picker cannot run on this page.');
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/content/picker.js'] });
  chrome.tabs.sendMessage(tab.id, { target: 'picker', action: 'start', mode }).catch(() => {});
  return true;
}

/* ------------------------------ wiring ------------------------------ */

const MENUS = [
  { id: 'p2p-page', title: 'Save this page as PDF', contexts: ['page', 'frame'] },
  { id: 'p2p-page-html', title: 'Save this page as HTML', contexts: ['page', 'frame'] },
  { id: 'p2p-page-png', title: 'Save this page as PNG', contexts: ['page', 'frame'] },
  { id: 'p2p-selection', title: 'Save selection as PDF', contexts: ['selection'] },
  { id: 'p2p-element', title: 'Pick an element to save as PDF', contexts: ['page'] },
  { id: 'p2p-element-html', title: 'Pick an element to save as HTML', contexts: ['page'] },
  { id: 'p2p-element-png', title: 'Pick an element to save as PNG', contexts: ['page'] },
  { id: 'p2p-link', title: 'Save linked page as PDF', contexts: ['link'] },
  { id: 'p2p-reader', title: 'Save as clean article', contexts: ['page'] },
];

chrome.runtime.onInstalled.addListener(async (details) => {
  chrome.contextMenus.removeAll(() => {
    for (const menu of MENUS) chrome.contextMenus.create(menu);
  });
  if (details.reason === 'install') {
    await settingsStore.getDefaults();
    chrome.tabs.create({ url: chrome.runtime.getURL('src/ui/options.html#welcome') });
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    if (info.menuItemId === 'p2p-link' && info.linkUrl) {
      setBadge('...');
      await captureUrl(info.linkUrl, {});
      setBadge('OK', '#0d9488');
      clearBadgeSoon();
      return;
    }
    if (!tab) return;
    if (info.menuItemId === 'p2p-page-html') return void runCaptureHtml(tab);
    if (info.menuItemId === 'p2p-page-png') return void runCapturePng(tab);
    if (info.menuItemId === 'p2p-element') return void startPicker(tab, 'pdf');
    if (info.menuItemId === 'p2p-element-html') return void startPicker(tab, 'html');
    if (info.menuItemId === 'p2p-element-png') return void startPicker(tab, 'png');
    if (info.menuItemId === 'p2p-selection') return void runCapture(tab, { scope: 'selection' });
    if (info.menuItemId === 'p2p-reader') {
      return void runCapture(tab, { overrides: { readerMode: true, mode: 'text' } });
    }
    await runCapture(tab);
  } catch (error) {
    setBadge('ERR', '#dc2626');
    clearBadgeSoon(4000);
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  const tab = await activeTab();
  if (!tab) return;
  try {
    if (command === 'capture-page') await runCapture(tab);
    if (command === 'capture-page-html') await runCaptureHtml(tab);
    if (command === 'capture-page-png') await runCapturePng(tab);
    if (command === 'capture-element') await startPicker(tab, 'pdf');
    if (command === 'capture-element-html') await startPicker(tab, 'html');
    if (command === 'capture-element-png') await startPicker(tab, 'png');
  } catch {
    /* surfaced through the badge and pill already */
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.target === 'offscreen' || message.target === 'hud' || message.target === 'popup') {
    return false;
  }

  (async () => {
    try {
      switch (message.action) {
        case 'getState': {
          const tab = await activeTab();
          const settings = tab ? await settingsStore.getForUrl(tab.url) : await settingsStore.getDefaults();
          sendResponse({
            ok: true,
            settings,
            tab: tab
              ? { id: tab.id, title: tab.title, url: tab.url, capturable: capturable(tab.url) }
              : null,
            busy: tab ? busyTabs.has(tab.id) : false,
          });
          break;
        }
        case 'capture': {
          const tab = await activeTab();
          const result = await runCapture(tab, {
            scope: message.scope || 'page',
            overrides: message.overrides || null,
          });
          sendResponse({ ok: true, result });
          break;
        }
        case 'captureHtml':
        case 'capturePageHtml': {
          const tab = await activeTab();
          const result = await runCaptureHtml(tab, {
            overrides: message.overrides || null,
          });
          sendResponse({ ok: true, result });
          break;
        }
        case 'capturePng':
        case 'capturePagePng': {
          const tab = await activeTab();
          const result = await runCapturePng(tab, {
            scope: message.scope || 'page',
            overrides: message.overrides || null,
          });
          sendResponse({ ok: true, result });
          break;
        }
        case 'capturePicked': {
          const tab = sender.tab || (await activeTab());
          const result = await runCapture(tab, { scope: 'element' });
          sendResponse({ ok: true, result });
          break;
        }
        case 'capturePickedPng': {
          const tab = sender.tab || (await activeTab());
          const result = await runCapturePng(tab, { scope: 'element' });
          sendResponse({ ok: true, result });
          break;
        }
        case 'saveHtml': {
          const tab = sender.tab || (await activeTab());
          const settings = tab && tab.url ? await settingsStore.getForUrl(tab.url) : await settingsStore.getDefaults();
          const result = await saveHtml(message.html, {
            filename: message.filename || 'element.html',
            subfolder: message.subfolder || settings.subfolder || '',
            saveAs: Boolean(settings.askWhereToSave),
          });
          setBadge('OK', '#0d9488');
          clearBadgeSoon();
          if (tab && tab.id) toHud(tab.id, `Saved ${result.filename}`, 1, 'done');
          sendResponse({ ok: true, result });
          break;
        }
        case 'pick': {
          const tab = await activeTab();
          await startPicker(tab, message.mode || 'pdf');
          sendResponse({ ok: true });
          break;
        }
        case 'batch': {
          const result = await runBatch(message.which);
          sendResponse({ ok: true, result });
          break;
        }
        case 'setDefaults': {
          const next = await settingsStore.setDefaults(message.patch || {});
          sendResponse({ ok: true, settings: next });
          break;
        }
        case 'resetDefaults': {
          sendResponse({ ok: true, settings: await settingsStore.resetDefaults() });
          break;
        }
        case 'savePreset': {
          const tab = await activeTab();
          const host = await settingsStore.savePreset(tab.url, message.settings);
          sendResponse({ ok: true, host });
          break;
        }
        case 'clearPreset': {
          const tab = await activeTab();
          const host = await settingsStore.clearPreset(tab.url);
          sendResponse({ ok: true, host });
          break;
        }
        case 'listPresets': {
          sendResponse({ ok: true, presets: await settingsStore.listPresets() });
          break;
        }
        case 'deletePreset': {
          const presets = await settingsStore.listPresets();
          delete presets[message.host];
          await chrome.storage.sync.set({ presets });
          sendResponse({ ok: true });
          break;
        }
        default:
          sendResponse({ ok: false, message: `Unknown action: ${message.action}` });
      }
    } catch (error) {
      sendResponse({ ok: false, message: error && error.message ? error.message : String(error) });
    }
  })();

  return true;
});

chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId) busyTabs.delete(source.tabId);
});

/**
 * Debug surface, reachable from the service worker console and used by the
 * automated tests. Nothing outside the extension can touch it.
 */
globalThis.page2copier = globalThis.page2pdf = {
  capturePage,
  runCapture,
  runCaptureHtml,
  runBatch,
  captureUrl,
  settings: settingsStore,
};
