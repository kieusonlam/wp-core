/**
 * `Term` + `Taxonomy` — WordPress's two-table taxonomy structure.
 *
 * `wp_terms` holds the term itself (id, name, slug).
 * `wp_term_taxonomy` joins it to a taxonomy and stores hierarchy + description.
 *
 * Most code wants `Taxonomy` (the joined view). `Term` is exposed too for raw
 * access.
 */

import { Op, type FindOptions, type WhereOptions, type Transaction } from 'sequelize';
import { getConnection, type WpConnection } from '../db.js';
import { getModels } from './register.js';
import { maybeSerialize } from '../meta/serialization.js';
import { ModelNotFoundError, type MetaValue } from '../types.js';
import { Post } from './post.js';
import type { TermInstance, TermTaxonomyInstance, MetaInstance } from './schema.js';

/** Termmeta đã giải tuần tự, keyed theo meta_key. */
export type TermMetaMap = Record<string, MetaValue>;

/**
 * Raw term row (`wp_terms`) + truy cập `wp_termmeta` (giống Post/User).
 *
 * Term meta là tính năng core của WordPress (từ 4.4) — WooCommerce dùng cho
 * ảnh/`display_type` của danh mục, plugin SEO lưu tiêu đề/mô tả theo term,
 * theme lưu màu/icon, và ACF gắn field vào term cũng ghi ở đây. Đọc:
 *
 *   const term = (await Category.slugInCategory('tin-tuc'))?.term;
 *   const color = await term?.getMetaAsync('cat_color'); // lazy, cache cả cụm
 */
export class Term {
  readonly raw: TermInstance;
  protected readonly conn: WpConnection;
  /** Cache termmeta đã giải tuần tự. null = chưa nạp. */
  protected metaCache: TermMetaMap | null = null;

  constructor(raw: TermInstance, connection?: WpConnection) {
    this.raw = raw;
    this.conn = connection ?? getConnection();

    // Nếu query đã eager-load association 'meta' thì nạp sẵn vào cache.
    const includedMeta = (raw.get('meta') as MetaInstance[] | undefined) ?? undefined;
    if (Array.isArray(includedMeta)) this.metaCache = mapMetaRows(includedMeta);
  }

  get id(): number {
    return this.raw.term_id;
  }
  get name(): string {
    return this.raw.name;
  }
  get slug(): string {
    return this.raw.slug;
  }

  /**
   * Toàn bộ termmeta đã nạp (đồng bộ). Ném lỗi nếu chưa nạp — eager-load
   * association `meta`, hoặc gọi `loadMeta()` / `getMetaAsync()` trước.
   */
  get meta(): TermMetaMap {
    if (!this.metaCache) {
      throw new Error(
        `Term#${this.id}.meta accessed without loading. Eager-load 'meta' or call term.loadMeta() / term.getMetaAsync(key) first.`,
      );
    }
    return this.metaCache;
  }

  /** Đọc đồng bộ sau khi đã nạp meta. `undefined` nếu chưa nạp / không có key. */
  getMeta(key: string): MetaValue | undefined {
    return this.metaCache ? this.metaCache[key] : undefined;
  }

  /**
   * Đọc một termmeta. Lần gọi đầu (khi chưa nạp) sẽ nạp **toàn bộ** termmeta
   * của term này trong 1 query rồi cache — nên đọc nhiều key (vd repeater ACF)
   * không bị N+1. Trả `undefined` nếu không có key.
   */
  async getMetaAsync(key: string): Promise<MetaValue | undefined> {
    if (this.metaCache && key in this.metaCache) return this.metaCache[key];
    if (!this.metaCache) await this.loadMeta();
    return this.metaCache![key];
  }

  /** Nạp toàn bộ termmeta của term này vào cache (1 query). Trả về map. */
  async loadMeta(): Promise<TermMetaMap> {
    const { TermMeta } = getModels(this.conn);
    const rows = await TermMeta.findAll({ where: { object_id: this.id } });
    this.metaCache = mapMetaRows(rows);
    return this.metaCache;
  }

