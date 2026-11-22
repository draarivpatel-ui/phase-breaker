'use strict';
/* SHA-256: NIST/FIPS vectors, streaming equivalence, UTF-8, byte input. */
const test = require('node:test');
const assert = require('node:assert');
const Sha = require('../src/sha256.js');

const VECTORS = [
  ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
  ['a', 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb'],
  ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
  ['message digest', 'f7846f55cf23e14eebeab5b4e1550cad5b509e3348fbc4efa3a1413d393cb650'],
  ['abcdefghijklmnopqrstuvwxyz', '71c480df93d6ae2f1efad1447c66c9525e316218cf51fc8d9ed832f2daf18b73'],
  ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
  ['ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
    'db4bfcbd4da0cd85a60c3c37d3fbd8805c77f15fc6b1fdfe614ee0a7c8fdb4c0'],
  ['12345678901234567890123456789012345678901234567890123456789012345678901234567890',
    'f371bc4a311f2b009eef952dd83ca80e2b60026c8e935592d0f9c308453c813e'],
  ['hello world', 'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9'],
  ['The quick brown fox jumps over the lazy dog',
    'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592'],
  ['The quick brown fox jumps over the lazy dog.',
    'ef537f25c895bfa782526529a9b63d97aa631564d5d789c2b765448c8635fb6c']
];

for (const [msg, want] of VECTORS) {
  test(`vector: ${JSON.stringify(msg.length > 30 ? msg.slice(0, 27) + '...' : msg)}`, () => {
    assert.equal(Sha.sha256hex(msg), want);
  });
}

test('one million a characters (FIPS long message)', () => {
  const s = new Sha.Sha256();
  const chunk = 'a'.repeat(100000);
  for (let i = 0; i < 10; i++) { s.update(chunk); }
  assert.equal(s.hex(), 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
});

const CHUNK_CASES = [
  'phase breaker audit payload 0123456789'.repeat(40),
  'x'.repeat(63), 'x'.repeat(64), 'x'.repeat(65), 'x'.repeat(128),
  'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(57)
];
for (const msg of CHUNK_CASES) {
  test(`byte-at-a-time matches one-shot for ${msg.length} bytes`, () => {
    const s = new Sha.Sha256();
    for (let i = 0; i < msg.length; i++) { s.update(msg.charAt(i)); }
    assert.equal(s.hex(), Sha.sha256hex(msg));
  });
}

test('odd chunk sizes all agree with one-shot', () => {
  const msg = 'the quick brown fox jumps over the lazy dog '.repeat(9);
  for (const size of [1, 7, 13, 64, 100]) {
    const s = new Sha.Sha256();
    for (let i = 0; i < msg.length; i += size) { s.update(msg.slice(i, i + size)); }
    assert.equal(s.hex(), Sha.sha256hex(msg), 'chunk ' + size);
  }
});

test('Uint8Array input hashes the raw bytes', () => {
  const bytes = Uint8Array.from([0, 1, 2, 3, 254, 255]);
  const hex = Sha.sha256bytes(bytes);
  assert.equal(hex.length, 32);
  assert.equal(Sha.bytesToHex(hex), Sha.sha256hex(bytes));
});

test('plain array input accepted', () => {
  assert.equal(Sha.sha256hex([97, 98, 99]), Sha.sha256hex('abc'));
});

test('UTF-8 multibyte input is encoded correctly', () => {
  // 'é' as U+00E9 -> c3a9
  assert.equal(Sha.sha256hex('é'),
    Sha.sha256hex(Uint8Array.from([0xc3, 0xa9])));
  // '日本語' 3-byte chars
  const enc = new TextEncoder().encode('日本語');
  assert.equal(Sha.sha256hex('日本語'), Sha.sha256hex(enc));
});

test('astral characters encode as surrogate pairs', () => {
  const enc = new TextEncoder().encode('🎃');
  assert.equal(Sha.sha256hex('🎃'), Sha.sha256hex(enc));
});

test('lone surrogates encode the replacement character', () => {
  const rep = Sha.sha256hex('�');
  assert.equal(Sha.sha256hex('\ud800'), rep);
  assert.equal(Sha.sha256hex('\udfff'), rep);
});

test('hex output is 64 lowercase hex chars', () => {
  for (const m of ['', 'x', 'phase breaker', '0'.repeat(200)]) {
    assert.match(Sha.sha256hex(m), /^[0-9a-f]{64}$/);
  }
});

test('digest after digest throws', () => {
  const s = new Sha.Sha256();
  s.update('a');
  s.digest();
  assert.throws(() => s.digest(), /digested/);
  assert.throws(() => s.update('b'), /digested/);
});

test('bad input type throws', () => {
  assert.throws(() => Sha.sha256hex({}));
  assert.throws(() => Sha.sha256hex(null));
  assert.throws(() => Sha.sha256hex(undefined));
});

test('number-like objects do not hash silently', () => {
  assert.throws(() => Sha.sha256hex(42));
});

test('empty update is a no-op', () => {
  const s = new Sha.Sha256();
  s.update('');
  s.update(new Uint8Array(0));
  assert.equal(s.hex(), Sha.sha256hex(''));
});

test('two fresh instances agree', () => {
  const a = new Sha.Sha256(); a.update('same');
  const b = new Sha.Sha256(); b.update('same');
  assert.equal(a.hex(), b.hex());
});
