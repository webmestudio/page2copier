import { PAPER_SIZES, MARGIN_PRESETS } from '../background/settings.js';

const $ = (id) => document.getElementById(id);

const MODE_NOTES = {
  text:
    'Renders through the browser print engine. Text stays selectable, links stay clickable, files stay small.',
  snapshot:
    'Captures the painted pixels sheet by sheet. Best for canvas, maps, charts and anything the print engine redraws differently.',
};

const TOGGLES = [
  'fitWidth',
  'declutter',
  'readerMode',
  'singlePage',
  'printBackground',
  'headerFooter',
  'askWhereToSave',
];

let settings = null;
let tab = null;
let busy = false;
let persistTimer = null;

function send(message) {
  return chrome.runtime.sendMessage(message);
}

function setStatus(text, kind = '', progress = null) {
  const status = $('status');
  status.className = `status ${kind}`;
  status.innerHTML = '';
  if (kind === 'working') {
    const spinner = document.createElement('span');
    spinner.className = 'spinner';
    status.appendChild(spinner);
  }
  status.appendChild(document.createTextNode(text || ''));

  const wrap = $('progressWrap');
  if (progress === null || progress === undefined) {
    wrap.hidden = kind !== 'working';
    if (kind !== 'working') $('progressBar').style.width = '0%';
  } else {
    wrap.hidden = false;
    $('progressBar').style.width = `${Math.round(progress * 100)}%`;
  }
}

function setBusy(value) {
  busy = value;
  for (const id of ['save', 'saveHtml', 'savePng', 'pick', 'pickHtml', 'pickPng', 'selection', 'batch']) {
    const el = $(id);
    if (el) el.disabled = value;
  }
}

function fillSelects() {
  const paper = $('paper');
  for (const [key, size] of Object.entries(PAPER_SIZES)) {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = size.label;
    paper.appendChild(option);
  }
  const margin = $('margin');
  for (const [key, preset] of Object.entries(MARGIN_PRESETS)) {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = preset.label;
    margin.appendChild(option);
  }
}

function render() {
  $('modeText').setAttribute('aria-pressed', String(settings.mode !== 'snapshot'));
  $('modeSnapshot').setAttribute('aria-pressed', String(settings.mode === 'snapshot'));
  $('modeNote').textContent = MODE_NOTES[settings.mode === 'snapshot' ? 'snapshot' : 'text'];

  $('paper').value = settings.paper;
  $('orientation').value = settings.orientation;
  $('margin').value = settings.margin;
  $('darkPages').value = settings.darkPages || 'keep';
  for (const id of TOGGLES) $(id).checked = Boolean(settings[id]);

  // Reader mode and snapshot are a poor pair: reader output is pure text.
  $('readerMode').disabled = settings.mode === 'snapshot';
  $('headerFooter').disabled = settings.mode === 'snapshot';

  $('presetChip').hidden = !settings._hasPreset;
  $('clearPreset').hidden = !settings._hasPreset;
  $('savePreset').textContent = settings._hasPreset ? 'Update this site' : 'Remember for this site';
}

function persist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(async () => {
    const patch = { ...settings };
    for (const key of Object.keys(patch)) if (key.startsWith('_')) delete patch[key];
    if (settings._hasPreset) await send({ action: 'savePreset', settings: patch });
    else await send({ action: 'setDefaults', patch });
  }, 220);
}

function update(patch) {
  settings = { ...settings, ...patch };
  render();
  persist();
}

async function load() {
  const state = await send({ action: 'getState' });
  if (!state || !state.ok) {
    setStatus('Could not read the current tab.', 'error');
    return;
  }
  settings = state.settings;
  tab = state.tab;

  if (tab) {
    let host = '';
    try {
      host = new URL(tab.url).hostname;
    } catch {
      host = tab.url || '';
    }
    $('site').textContent = host || 'This tab';
    $('site').title = tab.url || '';
    if (!tab.capturable) {
      $('blocked').style.display = 'block';
      setBusy(true);
    }
  }
  render();
}

async function capture(scope) {
  if (busy) return;
  setBusy(true);
  setStatus('Preparing the page', 'working', 0.05);
  const overrides = { ...settings };
  for (const key of Object.keys(overrides)) if (key.startsWith('_')) delete overrides[key];
  const response = await send({ action: 'capture', scope, overrides });
  if (!response || !response.ok) {
    setStatus(response ? response.message : 'Capture failed.', 'error');
    setBusy(false);
    return;
  }
  setStatus(`Saved ${response.result.filename}`, 'ok', 1);
  setTimeout(() => window.close(), 900);
}

