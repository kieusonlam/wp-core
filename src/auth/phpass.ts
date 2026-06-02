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

import phpass from 'phpass';
import bcrypt from 'bcryptjs';

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
  if (storedHash.startsWith('$2y$') || storedHash.startsWith('$2a$') || storedHash.startsWith('$2b$')) {
    // bcrypt — normalize $2y$ → $2a$ for bcryptjs (it doesn't accept $2y$ directly)
    const normalized = storedHash.replace(/^\$2y\$/, '$2a$');
    return bcrypt.compare(password, normalized);
  }
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

/** Hash a password using bcrypt (matches `wp_hash_password()` for WP ≥ 6.8). */
export async function hashBcrypt(password: string, rounds = 12): Promise<string> {
  const hash = await bcrypt.hash(password, rounds);
  // WordPress writes `$2y$` not `$2a$/$2b$`, so rewrite for max compatibility.
  return hash.replace(/^\$2[ab]\$/, '$2y$');
}
