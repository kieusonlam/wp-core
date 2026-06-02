/**
 * WordPress database connection — wraps Sequelize with WP-specific defaults
 * and registers all built-in models under a configurable table prefix.
 */

import { Sequelize } from 'sequelize';
// Static-import mysql2 so bundlers (Next.js webpack/turbopack) include it.
// Sequelize's default behavior is `require(dialect)` which dies inside a
// server bundle — passing `dialectModule` lets Sequelize skip that lookup.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import mysql2 from 'mysql2';
import { WriteForbiddenError, type WpConnectionConfig } from './types.js';

/**
 * A live WordPress database connection. Holds the underlying Sequelize
 * instance plus runtime config consumers need (table prefix, read-only flag).
 */
export interface WpConnection {
  /** Underlying Sequelize instance. */
  sequelize: Sequelize;
  /** Table prefix (e.g. `wp_`). */
  prefix: string;
  /** Whether writes are blocked. */
  readOnly: boolean;
  /** Resolve a table name with the prefix applied. */
  table(name: string): string;
  /** Throw `WriteForbiddenError` if read-only; no-op otherwise. */
  assertWritable(operation: string): void;
  /** Close the connection pool. */
  close(): Promise<void>;
}

/**
 * Active WP connection singleton. Most apps use a single DB; tests/multi-site
 * apps can call {@link connect} again to override.
 *
 * `null` until {@link connect} is called the first time.
 */
let active: WpConnection | null = null;

/**
 * Open a connection to the WordPress database. Returns a {@link WpConnection}
 * the caller can keep a handle to. The most recently-opened connection is
 * available via {@link getConnection}.
 *
 * @throws Error if `database` is missing.
 */
export function connect(config: WpConnectionConfig): WpConnection {
  if (!config.database) {
    throw new Error('connect(): "database" is required.');
  }

  const prefix = config.prefix ?? 'wp_';
  const dialect = config.dialect ?? 'mysql';

  const sequelize = new Sequelize({
    dialect,
    dialectModule: mysql2,
    host: config.host ?? 'localhost',
    port: config.port ?? 3306,
    username: config.user,
    password: config.password,
    database: config.database,
    logging: config.logging ?? false,
    dialectOptions: {
      // mysql2 charset — WP defaults to utf8mb4 since 4.2
      charset: config.charset ?? 'utf8mb4',
      // WordPress stores datetimes in MySQL local time, no zone info — make
      // sure mysql2 doesn't auto-convert.
      dateStrings: true,
      typeCast: true,
      multipleStatements: false,
    },
    pool: config.pool ?? { max: 10, min: 0, idle: 10000, acquire: 30000 },
    define: {
      // WP uses no Sequelize-style timestamps / paranoid soft-deletes
      timestamps: false,
      freezeTableName: true,
      underscored: false,
    },
    ...config.sequelizeOptions,
  });

  const connection: WpConnection = {
    sequelize,
    prefix,
    readOnly: config.readOnly ?? false,
    table(name: string) {
      return `${prefix}${name}`;
    },
    assertWritable(operation: string) {
      if (this.readOnly) throw new WriteForbiddenError(operation);
    },
    async close() {
      await sequelize.close();
      if (active === connection) active = null;
    },
  };

  active = connection;

  // Register models synchronously so callers can use Post/Page/etc immediately.
  // We import lazily to avoid module-init circular imports.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { registerModels } = require('./models/register.js') as typeof import('./models/register.js');
  registerModels(connection);

  return connection;
}

/**
 * Get the most recently opened connection, or throw if {@link connect} has
 * never been called. Used internally by static model methods like
 * `Post.find()` which don't take an explicit connection.
 */
export function getConnection(): WpConnection {
  if (!active) {
    throw new Error(
      'No active WordPress connection. Call connect({ ... }) before using models.',
    );
  }
  return active;
}

/**
 * Override the active connection. Useful for tests that swap in a sandbox DB.
 */
export function setConnection(conn: WpConnection | null): void {
  active = conn;
}
