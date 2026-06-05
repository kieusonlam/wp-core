# @kieusonlam/wp-core

## 0.5.0

### Minor changes

- **New: term meta on `Term` / `Taxonomy`.** `wp_termmeta` (WordPress core since 4.4) was modelled but had no high-level accessor — only `Post` and `User` did. `Term` now exposes the same meta API as Post/User: `.getMetaAsync(key)`, `.getMeta(key)`, `.meta`, `.loadMeta()`, `.saveMeta(key, value)`, `.deleteMeta(key)`. `Taxonomy` (and `Category` / `Tag`) **delegate to their `.term`**, so a `Taxonomy` is now also a `getMetaAsync`-bearing source — meaning `new Acf(taxonomy)` / `acfTerm(taxonomy)` (wp-acf ≥ 0.4.1) can read ACF fields attached to a term, and non-ACF consumers can read WooCommerce category `thumbnail_id` / `display_type`, per-term SEO, theme settings, etc.

  ```ts
  const cat = await Category.slugInCategory('tin-tuc'); // Taxonomy
  const intro = await cat?.getMetaAsync('cat_content');
  await cat?.saveMeta('cat_color', '#1f4889');
  ```

  The first `getMetaAsync()` on a term loads **all** of its `wp_termmeta` rows in one query, then caches — so reading many keys (e.g. an ACF repeater) does not N+1. Purely additive; no breaking changes. Released together with wp-acf 0.5.0 + wp-woocommerce 0.5.0 (peer `^0.5.0`).

## 0.4.3

### Patch changes

- **Fix: `.count()` / `.paginate().total` no longer inflated by eager JOINs.** When a query eager-loads taxonomies (`.withTaxonomies()`) or filters through one that matches several rows (`.taxonomy()`), the include is a `LEFT JOIN`; `Model.count()` without `distinct` then counted joined rows, so each post was multiplied by its number of term rows (e.g. a category of 9 products reported 36, a 265-product catalog reported 688). `count()` now passes `distinct: true` → `COUNT(DISTINCT \`ID\`)`, returning the true row count. The `data` rows of `paginate()` were always correct (they use a subquery); only `total` / `lastPage` were wrong. `.withMeta()` uses `separate: true` (a second query, not a JOIN) and was never affected.

## 0.4.2

### Patch changes

- **Fix: verify WordPress 6.8+ bcrypt passwords (`$wp$2y$…`).** WP ≥ 6.8 stores password hashes as `$wp$2y$…` — bcrypt of a base64-encoded HMAC-SHA384 pre-hash (key `wp-sha384`) of the password, to sidestep bcrypt's 72-byte limit. `verify()` previously didn't recognise the `$wp` prefix and fell through to phpass, throwing `Bad salt length`. It now handles `$wp$2y$` (pre-hash + strip prefix + compare), alongside raw bcrypt (`$2y$/$2a$/$2b$`) and legacy phpass (`$P$`). `hashBcrypt()` now also produces the correct `$wp$2y$` format.

## 0.4.1

### Patch changes

- **Fix: `.hasMeta()` filters now compose with `.withMeta()`.** Combining a meta filter (`.hasMeta()` — e.g. `_stock_status` / `_price` / `_sale_price`) with `.withMeta()` made both reuse the same `meta` association alias; Sequelize merged them and the filter clobbered the eager load, so every meta value other than the filtered key came back empty (product price / SKU / thumbnail all blank on in-stock-only or filtered lists). `.hasMeta()` now filters via an uncorrelated `ID IN (SELECT post_id FROM …postmeta …)` subquery, leaving `.withMeta()`'s eager load intact. Multiple `.hasMeta()` filters on different keys also compose correctly now.

## 0.4.0

### Minor changes

- **New: `PostQuery.whereIn(column, values)` / `.whereNotIn(column, values)`** — fluent `WHERE column IN (...)` / `NOT IN (...)` so consumers no longer need raw `Op.in`. Empty-array semantics are handled safely: `whereIn([])` matches nothing, `whereNotIn([])` is a no-op (avoids the `NOT IN (NULL)` gotcha that would otherwise match zero rows).

  ```ts
  await Post.published().whereIn('ID', [12, 34, 56]).all();
  await Post.query().whereNotIn('post_status', ['trash', 'auto-draft']).all();
  ```

- **New: `Op` re-exported** from the package root. Import `Op` from `@kieusonlam/wp-core` instead of `sequelize` for raw `.where()` conditions (LIKE / OR / …). This drops the need for a separate `sequelize` dependency in consumers AND guarantees the same Sequelize instance the models use — a second copy makes `Op` symbols mismatch and silently drops conditions. `WhereOptions` type also re-exported.

## 0.3.2

### Patch changes

- **Fix: `Unknown column 'taxonomies.term_id' in 'on clause'`** when combining `.taxonomy()` filter with `.limit()`. Sequelize wraps the query in a subquery for LIMIT correctness on `belongsToMany` associations, but the resulting JOIN to the term table referenced an alias that doesn't exist in the outer scope. `.taxonomy()` now sets `subQuery: false` to bypass the wrapper.

## 0.3.0

### Minor changes

- **New: `PostQuery.minimal()`** — exclude heavy columns from SELECT (`post_content`, `post_content_filtered`, `post_excerpt`, `to_ping`, `pinged`, `post_password`, `guid`). For list/catalog queries this drops payload by 5-50KB per row. Do NOT use on detail-page queries — `post.content` / `.excerpt` will be empty.

  ```ts
  // catalog list — drops post_content from SELECT
  await Post.published()
    .type('product')
    .minimal()
    .withMeta()
    .all();
  ```

- **New: `PostQuery.select(columns[])`** — surgical column override when `.minimal()` is too aggressive.

  ```ts
  await Post.query()
    .select(['ID', 'post_title', 'post_name'])
    .all();
  ```

- **Improved: `PostQuery.withMeta()`** now uses Sequelize `separate: true` — issues a second query against `wp_postmeta` keyed by post IDs instead of LEFT JOIN. Avoids cartesian-product blowup (N posts × M meta rows × K taxonomy rows). On a catalog with 30 products, cuts the main query time **4-8×** (1075ms → 129-275ms in our benchmark).

### Patch changes

- `Post.title`, `Post.content`, `Post.excerpt` getters now return `''` instead of `undefined` when the column was excluded via `.minimal()` or `.select()`. Prevents `TypeError: Cannot read properties of undefined`.

## 0.2.0

Initial public release.

- Sequelize-based ORM for the WordPress database (read & write)
- Core models: Post, Page, User, Comment, Term, Taxonomy, Menu, Option, Attachment, Revision, CustomPostType
- Automatic PHP serialization round-trip on meta + options
- `AuthUserProvider` with phpass + bcrypt verification
- Shortcode parser compatible with WordPress's `do_shortcode()`
- Read-only mode for production replicas
- Multi-connection / multi-site support
- TypeScript-first, ESM + CJS output, MIT licensed
