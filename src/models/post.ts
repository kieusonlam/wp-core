/**
 * The `Post` class — primary WordPress entity (`wp_posts`).
 *
 * Wraps the raw Sequelize WpPost model with WP-specific scopes
 * (`published`, `type`, `slug`, `taxonomy`, `hasMeta`...) and a meta accessor
 * proxy so `post.meta.foo` returns the (PHP-unserialized) value of postmeta
 * key `foo`.
 *
 * Static API:
 *   - `Post.find(id)` / `Post.findOrFail(id)`
 *   - `Post.published()` / `Post.type(t)` / `Post.slug(s)` → chainable query
 *   - `Post.where({...}).all()` / `.first()` / `.count()` / `.paginate(perPage, page)`
 *
 * Instance API:
 *   - `post.meta.foo` (proxy, sync read after eager-load)
 *   - `post.getMeta(key)` / `post.getMetaAsync(key)`
 *   - `post.saveMeta(key, value)` / `post.deleteMeta(key)`
 *   - `post.title` / `post.content` / `post.slug` — aliases to post_title/etc.
 *   - `post.taxonomies` → loaded TermTaxonomy[] with eager `term`
 *   - `post.thumbnail` → loaded Attachment from `_thumbnail_id` meta
 */

import {
  Op,
  literal,
  type FindOptions,
  type WhereOptions,
  type Order,
  type IncludeOptions,
  type Transaction,
} from 'sequelize';
import { getConnection, type WpConnection } from '../db.js';
import { getModels } from './register.js';
import { maybeSerialize, maybeUnserialize } from '../meta/serialization.js';
import {
  ModelNotFoundError,
  type MetaCompareOp,
  type MetaValue,
  type PostStatus,
} from '../types.js';
import type { PostInstance, MetaInstance, TermTaxonomyInstance } from './schema.js';

// ----------------------------------------------------------------------------
// Field aliases — `post.title` reads `post_title`, etc. Configurable globally.
// ----------------------------------------------------------------------------
export const DEFAULT_POST_ALIASES: Record<string, keyof PostInstance> = {
  id: 'ID',
  title: 'post_title',
  content: 'post_content',
  excerpt: 'post_excerpt',
  slug: 'post_name',
  status: 'post_status',
  type: 'post_type',
  date: 'post_date',
  modified: 'post_modified',
  author: 'post_author',
  parent: 'post_parent',
  menuOrder: 'menu_order',
  mimeType: 'post_mime_type',
  commentCount: 'comment_count',
  commentStatus: 'comment_status',
  pingStatus: 'ping_status',
  password: 'post_password',
};

let globalAliases: Record<string, keyof PostInstance> = { ...DEFAULT_POST_ALIASES };

/** Override the default aliases (e.g. to add custom names). */
export function setPostAliases(aliases: Record<string, keyof PostInstance>): void {
  globalAliases = { ...DEFAULT_POST_ALIASES, ...aliases };
}

// ----------------------------------------------------------------------------
// Query builder
// ----------------------------------------------------------------------------

/** A chainable, lazy WordPress post query. */
export class PostQuery<T extends Post = Post> {
  protected readonly conn: WpConnection;
  protected readonly options: FindOptions = {};
  protected readonly wheres: WhereOptions[] = [];
  protected readonly metaWheres: Array<{ key: string; value?: MetaValue; op: MetaCompareOp }> = [];
  protected readonly _includes: IncludeOptions[] = [];
  protected readonly _order: Order = [];
  protected readonly factory: (raw: PostInstance, conn: WpConnection) => T;
  protected readonly defaultType: string | null;
  /**
   * Set true by `.taxonomy()` — the belongsToMany filter through term_relationships
   * is incompatible with Sequelize's default subQuery wrapping when LIMIT is also
   * applied (results in `Unknown column 'taxonomies.term_id' in 'on clause'`).
   * We disable subQuery wrapping in buildFindOptions when this flag is set.
   */
  protected _disableSubQuery = false;

  constructor(
    factory: (raw: PostInstance, conn: WpConnection) => T,
    options: { defaultType?: string; connection?: WpConnection } = {},
  ) {
    this.conn = options.connection ?? getConnection();
    this.factory = factory;
    this.defaultType = options.defaultType ?? null;
  }

  /** Add a raw `where` clause (Sequelize syntax). */
  where(condition: WhereOptions): this {
    this.wheres.push(condition);
    return this;
  }

