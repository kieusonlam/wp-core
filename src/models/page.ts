/**
 * `Page` — `Post` scoped to `post_type = 'page'`.
 *
 * @example
 *   const about = await Page.slug('about').first();
 */

import { Post } from './post.js';

export class Page extends Post {
  static override defaultType = 'page';
}