  /** Ghi/cập nhật một termmeta. Ném lỗi nếu connection ở chế độ read-only. */
  async saveMeta(
    key: string,
    value: MetaValue,
    options: { transaction?: Transaction } = {},
  ): Promise<void> {
    this.conn.assertWritable('Term.saveMeta');
    const { TermMeta } = getModels(this.conn);
    const existing = await TermMeta.findOne({
      where: { object_id: this.id, meta_key: key },
      transaction: options.transaction,
    });
    if (existing) {
      existing.set('meta_value', maybeSerialize(value));
      await existing.save({ transaction: options.transaction });
    } else {
      await TermMeta.create(
        { object_id: this.id, meta_key: key, meta_value: maybeSerialize(value) },
        { transaction: options.transaction },
      );
    }
    if (this.metaCache) this.metaCache[key] = value;
  }

  /** Xoá termmeta theo key. Trả số dòng đã xoá. Ném lỗi nếu read-only. */
  async deleteMeta(key: string, options: { transaction?: Transaction } = {}): Promise<number> {
    this.conn.assertWritable('Term.deleteMeta');
    const { TermMeta } = getModels(this.conn);
    const n = await TermMeta.destroy({
      where: { object_id: this.id, meta_key: key },
      transaction: options.transaction,
    });
    if (this.metaCache) delete this.metaCache[key];
    return n;
  }
}

/** Gom các dòng termmeta thành map (ưu tiên giá trị đã giải tuần tự từ hook). */
function mapMetaRows(rows: MetaInstance[]): TermMetaMap {
  const map: TermMetaMap = {};
  for (const m of rows) {
    const k = m.get('meta_key');
    if (typeof k !== 'string') continue;
    const dv = (m as unknown as { dataValues: Record<string, unknown> }).dataValues;
    map[k] = dv.unserialized !== undefined ? (dv.unserialized as MetaValue) : (m.get('meta_value') as MetaValue);
  }
  return map;
}

/** Joined view: a term in a specific taxonomy. */
export class Taxonomy {
  readonly raw: TermTaxonomyInstance;
  protected readonly conn: WpConnection;
  /** The underlying `wp_terms` row, eagerly loaded. */
  readonly term: Term | null;

  /** Subclasses set this to scope queries to a single taxonomy name. */
  static defaultTaxonomy: string | null = null;

  constructor(raw: TermTaxonomyInstance, connection?: WpConnection) {
    this.raw = raw;
    this.conn = connection ?? getConnection();
    const t = raw.get('term') as TermInstance | undefined;
    this.term = t ? new Term(t, this.conn) : null;
  }

  get id(): number {
    return this.raw.term_taxonomy_id;
  }
  get taxonomy(): string {
    return this.raw.taxonomy;
  }
  get description(): string {
    return this.raw.description;
  }
  get count(): number {
    return Number(this.raw.count);
  }
  get parentId(): number {
    return this.raw.parent;
  }
  get name(): string {
    return this.term?.name ?? '';
  }
  get slug(): string {
    return this.term?.slug ?? '';
  }

  // --------------- term meta (uỷ quyền cho `this.term`) -------------------
  // Termmeta khoá theo `term_id` nên nằm trên `Term`; `Taxonomy` uỷ quyền lại.
  // Nhờ có `getMetaAsync`, một `Taxonomy` cũng là một ACF `MetaSource` →
  // `new Acf(taxonomy)` / `acfTerm(taxonomy)` đọc field gắn-trên-term được.

  /** Termmeta đã nạp (đồng bộ). Ném lỗi nếu chưa nạp hoặc thiếu term. */
  get meta(): TermMetaMap {
    if (!this.term) throw new Error(`Taxonomy#${this.id} chưa load term — không đọc được meta.`);
    return this.term.meta;
  }

  /** Đọc đồng bộ sau khi đã nạp. `undefined` nếu chưa nạp / không có key. */
  getMeta(key: string): MetaValue | undefined {
    return this.term?.getMeta(key);
  }

  /** Đọc một termmeta (lazy, lần đầu nạp cả cụm — xem `Term.getMetaAsync`). */
  async getMetaAsync(key: string): Promise<MetaValue | undefined> {
    return this.term ? this.term.getMetaAsync(key) : undefined;
  }

  /** Nạp toàn bộ termmeta vào cache (1 query). Trả map rỗng nếu thiếu term. */
  loadMeta(): Promise<TermMetaMap> {
    return this.term ? this.term.loadMeta() : Promise.resolve({});
  }

  /** Ghi/cập nhật một termmeta. Ném lỗi nếu read-only hoặc thiếu term. */
  async saveMeta(key: string, value: MetaValue, options: { transaction?: Transaction } = {}): Promise<void> {
    if (!this.term) throw new Error(`Taxonomy#${this.id} chưa load term — không ghi được meta.`);
    return this.term.saveMeta(key, value, options);
  }

