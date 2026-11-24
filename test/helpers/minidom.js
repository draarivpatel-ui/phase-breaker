'use strict';
/*
 * A deliberately small DOM for running js/app.js inside `node --test` with
 * zero dependencies. It parses the real index.html, implements the subset
 * of the DOM the shell uses, and loads every script file in page order.
 *
 * Supported: getElementById, createElement, createDocumentFragment,
 * appendChild/replaceChildren/removeChild, classList, setAttribute, style,
 * dataset, addEventListener + bubbling dispatchEvent, closest/matches for
 * 'tag[attr]' selectors, querySelector(All) for simple selectors, input
 * value/disabled/hidden, localStorage, location.hash, navigator.clipboard,
 * anchor downloads (recorded on document.downloads), window hashchange.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');

const ROOT = path.resolve(__dirname, '..', '..');
const VOID = new Set(['meta', 'link', 'input', 'br', 'img', 'hr', 'area',
  'base', 'col', 'embed', 'source', 'track', 'wbr']);

/* -------------------------------------------------------------------------- */
/* Element                                                                    */
/* -------------------------------------------------------------------------- */

class El {
  constructor(tag, doc) {
    this.tagName = String(tag).toUpperCase();
    this.tag = String(tag).toLowerCase();
    this.ownerDocument = doc;
    this.attrs = {};
    this.children = [];
    this.parent = null;
    this.listeners = {};
    this._class = new Set();
    this._text = '';
    this.value = '';
    this.checked = false;
    this.selected = false;
    this.disabled = false;
    this.hidden = false;
    this.style = makeStyle();
    this.dataset = {};
  }

  get className() { return [...this._class].join(' '); }
  set className(v) {
    this._class = new Set(String(v).split(/\s+/).filter(Boolean));
  }
  get id() { return this.attrs.id || ''; }
  set id(v) { this.attrs.id = v; }
  get classList() {
    const s = this._class;
    return {
      add: (...cs) => cs.forEach((c) => s.add(c)),
      remove: (...cs) => cs.forEach((c) => s.delete(c)),
      toggle: (c, force) => {
        const want = force === undefined ? !s.has(c) : Boolean(force);
        if (want) { s.add(c); } else { s.delete(c); }
        return want;
      },
      contains: (c) => s.has(c)
    };
  }
  get textContent() {
    if (this.children.length === 0) { return this._text; }
    return this.children.map((c) => c.textContent).join('');
  }
  set textContent(v) {
    this.children = [];
    this._text = String(v);
  }
  get innerText() { return this.textContent; }
  get childNodes() { return this.children; }
  get parentNode() { return this.parent; }
  get firstChild() { return this.children[0] || null; }

  setAttribute(name, v) {
    this.attrs[name] = String(v);
    if (name === 'id') { /* id tracked via attrs */ }
    if (name.startsWith('data-')) {
      const key = name.slice(5).replace(/-([a-z])/g, (m, c) => c.toUpperCase());
      this.dataset[key] = String(v);
    }
    if (name === 'class') { this.className = v; }
    if (name === 'value') { this.value = String(v); }
    if (name === 'hidden') { this.hidden = true; }
    if (name === 'disabled') { this.disabled = true; }
  }
  getAttribute(name) {
    if (name === 'class') { return this.className; }
    if (name === 'value') { return this.value; }
    return name in this.attrs ? this.attrs[name] : null;
  }
  hasAttribute(name) { return name in this.attrs; }
  removeAttribute(name) { delete this.attrs[name]; }

