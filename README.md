# @kieusonlam/wp-core

> Sequelize-based ORM that lets your Node.js / TypeScript app **read and write the WordPress database directly** — Post, Page, Term, Menu, Option, User, Comment, Attachment, plus PHP-serialized meta, shortcodes, and phpass/bcrypt auth. No REST API, no headless plugin needed.

[![npm](https://img.shields.io/npm/v/@kieusonlam/wp-core?color=blue)](https://www.npmjs.com/package/@kieusonlam/wp-core)
[![license](https://img.shields.io/npm/l/@kieusonlam/wp-core)](./LICENSE)

---

## Why?

You have a WordPress site and want to build something with Node.js (Next.js, Remix, Express, NestJS, …) that talks directly to its database — bypassing WP-REST/WPGraphQL latency, plugin overhead, and the PHP runtime. This library gives you Eloquent-style models for every WP table, with **PHP-serialized meta** transparently encoded/decoded.

```
┌──────────────┐         ┌──────────────────┐         ┌────────────┐
│   Next.js    │ ─────►  │ @kieusonlam/wp-* │ ─────►  │  WordPress │
│  (Node 20+)  │         │     Sequelize    │         │   MySQL    │
└──────────────┘         └──────────────────┘         └────────────┘
```

---

## Install

```sh
pnpm add @kieusonlam/wp-core
# or
npm i @kieusonlam/wp-core
# or
yarn add @kieusonlam/wp-core
```

Node 20+ recommended.

---

## Quickstart

```ts
import { connect, Post, Page, Option } from '@kieusonlam/wp-core';

// 1. Connect once at boot (singleton — subsequent imports share it)
connect({
  host: '127.0.0.1',
  port: 3306,
  user: 'root',
  password: '',
  database: 'wordpress',
  prefix: 'wp_',
});

// 2. Query
const siteurl = await Option.get('siteurl');
// → "https://example.com"

const latest = await Post.published().newest().withMeta().limit(5).all();
// → Post[] (5 newest)

const about = await Page.slug('about').first();
// → Page | null
```

---

## Table of contents

- [Connection](#connection)
- [Post — the universal model](#post)
- [Page, Attachment, CustomPostType, Revision](#post-subclasses)
- [Meta (postmeta / usermeta / termmeta)](#meta)
- [Taxonomies, Categories, Tags](#taxonomies)
- [Menus](#menus)
- [Options (wp_options)](#options)
- [User & Auth](#user--auth)
- [Comments](#comments)
- [Shortcodes](#shortcodes)
- [Transactions & write safety](#transactions)
- [TypeScript types](#typescript)
- [Recipes](#recipes)
- [FAQ](#faq)

---

<a id="connection"></a>
## 🔌 Connection

`connect(config)` opens a Sequelize pool and registers all WP models with your table prefix.

```ts
import { connect, getConnection, type WpConnection } from '@kieusonlam/wp-core';

const conn: WpConnection = connect({
  host: '127.0.0.1',
  port: 3306,
  user: 'wp_user',
  password: process.env.DB_PASS!,
  database: 'wordpress',
  prefix: 'wp_',        // optional, default 'wp_'
  charset: 'utf8mb4',   // optional
  readOnly: false,      // optional — true fail-fasts on any write
  pool: { max: 10 },    // optional Sequelize pool config
  logging: false,       // optional — pass a function to log SQL
});

// Anywhere else in your app:
const c = getConnection();          // returns the singleton
console.log(c.prefix);              // 'wp_'
console.log(c.table('posts'));      // 'wp_posts'

// Graceful shutdown
await conn.close();
```

### Multi-site / read-replica

Pass a `connection` argument to every static method to scope queries:

```ts
const main = connect({ database: 'site1', /* … */ });
const replica = connect({ database: 'site1', host: 'replica.db', readOnly: true });

const onMain = await Post.find(123, main);
const onReplica = await Post.find(123, replica);
```

### Next.js + Webpack

Sequelize's default dynamic `require('mysql2')` breaks in webpack/turbopack bundles. We already pass `dialectModule: mysql2` to fix this — no extra config needed. Just import and run.

---

<a id="post"></a>
## 📝 Post — the universal model

`Post` wraps `wp_posts`. Almost every WP entity (page, attachment, product, project, video, custom post type) is a `Post` row under the hood — query them all through the same chainable builder.

### Static lookup

```ts
const p1 = await Post.find(42);           // by primary key (ID) — Post | null
const p2 = await Post.findOrFail(42);     // throws ModelNotFoundError if missing
const p3 = await Post.slug('hello-world').first();
```

### Chainable query

```ts
const recent = await Post
  .published()              // post_status = 'publish'
  .type('post')             // post_type = 'post'  (also accepts ['post','page'])
  .newest()                 // ORDER BY post_date DESC
  .withMeta()               // eager-load wp_postmeta
  .withAuthor()             // eager-load wp_users
  .withTaxonomies('category') // eager-load categories
  .limit(10)
  .offset(0)
  .all();
```

### Filter by meta

```ts
const featured = await Post
  .type('product')
  .hasMeta('_featured', 'yes')
  .all();

// Operators: '=' (default), '!=', '>', '>=', '<', '<=',
//            'LIKE', 'NOT LIKE', 'IN', 'NOT IN', 'EXISTS', 'REGEXP'
const cheap = await Post
  .type('product')
  .hasMeta('_price', '500000', '<')
  .all();

const matchTitle = await Post.hasMetaLike('_long_description', 'LED highbay').all();
```

### Filter by taxonomy

```ts
// Filter posts in category slug 'php'
const phpPosts = await Post.taxonomy('category', 'php').all();

// Filter products in two product_cats
const ledHighbay = await Post
  .type('product')
  .taxonomy('product_cat', ['highbay', 'panel'])
  .all();
```

### Pagination

```ts
const { data, total, page, perPage, lastPage } =
  await Post.published().type('post').paginate(20, 3);

// → {
//   data: Post[] (20 items),
//   total: 605,
//   page: 3,
//   perPage: 20,
//   lastPage: 31,
// }
```

`total` (and `.count()`) count **distinct** posts even when the query eager-loads taxonomies (`.withTaxonomies()`) or filters through one — the underlying `COUNT` uses `DISTINCT` on the primary key so a `LEFT JOIN` to many term rows doesn't multiply the total. _(Fixed in 0.4.3.)_

### Instance API & response shape

```ts
const post = await Post.published().withMeta().first();
if (!post) throw new Error('no posts');

post.ID            // 123          number
post.title         // "Hello world"
post.slug          // "hello-world"
post.content       // "<p>…</p>"
post.excerpt       // "Short preview…"
post.status        // "publish"
post.type          // "post"
post.date          // "2026-05-30 09:12:33"
post.modified      // "2026-05-30 14:00:00"
post.authorId      // 1
post.parentId      // 0
post.menuOrder     // 0
post.mimeType      // ""
post.commentCount  // 12

// Meta — requires .withMeta() on the query, otherwise throws
post.meta._thumbnail_id   // 456
post.meta.popover         // "<table>…</table>"
post.meta._product_cat    // [{ slug: 'highbay', name: 'High-bay' }]   (auto-unserialized)

// Raw access (Sequelize instance)
post.raw                  // PostInstance — escape hatch for custom queries
```

**Response example** — `Post.find(123)`:

```jsonc
// post  (Post instance — these are the public getters; the raw Sequelize
// instance lives on post.raw with every wp_posts column.)
{
  "ID":              123,
  "title":           "5 mẹo tiết kiệm điện đèn LED nhà xưởng",
  "slug":            "tiet-kiem-dien-led-nha-xuong",
  "content":         "<p>Bài viết hướng dẫn …</p>",
  "excerpt":         "Tiết kiệm 60% chi phí điện với …",
  "status":          "publish",
  "type":            "post",
  "date":            "2026-04-12 09:30:00",
  "modified":        "2026-04-15 18:00:00",
  "authorId":        2,
  "parentId":        0,
  "menuOrder":       0,
  "commentCount":    24,

  // With .withMeta():
  "meta": {
    "_thumbnail_id":            "456",
    "_yoast_wpseo_metadesc":    "Tiết kiệm 60% chi phí điện …",
    "_yoast_wpseo_focuskw":     "led nhà xưởng",
    "views":                    "1287"
  }
}
```

### Write — create / update / delete

```ts
import { getConnection } from '@kieusonlam/wp-core';

// Create
const conn = getConnection();
const PostModel = conn.sequelize.models.Post;
const raw = await PostModel.create({
  post_title: 'New post',
  post_content: '<p>Body</p>',
  post_status: 'publish',
  post_type: 'post',
  post_author: 1,
  post_name: 'new-post',
});
const post = new Post(raw);
await post.saveMeta('views', 0);

// Update
post.raw.set('post_title', 'Updated title');
await post.save();           // auto-stamps post_modified*

// Save ACF field (writes both value + _field_xxx pointer)
await post.saveField('hero_image', 456, 'field_5f8a3c2d');

// Delete
await post.deleteAllMeta();
await post.delete();
```

---

<a id="post-subclasses"></a>
## 📄 Page / Attachment / Revision / CustomPostType

All subclass `Post` with a fixed `post_type`. Same chainable API.

### Page

```ts
import { Page } from '@kieusonlam/wp-core';

const about = await Page.slug('about').withMeta().first();
const allPages = await Page.published().orderBy('menu_order', 'ASC').all();
```

### Attachment (media library)

```ts
import { Attachment } from '@kieusonlam/wp-core';

const att = await Attachment.find(456) as Attachment;

await att.filePath();
// → "2026/05/highbay-led-200w.jpg"

await att.fileMetadata();
// → {
//   width: 1920,
//   height: 1080,
//   file: "2026/05/highbay-led-200w.jpg",
//   sizes: {
//     thumbnail: { file: "highbay-led-200w-150x150.jpg", width:150, height:150, mime_type:"image/jpeg" },
//     medium:    { file: "highbay-led-200w-300x169.jpg", width:300, height:169, mime_type:"image/jpeg" },
//     large:     { file: "highbay-led-200w-1024x576.jpg", width:1024, height:576, mime_type:"image/jpeg" }
//   }
// }

await att.url('https://example.com/wp-content/uploads', 'medium');
// → "https://example.com/wp-content/uploads/2026/05/highbay-led-200w-300x169.jpg"
```

### CustomPostType — extend for your CPT

```ts
import { Post, PostQuery } from '@kieusonlam/wp-core';

export class Project extends Post {
  static override defaultType = 'project';

  get industry(): string {
    return (this.getMeta('industry') as string) ?? '';
  }

  static byIndustry(slug: string) {
    return this.published().taxonomy('industry', slug);
  }
}

// Use exactly like Post:
const projects = await Project.published().newest().withMeta().limit(10).all();
const tekcom = await Project.slug('tekcom-factory').withMeta().first();
const food = await Project.byIndustry('food-beverage').all();
```

---

<a id="meta"></a>
## 🗂 Meta — postmeta / usermeta / termmeta / commentmeta

Every model that has a meta sister-table exposes:

| Method | Returns | Notes |
|---|---|---|
| `.meta` (getter) | `Record<string, MetaValue>` | Sync — only works after `.withMeta()` |
| `.getMeta(key)` | `MetaValue \| undefined` | Sync — same caveat |
| `.getMetaAsync(key)` | `Promise<MetaValue>` | Lazy — runs a SELECT if not in cache |
| `.saveMeta(key, value)` | `Promise<void>` | UPSERT, auto-serializes objects/arrays |
| `.createMeta(key, value)` | `Promise<void>` | INSERT (allows duplicate keys) |
| `.deleteMeta(key)` | `Promise<number>` | DELETE — returns count removed |
| `.deleteAllMeta()` | `Promise<number>` | DELETE every row for this object |

```ts
const post = await Post.findOrFail(123);

// Lazy single meta — no eager needed
const layout = await post.getMetaAsync('_wp_page_template');
// → "templates/full-width.php"

// Bulk eager
const post2 = await Post.find(123, conn);
await Post.published().withMeta().limit(5).all();
// each post.meta is now a plain object
```

### PHP serialization

Any meta value that's a PHP-serialized array/object is auto-decoded on read and re-encoded on write:

```ts
await post.saveMeta('color_options', { primary: '#1d4ed8', accent: '#ef4444' });
// wp_postmeta.meta_value gets: a:2:{s:7:"primary";s:7:"#1d4ed8";s:6:"accent";s:7:"#ef4444";}

const opts = await post.getMetaAsync('color_options');
// → { primary: '#1d4ed8', accent: '#ef4444' }
```

UTF-8 (Vietnamese, CJK) round-trips correctly.

---

<a id="taxonomies"></a>
## 🏷 Taxonomies, Categories, Tags

```ts
import { Term, Taxonomy, Category, Tag } from '@kieusonlam/wp-core';

// All categories
const cats = await Category.all();
// → Taxonomy[] — each has .id, .name, .slug, .taxonomy, .description, .parent

// Posts in a category
const cat = await Category.slug('php').first();
const posts = await cat?.posts();   // Post[]

// All terms in a custom taxonomy
const inds = await Taxonomy.named('industry');
```

**Response example** — `Category.slug('led-cong-nghiep')`:

```jsonc
{
  "id":          12,            // term_taxonomy_id
  "name":        "Đèn LED công nghiệp",
  "slug":        "led-cong-nghiep",
  "taxonomy":    "category",
  "description": "Đèn high-bay, đèn pha, đèn tube …",
  "parent":      0,
  "count":       38,            // post count
  "term": {                     // joined wp_terms row
    "term_id":   18,
    "name":      "Đèn LED công nghiệp",
    "slug":      "led-cong-nghiep"
  }
}
```

### Term meta (WooCommerce category image, SEO, ACF, …)

`wp_termmeta` is WordPress core (since 4.4): WooCommerce keeps a category's `thumbnail_id` / `display_type` there, SEO plugins store per-term title/description, themes store colours/icons, and ACF writes term-attached fields there too. `Term` exposes the same meta API as Post/User, and `Taxonomy` **delegates to its `.term`** — so a `Taxonomy` is itself a meta source:

```ts
const cat = await Category.slugInCategory('tin-tuc');   // → Taxonomy

const introHtml = await cat?.getMetaAsync('cat_content'); // lazy read
const imageId   = cat?.getMeta('thumbnail_id');           // sync (after a load)

await cat?.saveMeta('cat_color', '#1f4889');              // write (UPSERT)
```

Available on `Term` / `Taxonomy`: `.getMetaAsync(key)`, `.getMeta(key)` (sync), `.meta` (sync getter), `.loadMeta()`, `.saveMeta(key, value)`, `.deleteMeta(key)`. The **first** `getMetaAsync()` loads *all* of that term's meta in one query and caches it, so reading many keys (e.g. an ACF repeater on the term) doesn't N+1. To read ACF fields attached to a term, pass the `Taxonomy` to `acfTerm()` in `@kieusonlam/wp-acf`. _(Added in 0.5.0.)_

---

<a id="menus"></a>
## 📋 Menus

Menus are stored as terms in the `nav_menu` taxonomy. Each item is a `nav_menu_item` post pointing to the underlying Page / CPT / external URL via `_menu_item_*` meta.

```ts
import { Menu } from '@kieusonlam/wp-core';

const menu = await Menu.slug('primary');
if (!menu) throw new Error('menu not found');

// Flat list
const items = await menu.items();
// → MenuItem[]

// Nested tree
const tree = await menu.tree();
// → MenuItemNode[]
```

**Response example** — `menu.tree()`:

```jsonc
[
  {
    "item": {
      "id": 201,
      "title": "Sản phẩm",
      "url": "/catalog",
      "itemType": "post_type",     // post_type | taxonomy | custom
      "target": "",
      "classes": ["mega-menu"]
    },
    "children": [
      {
        "item": { "id": 202, "title": "Đèn LED công nghiệp", "url": "/catalog/led-cong-nghiep" },
        "children": []
      },
      {
        "item": { "id": 203, "title": "Đèn LED dân dụng", "url": "/catalog/led-dan-dung" },
        "children": []
      }
    ]
  },
  {
    "item": { "id": 210, "title": "Dự án", "url": "/portfolio" },
    "children": []
  }
]
```

Each `MenuItem` is a `Post` with extra getters: `itemType`, `target`, `url`, `objectId`, `classes`.

```ts
const item = tree[0].item;
await item.instance();
// → Page | Post | Taxonomy | CustomLink — the underlying object the menu points to
```

---

<a id="options"></a>
## ⚙️ Options (wp_options)

```ts
import { Option } from '@kieusonlam/wp-core';

const url = await Option.get('siteurl');
// → "https://example.com"

const settings = await Option.get('my_plugin_settings');
// → { theme: 'dark', features: ['a','b'] }    (auto-unserialized)

// Write — UPSERT
await Option.set('my_plugin_settings', { theme: 'light', features: [] });

// Strict insert (throws if exists)
await Option.add('new_setting', 'hello');

// Bulk load (autoloaded options if no keys passed)
const opts = await Option.asArray(['siteurl', 'blogname', 'admin_email']);
// → { siteurl: 'https://…', blogname: 'POTECH', admin_email: 'hi@potech.com.vn' }

await Option.delete('obsolete_option');
```

---

<a id="user--auth"></a>
## 👤 User & Auth

```ts
import { User, AuthUserProvider } from '@kieusonlam/wp-core';

// Lookup
const u1 = await User.find(1);
const u2 = await User.findByLogin('editor');
const u3 = await User.findByEmail('hi@potech.com.vn');
const u4 = await User.findByLoginOrEmail('editor');

// Properties
u1?.login         // 'admin'
u1?.email         // 'admin@example.com'
u1?.displayName   // 'Administrator'
await u1?.role()  // 'administrator'
await u1?.capabilities()  // { administrator: true }

// Auth — verify phpass + bcrypt password hashes
const auth = new AuthUserProvider();
const user = await auth.attempt({ identifier: 'editor', password: 'secret' });
if (user) {
  // login succeeded
  console.log(`Welcome, ${user.displayName}`);
}

// Set a new password (re-hashed with bcrypt)
await auth.setPassword(user!, 'new-strong-password');
```

**Response example** — `User.find(1)`:

```jsonc
{
  "ID":          1,
  "login":       "admin",
  "email":       "admin@potech.com.vn",
  "displayName": "Administrator",
  "nicename":    "admin",
  "url":         "https://potech.com.vn",
  "registered":  "2024-01-15 03:22:11"
}
```

---

<a id="comments"></a>
## 💬 Comments

```ts
import { Comment } from '@kieusonlam/wp-core';

const post = await Post.find(123);
const comments = await Comment.forPost(123);     // Comment[]

// Threaded
const tree = await Comment.treeForPost(123);
// → CommentNode[] — each { comment, children: CommentNode[] }
```

---

<a id="shortcodes"></a>
## 🔌 Shortcodes

A port of WP's shortcode parser (same regex as `get_shortcode_regex`).

```ts
import { shortcodes, doShortcode, parseAttributes } from '@kieusonlam/wp-core';

shortcodes.add('gallery', (attrs, content) => {
  // attrs: { ids: '1,2,3', columns: '3' }
  return `<div class="gallery" data-ids="${attrs.ids}">${content ?? ''}</div>`;
});

shortcodes.add('button', (attrs, content) => {
  return `<a class="btn" href="${attrs.url}">${content}</a>`;
});

const html = doShortcode(post.content);
// or per-instance registry:
const html2 = shortcodes.do(post.content);

// Parse attribute strings yourself (no quote / single quote / unquoted all work):
parseAttributes('ids="1,2,3" columns=4 align=center');
// → { ids: '1,2,3', columns: '4', align: 'center' }
```

---

<a id="transactions"></a>
## 🔒 Transactions & write safety

```ts
const conn = getConnection();

await conn.sequelize.transaction(async (t) => {
  const post = await Post.findOrFail(123);
  await post.saveMeta('counter', 5, { transaction: t });
  await post.saveMeta('counter_at', new Date().toISOString(), { transaction: t });
  // Both writes atomically commit — or neither.
});
```

### Read-only mode

```ts
connect({ /*…*/ readOnly: true });

await post.saveMeta('x', 1);
// throws WriteForbiddenError: write operation "Post.saveMeta" not allowed: connection is read-only
```

Use for staging / preview connections to ensure your prod replica is never mutated by accident.

---

<a id="typescript"></a>
## 🟦 TypeScript

Every model is fully typed. Generic helpers:

```ts
import type {
  Post,
  Page,
  WpConnection,
  WpConnectionConfig,
  PostStatus,             // 'publish' | 'draft' | 'pending' | ...
  PostType,               // 'post' | 'page' | 'attachment' | ...
  MetaValue,              // string | number | boolean | null | MetaValue[] | { [k]: MetaValue }
  MetaCompareOp,          // '=' | '!=' | '>' | 'LIKE' | 'EXISTS' | ...
} from '@kieusonlam/wp-core';
```

The Post query builder is fluently typed end-to-end — subclasses preserve their concrete type through `.find()`, `.all()`, `.first()`, etc.

---

<a id="recipes"></a>
## 🍳 Recipes

### Next.js App Router + ISR

```ts
// app/lib/wp.ts
import { connect, getConnection } from '@kieusonlam/wp-core';

const g = globalThis as unknown as { __wp_connected?: boolean };
if (!g.__wp_connected) {
  connect({
    host: process.env.WP_DB_HOST!,
    port: parseInt(process.env.WP_DB_PORT ?? '3306', 10),
    user: process.env.WP_DB_USER!,
    password: process.env.WP_DB_PASSWORD ?? '',
    database: process.env.WP_DB_NAME!,
    prefix: process.env.WP_DB_PREFIX ?? 'wp_',
  });
  g.__wp_connected = true;
}
export const wp = getConnection();

// app/post/[slug]/page.tsx
import { Post } from '@kieusonlam/wp-core';
import '@/app/lib/wp';

export const revalidate = 300;

export default async function PostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = await Post.slug(slug).withMeta().withAuthor().first();
  if (!post) return notFound();
  return <article dangerouslySetInnerHTML={{ __html: post.content }} />;
}
```

### Sitemap from all published content

```ts
import { Post } from '@kieusonlam/wp-core';

export default async function sitemap() {
  const posts = await Post.published().type(['post', 'page', 'product']).all();
  return posts.map((p) => ({
    url: `https://example.com/${p.type}/${p.slug}`,
    lastModified: new Date(p.modified),
  }));
}
```

### Search with meta + taxonomy

```ts
const matches = await Post
  .published()
  .type('product')
  .taxonomy('product_cat', 'highbay')
  .hasMeta('_stock_status', 'instock')
  .hasMetaLike('_long_description', 'IP65')
  .newest()
  .limit(20)
  .all();
```

---

<a id="faq"></a>
## ❓ FAQ

**Does this work with a remote WordPress site I don't control?**
Only if you can reach its MySQL — i.e. you own the infrastructure or VPN in. For external sites, use WP-REST or WPGraphQL.

**Does it support MariaDB?**
Yes — pass `dialect: 'mariadb'` to `connect()`.

**Will this corrupt my WP database?**
Reads are safe. Writes go through Sequelize transactions and follow WP's schema. Same-process risk as the WP PHP runtime itself — but always test against a staging DB first, and use `readOnly: true` on prod replicas.

**WP plugins write extra columns / tables. How do I read those?**
Use the escape hatch: `getConnection().sequelize.query('SELECT * FROM wp_my_plugin_table')` or define your own Sequelize model on the same connection.

**Does this replace WPGraphQL?**
For SSR / SSG / build-time content, yes — and it's typically 5–50× faster (no PHP roundtrip). For client-side mutations or third-party API access, keep WPGraphQL / WP-REST.

---

## Related packages

- [`@kieusonlam/wp-acf`](https://github.com/kieusonlam/wp-acf) — Advanced Custom Fields reader (text, image, gallery, repeater, flexible content, options pages)
- [`@kieusonlam/wp-woocommerce`](https://github.com/kieusonlam/wp-woocommerce) — Product, Order, Customer, Coupon models

---

## License

MIT © [Lâm Kiều](https://github.com/kieusonlam)