  /**
   * Filter where `column` is IN `values` (`WHERE column IN (...)`).
   * An empty array matches nothing (Sequelize emits `IN (NULL)`).
   */
  whereIn(column: string, values: ReadonlyArray<string | number>): this {
    return this.where({ [column]: { [Op.in]: [...values] } } as WhereOptions);
  }

  /**
   * Filter where `column` is NOT IN `values` (`WHERE column NOT IN (...)`).
   * An empty array is a no-op (excludes nothing) — this avoids the SQL
   * `NOT IN (NULL)` gotcha, which would otherwise match zero rows.
   */
  whereNotIn(column: string, values: ReadonlyArray<string | number>): this {
    if (values.length === 0) return this;
    return this.where({ [column]: { [Op.notIn]: [...values] } } as WhereOptions);
  }

  /** Filter by `post_status`. */
  status(status: PostStatus | PostStatus[]): this {
    return this.where({
      post_status: Array.isArray(status) ? { [Op.in]: status } : status,
    });
  }

  /** Only published posts (`post_status = 'publish'`). */
  published(): this {
    return this.status('publish');
  }

  /** Filter by `post_type`. */
  type(type: string | string[]): this {
    return this.where({
      post_type: Array.isArray(type) ? { [Op.in]: type } : type,
    });
  }

  /** Filter by `post_name` (slug). */
  slug(slug: string): this {
    return this.where({ post_name: slug });
  }

  /** Filter by post parent ID. */
  parent(id: number): this {
    return this.where({ post_parent: id });
  }

  /** Filter posts that have a meta row matching the given key + value. */
  hasMeta(key: string, value?: MetaValue, op: MetaCompareOp = '='): this {
    this.metaWheres.push({ key, value, op });
    return this;
  }

  /** Convenience: case-insensitive LIKE on a meta value. */
  hasMetaLike(key: string, value: string): this {
    return this.hasMeta(key, `%${value}%`, 'LIKE');
  }

  /** Filter posts attached to a given term in a given taxonomy. */
  taxonomy(taxonomy: string, term: string | string[] | number): this {
    const { TermTaxonomy, Term } = getModels(this.conn);
    const termWhere =
      typeof term === 'number'
        ? { term_id: term }
        : { slug: Array.isArray(term) ? { [Op.in]: term } : term };
    this._includes.push({
      model: TermTaxonomy,
      as: 'taxonomies',
      where: { taxonomy },
      required: true,
      include: [{ model: Term, as: 'term', where: termWhere, required: true }],
    });
    // belongsToMany + limit triggers a buggy subQuery wrap in Sequelize. See
    // `_disableSubQuery` doc above.
    this._disableSubQuery = true;
    return this;
  }

  /** Sort by date descending (newest first). */
  newest(): this {
    (this._order as Array<[string, 'ASC' | 'DESC']>).push(['post_date', 'DESC']);
    return this;
  }

  /** Sort by date ascending (oldest first). */
  oldest(): this {
    (this._order as Array<[string, 'ASC' | 'DESC']>).push(['post_date', 'ASC']);
    return this;
  }

  /** Sort by an arbitrary column. */
  orderBy(column: string, direction: 'ASC' | 'DESC' = 'ASC'): this {
    (this._order as Array<[string, 'ASC' | 'DESC']>).push([column, direction]);
    return this;
  }

  /** Limit number of rows. */
  limit(n: number): this {
    this.options.limit = n;
    return this;
  }

  /** Offset rows. */
  offset(n: number): this {
    this.options.offset = n;
    return this;
  }

  /**
   * Exclude heavy columns from the SELECT — drops `post_content`,
   * `post_content_filtered`, `post_excerpt`, `to_ping`, `pinged`,
   * `post_password`, `guid`.
   *
   * Use this for list / catalog / index queries where the UI only renders
   * title + slug + thumbnail + a few meta. Cuts payload by 5-50KB per row
   * which is the difference between 300ms and 30ms on a catalog with 30
   * products. Do NOT use on detail-page queries — `post.content` and
   * `.excerpt` will be empty.
   */
  minimal(): this {
    this.options.attributes = {
      exclude: [
        'post_content',
        'post_content_filtered',
        'post_excerpt',
        'to_ping',
        'pinged',
        'post_password',
        'guid',
      ],
    };
    return this;
  }

