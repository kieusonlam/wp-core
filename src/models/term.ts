/**
 * `Term` + `Taxonomy` — WordPress's two-table taxonomy structure.
 *
 * `wp_terms` holds the term itself (id, name, slug).
 * `wp_term_taxonomy` joins it to a taxonomy and stores hierarchy + description.
 *
 * Most code wants `Taxonomy` (the joined view). `Term` is exposed too for raw
 * access.
 */

import { Op, type FindOptions, type WhereOptions } from 'sequelize';
import { getConnection, type WpConnection } from '../db.js';
import { getModels } from './register.js';
import { ModelNotFoundError } from '../types.js';
import { Post } from './post.js';
import type { TermInstance, TermTaxonomyInstance } from './schema.js';

/** Raw term row (just the `wp_terms` slice). */
export class Term {
  readonly raw: TermInstance;
  protected readonly conn: WpConnection;

  constructor(raw: TermInstance, connection?: WpConnection) {
    this.raw = raw;
    this.conn = connection ?? getConnection();
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
