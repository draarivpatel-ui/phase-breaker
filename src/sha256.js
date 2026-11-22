/*
 * PhaseBreaker SHA-256.
 * Pure JavaScript, no browser globals, no external packages. FIPS 180-4
 * compression over a byte stream with a small streaming wrapper so callers
 * can update in any chunk size and get identical digests.
 *
 * Exported as PBSha256: { sha256hex, sha256bytes, utf8, Sha256 }.
 * sha256hex accepts a string (UTF-8 encoded) or a byte array / Uint8Array
 * and returns the 64 character lowercase hex digest.
 */
'use strict';

/* -------------------------------------------------------------------------- */
/* Round constants (first 32 bits of the fractional cube roots of the first   */
/* 64 primes) and initial hash state (fractional square roots of primes 2-19) */
/* -------------------------------------------------------------------------- */

var K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

var H0 = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
];

function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }

/* -------------------------------------------------------------------------- */
/* UTF-8                                                                      */
/* -------------------------------------------------------------------------- */

// Hand rolled UTF-8 so the module never depends on TextEncoder being present.
function utf8(str) {
  var s = String(str);
  var out = [];
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    if (c < 0x80) {
      out.push(c);
    } else if (c < 0x800) {
      out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    } else if (c >= 0xd800 && c <= 0xdbff) {
      var c2 = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      if (c2 >= 0xdc00 && c2 <= 0xdfff) {
        var cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
        out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63),
          0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
        i++;
      } else {
        // Lone high surrogate: emit the replacement character.
        out.push(0xef, 0xbf, 0xbd);
      }
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      out.push(0xef, 0xbf, 0xbd);
    } else {
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
  }
  return Uint8Array.from(out);
}

function toBytes(data) {
  if (typeof data === 'string') { return utf8(data); }
  if (data instanceof Uint8Array) { return data; }
  if (Array.isArray(data)) { return Uint8Array.from(data); }
  if (data && typeof data.length === 'number') { return Uint8Array.from(data); }
  throw new Error('sha256 needs a string or byte array');
}

/* -------------------------------------------------------------------------- */
/* Compression                                                                */
/* -------------------------------------------------------------------------- */

// Process exactly one 64 byte block starting at `off` against state h (an
// array of eight uint32). Everything is forced through >>>0 and Math.imul
// safe additions; the spec's addition is mod 2^32 which JS gives for free
// when every operand is already uint32 and we mask with >>>0 at the end.
function compress(h, block, off) {
  var w = new Array(64);
  for (var i = 0; i < 16; i++) {
    var j = off + i * 4;
    w[i] = ((block[j] << 24) | (block[j + 1] << 16) |
      (block[j + 2] << 8) | block[j + 3]) >>> 0;
  }
  for (var t = 16; t < 64; t++) {
    var s0 = (rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3)) >>> 0;
    var s1 = (rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10)) >>> 0;
    w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
  }
  var a = h[0], b = h[1], c = h[2], d = h[3],
      e = h[4], f = h[5], g = h[6], hh = h[7];
  for (t = 0; t < 64; t++) {
    var S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
    var ch = ((e & f) ^ (~e & g)) >>> 0;
    var t1 = (hh + S1 + ch + K[t] + w[t]) >>> 0;
    var S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
    var maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
    var t2 = (S0 + maj) >>> 0;
    hh = g; g = f; f = e; e = (d + t1) >>> 0;
    d = c; c = b; b = a; a = (t1 + t2) >>> 0;
  }
  h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0;
  h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
  h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0;
  h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
}

/* -------------------------------------------------------------------------- */
/* Streaming wrapper                                                          */
/* -------------------------------------------------------------------------- */

function Sha256() {
  this.h = H0.slice(0);
  this.buf = new Uint8Array(64);
  this.bufLen = 0;
  this.total = 0;      // bytes fed so far, tracked exactly as a float (< 2^53)
  this.done = false;
}

Sha256.prototype.update = function (data) {
  if (this.done) { throw new Error('sha256 already digested'); }
  var bytes = toBytes(data);
  this.total += bytes.length;
  var pos = 0;
  if (this.bufLen > 0) {
    var need = 64 - this.bufLen;
    var take = Math.min(need, bytes.length);
    this.buf.set(bytes.subarray(0, take), this.bufLen);
    this.bufLen += take;
    pos += take;
    if (this.bufLen === 64) {
      compress(this.h, this.buf, 0);
      this.bufLen = 0;
    }
  }
  while (pos + 64 <= bytes.length) {
    compress(this.h, bytes, pos);
    pos += 64;
  }
  if (pos < bytes.length) {
    this.buf.set(bytes.subarray(pos), 0);
    this.bufLen = bytes.length - pos;
  }
  return this;
};

// Final block: 0x80, zero fill, then the bit length as a 64 bit big endian
// integer. JS numbers hold the byte count exactly for any realistic input.
Sha256.prototype.digest = function () {
  if (this.done) { throw new Error('sha256 already digested'); }
  this.done = true;
  var bitLen = this.total * 8;
  this.updateBytesInternal([0x80]);
  while (this.bufLen !== 56) {
    this.updateBytesInternal([0]);
  }
  var lenBytes = new Uint8Array(8);
  var hi = Math.floor(bitLen / 0x100000000);
  var lo = bitLen >>> 0;
  for (var i = 0; i < 4; i++) {
    lenBytes[i] = (hi >>> ((3 - i) * 8)) & 0xff;
    lenBytes[i + 4] = (lo >>> ((3 - i) * 8)) & 0xff;
  }
  this.updateBytesInternal(lenBytes);
  var out = new Uint8Array(32);
  for (var j = 0; j < 8; j++) {
    out[j * 4] = (this.h[j] >>> 24) & 0xff;
    out[j * 4 + 1] = (this.h[j] >>> 16) & 0xff;
    out[j * 4 + 2] = (this.h[j] >>> 8) & 0xff;
    out[j * 4 + 3] = this.h[j] & 0xff;
  }
  return out;
};

// Byte writer used during finalisation only; bypasses the `done` flag and
// never touches `total` again (padding is not message bytes).
Sha256.prototype.updateBytesInternal = function (bytes) {
  for (var i = 0; i < bytes.length; i++) {
    this.buf[this.bufLen++] = bytes[i];
    if (this.bufLen === 64) {
      compress(this.h, this.buf, 0);
      this.bufLen = 0;
    }
  }
};

Sha256.prototype.hex = function () {
  return bytesToHex(this.digest());
};

/* -------------------------------------------------------------------------- */
/* One-shot helpers                                                           */
/* -------------------------------------------------------------------------- */

function bytesToHex(bytes) {
  var out = '';
  for (var i = 0; i < bytes.length; i++) {
    out += (bytes[i] >>> 4).toString(16) + (bytes[i] & 15).toString(16);
  }
  return out;
}

function sha256bytes(data) {
  var s = new Sha256();
  s.update(data);
  return s.digest();
}

function sha256hex(data) {
  return bytesToHex(sha256bytes(data));
}

/* -------------------------------------------------------------------------- */
/* Exports                                                                    */
/* -------------------------------------------------------------------------- */

var PBSha256 = {
  sha256hex: sha256hex,
  sha256bytes: sha256bytes,
  bytesToHex: bytesToHex,
  utf8: utf8,
  Sha256: Sha256
};

if (typeof module !== 'undefined' && module.exports) { module.exports = PBSha256; }
if (typeof globalThis !== 'undefined' && globalThis.window) { globalThis.window.PBSha256 = PBSha256; }