  /**
   * Override the SELECT column list directly. Use this for surgical control
   * when `.minimal()` is too aggressive.
   *
   * @example
   *   Post.query().select(['ID', 'post_title', 'post_name']).all()
   */
  select(columns: ReadonlyArray<keyof PostInstance>): this {
    this.options.attributes = [...columns] as string[];
    return this;
  }

  /**
   * Eager-load post meta.
   *
   * Uses `separate: true` — Sequelize issues a second query against
   * `wp_postmeta` keyed by the parent post IDs, instead of a LEFT JOIN.
   * This avoids cartesian-product blowup (N posts × M meta rows × …) that
   * makes catalog-style queries hundreds-of-ms slow even on small tables.
   */
  withMeta(): this {
    const { PostMeta } = getModels(this.conn);
    this._includes.push({ model: PostMeta, as: 'meta', separate: true });
    return this;
  }

  /** Eager-load author user. */
  withAuthor(): this {
    const { User } = getModels(this.conn);
    this._includes.push({ model: User, as: 'author' });
    return this;
  }

  /**
   * Eager-load taxonomies + terms (e.g. categories, tags) for *display*.
   * This is a LEFT JOIN — posts without matching taxonomies are still
   * returned. For filtering posts down to those that *have* a specific
   * taxonomy/term, use `.taxonomy(name, term)` instead.
   */
  withTaxonomies(taxonomy?: string | string[]): this {
    const { TermTaxonomy, Term } = getModels(this.conn);
    this._includes.push({
      model: TermTaxonomy,
      as: 'taxonomies',
      required: false,
      ...(taxonomy
        ? {
            where: {
              taxonomy: Array.isArray(taxonomy) ? { [Op.in]: taxonomy } : taxonomy,
            },
          }
        : {}),
      include: [{ model: Term, as: 'term' }],
    });
    return this;
  }

  // ----- terminal operations ----------------------------------------------

  protected buildFindOptions(): FindOptions {
    const baseWhere: WhereOptions = {};
    if (this.defaultType && !this.wheres.some((w) => 'post_type' in (w as Record<string, unknown>))) {
      Object.assign(baseWhere, { post_type: this.defaultType });
    }
    for (const w of this.wheres) Object.assign(baseWhere, w);

    // Meta filters → uncorrelated `ID IN (subquery on postmeta)` so they compose
    // with `.withMeta()`, which eager-loads the full `meta` association. Using a
    // joined `as: 'meta'` include here would collide with withMeta's include
    // (same Sequelize alias) and clobber the loaded meta down to just the
    // filtered key — leaving every other meta value empty. The subquery is
    // self-contained (no outer correlation); only the `ID` key is qualified by
    // Sequelize. Values are escaped via sequelize.escape.
    let where: WhereOptions = baseWhere;
    if (this.metaWheres.length > 0) {
      const metaTable = this.conn.table('postmeta');
      const esc = (v: unknown): string => this.conn.sequelize.escape(v as string);
      const SQL_OP: Partial<Record<MetaCompareOp, string>> = {
        '=': '=',
        '!=': '!=',
        '>': '>',
        '>=': '>=',
        '<': '<',
        '<=': '<=',
        LIKE: 'LIKE',
        'NOT LIKE': 'NOT LIKE',
        REGEXP: 'REGEXP',
        'NOT REGEXP': 'NOT REGEXP',
        RLIKE: 'REGEXP',
      };
      const conds = this.metaWheres.map((m): WhereOptions => {
        let valueSql = '';
        if (m.value !== undefined) {
          if (m.op === 'IN' || m.op === 'NOT IN') {
            valueSql = ` AND \`meta_value\` ${m.op} (${(m.value as unknown[]).map(esc).join(', ')})`;
          } else if (m.op === 'BETWEEN' || m.op === 'NOT BETWEEN') {
            const [a, b] = m.value as [unknown, unknown];
            valueSql = ` AND \`meta_value\` ${m.op} ${esc(a)} AND ${esc(b)}`;
          } else {
            valueSql = ` AND \`meta_value\` ${SQL_OP[m.op] ?? '='} ${esc(m.value)}`;
          }
        }
        const sub = literal(
          `(SELECT \`post_id\` FROM \`${metaTable}\` WHERE \`meta_key\` = ${esc(m.key)}${valueSql})`,
        );
        const negate = m.op === 'NOT EXISTS' && m.value === undefined;
        return { ID: { [negate ? Op.notIn : Op.in]: sub } } as WhereOptions;
      });
      where = { [Op.and]: [baseWhere, ...conds] };
    }

    return {
      ...this.options,
      where,
      include: this._includes.length > 0 ? this._includes : undefined,
      order: (this._order as Array<[string, 'ASC' | 'DESC']>).length > 0 ? this._order : undefined,
      ...(this._disableSubQuery ? { subQuery: false } : {}),
    };
  }

