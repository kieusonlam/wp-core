/**
 * Base class for user-defined Custom Post Types.
 *
 * @example
 *   class Product extends CustomPostType {
 *     static override defaultType = 'product';
 *     get price(): number { return Number(this.getMeta('_price') ?? 0); }
 *   }
 *   const all = await Product.published().all();
 */

import { Post } from './post.js';

export abstract class CustomPostType extends Post {
  /** Subclasses MUST override with their `post_type` string. */
  static override defaultType: string | null = null;
}
