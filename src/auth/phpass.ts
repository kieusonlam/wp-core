/**
 * WordPress phpass (Portable PHP password hashing) verifier.
 *
 * WordPress stores password hashes as either:
 *   - phpass:   `$P$BvX...` (legacy / default)
 *   - bcrypt:   `$2y$10$...` (WP ≥ 6.8)
 *
 * `verify(password, storedHash)` returns true iff the password matches.
 *
 * We use the `phpass` npm package for the phpass case and `bcryptjs` for
 * bcrypt. Both are pure-JS so they work in any Node environment without
 * native build steps.
 */

import { createHmac } from 'node:crypto';
import phpass from 'phpass';
import bcrypt from 'bcryptjs';

/**
 * WP ≥ 6.8 pre-hash: bcrypt has a 72-byte limit and chokes on null bytes, so
 * WordPress first HMAC-SHA384s the (trimmed) password with the key `wp-sha384`
 * and base64-encodes it, then bcrypts that. Matches `wp_hash_password()`.
 */
function wpSha384Prehash(password: string): string {
  return createHmac('sha384', 'wp-sha384').update(password.trim()).digest('base64');
}

/** Async-friendly wrapper around phpass' callback API. */
function phpassCheck(password: string, hash: string): Promise<boolean> {
  return new Promise((resolve) => {
    const verifier = new phpass.PasswordHash();
    verifier.checkPassword(password, hash, (err, ok) => {
      if (err) resolve(false);
      else resolve(Boolean(ok));
    });
  });
}

/**
 * Verify a plaintext password against a WordPress-stored hash. Handles both
 * phpass and bcrypt formats automatically.
 */
export async function verify(password: string, storedHash: string): Promise<boolean> {
  if (!storedHash) return false;
  // WP ≥ 6.8 bcrypt: `$wp$2y$...` = bcrypt(base64(hmac_sha384(password,'wp-sha384'))).
  // Strip the `$wp` prefix, normalize $2y$→$2a$ for bcryptjs, compare the pre-hash.
  if (storedHash.startsWith('$wp$')) {
    const bc = storedHash.slice(3).replace(/^\$2y\$/, '$2a$');
    return bcrypt.compare(wpSha384Prehash(password), bc);
  }
  // Raw bcrypt (some setups store without the WP wrapper).
  if (storedHash.startsWith('$2y$') || storedHash.startsWith('$2a$') || storedHash.startsWith('$2b$')) {
    return bcrypt.compare(password, storedHash.replace(/^\$2y\$/, '$2a$'));
  }
  // Legacy phpass portable hashes (`$P$...` / `$H$...`).
  return phpassCheck(password, storedHash);
}

/**
 * Hash a password using phpass (matches `wp_hash_password()` for WP < 6.8).
 */
export function hashPhpass(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hasher = new phpass.PasswordHash();
    hasher.hashPassword(password, (err: Error | null, hash: string) => {
      if (err) reject(err);
      else resolve(hash);
    });
  });
}

/** Hash a password the WP ≥ 6.8 way: `$wp$` + bcrypt(base64(hmac_sha384(password))). */
export async function hashBcrypt(password: string, rounds = 12): Promise<string> {
  const hash = await bcrypt.hash(wpSha384Prehash(password), rounds);
  // WordPress writes `$2y$` (not `$2a$/$2b$`) and prefixes with `$wp`.
  return '$wp' + hash.replace(/^\$2[ab]\$/, '$2y$');
}
