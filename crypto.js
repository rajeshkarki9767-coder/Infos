// E2E encryption for sensitive data (currently: business passwords).
// Uses Web Crypto: PBKDF2 (250k iterations) → AES-GCM 256.
// The master password is never stored. Only a verifier hash is persisted
// so we can check the password without storing the password itself.
//
// Public API:
//   await Crypto.isAvailable()
//   Crypto.isEnabled(meta)        -> true if master password was set up
//   await Crypto.setup(masterPw)  -> returns { verifier, salt } to persist as crypto meta
//   await Crypto.verify(masterPw, meta) -> true/false
//   await Crypto.unlock(masterPw, meta) -> caches the derived key for the session
//   Crypto.isUnlocked()
//   Crypto.lock()
//   await Crypto.encrypt(plaintext) -> { ct, iv } base64-encoded
//   await Crypto.decrypt({ ct, iv }) -> plaintext, throws on bad key
(function() {
  const ITERATIONS = 250000;
  let sessionKey = null; // cached AES-GCM CryptoKey for this session

  function isAvailable() {
    return !!(window.crypto && window.crypto.subtle && window.TextEncoder);
  }

  function bytesToB64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }
  function b64ToBytes(b64) {
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  async function deriveKey(masterPw, saltBytes) {
    const enc = new TextEncoder();
    const baseKey = await crypto.subtle.importKey(
      'raw', enc.encode(masterPw), { name: 'PBKDF2' }, false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: saltBytes, iterations: ITERATIONS, hash: 'SHA-256' },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async function setup(masterPw) {
    if (!masterPw || masterPw.length < 6) throw new Error('Master password too short');
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKey(masterPw, salt);
    sessionKey = key;
    // Build a verifier: encrypt a known string with this key
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const enc = new TextEncoder();
    const ct = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      enc.encode('infos-v3-verifier')
    );
    return {
      salt: bytesToB64(salt),
      verifierIv: bytesToB64(iv),
      verifierCt: bytesToB64(new Uint8Array(ct))
    };
  }

  function isEnabled(meta) { return !!(meta && meta.salt && meta.verifierCt); }

  async function verify(masterPw, meta) {
    if (!isEnabled(meta)) return false;
    try {
      const salt = b64ToBytes(meta.salt);
      const key = await deriveKey(masterPw, salt);
      const iv = b64ToBytes(meta.verifierIv);
      const ct = b64ToBytes(meta.verifierCt);
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
      const str = new TextDecoder().decode(pt);
      return str === 'infos-v3-verifier';
    } catch { return false; }
  }

  async function unlock(masterPw, meta) {
    if (!isEnabled(meta)) throw new Error('Encryption not set up');
    const salt = b64ToBytes(meta.salt);
    const key = await deriveKey(masterPw, salt);
    // Verify before caching
    const iv = b64ToBytes(meta.verifierIv);
    const ct = b64ToBytes(meta.verifierCt);
    try {
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
      if (new TextDecoder().decode(pt) !== 'infos-v3-verifier') throw new Error('Wrong password');
      sessionKey = key;
      return true;
    } catch { throw new Error('Wrong master password'); }
  }

  function lock() { sessionKey = null; }
  function isUnlocked() { return !!sessionKey; }

  async function encrypt(plaintext) {
    if (!sessionKey) throw new Error('Locked — unlock first');
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const enc = new TextEncoder();
    const ct = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      sessionKey,
      enc.encode(plaintext)
    );
    return { ct: bytesToB64(new Uint8Array(ct)), iv: bytesToB64(iv) };
  }

  async function decrypt(blob) {
    if (!sessionKey) throw new Error('Locked — unlock first');
    const iv = b64ToBytes(blob.iv);
    const ct = b64ToBytes(blob.ct);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, sessionKey, ct);
    return new TextDecoder().decode(pt);
  }

  window.Crypto = { isAvailable, isEnabled, setup, verify, unlock, lock, isUnlocked, encrypt, decrypt };
})();