async function captureHtml() {
  if (busy) return;
  setBusy(true);
  setStatus('Preparing the page HTML', 'working', 0.05);
  const overrides = { ...settings };
  for (const key of Object.keys(overrides)) if (key.startsWith('_')) delete overrides[key];
  const response = await send({ action: 'captureHtml', overrides });
  if (!response || !response.ok) {
    setStatus(response ? response.message : 'Save as HTML failed.', 'error');
    setBusy(false);
    return;
  }
  setStatus(`Saved ${response.result.filename}`, 'ok', 1);
  setTimeout(() => window.close(), 900);
}

async function capturePng() {
  if (busy) return;
  setBusy(true);
  setStatus('Preparing the page image', 'working', 0.05);
  const overrides = { ...settings };
  for (const key of Object.keys(overrides)) if (key.startsWith('_')) delete overrides[key];
  const response = await send({ action: 'capturePng', overrides });
  if (!response || !response.ok) {
    setStatus(response ? response.message : 'Save as PNG failed.', 'error');
    setBusy(false);
    return;
  }
  setStatus(`Saved ${response.result.filename}`, 'ok', 1);
  setTimeout(() => window.close(), 900);
}

function wire() {
  $('modeText').addEventListener('click', () => update({ mode: 'text' }));
  $('modeSnapshot').addEventListener('click', () => update({ mode: 'snapshot' }));

  for (const id of ['paper', 'orientation', 'margin', 'darkPages']) {
    $(id).addEventListener('change', (event) => update({ [id]: event.target.value }));
  }
  for (const id of TOGGLES) {
    $(id).addEventListener('change', (event) => update({ [id]: event.target.checked }));
  }

  $('save').addEventListener('click', () => capture('page'));
  $('saveHtml').addEventListener('click', () => captureHtml());
  if ($('savePng')) $('savePng').addEventListener('click', () => capturePng());
  $('selection').addEventListener('click', () => capture('selection'));

  $('pick').addEventListener('click', async () => {
    const response = await send({ action: 'pick', mode: 'pdf' });
    if (response && response.ok) window.close();
    else setStatus(response ? response.message : 'The picker could not start.', 'error');
  });

  $('pickPng')?.addEventListener('click', async () => {
    const response = await send({ action: 'pick', mode: 'png' });
    if (response && response.ok) window.close();
    else setStatus(response ? response.message : 'The picker could not start.', 'error');
  });

  $('pickHtml').addEventListener('click', async () => {
    const response = await send({ action: 'pick', mode: 'html' });
    if (response && response.ok) window.close();
    else setStatus(response ? response.message : 'The picker could not start.', 'error');
  });

  $('batch').addEventListener('click', async () => {
    setBusy(true);
    setStatus('Saving every tab in this window', 'working', 0.02);
    const response = await send({ action: 'batch', which: 'window' });
    setBusy(false);
    if (!response || !response.ok) {
      setStatus(response ? response.message : 'Batch failed.', 'error');
      return;
    }
    const { saved, failed } = response.result;
    setStatus(
      failed.length ? `Saved ${saved}, skipped ${failed.length}` : `Saved ${saved} tabs`,
      failed.length ? '' : 'ok',
      1
    );
  });

  $('savePreset').addEventListener('click', async () => {
    const patch = { ...settings };
    for (const key of Object.keys(patch)) if (key.startsWith('_')) delete patch[key];
    const response = await send({ action: 'savePreset', settings: patch });
    if (response && response.ok) {
      settings._hasPreset = true;
      render();
      setStatus(`These settings now stick on ${response.host}`, 'ok');
    }
  });

  $('clearPreset').addEventListener('click', async () => {
    const response = await send({ action: 'clearPreset' });
    if (response && response.ok) {
      settings._hasPreset = false;
      render();
      setStatus('Site preset removed', 'ok');
    }
  });

  $('openOptions').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.target !== 'popup') return;
    if (message.action === 'progress') setStatus(message.text, 'working', message.progress ?? null);
    if (message.action === 'error') {
      setStatus(message.message, 'error');
      setBusy(false);
    }
  });
}

fillSelects();
wire();
load();