  appendChild(node) {
    if (node.tag === '#fragment') {
      for (const c of node.children.slice(0)) { this.appendChild(c); }
      node.children = [];
      return node;
    }
    if (node.parent) { node.parent.removeChild(node); }
    node.parent = this;
    this.children.push(node);
    return node;
  }
  appendChildText(t) {
    const n = new El('#text', this.ownerDocument);
    n._text = t;
    return this.appendChild(n);
  }
  insertBefore(node, ref) {
    if (!ref) { return this.appendChild(node); }
    const i = this.children.indexOf(ref);
    if (i < 0) { return this.appendChild(node); }
    if (node.parent) { node.parent.removeChild(node); }
    node.parent = this;
    this.children.splice(i, 0, node);
    return node;
  }
  removeChild(node) {
    const i = this.children.indexOf(node);
    if (i >= 0) { this.children.splice(i, 1); node.parent = null; }
    return node;
  }
  remove() { if (this.parent) { this.parent.removeChild(this); } }
  replaceChildren(...nodes) {
    for (const c of this.children) { c.parent = null; }
    this.children = [];
    this._text = '';
    for (const n of nodes) { this.appendChild(n); }
  }
  append(...nodes) {
    for (const n of nodes) {
      if (typeof n === 'string') { this.appendChildText(n); }
      else { this.appendChild(n); }
    }
  }

  addEventListener(type, fn) {
    (this.listeners[type] = this.listeners[type] || []).push(fn);
  }
  removeEventListener(type, fn) {
    const l = this.listeners[type];
    if (l) { const i = l.indexOf(fn); if (i >= 0) { l.splice(i, 1); } }
  }
  dispatchEvent(evt) {
    evt.target = evt.target || this;
    evt.preventDefault = evt.preventDefault || (() => { evt.defaultPrevented = true; });
    evt.stopPropagation = evt.stopPropagation || (() => { evt._stop = true; });
    let node = this;
    // Parents chain up to the #document node, so doc listeners fire last.
    while (node) {
      const l = node.listeners[evt.type];
      if (l) {
        for (const fn of l.slice(0)) { fn.call(node, evt); }
      }
      if (evt._stop) { break; }
      node = node.parent;
    }
    return !evt.defaultPrevented;
  }
  click() {
    this.dispatchEvent({ type: 'click', target: this });
    if (this.tag === 'a' && this.hasAttribute('download') && this.ownerDocument) {
      this.ownerDocument.downloads.push({
        name: this.getAttribute('download'),
        href: this.getAttribute('href')
      });
    }
  }
  focus() { if (this.ownerDocument) { this.ownerDocument.activeElement = this; } }
  blur() { if (this.ownerDocument) { this.ownerDocument.activeElement = null; } }
  select() { this.selected = true; }

