/* eslint-disable no-bitwise */
// AES-128-CBC decryption (PKCS#7) for encrypted HLS segments.
// Pure typed-array implementation with 32-bit lookup tables: the app has no
// native CBC primitive (expo-crypto's AES is GCM only).

const SBOX = new Uint8Array(256);
const INV_SBOX = new Uint8Array(256);
const TD0 = new Uint32Array(256);
const TD1 = new Uint32Array(256);
const TD2 = new Uint32Array(256);
const TD3 = new Uint32Array(256);
const TE_SUB = new Uint32Array(256); // SBOX as words, for the key schedule

const xtime = (a: number): number => ((a << 1) ^ (a & 0x80 ? 0x11b : 0)) & 0xff;
const mul = (a: number, b: number): number => {
  let r = 0;
  while (b) {
    if (b & 1) {
      r ^= a;
    }
    a = xtime(a);
    b >>= 1;
  }
  return r;
};

(() => {
  // Build the S-box from GF(2^8) inverses and the affine transform.
  const exp = new Uint8Array(256);
  const log = new Uint8Array(256);
  let x = 1;
  for (let i = 0; i < 255; i++) {
    exp[i] = x;
    log[x] = i;
    x ^= xtime(x); // multiply by 3
  }
  for (let i = 0; i < 256; i++) {
    const inv = i === 0 ? 0 : exp[(255 - log[i]) % 255];
    let s = inv;
    let r = inv;
    for (let k = 0; k < 4; k++) {
      r = ((r << 1) | (r >> 7)) & 0xff;
      s ^= r;
    }
    s ^= 0x63;
    SBOX[i] = s;
    INV_SBOX[s] = i;
  }
  for (let i = 0; i < 256; i++) {
    const s = INV_SBOX[i];
    const w =
      ((mul(s, 14) << 24) |
        (mul(s, 9) << 16) |
        (mul(s, 13) << 8) |
        mul(s, 11)) >>>
      0;
    TD0[i] = w;
    TD1[i] = ((w >>> 8) | (w << 24)) >>> 0;
    TD2[i] = ((w >>> 16) | (w << 16)) >>> 0;
    TD3[i] = ((w >>> 24) | (w << 8)) >>> 0;
    TE_SUB[i] = SBOX[i];
  }
})();

const RCON = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36];

// Decryption key schedule (equivalent inverse cipher), 44 words.
const expandDecryptKey = (key: Uint8Array): Uint32Array => {
  const ek = new Uint32Array(44);
  for (let i = 0; i < 4; i++) {
    ek[i] =
      ((key[4 * i] << 24) |
        (key[4 * i + 1] << 16) |
        (key[4 * i + 2] << 8) |
        key[4 * i + 3]) >>>
      0;
  }
  for (let i = 4; i < 44; i++) {
    let t = ek[i - 1];
    if (i % 4 === 0) {
      t = ((t << 8) | (t >>> 24)) >>> 0;
      t =
        ((SBOX[t >>> 24] << 24) |
          (SBOX[(t >>> 16) & 0xff] << 16) |
          (SBOX[(t >>> 8) & 0xff] << 8) |
          SBOX[t & 0xff]) >>>
        0;
      t = (t ^ (RCON[i / 4 - 1] << 24)) >>> 0;
    }
    ek[i] = (ek[i - 4] ^ t) >>> 0;
  }
  // Reverse round order and apply InvMixColumns to the middle round keys.
  const dk = new Uint32Array(44);
  for (let r = 0; r <= 10; r++) {
    for (let c = 0; c < 4; c++) {
      let w = ek[(10 - r) * 4 + c];
      if (r > 0 && r < 10) {
        w =
          (TD0[SBOX[w >>> 24]] ^
            TD1[SBOX[(w >>> 16) & 0xff]] ^
            TD2[SBOX[(w >>> 8) & 0xff]] ^
            TD3[SBOX[w & 0xff]]) >>>
          0;
      }
      dk[r * 4 + c] = w;
    }
  }
  return dk;
};

/**
 * Decrypts AES-128-CBC data and strips PKCS#7 padding.
 * `data` length must be a multiple of 16; key and iv are 16 bytes.
 */