  /** Xoá termmeta theo key. Trả số dòng đã xoá (0 nếu thiếu term). */
  async deleteMeta(key: string, options: { transaction?: Transaction } = {}): Promise<number> {
    return this.term ? this.term.deleteMeta(key, options) : 0;
  }

  /** Fetch every post attached to this taxonomy term. */
  async posts(scope: 'all' | 'published' = 'published'): Promise<Post[]> {
    const { Post: PostModel, TermTaxonomy, Term: TermModel } = getModels(this.conn);
    const rows = await PostModel.findAll({
      include: [
        {
          model: TermTaxonomy,
          as: 'taxonomies',
          where: { term_taxonomy_id: this.id },
          required: true,
          include: [{ model: TermModel, as: 'term' }],
        },
      ],
      where: scope === 'published' ? { post_status: 'publish' } : undefined,
      order: [['post_date', 'DESC']],
    });
    return rows.map((r) => new Post(r, this.conn));
  }

  // --------------- static lookups ----------------------------------------

  static async find(termTaxonomyId: number, connection?: WpConnection): Promise<Taxonomy | null> {
    const conn = connection ?? getConnection();
    const { TermTaxonomy, Term: TermModel } = getModels(conn);
    const row = await TermTaxonomy.findByPk(termTaxonomyId, {
      include: [{ model: TermModel, as: 'term' }],
    });
    return row ? new Taxonomy(row, conn) : null;
  }

  static async findOrFail(id: number, connection?: WpConnection): Promise<Taxonomy> {
    const t = await Taxonomy.find(id, connection);
    if (!t) throw new ModelNotFoundError('Taxonomy', { id });
    return t;
  }

  /** All terms for a given taxonomy (e.g. `Taxonomy.named('category')`). */
  static async named(
    name: string,
    options: FindOptions = {},
    connection?: WpConnection,
  ): Promise<Taxonomy[]> {
    const conn = connection ?? getConnection();
    const { TermTaxonomy, Term: TermModel } = getModels(conn);
    const rows = await TermTaxonomy.findAll({
      where: { taxonomy: name } as WhereOptions,
      include: [{ model: TermModel, as: 'term' }],
      ...options,
    });
    return rows.map((r) => new Taxonomy(r, conn));
  }

  /** Lookup a term by slug within a taxonomy. */
  static async slug(taxonomy: string, slug: string, connection?: WpConnection): Promise<Taxonomy | null> {
    const conn = connection ?? getConnection();
    const { TermTaxonomy, Term: TermModel } = getModels(conn);
    const row = await TermTaxonomy.findOne({
      where: { taxonomy },
      include: [{ model: TermModel, as: 'term', where: { slug }, required: true }],
    });
    return row ? new Taxonomy(row, conn) : null;
  }

  /** Get the parent taxonomy (null if top-level). */
  async parent(): Promise<Taxonomy | null> {
    if (!this.parentId) return null;
    return Taxonomy.find(this.parentId, this.conn);
  }

  /** Get direct children (this term as parent in the same taxonomy). */
  async children(): Promise<Taxonomy[]> {
    const { TermTaxonomy, Term: TermModel } = getModels(this.conn);
    const rows = await TermTaxonomy.findAll({
      where: { parent: this.id, taxonomy: this.taxonomy } as WhereOptions,
      include: [{ model: TermModel, as: 'term' }],
    });
    return rows.map((r) => new Taxonomy(r, this.conn));
  }
}

// ----------------------------------------------------------------------------
// Specialized subclasses for the common taxonomies
// ----------------------------------------------------------------------------

export class Category extends Taxonomy {
  static override defaultTaxonomy = 'category';

  static override async named(
    _name: string,
    options: FindOptions = {},
    connection?: WpConnection,
  ): Promise<Taxonomy[]> {
    return Taxonomy.named('category', options, connection);
  }

  static all(options: FindOptions = {}, connection?: WpConnection): Promise<Taxonomy[]> {
    return Taxonomy.named('category', options, connection);
  }

  static slugInCategory(slug: string, connection?: WpConnection): Promise<Taxonomy | null> {
    return Taxonomy.slug('category', slug, connection);
  }
}

export class Tag extends Taxonomy {
  static override defaultTaxonomy = 'post_tag';

  static all(options: FindOptions = {}, connection?: WpConnection): Promise<Taxonomy[]> {
    return Taxonomy.named('post_tag', options, connection);
  }
}
