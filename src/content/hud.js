/**
 * In page progress pill.
 *
 * The popup closes the instant a capture starts, so progress has to live
 * somewhere the user can still see it. This draws a small frosted panel in the
 * corner of the page and removes itself when the PDF lands.
 */
(() => {
  if (window.__page2copierHud || window.__page2pdfHud) return;

  const HOST_ID = 'page2copier-hud-host';
  let host = null;
  let root = null;
  let hideTimer = null;

  const STYLE = `
    :host { all: initial; }
    .pill {
      position: fixed;
      right: 18px;
      bottom: 18px;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 11px 15px;
      border-radius: 14px;
      font: 500 13px/1.3 -apple-system, 'Segoe UI', Roboto, sans-serif;
      color: #eaf2ff;
      background: linear-gradient(140deg, rgba(38,44,84,.82), rgba(18,22,44,.86));
      backdrop-filter: blur(18px) saturate(150%);
      -webkit-backdrop-filter: blur(18px) saturate(150%);
      border: 1px solid rgba(255,255,255,.16);
      box-shadow: 0 12px 34px rgba(6,10,26,.42), inset 0 1px 0 rgba(255,255,255,.14);
      transform: translateY(10px);
      opacity: 0;
      transition: opacity .22s ease, transform .22s ease;
      max-width: 320px;
    }
    .pill.show { opacity: 1; transform: translateY(0); }
    .pill.error { background: linear-gradient(140deg, rgba(96,32,48,.86), rgba(48,16,26,.9)); }
    .pill.done .spinner { display: none; }
    .spinner {
      width: 15px; height: 15px; flex: none;
      border-radius: 50%;
      border: 2px solid rgba(255,255,255,.22);
      border-top-color: #5eead4;
      animation: spin .7s linear infinite;
    }
    .tick { width: 15px; height: 15px; flex: none; display: none; }
    .pill.done .tick { display: block; }
    .label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .bar {
      position: absolute; left: 12px; right: 12px; bottom: 6px; height: 2px;
      border-radius: 2px; background: rgba(255,255,255,.14); overflow: hidden;
    }
    .bar i {
      display: block; height: 100%; width: 0%;
      background: linear-gradient(90deg, #6366f1, #22d3ee);
      transition: width .25s ease;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .spinner { animation-duration: 2s; } }
  `;

  function ensure() {
    if (root) return root;
    host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;';
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = STYLE;
    const pill = document.createElement('div');
    pill.className = 'pill';
    pill.innerHTML =
      '<div class="spinner"></div>' +
      '<svg class="tick" viewBox="0 0 24 24" fill="none" stroke="#5eead4" stroke-width="3" ' +
      'stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>' +
      '<div class="label">Working</div>' +
      '<div class="bar"><i></i></div>';
    shadow.append(style, pill);
    (document.body || document.documentElement).appendChild(host);
    root = { pill, label: pill.querySelector('.label'), bar: pill.querySelector('.bar i') };
    requestAnimationFrame(() => pill.classList.add('show'));
    return root;
  }

  function show(text, progress, state) {
    const ui = ensure();
    clearTimeout(hideTimer);
    ui.label.textContent = text;
    ui.pill.classList.toggle('error', state === 'error');
    ui.pill.classList.toggle('done', state === 'done');
    ui.pill.classList.add('show');
    if (typeof progress === 'number') {
      ui.bar.style.width = `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%`;
    }
    if (state === 'done' || state === 'error') {
      hideTimer = setTimeout(hide, state === 'error' ? 5200 : 1900);
    }
  }

  function hide() {
    if (!root) return;
    root.pill.classList.remove('show');
    setTimeout(() => {
      if (host && host.parentNode) host.remove();
      host = null;
      root = null;
    }, 260);
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || msg.target !== 'hud') return;
    if (msg.action === 'progress') show(msg.text, msg.progress, msg.state);
    if (msg.action === 'hide') hide();
  });

  window.__page2copierHud = window.__page2pdfHud = { show, hide };
})();