  matches(sel) {
    sel = sel.trim();
    const m = /^([a-zA-Z0-9*]*)?(#[\w-]+)?(\.[\w-]+)*(\[[\w-]+(="?([^\]"]*)"?)?\])?$/.exec(sel);
    // fallthrough matcher: tag, #id, .cls, [attr], [attr=v]
    const attrM = /\[([\w-]+)(?:="?([^\]"]*)"?)?\]/.exec(sel);
    const idM = /#([\w-]+)/.exec(sel);
    const clsM = sel.match(/\.([\w-]+)/g);
    const tagM = /^[a-zA-Z][\w-]*/.exec(sel);
    if (tagM && this.tag !== tagM[0].toLowerCase()) { return false; }
    if (idM && this.id !== idM[1]) { return false; }
    if (clsM) {
      for (const c of clsM) {
        if (!this._class.has(c.slice(1))) { return false; }
      }
    }
    if (attrM) {
      const name = attrM[1], val = attrM[2];
      if (!(name in this.attrs)) { return false; }
      if (val !== undefined && this.attrs[name] !== val) { return false; }
    }
    if (!tagM && !idM && !clsM && !attrM) { return false; }
    return true;
  }

  closest(sel) {
    let n = this;
    while (n && n.tag !== '#document') {
      if (n.matches && n.matches(sel)) { return n; }
      n = n.parent;
    }
    return null;
  }

  querySelectorAll(sel) {
    const parts = sel.trim().split(/\s+/);
    const last = parts[parts.length - 1];
    const out = [];
    const walk = (el) => {
      for (const c of el.children) {
        if (c.tag !== '#text' && c.matches(last) && hasAncestorChain(c, parts)) {
          out.push(c);
        }
        if (c.children) { walk(c); }
      }
    };
    walk(this);
    return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}

function hasAncestorChain(el, parts) {
  if (parts.length === 1) { return true; }
  let n = el.parent;
  let i = parts.length - 2;
  while (n && i >= 0) {
    if (n.tag !== '#document' && n.matches(parts[i])) { i--; }
    n = n.parent;
  }
  return i < 0;
}

function makeStyle() {
  const s = {};
  s.setProperty = (k, v) => { s[k] = v; };
  s.getPropertyValue = (k) => s[k] || '';
  return s;
}

/* -------------------------------------------------------------------------- */
/* Document + Window                                                          */
/* -------------------------------------------------------------------------- */

function makeDocument(html) {
  const doc = new El('#document', null);
  doc.ownerDocument = doc;
  doc.listeners = {};
  doc.downloads = [];
  doc.activeElement = null;
  doc.documentElement = new El('html', doc);
  doc.appendChild(doc.documentElement);
  doc.head = new El('head', doc);
  doc.body = new El('body', doc);
  doc.documentElement.appendChild(doc.head);
  doc.documentElement.appendChild(doc.body);
  doc.defaultView = null;

  doc.createElement = (tag) => new El(tag, doc);
  doc.createDocumentFragment = () => new El('#fragment', doc);
  doc.createTextNode = (t) => { const n = new El('#text', doc); n._text = t; return n; };
  doc.getElementById = (id) => {
    let found = null;
    const walk = (el) => {
      for (const c of el.children) {
        if (c.id === id) { found = c; return; }
        if (c.children) { walk(c); }
      }
    };
    walk(doc.documentElement);
    return found;
  };
  doc.execCommand = () => true;
  doc.addEventListener = (t, fn) => { (doc.listeners[t] = doc.listeners[t] || []).push(fn); };

  // Parse body content out of the real file, then graft head children too.
  const headM = /<head[^>]*>([\s\S]*?)<\/head>/i.exec(html);
  const bodyM = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html);
  const graft = (host, inner) => {
    if (!inner) { return; }
    const frag = parseFragment(inner, doc);
    // appendChild detaches each node (splices frag.children), so walk a copy.
    for (const c of frag.children.slice(0)) { host.appendChild(c); }
  };
  graft(doc.head, headM && headM[1]);
  graft(doc.body, bodyM && bodyM[1]);

  // textareas take their initial value from inner text; inputs from value attr
  const fixValues = (el) => {
    if (el.tag === 'textarea') { el.value = el.textContent; }
    for (const c of el.children) { fixValues(c); }
  };
  fixValues(doc.documentElement);
  return doc;
}

function parseFragment(inner, doc) {
  const frag = new El('#fragment', doc);
  const stack = [frag];
  const re = /<!--[\s\S]*?-->|<!DOCTYPE[^>]*>|<\/[a-zA-Z][^>]*>|<[a-zA-Z][^>]*>|[^<]+/g;
  let m;
  while ((m = re.exec(inner)) !== null) {
    const tok = m[0];
    if (tok.startsWith('<!--') || tok.startsWith('<!DOCTYPE')) { continue; }
    if (tok.startsWith('</')) {
      const name = tok.slice(2, -1).trim().toLowerCase();
      while (stack.length > 1) {
        const top = stack.pop();
        if (top.tag === name) { break; }
      }
      continue;
    }
    if (tok.startsWith('<')) {
      const innerT = tok.slice(1, -1);
      const selfClose = innerT.endsWith('/');
      const bodyT = selfClose ? innerT.slice(0, -1) : innerT;
      const spaceIdx = bodyT.search(/[\s]/);
      const name = (spaceIdx < 0 ? bodyT : bodyT.slice(0, spaceIdx)).toLowerCase();
      const attrText = spaceIdx < 0 ? '' : bodyT.slice(spaceIdx + 1);
      const el = new El(name, doc);
      const attrRe = /([\w-]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|[^\s>]+))?/g;
      let am;
      while ((am = attrRe.exec(attrText)) !== null) {
        const val = am[3] !== undefined ? am[3] :
          (am[4] !== undefined ? am[4] : (am[2] !== undefined ? am[2] : ''));
        el.setAttribute(am[1], val);
        if (am[1] === 'hidden') { el.hidden = true; }
        if (am[1] === 'disabled') { el.disabled = true; }
        if (am[1] === 'selected') { el.selected = true; }
      }
      stack[stack.length - 1].appendChild(el);
      if (name === 'script' || name === 'style') {
        if (!selfClose) {
          const closeRe = new RegExp('</' + name + '\\s*>', 'i');
          const rest = inner.slice(re.lastIndex);
          const cm = closeRe.exec(rest);
          re.lastIndex += cm ? cm.index + cm[0].length : rest.length;
        }
        continue;
      }
      if (!selfClose && !VOID.has(name)) { stack.push(el); }
      continue;
    }
    if (tok.trim().length > 0 || stack[stack.length - 1].tag === 'textarea') {
      stack[stack.length - 1].appendChildText(tok);
    }
  }
  return frag;
}

