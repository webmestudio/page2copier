/**
 * Thin promise wrapper around chrome.debugger.
 *
 * Everything Page2Copier does that matters for fidelity goes through here: we drive
 * the very same rendering pipeline the browser uses to paint the tab, instead of
 * re-implementing CSS in JavaScript the way canvas based converters do.
 */

const PROTOCOL_VERSION = '1.3';

/** tabId -> { count, detachPromise } */
const attached = new Map();

class CdpError extends Error {
  constructor(message, { recoverable = false } = {}) {
    super(message);
    this.name = 'CdpError';
    this.recoverable = recoverable;
  }
}

function lastError() {
  const err = chrome.runtime.lastError;
  return err ? err.message : null;
}

/**
 * Attaches the debugger to a tab, reference counted so nested operations
 * (prepare, capture, restore) never detach out from under each other.
 */
export function attach(tabId) {
  const entry = attached.get(tabId);
  if (entry) {
    entry.count += 1;
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    chrome.debugger.attach({ tabId }, PROTOCOL_VERSION, () => {
      const err = lastError();
      if (err) {
        reject(new CdpError(explainAttachFailure(err)));
        return;
      }
      attached.set(tabId, { count: 1 });
      resolve();
    });
  });
}

export function detach(tabId) {
  const entry = attached.get(tabId);
  if (!entry) return Promise.resolve();
  entry.count -= 1;
  if (entry.count > 0) return Promise.resolve();
  attached.delete(tabId);
  return new Promise((resolve) => {
    chrome.debugger.detach({ tabId }, () => {
      lastError();
      resolve();
    });
  });
}

export function isAttached(tabId) {
  return attached.has(tabId);
}

export function send(tabId, method, params = {}) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
      const err = lastError();
      if (err) {
        reject(new CdpError(`${method} failed: ${err}`));
        return;
      }
      resolve(result || {});
    });
  });
}

/** Runs `fn` with the debugger attached and guarantees a detach afterwards. */
export async function withDebugger(tabId, fn) {
  await attach(tabId);
  try {
    return await fn();
  } finally {
    await detach(tabId);
  }
}

/**
 * Evaluates an expression in the page and returns its value.
 * Used instead of chrome.scripting when we are already attached, so we never
 * race the debugger session.
 */
export async function evaluate(tabId, expression, { awaitPromise = true } = {}) {
  const res = await send(tabId, 'Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true,
  });
  if (res.exceptionDetails) {
    const text =
      res.exceptionDetails.exception?.description ||
      res.exceptionDetails.text ||
      'Page evaluation failed';
    throw new CdpError(text);
  }
  return res.result?.value;
}

/** Reads a CDP IO stream to completion and returns the base64 payload. */
export async function readStream(tabId, handle) {
  const chunks = [];
  for (;;) {
    const { data, base64Encoded, eof } = await send(tabId, 'IO.read', {
      handle,
      size: 1 << 20,
    });
    if (data) chunks.push(base64Encoded ? data : btoa(data));
    if (eof) break;
  }
  await send(tabId, 'IO.close', { handle }).catch(() => {});
  return chunks;
}

function explainAttachFailure(message) {
  const m = String(message);
  if (m.includes('Another debugger') || m.includes('already attached')) {
    return 'Another debugger is already attached to this tab. Close DevTools for this tab and try again.';
  }
  if (m.includes('Cannot access') || m.includes('chrome://') || m.includes('extension')) {
    return 'Chrome does not allow extensions to read this page. Browser pages, the Web Store and other extension pages are off limits.';
  }
  return m;
}

export { CdpError };
