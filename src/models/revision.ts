/**
 * `Revision` — post_type `revision`. Stored as a child post with parent = original.
 */

import { Post } from './post.js';

export class Revision extends Post {
  static override defaultType = 'revision';
}