  /** Execute the query and return all matching rows. */
  async all(): Promise<T[]> {
    const { Post: PostModel } = getModels(this.conn);
    const rows = await PostModel.findAll(this.buildFindOptions());
    return rows.map((r) => this.factory(r, this.conn));
  }

  /** Execute the query and return the first matching row, or `null`. */
  async first(): Promise<T | null> {
    const { Post: PostModel } = getModels(this.conn);
    const row = await PostModel.findOne(this.buildFindOptions());
    return row ? this.factory(row, this.conn) : null;
  }

  /** Like `first()` but throws `ModelNotFoundError` when empty. */
  async firstOrFail(): Promise<T> {
    const r = await this.first();
    if (!r) throw new ModelNotFoundError('Post', this.buildFindOptions().where);
    return r;
  }

  /** Count matching rows. */
  async count(): Promise<number> {
    const { Post: PostModel } = getModels(this.conn);
    return PostModel.count(this.buildFindOptions());
  }

  /** Paginate. Returns `{ data, total, page, perPage, lastPage }`. */
  async paginate(
    perPage = 15,
    page = 1,
  ): Promise<{ data: T[]; total: number; page: number; perPage: number; lastPage: number }> {
    const offset = (page - 1) * perPage;
    const total = await this.count();
    const { Post: PostModel } = getModels(this.conn);
    const rows = await PostModel.findAll({
      ...this.buildFindOptions(),
      limit: perPage,
      offset,
    });
    return {
      data: rows.map((r) => this.factory(r, this.conn)),
      total,
      page,
      perPage,
      lastPage: Math.max(1, Math.ceil(total / perPage)),
    };
  }
}

// ----------------------------------------------------------------------------
// The user-facing Post class
// ----------------------------------------------------------------------------

/** Eager-loaded meta as a plain `Record<key, value>` keyed by meta_key. */
export type MetaMap = Record<string, MetaValue>;

/**
 * High-level WordPress post wrapper. Construct from a raw Sequelize instance
 * (via {@link Post.find} / {@link Post.query}) — don't `new` directly except
 * in subclasses or tests.
 */
export class Post {
  /** Raw Sequelize instance — escape hatch for custom queries. */
  readonly raw: PostInstance;
  protected readonly conn: WpConnection;
  /** Cached deserialized meta, keyed by meta_key. Populated lazily / via eager. */
  protected metaCache: MetaMap | null = null;

  /**
   * Subclasses set this to scope all queries to a specific post_type
   * (e.g. `Page extends Post { static defaultType = 'page' }`).
   */
  static defaultType: string | null = null;

  constructor(raw: PostInstance, connection?: WpConnection) {
    this.raw = raw;
    this.conn = connection ?? getConnection();

    // Eagerly hydrate metaCache if `meta` was included
    const includedMeta = (raw.get('meta') as MetaInstance[] | undefined) ?? undefined;
    if (Array.isArray(includedMeta)) {
      this.metaCache = {};
      for (const m of includedMeta) {
        const k = m.get('meta_key');
        if (typeof k !== 'string') continue;
        const dv = (m as unknown as { dataValues: Record<string, unknown> }).dataValues;
        const v =
          dv.unserialized !== undefined ? (dv.unserialized as MetaValue) : (m.get('meta_value') as MetaValue);
        this.metaCache[k] = v;
      }
    }
  }

  // --- column accessors via aliases ----------------------------------------
  // Getters return '' (or 0) when a column was excluded via .minimal() /
  // .select() so callers don't crash on `post.content.slice(...)`.
  get ID(): number {
    return this.raw.ID;
  }
  get id(): number {
    return this.raw.ID;
  }
  get title(): string {
    return this.raw.post_title ?? '';
  }
  get content(): string {
    return this.raw.post_content ?? '';
  }
  get excerpt(): string {
    return this.raw.post_excerpt ?? '';
  }
  get slug(): string {
    return this.raw.post_name;
  }
  get status(): string {
    return this.raw.post_status;
  }
  get type(): string {
    return this.raw.post_type;
  }
  get date(): string {
    return this.raw.post_date;
  }
  get modified(): string {
    return this.raw.post_modified;
  }
  get parentId(): number {
    return this.raw.post_parent;
  }
  get authorId(): number {
    return this.raw.post_author;
  }
  get menuOrder(): number {
    return this.raw.menu_order;
  }
  get mimeType(): string {
    return this.raw.post_mime_type;
  }
  get commentCount(): number {
    return this.raw.comment_count;
  }

