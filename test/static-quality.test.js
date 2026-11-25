'use strict';
/* Static regression checks for browser-only accessibility rules. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');

function channel(v) {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = channel((n >> 16) & 255);
  const g = channel((n >> 8) & 255);
  const b = channel(n & 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

test('alpha door ink meets WCAG AA on its deep amber tile', () => {
  const match = css.match(/--alpha-deep:\s*(#[0-9a-fA-F]{6})/);
  assert.ok(match, 'alpha deep color is defined');
  assert.ok(contrast('#eef1ff', match[1]) >= 4.5,
    'white tile ink needs 4.5:1 on alpha door amber');
});

test('mobile designer paint cells stay at least 24 px square', () => {
  assert.match(css, /\.design-board\s*\{[^}]*--dcell-size:\s*26px/s);
  assert.match(css, /@media \(max-width: 480px\)[\s\S]*\.design-board\s*\{[^}]*--dcell-size:\s*24px/s);
  assert.match(css, /\.dcell\s*\{[\s\S]*width:\s*var\(--dcell-size\)[\s\S]*height:\s*var\(--dcell-size\)/);
  assert.match(app, /grid-template-columns',\s*'repeat\(' \+ w \+ ', var\(--dcell-size\)\)'/);
});