export const aes128CbcDecrypt = (
  data: Uint8Array,
  key: Uint8Array,
  iv: Uint8Array,
): Uint8Array => {
  if (key.length !== 16 || iv.length !== 16) {
    throw new Error('AES-128 needs a 16 byte key and IV');
  }
  if (data.length === 0 || data.length % 16 !== 0) {
    throw new Error('Encrypted segment length is not a multiple of 16');
  }
  const dk = expandDecryptKey(key);
  const out = new Uint8Array(data.length);
  let p0 = ((iv[0] << 24) | (iv[1] << 16) | (iv[2] << 8) | iv[3]) >>> 0;
  let p1 = ((iv[4] << 24) | (iv[5] << 16) | (iv[6] << 8) | iv[7]) >>> 0;
  let p2 = ((iv[8] << 24) | (iv[9] << 16) | (iv[10] << 8) | iv[11]) >>> 0;
  let p3 = ((iv[12] << 24) | (iv[13] << 16) | (iv[14] << 8) | iv[15]) >>> 0;

  for (let off = 0; off < data.length; off += 16) {
    const c0 =
      ((data[off] << 24) |
        (data[off + 1] << 16) |
        (data[off + 2] << 8) |
        data[off + 3]) >>>
      0;
    const c1 =
      ((data[off + 4] << 24) |
        (data[off + 5] << 16) |
        (data[off + 6] << 8) |
        data[off + 7]) >>>
      0;
    const c2 =
      ((data[off + 8] << 24) |
        (data[off + 9] << 16) |
        (data[off + 10] << 8) |
        data[off + 11]) >>>
      0;
    const c3 =
      ((data[off + 12] << 24) |
        (data[off + 13] << 16) |
        (data[off + 14] << 8) |
        data[off + 15]) >>>
      0;

    let s0 = c0 ^ dk[0];
    let s1 = c1 ^ dk[1];
    let s2 = c2 ^ dk[2];
    let s3 = c3 ^ dk[3];
    let k = 4;
    for (let round = 1; round < 10; round++) {
      const t0 =
        TD0[s0 >>> 24] ^
        TD1[(s3 >>> 16) & 0xff] ^
        TD2[(s2 >>> 8) & 0xff] ^
        TD3[s1 & 0xff] ^
        dk[k];
      const t1 =
        TD0[s1 >>> 24] ^
        TD1[(s0 >>> 16) & 0xff] ^
        TD2[(s3 >>> 8) & 0xff] ^
        TD3[s2 & 0xff] ^
        dk[k + 1];
      const t2 =
        TD0[s2 >>> 24] ^
        TD1[(s1 >>> 16) & 0xff] ^
        TD2[(s0 >>> 8) & 0xff] ^
        TD3[s3 & 0xff] ^
        dk[k + 2];
      const t3 =
        TD0[s3 >>> 24] ^
        TD1[(s2 >>> 16) & 0xff] ^
        TD2[(s1 >>> 8) & 0xff] ^
        TD3[s0 & 0xff] ^
        dk[k + 3];
      s0 = t0 >>> 0;
      s1 = t1 >>> 0;
      s2 = t2 >>> 0;
      s3 = t3 >>> 0;
      k += 4;
    }
    // Final round: InvSubBytes + InvShiftRows + AddRoundKey.
    const o0 =
      ((INV_SBOX[s0 >>> 24] << 24) |
        (INV_SBOX[(s3 >>> 16) & 0xff] << 16) |
        (INV_SBOX[(s2 >>> 8) & 0xff] << 8) |
        INV_SBOX[s1 & 0xff]) ^
      dk[40];
    const o1 =
      ((INV_SBOX[s1 >>> 24] << 24) |
        (INV_SBOX[(s0 >>> 16) & 0xff] << 16) |
        (INV_SBOX[(s3 >>> 8) & 0xff] << 8) |
        INV_SBOX[s2 & 0xff]) ^
      dk[41];
    const o2 =
      ((INV_SBOX[s2 >>> 24] << 24) |
        (INV_SBOX[(s1 >>> 16) & 0xff] << 16) |
        (INV_SBOX[(s0 >>> 8) & 0xff] << 8) |
        INV_SBOX[s3 & 0xff]) ^
      dk[42];
    const o3 =
      ((INV_SBOX[s3 >>> 24] << 24) |
        (INV_SBOX[(s2 >>> 16) & 0xff] << 16) |
        (INV_SBOX[(s1 >>> 8) & 0xff] << 8) |
        INV_SBOX[s0 & 0xff]) ^
      dk[43];

    const r0 = (o0 ^ p0) >>> 0;
    const r1 = (o1 ^ p1) >>> 0;
    const r2 = (o2 ^ p2) >>> 0;
    const r3 = (o3 ^ p3) >>> 0;
    out[off] = r0 >>> 24;
    out[off + 1] = (r0 >>> 16) & 0xff;
    out[off + 2] = (r0 >>> 8) & 0xff;
    out[off + 3] = r0 & 0xff;
    out[off + 4] = r1 >>> 24;
    out[off + 5] = (r1 >>> 16) & 0xff;
    out[off + 6] = (r1 >>> 8) & 0xff;
    out[off + 7] = r1 & 0xff;
    out[off + 8] = r2 >>> 24;
    out[off + 9] = (r2 >>> 16) & 0xff;
    out[off + 10] = (r2 >>> 8) & 0xff;
    out[off + 11] = r2 & 0xff;
    out[off + 12] = r3 >>> 24;
    out[off + 13] = (r3 >>> 16) & 0xff;
    out[off + 14] = (r3 >>> 8) & 0xff;
    out[off + 15] = r3 & 0xff;
    p0 = c0;
    p1 = c1;
    p2 = c2;
    p3 = c3;
  }

  const pad = out[out.length - 1];
  if (pad < 1 || pad > 16) {
    // Some packagers omit padding; keep the data rather than fail.
    return out;
  }
  for (let i = out.length - pad; i < out.length; i++) {
    if (out[i] !== pad) {
      return out;
    }
  }
  return out.subarray(0, out.length - pad);
};

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP = new Uint8Array(128);
for (let i = 0; i < B64.length; i++) {
  B64_LOOKUP[B64.charCodeAt(i)] = i;
}

