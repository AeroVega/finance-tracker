import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Execute the checked-in controller with a deliberately small DOM. Imports are
// supplied explicitly: financial code stays real; browser/service seams vary.
// This checks handlers, not layout, native browser permissions or live Google.
export async function pageController(name, imports, { source = 'a'.repeat(40), session = new Map(),
  htmlPath = `prototype/${name}.html`, scriptPath = `prototype/${name}.mjs`, timers = {setTimeout, clearTimeout} } = {}) {
  const html = await readFile(new URL(`../../${htmlPath}`, import.meta.url), 'utf8');
  const script = await readFile(new URL(`../../${scriptPath}`, import.meta.url), 'utf8');
  const nodes = new Map(), listeners = new Map(), documentListeners = new Map(), intervals = new Set();
  const observed = { focused: null, selected: null, copied: [], clipboardFailure: false, storageFailure: false, confirmations: [], confirm: true };
  function forget(node) {
    for (const child of node.children) forget(child);
    if (nodes.get(node.id) === node) nodes.delete(node.id);
  }
  function element(tag) {
    let id = '';
    const events = new Map();
    return {
      tagName: tag.toUpperCase(), children: [], dataset: {}, attributes: {}, value: '', textContent: '', disabled: false, checked: false,
      get id() { return id; }, set id(value) { id = value; nodes.set(value, this); },
      append(...children) { this.children.push(...children); if (this.tagName === 'SELECT' && !this.value) this.value = children[0]?.value || ''; },
      replaceChildren(...children) { this.children.forEach(forget); this.children = []; this.append(...children); },
      setAttribute(key, value) { this.attributes[key] = value; },
      removeAttribute(key) { delete this.attributes[key]; },
      addEventListener(type, callback) { if (!events.has(type)) events.set(type, []); events.get(type).push(callback); },
      async emit(type, event = {}) { for (const callback of events.get(type) || []) await callback(event); },
      focus() { observed.focused = this; }, select() { observed.selected = this; },
      click() { return this.emit('click'); }, remove() { forget(this); }
    };
  }
  for (const match of html.matchAll(/<([a-z][a-z0-9]*)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
    const node = element(match[1]); node.id = match[3]; node.disabled = /\sdisabled(?:\s|$)/.test(match[2]);
  }
  for (const match of html.matchAll(/<select\b[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)) {
    for (const option of match[2].matchAll(/<option\b[^>]*value="([^"]+)"[^>]*>([^<]*)<\/option>/g)) {
      const node = element('option'); node.value = option[1]; node.textContent = option[2]; nodes.get(match[1]).append(node);
    }
  }
  const get = id => { assert.ok(nodes.has(id), `Missing control ${id}`); return nodes.get(id); };
  get('build-sha').textContent = source;
  const location = {hash:''};
  const historyEntries = ['']; let historyIndex = 0;
  const history = {scrollRestoration:'auto',
    pushState(_state, _title, hash) { historyEntries.splice(++historyIndex); historyEntries.push(hash); location.hash = hash; },
    replaceState(_state, _title, hash) { historyEntries[historyIndex] = hash; location.hash = hash; }
  };
  const window = { location, history, scrollY:0, scrollTo({top}) { this.scrollY = top; }, addEventListener(type, callback) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(callback); },
    confirm(question) { observed.confirmations.push(question); return observed.confirm; } };
  const navigator = { onLine: true, clipboard: { async writeText(value) {
    if (observed.clipboardFailure) throw new Error('Invented clipboard refusal');
    observed.copied.push(value);
  } } };
  const executable = script.replace(/^import \{([^}]+)\} from '[^']+';$/gm, (_, names) => {
    for (const name of names.split(',').map(name => name.trim())) assert.ok(name in imports, `Missing import ${name}`);
    return '';
  });
  const context = { ...imports, document: { getElementById: id => nodes.get(id) || null, createElement: element, body: element('body'),
    addEventListener(type, callback) { if (!documentListeners.has(type)) documentListeners.set(type, []); documentListeners.get(type).push(callback); } },
    window, navigator, confirm: window.confirm, crypto, structuredClone, URL, Blob, TextEncoder, TextDecoder, Uint8Array,
    sessionStorage: { getItem: key => session.get(key) ?? null, setItem(key, value) { if (observed.storageFailure) throw new Error('Invented storage refusal'); session.set(key, value); }, removeItem: key => session.delete(key) },
    setInterval(callback) { intervals.add(callback); return callback; }, clearInterval: callback => intervals.delete(callback),
    setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout, fetch() { throw new Error('Network is forbidden in controller tests'); } };
  vm.runInNewContext(executable, context, { filename: `${name}.mjs` });
  await new Promise(setImmediate);
  return {
    get, observed, session, navigator, intervals, location, window,
    async navigate(hash) { history.pushState(null, "", hash); for (const callback of listeners.get("hashchange") || []) await callback(); },
    async back() { if (historyIndex > 0) { location.hash = historyEntries[--historyIndex]; for (const callback of listeners.get("popstate") || []) await callback(); } },
    async forward() { if (historyIndex < historyEntries.length - 1) { location.hash = historyEntries[++historyIndex]; for (const callback of listeners.get("popstate") || []) await callback(); } },
    async click(id) { const node = get(id); if (!node.disabled) await node.emit('click'); await new Promise(setImmediate); },
    async choose(id, value) {
      const node = get(id); assert.equal(node.disabled, false, `${id} must be enabled`);
      if (typeof value === 'boolean') node.checked = value;
      else { const option = node.children.find(option => option.value === value); assert.ok(option, `Missing option ${value}`); assert.equal(option.disabled, false); node.value = value; }
      await node.emit('change');
    },
    async event(type, event = {}) { for (const callback of listeners.get(type) || []) await callback(event); },
    async until(predicate) {
      // A bounded failure deadline, not a performance assertion. Work and
      // interruption ordering are controlled by promises, not elapsed sleeps.
      const deadline = Date.now() + 5000;
      while (!predicate()) { assert.ok(Date.now() < deadline, 'Controller did not reach expected state'); await new Promise(setImmediate); }
    }
  };
}

export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
