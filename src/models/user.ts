/**
 * `User` — wraps `wp_users` + `wp_usermeta`.
 */

import { Op, type FindOptions, type WhereOptions, type Transaction } from 'sequelize';
import { getConnection, type WpConnection } from '../db.js';
import { getModels } from './register.js';
import { maybeSerialize, maybeUnserialize } from '../meta/serialization.js';
import { ModelNotFoundError, type MetaValue } from '../types.js';
import type { UserInstance, MetaInstance } from './schema.js';

export type UserMetaMap = Record<string, MetaValue>;

export class User {
  readonly raw: UserInstance;
  protected readonly conn: WpConnection;
  protected metaCache: UserMetaMap | null = null;

  constructor(raw: UserInstance, connection?: WpConnection) {
    this.raw = raw;
    this.conn = connection ?? getConnection();

    const includedMeta = (raw.get('meta') as MetaInstance[] | undefined) ?? undefined;
    if (Array.isArray(includedMeta)) {
      this.metaCache = {};
      for (const m of includedMeta) {
        const k = m.get('meta_key');
        if (typeof k !== 'string') continue;
        const dv = (m as unknown as { dataValues: Record<string, unknown> }).dataValues;
        this.metaCache[k] =
          dv.unserialized !== undefined ? (dv.unserialized as MetaValue) : (m.get('meta_value') as MetaValue);
      }
    }
  }

  get ID(): number {
    return this.raw.ID;
  }
  get id(): number {
    return this.raw.ID;
  }
  get login(): string {
    return this.raw.user_login;
  }
  get email(): string {
    return this.raw.user_email;
  }
  get displayName(): string {
    return this.raw.display_name;
  }
  get nicename(): string {
    return this.raw.user_nicename;
  }
  get url(): string {
    return this.raw.user_url;
  }
  get registered(): string {
    return this.raw.user_registered;
  }
  /** Hashed password (phpass). For checks use `Auth.attempt()`. */
  get passHash(): string {
    return this.raw.user_pass;
  }

  get meta(): UserMetaMap {
    if (!this.metaCache) {
      throw new Error(
        `User#${this.ID}.meta accessed without eager loading. Use User.query().withMeta() or user.getMetaAsync(key).`,
      );
    }
    return this.metaCache;
  }

  async getMetaAsync(key: string): Promise<MetaValue | undefined> {
    if (this.metaCache && key in this.metaCache) return this.metaCache[key];
    const { UserMeta } = getModels(this.conn);
    const row = await UserMeta.findOne({ where: { object_id: this.ID, meta_key: key } });
    if (!row) return undefined;
    const raw = row.get('meta_value');
    const v = typeof raw === 'string' ? maybeUnserialize(raw) : (raw as MetaValue);
    if (!this.metaCache) this.metaCache = {};
    this.metaCache[key] = v;
    return v;
  }

  async saveMeta(
    key: string,
    value: MetaValue,
    options: { transaction?: Transaction } = {},
  ): Promise<void> {
    this.conn.assertWritable('User.saveMeta');
    const { UserMeta } = getModels(this.conn);
    const existing = await UserMeta.findOne({
      where: { object_id: this.ID, meta_key: key },
      transaction: options.transaction,
    });
    if (existing) {
      existing.set('meta_value', maybeSerialize(value));
      await existing.save({ transaction: options.transaction });
    } else {
      await UserMeta.create(
        { object_id: this.ID, meta_key: key, meta_value: maybeSerialize(value) },
        { transaction: options.transaction },
      );
    }
    if (this.metaCache) this.metaCache[key] = value;
  }

  /**
   * Get the user's WP capabilities (from `${prefix}capabilities` meta).
   * Returns role names as keys, e.g. `{ administrator: true }`.
   */
  async capabilities(): Promise<Record<string, boolean>> {
    const key = `${this.conn.prefix}capabilities`;
    const caps = await this.getMetaAsync(key);
    return (caps as Record<string, boolean> | null) ?? {};
  }

  /** Convenience: returns the *first* role from the capabilities meta. */
  async role(): Promise<string | null> {
    const caps = await this.capabilities();
    const keys = Object.keys(caps);
    return keys.length > 0 ? keys[0] : null;
  }

  static async find(id: number, connection?: WpConnection): Promise<User | null> {
    const conn = connection ?? getConnection();
    const { User: UserModel } = getModels(conn);
    const row = await UserModel.findByPk(id);
    return row ? new User(row, conn) : null;
  }

  static async findOrFail(id: number, connection?: WpConnection): Promise<User> {
    const u = await User.find(id, connection);
    if (!u) throw new ModelNotFoundError('User', { id });
    return u;
  }

  static async findByLogin(login: string, connection?: WpConnection): Promise<User | null> {
    return User.findByCredential('user_login', login, connection);
  }

  static async findByEmail(email: string, connection?: WpConnection): Promise<User | null> {
    return User.findByCredential('user_email', email, connection);
  }

  /** Lookup by either login or email — used by auth login forms. */
  static async findByLoginOrEmail(value: string, connection?: WpConnection): Promise<User | null> {
    const conn = connection ?? getConnection();
    const { User: UserModel } = getModels(conn);
    const row = await UserModel.findOne({
      where: { [Op.or]: [{ user_login: value }, { user_email: value }] },
    });
    return row ? new User(row, conn) : null;
  }

  private static async findByCredential(
    column: 'user_login' | 'user_email',
    value: string,
    connection?: WpConnection,
  ): Promise<User | null> {
    const conn = connection ?? getConnection();
    const { User: UserModel } = getModels(conn);
    const row = await UserModel.findOne({ where: { [column]: value } as WhereOptions });
    return row ? new User(row, conn) : null;
  }

  static async all(
    options: FindOptions = {},
    connection?: WpConnection,
  ): Promise<User[]> {
    const conn = connection ?? getConnection();
    const { User: UserModel } = getModels(conn);
    const rows = await UserModel.findAll(options);
    return rows.map((r) => new User(r, conn));
  }

  static async create(
    attrs: Partial<UserInstance>,
    connection?: WpConnection,
  ): Promise<User> {
    const conn = connection ?? getConnection();
    conn.assertWritable('User.create');
    const { User: UserModel } = getModels(conn);
    const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const row = await UserModel.create({
      user_login: '',
      user_pass: '',
      user_nicename: '',
      user_email: '',
      user_url: '',
      user_registered: stamp,
      user_activation_key: '',
      user_status: 0,
      display_name: '',
      ...attrs,
    });
    return new User(row, conn);
  }
}
