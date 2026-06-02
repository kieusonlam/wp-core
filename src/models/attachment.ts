/**
 * `Attachment` — `Post` scoped to `post_type = 'attachment'`.
 *
 * WordPress stores media library files as posts of type `attachment`. The
 * physical file path lives in postmeta `_wp_attached_file`; image metadata
 * (width/height/sizes) lives in `_wp_attachment_metadata` as a PHP-serialized
 * array.
 */

import { Post } from './post.js';
import type { MetaValue } from '../types.js';

export interface AttachmentMetaSize {
  file: string;
  width: number;
  height: number;
  mime_type: string;
  filesize?: number;
}

export interface AttachmentMeta {
  width: number;
  height: number;
  file: string;
  sizes?: Record<string, AttachmentMetaSize>;
  image_meta?: Record<string, MetaValue>;
  filesize?: number;
}

export class Attachment extends Post {
  static override defaultType = 'attachment';

  /** Relative path under `wp-content/uploads/`. */
  async filePath(): Promise<string | null> {
    const v = await this.getMetaAsync('_wp_attached_file');
    return typeof v === 'string' ? v : null;
  }

  /** Full media metadata struct (sizes, dimensions, EXIF). */
  async fileMetadata(): Promise<AttachmentMeta | null> {
    const v = await this.getMetaAsync('_wp_attachment_metadata');
    return (v as AttachmentMeta | null) ?? null;
  }

  /**
   * Build a public URL for this attachment.
   *
   * @param baseUrl  e.g. `https://www.potech.com.vn/wp-content/uploads`
   * @param size     image size key (`thumbnail`, `medium`, `large`, `full`).
   *                 `full` (default) returns the original file.
   */
  async url(baseUrl: string, size: string = 'full'): Promise<string | null> {
    const path = await this.filePath();
    if (!path) return null;
    if (size === 'full') return `${baseUrl.replace(/\/$/, '')}/${path}`;
    const meta = await this.fileMetadata();
    const sized = meta?.sizes?.[size];
    if (!sized) return `${baseUrl.replace(/\/$/, '')}/${path}`;
    // Replace the basename of `path` with the sized file name
    const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    return `${baseUrl.replace(/\/$/, '')}/${dir ? dir + '/' : ''}${sized.file}`;
  }
}
