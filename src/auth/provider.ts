/**
 * Pluggable auth user provider — verify WordPress user passwords.
 *
 * Usage:
 *   const auth = new AuthUserProvider();
 *   const user = await auth.attempt({ identifier: 'editor', password: 'secret' });
 *
 * The default looks users up by `user_login` OR `user_email`, then verifies
 * the password with phpass/bcrypt. Subclass to plug in custom lookup logic.
 */

import { User } from '../models/user.js';
import { hashBcrypt, hashPhpass, verify } from './phpass.js';
import type { WpConnection } from '../db.js';

export interface AuthCredentials {
  /** Username or email. */
  identifier: string;
  /** Plaintext password. */
  password: string;
}

export class AuthUserProvider {
  protected readonly connection?: WpConnection;

  constructor(options: { connection?: WpConnection } = {}) {
    this.connection = options.connection;
  }

  /** Look up a user by their primary key. */
  async retrieveById(id: number): Promise<User | null> {
    return User.find(id, this.connection);
  }

  /** Look up by username or email. */
  async retrieveByCredentials(creds: { identifier: string }): Promise<User | null> {
    return User.findByLoginOrEmail(creds.identifier, this.connection);
  }

  /** Verify a candidate user's password against the stored hash. */
  async validateCredentials(user: User, password: string): Promise<boolean> {
    return verify(password, user.passHash);
  }

  /**
   * One-shot login attempt — retrieve + validate.
   * Returns the user on success, `null` on bad credentials.
   */
  async attempt(creds: AuthCredentials): Promise<User | null> {
    const user = await this.retrieveByCredentials({ identifier: creds.identifier });
    if (!user) return null;
    const ok = await this.validateCredentials(user, creds.password);
    return ok ? user : null;
  }

  /** Update a user's password, hashing with the modern bcrypt algorithm. */
  async setPassword(user: User, plaintext: string): Promise<void> {
    const hash = await hashBcrypt(plaintext);
    user.raw.set('user_pass', hash);
    await user.raw.save();
  }

  /** Legacy: phpass-hash a password (for WP < 6.8 compatibility). */
  static hashLegacy(plaintext: string): Promise<string> {
    return hashPhpass(plaintext);
  }

  /** Modern: bcrypt-hash a password (matches WP ≥ 6.8). */
  static hash(plaintext: string): Promise<string> {
    return hashBcrypt(plaintext);
  }
}
