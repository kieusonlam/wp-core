/**
 * WordPress navigation menus.
 *
 * Menus are stored as terms in the `nav_menu` taxonomy. Each menu item is a
 * post of type `nav_menu_item` whose various pointers live in postmeta:
 *
 *   _menu_item_type             "post_type" | "taxonomy" | "custom"
 *   _menu_item_object_id        target post / term ID
 *   _menu_item_object           "page" | "category" | "custom" | ...
 *   _menu_item_url              URL for type=custom
 *   _menu_item_menu_item_parent parent nav_menu_item ID
 *   _menu_item_target           "" | "_blank"
 *   _menu_item_classes          serialized array of CSS classes
 *
 * `MenuItem.instance()` resolves to the underlying Post/Page/Taxonomy/CustomLink.
 */

import { getConnection, type WpConnection } from '../db.js';
import { Post } from './post.js';
import { Taxonomy } from './term.js';
import { getModels } from './register.js';
import type { MetaValue } from '../types.js';

/** A "custom" menu item — only stored in postmeta, not a separate row. */
export interface CustomLink {
  kind: 'custom';
  url: string;
  title: string;
  target: string;
  classes: string[];
}

/** A menu — wraps a `nav_menu` taxonomy term. */
export class Menu {
  readonly taxonomy: Taxonomy;
  protected readonly conn: WpConnection;

  constructor(taxonomy: Taxonomy, connection?: WpConnection) {
    this.taxonomy = taxonomy;
    this.conn = connection ?? getConnection();
  }

  get id(): number {
    return this.taxonomy.id;
  }
  get name(): string {
    return this.taxonomy.name;
  }
  get slug(): string {
    return this.taxonomy.slug;
  }

  /** All menu items in this menu, sorted by `menu_order`, eager meta. */
  async items(): Promise<MenuItem[]> {
    const { Post: PostModel, TermTaxonomy, PostMeta } = getModels(this.conn);
    const rows = await PostModel.findAll({
      where: { post_type: 'nav_menu_item', post_status: 'publish' },
      include: [
        {
          model: TermTaxonomy,
          as: 'taxonomies',
          where: { term_taxonomy_id: this.id },
          required: true,
        },
        { model: PostMeta, as: 'meta' },
      ],
      order: [['menu_order', 'ASC']],
    });
    return rows.map((r) => new MenuItem(r, this.conn));
  }

  /** Build a tree: top-level items with `children` arrays for nested levels. */
  async tree(): Promise<MenuItemNode[]> {
    const items = await this.items();
    const byId = new Map<number, MenuItemNode>();
    for (const it of items) byId.set(it.id, { item: it, children: [] });
    const roots: MenuItemNode[] = [];
    for (const it of items) {
      const parentMeta = it.getMeta('_menu_item_menu_item_parent');
      const parentId = typeof parentMeta === 'string' ? parseInt(parentMeta, 10) : 0;
      const node = byId.get(it.id);
      if (!node) continue;
      if (parentId && byId.has(parentId)) {
        byId.get(parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }
    return roots;
  }

  static async slug(slug: string, connection?: WpConnection): Promise<Menu | null> {
    const tx = await Taxonomy.slug('nav_menu', slug, connection);
    return tx ? new Menu(tx, connection) : null;
  }

  static async all(connection?: WpConnection): Promise<Menu[]> {
    const items = await Taxonomy.named('nav_menu', {}, connection);
    return items.map((t) => new Menu(t, connection));
  }
}

/** Tree node returned from `menu.tree()`. */
export interface MenuItemNode {
  item: MenuItem;
  children: MenuItemNode[];
}

/** A single nav_menu_item post + its specialized meta accessors. */
export class MenuItem extends Post {
  static override defaultType = 'nav_menu_item';

  get itemType(): string {
    return (this.getMeta('_menu_item_type') as string) ?? 'custom';
  }

  get target(): string {
    return (this.getMeta('_menu_item_target') as string) ?? '';
  }

  get classes(): string[] {
    const c = this.getMeta('_menu_item_classes');
    if (Array.isArray(c)) return c.map((x) => String(x));
    return [];
  }

  /** Resolve to the underlying Post / Taxonomy / CustomLink. */
  async instance(): Promise<Post | Taxonomy | CustomLink | null> {
    const type = this.itemType;
    if (type === 'custom') {
      return {
        kind: 'custom',
        url: (this.getMeta('_menu_item_url') as string) ?? '',
        title: this.title,
        target: this.target,
        classes: this.classes,
      };
    }
    const objId = this.getMeta('_menu_item_object_id');
    const id = typeof objId === 'string' ? parseInt(objId, 10) : (objId as number);
    if (!id) return null;
    if (type === 'taxonomy') {
      return Taxonomy.find(id, this.conn);
    }
    // post_type (page, post, custom CPT)
    return Post.find(id, this.conn);
  }
}
