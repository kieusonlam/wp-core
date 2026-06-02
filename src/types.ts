/**
 * Public TypeScript types for @kieusonlam/wp-core.
 */

import type { Dialect, Options as SequelizeOptions } from 'sequelize';

/**
 * Database connection config. Maps to WordPress's wp-config.php constants.
 */
export interface WpConnectionConfig {
  /** Database hostname (defaults to `localhost`). */
  host?: string;
  /** Database port (defaults to `3306`). */
  port?: number;
  /** Database username. */
  user: string;
  /** Database password (may be empty for local dev). */
  password: string;
  /** Database name. */
  database: string;
  /** Table prefix (e.g. `wp_`). Defaults to `wp_`. */
  prefix?: string;
  /** Database charset (e.g. `utf8mb4`). Defaults to `utf8mb4`. */
  charset?: string;
  /** Database dialect. Defaults to `mysql` — supports `mariadb` too. */
  dialect?: Extract<Dialect, 'mysql' | 'mariadb'>;
  /** When true, all write operations throw a `WriteForbiddenError`. */
  readOnly?: boolean;
  /** Sequelize logging — `false`/`undefined` to disable, function for custom. */
  logging?: SequelizeOptions['logging'];
  /** Connection pool config. */
  pool?: SequelizeOptions['pool'];
  /** Extra Sequelize options merged after the WP defaults. */
  sequelizeOptions?: Partial<SequelizeOptions>;
}

/**
 * WordPress post statuses (the standard set; custom statuses are also allowed).
 */
export type PostStatus =
  | 'publish'
  | 'pending'
  | 'draft'
  | 'auto-draft'
  | 'future'
  | 'private'
  | 'inherit'
  | 'trash'
  | string;

/**
 * Standard WordPress post types. Additional CPTs are allowed (string).
 */
export type PostType =
  | 'post'
  | 'page'
  | 'attachment'
  | 'revision'
  | 'nav_menu_item'
  | 'custom_css'
  | 'customize_changeset'
  | 'oembed_cache'
  | 'user_request'
  | 'wp_block'
  | 'wp_template'
  | 'wp_template_part'
  | 'wp_global_styles'
  | 'wp_navigation'
  | 'acf-field-group'
  | 'acf-field'
  | 'product'
  | 'product_variation'
  | 'shop_order'
  | 'shop_coupon'
  | string;

/**
 * A WordPress comparison operator (used by meta scopes).
 */
export type MetaCompareOp =
  | '='
  | '!='
  | '>'
  | '>='
  | '<'
  | '<='
  | 'LIKE'
  | 'NOT LIKE'
  | 'IN'
  | 'NOT IN'
  | 'BETWEEN'
  | 'NOT BETWEEN'
  | 'EXISTS'
  | 'NOT EXISTS'
  | 'REGEXP'
  | 'NOT REGEXP'
  | 'RLIKE';

/**
 * Any value that may be stored in a WP meta row — JSON-compatible with
 * PHP-specific extensions (Date for MySQL DATETIME, undefined → NULL).
 */
export type MetaValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Date
  | MetaValue[]
  | { [key: string]: MetaValue };

/**
 * Thrown when a write is attempted while the connection is in read-only mode.
 */
export class WriteForbiddenError extends Error {
  constructor(operation: string) {
    super(`Write operation "${operation}" is forbidden — the connection is in read-only mode.`);
    this.name = 'WriteForbiddenError';
  }
}

/**
 * Thrown when a queried row is not found and `orFail()` was requested.
 */
export class ModelNotFoundError extends Error {
  constructor(model: string, query?: unknown) {
    super(
      `${model} not found${
        query !== undefined ? ` (query: ${JSON.stringify(query)})` : ''
      }.`,
    );
    this.name = 'ModelNotFoundError';
  }
}