  // --- meta access ---------------------------------------------------------

  /**
   * Eager-loaded meta as a plain object. Throws if meta wasn't included in
   * the original query — use `getMetaAsync` for lazy access.
   */
  get meta(): MetaMap {
    if (!this.metaCache) {
      throw new Error(
        `Post#${this.ID}.meta accessed without eager loading. Use .withMeta() in the query or post.getMetaAsync(key).`,
      );
    }
    return this.metaCache;
  }

  /** Synonym for `meta`. */
  get fields(): MetaMap {
    return this.meta;
  }

  /**
   * Synchronous meta read after eager load. Returns `undefined` if not set.
   */
  getMeta(key: string): MetaValue | undefined {
    return this.meta[key];
  }

  /** Lazy async meta read. Triggers a query if not in cache. */
  async getMetaAsync(key: string): Promise<MetaValue | undefined> {
    if (this.metaCache && key in this.metaCache) return this.metaCache[key];
    const { PostMeta } = getModels(this.conn);
    const row = await PostMeta.findOne({ where: { object_id: this.ID, meta_key: key } });
    if (!row) return undefined;
    const raw = row.get('meta_value');
    const decoded = typeof raw === 'string' ? maybeUnserialize(raw) : (raw as MetaValue);
    if (!this.metaCache) this.metaCache = {};
    this.metaCache[key] = decoded;
    return decoded;
  }

  /** Insert or update a single meta row. Throws if connection is read-only. */
  async saveMeta(key: string, value: MetaValue, options: { transaction?: Transaction } = {}): Promise<void> {
    this.conn.assertWritable('Post.saveMeta');
    const { PostMeta } = getModels(this.conn);
    const serialized = maybeSerialize(value);
    const existing = await PostMeta.findOne({
      where: { object_id: this.ID, meta_key: key },
      transaction: options.transaction,
    });
    if (existing) {
      existing.set('meta_value', serialized);
      await existing.save({ transaction: options.transaction });
    } else {
      await PostMeta.create(
        { object_id: this.ID, meta_key: key, meta_value: serialized },
        { transaction: options.transaction },
      );
    }
    if (this.metaCache) this.metaCache[key] = value;
  }

  /** Create a new meta row (allows duplicate keys for multi-value meta). */
  async createMeta(key: string, value: MetaValue, options: { transaction?: Transaction } = {}): Promise<void> {
    this.conn.assertWritable('Post.createMeta');
    const { PostMeta } = getModels(this.conn);
    await PostMeta.create(
      { object_id: this.ID, meta_key: key, meta_value: maybeSerialize(value) },
      { transaction: options.transaction },
    );
  }

  /**
   * Save an ACF field — writes both the value row and the `_field_key`
   * pointer row that ACF expects. The pointer's value is `fieldKey`
   * (typically `field_XXXXXXXX`). Required for ACF's lookup to work.
   */
  async saveField(
    fieldName: string,
    value: MetaValue,
    fieldKey: string,
    options: { transaction?: Transaction } = {},
  ): Promise<void> {
    this.conn.assertWritable('Post.saveField');
    await this.saveMeta(fieldName, value, options);
    await this.saveMeta(`_${fieldName}`, fieldKey, options);
  }

  /** Delete a meta row by key. Returns the number of deleted rows. */
  async deleteMeta(key: string, options: { transaction?: Transaction } = {}): Promise<number> {
    this.conn.assertWritable('Post.deleteMeta');
    const { PostMeta } = getModels(this.conn);
    const deleted = await PostMeta.destroy({
      where: { object_id: this.ID, meta_key: key },
      transaction: options.transaction,
    });
    if (this.metaCache) delete this.metaCache[key];
    return deleted;
  }

  // --- relations -----------------------------------------------------------

  /** Eager-loaded taxonomies (when query used `.withTaxonomies()`). */
  get taxonomies(): TermTaxonomyInstance[] {
    return (this.raw.get('taxonomies') as TermTaxonomyInstance[] | undefined) ?? [];
  }

