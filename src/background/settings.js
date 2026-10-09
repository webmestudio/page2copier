/**
 * Settings store.
 *
 * Global defaults live in chrome.storage.sync under `defaults`. Any site can
 * pin its own preset, stored under `presets[hostname]`, which wins for that
 * host. That lets a docs site print in reader mode while a dashboard is always
 * captured as a pixel snapshot, with no fiddling per capture.
 */

export const PAPER_SIZES = {
  a4: { label: 'A4', width: 8.27, height: 11.69 },
  letter: { label: 'Letter', width: 8.5, height: 11 },
  legal: { label: 'Legal', width: 8.5, height: 14 },
  tabloid: { label: 'Tabloid', width: 11, height: 17 },
  a3: { label: 'A3', width: 11.69, height: 16.54 },
  a5: { label: 'A5', width: 5.83, height: 8.27 },
  fit: { label: 'Fit to page width', width: 0, height: 0 },
};

export const MARGIN_PRESETS = {
  none: { label: 'None', value: 0 },
  slim: { label: 'Slim', value: 0.2 },
  normal: { label: 'Normal', value: 0.4 },
  wide: { label: 'Wide', value: 0.8 },
};

export const DEFAULTS = {
  /** 'text' renders vector PDF through the print engine, 'snapshot' captures painted pixels. */
  mode: 'text',
  paper: 'a4',
  orientation: 'portrait',
  margin: 'slim',
  /** 'screen' keeps the page looking like the tab, 'print' honours @media print rules. */
  media: 'screen',
  /** Scales the layout so the desktop width fits the paper instead of being clipped. */
  fitWidth: true,
  /** One tall continuous page instead of paginating. */
  singlePage: false,
  printBackground: true,
  avoidBreakingElements: true,
  expandScrollers: true,
  declutter: true,
  readerMode: false,
  keepLinks: true,
  headerFooter: false,
  headerText: '{title}',
  footerText: '{url}   |   Page {page} of {total}',
  /** Snapshot mode only. */
  snapshotQuality: 92,
  snapshotLossless: false,
  snapshotScale: 2,
  /** Download behaviour. */
  filenameTemplate: '{title}',
  askWhereToSave: false,
  subfolder: '',
  /** Emulate a wider viewport before capturing, useful for responsive layouts. */
  forceWidth: 0,
  darkPages: 'keep',
};

const cache = { defaults: null, presets: null };

async function read() {
  if (cache.defaults && cache.presets) return cache;
  const stored = await chrome.storage.sync.get(['defaults', 'presets']);
  cache.defaults = { ...DEFAULTS, ...(stored.defaults || {}) };
  cache.presets = stored.presets || {};
  return cache;
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  if (changes.defaults) cache.defaults = { ...DEFAULTS, ...(changes.defaults.newValue || {}) };
  if (changes.presets) cache.presets = changes.presets.newValue || {};
});

export async function getDefaults() {
  const { defaults } = await read();
  return { ...defaults };
}

export async function setDefaults(patch) {
  const { defaults } = await read();
  const next = { ...defaults, ...patch };
  cache.defaults = next;
  await chrome.storage.sync.set({ defaults: next });
  return next;
}

export async function resetDefaults() {
  cache.defaults = { ...DEFAULTS };
  await chrome.storage.sync.set({ defaults: cache.defaults });
  return cache.defaults;
}

export function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/** Effective settings for a URL: global defaults overlaid with the site preset. */
export async function getForUrl(url) {
  const { defaults, presets } = await read();
  const host = hostOf(url);
  const preset = host && presets[host] ? presets[host] : null;
  return { ...defaults, ...(preset || {}), _hasPreset: Boolean(preset), _host: host };
}

export async function savePreset(url, settings) {
  const host = hostOf(url);
  if (!host) return null;
  const { presets } = await read();
  const clean = { ...settings };
  for (const key of Object.keys(clean)) {
    if (key.startsWith('_')) delete clean[key];
  }
  const next = { ...presets, [host]: clean };
  cache.presets = next;
  await chrome.storage.sync.set({ presets: next });
  return host;
}

export async function clearPreset(url) {
  const host = hostOf(url);
  const { presets } = await read();
  if (!host || !presets[host]) return null;
  const next = { ...presets };
  delete next[host];
  cache.presets = next;
  await chrome.storage.sync.set({ presets: next });
  return host;
}

export async function listPresets() {
  const { presets } = await read();
  return presets;
}

/** Resolves paper dimensions in inches, honouring orientation. */
export function paperInches(settings, contentWidthPx) {
  const key = settings.paper in PAPER_SIZES ? settings.paper : 'a4';
  let { width, height } = PAPER_SIZES[key];
  if (key === 'fit') {
    // Paper as wide as the page itself, at the CSS reference of 96 dpi.
    width = Math.max(3, (contentWidthPx || 1280) / 96);
    height = width * 1.4142;
  }
  if (settings.orientation === 'landscape') {
    return { width: height, height: width };
  }
  return { width, height };
}

export function marginInches(settings) {
  const preset = MARGIN_PRESETS[settings.margin] || MARGIN_PRESETS.slim;
  return preset.value;
}
