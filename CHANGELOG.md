# @kieusonlam/wp-core

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