  /** Get the thumbnail attachment (resolves `_thumbnail_id` meta → Post). */
  async thumbnail(): Promise<Post | null> {
    const thumbId = await this.getMetaAsync('_thumbnail_id');
    if (typeof thumbId !== 'string' && typeof thumbId !== 'number') return null;
    const id = typeof thumbId === 'string' ? parseInt(thumbId, 10) : thumbId;
    if (!id) return null;
    return Post.find(id);
  }

  // --- save / update / delete ---------------------------------------------

  /** Persist changes to `wp_posts`. Updates `post_modified*` automatically. */
  async save(options: { transaction?: Transaction } = {}): Promise<this> {
    this.conn.assertWritable('Post.save');
    const now = new Date();
    const stamp = now.toISOString().slice(0, 19).replace('T', ' ');
    if (!this.raw.post_date || this.raw.post_date.startsWith('0000-')) {
      this.raw.set('post_date', stamp);
      this.raw.set('post_date_gmt', stamp);
    }
    this.raw.set('post_modified', stamp);
    this.raw.set('post_modified_gmt', stamp);
    await this.raw.save({ transaction: options.transaction });
    return this;
  }

  /** Delete the post row (does NOT cascade meta — call `deleteMetaAll()` first). */
  async delete(options: { transaction?: Transaction } = {}): Promise<void> {
    this.conn.assertWritable('Post.delete');
    await this.raw.destroy({ transaction: options.transaction });
  }

  /** Delete every meta row for this post. */
  async deleteAllMeta(options: { transaction?: Transaction } = {}): Promise<number> {
    this.conn.assertWritable('Post.deleteAllMeta');
    const { PostMeta } = getModels(this.conn);
    return PostMeta.destroy({
      where: { object_id: this.ID },
      transaction: options.transaction,
    });
  }

  // --- static query API ----------------------------------------------------

  /** Begin a new query, optionally scoped to a connection. */
  static query<T extends typeof Post>(this: T, connection?: WpConnection): PostQuery<InstanceType<T>> {
    const cls = this;
    return new PostQuery<InstanceType<T>>(
      (raw, c) => new cls(raw, c) as InstanceType<T>,
      { defaultType: cls.defaultType ?? undefined, connection },
    );
  }

  static find<T extends typeof Post>(this: T, id: number, connection?: WpConnection): Promise<InstanceType<T> | null> {
    return (this.query(connection) as PostQuery<InstanceType<T>>).where({ ID: id }).first();
  }

  static findOrFail<T extends typeof Post>(
    this: T,
    id: number,
    connection?: WpConnection,
  ): Promise<InstanceType<T>> {
    return (this.query(connection) as PostQuery<InstanceType<T>>).where({ ID: id }).firstOrFail();
  }

  static published<T extends typeof Post>(this: T, connection?: WpConnection): PostQuery<InstanceType<T>> {
    return this.query(connection).published();
  }

  static type<T extends typeof Post>(this: T, type: string, connection?: WpConnection): PostQuery<InstanceType<T>> {
    return this.query(connection).type(type);
  }

  static slug<T extends typeof Post>(this: T, slug: string, connection?: WpConnection): PostQuery<InstanceType<T>> {
    return this.query(connection).slug(slug);
  }

  static all<T extends typeof Post>(this: T, connection?: WpConnection): Promise<InstanceType<T>[]> {
    return this.query(connection).all();
  }

  /** Insert a brand-new post. Equivalent to `wp_insert_post()`. */
  static async create<T extends typeof Post>(
    this: T,
    attrs: Partial<PostInstance>,
    connection?: WpConnection,
  ): Promise<InstanceType<T>> {
    const conn = connection ?? getConnection();
    conn.assertWritable('Post.create');
    const { Post: PostModel } = getModels(conn);
    const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const row = await PostModel.create({
      post_date: stamp,
      post_date_gmt: stamp,
      post_modified: stamp,
      post_modified_gmt: stamp,
      post_status: 'publish',
      post_type: (this.defaultType ?? attrs.post_type ?? 'post') as string,
      post_content: '',
      post_title: '',
      post_excerpt: '',
      to_ping: '',
      pinged: '',
      post_content_filtered: '',
      ...attrs,
    });
    return new this(row, conn) as InstanceType<T>;
  }
}
