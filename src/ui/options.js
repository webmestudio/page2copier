import { PAPER_SIZES, MARGIN_PRESETS, DEFAULTS } from '../background/settings.js';

const $ = (id) => document.getElementById(id);

const CHECKBOXES = [
  'fitWidth',
  'printBackground',
  'avoidBreakingElements',
  'expandScrollers',
  'declutter',
  'keepLinks',
  'singlePage',
  'readerMode',
  'headerFooter',
  'snapshotLossless',
  'askWhereToSave',
];
const SELECTS = ['mode', 'paper', 'orientation', 'margin', 'media', 'darkPages'];
const TEXTS = ['headerText', 'footerText', 'filenameTemplate', 'subfolder'];
const RANGES = ['snapshotScale', 'snapshotQuality'];
const NUMBERS = ['forceWidth'];

let settings = { ...DEFAULTS };
let saveTimer = null;

function fillSelects() {
  for (const [key, size] of Object.entries(PAPER_SIZES)) {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = size.label;
    $('paper').appendChild(option);
  }
  for (const [key, preset] of Object.entries(MARGIN_PRESETS)) {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = preset.label;
    $('margin').appendChild(option);
  }
}

function render() {
  for (const id of SELECTS) $(id).value = settings[id];
  for (const id of CHECKBOXES) $(id).checked = Boolean(settings[id]);
  for (const id of TEXTS) $(id).value = settings[id] ?? '';
  for (const id of NUMBERS) $(id).value = settings[id] ?? 0;
  for (const id of RANGES) {
    $(id).value = settings[id];
    $(`${id}Out`).textContent = id === 'snapshotScale' ? `${settings[id]}x` : `${settings[id]}%`;
  }
  $('snapshotQuality').disabled = Boolean(settings.snapshotLossless);
}

function flashSaved() {
  const el = $('saved');
  el.classList.add('show');
  clearTimeout(flashSaved.timer);
  flashSaved.timer = setTimeout(() => el.classList.remove('show'), 1400);
}

function update(patch) {
  settings = { ...settings, ...patch };
  render();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await chrome.runtime.sendMessage({ action: 'setDefaults', patch: settings });
    flashSaved();
  }, 260);
}

function summarise(preset) {
  const bits = [];
  bits.push(preset.mode === 'snapshot' ? 'Snapshot' : 'Text');
  const paper = PAPER_SIZES[preset.paper];
  if (paper) bits.push(paper.label);
  if (preset.orientation === 'landscape') bits.push('Landscape');
  if (preset.readerMode) bits.push('Reader');
  if (preset.singlePage) bits.push('One page');
  if (preset.declutter === false) bits.push('Overlays kept');
  return bits.join(' · ');
}

async function loadPresets() {
  const response = await chrome.runtime.sendMessage({ action: 'listPresets' });
  const presets = (response && response.presets) || {};
  const hosts = Object.keys(presets).sort();
  const body = $('presetBody');
  body.innerHTML = '';

  $('presetTable').hidden = hosts.length === 0;
  $('presetEmpty').hidden = hosts.length > 0;

  for (const host of hosts) {
    const row = document.createElement('tr');

    const hostCell = document.createElement('td');
    hostCell.className = 'host';
    hostCell.textContent = host;

    const metaCell = document.createElement('td');
    metaCell.className = 'meta';
    metaCell.textContent = summarise(presets[host]);

    const actionCell = document.createElement('td');
    actionCell.className = 'act';
    const remove = document.createElement('button');
    remove.className = 'btn ghost';
    remove.textContent = 'Remove';
    remove.addEventListener('click', async () => {
      await chrome.runtime.sendMessage({ action: 'deletePreset', host });
      loadPresets();
    });
    actionCell.appendChild(remove);

    row.append(hostCell, metaCell, actionCell);
    body.appendChild(row);
  }
}

function wire() {
  for (const id of SELECTS) {
    $(id).addEventListener('change', (event) => update({ [id]: event.target.value }));
  }
  for (const id of CHECKBOXES) {
    $(id).addEventListener('change', (event) => update({ [id]: event.target.checked }));
  }
  for (const id of TEXTS) {
    $(id).addEventListener('input', (event) => update({ [id]: event.target.value }));
  }
  for (const id of NUMBERS) {
    $(id).addEventListener('input', (event) =>
      update({ [id]: Math.max(0, Number(event.target.value) || 0) })
    );
  }
  for (const id of RANGES) {
    $(id).addEventListener('input', (event) => update({ [id]: Number(event.target.value) }));
  }

  for (const group of document.querySelectorAll('.tokens')) {
    const targetId = group.dataset.target;
    group.addEventListener('click', (event) => {
      if (event.target.tagName !== 'CODE') return;
      const input = $(targetId);
      const token = event.target.textContent;
      input.value = `${input.value}${token}`;
      update({ [targetId]: input.value });
      input.focus();
    });
  }

  $('reset').addEventListener('click', async () => {
    const response = await chrome.runtime.sendMessage({ action: 'resetDefaults' });
    if (response && response.ok) {
      settings = response.settings;
      render();
      flashSaved();
    }
  });

  $('shortcutsLink').addEventListener('click', (event) => {
    event.preventDefault();
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  });
}

async function init() {
  fillSelects();
  wire();
  const stored = await chrome.storage.sync.get('defaults');
  settings = { ...DEFAULTS, ...(stored.defaults || {}) };
  render();
  await loadPresets();
  if (location.hash === '#welcome') $('welcome').style.display = 'block';
}

init();
