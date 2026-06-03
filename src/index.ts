/**
 * @kieusonlam/wp-core — Sequelize-based ORM for the WordPress database.
 *
 * Quickstart:
 *
 *   import { connect, Post, Page, Option } from '@kieusonlam/wp-core';
 *
 *   connect({
 *     host: '127.0.0.1', port: 3307,
 *     user: 'root', password: '',
 *     database: 'www.potech.com.vn', prefix: 'wp_',
 *   });
 *
 *   const siteurl = await Option.get('siteurl');
 *   const latest  = await Post.published().newest().withMeta().limit(5).all();
 *   const about   = await Page.slug('about').first();
 */

export * from './types.js';
export * from './db.js';
export * from './meta/serialization.js';
export * from './models/index.js';
export { AuthUserProvider } from './auth/provider.js';
export type { AuthCredentials } from './auth/provider.js';
export { verify, hashBcrypt, hashPhpass } from './auth/phpass.js';
export {
  ShortcodeRegistry,
  parseAttributes,
  doShortcode,
  shortcodes,
} from './shortcodes/index.js';
export type { ShortcodeHandler, ShortcodeAttrs } from './shortcodes/index.js';

// Re-export Sequelize's operator object as the escape hatch for raw `.where()`
// conditions the fluent API doesn't cover (e.g. LIKE / OR). Consumers should
// import `Op` from here instead of `sequelize` directly: that drops the need for
// a separate sequelize dependency AND guarantees the same Sequelize instance the
// models use (a second copy makes `Op` symbols mismatch → conditions silently
// dropped).
export { Op } from 'sequelize';
export type { WhereOptions } from 'sequelize';
