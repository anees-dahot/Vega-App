// Simple stand-ins; tests do not check real cryptography.
module.exports = {
  __esModule: true,
  CryptoDigestAlgorithm: {
    SHA1: 'SHA-1',
    SHA256: 'SHA-256',
    SHA384: 'SHA-384',
    SHA512: 'SHA-512',
    MD5: 'MD5',
  },
  CryptoEncoding: {HEX: 'hex', BASE64: 'base64'},
  randomUUID: () => '00000000-0000-4000-8000-000000000000',
  getRandomBytes: length => new Uint8Array(length),
  getRandomBytesAsync: async length => new Uint8Array(length),
  // A stand-in hash: different input gives different output, and the input
  // cannot be read back from it.
  digestStringAsync: async (_algorithm, data) => {
    let hash = 5381;
    for (let i = 0; i < data.length; i += 1) {
      hash = ((hash << 5) + hash + data.charCodeAt(i)) | 0;
    }
    return `hash-${(hash >>> 0).toString(16)}`;
  },
  digest: async () => new ArrayBuffer(0),
};
