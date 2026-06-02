/**
 * `Comment` — wp_comments wrapper.
 */

import { Op, type FindOptions } from 'sequelize';
import { getConnection, type WpConnection } from '../db.js';
import { getModels } from './register.js';
import { Post } from './post.js';
import { User } from './user.js';
import type { CommentInstance } from './schema.js';

export class Comment {
  readonly raw: CommentInstance;
  protected readonly conn: WpConnection;

  constructor(raw: CommentInstance, connection?: WpConnection) {
    this.raw = raw;
    this.conn = connection ?? getConnection();
  }

  get id(): number {
    return this.raw.comment_ID;
  }
  get postId(): number {
    return this.raw.comment_post_ID;
  }
  get authorName(): string {
    return this.raw.comment_author;
  }
  get authorEmail(): string {
    return this.raw.comment_author_email;
  }
  get content(): string {
    return this.raw.comment_content;
  }
  get date(): string {
    return this.raw.comment_date;
  }
  /** WordPress stores `1` for approved, `0` for pending, `spam`/`trash` otherwise. */
  get approved(): boolean {
    return this.raw.comment_approved === '1';
  }
  get parentId(): number {
    return this.raw.comment_parent;
  }
  get userId(): number {
    return this.raw.user_id;
  }
  get type(): string {
    return this.raw.comment_type;
  }

  async post(): Promise<Post | null> {
    return Post.find(this.postId, this.conn);
  }

  async author(): Promise<User | null> {
    if (!this.userId) return null;
    return User.find(this.userId, this.conn);
  }

  async replies(): Promise<Comment[]> {
    const { Comment: CommentModel } = getModels(this.conn);
    const rows = await CommentModel.findAll({
      where: { comment_parent: this.id, comment_approved: '1' },
      order: [['comment_date', 'ASC']],
    });
    return rows.map((r) => new Comment(r, this.conn));
  }

  static async find(id: number, connection?: WpConnection): Promise<Comment | null> {
    const conn = connection ?? getConnection();
    const { Comment: CommentModel } = getModels(conn);
    const row = await CommentModel.findByPk(id);
    return row ? new Comment(row, conn) : null;
  }

  /** All approved top-level comments for a post (children are nested via `replies()`). */
  static async forPost(postId: number, connection?: WpConnection): Promise<Comment[]> {
    const conn = connection ?? getConnection();
    const { Comment: CommentModel } = getModels(conn);
    const rows = await CommentModel.findAll({
      where: {
        comment_post_ID: postId,
        comment_parent: 0,
        comment_approved: '1',
      },
      order: [['comment_date', 'ASC']],
    });
    return rows.map((r) => new Comment(r, conn));
  }

  static async all(options: FindOptions = {}, connection?: WpConnection): Promise<Comment[]> {
    const conn = connection ?? getConnection();
    const { Comment: CommentModel } = getModels(conn);
    const rows = await CommentModel.findAll(options);
    return rows.map((r) => new Comment(r, conn));
  }
}