export const base64ToBytes = (b64: string): Uint8Array => {
  let len = b64.length;
  while (len > 0 && (b64[len - 1] === '=' || b64[len - 1] === '\n')) {
    len--;
  }
  const out = new Uint8Array(Math.floor((len * 3) / 4));
  let o = 0;
  for (let i = 0; i < len; i += 4) {
    const a = B64_LOOKUP[b64.charCodeAt(i)];
    const b = B64_LOOKUP[b64.charCodeAt(i + 1)];
    const c = i + 2 < len ? B64_LOOKUP[b64.charCodeAt(i + 2)] : 0;
    const d = i + 3 < len ? B64_LOOKUP[b64.charCodeAt(i + 3)] : 0;
    out[o++] = (a << 2) | (b >> 4);
    if (i + 2 < len) {
      out[o++] = ((b & 15) << 4) | (c >> 2);
    }
    if (i + 3 < len) {
      out[o++] = ((c & 3) << 6) | d;
    }
  }
  return out.subarray(0, o);
};

export const bytesToBase64 = (bytes: Uint8Array): string => {
  const parts: string[] = [];
  const CHUNK = 3 * 4096;
  for (let start = 0; start < bytes.length; start += CHUNK) {
    const end = Math.min(start + CHUNK, bytes.length);
    let s = '';
    let i = start;
    for (; i + 2 < end; i += 3) {
      const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
      s +=
        B64[n >> 18] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
    }
    if (i < end) {
      const rem = end - i;
      const n = (bytes[i] << 16) | ((rem > 1 ? bytes[i + 1] : 0) << 8);
      s += B64[n >> 18] + B64[(n >> 12) & 63];
      s += rem > 1 ? B64[(n >> 6) & 63] : '=';
      s += '=';
    }
    parts.push(s);
  }
  return parts.join('');
};

/** 16 byte IV from a hex string such as "0x00ab…" (left padded). */
export const ivFromHex = (hex: string): Uint8Array => {
  const clean = hex.replace(/^0x/i, '').padStart(32, '0').slice(-32);
  const iv = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    iv[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return iv;
};

/** Default HLS IV: the segment's media sequence number, big endian. */
export const ivFromSequence = (sequence: number): Uint8Array => {
  const iv = new Uint8Array(16);
  let n = sequence;
  for (let i = 15; i >= 8 && n > 0; i--) {
    iv[i] = n % 256;
    n = Math.floor(n / 256);
  }
  return iv;
};