function makeWindow(doc) {
  const store = {};
  const win = {
    document: doc,
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
      clear: () => { for (const k of Object.keys(store)) { delete store[k]; } }
    },
    location: { href: 'http://localhost:8080/', hash: '' },
    history: { replaceState: () => {} },
    navigator: {
      clipboard: {
        _text: null,
        writeText(t) { this._text = t; return Promise.resolve(); }
      }
    },
    listeners: {},
    addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); },
    fire(t, evt) {
      evt = evt || {};
      evt.type = t;
      for (const fn of (this.listeners[t] || []).slice(0)) { fn.call(this, evt); }
    },
    setTimeout, clearTimeout, setInterval, clearInterval
  };
  win.window = win;
  doc.defaultView = win;
  return win;
}

/* -------------------------------------------------------------------------- */
/* App loader                                                                 */
/* -------------------------------------------------------------------------- */

const SCRIPTS = [
  'src/core.js', 'src/sha256.js', 'src/replay.js', 'src/telemetry.js',
  'src/designer.js', 'src/audit.js', 'src/selftest.js',
  'js/levels.js', 'js/app.js'
];

/*
 * Boot the real page in mini-DOM. Returns {window, document, require file
 * errors: []}; every script runs inside a vm context where bare `window`,
 * `document`, `location`, `navigator`, `localStorage`, `globalThis` and
 * `module` resolve to the test doubles, exactly like a browser.
 */
function loadApp(opts) {
  opts = opts || {};
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const doc = makeDocument(html);
  const win = makeWindow(doc);
  if (opts.hash) { win.location.hash = opts.hash; }
  const errors = [];
  for (const rel of SCRIPTS) {
    const file = path.join(ROOT, rel);
    const code = fs.readFileSync(file, 'utf8');
    const mod = { exports: {} };
    const ctx = vm.createContext({
      window: win,
      document: doc,
      navigator: win.navigator,
      localStorage: win.localStorage,
      location: win.location,
      history: win.history,
      globalThis: win,
      module: mod,
      exports: mod.exports,
      require: createRequire(file),
      setTimeout, clearTimeout, setInterval, clearInterval,
      console
    });
    try {
      vm.runInContext(code, ctx, { filename: rel });
    } catch (err) {
      errors.push(rel + ': ' + (err && err.stack || err));
    }
  }
  return { window: win, document: doc, errors };
}

/* Convenience helpers for tests. */
function key(el, k) {
  el.dispatchEvent({
    type: 'keydown', key: k,
    ctrlKey: false, metaKey: false, altKey: false,
    preventDefault() { this.defaultPrevented = true; }
  });
}

function cells(doc) { return doc.getElementById('board').querySelectorAll('.cell'); }

function playerPos(doc) {
  const cs = cells(doc);
  const w = Number(doc.getElementById('board').style['--w'] || 13);
  for (let i = 0; i < cs.length; i++) {
    if (cs[i].classList.contains('player')) {
      return { x: i % w, y: Math.floor(i / w), i };
    }
  }
  return null;
}

module.exports = { loadApp, key, cells, playerPos, El, makeDocument, makeWindow };
